"""Validação: separação entre seções totalizadas e não totalizadas (ex.: "Recebida")."""

from __future__ import annotations

import json
from datetime import date

import duckdb

from tse2026.config import Settings
from tse2026.discovery import Cargo, Eleicao, Pleito
from tse2026.manifest import SectionFilter, StateDB
from tse2026.official import CandidateIndex
from tse2026.parser import PleitoCtx, ZoneJob, consolidate_uf, parse_zone, staging_paths
from tse2026.validation import run_validation

from .conftest import BU_SP_Z1_S1, section_row

PLEITO = Pleito(2026, "ele2026", 3220, 1, "2026-10-04",
                [Eleicao(6257, "Federal", 1, "8", None, ["br"], [Cargo(1, "Presidente", "1")])])
CTX = PleitoCtx(2026, 3220, 1, date(2026, 10, 4), {1: "Presidente"})


def _official_zone(settings: Settings, state: StateDB, lula: int) -> None:
    """Grava um -u.json de zona sintético e o registra no manifest."""
    data = {
        "ele": "6257", "tpabr": "zona", "cdabr": "0001", "s": {"ts": "1", "st": "1"},
        "e": {"te": "362", "c": "256", "a": "106"},
        "v": {"vb": "2", "vn": "9"},
        "carg": [{"cd": "1", "agr": [{"par": [{"n": "13", "sg": "PT", "cand": [
            {"n": "13", "nm": "LULA", "nmu": "LULA", "dvt": "Válido", "vap": str(lula)}]}]}]}],
    }
    rel = "metadata/u/sp71072-z0001-c0001-e006257-u.json"
    path = settings.raw_dir / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    state.upsert_file("https://x/sp71072-z0001-c0001-e006257-u.json", "u-zona", status="downloaded",
                      filename=rel, uf="SP", municipio="71072", zona=1)


def _dataset(settings: Settings, state: StateDB, situacao: str) -> None:
    row = section_row(ds_situacao_hash=situacao, status="parsed")
    state.upsert_inventory([{k: row[k] for k in (
        "CD_PLEITO", "SG_UF", "CD_MUNICIPIO", "CD_MUNICIPIO_IBGE", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO",
        "NR_SECAO_PRINCIPAL", "NR_SECOES_AGREGADAS", "DT_RECEBIMENTO", "metadata_url")}])
    state.update_section((3220, "SP", "71072", 1, 1), status="parsed", ds_situacao_hash=situacao)
    (settings.raw_dir / "ballots").mkdir(parents=True, exist_ok=True)
    (settings.raw_dir / "ballots" / "x-bu.dat").write_bytes(BU_SP_Z1_S1.read_bytes())
    v, s = staging_paths(settings, 1, "SP", "71072", 1)
    parse_zone(ZoneJob("SP", "71072", 1, [row], settings.raw_dir, v, s), CTX, CandidateIndex({}, {}, {}, {}))
    consolidate_uf(settings, 1, "SP")


def _status(settings: Settings, metrica: str, candidato: int | None = None) -> tuple:
    cond = f"AND candidato = {candidato}" if candidato is not None else "AND candidato IS NULL"
    return duckdb.sql(
        f"""SELECT status, votos_secoes, votos_secoes_totalizadas, votos_secoes_nao_totalizadas, votos_oficial
            FROM '{(settings.validation_dir / "comparisons.parquet").as_posix()}'
            WHERE nivel = 'zona' AND metrica = '{metrica}' {cond}"""
    ).fetchone()


def test_diferenca_explicada_por_secao_recebida(settings: Settings, state: StateDB) -> None:
    _dataset(settings, state, "Recebido")
    _official_zone(settings, state, lula=0)  # oficial ainda não conta a seção
    report = run_validation(settings, state, PLEITO, SectionFilter(3220, "SP"))
    assert _status(settings, "QT_VOTOS", 13) == ("NAO_TOTALIZADAS", 121, 0, 121, 0)
    assert report.ok  # NAO_TOTALIZADAS não é DIFFERENCE
    nao_tot = duckdb.sql(
        f"SELECT DISTINCT NR_SECAO, DS_SITUACAO_BU FROM "
        f"'{(settings.validation_dir / 'secoes_nao_totalizadas.parquet').as_posix()}'"
    ).fetchall()
    assert nao_tot == [(1, "Recebido")]


def test_secao_totalizada_ok(settings: Settings, state: StateDB) -> None:
    _dataset(settings, state, "Totalizado")
    _official_zone(settings, state, lula=121)
    run_validation(settings, state, PLEITO, SectionFilter(3220, "SP"))
    assert _status(settings, "QT_VOTOS", 13) == ("OK", 121, 121, 0, 121)
    assert _status(settings, "QT_BRANCOS")[0] == "OK"


def test_diferenca_real(settings: Settings, state: StateDB) -> None:
    _dataset(settings, state, "Totalizado")
    _official_zone(settings, state, lula=100)
    report = run_validation(settings, state, PLEITO, SectionFilter(3220, "SP"))
    assert _status(settings, "QT_VOTOS", 13)[0] == "DIFFERENCE"
    assert not report.ok
