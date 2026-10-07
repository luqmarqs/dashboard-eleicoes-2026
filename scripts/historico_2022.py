"""Votação de 2022 das candidaturas em destaque, comparável com 2026 por cidade, bairro e escola.

Fontes (TSE, Portal de Dados Abertos), em data/raw/externo/2022/:
    votacao_secao_2022_<UF>.zip         votos por seção (1º turno)
    eleitorado_local_votacao_2022.zip   seção -> local de votação (escola, bairro, coordenadas)

Saída: data/dashboard/<uf>/historico.csv e historico_comparativo.csv, carregados no Supabase
    (python scripts/load_supabase.py --uf <UF> --historico), e dashboard/dev-data/<uf>/historico/<id>.json (modo dev).
    historico.csv                ano, cargo, número, votos totais e situação em 2022 de cada candidatura 2026
    historico_comparativo.csv    candidatura_id (2026) × nível (municipio | bairro | local) × chave:
                                 votos e votos válidos do cargo em 2022

Casamento 2022 -> 2026:
    cidade: código TSE do município (o mesmo nos dois anos);
    bairro: município + nome do bairro do local de votação (maiúsculas, sem espaços extras);
    escola: local de 2026 com o mesmo nome no mesmo município; senão o mais próximo até 150 m.

Uso:
    python scripts/historico_2022.py --uf SP
"""

from __future__ import annotations

import argparse
import math
import sys
import unicodedata
import zipfile
from pathlib import Path

import duckdb

from tse2026.config import get_settings

# candidatura 2026 (cargo, número) -> candidatura 2022 (cargo, número)
HISTORICO = {
    # Bancada Feminista; Guilherme Cortez (estadual em 2022); Orlando Silva e Leci Brandão (PCdoB, mesmo cargo e número nos dois anos)
    "SP": {(7, 50000): (7, 50000), (6, 5005): (7, 50005), (6, 6565): (6, 6565), (7, 65035): (7, 65035)},
    "MG": {(7, 50099): (6, 5000), (6, 5050): (6, 1212)},     # Iza Lourença (federal em 2022); Duda Salabert (PDT em 2022)
    "RS": {(7, 50123): (7, 50123)},                          # Matheus Gomes (Manuela não concorreu em 2022)
}
VOTOS_NAO_VALIDOS = (95, 96, 97, 98)  # branco, nulo, anulado, anulado sub judice
RAIO_M = 150


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.upper().replace(".", " ").replace("-", " ").split())


def extrair(zip_path: Path, pattern: str, dest: Path) -> Path:
    z = zipfile.ZipFile(zip_path)
    nome = next(n for n in z.namelist() if pattern in n and n.endswith(".csv"))
    out = dest / nome
    if not out.exists():
        print(f"extraindo {nome}…", flush=True)
        z.extract(nome, dest)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", default="SP")
    a = p.parse_args(argv)
    uf = a.uf.upper()
    s = get_settings()
    raw = s.raw_dir / "externo" / "2022"
    out = s.data_dir / "dashboard" / uf.lower()
    pares = HISTORICO.get(uf)
    if not pares:
        sys.exit(f"sem candidaturas com histórico configuradas para {uf}")

    secao_csv = extrair(raw / f"votacao_secao_2022_{uf}.zip", f"votacao_secao_2022_{uf}", raw)
    locais_csv = extrair(raw / "eleitorado_local_votacao_2022.zip", "eleitorado_local_votacao_2022", raw)

    con = duckdb.connect()
    cargos22 = sorted({c for c, _ in pares.values()})
    nums22 = sorted({n for _, n in pares.values()})
    print("lendo votos de 2022 por seção…", flush=True)
    con.execute(f"""CREATE TABLE v22 AS
      SELECT CD_MUNICIPIO::VARCHAR AS cd_municipio, NR_ZONA::INT AS zona, NR_SECAO::INT AS secao,
             CD_CARGO::INT AS cargo, NR_VOTAVEL::INT AS numero, QT_VOTOS::INT AS votos
      FROM read_csv('{secao_csv.as_posix()}', delim=';', header=true, encoding='latin-1', all_varchar=true)
      WHERE NR_TURNO = '1' AND CD_CARGO::INT IN ({",".join(map(str, cargos22))})""")
    con.execute(f"""CREATE TABLE sec22 AS
      SELECT cd_municipio, zona, secao, cargo,
             SUM(votos) FILTER (WHERE numero NOT IN {VOTOS_NAO_VALIDOS}) AS validos,
             {", ".join(f"SUM(votos) FILTER (WHERE numero = {n}) AS n{n}" for n in nums22)}
      FROM v22 GROUP BY ALL""")
    print("lendo locais de votação de 2022…", flush=True)
    con.execute(f"""CREATE TABLE loc22 AS
      SELECT DISTINCT CD_MUNICIPIO AS cd_municipio, NR_ZONA::INT AS zona, NR_SECAO::INT AS secao,
             NR_LOCAL_VOTACAO::INT AS nr_local, NM_LOCAL_VOTACAO AS nome, NM_BAIRRO AS bairro,
             TRY_CAST(replace(NR_LATITUDE, ',', '.') AS DOUBLE) AS lat,
             TRY_CAST(replace(NR_LONGITUDE, ',', '.') AS DOUBLE) AS lon
      FROM read_csv('{locais_csv.as_posix()}', delim=';', header=true, encoding='latin-1', all_varchar=true)
      WHERE SG_UF = '{uf}' AND NR_TURNO = '1'""")
    cobertura = con.sql("""SELECT COUNT(*), COUNT(l.nome) FROM sec22 s
      LEFT JOIN loc22 l USING (cd_municipio, zona, secao)""").fetchone()
    print(f"seções 2022: {cobertura[0]:,} | com local de votação: {cobertura[1]:,}")

    # ---- locais 2026 (do export do dashboard) ----
    con.execute(f"""CREATE TABLE loc26 AS SELECT id, cd_municipio::VARCHAR AS cd_municipio, nome, bairro, lat, lon
      FROM read_csv('{(out / "locais.csv").as_posix()}', header=true, types={{'cd_municipio': 'VARCHAR'}})""")
    cand26 = con.sql(f"""SELECT id, cd_cargo, numero FROM read_csv('{(out / "candidaturas.csv").as_posix()}', header=true)
                         WHERE tipo = 'nominal'""").fetchall()
    id26 = {(c, n): i for i, c, n in cand26}

    # casamento de locais 2022 -> 2026
    l26 = con.sql("SELECT id, cd_municipio, nome, lat, lon FROM loc26").fetchall()
    por_nome: dict[tuple[str, str], int] = {}
    por_mun: dict[str, list[tuple[int, float, float]]] = {}
    for i, mun, nome, lat, lon in l26:
        por_nome.setdefault((mun, norm(nome)), i)
        por_mun.setdefault(mun, []).append((i, lat, lon))
    l22 = con.sql("SELECT DISTINCT cd_municipio, zona, nr_local, nome, lat, lon FROM loc22").fetchall()
    mapa = []
    n_nome = n_prox = 0
    for mun, zona, nr, nome, lat, lon in l22:
        alvo = por_nome.get((mun.lstrip("0").zfill(5) if mun else mun, norm(nome))) or por_nome.get((mun, norm(nome)))
        if alvo:
            n_nome += 1
        elif lat is not None and lon is not None and -90 < lat < 0:
            best, dmin = None, RAIO_M
            for i, la, lo in por_mun.get(mun, []):
                d = math.hypot((la - lat) * 111_000, (lo - lon) * 111_000 * math.cos(math.radians(lat)))
                if d < dmin:
                    best, dmin = i, d
            if best:
                alvo = best
                n_prox += 1
        mapa.append((mun, zona, nr, alvo))
    con.execute("CREATE TABLE mapa (cd_municipio VARCHAR, zona INT, nr_local INT, local26 INT)")
    con.executemany("INSERT INTO mapa VALUES (?, ?, ?, ?)", mapa)
    print(f"locais 2022: {len(l22):,} | casados por nome: {n_nome:,} | por proximidade: {n_prox:,} | "
          f"sem par: {len(l22) - n_nome - n_prox:,}")

    # ---- agregações por nível ----
    linhas = []
    hist = []
    for (c26, n26), (c22, n22) in pares.items():
        cid = id26.get((c26, n26))
        if cid is None:
            print(f"candidatura 2026 {c26}/{n26} não encontrada; ignorada")
            continue
        base = f"""SELECT s.cd_municipio, l.bairro, m.local26, s.n{n22} AS votos, s.validos
                   FROM sec22 s JOIN loc22 l USING (cd_municipio, zona, secao)
                   LEFT JOIN mapa m ON m.cd_municipio = l.cd_municipio AND m.zona = l.zona AND m.nr_local = l.nr_local
                   WHERE s.cargo = {c22}"""
        tot = con.sql(f"SELECT SUM(votos) FROM ({base})").fetchone()[0] or 0
        hist.append((cid, 2022, c22, n22, int(tot)))
        for nivel, chave in (("municipio", "cd_municipio"), ("bairro", "cd_municipio || '|' || upper(trim(bairro))"),
                             ("local", "local26::VARCHAR")):
            for mun, k, v, val in con.sql(f"""
                SELECT cd_municipio, {chave} AS k, COALESCE(SUM(votos), 0), COALESCE(SUM(validos), 0)
                FROM ({base}) WHERE {chave} IS NOT NULL GROUP BY ALL""").fetchall():
                linhas.append((cid, nivel, mun, k, int(v), int(val)))
        print(f"2022 {c22}/{n22} -> 2026 id {cid}: {tot:,} votos")

    with (out / "historico.csv").open("w", encoding="utf-8", newline="") as fh:
        fh.write("candidatura_id,ano,cd_cargo,numero,votos_total\n")
        for r in hist:
            fh.write(",".join(map(str, r)) + "\n")
    with (out / "historico_comparativo.csv").open("w", encoding="utf-8", newline="") as fh:
        fh.write("candidatura_id,ano,nivel,cd_municipio,chave,votos,validos\n")
        for cid, nivel, mun, k, v, val in linhas:
            k = '"' + str(k).replace('"', '""') + '"'
            fh.write(f"{cid},2022,{nivel},{mun},{k},{v},{val}\n")
    print(f"historico_comparativo.csv: {len(linhas):,} linhas")
    escrever_dev(uf, hist, linhas)
    return 0


def escrever_dev(uf: str, hist: list[tuple], linhas: list[tuple]) -> None:
    """dashboard/dev-data/<uf>/historico/<id>.json, no formato da RPC historico_json (modo dev do painel)."""
    import json
    pasta = Path(__file__).resolve().parents[1] / "dashboard" / "dev-data" / uf.lower() / "historico"
    pasta.mkdir(parents=True, exist_ok=True)
    for cid, ano, c22, n22, tot in hist:
        ls = sorted((l for l in linhas if l[0] == cid), key=lambda l: (l[1], str(l[3])))
        d = {"resumo": [{"candidatura_id": cid, "ano": ano, "cd_cargo": c22, "numero": n22, "votos_total": tot}],
             "nivel": [l[1] for l in ls], "mun": [str(l[2]) for l in ls], "chave": [str(l[3]) for l in ls],
             "votos": [l[4] for l in ls], "validos": [l[5] for l in ls], "ano": [2022] * len(ls)}
        (pasta / f"{cid}.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    print(f"dev-data: {len(hist)} arquivos em {pasta}")


if __name__ == "__main__":
    sys.exit(main())
