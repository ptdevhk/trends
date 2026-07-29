"""Guarded HTTP fetcher for the web research layer.

One object that satisfies every duck-typed fetch interface consumed by the
discovery layer:

- ``fetch(url, expected_domain=None) -> dict`` — page fetch + classify input,
  delegated to the existing governed ``GuardedEvidenceFetcher``.
- ``fetch_text(url) -> str`` — raw HTML for the DuckDuckGo search provider.
- ``post_json(url, payload, headers=None) -> dict`` — JSON POST for Tavily.
- ``get_json(url, headers=None) -> dict`` — JSON GET for Brave.

All network paths reuse the same safety posture as the evidence fetcher
(``safe_public_evidence_url`` + ``_resolved_host_is_public``), a bounded
timeout, and a 1MB read cap. Header values (provider API keys) are never
logged by this module.
"""

from __future__ import annotations

import json
import socket
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from apps.worker.industry_evidence_research import (
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    GuardedEvidenceFetcher,
    _resolved_host_is_public,
    safe_public_evidence_url,
)

MAX_BODY_BYTES = 1_000_000
USER_AGENT = "TrendsWebResearchBot/1.0"


def _guard_url(url: str) -> None:
    if not safe_public_evidence_url(url):
        raise ValueError("unsafe_url")
    hostname = urlparse(url).hostname
    if not hostname or not _resolved_host_is_public(hostname):
        raise ValueError("unsafe_or_unresolved_host")


class GuardedWebResearchFetcher:
    """Bounded public HTTP fetcher for discovery search + page fetch."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
        page_fetcher: Optional[GuardedEvidenceFetcher] = None,
    ):
        self.timeout_seconds = max(1, min(30, int(timeout_seconds)))
        self.page_fetcher = page_fetcher or GuardedEvidenceFetcher(
            timeout_seconds=self.timeout_seconds
        )

    def fetch(self, url: str, expected_domain: Optional[str] = None) -> Dict[str, Any]:
        """Governed page fetch for the internal IndustryEvidenceResearcher."""
        return self.page_fetcher.fetch(url, expected_domain)

    def fetch_text(self, url: str) -> str:
        """Fetch raw text/HTML (e.g. a search results page)."""
        _guard_url(url)
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=self.timeout_seconds) as response:
                final_url = response.geturl()
                if not safe_public_evidence_url(final_url):
                    raise ValueError("unsafe_redirect")
                final_host = (urlparse(final_url).hostname or "").lower()
                if not _resolved_host_is_public(final_host):
                    raise ValueError("unsafe_redirect_host")
                return response.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
            raise RuntimeError(f"fetch_text_failed:{error}") from error

    def post_json(
        self,
        url: str,
        payload: Dict[str, Any],
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """POST a JSON body and parse the JSON response (e.g. Tavily)."""
        _guard_url(url)
        try:
            request = Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": USER_AGENT,
                    **(headers or {}),
                },
                method="POST",
            )
            with urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")
                return json.loads(body)
        except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
            raise RuntimeError(f"post_json_failed:{error}") from error

    def get_json(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """GET and parse a JSON response (e.g. Brave)."""
        _guard_url(url)
        try:
            request = Request(
                url,
                headers={"User-Agent": USER_AGENT, **(headers or {})},
            )
            with urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")
                return json.loads(body)
        except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
            raise RuntimeError(f"get_json_failed:{error}") from error


__all__ = ["GuardedWebResearchFetcher"]
