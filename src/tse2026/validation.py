"""Validação: agrega os votos das seções e compara com os resultados oficiais do TSE.

Níveis: zona (se baixado), município, UF e Brasil. Compara, por eleição × cargo:
  - votos de cada candidato (votos nominais do BU × "vap" oficial);
  - votos de legenda por partido (BU × "tvtl" oficial);
  - totais: aptos, comparecimento, abstenções, brancos, nulos, nominais, legenda.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .config import Settings
from .discovery import Pleito
from .log import get_logger
from .manifest import SectionFilter, StateDB
from .official import iter_official_files, load_unificado
from .schemas import VOTACAO_KEY

log = get_logger("validation")

LEVELS = {"u-zona": "zona", "u-municipio": "municipio", "u-uf": "uf", "u-br": "br"}

# métrica do dataset -> campo do -u.json (bloco "e" = eleitorado, "v" = votos)
TOTAL_METRICS = {
    "QT_APTOS": ("e", "te"),
    "QT_COMPARECIMENTO": ("e", "c"),
    "QT_ABSTENCOES": ("e", "a"),
    "QT_VOTOS_TOTAL": ("v", "tv"),
    "QT_VOTOS_NOMINAIS_VALIDOS": ("v", "vnom"),
    "QT_VOTOS_LEGENDA_VALIDOS": ("v", "vl"),
    "QT_BRANCOS": ("v", "vb"),
    "QT_NULOS": ("v", "vn"),
    "QT_NULOS_TECNICOS": ("v", "vnt"),
    "QT_ANULADOS": ("v", "van"),
    "QT_ANULADOS_SUB_JUDICE": ("v", "vansj"),
}

STATUS_OK = "OK"
STATUS_DIFF = "DIFFERENCE"
STATUS_MISSING_SECTIONS = "MISSING_SECTIONS"
STATUS_MISSING_OFFICIAL = "MISSING_OFFICIAL_DATA"
STATUS_NULO_TECNICO = "NULO_TECNICO"
STATUS_NAO_TOTALIZADAS = "NAO_TOTALIZADAS"


def _int(v: Any) -> int | None:
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def build_official_tables(state: StateDB, settings: Settings, flt: SectionFilter) -> dict[str, pa.Table]:
    cand: dict[str, list[Any]] = {k: [] for k in ("nivel", "uf", "municipio", "zona", "cd_eleicao", "cd_cargo",
                                                  "numero", "nr_partido", "dvt", "votos")}
    leg: dict[str, list[Any]] = {k: [] for k in ("nivel", "uf", "municipio", "zona", "cd_eleicao", "cd_cargo",
                                                 "nr_partido", "dvt", "votos")}
    tot: dict[str, list[Any]] = {k: [] for k in ("nivel", "uf", "municipio", "zona", "cd_eleicao", "cd_cargo",
                                                 "metrica", "valor", "secoes_totalizadas", "secoes_total")}
    for f in iter_official_files(state, settings.raw_dir, tuple(LEVELS)):
        if flt.uf and f.tipo != "u-br" and (f.uf or "").upper() != flt.uf.upper():
            continue
        if flt.uf and f.tipo == "u-br":
            continue
        if flt.municipio and f.municipio and f.municipio != str(flt.municipio).zfill(5):
            continue
        u = load_unificado(f.path)
        nivel = LEVELS[f.tipo]
        ids = dict(nivel=nivel, uf="" if nivel == "br" else (f.uf or "").upper(), municipio=f.municipio or "",
                   zona=f.zona or 0, cd_eleicao=u.cd_eleicao, cd_cargo=u.cd_cargo)
        for c in u.candidatos:
            for k, v in {**ids, "numero": c.numero, "nr_partido": c.nr_partido, "dvt": c.destinacao_voto,
                         "votos": c.votos}.items():
                cand[k].append(v)
        for p in u.partidos:
            if p.votos_legenda_apurados is None:
                continue
            for k, v in {**ids, "nr_partido": p.numero, "dvt": p.destinacao_voto,
                         "votos": p.votos_legenda_apurados}.items():
                leg[k].append(v)
        for metrica, (bloco, campo) in TOTAL_METRICS.items():
            src = u.totais_eleitorado if bloco == "e" else u.totais_votos
            if campo not in src:
                continue
            for k, v in {**ids, "metrica": metrica, "valor": _int(src.get(campo)),
                         "secoes_totalizadas": _int(u.totais_secoes.get("st")),
                         "secoes_total": _int(u.totais_secoes.get("ts"))}.items():
                tot[k].append(v)

    def table(d: dict[str, list[Any]]) -> pa.Table:
        types = {"zona": pa.int32(), "cd_eleicao": pa.int32(), "cd_cargo": pa.int32(), "numero": pa.int32(),
                 "nr_partido": pa.int32(), "votos": pa.int64(), "valor": pa.int64(),
                 "secoes_totalizadas": pa.int64(), "secoes_total": pa.int64()}
        return pa.table({k: pa.array(v, types.get(k, pa.string())) for k, v in d.items()})

    return {"of_cand": table(cand), "of_leg": table(leg), "of_tot": table(tot)}


@dataclass
class ValidationReport:
    summary_path: Path
    differences_path: Path
    comparisons_path: Path
    duplicates: int
    counts: dict[str, int]

    @property
    def ok(self) -> bool:
        return self.duplicates == 0 and self.counts.get(STATUS_DIFF, 0) == 0


def _dataset_glob(settings: Settings, turno: int, uf: str | None) -> str:
    part = f"SG_UF={uf.upper()}" if uf else "SG_UF=*"
    return (settings.dataset_dir / part / f"turno{turno}_*.parquet").as_posix()


def run_validation(settings: Settings, state: StateDB, pleito: Pleito, flt: SectionFilter) -> ValidationReport:
    settings.validation_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(
            f"CREATE VIEW vot AS SELECT * FROM read_parquet('{_dataset_glob(settings, pleito.turno, flt.uf)}', "
            f"hive_partitioning = true)"
        )
        key = ", ".join(VOTACAO_KEY)
        duplicates = con.execute(
            f"SELECT COUNT(*) FROM (SELECT {key}, COUNT(*) n FROM vot GROUP BY ALL HAVING n > 1)"
        ).fetchone()[0]
        if duplicates:
            log.error("chave natural duplicada no dataset", extra={"grupos": duplicates})

        for name, tbl in build_official_tables(state, settings, flt).items():
            con.register(name, tbl)

        # cobertura medida sobre toda a abrangência (UF inteira, ou o país), não só sobre o filtro
        scope = SectionFilter(pleito.cd_pleito, flt.uf)
        sections = pa.Table.from_pylist(
            [dict(r) for r in state.iter_sections(scope)],
        ).select(["SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "NR_SECAO_PRINCIPAL", "status"])
        con.register("inv", sections)
        con.execute(_SQL_COMPARE)

        comparisons = settings.validation_dir / "comparisons.parquet"
        differences = settings.validation_dir / "differences.parquet"
        summary = settings.validation_dir / "validation_summary.parquet"
        con.execute(f"COPY (SELECT * FROM cmp ORDER BY ALL) TO '{comparisons.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        con.execute(
            f"COPY (SELECT * FROM cmp WHERE status <> 'OK' ORDER BY ALL) "
            f"TO '{differences.as_posix()}' (FORMAT parquet, COMPRESSION zstd)"
        )
        con.execute(
            f"""COPY (
                SELECT nivel, tipo, status, COUNT(*) AS n_comparacoes,
                       SUM(abs(diferenca_absoluta)) AS soma_diferenca_absoluta,
                       SUM(abs(votos_secoes_nao_totalizadas)) AS soma_votos_nao_totalizadas
                FROM cmp GROUP BY ALL ORDER BY ALL
            ) TO '{summary.as_posix()}' (FORMAT parquet, COMPRESSION zstd)"""
        )
        nao_tot = settings.validation_dir / "secoes_nao_totalizadas.parquet"
        con.execute(
            f"""COPY (
                SELECT SG_UF, CD_MUNICIPIO, NM_MUNICIPIO, NR_ZONA, NR_SECAO, DS_SITUACAO_BU, CD_ELEICAO, CD_CARGO,
                       DS_CARGO, ANY_VALUE(QT_APTOS) AS QT_APTOS, ANY_VALUE(QT_COMPARECIMENTO) AS QT_COMPARECIMENTO,
                       SUM(QT_VOTOS) AS QT_VOTOS
                FROM vot WHERE DS_SITUACAO_BU IS DISTINCT FROM 'Totalizado'
                GROUP BY ALL ORDER BY ALL
            ) TO '{nao_tot.as_posix()}' (FORMAT parquet, COMPRESSION zstd)"""
        )
        counts = dict(con.execute("SELECT status, COUNT(*) FROM cmp GROUP BY status").fetchall())
        _mark_validated(con, state, pleito)
    finally:
        con.close()
    return ValidationReport(summary, differences, comparisons, duplicates, counts)


def _mark_validated(con: duckdb.DuckDBPyConnection, state: StateDB, pleito: Pleito) -> None:
    """Seções de municípios sem nenhuma divergência passam a 'validated'."""
    ok_muns = con.execute(
        """
        SELECT uf, municipio FROM cmp WHERE nivel = 'municipio'
        GROUP BY uf, municipio HAVING bool_and(status = 'OK')
        """
    ).fetchall()
    state.begin()
    for uf, mun in ok_muns:
        state.mark_sections(SectionFilter(pleito.cd_pleito, uf, mun), ["parsed"], "validated")
    state.commit()


_SQL_COMPARE = """
-- Convenção nas chaves de junção: municipio = '' e zona = 0 quando o nível não os tem; uf = '' no nível br.
CREATE TEMP TABLE cobertura AS
WITH s AS (
    SELECT SG_UF AS uf, CD_MUNICIPIO AS municipio, NR_ZONA AS zona,
           (NR_SECAO_PRINCIPAL IS NULL AND status NOT IN ('parsed', 'validated', 'skipped'))::INT AS faltante
    FROM inv
)
SELECT 'zona' AS nivel, uf, municipio, zona, SUM(faltante) AS faltantes FROM s GROUP BY ALL
UNION ALL SELECT 'municipio', uf, municipio, 0, SUM(faltante) FROM s GROUP BY ALL
UNION ALL SELECT 'uf', uf, '', 0, SUM(faltante) FROM s GROUP BY ALL
UNION ALL SELECT 'br', '', '', 0, SUM(faltante) FROM s;

CREATE TEMP TABLE bu_votavel AS
-- nao_tot: seção cujo BU usado não está "Totalizado" no TSE (ex.: "Recebido"). Esses votos são
-- separados para explicitar a diferença em relação ao resultado oficial.
SELECT SG_UF AS uf, CD_MUNICIPIO AS municipio, NR_ZONA AS zona, CD_ELEICAO AS cd_eleicao,
       CD_CARGO AS cd_cargo, TP_VOTO AS tp_voto, NR_CANDIDATO AS numero, (DS_SITUACAO_BU IS DISTINCT FROM 'Totalizado') AS nao_tot, SUM(QT_VOTOS) AS votos
FROM vot WHERE TP_VOTO IN ('nominal', 'legenda') GROUP BY ALL;

-- Totais por seção × cargo. Comparecimento/aptos vêm do BU; a classificação dos votos nominais
-- (válido, nulo técnico, anulado...) usa a destinação oficial (DS_DESTINACAO_VOTO).
CREATE TEMP TABLE bu_secao_cargo AS
SELECT uf, municipio, zona, cd_eleicao, cd_cargo, nao_tot,
       SUM(QT_APTOS)::BIGINT AS QT_APTOS, SUM(QT_COMPARECIMENTO)::BIGINT AS QT_COMPARECIMENTO,
       SUM(QT_ABSTENCOES)::BIGINT AS QT_ABSTENCOES
FROM (
    SELECT DISTINCT SG_UF AS uf, CD_MUNICIPIO AS municipio, NR_ZONA AS zona, NR_SECAO AS secao,
           CD_ELEICAO AS cd_eleicao, CD_CARGO AS cd_cargo, (DS_SITUACAO_BU IS DISTINCT FROM 'Totalizado') AS nao_tot,
           QT_APTOS, QT_COMPARECIMENTO, QT_ABSTENCOES
    FROM vot
) GROUP BY ALL;

CREATE TEMP TABLE bu_votos AS
SELECT SG_UF AS uf, CD_MUNICIPIO AS municipio, NR_ZONA AS zona, CD_ELEICAO AS cd_eleicao, CD_CARGO AS cd_cargo,
       (DS_SITUACAO_BU IS DISTINCT FROM 'Totalizado') AS nao_tot,
       SUM(QT_VOTOS)::BIGINT AS QT_VOTOS_TOTAL,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO = 'nominal' AND DS_DESTINACAO_VOTO LIKE 'Válido%'), 0)::BIGINT
           AS QT_VOTOS_NOMINAIS_VALIDOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO = 'legenda' AND DS_DESTINACAO_VOTO LIKE 'Válido%'), 0)::BIGINT
           AS QT_VOTOS_LEGENDA_VALIDOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO = 'branco'), 0)::BIGINT AS QT_BRANCOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO = 'nulo'), 0)::BIGINT AS QT_NULOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO IN ('nominal', 'legenda')
                AND (DS_DESTINACAO_VOTO IS NULL OR DS_DESTINACAO_VOTO ILIKE '%nulo%')), 0)::BIGINT
           AS QT_NULOS_TECNICOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO IN ('nominal', 'legenda')
                AND DS_DESTINACAO_VOTO = 'Anulado'), 0)::BIGINT AS QT_ANULADOS,
       COALESCE(SUM(QT_VOTOS) FILTER (TP_VOTO IN ('nominal', 'legenda')
                AND DS_DESTINACAO_VOTO = 'Anulado sub judice'), 0)::BIGINT AS QT_ANULADOS_SUB_JUDICE
FROM vot GROUP BY ALL;

-- Comparecimento/aptos vêm do BU; a classificação dos votos nominais (válido, nulo técnico,
-- anulado...) usa a destinação oficial (DS_DESTINACAO_VOTO).
CREATE TEMP TABLE bu_tot AS
SELECT * FROM (UNPIVOT bu_secao_cargo ON COLUMNS(* EXCLUDE (uf, municipio, zona, cd_eleicao, cd_cargo, nao_tot))
               INTO NAME metrica VALUE valor)
UNION ALL
SELECT * FROM (UNPIVOT bu_votos ON COLUMNS(* EXCLUDE (uf, municipio, zona, cd_eleicao, cd_cargo, nao_tot))
               INTO NAME metrica VALUE valor);

CREATE TEMP TABLE bu_lvl AS
WITH b AS (
    SELECT uf, municipio, zona, cd_eleicao, cd_cargo,
           CASE tp_voto WHEN 'nominal' THEN 'candidato' ELSE 'legenda' END AS tipo,
           CASE tp_voto WHEN 'nominal' THEN 'QT_VOTOS' ELSE 'QT_VOTOS_LEGENDA' END AS metrica,
           numero, nao_tot, votos AS valor
    FROM bu_votavel
    UNION ALL
    SELECT uf, municipio, zona, cd_eleicao, cd_cargo, 'total', metrica, -1, nao_tot, valor FROM bu_tot
),
v AS (SELECT * EXCLUDE (nao_tot), CASE WHEN nao_tot THEN valor ELSE 0 END AS valor_nt FROM b)
SELECT 'zona' AS nivel, uf, municipio, zona, cd_eleicao, cd_cargo, tipo, metrica, numero,
       SUM(valor) AS valor, SUM(valor_nt) AS valor_nt FROM v GROUP BY ALL
UNION ALL SELECT 'municipio', uf, municipio, 0, cd_eleicao, cd_cargo, tipo, metrica, numero, SUM(valor), SUM(valor_nt)
FROM v GROUP BY ALL
UNION ALL SELECT 'uf', uf, '', 0, cd_eleicao, cd_cargo, tipo, metrica, numero, SUM(valor), SUM(valor_nt)
FROM v GROUP BY ALL
UNION ALL SELECT 'br', '', '', 0, cd_eleicao, cd_cargo, tipo, metrica, numero, SUM(valor), SUM(valor_nt)
FROM v GROUP BY ALL;

CREATE TEMP TABLE of_lvl AS
SELECT nivel, uf, municipio, zona, cd_eleicao, cd_cargo, 'candidato' AS tipo, 'QT_VOTOS' AS metrica,
       numero, dvt, votos AS valor FROM of_cand
UNION ALL
SELECT nivel, uf, municipio, zona, cd_eleicao, cd_cargo, 'legenda', 'QT_VOTOS_LEGENDA', nr_partido, dvt, votos
FROM of_leg
UNION ALL
SELECT nivel, uf, municipio, zona, cd_eleicao, cd_cargo, 'total', metrica, -1, NULL, valor FROM of_tot;

-- Só são comparados os escopos (nível × abrangência × cargo) para os quais existe arquivo oficial.
CREATE TEMP TABLE escopos AS
SELECT DISTINCT nivel, uf, municipio, zona, cd_eleicao, cd_cargo FROM of_tot;

CREATE TEMP TABLE cmp AS
WITH j AS (
    SELECT nivel, uf, municipio, zona, cd_eleicao, cd_cargo, tipo, metrica, numero,
           o.dvt, b.valor AS votos_secoes, COALESCE(b.valor_nt, 0) AS votos_nt,
           o.valor AS votos_oficial, (o.metrica IS NULL) AS sem_oficial
    FROM (
        SELECT b.* FROM bu_lvl b SEMI JOIN escopos USING (nivel, uf, municipio, zona, cd_eleicao, cd_cargo)
        -- totais: só as métricas que o arquivo oficial publica para o cargo
        WHERE b.tipo <> 'total' OR EXISTS (
            SELECT 1 FROM of_lvl o WHERE o.tipo = 'total' AND o.metrica = b.metrica AND o.nivel = b.nivel
              AND o.uf = b.uf AND o.municipio = b.municipio AND o.zona = b.zona
              AND o.cd_eleicao = b.cd_eleicao AND o.cd_cargo = b.cd_cargo)
    ) b
    FULL OUTER JOIN of_lvl o USING (nivel, uf, municipio, zona, cd_eleicao, cd_cargo, tipo, metrica, numero)
)
SELECT j.nivel, NULLIF(j.uf, '') AS uf, NULLIF(j.municipio, '') AS municipio, NULLIF(j.zona, 0) AS zona,
       j.cd_eleicao, j.cd_cargo, j.tipo, j.metrica,
       CASE WHEN j.numero >= 0 THEN j.numero END AS candidato,
       j.dvt AS destinacao_voto_oficial,
       COALESCE(j.votos_secoes, 0) AS votos_secoes,
       COALESCE(j.votos_secoes, 0) - j.votos_nt AS votos_secoes_totalizadas,
       j.votos_nt AS votos_secoes_nao_totalizadas,
       CASE WHEN NOT j.sem_oficial THEN COALESCE(j.votos_oficial, 0) END AS votos_oficial,
       COALESCE(j.votos_secoes, 0) - j.votos_oficial AS diferenca_absoluta,
       CASE WHEN j.votos_oficial > 0
            THEN round(100.0 * (COALESCE(j.votos_secoes, 0) - j.votos_oficial) / j.votos_oficial, 6) END
           AS diferenca_percentual,
       COALESCE(c.faltantes, 0) AS secoes_faltantes,
       CASE
           -- votável presente no BU mas ausente do resultado oficial: voto contado pelo TSE como
           -- nulo técnico (conferido no agregado pela métrica QT_NULOS_TECNICOS)
           WHEN j.sem_oficial AND j.tipo <> 'total' AND EXISTS (
               SELECT 1 FROM escopos e WHERE e.nivel = j.nivel AND e.uf = j.uf AND e.municipio = j.municipio
                 AND e.zona = j.zona AND e.cd_eleicao = j.cd_eleicao AND e.cd_cargo = j.cd_cargo)
               THEN 'NULO_TECNICO'
           WHEN j.sem_oficial OR j.votos_oficial IS NULL THEN 'MISSING_OFFICIAL_DATA'
           WHEN COALESCE(j.votos_secoes, 0) = j.votos_oficial THEN 'OK'
           -- a diferença é exatamente o voto das seções com BU não totalizado (ex.: "Recebida")
           WHEN j.votos_nt <> 0 AND COALESCE(j.votos_secoes, 0) - j.votos_nt = j.votos_oficial
               THEN 'NAO_TOTALIZADAS'
           WHEN COALESCE(c.faltantes, 0) > 0 THEN 'MISSING_SECTIONS'
           ELSE 'DIFFERENCE'
       END AS status
FROM j
LEFT JOIN cobertura c USING (nivel, uf, municipio, zona);
"""
