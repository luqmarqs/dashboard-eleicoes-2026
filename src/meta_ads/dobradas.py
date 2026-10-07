"""Dobradas pagas: anúncios pagos por uma campanha que citam outra candidatura (nome + número de urna).

Fontes:
    - anúncios das páginas coletadas (candidaturas eleitas);
    - busca por menções (search_terms) para candidaturas escolhidas, que traz anúncios de qualquer página.

Para cada (anúncio, candidatura citada) registra-se:
    cita_nome      nome de urna (ou variante informada) no texto do anúncio
    cita_numero    número de urna como número isolado no texto (aceita "5️⃣0️⃣0️⃣"; ignora "R$ 500", "500 mil")
    pagador        candidatura cujo CNPJ de campanha é o financiador declarado (nome completo no TSE após "2026")
    cnpjs_texto    CNPJs escritos no texto; cnpj_financiador = CNPJ que aparece no próprio financiador declarado

Uma dobrada CONFIRMADA exige nome e número da candidatura citada e pagador identificado, diferente dela.
O gasto do anúncio é do pagador; não é somado ao da candidatura citada.
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .client import Cliente, MetaErro, TokenInvalido, sanear
from .coleta import BASE_PARAMS, CAMPOS, INICIO_CAMPANHA
from .geo import norm
from .store import Banco

SCHEMA = """
CREATE TABLE IF NOT EXISTS buscas_mencoes (
  candidatura_id INTEGER NOT NULL, termo TEXT NOT NULL, ad_id TEXT NOT NULL,
  PRIMARY KEY (candidatura_id, termo, ad_id)
);
CREATE TABLE IF NOT EXISTS mencoes (
  ad_id TEXT NOT NULL, candidatura_id INTEGER NOT NULL,          -- candidatura citada
  pagador_candidatura_id INTEGER,                                -- candidatura do financiador declarado (se identificada)
  cita_nome INTEGER NOT NULL, cita_numero INTEGER NOT NULL,
  cnpjs_texto TEXT, cnpj_financiador TEXT, confirmada INTEGER NOT NULL,
  PRIMARY KEY (ad_id, candidatura_id)
);
"""

RE_CNPJ = re.compile(r"(?<!\d)(\d{2})\.?(\d{3})\.?(\d{3})\s*/?\s*(\d{4})\s*-?\s*(\d{2})(?!\d)")
CARGO_FIM = r"(?: (?:DEPUTAD|SENADOR|GOVERNADOR|VICE|PRESIDENTE|CNPJ|N |\d)|$)"
_ENTRE_2026_E_CARGO = re.compile(r"2026 (.+?)(?= (?:DEPUTAD\w*|SENADOR\w*|GOVERNADOR\w*|VICE\w*|PRESIDENTE|CNPJ)\b| \d|$)")


def cnpjs(texto: str | None) -> list[str]:
    return sorted({"".join(m.groups()) for m in RE_CNPJ.finditer(texto or "")})


def texto_anuncio(r: Any) -> str:
    """Texto do criativo (corpo, títulos, descrições, legendas), normalizado; dígitos em emoji viram dígitos."""
    partes: list[str] = []
    for c in ("textos", "titulos_link", "descricoes_link", "legendas_link"):
        v = r[c]
        if v:
            partes += [str(x) for x in json.loads(v) if x]
    bruto = " ".join(partes)
    return bruto


def normaliza_numeros(t: str) -> str:
    """norm() já remove o seletor de emoji e o keycap; junta dígitos separados por eles ("5 0 0" não é juntado)."""
    return norm(t)


def tem_nome(texto_norm: str, nome_norm: str) -> bool:
    """Nome como palavras inteiras ("MANU" não casa com "MANUTENCAO")."""
    return bool(nome_norm) and re.search(rf"(?<![A-Z0-9]){re.escape(nome_norm)}(?![A-Z0-9])", texto_norm) is not None


def cita_numero(texto_norm: str, numero: int) -> bool:
    n = str(numero)
    for m in re.finditer(rf"(?<![\d.,]){n}(?![\d.,])", texto_norm):
        antes = texto_norm[max(0, m.start() - 4):m.start()]
        depois = texto_norm[m.end():m.end() + 8]
        if "R$" in antes or "R $" in antes or re.match(r"\s*(MIL|REAIS|PESSOAS|KM|%|ANOS|DIAS)\b", depois):
            continue
        return True
    return False


@dataclass
class Cand:
    id: int
    uf: str
    cargo: int
    numero: int
    nm_urna: str
    nm_candidato: str


def carregar_candidaturas(dir_dashboard: Path, ufs: Iterable[str]) -> list[Cand]:
    out = []
    for uf in ufs:
        for r in csv.DictReader((dir_dashboard / uf.lower() / "candidaturas.csv").open(encoding="utf-8")):
            if r["tipo"] == "nominal":
                out.append(Cand(int(r["id"]), uf.upper(), int(r["cd_cargo"]), int(r["numero"]), r["nm_urna"], r["nm_candidato"]))
    return out


class IndicePagador:
    """Financiador declarado -> candidatura (CNPJ de campanha "2026 <NOME COMPLETO> <cargo>")."""

    def __init__(self, cands: list[Cand]):
        self.por_nome: dict[str, list[Cand]] = defaultdict(list)
        for c in cands:
            self.por_nome[norm(c.nm_candidato)].append(c)

    def identificar(self, byline: str | None) -> Cand | None:
        nb = norm(byline)
        if "2026" not in nb:
            return None
        for m in _ENTRE_2026_E_CARGO.finditer(nb):
            achados = self.por_nome.get(m[1].strip(), [])
            if len(achados) == 1:
                return achados[0]
        return None


def coletar_mencoes(cli: Cliente, banco: Banco, alvo: Cand, termos: list[str], execucao_id: str, log=print) -> int:
    """Busca anúncios (de qualquer página) que citam a candidatura e grava anúncios completos + termo da busca."""
    banco.con.executescript(SCHEMA)
    total = 0
    for termo in termos:
        params = dict(BASE_PARAMS, search_terms=termo[:100], search_type="KEYWORD_EXACT_PHRASE",
                      ad_delivery_date_min=INICIO_CAMPANHA, fields=CAMPOS)
        n = 0
        completo = False
        try:
            for dados, after in cli.paginar(params, limit=250):
                with banco.con:
                    for ad in dados:
                        banco.gravar_anuncio(ad, execucao_id, cli.versao, cli.token)
                        banco.con.execute("INSERT OR IGNORE INTO buscas_mencoes VALUES (?,?,?)", (alvo.id, termo, str(ad["id"])))
                n += len(dados)
                completo = after is None
        except TokenInvalido:
            raise
        except MetaErro as e:
            log(f"  busca '{termo}': {sanear(e)} (parcial: {n} anúncios)")
        log(f"  '{termo}': {n} anúncios{'' if completo else ' (busca incompleta)'}")
        total += n
    return total


def analisar(banco: Banco, cands: list[Cand], alvos_extra: dict[int, list[str]] | None = None) -> int:
    """Recalcula a tabela `mencoes` para todos os anúncios do banco.

    Candidaturas citáveis: todas as nominais das UFs (para achar dobradas entre quaisquer campanhas). Uma menção
    entra quando o anúncio traz o número de urna isolado E o nome de urna (ou variante em alvos_extra).
    """
    banco.con.executescript(SCHEMA)
    alvos_extra = alvos_extra or {}
    por_uf_num: dict[tuple[str, str], list[Cand]] = defaultdict(list)
    for c in cands:
        por_uf_num[(c.uf, str(c.numero))].append(c)
    indice = IndicePagador(cands)
    variantes = {c.id: [norm(c.nm_urna)] + [norm(v) for v in alvos_extra.get(c.id, [])] for c in cands}
    re_num = re.compile(r"(?<![\d.,])(\d{2,5})(?![\d.,])")
    ufs = {c.uf for c in cands}
    linhas = []
    for r in banco.con.execute("SELECT ad_id, bylines, textos, titulos_link, descricoes_link, legendas_link FROM anuncios"):
        bruto = texto_anuncio(r)
        if not bruto:
            continue
        t = norm(bruto)
        pag = indice.identificar(r["bylines"])
        cnpj_fin = ",".join(cnpjs(r["bylines"])) or None
        cnpj_txt = ",".join(cnpjs(bruto)) or None
        vistos: set[int] = set()
        for m in re_num.finditer(t):
            for uf in ufs:
                for c in por_uf_num.get((uf, m[1]), []):
                    if c.id in vistos or not any(tem_nome(t, v) for v in variantes[c.id]):
                        continue
                    if not cita_numero(t, c.numero):
                        continue
                    vistos.add(c.id)
                    confirmada = int(bool(pag) and pag.id != c.id)
                    linhas.append((r["ad_id"], c.id, pag.id if pag else None, 1, 1, cnpj_txt, cnpj_fin, confirmada))
        # menções só por nome (sem número), para as candidaturas com busca dedicada
        for cid in alvos_extra:
            if cid in vistos:
                continue
            if any(tem_nome(t, v) for v in variantes.get(cid, [])):
                linhas.append((r["ad_id"], cid, pag.id if pag else None, 1, 0, cnpj_txt, cnpj_fin, 0))
    with banco.con:
        banco.con.execute("DELETE FROM mencoes")
        banco.con.executemany("INSERT OR REPLACE INTO mencoes VALUES (?,?,?,?,?,?,?,?)", linhas)
    return len(linhas)
