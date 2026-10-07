"""CLI: python -m meta_ads <comando>

    descobrir   busca as páginas das candidaturas alvo (eleitas + extras) e grava evidências em
                data/meta_ads/descoberta.csv (retomável)
    vincular    grava os vínculos no banco local a partir de descoberta.csv + config/meta_paginas_revisao.csv
    coletar     coleta os anúncios das páginas confirmadas (--completa desde o início da campanha; padrão:
                incremental com reconsulta dos últimos 14 dias); --retomar <id> continua uma execução
    status      cobertura e últimas execuções
    exportar    gera o JSON do dashboard (dev-data) e carrega no Supabase (--supabase)
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from .client import Cliente, MetaErro, TokenInvalido, carregar_token, sanear
from .coleta import alvos, coletar, descobrir, descobrir_no_relatorio, financiador_confere, novo_id_execucao, periodo_incremental, INICIO_CAMPANHA
from .geo import CadastroIbge
from .store import Banco

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "meta_ads"
DB = DATA / "meta_ads.sqlite"
DESCOBERTA = DATA / "descoberta.csv"
REVISAO = ROOT / "config" / "meta_paginas_revisao.csv"
UFS = ["SP", "MG", "RS"]
EXTRAS = [("RS", 5, 500)]  # Manuela (Senado/RS): não eleita, incluída a pedido


def banco() -> Banco:
    return Banco(DB, CadastroIbge.carregar(ROOT / "data" / "raw" / "externo" / "ibge_municipios_br.json"))


def cmd_descobrir(a: argparse.Namespace) -> int:
    cli = Cliente(carregar_token())
    lista = alvos(ROOT / "data" / "dashboard", a.ufs, EXTRAS)
    print(f"alvos: {len(lista)} candidaturas (eleitas em {', '.join(a.ufs)} + {len(EXTRAS)} extra)")
    linhas = descobrir(cli, lista, DESCOBERTA)
    conf = {r["candidatura_id"] for r in linhas if r["status_revisao"] == "confirmado"}
    rev = {r["candidatura_id"] for r in linhas if r["status_revisao"] == "a_revisar"} - conf
    print(f"com página confirmada: {len(conf)} | só a revisar: {len(rev)} | sem página: "
          f"{len({r['candidatura_id'] for r in linhas}) - len(conf) - len(rev)}")
    return 0


def cmd_vincular(a: argparse.Namespace) -> int:
    """Confirmados automáticos + decisões humanas (revisão sobrepõe a descoberta)."""
    linhas: dict[tuple[str, str], dict] = {}
    if DESCOBERTA.exists():
        for r in csv.DictReader(DESCOBERTA.open(encoding="utf-8")):
            if not r["page_id"]:
                continue
            if r["status_revisao"] == "confirmado":
                # revalida com a regra estrita (a evidência guarda o financiador declarado entre aspas)
                m = re.search(r"financiador declarado '(.*)' contém", r["evidencia"] or "")
                if not (m and financiador_confere(r["nm_candidato"], m[1])):
                    r = {**r, "status_revisao": "a_revisar", "natureza": "nao_confirmado"}
            linhas[(r["page_id"], r["candidatura_id"])] = r
    for z in sorted(ROOT.glob("FacebookAdLibraryReport_*.zip")):
        lista = alvos(ROOT / "data" / "dashboard", UFS, EXTRAS)
        achados = descobrir_no_relatorio(z, lista)
        for r in achados:
            k = (r["page_id"], str(r["candidatura_id"]))
            if k not in linhas or linhas[k]["status_revisao"] != "confirmado":
                linhas[k] = {kk: str(v) for kk, v in r.items()}
        print(f"relatório {z.name}: {len(achados)} vínculos confirmados por financiador declarado")
    if REVISAO.exists():
        for r in csv.DictReader(REVISAO.open(encoding="utf-8")):
            base = linhas.get((r["page_id"], r["candidatura_id"]), {})
            linhas[(r["page_id"], r["candidatura_id"])] = {**base, **{k: v for k, v in r.items() if v}}
    # sugestões "a_revisar" da descoberta ficam só no CSV (revisão humana); no banco entram os confirmados e as
    # decisões da revisão manual (inclusive "a_revisar" marcadas para coleta, exibidas como não confirmadas)
    linhas = {k: r for k, r in linhas.items() if r["status_revisao"] == "confirmado" or str(r.get("coletar") or "0") == "1"
              or r["status_revisao"] == "rejeitado"}
    b = banco()
    with b.con:
        b.con.execute("DELETE FROM vinculos")
    b.gravar_vinculos({
        "page_id": r["page_id"], "page_name": r.get("page_name"), "uf": r["uf"], "candidatura_id": int(r["candidatura_id"]),
        "cd_cargo": int(r["cd_cargo"]) if r.get("cd_cargo") else None, "numero": int(r["numero"]) if r.get("numero") else None,
        "nm_urna": r.get("nm_urna"), "natureza": r["natureza"] or "nao_confirmado", "evidencia": r.get("evidencia"),
        "status_revisao": r["status_revisao"], "coletar": int(r.get("coletar") or 0),
    } for r in linhas.values())
    n = b.con.execute("SELECT status_revisao, COUNT(*) FROM vinculos GROUP BY 1").fetchall()
    print("vínculos:", {k: v for k, v in n})
    return 0


def cmd_coletar(a: argparse.Namespace) -> int:
    b = banco()
    cli = Cliente(carregar_token())
    paginas = b.paginas_para_coletar()
    if a.retomar:
        eid = a.retomar
        pmin = b.con.execute("SELECT periodo_min FROM execucoes WHERE id=?", (eid,)).fetchone()[0]
    else:
        modo = "completa" if a.completa else "incremental"
        eid = novo_id_execucao(modo)
        pmin = INICIO_CAMPANHA if a.completa else periodo_incremental(b)
    print(f"execução {eid}: {len(paginas)} páginas confirmadas, veiculação desde {pmin} (API {cli.versao})")
    try:
        st = coletar(cli, b, paginas, eid, "retomada" if a.retomar else ("completa" if a.completa else "incremental"), pmin)
    except TokenInvalido as e:
        print(f"token inválido ou expirado: {sanear(e)}. Gere outro e rode de novo com --retomar {eid}")
        return 2
    except MetaErro as e:
        print(f"falha: {sanear(e)}. Rode de novo com --retomar {eid}")
        return 1
    print(f"execução {eid}: {st}")
    return cmd_status(a)


def cmd_status(a: argparse.Namespace) -> int:
    b = banco()
    for r in b.con.execute("SELECT * FROM execucoes ORDER BY iniciada_em DESC LIMIT 5"):
        print(dict(r))
    print("anúncios:", b.con.execute("SELECT COUNT(*) FROM anuncios").fetchone()[0],
          "| observações:", b.con.execute("SELECT COUNT(*) FROM observacoes").fetchone()[0])
    return 0


def cmd_exportar(a: argparse.Namespace) -> int:
    from .exportar import exportar_dev, carregar_supabase
    b = banco()
    exportar_dev(b, ROOT)
    if a.supabase:
        carregar_supabase(b, ROOT)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m meta_ads", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("descobrir")
    d.add_argument("--ufs", nargs="+", default=UFS)
    sub.add_parser("vincular")
    c = sub.add_parser("coletar")
    c.add_argument("--completa", action="store_true")
    c.add_argument("--retomar")
    sub.add_parser("status")
    e = sub.add_parser("exportar")
    e.add_argument("--supabase", action="store_true")
    a = p.parse_args(argv)
    return {"descobrir": cmd_descobrir, "vincular": cmd_vincular, "coletar": cmd_coletar, "status": cmd_status,
            "exportar": cmd_exportar}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
