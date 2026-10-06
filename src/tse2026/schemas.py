"""Schemas explícitos (PyArrow) dos datasets gerados.

SG_UF não é gravado dentro dos arquivos: é a coluna de partição Hive
(`SG_UF=SP/`), e os leitores (DuckDB, Polars, PyArrow, Pandas) a reconstroem.
"""

from __future__ import annotations

import pyarrow as pa

DICT = pa.dictionary(pa.int32(), pa.string())

VOTACAO_FIELDS: list[pa.Field] = [
    pa.field("ANO_ELEICAO", pa.int16(), nullable=False),
    pa.field("CD_PLEITO", pa.int32(), nullable=False),
    pa.field("CD_ELEICAO", pa.int32(), nullable=False),
    pa.field("NR_TURNO", pa.int8(), nullable=False),
    pa.field("DT_ELEICAO", pa.date32(), nullable=False),
    pa.field("CD_MUNICIPIO", pa.string(), nullable=False),  # código TSE, 5 dígitos com zeros à esquerda
    pa.field("CD_MUNICIPIO_IBGE", pa.int32()),
    pa.field("NM_MUNICIPIO", pa.string()),
    pa.field("NR_ZONA", pa.int32(), nullable=False),
    pa.field("NR_SECAO", pa.int32(), nullable=False),
    pa.field("NR_LOCAL_VOTACAO", pa.int32()),
    pa.field("CD_CARGO", pa.int16(), nullable=False),
    pa.field("DS_CARGO", DICT),
    pa.field("TP_CARGO", DICT),  # majoritario | proporcional | consulta
    pa.field("TP_VOTO", DICT, nullable=False),  # nominal | legenda | branco | nulo | cargoSemCandidato
    pa.field("NR_CANDIDATO", pa.int32()),  # número do votável; em voto de legenda = número do partido
    pa.field("NR_PARTIDO", pa.int16()),
    pa.field("SG_PARTIDO", DICT),
    pa.field("NM_CANDIDATO", pa.string()),
    pa.field("NM_URNA_CANDIDATO", pa.string()),
    pa.field("SQ_CANDIDATO", pa.int64()),
    # Destinação do voto segundo o resultado oficial ("dvt" do -u.json): Válido, Válido (legenda),
    # Anulado sub judice... Nulo quando o votável não consta do resultado oficial (ex.: nulo técnico).
    pa.field("DS_DESTINACAO_VOTO", DICT),
    pa.field("QT_VOTOS", pa.int32(), nullable=False),
    # Totais da seção para o cargo (repetidos em cada linha do cargo).
    pa.field("QT_APTOS", pa.int32()),
    pa.field("QT_COMPARECIMENTO", pa.int32()),
    pa.field("QT_ABSTENCOES", pa.int32()),
    pa.field("QT_VOTOS_NOMINAIS", pa.int32()),
    pa.field("QT_VOTOS_LEGENDA", pa.int32()),
    pa.field("QT_BRANCOS", pa.int32()),
    pa.field("QT_NULOS", pa.int32()),
]
VOTACAO_SCHEMA = pa.schema(VOTACAO_FIELDS)

# Chave natural (verificada na validação): uma linha por seção × cargo × tipo de voto × votável.
# TP_VOTO entra na chave porque brancos/nulos não têm número e porque um voto de legenda
# (número do partido) é distinto de um voto nominal.
VOTACAO_KEY = (
    "ANO_ELEICAO", "NR_TURNO", "SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO",
    "CD_CARGO", "TP_VOTO", "NR_CANDIDATO",
)
VOTACAO_SORT = ("CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_CARGO", "TP_VOTO", "NR_CANDIDATO")

SECOES_FIELDS: list[pa.Field] = [
    pa.field("ANO_ELEICAO", pa.int16(), nullable=False),
    pa.field("CD_PLEITO", pa.int32(), nullable=False),
    pa.field("NR_TURNO", pa.int8(), nullable=False),
    pa.field("CD_MUNICIPIO", pa.string(), nullable=False),
    pa.field("CD_MUNICIPIO_IBGE", pa.int32()),
    pa.field("NM_MUNICIPIO", pa.string()),
    pa.field("NR_ZONA", pa.int32(), nullable=False),
    pa.field("NR_SECAO", pa.int32(), nullable=False),
    pa.field("CD_ELEICAO", pa.int32()),  # nulo quando a seção não tem BU
    pa.field("NR_LOCAL_VOTACAO", pa.int32()),
    pa.field("DS_STATUS_COLETA", DICT, nullable=False),  # parsed | skipped | error | pending ...
    pa.field("DS_MOTIVO_STATUS", pa.string()),
    pa.field("ST_AGREGADA", pa.bool_(), nullable=False),  # seção agregada a outra (sem BU próprio)
    pa.field("NR_SECAO_PRINCIPAL", pa.int32()),
    pa.field("NR_SECOES_AGREGADAS", pa.string()),
    pa.field("DS_SITUACAO_AUX", DICT),  # campo "st" do aux.json (ex.: Totalizada)
    pa.field("DS_SITUACAO_BU", DICT),  # campo "st" do hash escolhido (ex.: Totalizado)
    pa.field("QT_HASHES", pa.int16()),  # >1 indica BU reenviado/substituído
    pa.field("TP_URNA", DICT),  # secao | contingencia | reservaSecao | reservaEncerrandoSecao
    pa.field("TP_ARQUIVO", DICT),  # votacaoUE | votacaoRED | saMista... | saManual | saEletronica
    pa.field("TP_ORIGEM_BU", DICT),  # dadosSecao (urna) | dadosSA (Sistema de Apuração)
    pa.field("DS_MOTIVO_SA", pa.string()),
    pa.field("NR_JUNTA_APURADORA", pa.int32()),
    pa.field("NR_TURMA_APURADORA", pa.int32()),
    pa.field("NR_URNA_EFETIVADA", pa.int64()),
    pa.field("CD_CARGA_URNA", pa.string()),
    pa.field("DT_CARGA_URNA", pa.timestamp("s")),
    pa.field("DS_VERSAO_VOTACAO", pa.string()),
    pa.field("DT_ABERTURA", pa.timestamp("s")),
    pa.field("DT_ENCERRAMENTO", pa.timestamp("s")),
    pa.field("DT_EMISSAO_BU", pa.timestamp("s")),
    pa.field("DT_RECEBIMENTO", pa.timestamp("s")),
    pa.field("QT_APTOS", pa.int32()),
    pa.field("QT_COMPARECIMENTO", pa.int32()),
    pa.field("QT_ABSTENCOES", pa.int32()),
    pa.field("QT_COMPARECIMENTO_URNA", pa.int32()),
    pa.field("QT_HABILITACAO", pa.list_(pa.int32())),  # campo [2026] de semântica não documentada
    pa.field("BU_SHA256", pa.string()),
    pa.field("BU_URL", pa.string()),
]
SECOES_SCHEMA = pa.schema(SECOES_FIELDS)
SECOES_SORT = ("CD_MUNICIPIO", "NR_ZONA", "NR_SECAO", "CD_ELEICAO")
