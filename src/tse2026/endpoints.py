"""Único lugar onde as URLs do TSE são montadas.

Padrões verificados em out/2026 contra resultados.tse.jus.br (ver docs/DISCOVERY.md):

    <base>/<amb>/comum/config/ele-c.json                                    configuração geral (pleitos/eleições)
    <base>/<amb>/<ciclo>/<ele>/config/mun-e<ele6>-cm.json                    municípios e zonas (EA12)
    <base>/<amb>/<ciclo>/arquivo-urna/<pleito>/config/<uf>/<uf>-p<pleito6>-cs.json   seções por UF
    <base>/<amb>/<ciclo>/arquivo-urna/<pleito>/dados/<uf>/<mun5>/<zona4>/<secao4>/
        p<pleito6>-<uf>-m<mun5>-z<zona4>-s<secao4>-aux.json                  arquivos da urna de uma seção
        <hash>/<arquivo>                                                     BU/RDV/log da seção
    <base>/<amb>/<ciclo>/<ele>/dados/<uf>/<uf>[<mun5>][-z<zona4>]-c<cargo4>-e<ele6>-u.json   resultado "unificado"
    <base>/<amb>/<ciclo>/<ele>/dados/<uf>/<uf>-e<ele6>-ab.json               acompanhamento (abrangência)
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings


def _p(value: int | str, width: int) -> str:
    return str(int(value)).zfill(width)


@dataclass(frozen=True)
class Endpoints:
    settings: Settings
    ciclo: str

    @property
    def root(self) -> str:
        return f"{self.settings.base_url}/{self.settings.ambiente}"

    def ele_config(self) -> str:
        return f"{self.root}/comum/config/ele-c.json"

    def municipios(self, eleicao: int) -> str:
        return f"{self.root}/{self.ciclo}/{eleicao}/config/mun-e{_p(eleicao, 6)}-cm.json"

    def secoes_uf(self, pleito: int, uf: str) -> str:
        uf = uf.lower()
        return f"{self.root}/{self.ciclo}/arquivo-urna/{pleito}/config/{uf}/{uf}-p{_p(pleito, 6)}-cs.json"

    def secao_dir(self, pleito: int, uf: str, municipio: str, zona: int, secao: int) -> str:
        return (
            f"{self.root}/{self.ciclo}/arquivo-urna/{pleito}/dados/{uf.lower()}/"
            f"{_p(municipio, 5)}/{_p(zona, 4)}/{_p(secao, 4)}"
        )

    def secao_aux(self, pleito: int, uf: str, municipio: str, zona: int, secao: int) -> str:
        uf = uf.lower()
        name = f"p{_p(pleito, 6)}-{uf}-m{_p(municipio, 5)}-z{_p(zona, 4)}-s{_p(secao, 4)}-aux.json"
        return f"{self.secao_dir(pleito, uf, municipio, zona, secao)}/{name}"

    def secao_arquivo(
        self, pleito: int, uf: str, municipio: str, zona: int, secao: int, hash_: str, arquivo: str
    ) -> str:
        return f"{self.secao_dir(pleito, uf, municipio, zona, secao)}/{hash_}/{arquivo}"

    def unificado(
        self,
        eleicao: int,
        uf: str,
        cargo: int,
        municipio: str | None = None,
        zona: int | None = None,
    ) -> str:
        uf = uf.lower()
        mun = _p(municipio, 5) if municipio else ""
        zon = f"-z{_p(zona, 4)}" if zona is not None else ""
        name = f"{uf}{mun}{zon}-c{_p(cargo, 4)}-e{_p(eleicao, 6)}-u.json"
        return f"{self.root}/{self.ciclo}/{eleicao}/dados/{uf}/{name}"

    def acompanhamento(self, eleicao: int, uf: str) -> str:
        uf = uf.lower()
        return f"{self.root}/{self.ciclo}/{eleicao}/dados/{uf}/{uf}-e{_p(eleicao, 6)}-ab.json"

    def relative_path(self, url: str) -> str:
        """Caminho relativo à raiz do ambiente, usado para espelhar a URL no disco."""
        prefix = self.root + "/"
        if not url.startswith(prefix):
            raise ValueError(f"URL fora do ambiente configurado: {url}")
        return url[len(prefix):]
