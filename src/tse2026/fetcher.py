"""Baixa um arquivo, grava no RawStore e registra no manifest (com reaproveitamento)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .client import HttpClient
from .endpoints import Endpoints
from .exceptions import FetchError, NotFoundError
from .manifest import StateDB
from .storage import RawStore, utcnow_iso


@dataclass(frozen=True)
class FileIds:
    uf: str | None = None
    municipio: str | None = None
    zona: int | None = None
    secao: int | None = None


@dataclass(frozen=True)
class StoredFile:
    url: str
    path: Path
    sha256: str
    reused: bool

    def read_bytes(self) -> bytes:
        return self.path.read_bytes()


class Fetcher:
    def __init__(self, client: HttpClient, store: RawStore, state: StateDB, endpoints: Endpoints) -> None:
        self.client = client
        self.store = store
        self.state = state
        self.endpoints = endpoints

    def local_path(self, url: str, category: str) -> Path:
        return self.store.path_for(category, self.endpoints.relative_path(url))

    def cached(self, url: str, category: str) -> StoredFile | None:
        """Arquivo já baixado corretamente (existe, tamanho e hash conferem com o manifest)."""
        row = self.state.get_file(url)
        if row is None or row["status"] not in ("downloaded", "parsed", "validated") or not row["sha256"]:
            return None
        path = self.local_path(url, category)
        if not self.store.is_valid(path, row["sha256"], row["bytes"]):
            return None
        return StoredFile(url, path, row["sha256"], reused=True)

    async def fetch(
        self,
        url: str,
        *,
        category: str,
        tipo: str,
        ids: FileIds = FileIds(),
        expect_json: bool = False,
        optional: bool = False,
        refresh: bool = False,
    ) -> StoredFile:
        """Baixa (ou reaproveita) `url`. `refresh=True` força novo download (metadados mutáveis)."""
        if not refresh:
            hit = self.cached(url, category)
            if hit is not None:
                return hit

        base = dict(uf=ids.uf, municipio=ids.municipio, zona=ids.zona, secao=ids.secao)
        self.state.upsert_file(url, tipo, status="downloading", **base)
        self.state.increment_attempts(url)
        try:
            result = await self.client.get(url, expect_json=expect_json, optional=optional)
        except NotFoundError:
            # 404 esperado (arquivo opcional, ex.: cargo inexistente na UF) não é erro.
            status = "not_found" if optional else "error"
            self.state.upsert_file(url, tipo, status=status, http_status=404, error="404 não encontrado", **base)
            raise
        except FetchError as exc:
            self.state.upsert_file(url, tipo, status="error", http_status=exc.http_status, error=exc.reason, **base)
            raise

        path = self.local_path(url, category)
        digest, _ = self.store.write(path, result.content)
        self.state.upsert_file(
            url,
            tipo,
            status="downloaded",
            filename=self.store.relative(path),
            sha256=digest,
            http_status=result.http_status,
            bytes=len(result.content),
            downloaded_at=utcnow_iso(),
            error=None,
            **base,
        )
        return StoredFile(url, path, digest, reused=False)
