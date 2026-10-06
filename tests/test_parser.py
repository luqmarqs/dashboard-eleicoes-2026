"""Normalização BU -> linhas, schema, chave única e staging/consolidação."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb
import pyarrow.parquet as pq
import pytest

from tse2026.bu import decode_bu
from tse2026.config import Settings
from tse2026.exceptions import BUDecodeError
from tse2026.official import CandidateIndex, parse_unificado
from tse2026.parser import (
    Columns, PleitoCtx, ZoneJob, append_votacao, check_identity, consolidate_uf, parse_zone, staging_paths,
)
from tse2026.schemas import SECOES_SCHEMA, VOTACAO_KEY, VOTACAO_SCHEMA

from .conftest import BU_SP_Z1_S1, FIXTURES, section_row

CTX = PleitoCtx(2026, 3220, 1, date(2026, 10, 4),
                {1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado Federal", 7: "Deputado Estadual"})


@pytest.fixture
def cands() -> CandidateIndex:
    u = parse_unificado(json.loads((FIXTURES / "sp71072-z0001-c0001-e006257-u.json").read_bytes()))
    cand = {(6257, 1, "SP", c.numero): c for c in u.candidatos}
    return CandidateIndex(cand, {}, {p.numero: p.sigla for p in u.partidos}, {})


def test_linhas_e_totais(bu_bytes: bytes, cands: CandidateIndex) -> None:
    cols = Columns(VOTACAO_SCHEMA)
    n = append_votacao(cols, decode_bu(bu_bytes), section_row(), CTX, cands)
    table = cols.to_table()
    assert n == table.num_rows == len(cols)
    assert table.schema == VOTACAO_SCHEMA

    rows = table.to_pylist()
    lula = next(r for r in rows if r["CD_CARGO"] == 1 and r["NR_CANDIDATO"] == 13)
    assert lula["QT_VOTOS"] == 121
    assert lula["NM_URNA_CANDIDATO"] == "LULA"
    assert lula["SG_PARTIDO"] == "PT"
    assert lula["DS_DESTINACAO_VOTO"] == "Válido"
    assert lula["QT_APTOS"] == 362 and lula["QT_COMPARECIMENTO"] == 256 and lula["QT_ABSTENCOES"] == 106
    assert (lula["QT_BRANCOS"], lula["QT_NULOS"]) == (2, 9)
    assert lula["QT_VOTOS_NOMINAIS"] == 256 - 2 - 9

    branco = next(r for r in rows if r["CD_CARGO"] == 1 and r["TP_VOTO"] == "branco")
    assert branco["NR_CANDIDATO"] is None and branco["QT_VOTOS"] == 2


def test_nomes_ausentes_ficam_nulos(bu_bytes: bytes) -> None:
    vazio = CandidateIndex({}, {}, {}, {})
    cols = Columns(VOTACAO_SCHEMA)
    append_votacao(cols, decode_bu(bu_bytes), section_row(), CTX, vazio)
    rows = cols.to_table().to_pylist()
    assert all(r["NM_CANDIDATO"] is None and r["SG_PARTIDO"] is None for r in rows)
    assert all(r["NR_CANDIDATO"] is not None for r in rows if r["TP_VOTO"] == "nominal")


def test_chave_natural_unica(bu_bytes: bytes, cands: CandidateIndex) -> None:
    cols = Columns(VOTACAO_SCHEMA)
    append_votacao(cols, decode_bu(bu_bytes), section_row(), CTX, cands)
    rows = cols.to_table().to_pylist()
    keys = [tuple(r.get(k, "SP") for k in VOTACAO_KEY) for r in rows]
    assert len(keys) == len(set(keys))


def test_identidade_da_secao(bu_bytes: bytes) -> None:
    bu = decode_bu(bu_bytes)
    check_identity(bu, section_row())
    with pytest.raises(BUDecodeError):
        check_identity(bu, section_row(NR_SECAO=2))


def _job(settings: Settings, rows: list[dict[str, object]]) -> ZoneJob:
    raw = settings.raw_dir
    (raw / "ballots").mkdir(parents=True)
    (raw / "ballots" / "x-bu.dat").write_bytes(BU_SP_Z1_S1.read_bytes())
    v, s = staging_paths(settings, 1, "SP", "71072", 1)
    return ZoneJob("SP", "71072", 1, rows, raw, v, s)


def test_parse_zone_e_consolidacao(settings: Settings, cands: CandidateIndex) -> None:
    rows = [
        section_row(),
        section_row(NR_SECAO=2, ballot_filename="ballots/nao-existe.dat"),
        section_row(NR_SECAO=3, status="skipped", status_reason="agregada à seção 1", NR_SECAO_PRINCIPAL=1),
    ]
    job = _job(settings, rows)
    res = parse_zone(job, CTX, cands)

    statuses = {k[-1]: (st, err) for k, st, err in res.statuses}
    assert statuses[1][0] == "parsed"
    assert statuses[2][0] == "error" and "parse" in statuses[2][1]
    assert 3 not in statuses  # seção agregada não é parseada

    secoes = pq.ParquetFile(job.secoes_path).read()
    assert secoes.schema == SECOES_SCHEMA
    agregada = [r for r in secoes.to_pylist() if r["NR_SECAO"] == 3][0]
    assert agregada["ST_AGREGADA"] and agregada["DS_STATUS_COLETA"] == "skipped"

    counts = consolidate_uf(settings, 1, "SP")
    assert counts["votacao"] == res.rows
    glob = (settings.dataset_dir / "**" / "*.parquet").as_posix()
    con = duckdb.connect()
    uf, n = con.execute(
        f"SELECT SG_UF, COUNT(*) FROM read_parquet('{glob}', hive_partitioning = true) GROUP BY 1"
    ).fetchone()
    assert (uf, n) == ("SP", res.rows)
    # SG_UF vem só da partição Hive, não é duplicado dentro do arquivo
    files = list(Path(settings.dataset_dir).rglob("*.parquet"))
    assert "SG_UF" not in pq.read_schema(files[0]).names


def test_reparse_e_idempotente(settings: Settings, cands: CandidateIndex) -> None:
    job = _job(settings, [section_row()])
    first = parse_zone(job, CTX, cands)
    second = parse_zone(job, CTX, cands)
    assert first.rows == second.rows
    assert pq.ParquetFile(job.votacao_path).metadata.num_rows == first.rows
