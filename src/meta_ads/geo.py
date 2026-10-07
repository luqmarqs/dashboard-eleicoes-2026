"""Localidades da segmentação (`target_locations`) e da entrega (`delivery_by_region`).

Formato observado nas respostas reais (v26.0, BR), sem ID geográfico da Meta:
    regions        "Minas Gerais, Brasil" | "São Paulo (state), Brasil"
    CITY           "Varginha, MG, Brasil" | "Várzea Da Palma, Brazil, MG, Brasil"
    MUNICIPALITY   "Belo Horizonte, MG, Brasil"
    NEIGHBORHOOD   "Boa Esperança, Belo Horizonte, MG, Brasil" (com cidade) | "Barreiro, MG, Brasil" (sem cidade)
    zips           "31510, Brasil" (prefixo de CEP de 5 dígitos)
    countries      "Brasil"

Regras de correspondência:
- município: nome + UF comparados ao cadastro do IBGE após normalização (acentos, caixa, hífen, apóstrofo);
  só vale correspondência única dentro da UF. Código IBGE é a chave; o código TSE vem do cadastro do
  dashboard (cd_ibge -> cd_municipio). Nunca se usa código TSE como IBGE.
- bairro: guarda-se o nome original e, se o texto trouxer a cidade, o município validado; o bairro em si
  não é ligado a bairros do TSE (não há chave comum validada).
- CEP: guarda-se o prefixo; não é convertido em município (sem tabela oficial de faixas no projeto).
"""

from __future__ import annotations

import json
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path

UF_NOME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará",
    "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso",
    "MS": "Mato Grosso do Sul", "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná",
    "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo",
    "SE": "Sergipe", "TO": "Tocantins",
}


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.upper().replace("-", " ").replace("'", " ").replace("’", " ").replace("`", " ")
    return " ".join(s.split())


_UF_POR_NOME = {norm(n): uf for uf, n in UF_NOME.items()}


def uf_de_regiao(nome: str | None) -> str | None:
    """'São Paulo (state)' / 'Minas Gerais' -> 'SP' / 'MG'."""
    n = norm((nome or "").replace("(state)", "").replace("(estado)", ""))
    return _UF_POR_NOME.get(n)


@dataclass
class Localidade:
    nome_original: str
    tipo: str
    excluida: bool
    num_obfuscated: int | None
    nivel: str  # pais | uf | municipio | bairro | cep | desconhecida
    uf: str | None = None
    municipio_nome: str | None = None
    cd_ibge: int | None = None
    bairro_nome: str | None = None
    cep_prefixo: str | None = None
    status: str = "nao_resolvida"  # validada | ambigua | nao_encontrada | sem_municipio | nao_aplicavel
    metodo: str | None = None


class CadastroIbge:
    """Municípios do Brasil (API de localidades do IBGE), indexados por (UF, nome normalizado)."""

    URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"

    def __init__(self, municipios: list[tuple[int, str, str]]):
        self.por_chave: dict[tuple[str, str], list[int]] = {}
        self.nome: dict[int, str] = {}
        for cd, nome, uf in municipios:
            self.por_chave.setdefault((uf, norm(nome)), []).append(cd)
            self.nome[cd] = nome

    @classmethod
    def carregar(cls, cache: Path) -> "CadastroIbge":
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(cls.URL, timeout=120) as r:
                cache.write_bytes(r.read())
        bruto = cache.read_bytes()
        if bruto[:2] == bytes([0x1F, 0x8B]):  # a API do IBGE responde em gzip
            import gzip
            bruto = gzip.decompress(bruto)
        dados = json.loads(bruto.decode("utf-8"))
        out = []
        for m in dados:
            uf = (((m.get("microrregiao") or {}).get("mesorregiao") or {}).get("UF") or {}).get("sigla") \
                or ((((m.get("regiao-imediata") or {}).get("regiao-intermediaria") or {}).get("UF")) or {}).get("sigla")
            out.append((int(m["id"]), m["nome"], uf))
        return cls(out)

    def resolver(self, nome: str, uf: str) -> tuple[int | None, str]:
        cds = self.por_chave.get((uf, norm(nome)), [])
        if len(cds) == 1:
            return cds[0], "validada"
        return None, "ambigua" if cds else "nao_encontrada"


def interpretar(loc: dict, ibge: CadastroIbge | None) -> Localidade:
    """Converte um item de `target_locations` em Localidade, sem inventar atributos ausentes."""
    nome = str(loc.get("name") or "")
    tipo = str(loc.get("type") or "")
    excl = bool(loc.get("excluded"))
    obf = loc.get("num_obfuscated")
    base = dict(nome_original=nome, tipo=tipo, excluida=excl, num_obfuscated=int(obf) if obf is not None else None)
    partes = [p.strip() for p in nome.split(",") if p.strip()]
    if partes and norm(partes[-1]) in ("BRASIL", "BRAZIL"):
        partes = partes[:-1]
    partes = [p for p in partes if norm(p) not in ("BRASIL", "BRAZIL")]
    t = tipo.upper()

    if t == "COUNTRIES" or (not partes and t != "ZIPS"):
        return Localidade(**base, nivel="pais" if t == "COUNTRIES" else "desconhecida",
                          status="nao_aplicavel" if t == "COUNTRIES" else "nao_resolvida")
    if t == "REGIONS":
        uf = uf_de_regiao(partes[0])
        return Localidade(**base, nivel="uf", uf=uf, status="validada" if uf else "nao_encontrada",
                          metodo="nome da UF" if uf else None)
    if t == "ZIPS":
        cep = norm(partes[0]) if partes else ""
        return Localidade(**base, nivel="cep", cep_prefixo=cep if cep.isdigit() else None, status="nao_aplicavel")
    uf = partes[-1].upper() if len(partes) >= 2 and len(partes[-1]) == 2 and partes[-1].upper() in UF_NOME else None
    if t in ("CITY", "MUNICIPALITY"):
        if not uf:
            return Localidade(**base, nivel="municipio", municipio_nome=partes[0], status="nao_resolvida")
        cd, st = ibge.resolver(partes[0], uf) if ibge else (None, "nao_resolvida")
        return Localidade(**base, nivel="municipio", uf=uf, municipio_nome=partes[0], cd_ibge=cd, status=st,
                          metodo="nome + UF no cadastro IBGE" if cd else None)
    if t == "NEIGHBORHOOD":
        cidade = partes[1] if uf and len(partes) == 3 else None
        loc_ = Localidade(**base, nivel="bairro", uf=uf, bairro_nome=partes[0], municipio_nome=cidade,
                          status="sem_municipio")
        if cidade and ibge:
            cd, st = ibge.resolver(cidade, uf)
            loc_.cd_ibge, loc_.status = cd, st
            loc_.metodo = "cidade do bairro: nome + UF no cadastro IBGE" if cd else None
        return loc_
    return Localidade(**base, nivel="desconhecida", status="nao_resolvida")
