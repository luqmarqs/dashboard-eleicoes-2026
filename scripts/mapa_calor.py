"""Gera um mapa de calor (HTML local, Leaflet + OpenStreetMap) dos votos por local de votação.

Exemplos:
    # uma candidatura no estado, com as 20 cidades mais votadas identificadas
    python scripts/mapa_calor.py --uf SP --cargo 7 --candidato 50000 --top-areas 20

    # comparativo das 10 candidaturas mais votadas de um partido numa cidade (federal e estadual),
    # com seletor de candidatura e os bairros mais votados identificados
    python scripts/mapa_calor.py --uf SP --municipio 71072 --partido PSOL --top 10

O arquivo é gerado em data/exports/mapas/ e abre direto no navegador (precisa de internet para
carregar o Leaflet e o fundo do mapa).

Fontes: votos do dataset de BUs (data/processed); coordenadas e bairros do cadastro de locais de
votação do TSE (eleitorado_local_votacao_2026, em data/raw/externo); limites municipais do IBGE.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import duckdb

from tse2026.config import get_settings

TEMPLATE = Path(__file__).parent / "templates" / "mapa_calor.html"
CADASTRO_URL = "https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip"
IBGE_UF = {"SP": 35, "RJ": 33, "MG": 31}  # amplie conforme a necessidade
CARGOS = {6: "Deputado Federal", 7: "Deputado Estadual", 1: "Presidente", 3: "Governador", 5: "Senador",
          8: "Deputado Distrital"}


def cadastro_csv(uf: str) -> Path:
    s = get_settings()
    dest = s.raw_dir / "externo"
    csv = dest / f"eleitorado_local_votacao_2026_{uf}.csv"
    if csv.exists():
        return csv
    zip_path = dest / "eleitorado_local_votacao_2026.zip"
    if not zip_path.exists():
        dest.mkdir(parents=True, exist_ok=True)
        print(f"baixando {CADASTRO_URL} ...")
        urllib.request.urlretrieve(CADASTRO_URL, zip_path)
    zipfile.ZipFile(zip_path).extract(csv.name, dest)
    return csv


def ibge_geojson(uf: str, municipio_ibge: int | None) -> dict:
    s = get_settings()
    cache = s.raw_dir / "externo" / (f"ibge_mun_{municipio_ibge}.json" if municipio_ibge else f"ibge_uf_{uf}_mun.json")
    if not cache.exists():
        if municipio_ibge:
            url = (f"https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{municipio_ibge}"
                   "?formato=application/vnd.geo%2Bjson&qualidade=intermediaria")
        else:
            url = (f"https://servicodados.ibge.gov.br/api/v3/malhas/estados/{IBGE_UF[uf]}"
                   "?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio")
        with urllib.request.urlopen(url, timeout=60) as resp:
            raw = resp.read()
        if raw[:2] == bytes([0x1F, 0x8B]):  # a API do IBGE responde em gzip mesmo sem Accept-Encoding
            raw = gzip.decompress(raw)
        cache.write_bytes(raw)
    geo = json.loads(cache.read_text(encoding="utf-8"))

    def rnd(c):  # reduz o tamanho do arquivo
        return [rnd(x) for x in c] if isinstance(c[0], list) else [round(c[0], 5), round(c[1], 5)]

    for f in geo["features"]:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    return geo


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", required=True)
    p.add_argument("--municipio", help="código TSE do município (sem ele, o mapa cobre a UF)")
    p.add_argument("--cargo", type=int, help="cargo da candidatura (com --candidato)")
    p.add_argument("--candidato", type=int, help="número da candidatura")
    p.add_argument("--partido", help="sigla do partido (comparativo das mais votadas)")
    p.add_argument("--top", type=int, default=10, help="quantas candidaturas por cargo no comparativo")
    p.add_argument("--cargos", default="6,7", help="cargos do comparativo (padrão: 6,7)")
    p.add_argument("--top-areas", type=int, default=20, help="quantas cidades/bairros identificar no mapa")
    p.add_argument("--turno", type=int, default=1)
    p.add_argument("--out", type=Path)
    a = p.parse_args(argv)
    if not ((a.cargo and a.candidato) or a.partido):
        p.error("informe --cargo e --candidato, ou --partido")
    uf = a.uf.upper()
    mun = a.municipio.zfill(5) if a.municipio else None
    s = get_settings()

    con = duckdb.connect()
    con.execute(f"""CREATE TABLE loc AS
      SELECT CD_MUNICIPIO, NR_ZONA::INT NR_ZONA, NR_SECAO::INT NR_SECAO, NR_LOCAL_VOTACAO::INT NR_LOCAL,
             trim(NM_LOCAL_VOTACAO) ESCOLA, COALESCE(NULLIF(upper(trim(NM_BAIRRO)), ''), '(NÃO INFORMADO)') BAIRRO,
             TRY_CAST(replace(NR_LATITUDE, ',', '.') AS DOUBLE) lat, TRY_CAST(replace(NR_LONGITUDE, ',', '.') AS DOUBLE) lon
      FROM read_csv('{cadastro_csv(uf).as_posix()}', delim=';', header=true, encoding='latin-1', all_varchar=true)
      WHERE NR_TURNO = '{a.turno}' {f"AND CD_MUNICIPIO = '{mun}'" if mun else ""}""")
    glob = (s.dataset_dir / f"SG_UF={uf}" / f"turno{a.turno}_*.parquet").as_posix()
    con.execute(f"""CREATE TABLE v AS SELECT v.*, l.ESCOLA, l.BAIRRO, l.NR_LOCAL, l.lat, l.lon
      FROM read_parquet('{glob}') v JOIN loc l USING (CD_MUNICIPIO, NR_ZONA, NR_SECAO)
      {f"WHERE v.CD_MUNICIPIO = '{mun}'" if mun else ""}""")
    if con.sql("SELECT COUNT(*) FROM v").fetchone()[0] == 0:
        sys.exit("nenhum dado no escopo; rode o pipeline para esta UF antes")

    # séries (camadas selecionáveis)
    series: list[dict] = []
    if a.candidato:
        nome = con.sql(f"SELECT ANY_VALUE(NM_URNA_CANDIDATO), ANY_VALUE(SG_PARTIDO) FROM v "
                       f"WHERE CD_CARGO = {a.cargo} AND NR_CANDIDATO = {a.candidato}").fetchone()
        series.append({"cargo": a.cargo, "label": f"{a.candidato} · {nome[0]}", "party": nome[1],
                       "filter": f"CD_CARGO = {a.cargo} AND TP_VOTO = 'nominal' AND NR_CANDIDATO = {a.candidato}"})
    else:
        party = a.partido.upper()
        for cargo in (int(c) for c in a.cargos.split(",")):
            series.append({"cargo": cargo, "label": f"Total {party} (nominal + legenda)", "party": party,
                           "filter": f"CD_CARGO = {cargo} AND SG_PARTIDO = '{party}' "
                                     f"AND TP_VOTO IN ('nominal', 'legenda')"})
            for n, nm in con.sql(f"""SELECT NR_CANDIDATO, ANY_VALUE(NM_URNA_CANDIDATO) FROM v
                                     WHERE CD_CARGO = {cargo} AND SG_PARTIDO = '{party}' AND TP_VOTO = 'nominal'
                                     GROUP BY 1 ORDER BY SUM(QT_VOTOS) DESC LIMIT {a.top}""").fetchall():
                series.append({"cargo": cargo, "label": f"{n} · {nm}", "party": party,
                               "filter": f"CD_CARGO = {cargo} AND TP_VOTO = 'nominal' AND NR_CANDIDATO = {n}"})

    sel = ", ".join(f"COALESCE(SUM(QT_VOTOS) FILTER ({sr['filter']}), 0)::INT" for sr in series)
    cargos = sorted({sr["cargo"] for sr in series})
    validos = ", ".join(
        f"COALESCE(SUM(QT_VOTOS) FILTER (CD_CARGO = {c} AND TP_VOTO IN ('nominal', 'legenda') "
        f"AND DS_DESTINACAO_VOTO LIKE 'Válido%'), 0)::INT" for c in cargos)
    rows = con.sql(f"""SELECT ANY_VALUE(lat), ANY_VALUE(lon), ANY_VALUE(ESCOLA), ANY_VALUE(BAIRRO),
                             ANY_VALUE(NM_MUNICIPIO), ANY_VALUE(CD_MUNICIPIO_IBGE), {sel}, {validos}
                       FROM v GROUP BY CD_MUNICIPIO, NR_ZONA, NR_LOCAL""").fetchall()

    geo = ibge_geojson(uf, None if not mun else rows[0][5])
    # locais sem coordenada válida: centro do município (média dos demais locais do município)
    ok = lambda la, lo: la is not None and lo is not None and -34 < la < 6 and -75 < lo < -28  # noqa: E731
    centro: dict[int, list[float]] = {}
    for r in rows:
        if ok(r[0], r[1]):
            c = centro.setdefault(r[5], [0.0, 0.0, 0])
            c[0] += r[0]; c[1] += r[1]; c[2] += 1
    ns = len(series)
    points, sem_coord = [], [0, 0]
    for r in rows:
        la, lo = (r[0], r[1]) if ok(r[0], r[1]) else (centro[r[5]][0] / centro[r[5]][2], centro[r[5]][1] / centro[r[5]][2])
        if not ok(r[0], r[1]):
            sem_coord[0] += 1
            sem_coord[1] += sum(r[6:6 + ns])
        points.append([round(la, 5), round(lo, 5), r[2], r[3], r[4], list(r[6:6 + ns]), list(r[6 + ns:])])

    mun_nome = rows[0][4] if mun else None
    data = {
        "titulo": (f"{series[0]['label'].split(' · ')[1]}" if a.candidato else f"{a.partido.upper()} em {mun_nome.title() if mun else uf}"),
        "escopo": mun_nome.title() if mun else uf,
        "nivel": "bairro" if mun else "municipio",
        "topAreas": a.top_areas,
        "series": [{"label": sr["label"], "cargo": sr["cargo"], "cargoNome": CARGOS.get(sr["cargo"], str(sr["cargo"]))}
                   for sr in series],
        "cargos": cargos,
        "points": points,
        "geo": geo,
        "semCoord": sem_coord,
    }
    html = TEMPLATE.read_text(encoding="utf-8").replace("__DATA__", json.dumps(data, ensure_ascii=False,
                                                                                separators=(",", ":")))
    html = html.replace("__TITLE__", f"Mapa · {data['titulo']}")
    if a.out:
        out = a.out
    else:
        slug = (f"c{a.cargo}_{a.candidato}" if a.candidato else f"{a.partido.lower()}_top{a.top}")
        out = s.data_dir / "exports" / "mapas" / f"mapa_{slug}_{uf}{'_' + mun if mun else ''}_t{a.turno}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out}  ({out.stat().st_size / 1e6:.2f} MB, {len(points):,} locais, {ns} camada(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
