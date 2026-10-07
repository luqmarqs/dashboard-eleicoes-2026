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


def anuncios_de(b: Banco, candidatura_id: int, ibge_tse: dict[int, str]) -> list[dict[str, Any]]:
    out = []
    for an in b.con.execute(
            """SELECT * FROM anuncios WHERE page_id IN (SELECT page_id FROM vinculos WHERE candidatura_id = ?
               AND status_revisao <> 'rejeitado') ORDER BY inicio_veiculacao DESC, ad_id""", (candidatura_id,)):
        loc = [[l["nivel"], l["tipo"], bool(l["excluida"]), l["uf"], l["municipio_nome"], l["cd_ibge"],
                ibge_tse.get(l["cd_ibge"]) if l["cd_ibge"] else None, l["bairro_nome"], l["cep_prefixo"], l["status"],
                l["nome_original"]]
               for l in b.con.execute("SELECT * FROM localidades WHERE ad_id = ? ORDER BY ordem", (an["ad_id"],))]
        ent = [[e["uf"] or e["regiao"], e["proporcao"]]
               for e in b.con.execute("SELECT * FROM entrega_regional WHERE ad_id = ? ORDER BY proporcao DESC", (an["ad_id"],))]
        out.append({
            "id": an["ad_id"], "page_id": an["page_id"], "page_name": an["page_name"], "bylines": an["bylines"],
            "criado": an["criado_em"], "inicio": an["inicio_veiculacao"], "fim": an["fim_veiculacao"],
            "textos": _jl(an["textos"]), "titulos": _jl(an["titulos_link"]), "plataformas": _jl(an["plataformas"]),
            "moeda": an["moeda"], "gasto": [an["gasto_min"], an["gasto_max"]],
            "impressoes": [an["impressoes_min"], an["impressoes_max"]], "alcance": an["alcance_br"],
            "publico": [an["publico_estimado_min"], an["publico_estimado_max"]], "idades": _jl(an["idades_alvo"]),
            "genero": an["genero_alvo"], "link": an["link_biblioteca"], "primeira_coleta": an["primeira_coleta"],
            "ultima_coleta": an["ultima_coleta"], "loc": loc, "entrega": ent,
        })
    return out


def resumo_de(b: Banco, uf: str) -> dict[str, Any]:
    ex = b.con.execute("SELECT * FROM execucoes ORDER BY iniciada_em DESC LIMIT 1").fetchone()
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
        cands.append(dict(candidatura_id=cid, paginas=pags, anuncios=a["n"], gasto_min=a["gmin"], gasto_max=a["gmax"],
                          gasto_aberto=bool(a["aberto"]) if a["n"] else None, moedas=a["moedas"], ultima_coleta=a["uc"]))
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
            print(f"  {rotulo}: falha (tentativa {t + 1}): {(r.stderr or r.stdout).strip()[-300:]}")
            time.sleep(5 * (t + 1))
        raise SystemExit(f"falha ao carregar {rotulo}")
    finally:
        os.unlink(path)


def _inserir(root: Path, tabela: str, cols: list[str], linhas: list[list[Any]], conflito: str | None,
             atualizar: bool = True, max_bytes: int = 1_500_000) -> None:
    lote: list[str] = []
    tam = 0

    def enviar() -> None:
        if not lote:
            return
        sql = f"INSERT INTO public.{tabela} ({', '.join(cols)}) VALUES\n" + ",\n".join(lote)
        if conflito:
            sets = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in conflito.split(", "))
            sql += f"\nON CONFLICT ({conflito}) " + (f"DO UPDATE SET {sets}" if atualizar and sets else "DO NOTHING")
        _rodar_sql(root, sql + ";", tabela)

    for r in linhas:
        s = "(" + ", ".join(lit(v) for v in r) + ")"
        if tam + len(s) > max_bytes:
            enviar()
            lote, tam = [], 0
        lote.append(s)
        tam += len(s)
    enviar()
    print(f"  {tabela}: {len(linhas):,} linhas")


def carregar_supabase(b: Banco, root: Path) -> None:
    ibge_tse = _mapa_ibge_tse(root)
    q = lambda sql, *p: [list(r) for r in b.con.execute(sql, p)]
    print("carga no Supabase:")
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
    linhas = []
    for r in b.con.execute(f"SELECT {', '.join(cols)} FROM anuncios"):
        linhas.append([_jl(r[c]) if c in jcols else r[c] for c in cols])
    _inserir(root, "meta_anuncios", cols, linhas, "ad_id")
    ids = [r[0] for r in linhas]
    # segmentação e entrega refletem o estado mais recente: substitui por anúncio
    for i in range(0, len(ids), 2000):
        bloco = ", ".join(lit(x) for x in ids[i:i + 2000])
        _rodar_sql(root, f"DELETE FROM public.meta_localidades WHERE ad_id IN ({bloco}); "
                         f"DELETE FROM public.meta_entrega_regional WHERE ad_id IN ({bloco});", "limpeza de localidades")
    _inserir(root, "meta_localidades",
             ["ad_id", "ordem", "nome_original", "tipo", "excluida", "num_obfuscated", "nivel", "uf", "municipio_nome",
              "cd_ibge", "cd_municipio", "bairro_nome", "cep_prefixo", "status", "metodo"],
             [[r[0], r[1], r[2], r[3], bool(r[4]), r[5], r[6], r[7], r[8], r[9], ibge_tse.get(r[9]) if r[9] else None,
               r[10], r[11], r[12], r[13]] for r in
              q("""SELECT ad_id, ordem, nome_original, tipo, excluida, num_obfuscated, nivel, uf, municipio_nome, cd_ibge,
                          bairro_nome, cep_prefixo, status, metodo FROM localidades""")], None)
    _inserir(root, "meta_entrega_regional", ["ad_id", "regiao", "uf", "proporcao"],
             q("SELECT ad_id, regiao, uf, proporcao FROM entrega_regional"), None)
    _inserir(root, "meta_observacoes", ["ad_id", "coletado_em", "execucao_id", "versao_api", "hash", "gasto_min",
                                        "gasto_max", "impressoes_min", "impressoes_max", "alcance_br", "bruto"],
             [r[:10] + [json.loads(gzip.decompress(r[10]))] for r in
              q("""SELECT ad_id, coletado_em, execucao_id, versao_api, hash, gasto_min, gasto_max, impressoes_min,
                          impressoes_max, alcance_br, bruto_gz FROM observacoes""")],
             "ad_id, execucao_id", atualizar=False)
    _inserir(root, "meta_execucoes", ["id", "modo", "iniciada_em", "terminada_em", "status", "versao_api", "periodo_min",
                                      "periodo_max", "paginas_alvo", "paginas_concluidas", "paginas_com_falha",
                                      "anuncios_vistos", "anuncios_novos", "observacoes_novas", "erros"],
             [r[:14] + [_jl(r[14])] for r in q("""SELECT id, modo, iniciada_em, terminada_em, status, versao_api, periodo_min,
                periodo_max, paginas_alvo, paginas_concluidas, paginas_com_falha, anuncios_vistos, anuncios_novos,
                observacoes_novas, erros FROM execucoes""")], "id")
