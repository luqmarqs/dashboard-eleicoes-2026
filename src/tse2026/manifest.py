"""Estado persistente (checkpoint) do pipeline.

O estado "vivo" fica em SQLite (escritas incrementais e seguras contra
interrupção). Os manifests em Parquet (files/sections/errors) são exportados a
partir dele ao final de cada etapa.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .storage import utcnow_iso

SECTION_STATUSES = ("pending", "downloading", "downloaded", "parsed", "validated", "error", "skipped")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    url            TEXT PRIMARY KEY,
    tipo_arquivo   TEXT NOT NULL,
    uf             TEXT,
    municipio      TEXT,
    zona           INTEGER,
    secao          INTEGER,
    filename       TEXT,
    sha256         TEXT,
    http_status    INTEGER,
    bytes          INTEGER,
    downloaded_at  TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    parsed         INTEGER NOT NULL DEFAULT 0,
    parse_status   TEXT,
    error          TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS files_status ON files(status);

CREATE TABLE IF NOT EXISTS sections (
    CD_PLEITO            INTEGER NOT NULL,
    SG_UF                TEXT NOT NULL,
    CD_MUNICIPIO         TEXT NOT NULL,
    CD_MUNICIPIO_IBGE    INTEGER,
    NM_MUNICIPIO         TEXT,
    NR_ZONA              INTEGER NOT NULL,
    NR_SECAO             INTEGER NOT NULL,
    NR_SECAO_PRINCIPAL   INTEGER,
    NR_SECOES_AGREGADAS  TEXT,
    DT_RECEBIMENTO       TEXT,
    metadata_url         TEXT,
    ds_situacao_aux      TEXT,
    bu_hash              TEXT,
    ds_situacao_hash     TEXT,
    qt_hashes            INTEGER,
    ballot_url           TEXT,
    ballot_filename      TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    status_reason        TEXT,
    error                TEXT,
    updated_at           TEXT,
    PRIMARY KEY (CD_PLEITO, SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO)
);
CREATE INDEX IF NOT EXISTS sections_status ON sections(CD_PLEITO, SG_UF, status);
"""

SECTION_COLUMNS = (
    "CD_PLEITO", "SG_UF", "CD_MUNICIPIO", "CD_MUNICIPIO_IBGE", "NM_MUNICIPIO", "NR_ZONA", "NR_SECAO",
    "NR_SECAO_PRINCIPAL", "NR_SECOES_AGREGADAS", "DT_RECEBIMENTO", "metadata_url", "ds_situacao_aux",
    "bu_hash", "ds_situacao_hash", "qt_hashes", "ballot_url", "ballot_filename", "status",
    "status_reason", "error", "updated_at",
)
SECTION_KEY = ("CD_PLEITO", "SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_SECAO")
INVENTORY_COLUMNS = SECTION_COLUMNS[:10]


@dataclass(frozen=True)
class SectionFilter:
    pleito: int
    uf: str | None = None
    municipio: str | None = None
    zona: int | None = None
    secao: int | None = None

    def where(self) -> tuple[str, list[Any]]:
        clauses, params = ["CD_PLEITO = ?"], [self.pleito]
        if self.uf:
            clauses.append("SG_UF = ?")
            params.append(self.uf.upper())
        if self.municipio:
            clauses.append("CD_MUNICIPIO = ?")
            params.append(str(self.municipio).zfill(5))
        if self.zona is not None:
            clauses.append("NR_ZONA = ?")
            params.append(int(self.zona))
        if self.secao is not None:
            clauses.append("NR_SECAO = ?")
            params.append(int(self.secao))
        return " AND ".join(clauses), params


class StateDB:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(_SCHEMA)
        self._in_tx = False

    # -- transações -----------------------------------------------------------
    def begin(self) -> None:
        if not self._in_tx:
            self.conn.execute("BEGIN")
            self._in_tx = True

    def commit(self) -> None:
        if self._in_tx:
            self.conn.execute("COMMIT")
            self._in_tx = False

    def close(self) -> None:
        self.commit()
        self.conn.close()

    # -- arquivos -------------------------------------------------------------
    def get_file(self, url: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM files WHERE url = ?", (url,)).fetchone()

    def upsert_file(self, url: str, tipo_arquivo: str, **fields: Any) -> None:
        fields = {"tipo_arquivo": tipo_arquivo, "updated_at": utcnow_iso(), **fields}
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        updates = ", ".join(f"{c} = excluded.{c}" for c in fields)
        self.conn.execute(
            f"INSERT INTO files (url, {cols}) VALUES (?, {marks}) ON CONFLICT(url) DO UPDATE SET {updates}",
            (url, *fields.values()),
        )

    def increment_attempts(self, url: str) -> None:
        self.conn.execute("UPDATE files SET attempts = attempts + 1 WHERE url = ?", (url,))

    # -- seções ---------------------------------------------------------------
    def upsert_inventory(self, rows: Iterable[dict[str, Any]]) -> int:
        """Insere/atualiza o inventário sem apagar o progresso já registrado."""
        cols = INVENTORY_COLUMNS + ("metadata_url", "status", "status_reason", "updated_at")
        cols = tuple(dict.fromkeys(cols))
        non_key = [c for c in cols if c not in SECTION_KEY and c not in ("status", "status_reason")]
        sql = (
            f"INSERT INTO sections ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
            f"ON CONFLICT({', '.join(SECTION_KEY)}) DO UPDATE SET "
            + ", ".join(f"{c} = excluded.{c}" for c in non_key)
        )
        now = utcnow_iso()
        n = 0
        self.begin()
        for row in rows:
            row = {**row, "updated_at": now}
            row.setdefault("status", "pending")
            row.setdefault("status_reason", None)
            self.conn.execute(sql, tuple(row.get(c) for c in cols))
            n += 1
        self.commit()
        return n

    def update_section(self, key: tuple[Any, ...], **fields: Any) -> None:
        fields["updated_at"] = utcnow_iso()
        sets = ", ".join(f"{c} = ?" for c in fields)
        where = " AND ".join(f"{c} = ?" for c in SECTION_KEY)
        self.conn.execute(f"UPDATE sections SET {sets} WHERE {where}", (*fields.values(), *key))

    def iter_sections(self, flt: SectionFilter, statuses: Iterable[str] | None = None) -> Iterator[sqlite3.Row]:
        where, params = flt.where()
        if statuses is not None:
            statuses = list(statuses)
            where += f" AND status IN ({', '.join('?' for _ in statuses)})"
            params += statuses
        sql = f"SELECT * FROM sections WHERE {where} ORDER BY SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO"
        yield from self.conn.execute(sql, params).fetchall()

    def count_by_status(self, flt: SectionFilter) -> dict[str, int]:
        where, params = flt.where()
        rows = self.conn.execute(f"SELECT status, COUNT(*) n FROM sections WHERE {where} GROUP BY status", params)
        return {r["status"]: r["n"] for r in rows}

    def reset_stale_downloading(self, flt: SectionFilter) -> int:
        """Seções que ficaram em 'downloading' por interrupção voltam para 'pending'."""
        where, params = flt.where()
        cur = self.conn.execute(
            f"UPDATE sections SET status = 'pending' WHERE {where} AND status = 'downloading'", params
        )
        return cur.rowcount

    def mark_sections(self, flt: SectionFilter, from_statuses: Iterable[str], to_status: str) -> int:
        where, params = flt.where()
        from_statuses = list(from_statuses)
        cur = self.conn.execute(
            f"UPDATE sections SET status = ?, updated_at = ? WHERE {where} "
            f"AND status IN ({', '.join('?' for _ in from_statuses)})",
            [to_status, utcnow_iso(), *params, *from_statuses],
        )
        return cur.rowcount

    # -- exportação -----------------------------------------------------------
    def export_parquet(self, manifests_dir: Path) -> dict[str, Path]:
        manifests_dir.mkdir(parents=True, exist_ok=True)
        out = {
            "files": manifests_dir / "files.parquet",
            "sections": manifests_dir / "sections.parquet",
            "errors": manifests_dir / "errors.parquet",
        }
        _write_query(self.conn, "SELECT * FROM files ORDER BY url", out["files"], _FILES_TYPES)
        _write_query(
            self.conn,
            "SELECT * FROM sections ORDER BY CD_PLEITO, SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO",
            out["sections"],
            _SECTIONS_TYPES,
        )
        _write_query(
            self.conn,
            """
            SELECT 'section' AS origem, url_or_key, tipo, uf, municipio, zona, secao, error, updated_at FROM (
                SELECT CD_PLEITO || '/' || SG_UF || '/' || CD_MUNICIPIO || '/' || NR_ZONA || '/' || NR_SECAO AS url_or_key,
                       status AS tipo, SG_UF AS uf, CD_MUNICIPIO AS municipio, NR_ZONA AS zona, NR_SECAO AS secao,
                       error, updated_at
                FROM sections WHERE status = 'error'
            )
            UNION ALL
            SELECT 'file', url, tipo_arquivo, uf, municipio, zona, secao, error, updated_at
            FROM files WHERE status = 'error' OR parse_status = 'error'
            """,
            out["errors"],
            _ERRORS_TYPES,
        )
        return out


_FILES_TYPES = {
    "url": pa.string(), "tipo_arquivo": pa.string(), "uf": pa.string(), "municipio": pa.string(),
    "zona": pa.int32(), "secao": pa.int32(), "filename": pa.string(), "sha256": pa.string(),
    "http_status": pa.int16(), "bytes": pa.int64(), "downloaded_at": pa.string(), "status": pa.string(),
    "parsed": pa.bool_(), "parse_status": pa.string(), "error": pa.string(), "attempts": pa.int16(),
    "updated_at": pa.string(),
}
_SECTIONS_TYPES = {
    "CD_PLEITO": pa.int32(), "SG_UF": pa.string(), "CD_MUNICIPIO": pa.string(), "CD_MUNICIPIO_IBGE": pa.int32(),
    "NM_MUNICIPIO": pa.string(), "NR_ZONA": pa.int32(), "NR_SECAO": pa.int32(), "NR_SECAO_PRINCIPAL": pa.int32(),
    "NR_SECOES_AGREGADAS": pa.string(), "DT_RECEBIMENTO": pa.string(), "metadata_url": pa.string(),
    "ds_situacao_aux": pa.string(), "bu_hash": pa.string(), "ds_situacao_hash": pa.string(),
    "qt_hashes": pa.int16(), "ballot_url": pa.string(), "ballot_filename": pa.string(), "status": pa.string(),
    "status_reason": pa.string(), "error": pa.string(), "updated_at": pa.string(),
}
_ERRORS_TYPES = {
    "origem": pa.string(), "url_or_key": pa.string(), "tipo": pa.string(), "uf": pa.string(),
    "municipio": pa.string(), "zona": pa.int32(), "secao": pa.int32(), "error": pa.string(),
    "updated_at": pa.string(),
}


def _write_query(conn: sqlite3.Connection, sql: str, path: Path, types: dict[str, pa.DataType]) -> None:
    schema = pa.schema([(name, typ) for name, typ in types.items()])
    tmp = path.with_suffix(".parquet.part")
    cur = conn.execute(sql)
    with pq.ParquetWriter(tmp, schema, compression="zstd") as writer:
        while True:
            rows = cur.fetchmany(100_000)
            if not rows:
                break
            cols = {name: [r[name] for r in rows] for name in types}
            if "parsed" in cols:
                cols["parsed"] = [bool(v) for v in cols["parsed"]]
            writer.write_table(pa.table(cols, schema=schema))
    tmp.replace(path)
