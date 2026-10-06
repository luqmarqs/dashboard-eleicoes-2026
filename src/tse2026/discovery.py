"""Descoberta automática do pleito e inventário de municípios/zonas/seções."""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .endpoints import Endpoints
from .exceptions import DiscoveryError, NotFoundError
from .fetcher import Fetcher, FileIds
from .log import get_logger
from .manifest import SectionFilter, StateDB

log = get_logger("discovery")

# Tipos de eleição observados no ele-c.json (campo "tp"): 8 = federal, 1 = estadual,
# 3 = municipal ordinária, 2/4 = suplementar, 7 = consulta popular.
TIPOS_ELEICAO_GERAL = {"1", "8"}


@dataclass
class Cargo:
    cd: int
    ds: str
    tp: str  # "1" majoritário, "2" proporcional, "3" consulta


@dataclass
class Eleicao:
    cd: int
    nome: str
    turno: int
    tp: str
    cd_turno2: int | None
    abrangencias: list[str]
    cargos: list[Cargo]


@dataclass
class Pleito:
    ano: int
    ciclo: str
    cd_pleito: int
    turno: int
    data: str  # ISO yyyy-mm-dd
    eleicoes: list[Eleicao] = field(default_factory=list)
    gerado_em_tse: str | None = None

    def cargos(self) -> dict[int, Cargo]:
        return {c.cd: c for e in self.eleicoes for c in e.cargos}

    def eleicao_do_cargo(self) -> dict[int, int]:
        return {c.cd: e.cd for e in self.eleicoes for c in e.cargos}

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Pleito":
        eleicoes = [
            Eleicao(**{**e, "cargos": [Cargo(**c) for c in e["cargos"]]}) for e in d.pop("eleicoes")
        ]
        return cls(**d, eleicoes=eleicoes)


def _br_date(value: str) -> str:
    return datetime.strptime(value, "%d/%m/%Y").date().isoformat()


def select_pleito(ele_c: dict[str, Any], ano: int, turno: int) -> Pleito:
    """Escolhe, no ele-c.json, o pleito das eleições gerais ordinárias de `ano`/`turno`."""
    ciclo = f"ele{ano}"
    found: list[Pleito] = []
    for pl in ele_c.get("pl", []):
        if pl.get("c") != ciclo:
            continue
        eleicoes = [
            Eleicao(
                cd=int(e["cd"]),
                nome=e["nm"],
                turno=int(e["t"]),
                tp=str(e["tp"]),
                cd_turno2=int(e["cdt2"]) if e.get("cdt2") else None,
                abrangencias=[a["cd"] for a in e.get("abr", [])],
                cargos=sorted(
                    {
                        int(c["cd"]): Cargo(int(c["cd"]), c["ds"].strip(), str(c["tp"]))
                        for a in e.get("abr", [])
                        for c in a.get("cp", [])
                    }.values(),
                    key=lambda c: c.cd,
                ),
            )
            for e in pl.get("e", [])
        ]
        gerais = [e for e in eleicoes if e.tp in TIPOS_ELEICAO_GERAL and e.turno == turno]
        if gerais:
            found.append(
                Pleito(
                    ano=ano,
                    ciclo=ciclo,
                    cd_pleito=int(pl["cd"]),
                    turno=turno,
                    data=_br_date(pl["dt"]),
                    eleicoes=eleicoes,
                    gerado_em_tse=f"{ele_c.get('dg')} {ele_c.get('hg')}",
                )
            )
    if not found:
        raise DiscoveryError(f"nenhum pleito de eleições gerais {ano} turno {turno} no ele-c.json")
    if len(found) > 1:
        raise DiscoveryError(f"mais de um pleito candidato: {[p.cd_pleito for p in found]}")
    return found[0]


@dataclass
class Municipio:
    uf: str
    cd: str
    cd_ibge: int | None
    nome: str
    capital: bool
    zonas: list[int]


def parse_municipios(cm: dict[str, Any]) -> list[Municipio]:
    out = []
    for abr in cm.get("abr", []):
        for m in abr.get("mu", []):
            out.append(
                Municipio(
                    uf=abr["cd"].upper(),
                    cd=m["cd"].zfill(5),
                    cd_ibge=int(m["cdi"]) if m.get("cdi") else None,
                    nome=m["nm"],
                    capital=m.get("c") == "s",
                    zonas=[int(z) for z in m.get("z", [])],
                )
            )
    return out


def _dt_recebimento(sec: dict[str, Any]) -> str | None:
    if not sec.get("da"):
        return None
    d = datetime.strptime(f"{sec['da']} {sec.get('ha', '00:00:00')}", "%d/%m/%Y %H:%M:%S")
    return d.isoformat()


def parse_secoes(
    cs: dict[str, Any], pleito: int, municipios: dict[tuple[str, str], Municipio], endpoints: Endpoints
) -> list[dict[str, Any]]:
    """Converte o `<uf>-p<pleito>-cs.json` em linhas do inventário de seções."""
    rows = []
    for abr in cs.get("abr", []):
        uf = abr["cd"].upper()
        for m in abr.get("mu", []):
            cd_mun = m["cd"].zfill(5)
            mun = municipios.get((uf, cd_mun))
            for z in m.get("zon", []):
                zona = int(z["cd"])
                for s in z.get("sec", []):
                    secao = int(s["ns"])
                    principal = int(s["nsp"]) if s.get("nsp") else None
                    row = {
                        "CD_PLEITO": pleito,
                        "SG_UF": uf,
                        "CD_MUNICIPIO": cd_mun,
                        "CD_MUNICIPIO_IBGE": mun.cd_ibge if mun else None,
                        "NM_MUNICIPIO": m.get("nm") or (mun.nome if mun else None),
                        "NR_ZONA": zona,
                        "NR_SECAO": secao,
                        "NR_SECAO_PRINCIPAL": principal,
                        "NR_SECOES_AGREGADAS": ",".join(str(int(x)) for x in s.get("nsa", [])) or None,
                        "DT_RECEBIMENTO": _dt_recebimento(s),
                        "metadata_url": None if principal else endpoints.secao_aux(pleito, uf, cd_mun, zona, secao),
                    }
                    if principal:
                        row["status"] = "skipped"
                        row["status_reason"] = f"agregada à seção {principal}"
                    rows.append(row)
    return rows


@dataclass
class DiscoverySummary:
    pleito: Pleito
    ufs: list[str]
    n_municipios: int
    n_zonas: int
    n_secoes: int
    n_secoes_agregadas: int
    ufs_sem_secoes: list[str]


async def discover(
    fetcher: Fetcher,
    settings: Settings,
    state: StateDB,
    turno: int = 1,
    ufs: list[str] | None = None,
) -> DiscoverySummary:
    ele_c = (
        await fetcher.fetch(
            fetcher.endpoints.ele_config(), category="metadata", tipo="ele-c", expect_json=True, refresh=True
        )
    ).path
    pleito = select_pleito(json.loads(ele_c.read_bytes()), settings.ano_eleicao, turno)
    log.info("pleito identificado", extra={"pleito": pleito.cd_pleito, "data": pleito.data, "turno": turno})

    municipios: dict[tuple[str, str], Municipio] = {}
    for e in pleito.eleicoes:
        try:
            f = await fetcher.fetch(
                fetcher.endpoints.municipios(e.cd), category="metadata", tipo="mun-cm",
                expect_json=True, optional=True, refresh=True,
            )
        except NotFoundError:
            log.warning("sem arquivo de municípios para a eleição", extra={"eleicao": e.cd})
            continue
        for m in parse_municipios(json.loads(f.read_bytes())):
            municipios.setdefault((m.uf, m.cd), m)

    all_ufs = sorted({uf for uf, _ in municipios})
    wanted = [u.upper() for u in ufs] if ufs else all_ufs

    async def fetch_cs(uf: str) -> tuple[str, list[dict[str, Any]]]:
        try:
            f = await fetcher.fetch(
                fetcher.endpoints.secoes_uf(pleito.cd_pleito, uf), category="metadata", tipo="secoes-cs",
                ids=FileIds(uf=uf), expect_json=True, optional=True, refresh=True,
            )
        except NotFoundError:
            return uf, []
        return uf, parse_secoes(json.loads(f.read_bytes()), pleito.cd_pleito, municipios, fetcher.endpoints)

    results = await asyncio.gather(*(fetch_cs(uf) for uf in wanted))
    ufs_sem = [uf for uf, rows in results if not rows]
    rows = [r for _, rs in results for r in rs]
    state.upsert_inventory(rows)
    state.commit()

    settings.manifests_dir.mkdir(parents=True, exist_ok=True)
    pleito_path(settings, turno).write_text(pleito.to_json(), encoding="utf-8")
    write_municipios(settings, pleito, list(municipios.values()))

    return DiscoverySummary(
        pleito=pleito,
        ufs=[uf for uf in wanted if uf not in ufs_sem],
        n_municipios=len({(r["SG_UF"], r["CD_MUNICIPIO"]) for r in rows}),
        n_zonas=len({(r["SG_UF"], r["NR_ZONA"]) for r in rows}),
        n_secoes=len(rows),
        n_secoes_agregadas=sum(1 for r in rows if r["NR_SECAO_PRINCIPAL"]),
        ufs_sem_secoes=ufs_sem,
    )


def pleito_path(settings: Settings, turno: int) -> Path:
    return settings.manifests_dir / f"pleito_t{turno}.json"


def load_pleito(settings: Settings, turno: int) -> Pleito:
    path = pleito_path(settings, turno)
    if not path.exists():
        raise DiscoveryError(f"{path} não existe; rode a descoberta primeiro (--discover)")
    return Pleito.from_dict(json.loads(path.read_text(encoding="utf-8")))


def write_municipios(settings: Settings, pleito: Pleito, municipios: list[Municipio]) -> Path:
    import pyarrow as pa
    import pyarrow.parquet as pq

    path = settings.manifests_dir / f"municipios_t{pleito.turno}.parquet"
    table = pa.table(
        {
            "SG_UF": [m.uf for m in municipios],
            "CD_MUNICIPIO": [m.cd for m in municipios],
            "CD_MUNICIPIO_IBGE": pa.array([m.cd_ibge for m in municipios], pa.int32()),
            "NM_MUNICIPIO": [m.nome for m in municipios],
            "ST_CAPITAL": [m.capital for m in municipios],
            "NR_ZONAS": [",".join(str(z) for z in m.zonas) for m in municipios],
        }
    )
    pq.write_table(table, path, compression="zstd")
    return path


def inventory_filter(pleito: Pleito, uf: str | None = None, municipio: str | None = None,
                     zona: int | None = None, secao: int | None = None) -> SectionFilter:
    return SectionFilter(pleito=pleito.cd_pleito, uf=uf, municipio=municipio, zona=zona, secao=secao)
