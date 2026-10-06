from __future__ import annotations

import json

import pytest

from tse2026.config import Settings
from tse2026.discovery import Municipio, parse_municipios, parse_secoes, select_pleito
from tse2026.endpoints import Endpoints
from tse2026.exceptions import DiscoveryError

from .conftest import FIXTURES


def ele_c() -> dict:
    return json.loads((FIXTURES / "ele-c.json").read_bytes())


def test_select_pleito_2026_turno1() -> None:
    p = select_pleito(ele_c(), 2026, 1)
    assert p.cd_pleito == 3220
    assert p.data == "2026-10-04"
    assert {e.cd for e in p.eleicoes} == {6257, 6259, 6261}
    assert p.cargos()[1].ds == "Presidente"
    assert p.eleicao_do_cargo()[6] == 6259


def test_select_pleito_inexistente() -> None:
    with pytest.raises(DiscoveryError):
        select_pleito(ele_c(), 2026, 2)  # 2º turno ainda não configurado no arquivo de exemplo
    with pytest.raises(DiscoveryError):
        select_pleito(ele_c(), 2030, 1)


def test_parse_municipios_preserva_zeros() -> None:
    cm = {"abr": [{"cd": "ac", "mu": [{"cd": "01120", "cdi": "1200013", "nm": "ACRELÂNDIA", "c": "n", "z": ["0008"]}]}]}
    (m,) = parse_municipios(cm)
    assert m.uf == "AC" and m.cd == "01120" and m.cd_ibge == 1200013 and m.zonas == [8]


def test_parse_secoes_agregadas() -> None:
    cs = {"abr": [{"cd": "sp", "mu": [{"cd": "61298", "nm": "X", "zon": [{"cd": "0047", "sec": [
        {"ns": "0167", "nsa": ["0176"], "da": "04/10/2026", "ha": "22:59:39"},
        {"ns": "0176", "nsp": "0167"},
        {"ns": "0200", "da": "04/10/2026", "ha": "21:00:00"},
    ]}]}]}]}
    muns = {("SP", "61298"): Municipio("SP", "61298", 3500000, "X", False, [47])}
    rows = {r["NR_SECAO"]: r for r in parse_secoes(cs, 3220, muns, Endpoints(Settings(), "ele2026"))}

    assert rows[167]["NR_SECOES_AGREGADAS"] == "176"
    assert rows[167]["metadata_url"].endswith("/sp/61298/0047/0167/p003220-sp-m61298-z0047-s0167-aux.json")
    assert rows[176]["status"] == "skipped" and rows[176]["NR_SECAO_PRINCIPAL"] == 167
    assert rows[176]["metadata_url"] is None
    assert rows[200]["DT_RECEBIMENTO"] == "2026-10-04T21:00:00"
    assert rows[200]["CD_MUNICIPIO_IBGE"] == 3500000


def test_endpoints() -> None:
    e = Endpoints(Settings(), "ele2026")
    assert e.unificado(6259, "SP", 6, "71072", 1).endswith("/ele2026/6259/dados/sp/sp71072-z0001-c0006-e006259-u.json")
    assert e.unificado(6257, "br", 1).endswith("/6257/dados/br/br-c0001-e006257-u.json")
    assert e.secoes_uf(3220, "SP").endswith("/arquivo-urna/3220/config/sp/sp-p003220-cs.json")
    assert e.relative_path(e.ele_config()) == "comum/config/ele-c.json"
