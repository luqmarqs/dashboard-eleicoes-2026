"""Fundo eleitoral (FEFC) recebido por candidatura, a partir da prestação de contas do TSE.

Baixa (ou reaproveita) os zips do CDN do TSE em data/raw/externo/tse_2026_contas/, extrai os CSVs nacionais de receitas e
despesas contratadas (cp1252 -> UTF-8) e soma, por candidatura (cargos 3, 5, 6, 7):
  fundo_eleitoral  = receitas com fonte FUNDO ESPECIAL (inclui estimável e repasses de outras candidaturas);
  fundo_partidario = receitas com fonte FUNDO PARTIDARIO;
  receita_total, gasto_declarado (despesas contratadas; parcial até a prestação final).
O arquivo traz uma prestação por candidatura (a mais recente), então somar não duplica.
Grava dashboard/dev-data/<uf>/fundo.json e, com --supabase, a tabela fundo_cand.

Uso: python scripts/fundo_eleitoral.py [--baixar] [--supabase] [SP MG RS]
"""

from __future__ import annotations

import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DIR = ROOT / "data" / "raw" / "externo" / "tse_2026_contas"
CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_2026.zip"
CARGOS = (3, 5, 6, 7)


def extrair(baixar: bool) -> dict[str, Path]:
    z = DIR / "prestacao_de_contas_eleitorais_candidatos_2026.zip"
    if baixar or not z.exists():
        DIR.mkdir(parents=True, exist_ok=True)
        print(f"baixando {CDN}")
        urllib.request.urlretrieve(CDN, z)
    out = {}
    with zipfile.ZipFile(z) as zf:
        for nome in ("receitas_candidatos_2026_BRASIL.csv", "despesas_contratadas_candidatos_2026_BRASIL.csv"):
            dest = DIR / "x" / nome.replace(".csv", ".u8.csv")
            if not dest.exists() or dest.stat().st_mtime < z.stat().st_mtime:
                dest.parent.mkdir(exist_ok=True)
                with zf.open(nome) as i, open(dest, "w", encoding="utf-8", newline="") as o:
                    t = io.TextIOWrapper(i, encoding="cp1252", errors="replace", newline="")
                    while b := t.read(1 << 24):
                        o.write(b)
            out[nome.split("_")[0]] = dest
    return out


def montar(arqs: dict[str, Path], ufs: list[str]) -> list[dict]:
    con = duckdb.connect()
    o = "delim=';', header=true, all_varchar=true"
    ufs_sql = ",".join(f"'{u}'" for u in ufs)
    cargos = ",".join(f"'{c}'" for c in CARGOS)
    rows = con.sql(f"""
      WITH r AS (
        SELECT SG_UF uf, CD_CARGO::INT cd_cargo, NR_CANDIDATO::INT numero,
               sum(v) FILTER (DS_FONTE_RECEITA = 'FUNDO ESPECIAL' OR DS_ORIGEM_RECEITA LIKE 'Fundo Especial%') fe,
               sum(v) FILTER (DS_FONTE_RECEITA = 'FUNDO PARTIDARIO') fp, sum(v) rt,
               any_value(TP_PRESTACAO_CONTAS) tp, any_value(strptime(DT_PRESTACAO_CONTAS, '%d/%m/%Y')::DATE) dp,
               max(strptime(DT_GERACAO, '%d/%m/%Y')::DATE) dg
        FROM (SELECT *, replace(VR_RECEITA, ',', '.')::DOUBLE v FROM read_csv('{arqs["receitas"].as_posix()}', {o}))
        WHERE SG_UF IN ({ufs_sql}) AND CD_CARGO IN ({cargos}) GROUP BY ALL
      ), d AS (
        SELECT SG_UF uf, CD_CARGO::INT cd_cargo, NR_CANDIDATO::INT numero, sum(replace(VR_DESPESA_CONTRATADA, ',', '.')::DOUBLE) g,
               any_value(TP_PRESTACAO_CONTAS) tp, any_value(strptime(DT_PRESTACAO_CONTAS, '%d/%m/%Y')::DATE) dp,
               max(strptime(DT_GERACAO, '%d/%m/%Y')::DATE) dg
        FROM read_csv('{arqs["despesas"].as_posix()}', {o})
        WHERE SG_UF IN ({ufs_sql}) AND CD_CARGO IN ({cargos}) GROUP BY ALL
      )
      SELECT uf, cd_cargo, numero, round(coalesce(r.fe, 0), 2), round(coalesce(r.fp, 0), 2), round(coalesce(r.rt, 0), 2),
             round(d.g, 2), coalesce(r.tp, d.tp), coalesce(r.dp, d.dp), greatest(r.dg, d.dg)
      FROM r FULL JOIN d USING (uf, cd_cargo, numero) ORDER BY ALL""").fetchall()
    cols = ["uf", "cd_cargo", "numero", "fundo_eleitoral", "fundo_partidario", "receita_total", "gasto_declarado",
            "prestacao", "data_prestacao", "data_tse"]
    return [dict(zip(cols, r)) for r in rows]


def gerar_dev(lista: list[dict], uf: str) -> None:
    pasta = ROOT / "dashboard" / "dev-data" / uf.lower()
    cs = json.loads((pasta / "candidaturas.json").read_text(encoding="utf-8"))
    ids = {(cs["cargo"][i], cs["numero"][i]): cs["id"][i] for i in range(len(cs["id"])) if cs["tipo"][i] == "nominal"}
    linhas = sorted((ids[(r["cd_cargo"], r["numero"])], r) for r in lista if r["uf"] == uf and (r["cd_cargo"], r["numero"]) in ids)
    out = {"id": [i for i, _ in linhas], "fundo": [r["fundo_eleitoral"] for _, r in linhas],
           "partidario": [r["fundo_partidario"] for _, r in linhas], "receita": [r["receita_total"] for _, r in linhas],
           "gasto": [r["gasto_declarado"] for _, r in linhas], "prestacao": [r["prestacao"] for _, r in linhas],
           "data_prestacao": [str(r["data_prestacao"]) if r["data_prestacao"] else None for _, r in linhas],
           "data_tse": str(max(r["data_tse"] for _, r in linhas))}
    (pasta / "fundo.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{uf}: {len(linhas):,} candidaturas no dev-data")


def carregar(lista: list[dict], ufs: list[str]) -> None:
    from src.meta_ads.exportar import _inserir, _rodar_sql
    _rodar_sql(ROOT, "delete from public.fundo_cand where uf in (" + ",".join(f"'{u}'" for u in ufs) + ");", "limpa fundo_cand")
    cols = list(lista[0].keys())
    _inserir(ROOT, "fundo_cand", cols, [[r[c] for c in cols] for r in lista], None)
    print("Supabase: fundo_cand atualizado")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ufs = [a.upper() for a in args] or ["SP", "MG", "RS"]
    lista = montar(extrair("--baixar" in sys.argv), ufs)
    for uf in ufs:
        n = [r for r in lista if r["uf"] == uf]
        print(f"{uf}: {len(n):,} candidaturas, fundo eleitoral R$ {sum(r['fundo_eleitoral'] for r in n):,.2f}")
        gerar_dev(lista, uf)
    if "--supabase" in sys.argv:
        carregar(lista, ufs)
