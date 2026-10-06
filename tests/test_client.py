"""Tratamento de erros HTTP: retry, 404 sem retry, JSON malformado, disjuntor."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from tse2026.client import HttpClient
from tse2026.config import Settings
from tse2026.exceptions import FetchError, NotFoundError, TooManyNotFoundError

URL = "https://resultados.tse.jus.br/oficial/x.json"


def run(settings: Settings, handler, url: str = URL, **kw):  # type: ignore[no-untyped-def]
    async def go():  # type: ignore[no-untyped-def]
        async with HttpClient(settings, transport=httpx.MockTransport(handler)) as c:
            return await c.get(url, **kw), c.stats

    return asyncio.run(go())


def sequence(*responses):  # type: ignore[no-untyped-def]
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        r = responses[min(len(calls), len(responses) - 1)]
        calls.append(request)
        if isinstance(r, Exception):
            raise r
        return r

    return handler, calls


def test_retry_em_5xx_e_conexao(settings: Settings) -> None:
    handler, calls = sequence(
        httpx.Response(503),
        httpx.ConnectError("reset"),
        httpx.Response(200, content=b"{}"),
    )
    result, stats = run(settings, handler, expect_json=True)
    assert result.http_status == 200 and len(calls) == 3 and stats["retries"] == 2


def test_retry_em_429(settings: Settings) -> None:
    handler, calls = sequence(httpx.Response(429, headers={"retry-after": "0"}), httpx.Response(200, content=b"ok"))
    result, _ = run(settings, handler)
    assert result.content == b"ok" and len(calls) == 2


def test_404_sem_retry(settings: Settings) -> None:
    handler, calls = sequence(httpx.Response(404))
    with pytest.raises(NotFoundError):
        run(settings, handler)
    assert len(calls) == 1


def test_json_malformado_esgota_tentativas(settings: Settings) -> None:
    handler, calls = sequence(httpx.Response(200, content=b'{"truncado": '))
    with pytest.raises(FetchError, match="JSON malformado"):
        run(settings, handler, expect_json=True)
    assert len(calls) == settings.max_retries + 1


def test_timeout_esgota_tentativas(settings: Settings) -> None:
    handler, calls = sequence(httpx.ReadTimeout("lento"))
    with pytest.raises(FetchError, match="ReadTimeout"):
        run(settings, handler)
    assert len(calls) == settings.max_retries + 1


def test_disjuntor_de_404(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async def go() -> None:
        async with HttpClient(settings, transport=httpx.MockTransport(handler)) as c:
            for i in range(settings.not_found_window):
                try:
                    await c.get(f"{URL}?{i}")
                except NotFoundError:
                    pass

    with pytest.raises(TooManyNotFoundError):
        asyncio.run(go())


def test_404_opcional_nao_alimenta_disjuntor(settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    async def go() -> None:
        async with HttpClient(settings, transport=httpx.MockTransport(handler)) as c:
            for i in range(settings.not_found_window * 2):
                with pytest.raises(NotFoundError):
                    await c.get(f"{URL}?{i}", optional=True)

    asyncio.run(go())
