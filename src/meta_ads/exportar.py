"""Saída da coleta: JSON do modo dev do dashboard (mesmo formato das RPCs) e carga no Supabase via CLI."""

from __future__ import annotations

import csv
import gzip
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from .store import Banco


def _mapa_ibge_tse(root: Path) -> dict[int, str]:
    """cd_ibge -> código TSE, pelo cadastro do painel (UFs carregadas)."""
    m: dict[int, str] = {}
    for f in (root / "data" / "dashboard").glob("*/municipios.csv"):
        for r in csv.DictReader(f.open(encoding="utf-8")):
            m[int(r["cd_ibge"])] = r["cd_municipio"].zfill(5)
    return m


def _jl(s: str | None) -> Any:
    return json.loads(s) if s else None


def _obj(b: Banco, an: Any, ibge_tse: dict[int, str]) -> dict[str, Any]:
    loc = [[l["nivel"], l["tipo"], bool(l["excluida"]), l["uf"], l["municipio_nome"], l["cd_ibge"],
            ibge_tse.get(l["cd_ibge"]) if l["cd_ibge"] else None, l["bairro_nome"], l["cep_prefixo"], l["status"],
            l["nome_original"]]
           for l in b.con.execute("SELECT * FROM localidades WHERE ad_id = ? ORDER BY ordem", (an["ad_id"],))]
    ent = [[e["uf"] or e["regiao"], e["proporcao"]]
           for e in b.con.execute("SELECT * FROM entrega_regional WHERE ad_id = ? ORDER BY proporcao DESC", (an["ad_id"],))]
    return {
        "id": an["ad_id"], "page_id": an["page_id"], "page_name": an["page_name"], "bylines": an["bylines"],
        "criado": an["criado_em"], "inicio": an["inicio_veiculacao"], "fim": an["fim_veiculacao"],
        "textos": _jl(an["textos"]), "titulos": _jl(an["titulos_link"]), "plataformas": _jl(an["plataformas"]),
        "moeda": an["moeda"], "gasto": [an["gasto_min"], an["gasto_max"]],
        "impressoes": [an["impressoes_min"], an["impressoes_max"]], "alcance": an["alcance_br"],
        "publico": [an["publico_estimado_min"], an["publico_estimado_max"]], "idades": _jl(an["idades_alvo"]),
        "genero": an["genero_alvo"], "link": an["link_biblioteca"], "primeira_coleta": an["primeira_coleta"],
        "ultima_coleta": an["ultima_coleta"], "loc": loc, "entrega": ent,
    }


def dobradas_de(b: Banco, candidatura_id: int, ibge_tse: dict[int, str]) -> list[dict[str, Any]]:
    """Mesmo formato da RPC meta_dobradas_json."""
    if not b.con.execute("SELECT name FROM sqlite_master WHERE name='mencoes'").fetchone():
        return []
    proprias = [r[0] for r in b.con.execute(
        "SELECT page_id FROM vinculos WHERE candidatura_id = ? AND status_revisao <> 'rejeitado'", (candidatura_id,))]
    ph = ",".join("?" * len(proprias)) or "''"
    linhas = [("recebe", r) for r in b.con.execute(
        f"""SELECT m.*, m.pagador_candidatura_id AS outra FROM mencoes m JOIN anuncios a USING (ad_id)
            WHERE m.candidatura_id = ? AND m.pagador_candidatura_id IS NOT ? AND a.page_id NOT IN ({ph})""",
        (candidatura_id, candidatura_id, *proprias))]
    linhas += [("faz", r) for r in b.con.execute(
        f"""SELECT m.*, m.candidatura_id AS outra FROM mencoes m JOIN anuncios a USING (ad_id)
            WHERE a.page_id IN ({ph}) AND m.candidatura_id <> ? AND m.cita_numero = 1""", (*proprias, candidatura_id))]
    out = []
    for papel, m in linhas:
        an = b.con.execute("SELECT * FROM anuncios WHERE ad_id = ?", (m["ad_id"],)).fetchone()
        out.append({"papel": papel, "outra": m["outra"], "cita_nome": bool(m["cita_nome"]), "cita_numero": bool(m["cita_numero"]),
                    "confirmada": bool(m["confirmada"]), "cnpjs_texto": m["cnpjs_texto"], "cnpj_financiador": m["cnpj_financiador"],
                    "ad": _obj(b, an, ibge_tse)})
    out.sort(key=lambda x: x["ad"]["inicio"] or "", reverse=True)
    return out


def anuncios_de(b: Banco, candidatura_id: int, ibge_tse: dict[int, str]) -> list[dict[str, Any]]:
    out = []
    for an in b.con.execute(
            """SELECT * FROM anuncios WHERE page_id IN (SELECT page_id FROM vinculos WHERE candidatura_id = ?
               AND status_revisao <> 'rejeitado') ORDER BY inicio_veiculacao DESC, ad_id""", (candidatura_id,)):
        out.append(_obj(b, an, ibge_tse))
    return out


def resumo_de(b: Banco, uf: str) -> dict[str, Any]:
    # cobertura = última coleta das páginas (a busca de menções é outra coisa)
    ex = b.con.execute("SELECT * FROM execucoes WHERE modo <> 'mencoes' ORDER BY iniciada_em DESC LIMIT 1").fetchone()
    ult = b.con.execute("SELECT MAX(iniciada_em) FROM execucoes WHERE status = 'completa'").fetchone()[0]
    cands = []
    for (cid,) in b.con.execute("SELECT DISTINCT candidatura_id FROM vinculos WHERE uf = ? AND status_revisao <> 'rejeitado'", (uf,)):
        pags = [dict(page_id=r["page_id"], page_name=r["page_name"], natureza=r["natureza"], status_revisao=r["status_revisao"],
                     evidencia=r["evidencia"], coletar=bool(r["coletar"]))
                for r in b.con.execute("SELECT * FROM vinculos WHERE candidatura_id = ? AND status_revisao <> 'rejeitado' ORDER BY page_name", (cid,))]
        a = b.con.execute(
            """SELECT COUNT(DISTINCT ad_id) n, SUM(gasto_min) gmin, SUM(gasto_max) gmax,
                      MAX(gasto_max IS NULL) aberto, COUNT(DISTINCT moeda) moedas, MAX(ultima_coleta) uc
               FROM anuncios WHERE page_id IN (SELECT page_id FROM vinculos WHERE candidatura_id = ? AND status_revisao <> 'rejeitado')""",
            (cid,)).fetchone()
        cu = b.con.execute(
            """SELECT SUM(gasto_min), SUM(gasto_max), MAX(gasto_max IS NULL), SUM(alcance_br) FROM anuncios
               WHERE moeda = 'BRL' AND alcance_br > 0 AND page_id IN
               (SELECT page_id FROM vinculos WHERE candidatura_id = ? AND status_revisao <> 'rejeitado')""", (cid,)).fetchone()
        cmin = round(cu[0] / cu[3] * 1000, 2) if cu[3] else None
        cmax = round(cu[1] / cu[3] * 1000, 2) if cu[3] and not cu[2] else None
        cands.append(dict(candidatura_id=cid, paginas=pags, anuncios=a["n"], gasto_min=a["gmin"], gasto_max=a["gmax"],
                          gasto_aberto=bool(a["aberto"]) if a["n"] else None, moedas=a["moedas"], ultima_coleta=a["uc"],
                          custo_mil_min=cmin, custo_mil_max=cmax, c_gmin=cu[0], c_gmax=cu[1], c_aberto=bool(cu[2]) if cu[3] else None,
                          c_alc=cu[3]))
    cands.sort(key=lambda c: -(c["gasto_max"] or 0))
    return {"execucao": dict(ex) if ex else None, "ultima_completa": ult, "candidaturas": cands}


def exportar_dev(b: Banco, root: Path) -> None:
    ibge_tse = _mapa_ibge_tse(root)
    for uf in [r[0] for r in b.con.execute("SELECT DISTINCT uf FROM vinculos")]:
        out = root / "dashboard" / "dev-data" / uf.lower() / "meta"
        out.mkdir(parents=True, exist_ok=True)
        res = resumo_de(b, uf)
        (out / "resumo.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
        for c in res["candidaturas"]:
            (out / f"{c['candidatura_id']}.json").write_text(
                json.dumps(anuncios_de(b, c["candidatura_id"], ibge_tse), ensure_ascii=False), encoding="utf-8")
            (out / "dobradas").mkdir(exist_ok=True)
            (out / "dobradas" / f"{c['candidatura_id']}.json").write_text(
                json.dumps(dobradas_de(b, c["candidatura_id"], ibge_tse), ensure_ascii=False), encoding="utf-8")
        print(f"dev-data {uf}: {len(res['candidaturas'])} candidaturas")


# ---------------------------------------------------------------------------------------------
# Carga no Supabase (mesmo mecanismo do scripts/load_supabase.py: SQL em lotes pelo CLI vinculado)
# ---------------------------------------------------------------------------------------------

def lit(v: Any) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


def _rodar_sql(root: Path, sql: str, rotulo: str) -> None:
    npx = shutil.which("npx") or "npx"
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(sql)
        path = fh.name
    try:
        for t in range(3):
            r = subprocess.run([npx, "--yes", "supabase@latest", "db", "query", "--linked", "-f", path],
                               cwd=root, capture_output=True, text=True, encoding="utf-8", stdin=subprocess.DEVNULL)
            if r.returncode == 0:
                return
            msg = " ".join(x.strip() for x in (r.stdout, r.stderr) if x and x.strip())
            print(f"  {rotulo}: falha (tentativa {t + 1}): {msg[-400:]}")
            time.sleep(5 * (t + 1))
        raise SystemExit(f"falha ao carregar {rotulo}")
    finally:
        os.unlink(path)


def _inserir(root: Path, tabela: str, cols: list[str], linhas: list[list[Any]], conflito: str | None,
             atualizar: bool = True, max_bytes: int = 1_500_000, paralelo: int = 6) -> None:
    """Insere em lotes de SQL pelo CLI, vários lotes em paralelo (cada chamada do CLI leva segundos de ida e volta)."""
    from concurrent.futures import ThreadPoolExecutor

    lotes: list[list[str]] = [[]]
    tam = 0
    for r in linhas:
        s = "(" + ", ".join(lit(v) for v in r) + ")"
        if tam + len(s) > max_bytes and lotes[-1]:
            lotes.append([])
            tam = 0
        lotes[-1].append(s)
        tam += len(s)

    def enviar(lote: list[str]) -> None:
        if not lote:
            return
        sql = f"INSERT INTO public.{tabela} ({', '.join(cols)}) VALUES\n" + ",\n".join(lote)
        if conflito:
            sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in conflito.split(", "))
            sql += f"\nON CONFLICT ({conflito}) " + (f"DO UPDATE SET {sets}" if atualizar and sets else "DO NOTHING")
        _rodar_sql(root, sql + ";", tabela)

    with ThreadPoolExecutor(max_workers=paralelo) as ex:
        list(ex.map(enviar, lotes))
    print(f"  {tabela}: {len(linhas):,} linhas ({len(lotes)} lotes)", flush=True)


def carregar_temas(b: Banco, root: Path) -> None:
    """Temas dos criativos por candidatura (mesma taxonomia do painel) -> meta_temas_cand + dev-data."""
    from collections import defaultdict
    from .temas import temas_por_candidatura
    linhas = temas_por_candidatura(b, root)
    _rodar_sql(root, "DELETE FROM public.meta_temas_cand;", "limpeza de temas")
    _inserir(root, "meta_temas_cand", ["candidatura_id", "tema", "criativos", "anuncios", "total_criativos"],
             [list(l) for l in linhas], "candidatura_id, tema")
    uf_de = {cid: uf for cid, uf in b.con.execute("SELECT candidatura_id, uf FROM vinculos")}
    por = defaultdict(list)
    for l in sorted(linhas):
        por[uf_de[l[0]]].append(l)
    for uf, ls in por.items():
        d = {"cand": [l[0] for l in ls], "tema": [l[1] for l in ls], "criativos": [l[2] for l in ls],
             "anuncios": [l[3] for l in ls], "total": [l[4] for l in ls]}
        (root / "dashboard" / "dev-data" / uf.lower() / "meta" / "temas.json").write_text(json.dumps(d), encoding="utf-8")


def carregar_supabase(b: Banco, root: Path, retomar: bool = False) -> None:
    """Carga completa (substitui vínculos, segmentação, entrega e menções) ou retomada (retomar=True: não apaga nada,
    pula vínculos e anúncios e só acrescenta o que falta, com ON CONFLICT DO NOTHING)."""
    ibge_tse = _mapa_ibge_tse(root)
    q = lambda sql, *p: [list(r) for r in b.con.execute(sql, p)]
    print("carga no Supabase:" + (" (retomada)" if retomar else ""), flush=True)
    if not retomar:
        _rodar_sql(root, "DELETE FROM public.meta_vinculos;", "limpeza de vínculos")
        _inserir(root, "meta_vinculos", ["page_id", "candidatura_id", "uf", "page_name", "natureza", "evidencia",
                                         "status_revisao", "coletar"],
                 [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], bool(r[7])] for r in
                  q("SELECT page_id, candidatura_id, uf, page_name, natureza, evidencia, status_revisao, coletar FROM vinculos")],
                 "page_id, candidatura_id")
        cols = ["ad_id", "page_id", "page_name", "bylines", "criado_em", "inicio_veiculacao", "fim_veiculacao", "textos",
                "titulos_link", "descricoes_link", "legendas_link", "plataformas", "idiomas", "moeda", "gasto_min", "gasto_max",
                "impressoes_min", "impressoes_max", "alcance_br", "publico_estimado_min", "publico_estimado_max", "idades_alvo",
                "genero_alvo", "link_biblioteca", "primeira_coleta", "ultima_coleta", "ultima_execucao"]
        jcols = {"textos", "titulos_link", "descricoes_link", "legendas_link", "plataformas", "idiomas", "idades_alvo"}
        linhas = [[_jl(r[c]) if c in jcols else r[c] for c in cols] for r in b.con.execute(f"SELECT {', '.join(cols)} FROM anuncios")]
        _inserir(root, "meta_anuncios", cols, linhas, "ad_id")
        # segmentação e entrega refletem o estado mais recente: substitui por anúncio
        ids = [r[0] for r in linhas]
        blocos = [", ".join(lit(x) for x in ids[i:i + 2000]) for i in range(0, len(ids), 2000)]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=6) as ex:
            list(ex.map(lambda bl: _rodar_sql(root, f"DELETE FROM public.meta_localidades WHERE ad_id IN ({bl}); "
                                                    f"DELETE FROM public.meta_entrega_regional WHERE ad_id IN ({bl});",
                                              "limpeza de localidades"), blocos))
    _inserir(root, "meta_localidades",
             ["ad_id", "ordem", "nome_original", "tipo", "excluida", "num_obfuscated", "nivel", "uf", "municipio_nome",
              "cd_ibge", "cd_municipio", "bairro_nome", "cep_prefixo", "status", "metodo"],
             [[r[0], r[1], r[2], r[3], bool(r[4]), r[5], r[6], r[7], r[8], r[9], ibge_tse.get(r[9]) if r[9] else None,
               r[10], r[11], r[12], r[13]] for r in
              q("""SELECT ad_id, ordem, nome_original, tipo, excluida, num_obfuscated, nivel, uf, municipio_nome, cd_ibge,
                          bairro_nome, cep_prefixo, status, metodo FROM localidades""")],
             "ad_id, ordem", atualizar=False)
    _inserir(root, "meta_entrega_regional", ["ad_id", "regiao", "uf", "proporcao"],
             q("SELECT ad_id, regiao, uf, proporcao FROM entrega_regional"), "ad_id, regiao", atualizar=False)
    _inserir(root, "meta_observacoes", ["ad_id", "coletado_em", "execucao_id", "versao_api", "hash", "gasto_min",
                                        "gasto_max", "impressoes_min", "impressoes_max", "alcance_br", "bruto"],
             # resposta bruta saneada fica no SQLite local (gzip); no Supabase vai a referência + hash
             [r[:10] + [{"armazenamento": "data/meta_ads/meta_ads.sqlite#observacoes", "execucao_id": r[2], "sha256": r[4]}] for r in
              q("""SELECT ad_id, coletado_em, execucao_id, versao_api, hash, gasto_min, gasto_max, impressoes_min,
                          impressoes_max, alcance_br FROM observacoes""")],
             "ad_id, execucao_id", atualizar=False)
    if b.con.execute("SELECT name FROM sqlite_master WHERE name='mencoes'").fetchone():
        if not retomar:
            _rodar_sql(root, "DELETE FROM public.meta_mencoes;", "limpeza de menções")
        _inserir(root, "meta_mencoes", ["ad_id", "candidatura_id", "pagador_candidatura_id", "cita_nome", "cita_numero",
                                        "cnpjs_texto", "cnpj_financiador", "confirmada"],
                 [[r[0], r[1], r[2], bool(r[3]), bool(r[4]), r[5], r[6], bool(r[7])] for r in q("SELECT * FROM mencoes")],
                 "ad_id, candidatura_id", atualizar=False)
    _inserir(root, "meta_execucoes", ["id", "modo", "iniciada_em", "terminada_em", "status", "versao_api", "periodo_min",
                                      "periodo_max", "paginas_alvo", "paginas_concluidas", "paginas_com_falha",
                                      "anuncios_vistos", "anuncios_novos", "observacoes_novas", "erros"],
             [r[:14] + [_jl(r[14])] for r in q("""SELECT id, modo, iniciada_em, terminada_em, status, versao_api, periodo_min,
                periodo_max, paginas_alvo, paginas_concluidas, paginas_com_falha, anuncios_vistos, anuncios_novos,
                observacoes_novas, erros FROM execucoes""")], "id")
    carregar_temas(b, root)
    atualizar_cache(root, [r[0] for r in b.con.execute("SELECT DISTINCT uf FROM vinculos")])


def atualizar_cache(root: Path, ufs: list[str]) -> None:
    """Pré-calcula no banco as respostas do painel (meta_cache), uma UF por vez e em paralelo."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(lambda uf: _rodar_sql(root, f"select public.meta_atualizar_cache('{uf}');", f"cache {uf}"), ufs))
    _rodar_sql(root, "select public.meta_atualizar_prioritarias();", "cache das prioritárias")
    for uf in ufs:  # aba Apocalipse (votos por cidade e partido; ~10 s por UF)
        _rodar_sql(root, f"select public.apocalipse_atualizar('{uf}');", f"apocalipse {uf}")
    print(f"  cache do painel atualizado: {', '.join(ufs)} + prioritárias", flush=True)
