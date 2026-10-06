"""Armazenamento dos arquivos brutos (espelho das URLs do TSE no disco)."""

from __future__ import annotations

import hashlib
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .log import get_logger

log = get_logger("storage")

CATEGORIES = ("metadata", "sections", "ballots")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class RawStore:
    """Grava arquivos brutos em `raw/<categoria>/<caminho da URL>`.

    Nunca sobrescreve silenciosamente: se já existe um arquivo com conteúdo
    diferente, a versão anterior é movida para `_history/` ao lado dele.
    """

    def __init__(self, raw_dir: Path) -> None:
        self.raw_dir = raw_dir

    def path_for(self, category: str, relative_url_path: str) -> Path:
        if category not in CATEGORIES:
            raise ValueError(f"categoria inválida: {category}")
        return self.raw_dir / category / Path(relative_url_path)

    def relative(self, path: Path) -> str:
        return path.relative_to(self.raw_dir).as_posix()

    def write(self, path: Path, data: bytes) -> tuple[str, bool]:
        """Grava `data` em `path` de forma atômica. Retorna (sha256, alterado)."""
        digest = sha256_bytes(data)
        if path.exists():
            if sha256_file(path) == digest:
                return digest, False
            self._archive(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return digest, True

    def _archive(self, path: Path) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        hist = path.parent / "_history"
        hist.mkdir(exist_ok=True)
        target = hist / f"{path.name}.{stamp}"
        shutil.move(str(path), target)
        log.warning("arquivo bruto alterado no servidor; versão anterior arquivada", extra={"path": str(target)})

    def is_valid(self, path: Path, expected_sha: str | None, expected_size: int | None = None) -> bool:
        """Confere existência, tamanho e hash de um arquivo já baixado."""
        if not path.exists():
            return False
        if expected_size is not None and path.stat().st_size != expected_size:
            return False
        if expected_sha is not None and sha256_file(path) != expected_sha:
            return False
        return True
