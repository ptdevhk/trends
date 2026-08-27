# coding=utf-8
"""HTTP transport, SSRF validation, circuit breaker, domain limiter, and guarded fetcher."""

from __future__ import annotations

import hashlib
import http.client
import ipaddress
import logging
import os
import socket
import threading
import urllib.request
from contextlib import contextmanager, nullcontext
from functools import lru_cache
from typing import Any, Callable, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener
from urllib.request import urlopen as _urllib_urlopen

from apps.worker.evidence_nlp import (
    MAX_EXCERPT_LENGTH,
    _excerpt_with_legal_name,
    _excerpt_with_organization_names,
    _text_from_html,
    _title_from_html,
)

logger = logging.getLogger(__name__)

DEFAULT_FETCH_TIMEOUT_SECONDS = 10
DEFAULT_FETCH_RETRIES = 2


def _env_clamped_int(name: str, default: int, lo: int, hi: int) -> int:
    """Read an int env var clamped to [lo, hi]; fall back to default."""
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


def _env_connect_timeout_seconds() -> float:
    """Connect-phase timeout (split from the read timeout), clamped < 10s."""
    try:
        value = float(
            os.environ.get("INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS", "5")
        )
    except (TypeError, ValueError):
        return 5.0
    return max(1.0, min(9.0, value))


def _unsafe_hostname(hostname: str) -> bool:
    normalized = hostname.strip().rstrip(".").lower()
    if (
        not normalized
        or normalized == "localhost"
        or normalized.endswith(".localhost")
        or normalized.endswith(".local")
        or normalized.endswith(".internal")
    ):
        return True
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return not address.is_global


def safe_public_evidence_url(url: str) -> bool:
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False
    return (
        parsed.scheme in {"http", "https"}
        and bool(parsed.hostname)
        and parsed.username is None
        and parsed.password is None
        and not _unsafe_hostname(parsed.hostname or "")
    )


def _resolved_host_is_public(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    if not addresses:
        return False
    for address in addresses:
        raw = address[4][0]
        try:
            if not ipaddress.ip_address(raw).is_global:
                return False
        except ValueError:
            return False
    return True


# ---------------------------------------------------------------------------
# Transport: split connect/read timeouts (P0.2)
#
# stdlib's HTTPConnection uses one timeout for both the connect phase and the
# body reads; a dead host then burns the full read timeout on connect alone.
# The connection classes below bound the connect phase with the shorter
# connect timeout (env INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS, default 5s)
# and reset the socket to the caller's read timeout before the body is read.
# ---------------------------------------------------------------------------

class _SplitConnectTimeoutHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection whose connect phase uses a short timeout while reads
    keep the caller's (longer) read timeout."""

    def __init__(self, *args, connect_timeout: Optional[float] = None, **kwargs):
        self._connect_timeout = connect_timeout
        super().__init__(*args, **kwargs)

    def connect(self):
        self.sock = socket.create_connection(
            (self.host, self.port),
            timeout=self._connect_timeout,
            source_address=self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        self.sock.settimeout(self.timeout)


class _SplitConnectTimeoutHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS twin of _SplitConnectTimeoutHTTPConnection."""

    def __init__(self, *args, connect_timeout: Optional[float] = None, **kwargs):
        self._connect_timeout = connect_timeout
        super().__init__(*args, **kwargs)

    def connect(self):
        self.sock = socket.create_connection(
            (self.host, self.port),
            timeout=self._connect_timeout,
            source_address=self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        self.sock.settimeout(self.timeout)
        server_hostname = self._tunnel_host or self.host
        self.sock = self._context.wrap_socket(
            self.sock, server_hostname=server_hostname
        )


def _connection_factory(connection_cls, connect_timeout: Optional[float]):
    """Return a ``do_open``-compatible factory binding ``connect_timeout``."""

    def factory(host, timeout, source_address=None, **kwargs):
        return connection_cls(
            host,
            timeout=timeout,
            source_address=source_address,
            connect_timeout=connect_timeout,
            **kwargs,
        )

    return factory


class _SplitConnectTimeoutHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, *, connect_timeout: Optional[float] = None, **kwargs):
        super().__init__(**kwargs)
        self._connect_timeout = connect_timeout

    def http_open(self, req):
        return self.do_open(
            _connection_factory(
                _SplitConnectTimeoutHTTPConnection, self._connect_timeout
            ),
            req,
        )


class _SplitConnectTimeoutHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, *, connect_timeout: Optional[float] = None, **kwargs):
        super().__init__(**kwargs)
        self._connect_timeout = connect_timeout

    def https_open(self, req):
        return self.do_open(
            _connection_factory(
                _SplitConnectTimeoutHTTPSConnection, self._connect_timeout
            ),
            req,
        )


@lru_cache(maxsize=8)
def _transport_opener(connect_timeout_seconds: float) -> Any:
    """Opener whose HTTP/HTTPS connections split connect vs read timeouts."""
    return build_opener(
        _SplitConnectTimeoutHTTPHandler(connect_timeout=connect_timeout_seconds),
        _SplitConnectTimeoutHTTPSHandler(connect_timeout=connect_timeout_seconds),
    )


def _module_urlopen(request, timeout):
    """Transport seam used by GuardedEvidenceFetcher.

    Production routes through an opener that splits the connect timeout
    (INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS, default 5s) from the read
    timeout. Tests patch this module's ``urlopen`` attribute — kept as the
    seam name for backward compatibility.
    """
    return _transport_opener(_env_connect_timeout_seconds()).open(
        request, timeout=timeout
    )


# Rebind the module-level name so ``urlopen(...)`` calls inside the fetcher
# route through the split-timeout opener in production while remaining the
# patchable seam for tests.
urlopen = _module_urlopen


class DomainConcurrencyLimiter:
    """Per-domain bounded concurrency, shared across fetchers in one job.

    Thread-safe: each host gets its own BoundedSemaphore, created lazily
    under a lock. ``hold(host)`` is a context manager that acquires the cap
    before connecting and releases it when the fetch finishes.
    """

    def __init__(self, per_domain: int = 2):
        self.per_domain = max(1, int(per_domain))
        self._semaphores: Dict[str, threading.BoundedSemaphore] = {}
        self._lock = threading.Lock()

    def _semaphore_for(self, host: str) -> threading.BoundedSemaphore:
        key = str(host or "").strip().lower()
        with self._lock:
            semaphore = self._semaphores.get(key)
            if semaphore is None:
                semaphore = threading.BoundedSemaphore(self.per_domain)
                self._semaphores[key] = semaphore
            return semaphore

    @contextmanager
    def hold(self, host: str):
        semaphore = self._semaphore_for(host)
        semaphore.acquire()
        try:
            yield
        finally:
            semaphore.release()


class HostCircuitBreaker:
    """Per-host consecutive-failure circuit breaker for one job/sweep.

    A host that fails ``threshold`` consecutive fetch attempts is marked open
    and every later fetch to it fails fast with
    ``RuntimeError("fetch_failed:circuit_open:<host>")`` without attempting a
    connection. Any success resets the failure count. Only transport-level
    failures (HTTP/URLError/timeout) are recorded — policy rejections
    (unsafe_url / unsafe_or_unresolved_host) never open the circuit.
    """

    def __init__(self, threshold: int = 3):
        self.threshold = max(1, int(threshold))
        self._consecutive_failures: Dict[str, int] = {}
        self._open_hosts: set = set()
        self._lock = threading.Lock()

    def check(self, host: str) -> None:
        key = str(host or "").strip().lower()
        with self._lock:
            if key in self._open_hosts:
                raise RuntimeError(f"fetch_failed:circuit_open:{key}")

    def record_failure(self, host: str) -> None:
        key = str(host or "").strip().lower()
        with self._lock:
            count = self._consecutive_failures.get(key, 0) + 1
            self._consecutive_failures[key] = count
            if count >= self.threshold:
                self._open_hosts.add(key)

    def record_success(self, host: str) -> None:
        key = str(host or "").strip().lower()
        with self._lock:
            self._consecutive_failures.pop(key, None)


def _normalize_evidence_url(url: str) -> str:
    """Normalize a URL for per-sweep evidence cache identity.

    Lowercases scheme+host, drops the fragment, strips the trailing slash,
    and keeps path/query. Not a general canonicalizer — only the shapes the
    evidence pipeline compares across proposals.
    """
    raw = str(url or "").strip()
    try:
        parsed = urlparse(raw)
    except ValueError:
        return raw
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    if not scheme or not host:
        return raw
    try:
        port = parsed.port
    except ValueError:
        port = None
    netloc = host if port is None else f"{host}:{port}"
    path = parsed.path.rstrip("/") or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{scheme}://{netloc}{path}{query}"


class GuardedEvidenceFetcher:
    """Bounded public HTTP fetcher with DNS, redirect-domain, and excerpt guards.

    P0.2/P0.3 safety rails, all optional and per-instance:
    - ``domain_limiter``: per-host concurrency cap shared across fetchers in
      one job (default None = unlimited).
    - ``circuit_breaker``: per-host consecutive-failure breaker, fail-fast
      once a host trips (default: HostCircuitBreaker with the env threshold).
    - ``evidence_cache``: per-sweep normalized-URL result cache (default: a
      private per-instance dict). Cache hits return a shallow copy.
    """

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
        max_attempts: int = DEFAULT_FETCH_RETRIES,
        domain_limiter: Optional[DomainConcurrencyLimiter] = None,
        circuit_breaker: Optional[HostCircuitBreaker] = None,
        evidence_cache: Optional[Dict[str, Dict[str, Any]]] = None,
        opener: Optional[Callable[..., Any]] = None,
    ):
        self.timeout_seconds = max(1, min(30, int(timeout_seconds)))
        self.max_attempts = max(1, min(3, int(max_attempts)))
        self.domain_limiter = domain_limiter
        self.circuit_breaker = circuit_breaker or HostCircuitBreaker(
            threshold=_env_clamped_int(
                "INDUSTRY_RESEARCH_CIRCUIT_BREAKER_THRESHOLD", 3, 1, 10
            )
        )
        self._evidence_cache: Dict[str, Dict[str, Any]] = (
            evidence_cache if evidence_cache is not None else {}
        )
        self._cache_lock = threading.Lock()
        self._opener = opener

    def _cache_get(self, key: str) -> Optional[Dict[str, Any]]:
        with self._cache_lock:
            return self._evidence_cache.get(key)

    def _cache_set(self, key: str, value: Dict[str, Any]) -> None:
        with self._cache_lock:
            self._evidence_cache[key] = dict(value)

    def fetch(
        self,
        url: str,
        expected_domain: Optional[str] = None,
        *,
        use_cache: bool = True,
    ) -> Dict[str, Any]:
        # Tests patch the shim module's urlopen seam; keep resolving it at
        # call time so patch("apps.worker.industry_evidence_research.urlopen")
        # keeps working without a direct import cycle.
        import apps.worker.industry_evidence_research as _transport_shim

        resolved_host_is_public = getattr(
            _transport_shim, "_resolved_host_is_public", _resolved_host_is_public
        )
        urlopen_fn = self._opener or getattr(_transport_shim, "urlopen", urlopen)
        cache_key = _normalize_evidence_url(url) if use_cache else None
        if cache_key is not None:
            cached = self._cache_get(cache_key)
            if cached is not None:
                # Shallow copy: callers must not be able to mutate the cache.
                return dict(cached)
        if not safe_public_evidence_url(url):
            raise ValueError("unsafe_url")
        initial = urlparse(url)
        if not initial.hostname or not resolved_host_is_public(initial.hostname):
            raise ValueError("unsafe_or_unresolved_host")

        last_error: Optional[Exception] = None
        # Some sites only answer on their www (or bare) host; after the
        # primary attempts are exhausted, try the sibling host once.
        candidate_urls = [url]
        host = initial.hostname
        if host:
            if host.startswith("www."):
                candidate_urls.append(url.replace(f"://{host}", f"://{host[4:]}", 1))
            else:
                candidate_urls.append(url.replace(f"://{host}", f"://www.{host}", 1))
        with self.domain_limiter.hold(host) if self.domain_limiter else nullcontext():
            for url_index, attempt_url in enumerate(candidate_urls):
                attempts = self.max_attempts if url_index == 0 else 1
                for attempt in range(attempts):
                    try:
                        # Fail fast even mid-fetch: the breaker may have
                        # opened after an earlier attempt of this same call.
                        self.circuit_breaker.check(urlparse(attempt_url).hostname)
                        request = Request(
                            attempt_url,
                            headers={
                                "Accept": "text/html,application/xhtml+xml,text/plain",
                                "User-Agent": "TrendsIndustryEvidenceBot/1.0",
                            },
                        )
                        with urlopen_fn(request, timeout=self.timeout_seconds) as response:
                            final_url = response.geturl()
                            if not safe_public_evidence_url(final_url):
                                raise ValueError("unsafe_redirect")
                            final_host = (urlparse(final_url).hostname or "").lower()
                            if not resolved_host_is_public(final_host):
                                raise ValueError("unsafe_redirect_host")
                            body = response.read(1_000_000)
                            charset = response.headers.get_content_charset() or "utf-8"
                            raw = body.decode(charset, errors="replace")
                            text = _text_from_html(raw)
                            excerpt = _excerpt_with_legal_name(text[:MAX_EXCERPT_LENGTH], text)
                            excerpt = _excerpt_with_organization_names(excerpt, raw)
                            result = {
                                "finalUrl": final_url,
                                "status": int(getattr(response, "status", 200)),
                                "title": _title_from_html(raw),
                                "excerpt": excerpt,
                                "contentFingerprint": "sha256:"
                                + hashlib.sha256(text.encode("utf-8")).hexdigest(),
                                "domainGuardPassed": (
                                    not expected_domain
                                    or final_host == expected_domain.lower()
                                    or final_host.endswith("." + expected_domain.lower())
                                ),
                            }
                        self.circuit_breaker.record_success(
                            urlparse(attempt_url).hostname
                        )
                        if cache_key is not None:
                            self._cache_set(cache_key, result)
                        return result
                    except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
                        self.circuit_breaker.record_failure(
                            urlparse(attempt_url).hostname
                        )
                        last_error = error
        raise RuntimeError(f"fetch_failed:{last_error}")


__all__ = [
    "DEFAULT_FETCH_RETRIES",
    "DEFAULT_FETCH_TIMEOUT_SECONDS",
    "DomainConcurrencyLimiter",
    "GuardedEvidenceFetcher",
    "HostCircuitBreaker",
    "safe_public_evidence_url",
    "urlopen",
]
