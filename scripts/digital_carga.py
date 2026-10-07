"""Carga do painel "Evolução digital e votação" (MG): Supabase + dev-data.

Regras:
- observação = (perfil, instante/dia da medição, valor, fonte); a mesma medição vinda de arquivos diferentes vira uma
  linha só, com as proveniências juntas; medições de datas diferentes nunca se fundem;
- datas no fuso America/Sao_Paulo (um instante 2026-09-21T00:16Z é a noite de 20/09);
- ausência é nula (nunca zero); curtidas ocultas (valor negativo) ficam nulas.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

BRT = timezone(timedelta(hours=-3))  # America/Sao_Paulo (sem horário de verão desde 2019)


def _dia_e_instante(valor: str) -> tuple[str | None, str | None]:
    v = (valor or "").strip()
    if not v:
        return None, None
    if len(v) == 10:
        return v, None
    dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BRT)
    return dt.astimezone(BRT).date().isoformat(), dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def _int(v) -> int | None:
    if v in (None, ""):
        return None
    n = int(float(v))
    return n if n >= 0 else None


def montar(out: Path) -> dict:
    perfis_csv = list(csv.DictReader((out / "perfis.csv").open(encoding="utf-8")))
    chave_perfil = lambda plat, user: f"{plat}:{user.lower()}"
    perfis = {}
    for p in perfis_csv:
        k = chave_perfil(p["plataforma"], p["username"])
        url = f"https://www.instagram.com/{p['username']}" if p["plataforma"] == "instagram" else f"https://x.com/{p['username']}"
        perfis[k] = dict(perfil_key=k, plataforma=p["plataforma"], perfil_id=None, username=p["username"], url=url,
                         nome_publico=None, candidatura_id=int(p["candidatura_id"]) if p["candidatura_id"] else None,
                         uf="MG", status_vinculo=p["status_vinculo"], evidencia=p["evidencia"])

    obs: dict[str, dict] = {}

    def add_obs(perfil_key, dia, instante, origem, seg, sgd, posts, fonte, arquivo, status="ok", execucao=None):
        if perfil_key not in perfis:
            return
        chave = f"{perfil_key}|{dia}|{seg}|{fonte.split(':')[0]}"
        if chave in obs:  # mesma medição em outro arquivo: junta a proveniência
            o = obs[chave]
            if arquivo and arquivo not in (o["fonte_arquivo"] or ""):
                o["fonte_arquivo"] = f"{o['fonte_arquivo']}; {arquivo}"
            o["observado_em"] = o["observado_em"] or instante
            o["seguindo"] = o["seguindo"] if o["seguindo"] is not None else sgd
            o["posts"] = o["posts"] if o["posts"] is not None else posts
            return
        obs[chave] = dict(chave=chave, perfil_key=perfil_key, observado_em=instante, data_observacao=dia, origem_data=origem,
                          seguidores=seg, seguindo=sgd, posts=posts, precisao="exata", fonte=fonte, fonte_arquivo=arquivo,
                          status_coleta=status, execucao_id=execucao)

    for r in csv.DictReader((out / "observacoes_historicas.csv").open(encoding="utf-8")):
        dia, inst = _dia_e_instante(r["data_observacao"])
        k = chave_perfil(r["plataforma"], r["username"])
        if r["perfil_id"] and k in perfis:
            perfis[k]["perfil_id"] = r["perfil_id"]
        add_obs(k, dia, inst, r["origem_data"], _int(r["seguidores"]), _int(r["seguindo"]), _int(r["posts"]),
                f"historico:{r['fonte_tipo']}", r["fonte_arquivo"])

    execs = [json.loads(l) for l in (out / "execucoes.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()] \
        if (out / "execucoes.jsonl").exists() else []
    posts = []
    for e in execs:
        arq = out / e["arquivo"]
        if not arq.exists():
            continue
        itens = json.loads(arq.read_text(encoding="utf-8"))
        fim = e.get("terminada_em") or e["iniciada_em"]
        dia, inst = _dia_e_instante(fim)
        if e["tipo"] == "snapshot_apify":
            for i in itens:
                if i.get("followersCount") is None:
                    continue
                k = chave_perfil("instagram", i["username"])
                if k in perfis:
                    perfis[k]["perfil_id"] = perfis[k]["perfil_id"] or i.get("id")
                    perfis[k]["nome_publico"] = i.get("fullName")
                add_obs(k, dia, inst, "coleta (fim da execução na Apify)", _int(i.get("followersCount")),
                        _int(i.get("followsCount")), _int(i.get("postsCount")), f"apify:{e['ator']}", e["arquivo"],
                        execucao=e["id"])
            for u, motivo in (e.get("falhas") or {}).items():
                k = chave_perfil("instagram", u)
                st = "privado" if "private" in str(motivo).lower() else "indisponivel" if "not" in str(motivo).lower() else "falha"
                add_obs(k, dia, inst, "coleta (fim da execução na Apify)", None, None, None, f"apify:{e['ator']}",
                        f"{e['arquivo']} ({motivo})", status=st, execucao=e["id"])
        elif e["tipo"] == "snapshot_apify_posts":
            desde = e.get("desde") or "2026-08-16"
            for i in itens:
                if not i.get("id") or (i.get("timestamp") or "") < desde:  # postagens fixadas antigas ficam fora do recorte
                    continue
                dono = str(i.get("ownerUsername", "")).lower()
                coautores = {str(c.get("username", "")).lower() for c in (i.get("coauthorProducers") or []) if isinstance(c, dict)}
                for u in {dono} | coautores:
                    k = chave_perfil("instagram", u)
                    if k not in perfis:
                        continue
                    posts.append(dict(post_id=str(i["id"]), perfil_key=k, coautoria=u != dono, publicado_em=i.get("timestamp"), tipo=i.get("type"),
                                  url=i.get("url"), curtidas=_int(i.get("likesCount")), comentarios=_int(i.get("commentsCount")),
                                  visualizacoes=_int(i.get("videoViewCount") if i.get("videoViewCount") is not None else i.get("videoPlayCount")),
                                  fixado=bool(i.get("isPinned")), coletado_em=inst, execucao_id=e["id"]))
    hist = dict(id="importacao_historica_relatorio_vic", iniciada_em=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                terminada_em=None, tipo="importacao_historica", perfis_solicitados=len(perfis),
                perfis_obtidos=len({o["perfil_key"] for o in obs.values() if o["fonte"].startswith("historico")}), falhas=None,
                custo_usd=0, custo_confirmado=True, teto_usd=None,
                proveniencia="monitoramento MG 2026 (pasta relatorio-vic): séries, snapshots e relatórios de 01/09 a 20/09/2026")
    execucoes = [hist] + [dict(id=e["id"], iniciada_em=e["iniciada_em"], terminada_em=e.get("terminada_em"), tipo=e["tipo"],
                               perfis_solicitados=e.get("perfis_solicitados"), perfis_obtidos=e.get("perfis_obtidos"),
                               falhas=e.get("falhas"), custo_usd=e.get("custo_usd"), custo_confirmado=e.get("custo_confirmado"),
                               teto_usd=e.get("teto_usd"), proveniencia=f"Apify {e.get('ator')}" + (
                                   f"; postagens desde {e.get('desde')}, até {e.get('limite_por_perfil')} por perfil" if e.get("desde") else ""))
                          for e in execs]
    posts = list({(p["post_id"], p["perfil_key"], p["execucao_id"]): p for p in posts}.values())  # item repetido no dataset
    return dict(perfis=list(perfis.values()), observacoes=list(obs.values()), posts=posts, execucoes=execucoes)


def json_dashboard(d: dict) -> dict:
    """Mesmo formato da RPC digital_json."""
    ps = sorted({(p["post_id"], p["perfil_key"]): p for p in sorted(d["posts"], key=lambda p: p["coletado_em"] or "")}.values(),
                key=lambda p: (p["perfil_key"], p["publicado_em"] or ""))
    return {
        "perfis": [p for p in d["perfis"] if p["status_vinculo"] != "rejeitado"],
        "observacoes": sorted([dict(perfil_key=o["perfil_key"], observado_em=o["observado_em"], data=o["data_observacao"],
                                    origem_data=o["origem_data"], seguidores=o["seguidores"], seguindo=o["seguindo"], posts=o["posts"],
                                    precisao=o["precisao"], fonte=o["fonte"], fonte_arquivo=o["fonte_arquivo"], status=o["status_coleta"])
                               for o in d["observacoes"]], key=lambda o: (o["perfil_key"], o["data"] or "")),
        "posts": {k: [p[c] for p in ps] for k, c in [("perfil_key", "perfil_key"), ("publicado", "publicado_em"), ("tipo", "tipo"),
                  ("curtidas", "curtidas"), ("comentarios", "comentarios"), ("views", "visualizacoes"), ("url", "url"),
                  ("fixado", "fixado"), ("coletado", "coletado_em"), ("coautoria", "coautoria")]},
        "execucoes": sorted(d["execucoes"], key=lambda e: e["iniciada_em"], reverse=True),
    }


def carregar(out: Path, root: Path) -> int:
    import sys
    sys.path.insert(0, str(root / "src"))
    from meta_ads.exportar import _inserir, _rodar_sql

    d = montar(out)
    dev = root / "dashboard" / "dev-data" / "mg"
    dev.mkdir(parents=True, exist_ok=True)
    (dev / "digital.json").write_text(json.dumps(json_dashboard(d), ensure_ascii=False), encoding="utf-8")
    print(f"dev-data: {len(d['perfis'])} perfis, {len(d['observacoes'])} observações, {len(d['posts'])} postagens")

    cols = lambda rows: list(rows[0].keys())
    _inserir(root, "digital_perfis", cols(d["perfis"]), [list(r.values()) for r in d["perfis"]], "perfil_key")
    _inserir(root, "digital_observacoes", cols(d["observacoes"]), [list(r.values()) for r in d["observacoes"]], "chave")
    if d["posts"]:
        _inserir(root, "digital_posts", cols(d["posts"]), [list(r.values()) for r in d["posts"]], "post_id, perfil_key, execucao_id")
    _inserir(root, "digital_execucoes", cols(d["execucoes"]), [list(r.values()) for r in d["execucoes"]], "id")
    return 0
