"""Carrega os CSVs de data/dashboard/<uf>/ no Postgres do Supabase (COPY, idempotente).

Requer a variável SUPABASE_DB_URL (connection string do Postgres, em Project Settings > Database;
use a do "Session pooler"), lida do ambiente ou do arquivo .env na raiz do repositório.

Uso:
    python scripts/load_supabase.py --uf SP                 # aplica migrations e carrega (COPY)
    python scripts/load_supabase.py --uf SP --skip-migrations
    python scripts/load_supabase.py --uf SP --via-cli       # sem senha: usa o Supabase CLI logado
                                                            # (projeto vinculado com `supabase link`)

No modo --via-cli as migrations devem ser aplicadas antes com `supabase db push`; os dados vão em
lotes de SQL executados por `supabase db query --linked`.

Painéis personalizados e destaques já existentes são preservados (as candidaturas são atualizadas
por upsert, com ids estáveis).
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import psycopg

from tse2026.config import get_settings

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
DESTAQUES = [(7, 50000), (6, 5005)]  # (cargo, número): Bancada Feminista, Guilherme Cortez

TABLES = {
    "municipios": ("cd_municipio", "cd_municipio, cd_ibge, nome, lat, lon"),
    "locais": ("id", "id, cd_municipio, cd_ibge, nr_zona, nr_local, nome, endereco, bairro, cep, lat, lon, "
                     "coord_aproximada, qt_secoes"),
    "candidaturas": ("id", "id, cd_eleicao, cd_cargo, ds_cargo, tipo, numero, nm_urna, nm_candidato, nr_partido, "
                           "sg_partido, sq_candidato, destinacao, votos_total, situacao"),
}


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    env = ROOT / ".env"
    if not url and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("SUPABASE_DB_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
    if not url:
        sys.exit("defina SUPABASE_DB_URL no ambiente ou no .env")
    return url


def copy_csv(cur: psycopg.Cursor, table: str, cols: str, path: Path) -> None:
    with cur.copy(f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv, HEADER true)") as cp:
        with path.open("rb") as fh:
            while chunk := fh.read(1 << 20):
                cp.write(chunk)


def upsert(cur: psycopg.Cursor, table: str, key: str, cols: str, path: Path) -> None:
    cur.execute(f"CREATE TEMP TABLE tmp_{table} (LIKE public.{table} INCLUDING DEFAULTS) ON COMMIT DROP")
    copy_csv(cur, f"tmp_{table}", cols, path)
    sets = ", ".join(f"{c.strip()} = excluded.{c.strip()}" for c in cols.split(",") if c.strip() != key)
    cur.execute(f"INSERT INTO public.{table} ({cols}) SELECT {cols} FROM tmp_{table} "
                f"ON CONFLICT ({key}) DO UPDATE SET {sets}")


# ---------------------------------------------------------------------------------------------
# Modo --via-cli: lotes de SQL executados pelo Supabase CLI (Management API), sem senha do banco.
# ---------------------------------------------------------------------------------------------
INT_COLS = {"id", "cd_ibge", "nr_zona", "nr_local", "qt_secoes", "cd_eleicao", "cd_cargo", "numero",
            "nr_partido", "sq_candidato", "votos_total", "local_id", "candidatura_id", "votos", "aptos",
            "comparecimento", "validos", "brancos", "nulos"}
FLOAT_COLS = {"lat", "lon"}
BOOL_COLS = {"coord_aproximada"}


def sql_lit(col: str, v: str) -> str:
    if v == "":
        return "NULL"
    if col in INT_COLS or col in FLOAT_COLS:
        return v
    if col in BOOL_COLS:
        return "true" if v.lower() == "true" else "false"
    return "'" + v.replace("'", "''") + "'"


def run_cli_sql(sql: str, label: str) -> None:
    npx = shutil.which("npx") or "npx"
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(sql)
        path = fh.name
    try:
        for tentativa in range(3):
            r = subprocess.run([npx, "--yes", "supabase@latest", "db", "query", "--linked", "-f", path],
                               cwd=ROOT, capture_output=True, text=True, stdin=subprocess.DEVNULL)
            if r.returncode == 0:
                return
            print(f"  {label}: falha (tentativa {tentativa + 1}): {(r.stderr or r.stdout).strip()[-400:]}")
            time.sleep(5 * (tentativa + 1))
        raise SystemExit(f"falha ao executar {label}")
    finally:
        os.unlink(path)


def rows_of(path: Path) -> tuple[list[str], list[list[str]]]:
    with path.open(encoding="utf-8", newline="") as fh:
        rd = csv.reader(fh)
        header = next(rd)
        return header, list(rd)


def upsert_values_sql(table: str, key: str, header: list[str], rows: list[list[str]]) -> str:
    cols = ", ".join(header)
    vals = ",\n".join("(" + ", ".join(sql_lit(c, v) for c, v in zip(header, r)) + ")" for r in rows)
    sets = ", ".join(f"{c} = excluded.{c}" for c in header if c != key)
    return f"INSERT INTO public.{table} ({cols}) VALUES\n{vals}\nON CONFLICT ({key}) DO UPDATE SET {sets};"


def unnest_insert_sql(table: str, header: list[str], rows: list[list[str]], types: dict[str, str]) -> str:
    arrays = ", ".join(f"'{{{','.join(r[i] for r in rows)}}}'::{types[c]}[]" for i, c in enumerate(header))
    return f"INSERT INTO public.{table} ({', '.join(header)}) SELECT * FROM unnest({arrays});"


def load_via_cli(src: Path, chunk_rows: int, only: list[str] | None = None) -> None:
    t0 = time.time()
    for table, (key, _cols) in TABLES.items():
        if only and table not in only:
            continue
        header, rows = rows_of(src / f"{table}.csv")
        for i in range(0, len(rows), 2000):
            run_cli_sql(upsert_values_sql(table, key, header, rows[i:i + 2000]), f"{table} {i:,}")
        print(f"upsert {table}: {len(rows):,} linhas")
    if only:
        print(f"ok em {time.time() - t0:.0f}s (só {', '.join(only)})")
        return
    run_cli_sql("TRUNCATE public.votos_local, public.totais_local;", "truncate")
    for table, types in (("totais_local", {c: "int" for c in ("local_id", "cd_cargo", "aptos", "comparecimento",
                                                              "validos", "brancos", "nulos")}),
                         ("votos_local", {"local_id": "int", "candidatura_id": "int", "votos": "int"})):
        header, rows = rows_of(src / f"{table}.csv")
        for i in range(0, len(rows), chunk_rows):
            run_cli_sql(unnest_insert_sql(table, header, rows[i:i + chunk_rows], types), f"{table} {i:,}")
            print(f"  {table}: {min(i + chunk_rows, len(rows)):,}/{len(rows):,} ({time.time() - t0:.0f}s)", flush=True)
    dest = " UNION ALL ".join(
        f"SELECT id, {o} FROM public.candidaturas WHERE cd_cargo = {c} AND tipo = 'nominal' AND numero = {n}"
        for o, (c, n) in enumerate(DESTAQUES, 1))
    run_cli_sql(f"INSERT INTO public.candidaturas_destaque (candidatura_id, ordem) {dest} "
                "ON CONFLICT (candidatura_id) DO UPDATE SET ordem = excluded.ordem; "
                "ANALYZE public.votos_local; ANALYZE public.totais_local; ANALYZE public.locais;", "destaques")
    print(f"ok em {time.time() - t0:.0f}s")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", default="SP")
    p.add_argument("--skip-migrations", action="store_true")
    p.add_argument("--via-cli", action="store_true", help="carrega pelo Supabase CLI logado (sem senha)")
    p.add_argument("--chunk-rows", type=int, default=150_000, help="linhas por lote no modo --via-cli")
    p.add_argument("--only", help="modo --via-cli: atualiza só estas tabelas pequenas (ex.: candidaturas)")
    a = p.parse_args(argv)
    src = get_settings().data_dir / "dashboard" / a.uf.lower()
    if a.via_cli:
        load_via_cli(src, a.chunk_rows, a.only.split(",") if a.only else None)
        return 0
    t0 = time.time()
    with psycopg.connect(db_url(), autocommit=False) as conn, conn.cursor() as cur:
        if not a.skip_migrations:
            for m in sorted(MIGRATIONS.glob("*.sql")):
                print(f"migration {m.name}")
                cur.execute(m.read_text(encoding="utf-8"))
            conn.commit()
        for table, (key, cols) in TABLES.items():
            print(f"upsert {table}")
            upsert(cur, table, key, cols, src / f"{table}.csv")
        print("votos_local / totais_local (substituição completa)")
        cur.execute("TRUNCATE public.votos_local, public.totais_local")
        copy_csv(cur, "public.votos_local", "local_id, candidatura_id, votos", src / "votos_local.csv")
        copy_csv(cur, "public.totais_local", "local_id, cd_cargo, aptos, comparecimento, validos, brancos, nulos",
                 src / "totais_local.csv")
        for ordem, (cargo, numero) in enumerate(DESTAQUES, 1):
            cur.execute("""INSERT INTO public.candidaturas_destaque (candidatura_id, ordem)
                           SELECT id, %s FROM public.candidaturas WHERE cd_cargo = %s AND tipo = 'nominal' AND numero = %s
                           ON CONFLICT (candidatura_id) DO UPDATE SET ordem = excluded.ordem""", (ordem, cargo, numero))
        conn.commit()
        cur.execute("ANALYZE public.votos_local; ANALYZE public.totais_local; ANALYZE public.locais;")
        conn.commit()
        for t in ("municipios", "locais", "candidaturas", "votos_local", "totais_local", "candidaturas_destaque"):
            cur.execute(f"SELECT COUNT(*) FROM public.{t}")
            print(f"  {t}: {cur.fetchone()[0]:,}")
    print(f"ok em {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
