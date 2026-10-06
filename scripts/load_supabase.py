"""Carrega os CSVs de data/dashboard/<uf>/ no Postgres do Supabase (COPY, idempotente).

Requer a variável SUPABASE_DB_URL (connection string do Postgres, em Project Settings > Database;
use a do "Session pooler"), lida do ambiente ou do arquivo .env na raiz do repositório.

Uso:
    python scripts/load_supabase.py --uf SP                 # aplica migrations e carrega
    python scripts/load_supabase.py --uf SP --skip-migrations

Painéis personalizados e destaques já existentes são preservados (as candidaturas são atualizadas
por upsert, com ids estáveis).
"""

from __future__ import annotations

import argparse
import os
import sys
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
                           "sg_partido, sq_candidato, destinacao, votos_total"),
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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", default="SP")
    p.add_argument("--skip-migrations", action="store_true")
    a = p.parse_args(argv)
    src = get_settings().data_dir / "dashboard" / a.uf.lower()
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
