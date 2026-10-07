"""Cliente da API `ads_archive`: retentativas limitadas, limites de uso, erros classificados e saneamento.

O token só existe neste processo: nunca entra em log, em mensagem de erro, no banco ou em URL guardada.
A paginação usa o cursor `after` (o link `paging.next` da Meta traz o token embutido e é descartado).
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx

VERSAO_PADRAO = "v26.0"  # versão mais recente na documentação oficial em 2026-10-07 (lançada em 2026-07-29)
BASE = "https://graph.facebook.com"
ENV_LOCAL = Path(".env.meta.local")  # ignorado pelo git (.env.*)

_RE_TOKEN_QS = re.compile(r"(access_token=)[^&\s\"']+", re.I)


class MetaErro(Exception):
    """Erro da API já saneado (sem token)."""

    def __init__(self, msg: str, *, http: int | None = None, code: int | None = None, subcode: int | None = None):
        super().__init__(msg)
        self.http, self.code, self.subcode = http, code, subcode


class TokenInvalido(MetaErro):
    """Código 190: token inválido, expirado (subcódigo 463) ou revogado. Não adianta tentar de novo."""


class PermissaoInsuficiente(MetaErro):
    """Códigos 10 e 200–299: a conta/app não tem acesso à Biblioteca de Anúncios para este recorte."""


class ParametroInvalido(MetaErro):
    """Código 100: parâmetro ou campo recusado pela API."""


class LimiteDeUso(MetaErro):
    """Limite de chamadas esgotado mesmo após as esperas permitidas."""


class Transitorio(MetaErro):
    """Falha temporária (5xx, códigos 1/2, timeout) que persistiu após as retentativas."""


CODIGOS_LIMITE = {4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014}
CODIGOS_TRANSITORIOS = {1, 2}


def carregar_token() -> str:
    """META_ACCESS_TOKEN do ambiente ou de .env.meta.local (nessa ordem)."""
    tok = os.environ.get("META_ACCESS_TOKEN", "").strip()
    if not tok and ENV_LOCAL.exists():
        m = re.search(r"^META_ACCESS_TOKEN=(\S+)", ENV_LOCAL.read_text(encoding="utf-8"), re.M)
        tok = m[1] if m else ""
    if not tok:
        raise TokenInvalido("META_ACCESS_TOKEN ausente (ambiente ou .env.meta.local)")
    return tok


def versao_api() -> str:
    return os.environ.get("META_GRAPH_API_VERSION", VERSAO_PADRAO).strip() or VERSAO_PADRAO


def sanear(texto: Any, token: str | None = None) -> str:
    """Remove o token de qualquer texto (mensagens, URLs, JSON)."""
    s = str(texto)
    if token:
        s = s.replace(token, "<token>")
    return _RE_TOKEN_QS.sub(r"\1<token>", s)


def sanear_obj(obj: Any, token: str | None = None) -> Any:
    """Saneia recursivamente um objeto JSON; `ad_snapshot_url` (que traz o token) é removido."""
    if isinstance(obj, dict):
        return {k: sanear_obj(v, token) for k, v in obj.items() if k != "ad_snapshot_url"}
    if isinstance(obj, list):
        return [sanear_obj(v, token) for v in obj]
    if isinstance(obj, str):
        return sanear(obj, token)
    return obj


def link_publico(ad_id: str) -> str:
    """Link público da Biblioteca de Anúncios (não precisa de token)."""
    return f"https://www.facebook.com/ads/library/?id={ad_id}"


@dataclass
class Uso:
    """Último cabeçalho de uso devolvido pela Meta (x-business-use-case-usage / x-app-usage)."""

    pct: float = 0.0
    espera_min: float = 0.0
    chamadas: int = 0


@dataclass
class Cliente:
    token: str
    versao: str = field(default_factory=versao_api)
    timeout: float = 60.0
    max_tentativas: int = 5
    backoff_base: float = 2.0
    backoff_max: float = 300.0
    limite_pct: float = 85.0  # acima disso, pausa preventiva
    dormir: Callable[[float], None] = time.sleep
    http: httpx.Client | None = None
    uso: Uso = field(default_factory=Uso)

    def __post_init__(self) -> None:
        self.http = self.http or httpx.Client(timeout=self.timeout)

    def _ler_uso(self, headers: httpx.Headers) -> None:
        pct, espera = 0.0, 0.0
        for nome in ("x-business-use-case-usage", "x-app-usage", "x-ad-account-usage"):
            bruto = headers.get(nome)
            if not bruto:
                continue
            try:
                dados = json.loads(bruto)
            except ValueError:
                continue
            itens = [i for v in dados.values() for i in v] if nome == "x-business-use-case-usage" else [dados]
            for i in itens:
                pct = max(pct, *(float(i.get(k) or 0) for k in ("call_count", "total_cputime", "total_time")))
                espera = max(espera, float(i.get("estimated_time_to_regain_access") or 0))
        self.uso = Uso(pct=pct, espera_min=espera, chamadas=self.uso.chamadas + 1)

    def get(self, params: dict[str, Any]) -> dict[str, Any]:
        """Uma chamada a /ads_archive com retentativas. Devolve o JSON (sem saneamento: quem guarda saneia)."""
        url = f"{BASE}/{self.versao}/ads_archive"
        q = {k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in params.items()}
        q["access_token"] = self.token
        ultimo: MetaErro | None = None
        for tentativa in range(self.max_tentativas):
            if self.uso.espera_min > 0 or self.uso.pct >= self.limite_pct:
                self.dormir(min(self.backoff_max, max(60.0, self.uso.espera_min * 60)))
                self.uso.espera_min, self.uso.pct = 0.0, 0.0
            try:
                r = self.http.get(url, params=q)
            except httpx.HTTPError as e:
                ultimo = Transitorio(f"falha de rede: {type(e).__name__}")
                self.dormir(min(self.backoff_max, self.backoff_base ** (tentativa + 1)))
                continue
            self._ler_uso(r.headers)
            if r.status_code == 200:
                return r.json()
            try:
                err = r.json().get("error", {})
            except ValueError:
                err = {}
            code, sub = err.get("code"), err.get("error_subcode")
            msg = sanear(f"HTTP {r.status_code} code={code} subcode={sub}: {err.get('message', '')[:300]}", self.token)
            if code == 190:
                raise TokenInvalido(msg, http=r.status_code, code=code, subcode=sub)
            if code == 10 or (isinstance(code, int) and 200 <= code <= 299):
                raise PermissaoInsuficiente(msg, http=r.status_code, code=code, subcode=sub)
            if code in CODIGOS_LIMITE or r.status_code == 429:
                ultimo = LimiteDeUso(msg, http=r.status_code, code=code, subcode=sub)
                self.dormir(min(self.backoff_max, max(60.0, self.uso.espera_min * 60, self.backoff_base ** (tentativa + 3))))
                continue
            if code in CODIGOS_TRANSITORIOS or r.status_code >= 500 or err.get("is_transient"):
                ultimo = Transitorio(msg, http=r.status_code, code=code, subcode=sub)
                self.dormir(min(self.backoff_max, self.backoff_base ** (tentativa + 1)))
                continue
            if code == 100:
                raise ParametroInvalido(msg, http=r.status_code, code=code, subcode=sub)
            raise MetaErro(msg, http=r.status_code, code=code, subcode=sub)
        assert ultimo is not None
        raise ultimo

    def paginar(self, params: dict[str, Any], after: str | None = None, limit: int = 250,
                max_paginas: int | None = None) -> Iterator[tuple[list[dict[str, Any]], str | None]]:
        """Itera páginas de resultados: (anúncios, cursor para continuar ou None se acabou)."""
        n = 0
        while True:
            p = dict(params, limit=limit)
            if after:
                p["after"] = after
            d = self.get(p)
            paging = d.get("paging") or {}
            after = (paging.get("cursors") or {}).get("after") if paging.get("next") else None
            n += 1
            yield d.get("data") or [], after
            if not after or (max_paginas and n >= max_paginas):
                return
