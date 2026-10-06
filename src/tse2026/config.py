"""Configuração centralizada. Todos os parâmetros podem ser sobrescritos por variáveis de ambiente."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field


def _env(name: str, default: str) -> str:
    return os.environ.get(f"TSE2026_{name}", os.environ.get(name, default))


class Settings(BaseModel):
    base_url: str = "https://resultados.tse.jus.br"
    ambiente: str = "oficial"
    ano_eleicao: int = 2026
    ciclo: str = "ele2026"

    max_concurrency: int = Field(12, ge=1, le=50)
    request_timeout: float = 30.0
    max_retries: int = Field(5, ge=0, le=10)
    backoff_factor: float = 1.0
    backoff_max: float = 60.0
    user_agent: str = "tse2026-coletor/0.1 (+pesquisa; download conservador)"

    # Disjuntor de 404: se mais de `not_found_threshold` das últimas `not_found_window`
    # requisições não-opcionais derem 404, o download é interrompido para investigação.
    not_found_window: int = 200
    not_found_threshold: float = 0.5

    data_dir: Path = Path("data")

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def staging_dir(self) -> Path:
        return self.data_dir / "staging"

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def manifests_dir(self) -> Path:
        return self.data_dir / "manifests"

    @property
    def validation_dir(self) -> Path:
        return self.data_dir / "validation"

    @property
    def state_db(self) -> Path:
        return self.manifests_dir / "state.sqlite"

    @property
    def dataset_dir(self) -> Path:
        return self.processed_dir / f"votacao_secao_{self.ano_eleicao}"

    @property
    def sections_dataset_dir(self) -> Path:
        return self.processed_dir / f"secoes_{self.ano_eleicao}"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            base_url=_env("BASE_URL", cls.model_fields["base_url"].default),
            ambiente=_env("AMBIENTE", cls.model_fields["ambiente"].default),
            max_concurrency=int(_env("MAX_CONCURRENCY", "12")),
            request_timeout=float(_env("REQUEST_TIMEOUT", "30")),
            max_retries=int(_env("MAX_RETRIES", "5")),
            backoff_factor=float(_env("BACKOFF_FACTOR", "1.0")),
            data_dir=Path(_env("DATA_DIR", "data")),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
