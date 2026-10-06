"""Exporta os dados do dashboard (agregados por local de votação) e os arquivos geográficos.

Saídas:
    data/dashboard/<uf>/municipios.csv      município (TSE + IBGE), nome, centróide
    data/dashboard/<uf>/locais.csv          local de votação: escola, endereço, bairro, coordenada
    data/dashboard/<uf>/candidaturas.csv    todos os votáveis nominais e legendas (todos os partidos)
    data/dashboard/<uf>/votos_local.csv     local × candidatura × votos
    data/dashboard/<uf>/totais_local.csv    local × cargo: aptos, comparecimento, válidos, brancos, nulos
    dashboard/public/geo/<uf>/municipios.json            contornos municipais (IBGE)
    dashboard/public/geo/<uf>/territorios/<ibge>.json    territórios eleitorais (Voronoi dos locais)

Uso:
    python scripts/export_dashboard.py --uf SP

Os CSVs são carregados no Supabase por scripts/load_supabase.py. Antes de gravar, os totais por
candidatura são conferidos com o resultado oficial do TSE (data/validation/comparisons.parquet).
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import urllib.request
from pathlib import Path

import duckdb
import shapely
from shapely.geometry import MultiPoint, Point, mapping, shape
from shapely.ops import unary_union

from tse2026.config import get_settings

ROOT = Path(__file__).resolve().parents[1]
GEO_OUT = ROOT / "dashboard" / "public" / "geo"
IBGE_UF = {"SP": 35}
CARGOS = {1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado Federal", 7: "Deputado Estadual",
          8: "Deputado Distrital"}


def ibge_malha(uf: str) -> dict:
    cache = get_settings().raw_dir / "externo" / f"ibge_uf_{uf}_mun_intermediaria.json"
    if not cache.exists():
        url = (f"https://servicodados.ibge.gov.br/api/v3/malhas/estados/{IBGE_UF[uf]}"
               "?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio")
        with urllib.request.urlopen(url, timeout=120) as resp:
            raw = resp.read()
        if raw[:2] == bytes([0x1F, 0x8B]):
            raw = gzip.decompress(raw)
        cache.write_bytes(raw)
    return json.loads(cache.read_text(encoding="utf-8"))


def round_geom(geom: dict, nd: int = 5) -> dict:
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", default="SP")
    p.add_argument("--turno", type=int, default=1)
    p.add_argument("--dev-json", action="store_true",
                   help="só gera dashboard/dev-data/ (formato das funções do Supabase) a partir dos CSVs")
    a = p.parse_args(argv)
    if a.dev_json:
        return export_dev_json(a.uf.upper())
    uf = a.uf.upper()
    s = get_settings()
    out = s.data_dir / "dashboard" / uf.lower()
    out.mkdir(parents=True, exist_ok=True)
    geo_out = GEO_OUT / uf.lower()
    (geo_out / "territorios").mkdir(parents=True, exist_ok=True)

    cad = s.raw_dir / "externo" / f"eleitorado_local_votacao_2026_{uf}.csv"
    if not cad.exists():
        sys.exit(f"{cad} não existe; rode scripts/mapa_calor.py uma vez ou extraia o cadastro do TSE")
    glob = (s.dataset_dir / f"SG_UF={uf}" / f"turno{a.turno}_*.parquet").as_posix()

    con = duckdb.connect()
    con.execute(f"""CREATE TABLE cad AS
      SELECT CD_MUNICIPIO, NR_ZONA::INT NR_ZONA, NR_SECAO::INT NR_SECAO, NR_LOCAL_VOTACAO::INT NR_LOCAL,
             trim(NM_LOCAL_VOTACAO) NOME, trim(DS_ENDERECO) ENDERECO,
             COALESCE(NULLIF(upper(trim(NM_BAIRRO)), ''), '(NÃO INFORMADO)') BAIRRO, NR_CEP CEP,
             TRY_CAST(replace(NR_LATITUDE, ',', '.') AS DOUBLE) LAT, TRY_CAST(replace(NR_LONGITUDE, ',', '.') AS DOUBLE) LON
      FROM read_csv('{cad.as_posix()}', delim=';', header=true, encoding='latin-1', all_varchar=true)
      WHERE NR_TURNO = '{a.turno}'""")
    con.execute(f"CREATE VIEW vot AS SELECT * FROM read_parquet('{glob}')")

    # --- municípios e locais -------------------------------------------------------------------
    con.execute("""CREATE TABLE locais AS
      WITH sec AS (
        SELECT DISTINCT v.CD_MUNICIPIO, v.CD_MUNICIPIO_IBGE, v.NM_MUNICIPIO, v.NR_ZONA, v.NR_SECAO
        FROM vot v
      )
      SELECT row_number() OVER (ORDER BY c.CD_MUNICIPIO, c.NR_ZONA, c.NR_LOCAL) AS id,
             c.CD_MUNICIPIO AS cd_municipio, ANY_VALUE(s.CD_MUNICIPIO_IBGE) AS cd_ibge, c.NR_ZONA AS nr_zona,
             c.NR_LOCAL AS nr_local, ANY_VALUE(c.NOME) AS nome, ANY_VALUE(c.ENDERECO) AS endereco,
             ANY_VALUE(c.BAIRRO) AS bairro, ANY_VALUE(c.CEP) AS cep,
             ANY_VALUE(c.LAT) AS lat, ANY_VALUE(c.LON) AS lon, COUNT(*) AS qt_secoes
      FROM cad c JOIN sec s USING (CD_MUNICIPIO, NR_ZONA, NR_SECAO)
      GROUP BY c.CD_MUNICIPIO, c.NR_ZONA, c.NR_LOCAL""")
    con.execute("""CREATE TABLE sec_local AS
      SELECT l.id AS local_id, c.CD_MUNICIPIO, c.NR_ZONA, c.NR_SECAO
      FROM cad c JOIN locais l ON l.cd_municipio = c.CD_MUNICIPIO AND l.nr_zona = c.NR_ZONA AND l.nr_local = c.NR_LOCAL""")

    malha = ibge_malha(uf)
    polys = {int(f["properties"]["codarea"]): shape(f["geometry"]) for f in malha["features"]}
    munis = con.sql("""SELECT DISTINCT CD_MUNICIPIO, CD_MUNICIPIO_IBGE, NM_MUNICIPIO FROM vot ORDER BY 1""").fetchall()

    def valid(lat, lon, ibge):
        if lat is None or lon is None:
            return False
        poly = polys.get(ibge)
        return poly is not None and poly.buffer(0.02).contains(Point(lon, lat))

    locais = con.sql("SELECT id, cd_ibge, lat, lon FROM locais").fetchall()
    fixed = {}
    for lid, ibge, lat, lon in locais:
        if not valid(lat, lon, ibge):
            pt = polys[ibge].representative_point()
            fixed[lid] = (pt.y, pt.x)
    con.execute("ALTER TABLE locais ADD COLUMN coord_aproximada BOOLEAN DEFAULT false")
    for lid, (lat, lon) in fixed.items():
        con.execute("UPDATE locais SET lat = ?, lon = ?, coord_aproximada = true WHERE id = ?", [lat, lon, lid])
    print(f"locais: {len(locais):,} ({len(fixed)} sem coordenada válida -> ponto interno do município)")

    con.execute(f"""COPY (SELECT id, cd_municipio, cd_ibge, nr_zona, nr_local, nome, endereco, bairro, cep,
                          round(lat, 6) lat, round(lon, 6) lon, coord_aproximada, qt_secoes FROM locais ORDER BY id)
                   TO '{(out / "locais.csv").as_posix()}' (HEADER)""")
    with (out / "municipios.csv").open("w", encoding="utf-8", newline="") as fh:
        fh.write("cd_municipio,cd_ibge,nome,lat,lon\n")
        for cd, ibge, nome in munis:
            c = polys[ibge].representative_point()
            fh.write(f'{cd},{ibge},"{nome}",{c.y:.5f},{c.x:.5f}\n')

    # --- candidaturas, votos e totais -----------------------------------------------------------
    con.execute("""CREATE TABLE cand AS
      SELECT row_number() OVER (ORDER BY CD_CARGO, TP_VOTO DESC, NR_CANDIDATO) AS id, *
      FROM (
        SELECT CD_ELEICAO AS cd_eleicao, CD_CARGO, ANY_VALUE(DS_CARGO) AS ds_cargo, TP_VOTO, NR_CANDIDATO,
               ANY_VALUE(NM_URNA_CANDIDATO) AS nm_urna, ANY_VALUE(NM_CANDIDATO) AS nm_candidato,
               ANY_VALUE(NR_PARTIDO) AS nr_partido, ANY_VALUE(SG_PARTIDO) AS sg_partido,
               ANY_VALUE(SQ_CANDIDATO) AS sq_candidato, ANY_VALUE(DS_DESTINACAO_VOTO) AS destinacao,
               SUM(QT_VOTOS)::BIGINT AS votos_total
        FROM vot WHERE TP_VOTO IN ('nominal', 'legenda')
        GROUP BY CD_ELEICAO, CD_CARGO, TP_VOTO, NR_CANDIDATO
      )""")
    con.execute(f"""COPY (
        SELECT id, cd_eleicao, CD_CARGO AS cd_cargo, ds_cargo, TP_VOTO AS tipo, NR_CANDIDATO AS numero,
               CASE WHEN TP_VOTO = 'legenda' THEN 'LEGENDA ' || COALESCE(sg_partido, NR_CANDIDATO::VARCHAR)
                    ELSE nm_urna END AS nm_urna,
               nm_candidato, nr_partido, sg_partido, sq_candidato, destinacao, votos_total
        FROM cand ORDER BY id) TO '{(out / "candidaturas.csv").as_posix()}' (HEADER)""")
    con.execute(f"""COPY (
        SELECT sl.local_id, c.id AS candidatura_id, SUM(v.QT_VOTOS)::INT AS votos
        FROM vot v JOIN sec_local sl USING (CD_MUNICIPIO, NR_ZONA, NR_SECAO)
        JOIN cand c ON c.CD_CARGO = v.CD_CARGO AND c.TP_VOTO = v.TP_VOTO AND c.NR_CANDIDATO = v.NR_CANDIDATO
        WHERE v.TP_VOTO IN ('nominal', 'legenda')
        GROUP BY 1, 2 HAVING SUM(v.QT_VOTOS) > 0 ORDER BY 2, 1
      ) TO '{(out / "votos_local.csv").as_posix()}' (HEADER)""")
    con.execute(f"""COPY (
        WITH sc AS (
          SELECT DISTINCT CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO, QT_APTOS, QT_COMPARECIMENTO FROM vot
        ), vv AS (
          SELECT CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO,
                 SUM(QT_VOTOS) FILTER (TP_VOTO IN ('nominal', 'legenda') AND DS_DESTINACAO_VOTO LIKE 'Válido%') validos,
                 SUM(QT_VOTOS) FILTER (TP_VOTO = 'branco') brancos,
                 SUM(QT_VOTOS) FILTER (TP_VOTO = 'nulo') nulos
          FROM vot GROUP BY ALL
        )
        SELECT sl.local_id, sc.CD_CARGO AS cd_cargo, SUM(QT_APTOS)::INT aptos,
               SUM(QT_COMPARECIMENTO)::INT comparecimento, COALESCE(SUM(validos), 0)::INT validos,
               COALESCE(SUM(brancos), 0)::INT brancos, COALESCE(SUM(nulos), 0)::INT nulos
        FROM sc JOIN vv USING (CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO)
        JOIN sec_local sl USING (CD_MUNICIPIO, NR_ZONA, NR_SECAO)
        GROUP BY 1, 2 ORDER BY 1, 2
      ) TO '{(out / "totais_local.csv").as_posix()}' (HEADER)""")

    # conferência com o resultado oficial (nível UF)
    comp = (s.validation_dir / "comparisons.parquet").as_posix()
    bad = con.sql(f"""
      WITH ours AS (
        SELECT c.CD_CARGO cd_cargo, c.NR_CANDIDATO numero, c.TP_VOTO tipo, SUM(v.votos) votos
        FROM read_csv('{(out / "votos_local.csv").as_posix()}') v JOIN cand c ON c.id = v.candidatura_id
        GROUP BY ALL
      )
      SELECT o.*, x.votos_oficial FROM ours o
      JOIN read_parquet('{comp}') x ON x.nivel = 'uf' AND x.uf = '{uf}' AND x.cd_cargo = o.cd_cargo
        AND x.candidato = o.numero
        AND x.tipo = CASE o.tipo WHEN 'nominal' THEN 'candidato' ELSE 'legenda' END
      WHERE x.votos_oficial IS NOT NULL AND x.votos_oficial <> o.votos""").fetchall()
    if bad:
        print("DIVERGÊNCIAS com o oficial:", bad[:10])
        return 1
    n_checked = con.sql(f"SELECT COUNT(*) FROM read_parquet('{comp}') WHERE nivel = 'uf' AND uf = '{uf}' "
                        "AND tipo IN ('candidato', 'legenda') AND status = 'OK'").fetchone()[0]
    print(f"conferência com o oficial: ok ({n_checked:,} totais de candidatura/legenda na UF)")

    # --- geo: contornos e territórios eleitorais ------------------------------------------------
    feats = []
    tse_by_ibge = {ibge: (cd, nome) for cd, ibge, nome in munis}
    for f in malha["features"]:
        ibge = int(f["properties"]["codarea"])
        simp = shape(f["geometry"]).simplify(0.002, preserve_topology=True)
        cd, nome = tse_by_ibge.get(ibge, (None, None))
        feats.append({"type": "Feature", "properties": {"cd_ibge": ibge, "cd_municipio": cd, "nome": nome},
                      "geometry": round_geom(mapping(simp), 4)})
    (geo_out / "municipios.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                        separators=(",", ":"), ensure_ascii=False), encoding="utf-8")

    rows = con.sql("SELECT cd_ibge, id, lat, lon FROM locais ORDER BY cd_ibge, id").fetchall()
    by_mun: dict[int, list[tuple[int, float, float]]] = {}
    for ibge, lid, lat, lon in rows:
        by_mun.setdefault(ibge, []).append((lid, lat, lon))
    total_bytes = 0
    for ibge, pts in by_mun.items():
        poly = polys[ibge].buffer(0)
        # locais no mesmo ponto (ex.: duas zonas na mesma escola) compartilham o território
        groups: dict[tuple[float, float], list[int]] = {}
        for lid, lat, lon in pts:
            groups.setdefault((round(lon, 5), round(lat, 5)), []).append(lid)
        coords = list(groups)
        if len(coords) == 1:
            cells = [poly]
        else:
            vor = shapely.voronoi_polygons(MultiPoint(coords), extend_to=poly)
            cells_by_pt = {}
            for cell in vor.geoms:
                for c in coords:
                    if c not in cells_by_pt and cell.contains(Point(c)):
                        cells_by_pt[c] = cell
                        break
            cells = [cells_by_pt.get(c, Point(c).buffer(0.001)).intersection(poly) for c in coords]
        tfeats = []
        for c, cell in zip(coords, cells):
            if cell.is_empty:
                continue
            cell = cell.simplify(0.0002, preserve_topology=True)
            tfeats.append({"type": "Feature", "properties": {"locais": groups[c]},
                           "geometry": round_geom(mapping(cell), 5)})
        data = json.dumps({"type": "FeatureCollection", "features": tfeats}, separators=(",", ":"))
        (geo_out / "territorios" / f"{ibge}.json").write_text(data, encoding="utf-8")
        total_bytes += len(data)
    print(f"territórios: {len(by_mun)} municípios, {total_bytes / 1e6:.1f} MB")
    for f in sorted(out.glob("*.csv")):
        print(f"  {f.name}: {f.stat().st_size / 1e6:.1f} MB")
    return 0


def export_dev_json(uf: str) -> int:
    """Arquivos locais no mesmo formato das funções RPC, para desenvolver o dashboard sem o Supabase.

    Ficam em dashboard/dev-data/ (ignorado pelo git e fora do build): nunca são publicados.
    """
    src = get_settings().data_dir / "dashboard" / uf.lower()
    dest = ROOT / "dashboard" / "dev-data" / uf.lower()
    (dest / "votos").mkdir(parents=True, exist_ok=True)
    (dest / "totais").mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    for name in ("locais", "candidaturas", "votos_local", "totais_local", "municipios"):
        # códigos TSE de município têm zeros à esquerda: sempre texto
        types = {"locais": "{'cd_municipio': 'VARCHAR', 'cep': 'VARCHAR'}",
                 "municipios": "{'cd_municipio': 'VARCHAR'}"}.get(name)
        opt = f", types={types}" if types else ""
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_csv('{(src / f'{name}.csv').as_posix()}', header=true{opt})")

    def cols(sql: str, mapping: dict[str, str]) -> dict:
        rows = con.sql(sql).fetchall()
        names = [d[0] for d in con.sql(sql).description]
        return {k: [r[names.index(v)] for r in rows] for k, v in mapping.items()}

    dump = lambda path, obj: path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")),  # noqa: E731
                                             encoding="utf-8")
    dump(dest / "locais.json", cols("SELECT * FROM locais ORDER BY id", {
        "id": "id", "mun": "cd_municipio", "zona": "nr_zona", "nr": "nr_local", "nome": "nome", "end": "endereco",
        "bairro": "bairro", "lat": "lat", "lon": "lon", "aprox": "coord_aproximada", "secoes": "qt_secoes"}))
    dump(dest / "candidaturas.json", cols("SELECT * FROM candidaturas ORDER BY id", {
        "id": "id", "cargo": "cd_cargo", "tipo": "tipo", "numero": "numero", "nome": "nm_urna",
        "nomeCompleto": "nm_candidato", "partido": "sg_partido", "destinacao": "destinacao", "votos": "votos_total"}))
    dump(dest / "municipios.json", cols("SELECT * FROM municipios ORDER BY cd_municipio", {
        "cd": "cd_municipio", "ibge": "cd_ibge", "nome": "nome", "lat": "lat", "lon": "lon"}))
    dest_ids = con.sql("""SELECT id FROM candidaturas WHERE tipo = 'nominal'
                          AND ((cd_cargo = 7 AND numero = 50000) OR (cd_cargo = 6 AND numero = 5005))
                          ORDER BY cd_cargo DESC""").fetchall()
    dump(dest / "config.json", {"partidos": [{"sigla": "PSOL", "ordem": 1, "cor": "#7b1fa2"}],
                                "candidaturas": [r[0] for r in dest_ids]})
    for (cargo,) in con.sql("SELECT DISTINCT cd_cargo FROM totais_local").fetchall():
        dump(dest / "totais" / f"{cargo}.json", cols(
            f"SELECT * FROM totais_local WHERE cd_cargo = {cargo} ORDER BY local_id",
            {"local": "local_id", "validos": "validos", "comparecimento": "comparecimento", "aptos": "aptos"}))
    rows = con.sql("SELECT candidatura_id, local_id, votos FROM votos_local ORDER BY candidatura_id, local_id").fetchall()
    cur, buf = None, {"local": [], "votos": []}
    for cid, lid, v in rows + [(None, None, None)]:
        if cid != cur and cur is not None:
            dump(dest / "votos" / f"{cur}.json", buf)
            buf = {"local": [], "votos": []}
        cur = cid
        if cid is not None:
            buf["local"].append(lid)
            buf["votos"].append(v)
    print(f"dev-data em {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
