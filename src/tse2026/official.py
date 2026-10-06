"""Leitura dos resultados oficiais "unificados" (-u.json) do TSE.

Usados para (1) nomes de candidatos e siglas de partidos e (2) a validação.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .manifest import StateDB


@dataclass(frozen=True)
class Candidato:
    numero: int
    nome: str | None
    nome_urna: str | None
    sq_candidato: int | None
    nr_partido: int | None
    sg_partido: str | None
    destinacao_voto: str | None  # campo "dvt" (ex.: Válido, Anulado, Nulo técnico...)
    votos: int | None  # campo "vap" (votos apurados)


@dataclass(frozen=True)
class Partido:
    numero: int
    sigla: str
    destinacao_voto: str | None  # "dvt" (ex.: Válido (legenda))
    votos_legenda: int | None  # "tvtl" (legenda válida)
    votos_legenda_anulados: int | None  # "tval" (legenda de partido com destinação anulada)
    votos_nominais_e_legenda: int | None  # "tvtn"

    @property
    def votos_legenda_apurados(self) -> int | None:
        """Votos de legenda do partido conforme sua destinação oficial."""
        if (self.destinacao_voto or "").startswith("Válido"):
            return self.votos_legenda
        return self.votos_legenda_anulados


@dataclass
class Unificado:
    """Conteúdo relevante de um arquivo -u.json (uma abrangência × um cargo)."""

    cd_eleicao: int
    cd_cargo: int
    tpabr: str
    cdabr: str
    totais_secoes: dict[str, Any]
    totais_eleitorado: dict[str, Any]
    totais_votos: dict[str, Any]
    candidatos: list[Candidato]
    partidos: list[Partido]
    gerado_em: str | None


def _int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_unificado(data: dict[str, Any]) -> Unificado:
    cargos = data.get("carg") or []
    if len(cargos) != 1:
        raise ValueError(f"esperado 1 cargo no -u.json, encontrado {len(cargos)}")
    carg = cargos[0]
    candidatos: list[Candidato] = []
    partidos: list[Partido] = []
    for agr in carg.get("agr", []):
        for par in agr.get("par", []):
            nr_par = _int(par.get("n"))
            if nr_par is not None:
                partidos.append(
                    Partido(nr_par, par.get("sg"), par.get("dvt"), _int(par.get("tvtl")), _int(par.get("tval")),
                            _int(par.get("tvtn")))
                )
            for c in par.get("cand", []):
                candidatos.append(
                    Candidato(
                        numero=int(c["n"]),
                        nome=c.get("nm"),
                        nome_urna=c.get("nmu"),
                        sq_candidato=_int(c.get("sqcand")),
                        nr_partido=nr_par,
                        sg_partido=par.get("sg"),
                        destinacao_voto=c.get("dvt"),
                        votos=_int(c.get("vap")),
                    )
                )
    return Unificado(
        cd_eleicao=int(data["ele"]),
        cd_cargo=int(carg["cd"]),
        tpabr=data.get("tpabr", ""),
        cdabr=data.get("cdabr", ""),
        totais_secoes=data.get("s") or {},
        totais_eleitorado=data.get("e") or {},
        totais_votos=data.get("v") or {},
        candidatos=candidatos,
        partidos=partidos,
        gerado_em=f"{data.get('dg')} {data.get('hg')}",
    )


_URL_IDS = re.compile(r"-c(\d{4})-e(\d{6})-u\.json$")


@dataclass(frozen=True)
class OfficialFile:
    tipo: str  # u-br | u-uf | u-municipio | u-zona
    uf: str | None
    municipio: str | None
    zona: int | None
    path: Path
    url: str

    @property
    def eleicao_cargo(self) -> tuple[int, int]:
        m = _URL_IDS.search(self.url)
        if not m:
            raise ValueError(f"URL de -u.json inesperada: {self.url}")
        return int(m.group(2)), int(m.group(1))


def iter_official_files(state: StateDB, raw_dir: Path, tipos: tuple[str, ...]) -> Iterator[OfficialFile]:
    marks = ", ".join("?" for _ in tipos)
    rows = state.conn.execute(
        f"SELECT url, tipo_arquivo, uf, municipio, zona, filename FROM files "
        f"WHERE tipo_arquivo IN ({marks}) AND status IN ('downloaded', 'parsed', 'validated')",
        tipos,
    )
    for r in rows:
        yield OfficialFile(r["tipo_arquivo"], r["uf"], r["municipio"], r["zona"], raw_dir / r["filename"], r["url"])


def load_unificado(path: Path) -> Unificado:
    return parse_unificado(json.loads(path.read_bytes()))


@dataclass
class CandidateIndex:
    """Índice (eleição, cargo, UF, número) -> candidato; e número de partido -> sigla."""

    candidatos: dict[tuple[int, int, str, int], Candidato]
    candidatos_br: dict[tuple[int, int, int], Candidato]
    partidos: dict[int, str]
    legendas: dict[tuple[int, int, str, int], str | None]

    def destinacao_legenda(self, eleicao: int, cargo: int, uf: str, nr_partido: int | None) -> str | None:
        if nr_partido is None:
            return None
        return self.legendas.get((eleicao, cargo, uf, nr_partido))

    def candidato(self, eleicao: int, cargo: int, uf: str, numero: int) -> Candidato | None:
        return self.candidatos.get((eleicao, cargo, uf, numero)) or self.candidatos_br.get((eleicao, cargo, numero))

    def sigla(self, nr_partido: int | None) -> str | None:
        return self.partidos.get(nr_partido) if nr_partido is not None else None


def build_candidate_index(state: StateDB, raw_dir: Path) -> CandidateIndex:
    cand: dict[tuple[int, int, str, int], Candidato] = {}
    cand_br: dict[tuple[int, int, int], Candidato] = {}
    partidos: dict[int, str] = {}
    legendas: dict[tuple[int, int, str, int], str | None] = {}
    files = list(iter_official_files(state, raw_dir, ("u-br", "u-uf")))
    covered = {(*f.eleicao_cargo, (f.uf or "").upper()) for f in files if f.tipo == "u-uf"}
    # Eleições municipais (ex.: Conselheiro Distrital de Noronha) só têm arquivos por município.
    files += [
        f for f in iter_official_files(state, raw_dir, ("u-municipio",))
        if (*f.eleicao_cargo, (f.uf or "").upper()) not in covered
    ]
    for f in files:
        u = load_unificado(f.path)
        for p in u.partidos:
            if p.sigla:
                partidos.setdefault(p.numero, p.sigla)
            if f.tipo != "u-br":
                legendas[(u.cd_eleicao, u.cd_cargo, (f.uf or "").upper(), p.numero)] = p.destinacao_voto
        for c in u.candidatos:
            if f.tipo == "u-br":
                cand_br[(u.cd_eleicao, u.cd_cargo, c.numero)] = c
            else:
                cand[(u.cd_eleicao, u.cd_cargo, (f.uf or "").upper(), c.numero)] = c
    return CandidateIndex(cand, cand_br, partidos, legendas)
