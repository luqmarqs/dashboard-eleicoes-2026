"""Evolução digital × votação — candidaturas acompanhadas em Minas Gerais.

Subcomandos:
    historico   importa as observações históricas do monitoramento anterior (pasta relatorio-vic), com proveniência
    snapshot    snapshot atual pela Apify (perfis do Instagram e, opcionalmente, postagens desde --desde),
                com teto de gasto (--teto, em US$) por execução e acumulado; --teste roda 1 perfil
    carregar    grava no Supabase (perfis, observações, postagens, execuções) e gera o dev-data do dashboard

Universo: as 16 candidaturas do "painel" em config/entities.yml do monitoramento (todas deputado estadual MG),
ligadas à candidatura do TSE pelo número de urna + cargo + UF, com nome e partido conferidos.

Credencial: APIFY_TOKEN (ambiente) ou o .env da pasta do monitoramento (DIGITAL_FONTE). Nunca é impressa nem gravada.
Saídas: data/digital/mg/ (ignorado pelo git).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONTE = Path(os.environ.get("DIGITAL_FONTE", r"C:\Users\luqma\OneDrive\Documentos\relatorio-vic"))
OUT = ROOT / "data" / "digital" / "mg"
APIFY = "https://api.apify.com/v2"
ATOR_PERFIL = "apify~instagram-profile-scraper"
ATOR_POSTS = "apify~instagram-post-scraper"


def agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------------------------
# Histórico
# ---------------------------------------------------------------------------------------------

def cmd_historico(a: argparse.Namespace) -> int:
    import openpyxl
    import pandas as pd
    import yaml

    os.chdir(FONTE)
    ents = [e for e in yaml.safe_load(open("config/entities.yml", encoding="utf-8"))["entidades"] if e.get("papel") == "painel"]
    ig2name = {e["instagram"].lower(): e["nome_canonico"] for e in ents if e.get("instagram")}
    x2name = {e["x_handle"].lower(): e["nome_canonico"] for e in ents if e.get("x_handle")}
    rows: list[dict] = []

    def add(**k):
        base = dict(candidato_nome="", plataforma="", username="", perfil_id="", data_observacao="", origem_data="",
                    seguidores="", seguindo="", posts="", precisao="exata", fonte_arquivo="", fonte_tipo="")
        for c, v in k.items():
            base[c] = "" if v is None or (isinstance(v, float) and pd.isna(v)) else v
        if base["candidato_nome"]:  # só o universo do painel
            rows.append(base)

    f = "data/raw/apify_instagram_profile/sem_data/20260920T214907Z/serie_seguidores.csv"
    for r in pd.read_csv(f).itertuples():
        add(candidato_nome=ig2name.get(str(r.handle).lower(), ""), plataforma="instagram", username=r.handle,
            data_observacao=r.data_extracao, origem_data="campo:data_extracao", seguidores=int(r.seguidores),
            fonte_arquivo=f, fonte_tipo="serie_csv")
    f = "data/raw/apify_instagram_profile/2026-09-04/20260920T214907Z/instagram_perfis_snapshot_20260904.csv"
    for r in pd.read_csv(f).itertuples():
        add(candidato_nome=ig2name.get(r.handle.lower(), ""), plataforma="instagram", username=r.handle,
            data_observacao=r.data_coleta, origem_data="campo:data_coleta", seguidores=int(r.seguidores),
            fonte_arquivo=f, fonte_tipo="snapshot_csv")
    f = "Monitoramento MG 2026/2026-09-06/entregaveis/Relatorio_MG2026.xlsx"
    ws = openpyxl.load_workbook(f, read_only=True, data_only=True)["Resumo"]
    it = ws.iter_rows(values_only=True)
    hdr = list(next(it))
    ci = hdr.index("Seguidores 06/09")
    for r in it:
        if not r[0] or r[ci] is None:
            continue
        h = str(r[3]).lstrip("@")
        add(candidato_nome=ig2name.get(h.lower(), ""), plataforma="instagram", username=h, data_observacao="2026-09-06",
            origem_data="relatorio (coluna 'Seguidores 06/09')", seguidores=int(r[ci]), fonte_arquivo=f, fonte_tipo="planilha")
    for f in ["data/raw/apify_instagram_profile/2026-09-13/20260920T214907Z/instagram_seguidores_20260913.json",
              "data/raw/apify_instagram_profile/2026-09-20/20260921T001641Z/instagram_seguidores_2026-09-20.json"]:
        d = json.load(open(f, encoding="utf-8"))
        for h, v in d["seguidores"].items():
            add(candidato_nome=ig2name.get(h.lower(), ""), plataforma="instagram", username=h, data_observacao=d["data"],
                origem_data="campo:data", seguidores=v, fonte_arquivo=f, fonte_tipo="apify_profile_resumo")
    man = json.load(open("data/raw/apify_instagram_profile/2026-09-20/20260921T001641Z/raw_manifest.json", encoding="utf-8"))
    for f, dt, orig in [
        ("data/raw/apify_instagram_profile/2026-09-13/20260920T214907Z/apify_carol_profile_20260914.json",
         "2026-09-13T21:31:41-03:00", "campo:inicio (apify_carol_log_20260914.txt)"),
        ("data/raw/apify_instagram_profile/2026-09-20/20260921T001641Z/instagram_perfis_2026-09-20.json",
         man["iniciado_em"], "campo:iniciado_em (raw_manifest.json)")]:
        for x in json.load(open(f, encoding="utf-8")):
            add(candidato_nome=ig2name.get(x["username"].lower(), ""), plataforma="instagram", username=x["username"],
                perfil_id=x["id"], data_observacao=dt, origem_data=orig, seguidores=x.get("followersCount"),
                seguindo=x.get("followsCount"), posts=x.get("postsCount"), fonte_arquivo=f, fonte_tipo="apify_profile")
    # X: o próprio perfil do autor dentro das buscas de menções (só quando a pessoa postou na semana)
    f = "data/raw/apify_x_mentions/2026-09-04/20260920T214907Z/x_mencoes.csv"
    x = pd.read_csv(f)
    x["u"] = x.autor.astype(str).str.lstrip("@")
    for u, g in x[x.u.str.lower().isin(x2name)].groupby("u"):
        for v in sorted(g.seguidores_autor.dropna().unique()):
            add(candidato_nome=x2name[u.lower()], plataforma="x", username=u, data_observacao="2026-09-04",
                origem_data="pasta", seguidores=int(v), fonte_arquivo=f, fonte_tipo="apify_x_mencoes_autor")
    f = "data/raw/apify_x_mentions/2026-09-13/20260920T214907Z/x_mencoes_20260913.json"
    x = pd.DataFrame(json.load(open(f, encoding="utf-8")))
    for u, g in x[x["author.userName"].str.lower().isin(x2name)].groupby("author.userName"):
        for v in sorted(g["author.followers"].dropna().unique()):
            add(candidato_nome=x2name[u.lower()], plataforma="x", username=u, data_observacao="2026-09-13",
                origem_data="pasta", seguidores=int(v), fonte_arquivo=f, fonte_tipo="apify_x_mencoes_autor")
    f = "data/raw/apify_x_mentions/2026-09-20/20260921T001837Z/x_mencoes_2026-09-20.json"
    xm = json.load(open("data/raw/apify_x_mentions/2026-09-20/20260921T001837Z/raw_manifest.json", encoding="utf-8"))
    vistos: set = set()
    for t in json.load(open(f, encoding="utf-8")):
        au = t.get("author") or {}
        u = au.get("userName") or ""
        k = (u, au.get("followers"))
        if u.lower() in x2name and k not in vistos:
            vistos.add(k)
            add(candidato_nome=x2name[u.lower()], plataforma="x", username=u, perfil_id=au.get("id"),
                data_observacao=xm["iniciado_em"], origem_data="campo:iniciado_em (raw_manifest.json)",
                seguidores=au.get("followers"), seguindo=au.get("following"), posts=au.get("statusesCount"),
                fonte_arquivo=f, fonte_tipo="apify_x_mencoes_autor")

    # perfis do universo + vínculo com o TSE (número + cargo 7 + MG; nome e partido conferidos)
    tse = {r["numero"]: r for r in csv.DictReader(open(ROOT / "data/dashboard/mg/candidaturas.csv", encoding="utf-8"))
           if r["tipo"] == "nominal" and r["cd_cargo"] == "7"}
    from meta_ads.geo import norm  # normalização já usada no projeto
    perfis = []
    for e in ents:
        t = tse.get(str(e.get("numero_urna")))
        ok = t and norm(t["nm_urna"]).replace("DR ", "") .endswith(norm(e["nome_canonico"]).split()[-1]) \
            and norm(t["sg_partido"]) == norm(e.get("partido") or "")
        base = dict(candidato_nome=e["nome_canonico"], numero=e.get("numero_urna"), partido=e.get("partido"),
                    candidatura_id=t["id"] if ok else "", tse_nome=t["nm_urna"] if t else "",
                    status_vinculo="confirmado" if ok else "pendente",
                    evidencia=("número de urna + cargo (dep. estadual) + UF no TSE; nome e partido conferidos; "
                               "perfil em config/entities.yml do monitoramento") if ok else "sem correspondência única no TSE")
        if e.get("instagram"):
            perfis.append({**base, "plataforma": "instagram", "username": e["instagram"]})
        if e.get("x_handle"):
            perfis.append({**base, "plataforma": "x", "username": e["x_handle"]})
    OUT.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT / "observacoes_historicas.csv", index=False, encoding="utf-8")
    pd.DataFrame(perfis).to_csv(OUT / "perfis.csv", index=False, encoding="utf-8")
    print(f"observações históricas: {len(rows)} | perfis: {len(perfis)} "
          f"({sum(p['status_vinculo'] == 'confirmado' for p in perfis)} com vínculo confirmado no TSE)")
    return 0


# ---------------------------------------------------------------------------------------------
# Snapshot pela Apify (com teto)
# ---------------------------------------------------------------------------------------------

def token_apify() -> str:
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if not tok and (FONTE / ".env").exists():
        m = re.search(r"^APIFY_TOKEN=(\S+)", (FONTE / ".env").read_text(encoding="utf-8"), re.M)
        tok = m[1].strip("\"'") if m else ""
    if not tok:
        sys.exit("APIFY_TOKEN ausente")
    return tok


def api(tok: str, metodo: str, caminho: str, corpo: dict | None = None) -> dict:
    req = urllib.request.Request(f"{APIFY}{caminho}", method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        corpo_err = e.read()[:300].decode("utf-8", "ignore").replace(tok, "<token>")
        raise SystemExit(f"Apify HTTP {e.code} em {caminho.split('?')[0]}: {corpo_err}")


def gasto_acumulado() -> float:
    f = OUT / "execucoes.jsonl"
    if not f.exists():
        return 0.0
    return sum(float(json.loads(l).get("custo_usd") or 0) for l in f.read_text(encoding="utf-8").splitlines() if l.strip())


def rodar_ator(tok: str, ator: str, entrada: dict, teto_usd: float, rotulo: str) -> tuple[dict, list[dict]]:
    """Executa o Actor com teto de cobrança (maxTotalChargeUsd), espera terminar e devolve (run, itens)."""
    run = api(tok, "POST", f"/acts/{ator}/runs?maxTotalChargeUsd={teto_usd:.4f}", entrada)["data"]
    rid = run["id"]
    print(f"  {rotulo}: execução iniciada (teto US$ {teto_usd:.2f})")
    while run["status"] in ("READY", "RUNNING"):
        time.sleep(10)
        run = api(tok, "GET", f"/actor-runs/{rid}")["data"]
    # o custo (usageTotalUsd) é apurado alguns segundos depois do fim
    for _ in range(12):
        if float(run.get("usageTotalUsd") or 0) > 0 or not any((run.get("chargedEventCounts") or {}).values()):
            break
        time.sleep(5)
        run = api(tok, "GET", f"/actor-runs/{rid}")["data"]
    itens = api(tok, "GET", f"/datasets/{run['defaultDatasetId']}/items?clean=true&format=json") if run.get("defaultDatasetId") else []
    print(f"  {rotulo}: {run['status']} · {len(itens)} itens · custo informado US$ {run.get('usageTotalUsd') or 0:.4f} "
          f"· eventos {json.dumps(run.get('chargedEventCounts') or {})}")
    return run, itens


def registrar(exec_: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "execucoes.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(exec_, ensure_ascii=False) + "\n")


def cmd_snapshot(a: argparse.Namespace) -> int:
    tok = token_apify()
    perfis = list(csv.DictReader(open(OUT / "perfis.csv", encoding="utf-8")))
    users = sorted({p["username"] for p in perfis if p["plataforma"] == "instagram" and p["status_vinculo"] == "confirmado"},
                   key=str.lower)
    if a.teste:
        users = users[:1]
    gasto = gasto_acumulado()
    restante = a.teto - gasto
    print(f"perfis do Instagram: {len(users)} · gasto já registrado US$ {gasto:.4f} · teto US$ {a.teto:.2f} · restante US$ {restante:.2f}")
    if restante <= 0.05:
        sys.exit("teto atingido; nada a fazer")
    raw = OUT / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    eid = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ("_teste" if a.teste else "")

    # 1) perfis (um item por perfil)
    teto_perfis = min(restante, 0.05 if a.teste else 0.30)
    t0 = agora()
    run, itens = rodar_ator(tok, ATOR_PERFIL, {"usernames": users}, teto_perfis, "perfis")
    json.dump(itens, open(raw / f"{eid}_perfis.json", "w", encoding="utf-8"), ensure_ascii=False)
    obtidos = {str(i.get("username", "")).lower() for i in itens if i.get("followersCount") is not None}
    falhas = {u: next((i.get("error") or i.get("errorDescription") for i in itens
                       if str(i.get("username", i.get("inputUrl", ""))).lower().endswith(u.lower()) and i.get("error")), "sem item na resposta")
              for u in users if u.lower() not in obtidos}
    custo = float(run.get("usageTotalUsd") or 0)
    registrar(dict(id=f"{eid}_perfis", tipo="snapshot_apify", ator=ATOR_PERFIL, run_id=run["id"], iniciada_em=t0,
                   terminada_em=run.get("finishedAt"), status=run["status"], perfis_solicitados=len(users),
                   perfis_obtidos=len(obtidos), falhas=falhas, custo_usd=custo, custo_confirmado=True, teto_usd=teto_perfis,
                   arquivo=f"raw/{eid}_perfis.json"))
    restante -= custo

    # 2) postagens (orgânico) — só se pedido e houver orçamento
    if a.posts:
        limite = 3 if a.teste else a.limite_posts
        teto_posts = min(restante - 0.02, 0.05 if a.teste else restante - 0.02)
        if teto_posts <= 0.02:
            print("sem orçamento para postagens")
            return 0
        t0 = agora()
        entrada = {"username": users, "resultsLimit": limite, "onlyPostsNewerThan": a.desde, "dataDetailLevel": "basicData"}
        run, itens = rodar_ator(tok, ATOR_POSTS, entrada, teto_posts, "postagens")
        json.dump(itens, open(raw / f"{eid}_posts.json", "w", encoding="utf-8"), ensure_ascii=False)
        por_perfil: dict[str, int] = {}
        for i in itens:
            por_perfil[str(i.get("ownerUsername", "")).lower()] = por_perfil.get(str(i.get("ownerUsername", "")).lower(), 0) + 1
        registrar(dict(id=f"{eid}_posts", tipo="snapshot_apify_posts", ator=ATOR_POSTS, run_id=run["id"], iniciada_em=t0,
                       terminada_em=run.get("finishedAt"), status=run["status"], perfis_solicitados=len(users),
                       perfis_obtidos=len(por_perfil), falhas={u: "nenhuma postagem no período" for u in users if u.lower() not in por_perfil},
                       custo_usd=float(run.get("usageTotalUsd") or 0), custo_confirmado=True, teto_usd=teto_posts,
                       arquivo=f"raw/{eid}_posts.json", desde=a.desde, limite_por_perfil=limite,
                       atingiu_limite=[u for u, n in por_perfil.items() if n >= limite]))
    print(f"gasto total registrado: US$ {gasto_acumulado():.4f} de US$ {a.teto:.2f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("historico")
    s = sub.add_parser("snapshot")
    s.add_argument("--teto", type=float, default=10.0, help="teto acumulado em US$ (todas as execuções registradas)")
    s.add_argument("--teste", action="store_true")
    s.add_argument("--posts", action="store_true", help="coletar também as postagens (orgânico)")
    s.add_argument("--desde", default="2026-08-16")
    s.add_argument("--limite-posts", type=int, default=400)
    sub.add_parser("carregar")
    a = p.parse_args(argv)
    if a.cmd == "carregar":
        from digital_carga import carregar  # noqa: E402
        return carregar(OUT, ROOT)
    return {"historico": cmd_historico, "snapshot": cmd_snapshot}[a.cmd](a)


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT / "src"))
    sys.path.insert(0, str(ROOT / "scripts"))
    sys.exit(main())
