"""Cliente HTTP assíncrono, conservador, com retry exponencial + jitter."""

from __future__ import annotations

import asyncio
import json
import random
import time
from collections import deque
from dataclasses import dataclass
from types import TracebackType

import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from .config import Settings
from .exceptions import FetchError, IntegrityError, NotFoundError, TooManyNotFoundError
from .log import get_logger

log = get_logger("client")


class RetryableError(Exception):
    def __init__(self, reason: str, http_status: int | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.http_status = http_status


@dataclass(frozen=True)
class FetchResult:
    url: str
    http_status: int
    content: bytes

    def json(self) -> object:
        return json.loads(self.content)


class NotFoundBreaker:
    """Interrompe a execução se a proporção de 404 ficar anormal."""

    def __init__(self, window: int, threshold: float) -> None:
        self.window = window
        self.threshold = threshold
        self.events: deque[bool] = deque(maxlen=window)

    def record(self, not_found: bool) -> None:
        self.events.append(not_found)
        if len(self.events) == self.window:
            ratio = sum(self.events) / self.window
            if ratio > self.threshold:
                raise TooManyNotFoundError(
                    f"{ratio:.0%} das últimas {self.window} requisições deram 404; "
                    "provável mudança de estrutura/URL. Investigue antes de continuar."
                )


def validate_payload(content: bytes, headers: httpx.Headers, expect_json: bool) -> None:
    """Detecta respostas truncadas ou JSON malformado (ambos tratados como transitórios)."""
    declared = headers.get("content-length")
    if declared and not headers.get("content-encoding") and int(declared) != len(content):
        raise IntegrityError(f"tamanho divergente: content-length={declared} recebido={len(content)}")
    if expect_json:
        try:
            json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IntegrityError(f"JSON malformado: {exc}") from exc


class HttpClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport
        self.semaphore = asyncio.Semaphore(settings.max_concurrency)
        self.breaker = NotFoundBreaker(settings.not_found_window, settings.not_found_threshold)
        self._pause_until = 0.0
        self._client: httpx.AsyncClient | None = None
        self.stats = {"requests": 0, "retries": 0, "not_found": 0, "errors": 0}

    async def __aenter__(self) -> "HttpClient":
        limits = httpx.Limits(
            max_connections=self.settings.max_concurrency,
            max_keepalive_connections=self.settings.max_concurrency,
        )
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.request_timeout, connect=min(10.0, self.settings.request_timeout)),
            limits=limits,
            headers={"User-Agent": self.settings.user_agent, "Accept-Encoding": "gzip"},
            follow_redirects=True,
            transport=self._transport,
        )
        return self

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def get(self, url: str, *, expect_json: bool = False, optional: bool = False) -> FetchResult:
        """Baixa `url`. 404 levanta NotFoundError sem retry.

        `optional=True` indica que um 404 é esperado em alguns casos (não alimenta o disjuntor).
        """
        retrying = AsyncRetrying(
            retry=retry_if_exception_type(RetryableError),
            stop=stop_after_attempt(self.settings.max_retries + 1),
            wait=wait_exponential_jitter(initial=self.settings.backoff_factor, max=self.settings.backoff_max),
            reraise=True,
            before_sleep=self._before_sleep,
        )
        try:
            async for attempt in retrying:
                with attempt:
                    return await self._get_once(url, expect_json, optional)
        except RetryableError as exc:
            self.stats["errors"] += 1
            raise FetchError(url, f"esgotadas as tentativas: {exc.reason}", exc.http_status) from exc
        raise AssertionError("unreachable")

    def _before_sleep(self, retry_state: object) -> None:
        self.stats["retries"] += 1
        exc = retry_state.outcome.exception()  # type: ignore[attr-defined]
        log.debug("retry", extra={"reason": str(exc), "attempt": retry_state.attempt_number})  # type: ignore[attr-defined]

    async def _get_once(self, url: str, expect_json: bool, optional: bool) -> FetchResult:
        assert self._client is not None, "use 'async with HttpClient(...)'"
        async with self.semaphore:
            delay = self._pause_until - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self.stats["requests"] += 1
            try:
                resp = await self._client.get(url)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                raise RetryableError(f"{type(exc).__name__}: {exc}") from exc

            status = resp.status_code
            if status == 404:
                self.stats["not_found"] += 1
                if not optional:
                    self.breaker.record(True)
                raise NotFoundError(url, "não encontrado", 404)
            if not optional:
                self.breaker.record(False)
            if status == 429:
                retry_after = _parse_retry_after(resp.headers.get("retry-after"))
                self._pause_until = max(self._pause_until, time.monotonic() + retry_after)
                log.warning("HTTP 429: pausando requisições", extra={"segundos": retry_after})
                raise RetryableError("HTTP 429", status)
            # 304 sem requisição condicional foi observado na CDN do TSE: transitório.
            if status >= 500 or status == 304:
                raise RetryableError(f"HTTP {status}", status)
            if status != 200:
                raise FetchError(url, f"HTTP {status} inesperado", status)

            content = resp.content
            try:
                validate_payload(content, resp.headers, expect_json)
            except IntegrityError as exc:
                raise RetryableError(str(exc), status) from exc
            return FetchResult(url=url, http_status=status, content=content)


def _parse_retry_after(value: str | None) -> float:
    try:
        return min(max(float(value), 1.0), 300.0) if value else 30.0 + random.uniform(0, 5)
    except ValueError:
        return 30.0
