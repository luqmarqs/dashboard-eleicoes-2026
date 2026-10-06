"""Download assíncrono e reiniciável dos arquivos por seção (aux + BU) e dos resultados oficiais."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeRemainingColumn

from .exceptions import FetchError, NotFoundError, TooManyNotFoundError
from .fetcher import Fetcher, FileIds
from .log import get_logger
from .manifest import SectionFilter, StateDB
from .discovery import Pleito, parse_municipios

log = get_logger("download")

COMMIT_EVERY = 200
SITUACAO_TOTALIZADO = "totalizado"
# Situações de hash que indicam BU descartado (nunca usado).
SITUACOES_DESCARTE = ("exclu", "cancel", "substitu", "rejeit", "anulad", "invalid")
# Tipos de arquivo de BU no aux.json, em ordem de preferência: "bu" (urna eletrônica) e
# "busa" (BU gerado pelo Sistema de Apuração, ex.: votação manual/cédulas). Mesmo formato ASN.1.
TIPOS_BU = ("bu", "busa")
# Eleições municipais (ex.: Conselheiro Distrital de Fernando de Noronha) não publicam -u.json por UF.
TIPO_ELEICAO_MUNICIPAL = "3"


@dataclass
class DownloadReport:
    total: int = 0
    downloaded: int = 0
    reused: int = 0
    skipped: int = 0
    errors: int = 0
    error_samples: list[str] = field(default_factory=list)


def choose_ballot(aux: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    """Escolhe, no aux.json, o conjunto de arquivos (hash) que vale para a seção.

    Retorna (entrada_hash, arquivo_bu, motivo_se_nenhum).
    Preferência: hash com situação "Totalizado"; havendo mais de um, o mais recente.
    """
    hashes = aux.get("hashes") or []
    if not hashes:
        return None, None, f"aux sem hashes (situação: {aux.get('st')})"

    def bu_of(h: dict[str, Any]) -> dict[str, Any] | None:
        arqs = {a.get("tp"): a for a in h.get("arq", [])}
        return next((arqs[t] for t in TIPOS_BU if t in arqs), None)

    def when(h: dict[str, Any]) -> str:
        dr, hr = h.get("dr", ""), h.get("hr", "")
        return f"{dr[6:10]}{dr[3:5]}{dr[0:2]}{hr}"

    def status(h: dict[str, Any]) -> str:
        return str(h.get("st", "")).lower()

    com_bu = [h for h in hashes if bu_of(h)]
    totalizados = [h for h in com_bu if status(h) == SITUACAO_TOTALIZADO]
    # Sem BU totalizado (ex.: seção "Recebida"), vale o BU mais recente que não foi descartado.
    # A situação fica registrada em ds_situacao_hash / DS_SITUACAO_BU.
    validos = totalizados or [h for h in com_bu if not any(m in status(h) for m in SITUACOES_DESCARTE)]
    if validos:
        h = max(validos, key=when)
        return h, bu_of(h), None
    situacoes = sorted({str(h.get("st")) for h in hashes})
    return None, None, f"nenhum BU utilizável (situação aux: {aux.get('st')}; hashes: {', '.join(situacoes)})"


class SectionDownloader:
    def __init__(self, fetcher: Fetcher, state: StateDB, pleito: Pleito, refresh_aux: bool = False) -> None:
        self.fetcher = fetcher
        self.state = state
        self.pleito = pleito
        self.refresh_aux = refresh_aux
        self.report = DownloadReport()
        self._since_commit = 0

    def pending(self, flt: SectionFilter, retry_errors: bool = True) -> list[Any]:
        """Seções a processar: pendentes, com erro e as "sem BU" (o BU pode ter sido publicado depois).

        Seções agregadas (sem BU próprio por definição) nunca entram na fila.
        """
        statuses = ["pending", "error", "skipped"] if retry_errors else ["pending", "skipped"]
        return [
            r for r in self.state.iter_sections(flt, statuses)
            if r["status"] != "skipped" or (r["NR_SECAO_PRINCIPAL"] is None and r["metadata_url"])
        ]

    async def run(self, flt: SectionFilter, retry_errors: bool = True) -> DownloadReport:
        reset = self.state.reset_stale_downloading(flt)
        if reset:
            log.info("seções interrompidas voltaram para pending", extra={"n": reset})
        rows = self.pending(flt, retry_errors)
        self.report.total = len(rows)
        if not rows:
            return self.report

        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=self.fetcher.client.settings.max_concurrency * 4)
        n_workers = self.fetcher.client.settings.max_concurrency
        self.state.begin()
        with _progress() as progress:
            task = progress.add_task("seções", total=len(rows))

            async def worker() -> None:
                while True:
                    row = await queue.get()
                    try:
                        if row is None:
                            return
                        await self._one(row)
                        progress.advance(task)
                    finally:
                        queue.task_done()

            workers = [asyncio.create_task(worker()) for _ in range(n_workers)]
            try:
                for row in rows:
                    # Propaga falhas fatais (ex.: disjuntor de 404) assim que acontecem.
                    for w in workers:
                        if w.done() and w.exception():
                            raise w.exception()  # type: ignore[misc]
                    await queue.put(row)
                for _ in workers:
                    await queue.put(None)
                await asyncio.gather(*workers)
            except BaseException:
                for w in workers:
                    w.cancel()
                await asyncio.gather(*workers, return_exceptions=True)
                raise
            finally:
                self.state.commit()
        return self.report

    def _key(self, row: Any) -> tuple[Any, ...]:
        return (row["CD_PLEITO"], row["SG_UF"], row["CD_MUNICIPIO"], row["NR_ZONA"], row["NR_SECAO"])

    def _tick(self) -> None:
        self._since_commit += 1
        if self._since_commit >= COMMIT_EVERY:
            self.state.commit()
            self.state.begin()
            self._since_commit = 0

    async def _one(self, row: Any) -> None:
        key = self._key(row)
        uf, mun, zona, secao = row["SG_UF"], row["CD_MUNICIPIO"], row["NR_ZONA"], row["NR_SECAO"]
        ids = FileIds(uf=uf, municipio=mun, zona=zona, secao=secao)
        self.state.update_section(key, status="downloading", error=None)
        try:
            aux_file = await self.fetcher.fetch(
                row["metadata_url"], category="sections", tipo="aux", ids=ids,
                expect_json=True, refresh=self.refresh_aux,
            )
            aux = json.loads(aux_file.read_bytes())
            hash_entry, bu, reason = choose_ballot(aux)
            common = {
                "ds_situacao_aux": aux.get("st"),
                "qt_hashes": len(aux.get("hashes") or []),
            }
            if bu is None or hash_entry is None:
                self.state.update_section(key, status="skipped", status_reason=reason, **common)
                self.report.skipped += 1
                return
            ballot_url = self.fetcher.endpoints.secao_arquivo(
                self.pleito.cd_pleito, uf, mun, zona, secao, hash_entry["hash"], bu["nm"]
            )
            bu_file = await self.fetcher.fetch(ballot_url, category="ballots", tipo="bu", ids=ids)
            self.state.update_section(
                key,
                status="downloaded",
                status_reason=None,
                bu_hash=hash_entry["hash"],
                ds_situacao_hash=hash_entry.get("st"),
                ballot_url=ballot_url,
                ballot_filename=self.fetcher.store.relative(bu_file.path),
                **common,
            )
            if bu_file.reused and aux_file.reused:
                self.report.reused += 1
            else:
                self.report.downloaded += 1
        except TooManyNotFoundError:
            self.state.update_section(key, status="pending")
            raise
        except (FetchError, json.JSONDecodeError) as exc:
            self.state.update_section(key, status="error", error=str(exc))
            self.report.errors += 1
            if len(self.report.error_samples) < 20:
                self.report.error_samples.append(str(exc))
            log.warning("erro na seção", extra={"uf": uf, "mun": mun, "zona": zona, "secao": secao, "erro": str(exc)})
        finally:
            self._tick()


def _progress() -> Progress:
    return Progress(
        TextColumn("[bold]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeRemainingColumn(),
        transient=False,
    )


# ---------------------------------------------------------------------------
# Resultados oficiais agregados (arquivos "unificados" -u.json), usados para
# nomes de candidatos/partidos e para a validação.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OfficialTarget:
    eleicao: int
    cargo: int
    uf: str
    municipio: str | None = None
    zona: int | None = None

    @property
    def nivel(self) -> str:
        if self.zona is not None:
            return "zona"
        if self.municipio:
            return "municipio"
        return "br" if self.uf == "BR" else "uf"


def municipios_por_eleicao(fetcher: Fetcher, pleito: Pleito) -> dict[int, set[tuple[str, str]]]:
    """Municípios de cada eleição, a partir dos mun-cm.json já baixados na descoberta."""
    out: dict[int, set[tuple[str, str]]] = {}
    for e in pleito.eleicoes:
        hit = fetcher.cached(fetcher.endpoints.municipios(e.cd), "metadata")
        if hit is None:
            continue
        out[e.cd] = {(m.uf, m.cd) for m in parse_municipios(json.loads(hit.read_bytes()))}
    return out


async def download_official(
    fetcher: Fetcher,
    state: StateDB,
    pleito: Pleito,
    flt: SectionFilter,
    levels: Iterable[str] = ("br", "uf", "municipio"),
    refresh: bool = False,
) -> dict[str, int]:
    """Baixa os resultados oficiais (-u.json) por eleição × cargo × abrangência."""
    levels = set(levels)
    rows = list(state.iter_sections(flt))
    ufs = sorted({r["SG_UF"] for r in rows})
    muns = sorted({(r["SG_UF"], r["CD_MUNICIPIO"]) for r in rows})
    zonas = sorted({(r["SG_UF"], r["CD_MUNICIPIO"], r["NR_ZONA"]) for r in rows})
    mun_ele = municipios_por_eleicao(fetcher, pleito)
    stats = {"ok": 0, "not_found": 0, "error": 0}

    async def get(t: OfficialTarget) -> bool:
        uf_path = "br" if t.uf == "BR" else t.uf
        url = fetcher.endpoints.unificado(t.eleicao, uf_path, t.cargo, t.municipio, t.zona)
        try:
            await fetcher.fetch(
                url, category="metadata", tipo=f"u-{t.nivel}",
                ids=FileIds(uf=t.uf, municipio=t.municipio, zona=t.zona),
                expect_json=True, optional=True, refresh=refresh,
            )
            stats["ok"] += 1
            return True
        except NotFoundError:
            stats["not_found"] += 1
            return False
        except FetchError as exc:
            stats["error"] += 1
            log.warning("falha ao baixar resultado oficial", extra={"url": url, "erro": str(exc)})
            return False

    state.begin()
    try:
        for e in pleito.eleicoes:
            members = mun_ele.get(e.cd, set())
            for cargo in e.cargos:
                if "br" in levels and "br" in e.abrangencias and not flt.uf:
                    await get(OfficialTarget(e.cd, cargo.cd, "BR"))
                ufs_ok = [uf for uf in ufs if any(m[0] == uf for m in members)]
                found = await asyncio.gather(*(get(OfficialTarget(e.cd, cargo.cd, uf)) for uf in ufs_ok))
                ufs_with = {uf for uf, ok in zip(ufs_ok, found) if ok}
                if e.tp == TIPO_ELEICAO_MUNICIPAL:
                    ufs_with = set(ufs_ok)
                if "municipio" in levels:
                    targets = [OfficialTarget(e.cd, cargo.cd, uf, mun) for uf, mun in muns
                               if uf in ufs_with and (uf, mun) in members]
                    await asyncio.gather(*(get(t) for t in targets))
                if "zona" in levels:
                    targets = [OfficialTarget(e.cd, cargo.cd, uf, mun, z) for uf, mun, z in zonas
                               if uf in ufs_with and (uf, mun) in members]
                    await asyncio.gather(*(get(t) for t in targets))
                state.commit()
                state.begin()
    finally:
        state.commit()
    return stats
