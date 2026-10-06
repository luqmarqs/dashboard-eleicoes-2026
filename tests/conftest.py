from __future__ import annotations

from pathlib import Path

import pytest

from tse2026.config import Settings
from tse2026.manifest import StateDB

FIXTURES = Path(__file__).parent / "fixtures"
BU_SP_Z1_S1 = FIXTURES / "o03220sp7107200010001-bu.dat"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", max_retries=2, backoff_factor=0.01, backoff_max=0.05,
                    not_found_window=10, not_found_threshold=0.5)


@pytest.fixture
def state(settings: Settings) -> StateDB:
    db = StateDB(settings.state_db)
    yield db
    db.close()


@pytest.fixture
def bu_bytes() -> bytes:
    return BU_SP_Z1_S1.read_bytes()


def section_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "CD_PLEITO": 3220, "SG_UF": "SP", "CD_MUNICIPIO": "71072", "CD_MUNICIPIO_IBGE": 3550308,
        "NM_MUNICIPIO": "SÃO PAULO", "NR_ZONA": 1, "NR_SECAO": 1, "NR_SECAO_PRINCIPAL": None,
        "NR_SECOES_AGREGADAS": None, "DT_RECEBIMENTO": "2026-10-04T22:59:55",
        "metadata_url": "https://example/aux.json", "ds_situacao_aux": "Totalizada", "bu_hash": "abc",
        "ds_situacao_hash": "Totalizado", "qt_hashes": 1, "ballot_url": "https://example/bu.dat",
        "ballot_filename": "ballots/x-bu.dat", "status": "downloaded", "status_reason": None, "error": None,
    }
    row.update(overrides)
    return row
