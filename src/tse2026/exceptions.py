"""Exceções do coletor."""


class TSE2026Error(Exception):
    """Erro base do coletor."""


class DiscoveryError(TSE2026Error):
    """Não foi possível identificar o pleito/estrutura esperada."""


class FetchError(TSE2026Error):
    """Falha definitiva ao baixar um arquivo (após retries)."""

    def __init__(self, url: str, reason: str, http_status: int | None = None) -> None:
        super().__init__(f"{reason} [{http_status}] {url}")
        self.url = url
        self.reason = reason
        self.http_status = http_status


class NotFoundError(FetchError):
    """HTTP 404: o arquivo não existe (não é feito retry agressivo)."""


class TooManyNotFoundError(TSE2026Error):
    """Disjuntor: proporção anormal de 404, indicando URL/estrutura errada."""


class IntegrityError(TSE2026Error):
    """Arquivo baixado incompleto ou malformado."""


class BUDecodeError(TSE2026Error):
    """Boletim de Urna não pôde ser decodificado com a especificação ASN.1 conhecida."""
