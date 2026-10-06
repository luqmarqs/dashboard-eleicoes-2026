"""Decodificação do Boletim de Urna (BU) em ASN.1/BER.

O arquivo `-bu.dat` é um `EntidadeEnvelopeGenerico` cujo campo `conteudo`
contém um `EntidadeBoletimUrna`. A especificação usada é a de 2022 adaptada
às mudanças observadas em 2026 (ver `asn1/bu_2026.asn1` e docs/DISCOVERY.md).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from importlib import resources
from typing import Any

import asn1tools

from .exceptions import BUDecodeError

SPEC_FILE = "bu_2026.asn1"


@lru_cache(maxsize=1)
def _spec() -> Any:
    path = resources.files("tse2026") / "asn1" / SPEC_FILE
    with resources.as_file(path) as p:
        return asn1tools.compile_files(str(p), codec="ber")


@dataclass
class VotoVotavel:
    tipo_voto: str  # nominal | legenda | branco | nulo | cargoSemCandidato
    quantidade: int
    partido: int | None
    numero: int | None


@dataclass
class ResultadoCargo:
    cd_eleicao: int
    cd_cargo: int
    tipo_cargo: str  # majoritario | proporcional | consulta
    cargo_constitucional: str | None
    qt_aptos: int
    qt_comparecimento: int
    votos: list[VotoVotavel] = field(default_factory=list)


@dataclass
class BoletimUrna:
    cd_pleito: int | None
    fase: str
    municipio: int
    zona: int
    secao: int
    local: int
    tipo_urna: str
    tipo_arquivo: str
    versao_votacao: str
    numero_interno_urna: int | None
    codigo_carga: str | None
    data_hora_carga: str | None
    data_hora_emissao: str
    origem: str  # dadosSecao (urna de seção) | dadosSA (Sistema de Apuração)
    data_hora_abertura: str | None
    data_hora_encerramento: str | None
    junta_apuradora: int | None
    turma_apuradora: int | None
    motivo_sa: str | None
    qt_comparecimento_secao: int | None
    habilitacao_eleitores: list[int] | None
    resultados: list[ResultadoCargo]


# Códigos de cargo constitucional (enum CargoConstitucional da especificação).
CARGO_CONSTITUCIONAL = {
    "presidente": 1, "vicePresidente": 2, "governador": 3, "viceGovernador": 4, "senador": 5,
    "deputadoFederal": 6, "deputadoEstadual": 7, "deputadoDistrital": 8, "primeiroSuplenteSenador": 9,
    "segundoSuplenteSenador": 10, "prefeito": 11, "vicePrefeito": 12, "vereador": 13,
}


def decode_envelope(raw: bytes) -> dict[str, Any]:
    try:
        return _spec().decode("EntidadeEnvelopeGenerico", raw)
    except Exception as exc:  # asn1tools lança várias classes distintas
        raise BUDecodeError(f"envelope inválido: {exc}") from exc


def decode_raw(raw: bytes) -> dict[str, Any]:
    env = decode_envelope(raw)
    if env.get("tipoEnvelope") != "envelopeBoletimUrna":
        raise BUDecodeError(f"envelope não é BU: {env.get('tipoEnvelope')}")
    if env.get("seguranca") is not None:
        raise BUDecodeError("conteúdo do BU cifrado (campo 'seguranca' presente)")
    try:
        return _spec().decode("EntidadeBoletimUrna", env["conteudo"])
    except Exception as exc:
        raise BUDecodeError(f"EntidadeBoletimUrna inválida: {exc}") from exc


def _cargo_code(codigo: tuple[str, Any]) -> tuple[int, str | None]:
    kind, value = codigo
    if kind == "cargoConstitucional":
        return CARGO_CONSTITUCIONAL[value], value
    return int(value), None


def _motivo_sa(urna: dict[str, Any]) -> str | None:
    motivo = urna.get("motivoUtilizacaoSA")
    if not motivo:
        return None
    kind, value = motivo
    return f"{kind}:{value.get('motivoApuracao')}"


def decode_bu(raw: bytes) -> BoletimUrna:
    bu = decode_raw(raw)
    urna = bu["urna"]
    carga = urna["correspondenciaResultado"]["carga"]
    ident = bu["identificacaoSecao"]
    origem, dados = bu["dadosSecaoSA"]
    _, id_eleitoral = bu["cabecalho"]["idEleitoral"]

    resultados: list[ResultadoCargo] = []
    for por_eleicao in bu["resultadosVotacaoPorEleicao"]:
        for rv in por_eleicao["resultadosVotacao"]:
            for tc in rv["totaisVotosCargo"]:
                cd_cargo, constitucional = _cargo_code(tc["codigoCargo"])
                votos = []
                for v in tc["votosVotaveis"]:
                    ident_v = v.get("identificacaoVotavel")
                    votos.append(
                        VotoVotavel(
                            tipo_voto=v["tipoVoto"],
                            quantidade=v["quantidadeVotos"],
                            partido=ident_v["partido"] if ident_v else None,
                            numero=ident_v["codigo"] if ident_v else None,
                        )
                    )
                resultados.append(
                    ResultadoCargo(
                        cd_eleicao=por_eleicao["idEleicao"],
                        cd_cargo=cd_cargo,
                        tipo_cargo=rv["tipoCargo"],
                        cargo_constitucional=constitucional,
                        qt_aptos=por_eleicao["qtdEleitoresAptos"],
                        qt_comparecimento=rv["qtdComparecimento"],
                        votos=votos,
                    )
                )

    return BoletimUrna(
        cd_pleito=id_eleitoral if bu["cabecalho"]["idEleitoral"][0] == "idPleito" else None,
        fase=bu["fase"],
        municipio=ident["municipioZona"]["municipio"],
        zona=ident["municipioZona"]["zona"],
        secao=ident["secao"],
        local=ident["local"],
        tipo_urna=urna["tipoUrna"],
        tipo_arquivo=urna["tipoArquivo"],
        versao_votacao=urna["versaoVotacao"],
        numero_interno_urna=carga.get("numeroInternoUrna"),
        codigo_carga=carga.get("codigoCarga"),
        data_hora_carga=carga.get("dataHoraCarga"),
        data_hora_emissao=bu["dataHoraEmissao"],
        origem=origem,
        data_hora_abertura=dados.get("dataHoraAbertura") if origem == "dadosSecao" else None,
        data_hora_encerramento=dados.get("dataHoraEncerramento") if origem == "dadosSecao" else None,
        junta_apuradora=dados.get("juntaApuradora") if origem == "dadosSA" else None,
        turma_apuradora=dados.get("turmaApuradora") if origem == "dadosSA" else None,
        motivo_sa=_motivo_sa(urna),
        qt_comparecimento_secao=bu.get("qtdComparecimentoSecao"),
        habilitacao_eleitores=list(bu["habilitacaoEleitores"]) if bu.get("habilitacaoEleitores") else None,
        resultados=resultados,
    )
