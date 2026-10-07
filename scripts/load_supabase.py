"""Carrega os CSVs de data/dashboard/<uf>/ no Supabase (idempotente, uma UF por vez).

Dois modos:
    python scripts/load_supabase.py --uf MG --via-cli   # sem senha: usa o Supabase CLI logado e o
                                                        # projeto vinculado (`supabase link`)
    python scripts/load_supabase.py --uf MG             # conexão direta (SUPABASE_DB_URL no .env), COPY

As migrations são aplicadas antes com `supabase db push`. Recarregar uma UF substitui só os dados
dela (locais, candidaturas, votos e totais); as outras UFs, os painéis e os acessos são preservados.
Ao final a versão dos dados é atualizada, para o dashboard renovar o cache dos navegadores.
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

from tse2026.config import get_settings

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from export_dashboard import DESTAQUES  # noqa: E402

csv.field_size_limit(1 << 30)

TABLES = {  # tabela -> chave do upsert
    "municipios": "cd_municipio",
    "locais": "id",
    "candidaturas": "id",
}
INT_COLS = {"ano", "id", "cd_ibge", "nr_zona", "nr_local", "qt_secoes", "cd_eleicao", "cd_cargo", "numero",
            "nr_partido", "sq_candidato", "votos_total", "local_id", "candidatura_id", "aptos",
            "comparecimento", "validos", "brancos", "nulos"}
FLOAT_COLS = {"lat", "lon"}
BOOL_COLS = {"coord_aproximada"}
ARRAY_COLS = {"locais": "int[]", "votos": "int[]"}

VERSAO_SQL = ("INSERT INTO public.meta (chave, valor) VALUES ('versao_dados', to_char(now(), 'YYYYMMDDHH24MISS')) "
              "ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor;")


def limpar_uf_sql(uf: str) -> str:
    """Remove votos e totais da UF (serão recarregados)."""
    return (f"DELETE FROM public.votos_cand WHERE candidatura_id IN (SELECT id FROM public.candidaturas WHERE uf = '{uf}'); "
            f"DELETE FROM public.totais_local WHERE local_id IN (SELECT id FROM public.locais WHERE uf = '{uf}');")


def destaques_sql(uf: str) -> str:
    partes = [f"SELECT id, {o} FROM public.candidaturas WHERE uf = '{uf}' AND cd_cargo = {c} AND tipo = 'nominal' "
              f"AND numero = {n}" for o, (c, n) in enumerate(DESTAQUES.get(uf, []), 1)]
    if not partes:
        return ""
    return ("INSERT INTO public.candidaturas_destaque (candidatura_id, ordem) " + " UNION ALL ".join(partes) +
            " ON CONFLICT (candidatura_id) DO UPDATE SET ordem = excluded.ordem;")


def sql_lit(table: str, col: str, v: str) -> str:
    if v == "":
        return "NULL"
    if table == "votos_cand" and col in ARRAY_COLS:
        return f"'{v}'::{ARRAY_COLS[col]}"
    if col in INT_COLS or col in FLOAT_COLS or (table != "votos_cand" and col == "votos"):
        return v
    if col in BOOL_COLS:
        return "true" if v.lower() == "true" else "false"
    return "'" + v.replace("'", "''") + "'"


def rows_of(path: Path) -> tuple[list[str], list[list[str]]]:
    with path.open(encoding="utf-8", newline="") as fh:
        rd = csv.reader(fh)
        header = next(rd)
        return header, list(rd)


def upsert_sql(table: str, key: str | None, header: list[str], rows: list[list[str]]) -> str:
    vals = ",\n".join("(" + ", ".join(sql_lit(table, c, v) for c, v in zip(header, r)) + ")" for r in rows)
    sql = f"INSERT INTO public.{table} ({', '.join(header)}) VALUES\n{vals}"
    if key:
        sets = ", ".join(f"{c} = excluded.{c}" for c in header if c != key)
        sql += f"\nON CONFLICT ({key}) DO UPDATE SET {sets}"
    return sql + ";"


def lotes(rows: list[list[str]], max_bytes: int = 1_800_000):
    """Agrupa linhas em lotes de até ~max_bytes de SQL."""
    lote, tam = [], 0
    for r in rows:
        n = sum(len(x) for x in r) + 8 * len(r)
        if lote and tam + n > max_bytes:
            yield lote
            lote, tam = [], 0
        lote.append(r)
        tam += n
    if lote:
        yield lote


# ---------------------------------------------------------------------------------------------
# Modo --via-cli: lotes de SQL executados pelo Supabase CLI (Management API), sem senha do banco.
# ---------------------------------------------------------------------------------------------
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


def load_via_cli(uf: str, src: Path, only: list[str] | None) -> None:
    t0 = time.time()
    for table, key in TABLES.items():
        if only and table not in only:
            continue
        header, rows = rows_of(src / f"{table}.csv")
        for i, lote in enumerate(lotes(rows)):
            run_cli_sql(upsert_sql(table, key, header, lote), f"{table} lote {i}")
        print(f"upsert {table}: {len(rows):,} linhas ({time.time() - t0:.0f}s)", flush=True)
    if not only:
        run_cli_sql(limpar_uf_sql(uf), "limpeza de votos/totais da UF")
        for table in ("totais_local", "votos_cand"):
            header, rows = rows_of(src / f"{table}.csv")
            feitos = 0
            for i, lote in enumerate(lotes(rows)):
                run_cli_sql(upsert_sql(table, None, header, lote), f"{table} lote {i}")
                feitos += len(lote)
            print(f"  {table}: {feitos:,} linhas ({time.time() - t0:.0f}s)", flush=True)
        dq = destaques_sql(uf)
        if dq:
            run_cli_sql(dq, "destaques")
        run_cli_sql("ANALYZE public.votos_cand; ANALYZE public.totais_local; ANALYZE public.locais; "
                    "ANALYZE public.candidaturas;", "analyze")
    run_cli_sql(VERSAO_SQL, "versão dos dados")
    print(f"ok em {time.time() - t0:.0f}s")


# ---------------------------------------------------------------------------------------------
# Modo conexão direta (COPY)
# ---------------------------------------------------------------------------------------------
def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    env = ROOT / ".env"
    if not url and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("SUPABASE_DB_URL="):
                url = line.split("=", 1)[1].strip().strip('"')
    if not url:
        sys.exit("defina SUPABASE_DB_URL no ambiente ou no .env (ou use --via-cli)")
    return url


def load_direct(uf: str, src: Path) -> None:
    import psycopg

    def copy_csv(cur, table: str, path: Path) -> None:
        header = path.open(encoding="utf-8").readline().strip()
        with cur.copy(f"COPY {table} ({header}) FROM STDIN WITH (FORMAT csv, HEADER true)") as cp:
            with path.open("rb") as fh:
                while chunk := fh.read(1 << 20):
                    cp.write(chunk)

    t0 = time.time()
    with psycopg.connect(db_url(), autocommit=False) as conn, conn.cursor() as cur:
        for table, key in TABLES.items():
            path = src / f"{table}.csv"
            header = path.open(encoding="utf-8").readline().strip()
            cur.execute(f"CREATE TEMP TABLE tmp_{table} (LIKE public.{table} INCLUDING DEFAULTS) ON COMMIT DROP")
            copy_csv(cur, f"tmp_{table}", path)
            sets = ", ".join(f"{c} = excluded.{c}" for c in header.split(",") if c != key)
            cur.execute(f"INSERT INTO public.{table} ({header}) SELECT {header} FROM tmp_{table} "
                        f"ON CONFLICT ({key}) DO UPDATE SET {sets}")
        cur.execute(limpar_uf_sql(uf))
        copy_csv(cur, "public.totais_local", src / "totais_local.csv")
        copy_csv(cur, "public.votos_cand", src / "votos_cand.csv")
        dq = destaques_sql(uf)
        if dq:
            cur.execute(dq)
        cur.execute(VERSAO_SQL)
        conn.commit()
    print(f"ok em {time.time() - t0:.0f}s")


def load_historico(src: Path) -> None:
    """Histórico (ex.: 2022) das candidaturas: substitui o das candidaturas presentes nos arquivos."""
    t0 = time.time()
    h_header, h_rows = rows_of(src / "historico.csv")
    ids = sorted({r[0] for r in h_rows})
    run_cli_sql(f"DELETE FROM public.historico_votos WHERE candidatura_id IN ({','.join(ids)}); "
                f"DELETE FROM public.historico_candidatura WHERE candidatura_id IN ({','.join(ids)});", "limpeza do histórico")
    run_cli_sql(upsert_sql("historico_candidatura", None, h_header, h_rows), "historico_candidatura")
    header, rows = rows_of(src / "historico_comparativo.csv")
    for i, lote in enumerate(lotes(rows)):
        run_cli_sql(upsert_sql("historico_votos", None, header, lote), f"historico_votos lote {i}")
    run_cli_sql(VERSAO_SQL, "versão dos dados")
    print(f"histórico: {len(h_rows)} candidaturas, {len(rows):,} linhas ({time.time() - t0:.0f}s)")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--uf", required=True)
    p.add_argument("--via-cli", action="store_true", help="carrega pelo Supabase CLI logado (sem senha)")
    p.add_argument("--only", help="modo --via-cli: atualiza só estas tabelas pequenas (ex.: candidaturas)")
    p.add_argument("--historico", action="store_true",
                   help="carrega só o histórico (historico.csv / historico_comparativo.csv) pelo Supabase CLI")
    a = p.parse_args(argv)
    uf = a.uf.upper()
    src = get_settings().data_dir / "dashboard" / uf.lower()
    if a.historico:
        load_historico(src)
    elif a.via_cli:
        load_via_cli(uf, src, a.only.split(",") if a.only else None)
    else:
        load_direct(uf, src)
    return 0


if __name__ == "__main__":
    sys.exit(main())
