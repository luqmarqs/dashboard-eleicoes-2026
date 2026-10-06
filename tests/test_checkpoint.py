"""Checkpoint/retomada: manifest SQLite, armazenamento bruto e reaproveitamento de downloads."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pyarrow.parquet as pq

from tse2026.client import HttpClient
from tse2026.config import Settings
from tse2026.download import choose_ballot
from tse2026.endpoints import Endpoints
from tse2026.fetcher import Fetcher
from tse2026.manifest import SectionFilter, StateDB
from tse2026.storage import RawStore

from .conftest import FIXTURES, section_row

INVENTORY_KEYS = ("CD_PLEITO", "SG_UF", "CD_MUNICIPIO", "CD_MUNICIPIO_IBGE", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO",
                  "NR_SECAO_PRINCIPAL", "NR_SECOES_AGREGADAS", "DT_RECEBIMENTO", "metadata_url")


def inv(**kw: object) -> dict[str, object]:
    r = section_row(**kw)
    return {k: r[k] for k in INVENTORY_KEYS}


def test_inventario_preserva_progresso(state: StateDB) -> None:
    state.upsert_inventory([inv(NR_SECAO=1), inv(NR_SECAO=2)])
    key = (3220, "SP", "71072", 1, 1)
    state.update_section(key, status="downloaded")
    # Redescoberta não pode zerar o status já alcançado.
    state.upsert_inventory([inv(NR_SECAO=1, NM_MUNICIPIO="SAO PAULO"), inv(NR_SECAO=2)])
    flt = SectionFilter(3220, "SP")
    assert state.count_by_status(flt) == {"downloaded": 1, "pending": 1}
    row = next(state.iter_sections(SectionFilter(3220, "SP", "71072", 1, 1)))
    assert row["NM_MUNICIPIO"] == "SAO PAULO"


def test_downloading_interrompido_volta_para_pending(state: StateDB) -> None:
    state.upsert_inventory([inv(NR_SECAO=1)])
    state.update_section((3220, "SP", "71072", 1, 1), status="downloading")
    assert state.reset_stale_downloading(SectionFilter(3220)) == 1
    assert state.count_by_status(SectionFilter(3220)) == {"pending": 1}


def test_export_manifests(state: StateDB, settings: Settings) -> None:
    state.upsert_inventory([inv(NR_SECAO=1), inv(NR_SECAO=2)])
    state.update_section((3220, "SP", "71072", 1, 2), status="error", error="HTTP 500")
    state.upsert_file("https://x/a.json", "aux", status="error", error="404", uf="SP")
    paths = state.export_parquet(settings.manifests_dir)
    assert pq.read_table(paths["sections"]).num_rows == 2
    errors = pq.read_table(paths["errors"]).to_pylist()
    assert {e["origem"] for e in errors} == {"section", "file"}


def test_rawstore_nao_sobrescreve_silenciosamente(tmp_path: Path) -> None:
    store = RawStore(tmp_path)
    path = store.path_for("metadata", "a/b.json")
    sha1, changed1 = store.write(path, b"v1")
    sha2, changed2 = store.write(path, b"v1")
    assert changed1 and not changed2 and sha1 == sha2
    store.write(path, b"v2")
    assert path.read_bytes() == b"v2"
    history = list((path.parent / "_history").iterdir())
    assert len(history) == 1 and history[0].read_bytes() == b"v1"


def test_fetcher_reaproveita_arquivo_valido(settings: Settings, state: StateDB) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, content=b'{"ok": 1}')

    async def go() -> None:
        endpoints = Endpoints(settings, "ele2026")
        url = endpoints.ele_config()
        async with HttpClient(settings, transport=httpx.MockTransport(handler)) as client:
            f = Fetcher(client, RawStore(settings.raw_dir), state, endpoints)
            first = await f.fetch(url, category="metadata", tipo="ele-c", expect_json=True)
            second = await f.fetch(url, category="metadata", tipo="ele-c", expect_json=True)
            assert not first.reused and second.reused
            # arquivo corrompido no disco -> baixa de novo
            first.path.write_bytes(b"corrompido")
            third = await f.fetch(url, category="metadata", tipo="ele-c", expect_json=True)
            assert not third.reused and third.path.read_bytes() == b'{"ok": 1}'

    asyncio.run(go())
    assert calls["n"] == 2


def test_choose_ballot() -> None:
    aux = json.loads((FIXTURES / "aux_sp_71072_z0001_s0001.json").read_bytes())
    h, bu, reason = choose_ballot(aux)
    assert reason is None and bu["nm"] == "o03220sp7107200010001-bu.dat"

    sem_totalizado = {"st": "Recebida", "hashes": [{"hash": "x", "st": "Recebido", "arq": [{"nm": "a", "tp": "bu"}]}]}
    assert choose_ballot(sem_totalizado)[2].startswith("nenhum BU totalizado")
    assert choose_ballot({"st": "Não instalada", "hashes": []})[2].startswith("aux sem hashes")

    dois = {"hashes": [
        {"hash": "old", "st": "Totalizado", "dr": "04/10/2026", "hr": "18:00:00", "arq": [{"nm": "a", "tp": "bu"}]},
        {"hash": "new", "st": "Totalizado", "dr": "04/10/2026", "hr": "19:00:00", "arq": [{"nm": "b", "tp": "bu"}]},
        {"hash": "exc", "st": "Excluído", "dr": "04/10/2026", "hr": "20:00:00", "arq": [{"nm": "c", "tp": "bu"}]},
    ]}
    assert choose_ballot(dois)[0]["hash"] == "new"
