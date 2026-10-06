"""Linha de comando do pipeline: descoberta -> download -> parse -> validação."""

from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

import duckdb
from rich.console import Console
from rich.table import Table

from . import __version__
from .client import HttpClient
from .config import Settings, get_settings
from .discovery import Pleito, discover, load_pleito, pleito_path
from .download import SectionDownloader, download_official
from .endpoints import Endpoints
from .exceptions import TSE2026Error
from .fetcher import Fetcher
from .log import get_logger, setup_logging
from .manifest import SectionFilter, StateDB
from .parser import consolidate_uf, run_parse
from .storage import RawStore
from .validation import run_validation

console = Console()
log = get_logger("cli")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Coletor TSE 2026 por seção eleitoral")
    steps = p.add_argument_group("etapas")
    steps.add_argument("--discover", action="store_true", help="descobre pleito e inventário de seções")
    steps.add_argument("--download", action="store_true", help="baixa aux.json e BU de cada seção")
    steps.add_argument("--official", action="store_true", help="baixa resultados oficiais (-u.json)")
    steps.add_argument("--parse", action="store_true", help="RAW -> staging -> Parquet consolidado")
    steps.add_argument("--validate", action="store_true", help="compara com os resultados oficiais")
    steps.add_argument("--all", action="store_true", help="todas as etapas")

    scope = p.add_argument_group("escopo")
    scope.add_argument("--uf", help="sigla da UF (ex.: SP; ZZ = exterior)")
    scope.add_argument("--municipio", help="código TSE do município (ex.: 71072)")
    scope.add_argument("--zona", type=int)
    scope.add_argument("--secao", type=int)
    scope.add_argument("--turno", type=int, default=1, choices=(1, 2))
    scope.add_argument("--limit", type=int, help="processa no máximo N seções (testes)")

    opts = p.add_argument_group("opções")
    opts.add_argument("--dry-run", action="store_true", help="mostra o que seria baixado, sem baixar")
    opts.add_argument("--reparse", action="store_true", help="refaz o parse de todas as zonas do escopo")
    opts.add_argument("--refresh-aux", action="store_true", help="baixa novamente os aux.json")
    opts.add_argument("--refresh-official", action="store_true", help="baixa novamente os -u.json")
    opts.add_argument("--official-levels", default="br,uf,municipio",
                      help="níveis dos resultados oficiais: br,uf,municipio,zona")
    opts.add_argument("--no-retry-errors", action="store_true", help="não tenta de novo seções com erro")
    opts.add_argument("--concurrency", type=int, help="sobrescreve MAX_CONCURRENCY")
    opts.add_argument("--workers", type=int, help="processos para o parse (padrão: CPUs-1)")
    return p


class Pipeline:
    def __init__(self, settings: Settings, args: argparse.Namespace) -> None:
        self.settings = settings
        self.args = args
        self.state = StateDB(settings.state_db)
        self.store = RawStore(settings.raw_dir)
        self.endpoints = Endpoints(settings, settings.ciclo)

    # -- utilitários ----------------------------------------------------------
    def pleito(self) -> Pleito:
        return load_pleito(self.settings, self.args.turno)

    def filter(self, pleito: Pleito) -> SectionFilter:
        a = self.args
        return SectionFilter(pleito.cd_pleito, a.uf, a.municipio, a.zona, a.secao)

    async def _with_fetcher(self, fn: Any) -> Any:
        async with HttpClient(self.settings) as client:
            fetcher = Fetcher(client, self.store, self.state, self.endpoints)
            result = await fn(fetcher)
            log.info("estatísticas HTTP", extra=client.stats)
            return result

    # -- etapas ---------------------------------------------------------------
    def discover(self) -> None:
        ufs = [self.args.uf] if self.args.uf else None
        summary = asyncio.run(self._with_fetcher(
            lambda f: discover(f, self.settings, self.state, self.args.turno, ufs)
        ))
        p = summary.pleito
        console.print(f"[bold]Eleição:[/] {p.ano} — " + "; ".join(f"{e.cd} {e.nome}" for e in p.eleicoes))
        console.print(f"[bold]Pleito:[/] {p.cd_pleito}")
        console.print(f"[bold]Turno:[/] {p.turno}")
        console.print(f"[bold]Data:[/] {p.data}")
        console.print(f"[bold]UFs disponíveis:[/] {len(summary.ufs)} ({', '.join(summary.ufs)})")
        if summary.ufs_sem_secoes:
            console.print(f"[yellow]UFs sem arquivo de seções:[/] {', '.join(summary.ufs_sem_secoes)}")
        console.print(f"[bold]Número de municípios:[/] {summary.n_municipios:,}")
        console.print(f"[bold]Número de zonas:[/] {summary.n_zonas:,}")
        console.print(f"[bold]Número de seções:[/] {summary.n_secoes:,} "
                      f"(das quais {summary.n_secoes_agregadas:,} agregadas, sem BU próprio)")
        cargos = ", ".join(f"{c.cd}={c.ds}" for c in p.cargos().values())
        console.print(f"[bold]Cargos:[/] {cargos}")
        self.export_manifests()

    def download(self) -> None:
        pleito = self.pleito()
        flt = self.filter(pleito)
        if self.args.dry_run:
            self._dry_run(pleito, flt)
            return

        async def go(fetcher: Fetcher) -> Any:
            dl = SectionDownloader(fetcher, self.state, pleito, refresh_aux=self.args.refresh_aux)
            if self.args.limit:
                original = dl.pending
                dl.pending = lambda f, r=True: original(f, r)[: self.args.limit]  # type: ignore[method-assign]
            return await dl.run(flt, retry_errors=not self.args.no_retry_errors)

        report = asyncio.run(self._with_fetcher(go))
        console.print(
            f"Download: {report.total:,} seções na fila | baixadas {report.downloaded:,} | "
            f"reaproveitadas {report.reused:,} | sem BU {report.skipped:,} | erros {report.errors:,}"
        )
        for e in report.error_samples[:10]:
            console.print(f"  [red]erro[/] {e}")
        self.export_manifests()

    def official(self) -> None:
        pleito = self.pleito()
        flt = self.filter(pleito)
        levels = [x.strip() for x in self.args.official_levels.split(",") if x.strip()]
        if self.args.dry_run:
            console.print(f"[dry-run] baixaria resultados oficiais nos níveis {levels}")
            return
        stats = asyncio.run(self._with_fetcher(
            lambda f: download_official(f, self.state, pleito, flt, levels, refresh=self.args.refresh_official)
        ))
        console.print(f"Resultados oficiais: {stats}")
        self.export_manifests()

    def parse(self) -> None:
        pleito = self.pleito()
        flt = self.filter(pleito)
        report = run_parse(self.settings, self.state, pleito, flt, reparse=self.args.reparse,
                           workers=self.args.workers)
        console.print(
            f"Parse: {report.zones:,} zonas | seções ok {report.sections_parsed:,} | "
            f"erros {report.sections_error:,} | linhas {report.rows:,}"
        )
        for e in report.errors[:10]:
            console.print(f"  [red]erro[/] {e}")
        ufs = sorted(report.ufs) if report.ufs else ([flt.uf.upper()] if flt.uf else [])
        for uf in ufs:
            counts = consolidate_uf(self.settings, pleito.turno, uf)
            console.print(f"Consolidado {uf}: {counts}")
        self.export_manifests()

    def validate(self) -> bool:
        pleito = self.pleito()
        flt = self.filter(pleito)
        report = run_validation(self.settings, self.state, pleito, flt)
        con = duckdb.connect()
        rows = con.execute(
            f"SELECT * FROM read_parquet('{report.summary_path.as_posix()}') ORDER BY ALL"
        ).fetchall()
        con.close()
        table = Table("nível", "tipo", "status", "comparações", "Σ|diferença|")
        for r in rows:
            style = "green" if r[2] == "OK" else ("red" if r[2] == "DIFFERENCE" else "yellow")
            table.add_row(r[0], r[1], f"[{style}]{r[2]}[/]", f"{r[3]:,}", f"{r[4] or 0:,}")
        console.print(table)
        console.print(f"Chaves duplicadas: {report.duplicates}")
        console.print(f"Divergências em {report.differences_path}")
        self.export_manifests()
        self.write_metadata(pleito, report.counts, report.duplicates)
        return report.ok

    def _dry_run(self, pleito: Pleito, flt: SectionFilter) -> None:
        rows = [r for r in self.state.iter_sections(flt, ["pending", "error"])]
        if self.args.limit:
            rows = rows[: self.args.limit]
        counts = self.state.count_by_status(flt)
        console.print(f"[dry-run] status atual no escopo: {counts}")
        console.print(f"[dry-run] {len(rows):,} seções seriam baixadas "
                      f"(~{2 * len(rows):,} requisições: aux.json + BU)")
        for r in rows[:10]:
            console.print(f"  {r['metadata_url']}")
        if len(rows) > 10:
            console.print(f"  ... e mais {len(rows) - 10:,}")

    # -- saídas ---------------------------------------------------------------
    def export_manifests(self) -> None:
        self.state.export_parquet(self.settings.manifests_dir)

    def write_metadata(self, pleito: Pleito, validation_counts: dict[str, int], duplicates: int) -> None:
        s = self.settings
        con = duckdb.connect()
        glob = (s.dataset_dir / "SG_UF=*" / f"turno{pleito.turno}_*.parquet").as_posix()
        try:
            n_reg, n_ufs, n_mun, n_zon, n_sec = con.execute(
                f"""SELECT COUNT(*), COUNT(DISTINCT SG_UF), COUNT(DISTINCT SG_UF || CD_MUNICIPIO),
                           COUNT(DISTINCT SG_UF || '-' || NR_ZONA),
                           COUNT(DISTINCT SG_UF || CD_MUNICIPIO || '-' || NR_ZONA || '-' || NR_SECAO)
                    FROM read_parquet('{glob}', hive_partitioning = true)"""
            ).fetchone()
        except duckdb.IOException:
            n_reg = n_ufs = n_mun = n_zon = n_sec = 0
        finally:
            con.close()
        status = self.state.count_by_status(SectionFilter(pleito.cd_pleito))
        n_err_files = self.state.conn.execute("SELECT COUNT(*) FROM files WHERE status = 'error'").fetchone()[0]
        meta = {
            "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "versao_coletor": __version__,
            "commit_git": _git_commit(),
            "fonte": {
                "base_url": f"{s.base_url}/{s.ambiente}",
                "configuracao": self.endpoints.ele_config(),
                "descricao": "Boletins de Urna (BU, ASN.1) do arquivo-urna e resultados unificados (-u.json) do TSE",
            },
            "eleicao": {"ano": pleito.ano, "eleicoes": [{"cd": e.cd, "nome": e.nome} for e in pleito.eleicoes]},
            "pleito": pleito.cd_pleito,
            "turno": pleito.turno,
            "data_eleicao": pleito.data,
            "dataset": {
                "numero_ufs": n_ufs, "numero_municipios": n_mun, "numero_zonas": n_zon,
                "numero_secoes_com_bu": n_sec, "numero_registros": n_reg,
            },
            "inventario_secoes_por_status": status,
            "arquivos_com_erro": n_err_files,
            "validacao": {"por_status": validation_counts, "chaves_duplicadas": duplicates},
        }
        s.processed_dir.mkdir(parents=True, exist_ok=True)
        (s.processed_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                                                       encoding="utf-8")


def _git_commit() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main(argv: list[str] | None = None, default_steps: tuple[str, ...] = ()) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    if args.uf:
        args.uf = args.uf.upper()
    if args.municipio:
        args.municipio = args.municipio.zfill(5)
    settings = get_settings()
    if args.concurrency:
        settings = settings.model_copy(update={"max_concurrency": args.concurrency})
    setup_logging(settings.data_dir / "logs")

    steps = [s for s in ("discover", "download", "official", "parse", "validate") if getattr(args, s)]
    if args.all:
        steps = ["discover", "download", "official", "parse", "validate"]
    if not steps:
        steps = list(default_steps)
    if not steps:
        build_parser().print_help()
        return 2

    pipe = Pipeline(settings, args)
    try:
        if "discover" not in steps and not pleito_path(settings, args.turno).exists():
            console.print("[yellow]Pleito ainda não descoberto; executando a descoberta primeiro.[/]")
            steps.insert(0, "discover")
        ok = True
        for step in steps:
            console.rule(step)
            result = getattr(pipe, step)()
            if step == "validate":
                ok = bool(result)
        return 0 if ok else 1
    except TSE2026Error as exc:
        console.print(f"[red]Erro:[/] {exc}")
        return 1
    except KeyboardInterrupt:
        console.print("[yellow]Interrompido. O progresso foi salvo; rode o mesmo comando para continuar.[/]")
        return 130
    finally:
        pipe.state.close()


if __name__ == "__main__":
    sys.exit(main())
