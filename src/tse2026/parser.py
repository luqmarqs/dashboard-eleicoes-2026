"""RAW -> STAGING -> PARQUET.

O parsing é separado do download: lê apenas arquivos já gravados em data/raw.
Cada zona (UF × município × zona) vira um arquivo de staging, reescrito por
completo a cada parse — por isso o parse é idempotente e pode ser refeito sem
baixar nada. A consolidação junta os arquivos de staging de uma UF em
poucos Parquets grandes, ordenados, em data/processed.
"""

from __future__ import annotations

import os
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeRemainingColumn

from .bu import BoletimUrna, decode_bu
from .config import Settings
from .discovery import Pleito
from .exceptions import BUDecodeError
from .log import get_logger
from .manifest import SectionFilter, StateDB
from .official import CandidateIndex, build_candidate_index
from .storage import sha256_bytes
from .schemas import SECOES_SCHEMA, SECOES_SORT, VOTACAO_SCHEMA, VOTACAO_SORT

log = get_logger("parser")

PARSEABLE = ("downloaded", "parsed", "validated")


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y%m%dT%H%M%S")


@dataclass(frozen=True)
class PleitoCtx:
    ano: int
    cd_pleito: int
    turno: int
    data: date
    ds_cargo: dict[int, str]

    @classmethod
    def from_pleito(cls, p: Pleito) -> "PleitoCtx":
        return cls(p.ano, p.cd_pleito, p.turno, date.fromisoformat(p.data), {c.cd: c.ds for c in p.cargos().values()})


@dataclass
class Columns:
    """Acumulador colunar (evita listas de objetos por linha)."""

    schema: pa.Schema
    data: dict[str, list[Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.data = {f.name: [] for f in self.schema}

    def append(self, **values: Any) -> None:
        for name, col in self.data.items():
            col.append(values.get(name))

    def __len__(self) -> int:
        return len(next(iter(self.data.values()))) if self.data else 0

    def to_table(self) -> pa.Table:
        arrays = []
        for f in self.schema:
            if pa.types.is_dictionary(f.type):
                arrays.append(pa.array(self.data[f.name], pa.string()).dictionary_encode())
            else:
                arrays.append(pa.array(self.data[f.name], f.type))
        return pa.Table.from_arrays(arrays, schema=self.schema)


def check_identity(bu: BoletimUrna, section: dict[str, Any]) -> None:
    expected = (int(section["CD_MUNICIPIO"]), int(section["NR_ZONA"]), int(section["NR_SECAO"]))
    got = (bu.municipio, bu.zona, bu.secao)
    if expected != got:
        raise BUDecodeError(f"BU pertence a outra seção: esperado {expected}, BU {got}")


def append_votacao(cols: Columns, bu: BoletimUrna, section: dict[str, Any], ctx: PleitoCtx,
                   cands: CandidateIndex) -> int:
    uf = section["SG_UF"]
    base = dict(
        ANO_ELEICAO=ctx.ano, CD_PLEITO=ctx.cd_pleito, NR_TURNO=ctx.turno, DT_ELEICAO=ctx.data,
        CD_MUNICIPIO=section["CD_MUNICIPIO"], CD_MUNICIPIO_IBGE=section["CD_MUNICIPIO_IBGE"],
        NM_MUNICIPIO=section["NM_MUNICIPIO"], NR_ZONA=section["NR_ZONA"], NR_SECAO=section["NR_SECAO"],
        NR_LOCAL_VOTACAO=bu.local, DS_SITUACAO_BU=section["ds_situacao_hash"],
    )
    n = 0
    for res in bu.resultados:
        totals = defaultdict(int)
        for v in res.votos:
            totals[v.tipo_voto] += v.quantidade
        cargo_base = dict(
            base,
            CD_ELEICAO=res.cd_eleicao,
            CD_CARGO=res.cd_cargo,
            DS_CARGO=ctx.ds_cargo.get(res.cd_cargo),
            TP_CARGO=res.tipo_cargo,
            QT_APTOS=res.qt_aptos,
            QT_COMPARECIMENTO=res.qt_comparecimento,
            QT_ABSTENCOES=res.qt_aptos - res.qt_comparecimento,
            QT_VOTOS_NOMINAIS=totals["nominal"],
            QT_VOTOS_LEGENDA=totals["legenda"],
            QT_BRANCOS=totals["branco"],
            QT_NULOS=totals["nulo"],
        )
        for v in res.votos:
            cand, destinacao = None, None
            if v.tipo_voto == "nominal" and v.numero is not None:
                cand = cands.candidato(res.cd_eleicao, res.cd_cargo, uf, v.numero)
                destinacao = cand.destinacao_voto if cand else None
            elif v.tipo_voto == "legenda":
                destinacao = cands.destinacao_legenda(res.cd_eleicao, res.cd_cargo, uf, v.partido)
            cols.append(
                **cargo_base,
                TP_VOTO=v.tipo_voto,
                NR_CANDIDATO=v.numero,
                NR_PARTIDO=v.partido,
                SG_PARTIDO=cands.sigla(v.partido),
                NM_CANDIDATO=cand.nome if cand else None,
                NM_URNA_CANDIDATO=cand.nome_urna if cand else None,
                SQ_CANDIDATO=cand.sq_candidato if cand else None,
                DS_DESTINACAO_VOTO=destinacao,
                QT_VOTOS=v.quantidade,
            )
            n += 1
    return n


def _section_base(section: dict[str, Any], ctx: PleitoCtx) -> dict[str, Any]:
    return dict(
        ANO_ELEICAO=ctx.ano, CD_PLEITO=ctx.cd_pleito, NR_TURNO=ctx.turno,
        CD_MUNICIPIO=section["CD_MUNICIPIO"], CD_MUNICIPIO_IBGE=section["CD_MUNICIPIO_IBGE"],
        NM_MUNICIPIO=section["NM_MUNICIPIO"], NR_ZONA=section["NR_ZONA"], NR_SECAO=section["NR_SECAO"],
        ST_AGREGADA=section["NR_SECAO_PRINCIPAL"] is not None,
        NR_SECAO_PRINCIPAL=section["NR_SECAO_PRINCIPAL"], NR_SECOES_AGREGADAS=section["NR_SECOES_AGREGADAS"],
        DS_SITUACAO_AUX=section["ds_situacao_aux"], DS_SITUACAO_BU=section["ds_situacao_hash"],
        QT_HASHES=section["qt_hashes"],
        DT_RECEBIMENTO=datetime.fromisoformat(section["DT_RECEBIMENTO"]) if section["DT_RECEBIMENTO"] else None,
        BU_URL=section["ballot_url"],
    )


def append_secao(cols: Columns, section: dict[str, Any], ctx: PleitoCtx, status: str, motivo: str | None,
                 bu: BoletimUrna | None = None, sha: str | None = None) -> None:
    base = _section_base(section, ctx)
    base.update(DS_STATUS_COLETA=status, DS_MOTIVO_STATUS=motivo, BU_SHA256=sha)
    if bu is None:
        cols.append(**base)
        return
    base.update(
        NR_LOCAL_VOTACAO=bu.local, TP_URNA=bu.tipo_urna, TP_ARQUIVO=bu.tipo_arquivo, TP_ORIGEM_BU=bu.origem,
        DS_MOTIVO_SA=bu.motivo_sa, NR_JUNTA_APURADORA=bu.junta_apuradora, NR_TURMA_APURADORA=bu.turma_apuradora,
        NR_URNA_EFETIVADA=bu.numero_interno_urna, CD_CARGA_URNA=bu.codigo_carga,
        DT_CARGA_URNA=parse_dt(bu.data_hora_carga), DS_VERSAO_VOTACAO=bu.versao_votacao,
        DT_ABERTURA=parse_dt(bu.data_hora_abertura), DT_ENCERRAMENTO=parse_dt(bu.data_hora_encerramento),
        DT_EMISSAO_BU=parse_dt(bu.data_hora_emissao), QT_COMPARECIMENTO_URNA=bu.qt_comparecimento_secao,
        QT_HABILITACAO=bu.habilitacao_eleitores,
    )
    por_eleicao: dict[int, tuple[int, int]] = {}
    for res in bu.resultados:
        por_eleicao.setdefault(res.cd_eleicao, (res.qt_aptos, res.qt_comparecimento))
    for cd_eleicao, (aptos, comp) in por_eleicao.items():
        cols.append(**base, CD_ELEICAO=cd_eleicao, QT_APTOS=aptos, QT_COMPARECIMENTO=comp,
                    QT_ABSTENCOES=aptos - comp)


# ---------------------------------------------------------------------------
# Execução por zona (paralelizável em processos)
# ---------------------------------------------------------------------------

@dataclass
class ZoneJob:
    uf: str
    municipio: str
    zona: int
    sections: list[dict[str, Any]]
    raw_dir: Path
    votacao_path: Path
    secoes_path: Path


@dataclass
class ZoneResult:
    uf: str
    municipio: str
    zona: int
    rows: int
    statuses: list[tuple[tuple[Any, ...], str, str | None]]  # (chave, status, erro)


_WORKER: dict[str, Any] = {}


def _init_worker(ctx: PleitoCtx, cands: CandidateIndex) -> None:
    _WORKER["ctx"] = ctx
    _WORKER["cands"] = cands


def parse_zone(job: ZoneJob, ctx: PleitoCtx | None = None, cands: CandidateIndex | None = None) -> ZoneResult:
    ctx = ctx or _WORKER["ctx"]
    cands = cands or _WORKER["cands"]
    vot = Columns(VOTACAO_SCHEMA)
    sec = Columns(SECOES_SCHEMA)
    statuses: list[tuple[tuple[Any, ...], str, str | None]] = []
    for s in job.sections:
        key = (s["CD_PLEITO"], s["SG_UF"], s["CD_MUNICIPIO"], s["NR_ZONA"], s["NR_SECAO"])
        if s["status"] not in PARSEABLE:
            append_secao(sec, s, ctx, s["status"], s["status_reason"] or s["error"])
            continue
        try:
            raw = (job.raw_dir / s["ballot_filename"]).read_bytes()
            bu = decode_bu(raw)
            check_identity(bu, s)
            append_votacao(vot, bu, s, ctx, cands)
            append_secao(sec, s, ctx, "parsed", None, bu, sha256_bytes(raw))
            statuses.append((key, "parsed", None))
        except (OSError, BUDecodeError, KeyError, ValueError) as exc:
            append_secao(sec, s, ctx, "error", f"parse: {exc}")
            statuses.append((key, "error", f"parse: {exc}"))
    for path, cols in ((job.votacao_path, vot), (job.secoes_path, sec)):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        pq.write_table(cols.to_table(), tmp, compression="zstd")
        os.replace(tmp, path)
    return ZoneResult(job.uf, job.municipio, job.zona, len(vot), statuses)


def staging_paths(settings: Settings, turno: int, uf: str, municipio: str, zona: int) -> tuple[Path, Path]:
    name = f"m{municipio}_z{zona:04d}.parquet"
    base = settings.staging_dir
    return (
        base / "votacao" / f"t{turno}" / f"SG_UF={uf}" / name,
        base / "secoes" / f"t{turno}" / f"SG_UF={uf}" / name,
    )


@dataclass
class ParseReport:
    zones: int = 0
    sections_parsed: int = 0
    sections_error: int = 0
    rows: int = 0
    ufs: set[str] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)


def run_parse(settings: Settings, state: StateDB, pleito: Pleito, flt: SectionFilter,
              reparse: bool = False, workers: int | None = None) -> ParseReport:
    """Faz o parse das zonas que têm seções baixadas e ainda não processadas (ou todas, com `reparse`)."""
    ctx = PleitoCtx.from_pleito(pleito)
    cands = build_candidate_index(state, settings.raw_dir)
    if not cands.candidatos and not cands.candidatos_br:
        log.warning("nenhum resultado oficial (-u.json) baixado: nomes de candidatos ficarão nulos")

    all_rows = [dict(r) for r in state.iter_sections(SectionFilter(pleito.cd_pleito, flt.uf, flt.municipio))]
    zones: dict[tuple[str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for r in all_rows:
        zones[(r["SG_UF"], r["CD_MUNICIPIO"], r["NR_ZONA"])].append(r)

    def wanted(key: tuple[str, str, int], rows: list[dict[str, Any]]) -> bool:
        if flt.zona is not None and key[2] != flt.zona:
            return False
        if flt.secao is not None and not any(r["NR_SECAO"] == flt.secao for r in rows):
            return False
        return reparse or any(r["status"] == "downloaded" for r in rows)

    jobs = []
    for key, rows in sorted(zones.items()):
        if not wanted(key, rows):
            continue
        v, s = staging_paths(settings, pleito.turno, *key)
        jobs.append(ZoneJob(*key, sections=rows, raw_dir=settings.raw_dir, votacao_path=v, secoes_path=s))

    report = ParseReport(zones=len(jobs))
    if not jobs:
        return report
    n_workers = workers or max(1, min(len(jobs), (os.cpu_count() or 2) - 1))

    with _progress() as progress:
        task = progress.add_task("zonas", total=len(jobs))
        if n_workers == 1:
            results = (parse_zone(j, ctx, cands) for j in jobs)
            _collect(results, state, report, progress, task)
        else:
            with ProcessPoolExecutor(n_workers, initializer=_init_worker, initargs=(ctx, cands)) as ex:
                _collect(ex.map(parse_zone, jobs, chunksize=4), state, report, progress, task)
    return report


def _collect(results: Any, state: StateDB, report: ParseReport, progress: Progress, task: Any) -> None:
    state.begin()
    for res in results:
        report.rows += res.rows
        report.ufs.add(res.uf)
        for key, status, err in res.statuses:
            state.update_section(key, status=status, error=err)
            if status == "parsed":
                report.sections_parsed += 1
            else:
                report.sections_error += 1
                if len(report.errors) < 20:
                    report.errors.append(f"{key}: {err}")
        progress.advance(task)
        state.commit()
        state.begin()
    state.commit()


def _progress() -> Progress:
    return Progress(TextColumn("[bold]{task.description}"), BarColumn(), MofNCompleteColumn(), TimeRemainingColumn())


# ---------------------------------------------------------------------------
# Consolidação STAGING -> PROCESSED
# ---------------------------------------------------------------------------

# FILE_SIZE_BYTES do DuckDB mede o tamanho antes da compressão e gerava arquivos de ~15 MB.
# Limitamos por linhas: 200 row groups × 500 mil = 100 milhões de linhas por arquivo (~500 MB em
# ZSTD). Na prática cada UF/turno cabe num único arquivo (SP inteiro: 17,9 milhões de linhas, 86 MB).
ROW_GROUP_SIZE = 500_000
ROW_GROUPS_PER_FILE = 200


def consolidate_uf(settings: Settings, turno: int, uf: str) -> dict[str, int]:
    """Junta os arquivos de staging de uma UF em Parquets grandes e ordenados (DuckDB, fora da RAM)."""
    out = {}
    targets = (
        ("votacao", settings.dataset_dir, VOTACAO_SORT),
        ("secoes", settings.sections_dataset_dir, SECOES_SORT),
    )
    con = duckdb.connect()
    try:
        con.execute("SET preserve_insertion_order = false")
        con.execute("SET enable_progress_bar = false")
        for name, dest_root, sort in targets:
            src = settings.staging_dir / name / f"t{turno}" / f"SG_UF={uf}"
            files = sorted(src.glob("*.parquet"))
            dest = dest_root / f"SG_UF={uf}"
            for old in dest.glob(f"turno{turno}_*.parquet"):
                old.unlink()
            if not files:
                out[name] = 0
                continue
            dest.mkdir(parents=True, exist_ok=True)
            src_glob = (src / "*.parquet").as_posix()
            order = ", ".join(f"{c} NULLS LAST" for c in sort)
            tmp_dir = dest_root / f".tmp_SG_UF={uf}_t{turno}"
            if tmp_dir.exists():
                for f in tmp_dir.glob("*"):
                    f.unlink()
                tmp_dir.rmdir()
            con.execute(
                f"""
                COPY (SELECT * FROM read_parquet('{src_glob}', union_by_name = true, hive_partitioning = false) ORDER BY {order})
                TO '{tmp_dir.as_posix()}'
                (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP_SIZE},
                 ROW_GROUPS_PER_FILE {ROW_GROUPS_PER_FILE}, FILENAME_PATTERN 'turno{turno}_{{i}}')
                """
            )
            for f in sorted(tmp_dir.glob("*.parquet")):
                os.replace(f, dest / f.name)
            tmp_dir.rmdir()
            out[name] = con.execute(
                f"SELECT COUNT(*) FROM read_parquet('{(dest / f'turno{turno}_*.parquet').as_posix()}')"
            ).fetchone()[0]
    finally:
        con.close()
    return out
