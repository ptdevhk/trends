# coding=utf-8
"""Governed company-industry evidence research and freshness maintenance.

The worker may enrich open proposals and record observations. It intentionally
has no operation that approves proposals or writes current verdict revisions.
"""

from __future__ import annotations

import hashlib
import html
import http.client
import ipaddress
import json
import logging
import os
import re
import socket
import threading
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager, nullcontext
from functools import lru_cache
from typing import Any, Callable, Dict, List, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, urlopen

from apps.worker.research_convex import ResearchConvexClient

logger = logging.getLogger(__name__)

MAX_SOURCES_PER_PROPOSAL = 8
MAX_EXCERPT_LENGTH = 800
DEFAULT_FETCH_TIMEOUT_SECONDS = 10
DEFAULT_FETCH_RETRIES = 2

SOURCE_ORDER = {
    "official_site": 0,
    "registry": 1,
    "taxonomy": 2,
    "oem_partner": 3,
    "trade_body": 4,
    "directory": 5,
    "reporting": 6,
    "other": 7,
    "search_result": 8,
}

TRUST_ORDER = {
    "primary": 0,
    "authoritative": 1,
    "corroborating": 2,
    "discovery": 3,
}

IDENTITY_LEGAL_SUFFIX_RE = re.compile(
    r"\b(?P<suffix>"
    r"SDN\.?\s+BHD\.?|"
    r"PTE\.?\s+LTD\.?|PTY\.?\s+LTD\.?|"
    r"COMPANY\s+LIMITED|GESELLSCHAFT\s+MIT\s+BESCHRAENKTER\s+HAFTUNG|"
    r"LIMITED|CORPORATION|BERHAD\.?|GMBH\.?|"
    r"BHD\.?|LTD\.?|LLC\.?|LLP\.?|PLC\.?|INC\.?|CORP\.?|CO\.?\s*,?\s*LTD\.?|"
    r"AB\.?|AS\.?|AG\.?|BV\.?|NV\.?|KK\.?|SA\.?"
    r")\b",
    re.IGNORECASE,
)
IDENTITY_NAME_RE = re.compile(
    r"\b([A-Za-z0-9][A-Za-z0-9&.,'()\-/ ]{2,100}?\s+"
    + IDENTITY_LEGAL_SUFFIX_RE.pattern
    + r")",
    re.IGNORECASE,
)
# Copyright lines carry the registrant's legal name most reliably; the
# captured span deliberately excludes a leading 4-digit year.
_COPYRIGHT_LEGAL_NAME_RE = re.compile(
    r"(?:(?:copyright\s*)?(?:©|&copy;)|\(c\)|\(C\)|copyright)"
    r"\s*(?:\d{4}\s*)?"
    r"([A-Za-z0-9][A-Za-z0-9&.,'()\-/ ]{2,100}?\s+"
    + IDENTITY_LEGAL_SUFFIX_RE.pattern
    + r")",
    re.IGNORECASE,
)


def _normalize_identity_name(value: str) -> str:
    """Normalize a legal-name candidate without claiming canonical identity."""
    normalized = re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip(" ,;:-()")
    normalized = re.sub(r"\s+\.", ".", normalized)
    normalized = re.sub(r"\.\s+", ". ", normalized)
    normalized = re.sub(r"\s*,\s*", ", ", normalized)
    if re.search(r"\b(?:SDN\.?\s+BHD|PTE\.?\s+LTD)$", normalized, re.IGNORECASE):
        normalized += "."
    return normalized.upper()


_PAGE_CHROME_TOKENS = frozenset(
    {
        "home", "about", "contact", "skip", "menu", "search", "login", "sign",
        "back", "page", "main", "footer", "learn", "more",
        "read", "terms", "privacy", "policy", "copyright", "reserved",
        "welcome", "browse", "close", "open", "content", "products",
        "services", "solutions", "legal", "name", "us", "our", "the", "and",
        "for", "with", "from",
    }
)


def _trim_page_chrome(value: str) -> str:
    """Drop leading page-chrome tokens from a captured legal-name span.

    IDENTITY_NAME_RE captures from the leftmost word to the legal suffix, so
    "Home About Us Contact LBSB SDN BHD." arrives as one span; the chrome
    prefix is not part of the legal name. Deterministic and conservative: only
    leading tokens from the chrome vocabulary (and bare 4-digit years, which
    precede footer copyright names) are removed, and at least two tokens
    always remain.
    """
    tokens = value.split()
    while len(tokens) > 2 and (
        tokens[0].strip(".,;:()").lower() in _PAGE_CHROME_TOKENS
        or re.fullmatch(r"\d{4}", tokens[0].strip(".,;:()"))
    ):
        tokens = tokens[1:]
    return " ".join(tokens)


def _suffix_case_ok(match) -> bool:
    """Short legal suffixes (AB/AS/AG/BV/NV/KK/SA/BHD/LTD/LLC/…) must be
    capitalized in the original text: the case-insensitive matcher would
    otherwise treat prose words like "as" or "ag" as suffixes."""
    suffix = match.group("suffix")
    if len(suffix) <= 3 and not suffix[0].isupper():
        return False
    return True


def _find_legal_names(text: str) -> List[str]:
    """Every legal-suffix name in page text, copyright lines first.

    Footer copyright lines ("© 2024 Alfa Laval AB") carry the registrant's
    legal name most reliably, so they are yielded before generic suffix
    matches. Each candidate is normalized, chrome-trimmed, deduplicated, and
    bounded to the same 8-80 char window the candidate pipeline accepts.
    Review-only: nothing here maps or approves identity.
    """
    source = str(text or "")
    names: List[str] = []
    seen: set = set()
    for match in _COPYRIGHT_LEGAL_NAME_RE.finditer(source):
        if not _suffix_case_ok(match):
            continue
        # Copyright captures start right after the ©/year marker, so there is
        # no leading chrome to trim — and trimming would destroy registered
        # names that begin with an article (e.g. "The Store (Malaysia) Sdn.
        # Bhd.").
        candidate = _normalize_identity_name(match.group(1))
        if 8 <= len(candidate) <= 80 and candidate not in seen:
            seen.add(candidate)
            names.append(candidate)
    for match in IDENTITY_NAME_RE.finditer(source):
        if not _suffix_case_ok(match):
            continue
        candidate = _normalize_identity_name(_trim_page_chrome(match.group(1)))
        if 8 <= len(candidate) <= 80 and candidate not in seen:
            seen.add(candidate)
            names.append(candidate)
    return names


def _find_first_legal_name(text: str) -> Optional[str]:
    """First legal-suffix name in page text (footers/contact sections often
    carry the legal name beyond the excerpt window).

    Returns a normalized legal name bounded to the same 8-80 char window the
    candidate pipeline accepts, or None. Review-only: nothing here maps or
    approves identity.
    """
    names = _find_legal_names(text)
    return names[0] if names else None


def _excerpt_with_legal_name(excerpt: str, text: str) -> str:
    """Append a bounded ``Legal name:`` line to an excerpt when the full page
    text contains a legal-suffix name the excerpt window did not cover.

    The appended line is verbatim page content, so the stored excerpt stays a
    truthful bounded extract while the identity pipeline can see footer legal
    names. No-op when the name is already inside the excerpt or the line would
    exceed a bounded length.
    """
    legal_name = _find_first_legal_name(text)
    if not legal_name:
        return excerpt
    if legal_name in excerpt.upper():
        return excerpt
    legal_line = f"Legal name: {legal_name}"
    if len(legal_line) > 160:
        return excerpt
    return f"{excerpt}\n{legal_line}"


_LEGAL_SUFFIX_TOKENS = frozenset(
    {"sdn", "bhd", "pte", "ltd", "limited", "inc", "corp", "corporation", "co"}
)


def _walk_json_ld_nodes(node: Any):
    """Depth-first walk of parsed JSON-LD, yielding every object node."""
    if isinstance(node, list):
        for child in node:
            yield from _walk_json_ld_nodes(child)
    elif isinstance(node, dict):
        yield node
        graph = node.get("@graph")
        if graph is not None:
            yield from _walk_json_ld_nodes(graph)
        for key, value in node.items():
            if key.startswith("@") or key == "@graph":
                continue
            if isinstance(value, (dict, list)):
                yield from _walk_json_ld_nodes(value)


def _json_ld_org_names(raw: str) -> List[Dict[str, str]]:
    """Schema.org Organization names/alternateNames from JSON-LD script blocks.

    Legal names frequently live only in ``<script type="application/ld+json">``
    markup, which the plain-text extractor strips. Returns at most four
    ``{"name", "alternateName"}`` entries; review-only, never a mapping.
    """
    orgs: List[Dict[str, str]] = []
    for block in re.findall(
        r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        str(raw or ""),
        flags=re.IGNORECASE | re.DOTALL,
    ):
        try:
            data = json.loads(block)
        except (ValueError, TypeError):
            continue
        for item in _walk_json_ld_nodes(data):
            type_value = item.get("@type") if isinstance(item, dict) else None
            types = type_value if isinstance(type_value, list) else [type_value]
            if "Organization" not in types:
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            alternate = str(item.get("alternateName") or "").strip()
            orgs.append({"name": name, "alternateName": alternate})
            if len(orgs) >= 4:
                return orgs
    return orgs


def _excerpt_with_organization_names(excerpt: str, raw: str) -> str:
    """Append bounded schema.org Organization lines to a fetched excerpt.

    JSON-LD script content is stripped by the text extractor, so append the
    organization's own name (and alternateName when present) as a structured
    line the identity pipeline can read. Verbatim page data, capped at two
    organizations and one line each.
    """
    lines = []
    for org in _json_ld_org_names(raw)[:2]:
        name = _normalize_identity_name(org["name"])
        if len(name) < 8 or len(name) > 80:
            continue
        line = f"Organization name: {name}"
        alternate = re.sub(r"\s+", " ", org.get("alternateName") or "").strip()
        if alternate and len(alternate) <= 80:
            line += f" | alt: {alternate.upper()}"
        lines.append(line)
    if not lines:
        return excerpt
    return f"{excerpt}\n" + "\n".join(lines)


def _identity_org_from_excerpt(evidence_excerpt: str) -> Optional[tuple]:
    """``(organization_name, alternate_name)`` from an appended
    ``Organization name:`` line, or None."""
    for line in str(evidence_excerpt or "").splitlines():
        match = re.match(
            r"^Organization name: (.+?)(?: \| alt: (.+))?$",
            line.strip(),
        )
        if match:
            return (match.group(1).strip(), (match.group(2) or "").strip())
    return None


def _name_overlap_passes(
    employer_surface: str,
    surface_tokens: List[str],
    legal_name: str,
) -> bool:
    """Distinctive-token overlap gate shared by regex and org-line candidates.

    A legal name sharing any non-generic token with the employer surface is a
    viable candidate; fully generic surfaces fall back to a stricter
    two-token rule. Legal-suffix tokens never count toward overlap.
    """
    name_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", legal_name.lower())
        if len(token) > 2 and token not in _LEGAL_SUFFIX_TOKENS
    }
    if not name_tokens:
        return False
    distinctive = _distinctive_employer_tokens(employer_surface)
    if distinctive:
        return any(token in name_tokens for token in distinctive)
    return (
        sum(
            token in name_tokens
            for token in surface_tokens
            if len(token) > 2 and token not in _LEGAL_SUFFIX_TOKENS
        )
        >= 2
    )


def _distinctive_employer_tokens(employer_surface: str) -> set:
    """Distinctive employer tokens; lazy import keeps web_research out of the
    import graph when discovery is disabled (same pattern as
    ``_candidate_content_proves_employer``)."""
    from apps.worker.web_research.classify import distinctive_employer_tokens

    return distinctive_employer_tokens(employer_surface)


def employer_surface_for_search(proposal: Dict[str, Any]) -> str:
    """Return the best human-readable employer surface for discovery.

    Resolved proposals normally carry ``normalizedEmployerSurface``. Some
    company-linked proposals only carry a canonical slug in ``companyKey``;
    using that slug verbatim makes public search providers look for a literal
    hyphenated token (for example ``robert-bosch-sdn-bhd``). Humanize that
    fallback for search and relevance checks while leaving the canonical key
    unchanged everywhere it is persisted.
    """
    normalized_surface = str(
        proposal.get("normalizedEmployerSurface") or ""
    ).strip()
    source_surface = normalized_surface or str(
        proposal.get("companyKey") or ""
    ).strip()
    if not source_surface:
        return ""

    # Apply the same display-safe separator handling to a normalized surface
    # that was persisted from a slugged company alias as to a companyKey
    # fallback. Ordinary spaced employer names pass through unchanged.
    humanized = re.sub(r"[^\w]+", " ", source_surface, flags=re.UNICODE)
    return re.sub(r"\s+", " ", humanized).strip()


def industry_evidence_maintenance_enabled(
    env: Optional[Dict[str, str]] = None,
) -> bool:
    source = env if env is not None else os.environ
    value = str(source.get("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


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


def _text_from_html(raw: str) -> str:
    without_scripts = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>",
        " ",
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _title_from_html(raw: str) -> Optional[str]:
    match = re.search(r"<title\b[^>]*>(.*?)</title>", raw, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()
    return title[:300] or None


def classify_industry_excerpt(text: str) -> Dict[str, Any]:
    normalized = text.casefold()
    scores = {
        "cnc": sum(
            keyword in normalized
            for keyword in (
                "cnc",
                "machining centre",
                "machining center",
                "machine tool",
                "数控",
                "加工中心",
            )
        ),
        "automation": sum(
            keyword in normalized
            for keyword in ("automation", "robotics", "plc", "自动化", "机器人")
        ),
        "metrology": sum(
            keyword in normalized
            for keyword in ("metrology", "measurement", "cmm", "计量", "测量")
        ),
        "industrial": sum(
            keyword in normalized
            for keyword in ("industrial", "machinery", "manufacturing", "工业", "机械")
        ),
    }
    best_class, best_score = max(scores.items(), key=lambda item: (item[1], item[0]))
    if best_score <= 0:
        return {"industryClass": "unknown", "confidence": 0.2}
    confidence = min(0.95, 0.55 + best_score * 0.12)
    return {"industryClass": best_class, "confidence": round(confidence, 2)}


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
        cache_key = _normalize_evidence_url(url) if use_cache else None
        if cache_key is not None:
            cached = self._cache_get(cache_key)
            if cached is not None:
                # Shallow copy: callers must not be able to mutate the cache.
                return dict(cached)
        if not safe_public_evidence_url(url):
            raise ValueError("unsafe_url")
        initial = urlparse(url)
        if not initial.hostname or not _resolved_host_is_public(initial.hostname):
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
                        with urlopen(request, timeout=self.timeout_seconds) as response:
                            final_url = response.geturl()
                            if not safe_public_evidence_url(final_url):
                                raise ValueError("unsafe_redirect")
                            final_host = (urlparse(final_url).hostname or "").lower()
                            if not _resolved_host_is_public(final_host):
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


def _candidate_sort_key(candidate: Dict[str, Any]) -> tuple:
    return (
        SOURCE_ORDER.get(str(candidate.get("sourceType")), 99),
        TRUST_ORDER.get(str(candidate.get("trustTier")), 99),
        str(candidate.get("url") or ""),
    )


def _candidate_content_proves_employer(
    employer_surface: str, candidate: Dict[str, Any]
) -> bool:
    """Re-enrichment relevance gate: does this candidate's *existing*
    content (title or stored excerpt) provably mention the employer?
    Candidates with no stored content yet are allowed through — they get
    fetched, then their fetched content faces the same gate inside
    enrich_proposal via the demoted-tier rules. Lazy import keeps
    web_research out of the graph when discovery is disabled.
    """
    from apps.worker.web_research.classify import excerpt_proves_employer

    title = str(candidate.get("title") or "")
    excerpt = str(
        candidate.get("expectedExcerpt")
        or candidate.get("evidenceExcerpt")
        or ""
    )
    if not title and not excerpt:
        return True  # unknown content: fetch will decide
    return excerpt_proves_employer(employer_surface, title=title, excerpt=excerpt)


def _source_content_proves_employer(
    employer_surface: str, source: Dict[str, Any]
) -> bool:
    """Fetched-source relevance gate for proof-source counting."""
    from apps.worker.web_research.classify import excerpt_proves_employer

    return excerpt_proves_employer(
        employer_surface,
        title=str(source.get("title") or ""),
        excerpt=str(source.get("evidenceExcerpt") or ""),
    )


class IndustryEvidenceResearcher:
    def __init__(
        self,
        *,
        fetcher: Optional[Any] = None,
        now_ms: Optional[Callable[[], int]] = None,
    ):
        self.fetcher = fetcher or GuardedEvidenceFetcher()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))

    def enrich_proposal(
        self,
        proposal: Dict[str, Any],
        candidates: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        proposal_id = str(proposal.get("proposalId") or "").strip()
        if not proposal_id:
            raise ValueError("proposalId is required")
        company_key = str(proposal.get("companyKey") or "").strip() or None
        sources: List[Dict[str, Any]] = []
        classifications: List[tuple[str, float]] = []

        for index, candidate in enumerate(
            sorted(candidates, key=_candidate_sort_key)[:MAX_SOURCES_PER_PROPOSAL]
        ):
            url = str(candidate.get("url") or "").strip()
            source_type = str(candidate.get("sourceType") or "other")
            trust_tier = str(candidate.get("trustTier") or "corroborating")
            # Pre-demoted by the maintenance job's relevance gate (recycled
            # homepage rows): honor it — never upgrade back to reviewable.
            relevance_demoted = candidate.get("relevanceDemoted") is True
            if relevance_demoted:
                trust_tier = "discovery"
            if not safe_public_evidence_url(url):
                continue
            if source_type == "search_result":
                trust_tier = "discovery"
            expected_domain = str(candidate.get("expectedDomain") or "").strip() or None
            source_id = str(candidate.get("sourceId") or "").strip() or (
                "industry-source-"
                + hashlib.sha256(
                    f"{proposal_id}\0{url}\0{index}".encode("utf-8")
                ).hexdigest()[:20]
            )
            expected_excerpt = str(candidate.get("expectedExcerpt") or "").strip()
            try:
                if expected_excerpt:
                    # Excerpt-provided candidate (e.g. a Google News RSS hit
                    # whose URL is a publisher homepage): use the
                    # publisher-provided summary as the excerpt instead of
                    # fetching the URL, which would return unrelated
                    # homepage boilerplate or a JS interstitial.
                    excerpt = _excerpt_with_legal_name(
                        expected_excerpt[:MAX_EXCERPT_LENGTH], expected_excerpt
                    )
                    classification = classify_industry_excerpt(excerpt)
                    candidate_title = str(candidate.get("title") or "").strip()
                    source = {
                        "sourceId": source_id,
                        "proposalId": proposal_id,
                        **({"companyKey": company_key} if company_key else {}),
                        "url": url,
                        "sourceType": source_type,
                        "trustTier": trust_tier,
                        **(
                            {"title": candidate_title[:300]}
                            if candidate_title
                            else {}
                        ),
                        "evidenceExcerpt": excerpt,
                        "fetchedAt": self.now_ms(),
                        "contentFingerprint": "sha256:"
                        + hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
                        "fetchStatus": "fetched",
                        "suggestedIndustryClass": classification["industryClass"],
                        "workerConfidence": classification["confidence"],
                        # No fetch happened, so there is no redirect domain
                        # to compare; default to passed.
                        "domainGuardPassed": True,
                    }
                else:
                    fetched = self.fetcher.fetch(
                        url, expected_domain=expected_domain
                    )
                    classification = classify_industry_excerpt(
                        str(fetched.get("excerpt") or "")
                    )
                    source = {
                        "sourceId": source_id,
                        "proposalId": proposal_id,
                        **({"companyKey": company_key} if company_key else {}),
                        "url": str(fetched.get("finalUrl") or url),
                        "sourceType": source_type,
                        "trustTier": trust_tier,
                        **(
                            {"title": str(fetched["title"])[:300]}
                            if fetched.get("title")
                            else {}
                        ),
                        "evidenceExcerpt": str(fetched.get("excerpt") or "")[
                            :MAX_EXCERPT_LENGTH
                        ],
                        "fetchedAt": self.now_ms(),
                        "contentFingerprint": str(
                            fetched.get("contentFingerprint") or ""
                        ),
                        "fetchStatus": "fetched",
                        "suggestedIndustryClass": classification["industryClass"],
                        "workerConfidence": classification["confidence"],
                        "domainGuardPassed": bool(
                            fetched.get("domainGuardPassed", True)
                        ),
                    }
                sources.append(source)
                if (
                    source_type != "search_result"
                    and trust_tier != "discovery"
                    and source["domainGuardPassed"]
                    and classification["industryClass"] != "unknown"
                ):
                    classifications.append(
                        (
                            str(classification["industryClass"]),
                            float(classification["confidence"]),
                        )
                    )
            except (ValueError, RuntimeError, TimeoutError) as error:
                sources.append(
                    {
                        "sourceId": source_id,
                        "proposalId": proposal_id,
                        **({"companyKey": company_key} if company_key else {}),
                        "url": url,
                        "sourceType": source_type,
                        "trustTier": trust_tier,
                        "fetchStatus": "failed",
                        "errorCode": str(error)[:100],
                    }
                )

        employer_surface = employer_surface_for_search(proposal)
        strong_classes = {
            industry_class
            for industry_class, confidence in classifications
            if confidence >= 0.65
        }
        conflicts = len(strong_classes) > 1 or any(
            source.get("domainGuardPassed") is False for source in sources
        )
        ranked_classes = sorted(
            classifications,
            key=lambda item: (-item[1], item[0]),
        )
        suggested_class = ranked_classes[0][0] if ranked_classes else None
        proof_sources = []
        for source in sources:
            if (
                source.get("fetchStatus") != "fetched"
                or source.get("sourceType") == "search_result"
                or source.get("trustTier") == "discovery"
                or source.get("domainGuardPassed") is False
            ):
                continue
            # Fetched-content relevance gate: even a reviewable-tier source
            # only counts as proof when its fetched content provably
            # mentions the employer. Fetched homepage boilerplate from a
            # curated press domain can no longer flip a proposal on its own.
            if employer_surface and not _source_content_proves_employer(
                employer_surface, source
            ):
                source["trustTier"] = "discovery"
                source["relevanceDemoted"] = True
                continue
            proof_sources.append(source)
        status = "ready_for_review" if proof_sources else "needs_more_evidence"
        summary = (
            f"Research found {len(proof_sources)} reviewable source(s)"
            + (f"; suggested class {suggested_class}" if suggested_class else "")
            + ("; conflicting evidence requires review" if conflicts else "")
            + "."
        )
        return {
            "proposalId": proposal_id,
            "status": status,
            "sources": sources,
            **({"suggestedIndustryClass": suggested_class} if suggested_class else {}),
            "suggestedVerificationLevel": "candidate",
            "conflicts": conflicts,
            "materialChangeSummary": summary[:MAX_EXCERPT_LENGTH],
        }


class IndustryEvidenceMaintenanceJob:
    def __init__(
        self,
        *,
        client: Optional[ResearchConvexClient] = None,
        researcher: Optional[IndustryEvidenceResearcher] = None,
        now_ms: Optional[Callable[[], int]] = None,
        proposal_limit: int = 200,
        freshness_limit: int = 50,
        discovery_job: Optional[Any] = None,
        run_id: Optional[str] = None,
        mode: Optional[str] = None,
        target_proposal_ids: Optional[Sequence[str]] = None,
        claimed_requests: Optional[Sequence[Dict[str, Any]]] = None,
    ):
        self.client = client or ResearchConvexClient()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        # P0.2: one per-domain limiter shared across every fetcher in this
        # job; P0.3: one per-sweep evidence cache on the job's shared fetcher.
        # A caller-supplied researcher keeps its own fetcher (tests use
        # fakes); the job-built researcher shares this fetcher.
        self._domain_limiter = DomainConcurrencyLimiter(
            per_domain=_env_clamped_int(
                "INDUSTRY_RESEARCH_DOMAIN_CONCURRENCY", 2, 1, 8
            )
        )
        self._shared_fetcher = GuardedEvidenceFetcher(
            domain_limiter=self._domain_limiter
        )
        self.researcher = researcher or IndustryEvidenceResearcher(
            fetcher=self._shared_fetcher, now_ms=self.now_ms
        )
        # The per-domain cap is shared across all GuardedEvidenceFetcher
        # instances in one job — including the discovery fetcher's page-fetch
        # path (duck-typed so fake discovery jobs are untouched).
        if discovery_job is not None:
            web_fetcher = getattr(discovery_job, "fetcher", None)
            page_fetcher = getattr(web_fetcher, "page_fetcher", None)
            if isinstance(page_fetcher, GuardedEvidenceFetcher):
                page_fetcher.domain_limiter = self._domain_limiter
        self.discovery_job = discovery_job
        self.proposal_limit = max(1, min(200, int(proposal_limit)))
        self.freshness_limit = max(1, min(100, int(freshness_limit)))
        self.mode = mode or "sweep"
        self.target_proposal_ids = list(
            dict.fromkeys(
                str(proposal_id).strip()
                for proposal_id in (target_proposal_ids or [])
                if str(proposal_id).strip()
            )
        )
        self.claimed_requests = [
            dict(request)
            for request in (claimed_requests or [])
            if str(request.get("requestId") or "").strip()
            and str(request.get("proposalId") or "").strip()
            and str(request.get("leaseId") or "").strip()
        ]
        # When run_id is set, the job emits a per-proposal ledger row at each
        # decision point and finishes the run with accumulated counts. Ledger
        # writes are best-effort (see ResearchConvexClient._safe_mutation).
        self.run_id = run_id
        self._counts: Dict[str, int] = {
            "proposalsResearched": 0,
            "readyCreated": 0,
            "sourcesDemoted": 0,
            "freshnessChecked": 0,
            "freshnessRefreshed": 0,
            "errors": 0,
        }
        # P0.2: the sweep researches proposals in parallel, so count
        # increments must be guarded.
        self._counts_lock = threading.Lock()

    def _bump_count(self, key: str, delta: int = 1) -> None:
        """Thread-safe count increment."""
        with self._counts_lock:
            self._counts[key] = self._counts.get(key, 0) + delta

    def _complete_claimed_requests(
        self,
        proposal_id: str,
        *,
        state: str,
        outcome: str,
        failure_code: Optional[str] = None,
    ) -> None:
        """Release exact leases after one proposal reaches a durable outcome."""
        for request in self.claimed_requests:
            if str(request.get("proposalId") or "") != proposal_id:
                continue
            payload: Dict[str, Any] = {
                "requestId": str(request["requestId"]),
                "leaseId": str(request["leaseId"]),
                "runId": self.run_id,
                "state": state,
                "outcome": outcome[:300],
            }
            if failure_code:
                payload["failureCode"] = failure_code
            try:
                self.client.complete_industry_research_request(payload)
            except Exception as error:  # noqa: BLE001 - queue completion is best effort
                logger.warning(
                    "[IndustryEvidenceMaintenance] request completion failed: %s",
                    error,
                )

    def _renew_claimed_requests(self, proposal_id: str) -> bool:
        """Renew the exact leases before doing potentially slow source work.

        Direct/local jobs may use a lightweight fake client without the queue
        wrapper; in that case there is no lease to renew. A real Convex false
        response means ownership was lost and the proposal must not be
        mutated by this worker.
        """
        renew = getattr(self.client, "renew_industry_research_request_lease", None)
        if not callable(renew):
            return True
        for request in self.claimed_requests:
            if str(request.get("proposalId") or "") != proposal_id:
                continue
            try:
                result = renew(
                    {
                        "requestId": str(request["requestId"]),
                        "leaseId": str(request["leaseId"]),
                        "leaseMs": 15 * 60 * 1_000,
                    }
                )
            except Exception as error:  # noqa: BLE001 - lease renewal is a guard
                logger.warning(
                    "[IndustryEvidenceMaintenance] lease renewal failed for %s: %s",
                    proposal_id,
                    error,
                )
                return False
            if isinstance(result, dict) and result.get("renewed") is False:
                return False
        return True

    def _identity_candidates_for_sources(
        self,
        proposal: Dict[str, Any],
        sources: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Extract review-only legal-name candidates from fetched evidence.

        This deliberately accepts only fetched, non-discovery proposal sources.
        It creates a candidate row for an administrator to review; it never
        writes a company mapping or changes approval truth.
        """
        grouped: Dict[str, Dict[str, Any]] = {}
        employer_surface = employer_surface_for_search(proposal)
        for source in sources:
            if (
                source.get("fetchStatus") != "fetched"
                or source.get("sourceType") == "search_result"
                or source.get("trustTier") == "discovery"
                or source.get("domainGuardPassed") is False
            ):
                continue
            # A legal suffix alone is not enough to infer the employer. Require
            # meaningful overlap with the exact employer surface; a primary
            # source can still be retained as evidence without creating a
            # misleading identity candidate.
            surface_tokens = re.findall(r"[a-z0-9]+", employer_surface.lower())
            legal_name = None
            alt_name = ""
            org_line = _identity_org_from_excerpt(
                str(source.get("evidenceExcerpt") or "")
            )
            if org_line:
                # JSON-LD organization line: accept when the organization
                # name OR its alternateName shares a distinctive token with
                # the surface (e.g. surface "lbsb group of companies" with an
                # org "LEONG BEE & SOO BEE SDN BHD." + alt "LBSB").
                org_name, alt_name = org_line
                normalized_org = _normalize_identity_name(org_name)
                if 8 <= len(normalized_org) <= 80:
                    legal_name = normalized_org
                    alt_name = alt_name.strip()
            if legal_name is None:
                # Best-match instead of first-match: footer copyright lines
                # (yielded first) are the most reliable carriers of the
                # registrant's legal name, and a wrong first generic match
                # (e.g. a supplier or partner name in the page body) must not
                # hide the employer's own legal name later in the text. Take
                # the first name that shares a distinctive token with the
                # exact employer surface.
                for field in ("evidenceExcerpt", "title"):
                    field_text = str(source.get(field) or "")
                    for candidate_name in _find_legal_names(field_text):
                        if _name_overlap_passes(
                            employer_surface, surface_tokens, candidate_name
                        ):
                            legal_name = candidate_name
                            break
                    if legal_name is not None:
                        break
            if not legal_name:
                continue
            if not (
                _name_overlap_passes(employer_surface, surface_tokens, legal_name)
                or (
                    alt_name
                    and _name_overlap_passes(
                        employer_surface,
                        surface_tokens,
                        _normalize_identity_name(alt_name),
                    )
                )
            ):
                continue
            item = grouped.setdefault(
                legal_name,
                {
                    "normalizedLegalName": legal_name,
                    "sourceIds": [],
                    "confidence": 0.0,
                    "conflictCodes": [],
                    "jurisdiction": str(proposal.get("jurisdiction") or "MY")[:80],
                },
            )
            source_id = str(source.get("sourceId") or "").strip()
            if source_id and source_id not in item["sourceIds"]:
                item["sourceIds"].append(source_id)
            tier_confidence = {"primary": 0.88, "authoritative": 0.82, "corroborating": 0.68}.get(
                str(source.get("trustTier") or ""), 0.6
            )
            item["confidence"] = max(float(item["confidence"]), tier_confidence)

        candidates: List[Dict[str, Any]] = []
        for item in grouped.values():
            source_ids = sorted(item["sourceIds"])
            if not source_ids:
                continue
            fingerprint_input = "|".join(
                [
                    item["normalizedLegalName"],
                    item.get("jurisdiction") or "",
                    "\0".join(source_ids),
                ]
            )
            candidate = {
                **item,
                "proposalId": str(proposal.get("proposalId") or ""),
                "candidateFingerprint": hashlib.sha256(
                    fingerprint_input.encode("utf-8")
                ).hexdigest(),
                "extractionVersion": "legal-name-v1",
            }
            try:
                self.client.upsert_industry_identity_candidate(candidate)
            except Exception as error:  # noqa: BLE001 - evidence research can still finish safely
                logger.warning(
                    "[IndustryEvidenceMaintenance] identity candidate upsert failed: %s",
                    error,
                )
                # Do not tell the queue that human identity review is ready
                # when the candidate was not persisted and therefore cannot be
                # shown or selected by an administrator. The evidence outcome
                # remains valid, while the next explicit request can retry the
                # candidate write.
                continue
            candidates.append(candidate)
        return candidates

    def _ledger(
        self,
        proposal_id: str,
        action: str,
        reason: str,
        *,
        company_key: Optional[str] = None,
        detail: Optional[Any] = None,
    ) -> None:
        """Emit a best-effort ledger row when a run_id is bound.

        Never raises: observability failure must not abort maintenance.
        """
        if not self.run_id:
            return
        payload: Dict[str, Any] = {
            "runId": self.run_id,
            "proposalId": proposal_id,
            "action": action,
            "reason": reason,
        }
        if company_key:
            payload["companyKey"] = company_key
        if detail is not None:
            payload["detail"] = detail
        try:
            self.client.append_maintenance_ledger(payload)
        except Exception as error:  # noqa: BLE001 - best-effort observability
            logger.warning("[MaintenanceLedger] append failed: %s", error)

    def _finish_run(self, status: str, *, failure_message: Optional[str] = None) -> None:
        """Best-effort finish of the bound run with an operator summary.

        Never raises: observability failure must not abort maintenance.
        """
        if not self.run_id:
            return
        ready = self._counts["readyCreated"]
        demoted = self._counts["sourcesDemoted"]
        refreshed = self._counts["freshnessRefreshed"]
        summary = f"{status}; {ready} ready, {demoted} demoted, {refreshed} refreshed."
        payload: Dict[str, Any] = {
            "runId": self.run_id,
            "status": status,
            "counts": dict(self._counts),
            "partial": bool(status == "completed" and self._counts["errors"] > 0),
            "operatorSummary": summary,
        }
        if failure_message:
            payload["failureMessage"] = failure_message
        try:
            self.client.finish_maintenance_run(payload)
        except Exception as error:  # noqa: BLE001 - best-effort observability
            logger.warning("[MaintenanceLedger] finish failed: %s", error)

    def _research_one_proposal(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Research one exact proposal and return its governed outcome."""
        proposal_id = str(proposal.get("proposalId") or "")
        if not proposal_id:
            raise ValueError("proposal is missing proposalId")
        self.client.set_industry_proposal_research_state(
            {"proposalId": proposal_id, "status": "researching"}
        )
        candidates = self.client.list_industry_evidence_sources(
            proposal_id=proposal_id
        )
        if not candidates and self.discovery_job is not None:
            discovered = self.discovery_job.discover_for_proposal(proposal)
            candidates = discovered.get("sources") or []
        # Relevance tightening also gates re-enrichment: recycled candidates
        # whose employer cannot be proven from existing content are demoted to
        # discovery tier before fetch/classify.
        employer_surface = employer_surface_for_search(proposal)
        demoted_count = 0
        for candidate in candidates:
            if candidate.get("trustTier") == "discovery":
                continue
            if not employer_surface:
                continue
            if not _candidate_content_proves_employer(employer_surface, candidate):
                candidate["trustTier"] = "discovery"
                candidate["relevanceDemoted"] = True
                demoted_count += 1
        result = self.researcher.enrich_proposal(proposal, candidates)
        # Capture the pre-run source set before upserting so the no-churn
        # guard compares against what the proposal actually stored.
        existing_source_ids = {
            str(source.get("sourceId") or "").strip()
            for source in self.client.list_industry_evidence_sources(
                proposal_id=proposal_id
            )
        }
        for source in result["sources"]:
            source.pop("domainGuardPassed", None)
            source.pop("errorCode", None)
            self.client.upsert_industry_evidence_source(source)
        identity_candidates = self._identity_candidates_for_sources(
            proposal, result["sources"]
        )
        # No-churn guard: a needs_more_evidence proposal stays
        # needs_more_evidence when a re-research pass adds no material
        # evidence change (every result source was already stored), instead
        # of flipping back to ready_for_review with unchanged evidence every
        # maintenance round (observed churn, 2026-08-08/09).
        if (
            str(proposal.get("status") or "") == "needs_more_evidence"
            and result["status"] == "ready_for_review"
            and bool(result["sources"])
            and all(
                str(source.get("sourceId") or "").strip() in existing_source_ids
                for source in result["sources"]
            )
        ):
            result["status"] = "needs_more_evidence"
            result["materialChangeSummary"] = (
                "ready_for_review suppressed: re-research added no material evidence change"
            )
        self.client.set_industry_proposal_research_state(
            {
                "proposalId": proposal_id,
                "status": result["status"],
                # Explicitly clear stale suggestions when a later collection
                # no longer finds a bounded industry class. The Convex
                # validator accepts `unknown` as the neutral value.
                "suggestedIndustryClass": result.get("suggestedIndustryClass") or "unknown",
                "suggestedVerificationLevel": "candidate",
                "materialChangeSummary": result["materialChangeSummary"],
            }
        )
        self._bump_count("proposalsResearched")
        self._bump_count("sourcesDemoted", demoted_count)
        if result["status"] == "ready_for_review":
            self._bump_count("readyCreated")
            self._ledger(
                proposal_id,
                "ready",
                "ready_for_review",
                company_key=str(proposal.get("companyKey") or "") or None,
            )
        else:
            self._ledger(
                proposal_id,
                "needs_more_evidence",
                str(result.get("materialChangeSummary") or "needs_more_evidence"),
                company_key=str(proposal.get("companyKey") or "") or None,
            )
        return {
            "result": result,
            "identityCandidates": identity_candidates,
        }

    def _plan_sweep_order(
        self, proposals_by_id: Dict[str, Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Order open proposals: resume impact first, then priority, then id.

        The resume-impact query is best-effort — a failure (or a fake client
        without the method) falls back to priority-only ordering.
        """
        company_keys = sorted(
            {
                str(proposal.get("companyKey") or "").strip()
                for proposal in proposals_by_id.values()
                if str(proposal.get("companyKey") or "").strip()
            }
        )
        impact: Dict[str, int] = {}
        get_impact = getattr(self.client, "get_industry_resume_impact", None)
        if callable(get_impact) and company_keys:
            try:
                raw_impact = get_impact(company_keys)
                impact = {
                    str(key): int(value)
                    for key, value in (raw_impact or {}).items()
                }
            except Exception as error:  # noqa: BLE001 - ordering is best-effort
                logger.warning(
                    "[IndustryEvidenceMaintenance] resume-impact query failed; "
                    "falling back to priority-only ordering: %s",
                    error,
                )
                impact = {}

        def sort_key(proposal: Dict[str, Any]) -> tuple:
            company_key = str(proposal.get("companyKey") or "").strip()
            return (
                -int(impact.get(company_key, 0)),
                -float(proposal.get("priority") or 0),
                str(proposal.get("proposalId") or ""),
            )

        return sorted(proposals_by_id.values(), key=sort_key)[: self.proposal_limit]

    def _research_one_proposal_guarded(self, proposal: Dict[str, Any]) -> None:
        """Run one proposal; a per-proposal failure must not abort the sweep.

        P0.2 deliberate behavior change: sequential mode failed the whole run
        on one proposal's exception; the sweep logs and counts it instead.
        """
        proposal_id = str(proposal.get("proposalId") or "")
        try:
            self._research_one_proposal(proposal)
        except Exception as error:  # noqa: BLE001 - per-proposal isolation
            self._bump_count("errors")
            logger.warning(
                "[IndustryEvidenceMaintenance] proposal %s failed: %s",
                proposal_id,
                error,
            )

    def _research_open_proposals(self) -> None:
        proposals_by_id: Dict[str, Dict[str, Any]] = {}
        # Pass proposal_limit * 3 (clamped to the Convex list's 500-row
        # safety cap) to give the sort/dedup enough headroom.
        scan_limit = min(500, self.proposal_limit * 3) if self.proposal_limit > 20 else None
        for status in ("new", "researching", "needs_more_evidence"):
            for proposal in self.client.list_industry_proposals(status, limit=scan_limit):
                proposal_id = str(proposal.get("proposalId") or "")
                if proposal_id:
                    proposals_by_id[proposal_id] = proposal
        proposals = self._plan_sweep_order(proposals_by_id)
        # P0.2: the sweep is fetch-bound, so proposals run with bounded
        # concurrency instead of strictly sequentially. A per-proposal
        # exception is isolated (logged + counted) and never aborts the run.
        concurrency = _env_clamped_int("INDUSTRY_RESEARCH_CONCURRENCY", 4, 1, 16)
        if concurrency <= 1 or len(proposals) <= 1:
            for proposal in proposals:
                self._research_one_proposal_guarded(proposal)
            return
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [
                executor.submit(self._research_one_proposal_guarded, proposal)
                for proposal in proposals
            ]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as error:  # pragma: no cover - the guarded
                    # wrapper already contains per-proposal failures
                    self._bump_count("errors")
                    logger.warning(
                        "[IndustryEvidenceMaintenance] sweep proposal failed: %s",
                        error,
                    )

    def _research_targeted_proposals(self) -> None:
        """Process only the leased target IDs; never fall back to a sweep."""
        for proposal_id in self.target_proposal_ids[: self.proposal_limit]:
            proposal: Optional[Dict[str, Any]] = None
            try:
                proposal = self.client.get_industry_proposal(proposal_id)
                status = str(proposal.get("status") or "") if proposal else "missing"
                if not proposal:
                    self._complete_claimed_requests(
                        proposal_id,
                        state="cancelled",
                        outcome="proposal no longer exists",
                        failure_code="proposal_terminal",
                    )
                    continue
                if not self._renew_claimed_requests(proposal_id):
                    logger.info(
                        "[IndustryEvidenceMaintenance] lease no longer owned for %s",
                        proposal_id,
                    )
                    continue
                if status not in {"new", "researching", "ready_for_review", "needs_more_evidence"}:
                    self._complete_claimed_requests(
                        proposal_id,
                        state="cancelled",
                        outcome=f"proposal is terminal ({status})",
                        failure_code="proposal_terminal",
                    )
                    continue
                outcome = self._research_one_proposal(proposal)
                result = outcome["result"]
                identity_candidates = outcome["identityCandidates"]
                request_state = (
                    "needs_identity_review"
                    if identity_candidates and not proposal.get("companyKey")
                    else (
                        "completed"
                        if result["status"] == "ready_for_review"
                        else "needs_more_evidence"
                    )
                )
                self._complete_claimed_requests(
                    proposal_id,
                    state=request_state,
                    outcome=(
                        "identity candidate(s) require human mapping"
                        if request_state == "needs_identity_review"
                        else str(result.get("materialChangeSummary") or result["status"])
                    ),
                )
            except Exception as error:  # noqa: BLE001 - isolate one target
                self._bump_count("errors")
                logger.warning(
                    "[IndustryEvidenceMaintenance] targeted proposal %s failed: %s",
                    proposal_id,
                    error,
                )
                self._complete_claimed_requests(
                    proposal_id,
                    state="failed",
                    outcome=str(error),
                    failure_code="fetch_failed",
                )

    def _freshness_checks(self) -> None:
        due = self.client.list_due_industry_evidence_sources(
            self.now_ms(), self.freshness_limit
        )
        if not due:
            return
        self.client.mark_industry_evidence_profiles_checking(
            [
                {
                    "companyKey": item["companyKey"],
                    "verdictRevisionId": item["verdictRevisionId"],
                }
                for item in due
            ]
        )
        def check_source(source: Dict[str, Any]) -> Dict[str, Any]:
            checked_at = self.now_ms()
            try:
                # Freshness re-checks must observe live content: bypass the
                # per-sweep evidence cache (use_cache=False). Duck-typed
                # fetchers (test fakes) without the knob fall back to the
                # plain two-arg call — the cache bypass only matters for the
                # shipped GuardedEvidenceFetcher.
                try:
                    fetched = self.researcher.fetcher.fetch(
                        source["url"],
                        expected_domain=source.get("sourceDomain"),
                        use_cache=False,
                    )
                except TypeError:
                    fetched = self.researcher.fetcher.fetch(
                        source["url"],
                        expected_domain=source.get("sourceDomain"),
                    )
                new_fingerprint = str(fetched.get("contentFingerprint") or "")
                classification = classify_industry_excerpt(
                    str(fetched.get("excerpt") or "")
                )
                observed_url = str(fetched.get("finalUrl") or source["url"])
                redirected = observed_url.rstrip("/") != str(source["url"]).rstrip("/")
                if fetched.get("domainGuardPassed") is False:
                    outcome = "conflict"
                elif (
                    classification["industryClass"] != "unknown"
                    and float(classification["confidence"]) >= 0.65
                    and classification["industryClass"]
                    != source.get("currentIndustryClass")
                ):
                    outcome = "conflict"
                elif redirected:
                    outcome = "changed"
                elif (
                    source.get("contentFingerprint")
                    and new_fingerprint == source.get("contentFingerprint")
                ):
                    outcome = "unchanged"
                else:
                    outcome = "changed"
                return {
                    "source": source,
                    "checkedAt": checked_at,
                    "outcome": outcome,
                    "fetchStatus": "fetched",
                    "observedUrl": fetched.get("finalUrl"),
                    "observedTitle": fetched.get("title"),
                    "observedExcerpt": fetched.get("excerpt"),
                    "observedContentFingerprint": new_fingerprint,
                }
            except (ValueError, RuntimeError, TimeoutError) as error:
                return {
                    "source": source,
                    "checkedAt": checked_at,
                    "outcome": "unavailable",
                    "fetchStatus": "unavailable",
                    "errorCode": str(error)[:100],
                }

        with ThreadPoolExecutor(max_workers=min(8, len(due))) as executor:
            observations = list(executor.map(check_source, due))

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for observation in observations:
            source = observation["source"]
            key = f"{source['companyKey']}\0{source['verdictRevisionId']}"
            grouped.setdefault(key, []).append(observation)

        for observation in observations:
            source = observation["source"]
            key = f"{source['companyKey']}\0{source['verdictRevisionId']}"
            group = grouped[key]
            all_unavailable = (
                len(group) >= int(source.get("approvedSourceCount") or 1)
                and all(item["outcome"] == "unavailable" for item in group)
            )
            proposal_id: Optional[str] = None
            if observation["outcome"] != "unchanged":
                proposal_id = "industry-freshness-" + hashlib.sha256(
                    key.encode("utf-8")
                ).hexdigest()[:20]
                triggers = ["scheduled_freshness"]
                if observation["outcome"] == "changed":
                    triggers.append("material_source_change")
                elif observation["outcome"] == "conflict":
                    triggers.append("evidence_conflict")
                else:
                    triggers.append("source_unavailable")
                proposal = self.client.upsert_industry_proposal(
                    {
                        "proposalId": proposal_id,
                        "companyKey": source["companyKey"],
                        "triggerReasons": triggers,
                        "priority": (
                            100
                            if all_unavailable or observation["outcome"] == "conflict"
                            else 95
                            if observation["outcome"] == "changed"
                            else 85
                        ),
                        "currentRevisionId": source["verdictRevisionId"],
                        "materialChangeSummary": (
                            "All approved sources were unavailable."
                            if all_unavailable
                            else f"Scheduled source check returned {observation['outcome']}."
                        ),
                    }
                ).get("proposalId", proposal_id)
            check_seed = "\0".join(
                [
                    str(source["sourceId"]),
                    str(source["verdictRevisionId"]),
                    str(observation["checkedAt"]),
                    str(observation["outcome"]),
                    str(observation.get("observedContentFingerprint") or ""),
                ]
            )
            payload = {
                "checkId": "industry-check-"
                + hashlib.sha256(check_seed.encode("utf-8")).hexdigest()[:24],
                "sourceId": source["sourceId"],
                "companyKey": source["companyKey"],
                "verdictRevisionId": source["verdictRevisionId"],
                **({"proposalId": proposal_id} if proposal_id else {}),
                "checkedAt": observation["checkedAt"],
                "outcome": observation["outcome"],
                "fetchStatus": observation["fetchStatus"],
                **(
                    {"observedUrl": observation["observedUrl"]}
                    if observation.get("observedUrl")
                    else {}
                ),
                **(
                    {"observedTitle": str(observation["observedTitle"])[:300]}
                    if observation.get("observedTitle")
                    else {}
                ),
                **(
                    {"observedExcerpt": str(observation["observedExcerpt"])[:MAX_EXCERPT_LENGTH]}
                    if observation.get("observedExcerpt")
                    else {}
                ),
                **(
                    {
                        "observedContentFingerprint": observation[
                            "observedContentFingerprint"
                        ]
                    }
                    if observation.get("observedContentFingerprint")
                    else {}
                ),
                **(
                    {"errorCode": observation["errorCode"]}
                    if observation.get("errorCode")
                    else {}
                ),
            }
            self.client.record_industry_evidence_freshness_check(payload)
            # Count + ledger each freshness observation.
            self._bump_count("freshnessChecked")
            outcome = observation["outcome"]
            if outcome != "unchanged":
                self._bump_count("freshnessRefreshed")
            if self.run_id:
                source_id = str(source.get("sourceId") or "")
                self._ledger(
                    "industry-freshness-" + hashlib.sha256(
                        (source.get("companyKey", "") + "\0" + source_id).encode("utf-8")
                    ).hexdigest()[:20],
                    "freshness_refreshed" if outcome != "unchanged" else "freshness_ok",
                    f"freshness {outcome}",
                    company_key=str(source.get("companyKey") or "") or None,
                )

    def run(self) -> bool:
        try:
            if self.mode == "targeted":
                self._research_targeted_proposals()
            elif self.mode == "freshness":
                pass
            else:
                if self.target_proposal_ids:
                    self._research_targeted_proposals()
                self._research_open_proposals()
            if self.mode != "targeted":
                self._freshness_checks()
            self._finish_run("completed")
            return True
        except Exception as error:  # noqa: BLE001
            logger.error("[IndustryEvidenceMaintenance] failed: %s", error)
            self._bump_count("errors")
            self._finish_run("failed", failure_message=str(error))
            return False


def build_discovery_job_from_env() -> Optional[Any]:
    """Build a DiscoveryJob when WEB_RESEARCH_ENABLED; None otherwise (default off).

    Lazy imports keep the web_research package out of the import graph when
    the feature is disabled.
    """
    from apps.worker.web_research.config import load_web_research_config

    config = load_web_research_config()
    if not config.enabled:
        return None

    from apps.worker.web_research.discovery import DiscoveryJob
    from apps.worker.web_research.http import GuardedWebResearchFetcher
    from apps.worker.web_research.search import build_search_chain

    fetcher = GuardedWebResearchFetcher()
    client = ResearchConvexClient()
    search_chain = build_search_chain(config, fetcher=fetcher)
    return DiscoveryJob(
        search_chain=search_chain,
        fetcher=fetcher,
        client=client,
        config=config,
    )


def run_industry_evidence_maintenance(
    run_id: Optional[str] = None,
    trigger: str = "schedule",
    proposal_ids: Optional[Sequence[str]] = None,
    requests: Optional[Sequence[Dict[str, Any]]] = None,
    mode: Optional[str] = None,
) -> bool:
    """Run governed industry-evidence maintenance.

    When ``run_id`` is supplied, the run is expected to already exist in the
    Convex registry (created by the API pipeline); this function claims it,
    runs the job, and finishes it. When ``run_id`` is None (direct CLI or
    scheduled invocation), a run is self-registered so history is complete.

    The ``trigger`` labels the run source when self-registering.
    """
    client = ResearchConvexClient()

    if not industry_evidence_maintenance_enabled():
        logger.info(
            "[IndustryEvidenceMaintenance] skipped — "
            "INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED not set"
        )
        if run_id:
            client.claim_maintenance_run(run_id)
            client.finish_maintenance_run(
                {
                    "runId": run_id,
                    "status": "skipped",
                    "operatorSummary": "skipped; maintenance env gate disabled",
                    "failureMessage": "INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED not set",
                }
            )
        return True

    # Schedule-only pause flag (manual/scoped triggers ignore it).
    if trigger == "schedule":
        paused = False
        try:
            paused = bool(client.get_schedule_paused().get("paused"))
        except Exception as error:  # noqa: BLE001 - best-effort flag
            logger.warning(
                "[IndustryEvidenceMaintenance] get_schedule_paused failed: %s",
                error,
            )
        if paused:
            logger.info(
                "[IndustryEvidenceMaintenance] skipped — schedule paused"
            )
            if not run_id:
                run_id = str(uuid.uuid4())
                client.start_maintenance_run(
                    {
                        "runId": run_id,
                        "workspaceSlug": (
                            os.environ.get("WORKSPACE_SLUG", "dev").strip() or "dev"
                        ),
                        "triggerSource": trigger,
                    }
                )
            client.claim_maintenance_run(run_id)
            client.finish_maintenance_run(
                {
                    "runId": run_id,
                    "status": "skipped",
                    "operatorSummary": "skipped; schedule paused",
                    "failureMessage": "schedule paused",
                }
            )
            return True

        # Materialize only a bounded low-priority lane. The worker still
        # receives an ordinary sweep run, so user-targeted leases are claimed
        # by priority first and are not replaced by this producer.
        try:
            client.enqueue_scheduled_industry_research(
                os.environ.get("WORKSPACE_SLUG", "dev").strip() or "dev",
                limit=20,
            )
        except Exception as error:  # noqa: BLE001 - producer is best effort
            logger.warning(
                "[IndustryEvidenceMaintenance] scheduled queue producer failed: %s",
                error,
            )

    if not run_id:
        run_id = str(uuid.uuid4())
        client.start_maintenance_run(
            {
                "runId": run_id,
                "workspaceSlug": os.environ.get("WORKSPACE_SLUG", "dev").strip() or "dev",
                "triggerSource": trigger,
            }
        )
    # API-triggered runs are created as queued. Claim both entry paths before
    # research so the operator surface reflects the actual worker state while
    # the long-running batch is in progress.
    claimed_run = client.claim_maintenance_run(run_id)
    if claimed_run is False:
        logger.info(
            "[IndustryEvidenceMaintenance] run %s is already owned or finished; aborting stale delivery",
            run_id,
        )
        return False

    claimed_proposal_ids = list(proposal_ids or [])
    claimed_requests = list(requests or [])
    if not claimed_proposal_ids and trigger == "schedule":
        claimed = client.claim_industry_research_requests(
            run_id=run_id,
            workspace_slug=os.environ.get("WORKSPACE_SLUG", "dev").strip() or "dev",
            limit=20,
        )
        claimed_proposal_ids = [
            str(item).strip()
            for item in (claimed.get("proposalIds") or [])
            if str(item).strip()
        ]
        claimed_requests = [
            dict(item)
            for item in (claimed.get("requests") or [])
            if isinstance(item, dict)
        ]

    discovery_job = build_discovery_job_from_env()
    # Allow operators to scale the per-run proposal batch via env var.
    # Default 200 (2026-08-09 P0.1: backlog drain is network-bound, runs
    # minutes each; sweep headroom scan_limit = proposal_limit * 3 sits just
    # under the Convex list cap of 500). Lower (e.g., 20) for scheduled runs.
    proposal_limit = int(os.environ.get("INDUSTRY_PROPOSAL_LIMIT", "200"))
    return IndustryEvidenceMaintenanceJob(
        client=client,
        discovery_job=discovery_job,
        run_id=run_id,
        mode=mode or ("targeted" if proposal_ids else "sweep"),
        target_proposal_ids=claimed_proposal_ids,
        claimed_requests=claimed_requests,
        proposal_limit=proposal_limit,
    ).run()


__all__ = [
    "DomainConcurrencyLimiter",
    "GuardedEvidenceFetcher",
    "HostCircuitBreaker",
    "IndustryEvidenceMaintenanceJob",
    "IndustryEvidenceResearcher",
    "build_discovery_job_from_env",
    "classify_industry_excerpt",
    "industry_evidence_maintenance_enabled",
    "run_industry_evidence_maintenance",
    "safe_public_evidence_url",
]
