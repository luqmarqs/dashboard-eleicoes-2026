"""Decodificação de um BU real de 2026 (SP, São Paulo, zona 1, seção 1)."""

from __future__ import annotations

import pytest

from tse2026.bu import decode_bu, decode_envelope
from tse2026.exceptions import BUDecodeError

from .conftest import FIXTURES


def test_envelope_identifica_secao(bu_bytes: bytes) -> None:
    env = decode_envelope(bu_bytes)
    assert env["tipoEnvelope"] == "envelopeBoletimUrna"
    assert env["fase"] == "oficial"
    kind, ident = env["identificacao"]
    assert kind == "identificacaoSecaoEleitoral"
    assert ident["municipioZona"] == {"municipio": 71072, "zona": 1}
    assert ident["secao"] == 1


def test_bu_campos_da_secao(bu_bytes: bytes) -> None:
    bu = decode_bu(bu_bytes)
    assert (bu.cd_pleito, bu.municipio, bu.zona, bu.secao, bu.local) == (3220, 71072, 1, 1, 1015)
    assert bu.origem == "dadosSecao"
    assert bu.tipo_urna == "secao"
    assert bu.data_hora_abertura == "20261004T080001"
    assert bu.qt_comparecimento_secao == 256
    assert sum(bu.habilitacao_eleitores or []) == 256


def test_bu_votos_por_cargo(bu_bytes: bytes) -> None:
    bu = decode_bu(bu_bytes)
    cargos = {(r.cd_eleicao, r.cd_cargo): r for r in bu.resultados}
    assert set(cargos) == {(6257, 1), (6259, 3), (6259, 5), (6259, 6), (6259, 7)}

    pres = cargos[(6257, 1)]
    assert pres.qt_aptos == 362 and pres.qt_comparecimento == 256
    votos = {(v.tipo_voto, v.numero): v.quantidade for v in pres.votos}
    assert votos[("nominal", 13)] == 121
    assert votos[("nominal", 22)] == 96
    assert votos[("branco", None)] == 2
    assert votos[("nulo", None)] == 9
    assert sum(votos.values()) == 256

    # Senado 2026: duas vagas, cada eleitor vota duas vezes.
    assert sum(v.quantidade for v in cargos[(6259, 5)].votos) == 512
    # Proporcionais têm votos de legenda (número do partido).
    assert any(v.tipo_voto == "legenda" for v in cargos[(6259, 6)].votos)


@pytest.mark.parametrize("data", [b"", b"\x30\x03abc", b"lixo" * 50])
def test_bu_invalido(data: bytes) -> None:
    with pytest.raises(BUDecodeError):
        decode_bu(data)


def test_bu_truncado(bu_bytes: bytes) -> None:
    with pytest.raises(BUDecodeError):
        decode_bu(bu_bytes[: len(bu_bytes) // 2])


def test_busa_sistema_de_apuracao() -> None:
    bu = decode_bu((FIXTURES / "o03220zz2917300010494-busa.dat").read_bytes())
    assert bu.origem == "dadosSA"
    assert bu.tipo_arquivo == "saManual"
    assert bu.motivo_sa == "apuracaoTotalmenteManual:outros"
    (pres,) = bu.resultados
    assert (pres.cd_cargo, pres.qt_aptos, pres.qt_comparecimento) == (1, 32, 13)
    assert sum(v.quantidade for v in pres.votos) == 13
