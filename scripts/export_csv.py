"""Exporta recortes do dataset Parquet para CSV, sob demanda (via DuckDB, em streaming).

Exemplos:
    python scripts/export_csv.py --uf SP
    python scripts/export_csv.py --uf SP --municipio 71072
    python scripts/export_csv.py --cargo presidente
    python scripts/export_csv.py --uf RJ --cargo "deputado federal" --zona 5 --out rj_depfed_z5.csv
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

import duckdb

from tse2026.config import get_settings


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(text.lower().replace("_", " ").split())


def resolve_cargo(con: duckdb.DuckDBPyConnection, glob: str, cargo: str) -> int:
    if cargo.isdigit():
        return int(cargo)
    cargos = con.execute(
        f"SELECT DISTINCT CD_CARGO, DS_CARGO FROM read_parquet('{glob}', hive_partitioning = true)"
    ).fetchall()
    for cd, ds in cargos:
        if ds and _norm(ds) == _norm(cargo):
            return int(cd)
    opcoes = ", ".join(f"{cd}={ds}" for cd, ds in sorted(cargos))
    raise SystemExit(f"cargo '{cargo}' não encontrado. Opções: {opcoes}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf")
    p.add_argument("--municipio", help="código TSE do município (ex.: 71072)")
    p.add_argument("--zona", type=int)
    p.add_argument("--secao", type=int)
    p.add_argument("--cargo", help="código (1) ou nome (presidente, 'deputado federal'...)")
    p.add_argument("--turno", type=int, default=1)
    p.add_argument("--out", type=Path, help="arquivo de saída (padrão: data/exports/<recorte>.csv)")
    p.add_argument("--sep", default=";", help="separador (padrão ';')")
    args = p.parse_args(argv)

    if not any([args.uf, args.municipio, args.cargo]):
        p.error("informe ao menos --uf, --municipio ou --cargo (não exportamos o CSV nacional completo por padrão)")

    settings = get_settings()
    part = f"SG_UF={args.uf.upper()}" if args.uf else "SG_UF=*"
    glob = (settings.dataset_dir / part / f"turno{args.turno}_*.parquet").as_posix()
    con = duckdb.connect()

    where, params, name = [], [], [f"t{args.turno}"]
    if args.uf:
        name.append(args.uf.upper())
    if args.municipio:
        where.append("CD_MUNICIPIO = ?")
        params.append(args.municipio.zfill(5))
        name.append(f"m{args.municipio.zfill(5)}")
    if args.zona is not None:
        where.append("NR_ZONA = ?")
        params.append(args.zona)
        name.append(f"z{args.zona}")
    if args.secao is not None:
        where.append("NR_SECAO = ?")
        params.append(args.secao)
        name.append(f"s{args.secao}")
    if args.cargo:
        cd = resolve_cargo(con, glob, args.cargo)
        where.append("CD_CARGO = ?")
        params.append(cd)
        name.append(f"c{cd}")

    out = args.out or settings.data_dir / "exports" / f"votacao_secao_{'_'.join(name)}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    sql = f"""
        COPY (
            SELECT * FROM read_parquet('{glob}', hive_partitioning = true)
            {"WHERE " + " AND ".join(where) if where else ""}
            ORDER BY SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO, TP_VOTO, NR_CANDIDATO
        ) TO '{out.as_posix()}' (HEADER, DELIMITER '{args.sep}')
    """
    con.execute(sql, params)
    n = con.execute(f"SELECT COUNT(*) FROM read_csv('{out.as_posix()}', delim = '{args.sep}')").fetchone()[0]
    print(f"{n:,} linhas exportadas para {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
