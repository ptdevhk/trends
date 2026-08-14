"""P0.2–P0.5 industry-evidence sweep performance tests.

Drives the shipped ``IndustryEvidenceMaintenanceJob`` sweep path with a
stubbed HTTP transport at the module seam (``urlopen``), the fake convex
client pattern from test_industry_evidence_research.py, and fake discovery
providers where the once-per-sweep hotlist snapshot is exercised.

Covered:
- P0.2 bounded proposal concurrency, per-domain cap, connect-timeout split,
  per-host circuit breaker, per-proposal failure isolation.
- P0.3 per-sweep normalized-URL evidence cache.
- P0.4 resume-impact-first sweep ordering + priority-only fallback.
- P0.5 once-per-sweep hotlist snapshot with in-batch matching.
"""

from __future__ import annotations

import threading
import time
from urllib.error import URLError
from urllib.parse import urlparse

import pytest

from apps.worker import industry_evidence_research as ier
from apps.worker.industry_evidence_research import (
    GuardedEvidenceFetcher,
    IndustryEvidenceMaintenanceJob,
)
from apps.worker.web_research.config import load_web_research_config
from apps.worker.web_research.discovery import DiscoveryJob
from apps.worker.web_research.search import (
    NewsNowSearchProvider,
    SearchResult,
)


# ---------------------------------------------------------------------------
# Transport + client fakes
# ---------------------------------------------------------------------------

class _Headers:
    @staticmethod
    def get_content_charset():
        return "utf-8"


class _Response:
    status = 200
    headers = _Headers()

    def __init__(self, url, body=b"<title>ACME CNC</title><p>CNC machine tools</p>"):
        self._url = url
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def geturl(self):
        return self._url

    def read(self, _limit):
        return self._body


class _ConcurrentTransport:
    """urlopen stand-in recording max concurrent in-flight fetches.

    Tracks both the global in-flight high-water mark and the per-host one so
    tests can prove the per-domain cap is per-domain, not global.
    """

    def __init__(self, sleep: float = 0.15, error: Exception | None = None):
        self.sleep = sleep
        self.error = error
        self.calls: list[str] = []
        self.in_flight = 0
        self.max_in_flight = 0
        self.max_per_host: dict[str, int] = {}
        self._host_in_flight: dict[str, int] = {}
        self._lock = threading.Lock()

    def __call__(self, request, timeout):
        host = (urlparse(request.full_url).hostname or "").lower()
        with self._lock:
            self.calls.append(request.full_url)
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            host_count = self._host_in_flight.get(host, 0) + 1
            self._host_in_flight[host] = host_count
            self.max_per_host[host] = max(
                self.max_per_host.get(host, 0), host_count
            )
        try:
            if self.sleep:
                time.sleep(self.sleep)
            if self.error is not None:
                raise self.error
            return _Response(request.full_url)
        finally:
            with self._lock:
                self.in_flight -= 1
                self._host_in_flight[host] -= 1


class FakeSweepClient:
    """Duck-typed ResearchConvexClient for sweep-level tests."""

    def __init__(self):
        self.proposals: list[dict] = []
        self.sources_by_proposal: dict[str, list[dict]] = {}
        self.research_order: list[str] = []
        self.impact: dict[str, int] = {}
        self.impact_raises: Exception | None = None
        self.impact_calls: list[list[str]] = []
        self.operations: list[tuple[str, dict]] = []
        self.due: list[dict] = []

    def list_industry_proposals(self, status=None, limit=None):
        if status is None:
            return list(self.proposals)
        return [p for p in self.proposals if p.get("status") == status]

    def get_industry_resume_impact(self, company_keys):
        self.impact_calls.append(list(company_keys))
        if self.impact_raises is not None:
            raise self.impact_raises
        return dict(self.impact)

    def set_industry_proposal_research_state(self, payload):
        # Called twice per proposal (researching + final state); record only
        # the first call so research_order reflects the planned order.
        if payload["proposalId"] not in self.research_order:
            self.research_order.append(payload["proposalId"])
        self.operations.append(("set_research_state", dict(payload)))
        return payload

    def list_industry_evidence_sources(self, *, proposal_id=None, company_key=None):
        return list(self.sources_by_proposal.get(proposal_id or "", []))

    def upsert_industry_evidence_source(self, payload):
        self.operations.append(("upsert_source", dict(payload)))
        return {"sourceId": payload["sourceId"], "created": True}

    def list_due_industry_evidence_sources(self, now, limit):
        return list(self.due)

    def mark_industry_evidence_profiles_checking(self, profiles):
        self.operations.append(("mark_checking", {"profiles": profiles}))
        return {"marked": len(profiles)}

    def upsert_industry_proposal(self, payload):
        self.operations.append(("upsert_proposal", dict(payload)))
        return {"proposalId": payload["proposalId"], "created": True}

    def record_industry_evidence_freshness_check(self, payload):
        self.operations.append(("record_check", dict(payload)))
        return {"checkId": payload["checkId"], "created": True}

    def upsert_industry_identity_candidate(self, payload):
        self.operations.append(("identity_candidate", dict(payload)))
        return {"candidateFingerprint": payload["candidateFingerprint"]}


def _proposal(proposal_id, priority=1, status="new", company_key=None):
    return {
        "proposalId": proposal_id,
        "companyKey": company_key,
        "priority": priority,
        "status": status,
    }


def _with_candidate(client, proposal_id, url):
    client.sources_by_proposal[proposal_id] = [
        {
            "sourceId": f"c-{proposal_id}",
            "url": url,
            "sourceType": "official_site",
            "trustTier": "primary",
        }
    ]


def _sweep_job(client, transport, monkeypatch, concurrency=None):
    """Build the shipped sweep job with the transport stubbed at the module
    seam, exactly like the existing urlopen-patching tests."""
    monkeypatch.setattr(ier, "_resolved_host_is_public", lambda host: True)
    monkeypatch.setattr(ier, "urlopen", transport)
    if concurrency is not None:
        monkeypatch.setenv("INDUSTRY_RESEARCH_CONCURRENCY", str(concurrency))
    return IndustryEvidenceMaintenanceJob(client=client)


# ---------------------------------------------------------------------------
# P0.2 — parallel sweep with safety rails
# ---------------------------------------------------------------------------

def test_sweep_parallelism_caps_concurrent_fetches_at_env_value(monkeypatch):
    """8 proposals x 0.15s fetches with concurrency=4: never more than 4
    fetches in flight, and the wall clock stays far below sequential."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(sleep=0.15)
    for i in range(8):
        proposal_id = f"p-{i}"
        client.proposals.append(_proposal(proposal_id, priority=10 - i))
        _with_candidate(
            client, proposal_id, f"https://site{i}.example.com/products"
        )
    job = _sweep_job(client, transport, monkeypatch, concurrency=4)

    started = time.monotonic()
    assert job.run() is True
    elapsed = time.monotonic() - started

    assert len(transport.calls) == 8
    assert transport.max_in_flight == 4, (
        f"structural: max concurrent fetches must be exactly 4, got "
        f"{transport.max_in_flight}"
    )
    assert elapsed < 0.9, (
        f"sweep took {elapsed:.2f}s; sequential would be >= 1.2s"
    )
    assert job._counts["proposalsResearched"] == 8


def test_sweep_domain_cap_is_per_domain_not_global(monkeypatch):
    """6 proposals split 3/3 across two domains, per-domain cap 2: never
    more than 2 concurrent fetches per domain while total concurrency
    exceeds 2 across domains (proves the cap is per-domain, not global)."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(sleep=0.2)
    for i in range(3):
        proposal_id = f"a-{i}"
        client.proposals.append(_proposal(proposal_id))
        _with_candidate(client, proposal_id, f"https://alpha.example.com/{proposal_id}")
    for i in range(3):
        proposal_id = f"b-{i}"
        client.proposals.append(_proposal(proposal_id))
        _with_candidate(client, proposal_id, f"https://beta.example.com/{proposal_id}")
    monkeypatch.setenv("INDUSTRY_RESEARCH_DOMAIN_CONCURRENCY", "2")
    job = _sweep_job(client, transport, monkeypatch, concurrency=4)

    assert job.run() is True

    assert transport.max_per_host == {
        "alpha.example.com": 2,
        "beta.example.com": 2,
    }, transport.max_per_host
    assert transport.max_in_flight > 2, (
        "total concurrency must exceed the per-domain cap across domains"
    )


def test_sweep_fails_fast_on_unreachable_host_and_trips_breaker(monkeypatch):
    """URLError-immediate host, 3 proposals, retries=2 + www sibling: the
    breaker trips after 3 failed attempts; later proposals attempt 0
    connections and the sweep completes instead of failing the run."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(
        sleep=0.0, error=URLError("connection refused")
    )
    for i in range(3):
        proposal_id = f"p-{i}"
        client.proposals.append(_proposal(proposal_id))
        _with_candidate(
            client, proposal_id, f"https://dead.example.com/{proposal_id}"
        )
    # Deterministic execution order (concurrency=1) so the attempt count is
    # exact: p-0 burns 3 attempts (2 retries + 1 www sibling), p-1's first
    # attempt is the 3rd consecutive failure (opens the circuit), p-2
    # connects 0 times.
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    started = time.monotonic()
    assert job.run() is True
    elapsed = time.monotonic() - started

    assert elapsed < 5.0, f"sweep took {elapsed:.2f}s"
    assert len(transport.calls) == 4, transport.calls
    assert job._counts["errors"] == 0, "fetch failures are per-source, not errors"


def test_circuit_breaker_opens_after_threshold_without_transport(monkeypatch):
    """Host fails M=3 times -> later fetches to that host raise
    fetch_failed:circuit_open without calling the transport: exactly 3
    transport calls to the dead host, none after the circuit opens."""
    calls = {"count": 0}
    calls_by_host: dict[str, int] = {}

    def fake_urlopen(request, timeout):
        host = (urlparse(request.full_url).hostname or "").lower()
        calls["count"] += 1
        calls_by_host[host] = calls_by_host.get(host, 0) + 1
        raise URLError("connection refused")

    monkeypatch.setattr(ier, "_resolved_host_is_public", lambda host: True)
    monkeypatch.setattr(ier, "urlopen", fake_urlopen)
    fetcher = GuardedEvidenceFetcher()
    url = "https://dead.example.com/page"

    with pytest.raises(RuntimeError, match="fetch_failed"):
        fetcher.fetch(url)  # 2 retries + 1 www-sibling attempt: dead=2
    with pytest.raises(RuntimeError, match="fetch_failed"):
        fetcher.fetch(url)  # 1st attempt is the 3rd failure -> circuit open;
        # the retry and the www-sibling attempts fail fast, no transport
    with pytest.raises(RuntimeError, match="fetch_failed:circuit_open"):
        fetcher.fetch(url)  # fail-fast, no transport
    with pytest.raises(RuntimeError, match="fetch_failed:circuit_open"):
        fetcher.fetch(url)  # fail-fast, no transport

    assert calls_by_host.get("dead.example.com", 0) == 3, (
        "the dead host must be contacted exactly 3 times, not more"
    )
    assert calls["count"] == 4, (
        "1 www-sibling attempt rides along with the first fetch; after the "
        "trip no further transport call may happen"
    )


def test_circuit_breaker_never_opens_on_policy_rejections(monkeypatch):
    """unsafe_url / unsafe_or_unresolved_host are policy rejections, not
    provider health: they must never trip the breaker."""
    transport = _ConcurrentTransport(sleep=0.0)
    monkeypatch.setattr(ier, "urlopen", transport)
    monkeypatch.setattr(ier, "_resolved_host_is_public", lambda host: False)
    fetcher = GuardedEvidenceFetcher()
    with pytest.raises(ValueError, match="unsafe_url"):
        fetcher.fetch("http://127.0.0.1/private")
    with pytest.raises(ValueError, match="unsafe_or_unresolved_host"):
        fetcher.fetch("https://example.com/x")
    assert transport.calls == []
    assert fetcher.circuit_breaker._open_hosts == set()


def test_sweep_proposal_failure_is_isolated_and_counted(monkeypatch):
    """One proposal raising inside _research_one_proposal must not abort the
    sweep: the others run, the failure is counted as an error, and the run
    still completes."""

    class BoomClient(FakeSweepClient):
        def set_industry_proposal_research_state(self, payload):
            if payload["proposalId"] == "p-boom":
                raise RuntimeError("convex exploded")
            return super().set_industry_proposal_research_state(payload)

    client = BoomClient()
    transport = _ConcurrentTransport(sleep=0.05)
    for i in range(3):
        proposal_id = ["p-ok-1", "p-boom", "p-ok-2"][i]
        client.proposals.append(_proposal(proposal_id))
        _with_candidate(client, proposal_id, f"https://ok{i}.example.com/x")
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True
    assert client.research_order == ["p-ok-1", "p-ok-2"]
    assert job._counts["errors"] == 1


def test_connect_timeout_is_split_from_read_timeout(monkeypatch):
    """The split-timeout connection uses socket.create_connection with the
    connect timeout, then resets the socket to the read timeout before the
    body is read."""
    created = {}

    def fake_create_connection(address, timeout=None, source_address=None):
        created["address"] = address
        created["timeout"] = timeout
        sock = threading.local()  # stand-in with settimeout
        sock.timeout = None

        class _Sock:
            def settimeout(self, value):
                created["read_timeout"] = value

        return _Sock()

    monkeypatch.setattr(ier.socket, "create_connection", fake_create_connection)
    connection = ier._SplitConnectTimeoutHTTPConnection(
        "acme.example.com", timeout=10, connect_timeout=5
    )
    connection.connect()
    assert created["address"] == ("acme.example.com", 80)
    assert created["timeout"] == 5
    assert created["read_timeout"] == 10


def test_transport_opener_is_env_driven(monkeypatch):
    monkeypatch.setenv("INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS", "3")
    opener = ier._transport_opener(ier._env_connect_timeout_seconds())
    handlers = [
        handler
        for handler in opener.handlers
        if isinstance(handler, ier._SplitConnectTimeoutHTTPHandler)
    ]
    assert len(handlers) == 1
    assert handlers[0]._connect_timeout == 3.0
    monkeypatch.setenv("INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS", "garbage")
    assert ier._env_connect_timeout_seconds() == 5.0
    monkeypatch.setenv("INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS", "99")
    assert ier._env_connect_timeout_seconds() == 9.0, "connect < read timeout"


# ---------------------------------------------------------------------------
# P0.3 — per-sweep evidence cache
# ---------------------------------------------------------------------------

def test_sweep_evidence_cache_dedupes_normalized_urls_across_proposals(
    monkeypatch,
):
    """Two proposals whose source URLs normalize to the same URL: the stub
    transport is called exactly ONCE and both results carry the identical
    contentFingerprint."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(sleep=0.0)
    client.proposals = [_proposal("p-1"), _proposal("p-2")]
    _with_candidate(client, "p-1", "https://ACME.example.com/Products/#top")
    _with_candidate(client, "p-2", "https://acme.example.com/Products")
    # Deterministic execution order (concurrency=1) so the cache is
    # populated before the second proposal fetches.
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True
    assert len(transport.calls) == 1, transport.calls

    upserts = [
        payload
        for name, payload in client.operations
        if name == "upsert_source"
    ]
    assert len(upserts) == 2
    fingerprints = {upsert["contentFingerprint"] for upsert in upserts}
    assert len(fingerprints) == 1, "both proposals must share one fingerprint"
    assert len(job._shared_fetcher._evidence_cache) == 1


def test_evidence_cache_hit_returns_shallow_copy(monkeypatch):
    calls = {"count": 0}

    def fake_urlopen(request, timeout):
        calls["count"] += 1
        return _Response(request.full_url)

    monkeypatch.setattr(ier, "_resolved_host_is_public", lambda host: True)
    monkeypatch.setattr(ier, "urlopen", fake_urlopen)
    fetcher = GuardedEvidenceFetcher()
    url = "https://acme.example.com/about"

    first = fetcher.fetch(url)
    first["excerpt"] = "mutated by caller"

    second = fetcher.fetch(url)
    assert calls["count"] == 1
    assert second["excerpt"] != "mutated by caller"
    assert second["contentFingerprint"] == first["contentFingerprint"]
    assert second["domainGuardPassed"] is True


# ---------------------------------------------------------------------------
# P0.4 — resume-impact-first sweep ordering
# ---------------------------------------------------------------------------

def test_sweep_orders_by_resume_impact_before_priority(monkeypatch):
    """Impact {acme: 5, beta: 1, gamma: 0} vs priorities {acme: 10, gamma:
    50, beta: 40}: a low-priority high-frequency employer precedes a
    high-priority low-frequency one -> acme, beta, gamma."""
    client = FakeSweepClient()
    client.proposals = [
        _proposal("gamma", priority=50, company_key="gamma"),
        _proposal("acme", priority=10, company_key="acme"),
        _proposal("beta", priority=40, company_key="beta"),
    ]
    client.impact = {"acme": 5, "beta": 1, "gamma": 0}
    transport = _ConcurrentTransport(sleep=0.0)
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True
    assert client.research_order == ["acme", "beta", "gamma"], (
        client.research_order
    )
    assert client.impact_calls == [["acme", "beta", "gamma"]]


def test_sweep_impact_failure_falls_back_to_priority_only_order(monkeypatch):
    """The impact query raising (e.g. not deployed) must not crash the sweep:
    ordering falls back to priority-only."""
    client = FakeSweepClient()
    client.proposals = [
        _proposal("gamma", priority=50, company_key="gamma"),
        _proposal("acme", priority=10, company_key="acme"),
        _proposal("beta", priority=40, company_key="beta"),
    ]
    client.impact_raises = RuntimeError("query not deployed")
    transport = _ConcurrentTransport(sleep=0.0)
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True
    assert client.research_order == ["gamma", "beta", "acme"]


def test_sweep_missing_impact_method_falls_back_silently(monkeypatch):
    """Fake clients without the impact method (the pre-P0.4 shape) keep
    working: priority-only ordering, no crash."""

    class NoImpactClient(FakeSweepClient):
        # Shadow the inherited method with a non-callable, mirroring a
        # pre-P0.4 client that never had the query.
        get_industry_resume_impact = None

    client = NoImpactClient()
    client.proposals = [
        _proposal("gamma", priority=50, company_key="gamma"),
        _proposal("acme", priority=10, company_key="acme"),
    ]
    transport = _ConcurrentTransport(sleep=0.0)
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True
    assert client.research_order == ["gamma", "acme"]


# ---------------------------------------------------------------------------
# P0.5 — once-per-sweep CN hotlist with in-batch matching
# ---------------------------------------------------------------------------

class _JsonFetcher:
    """get_json stand-in counting transport calls (the hotlist endpoint)."""

    def __init__(self, payloads):
        self.payloads = payloads
        self.calls: list[str] = []

    def get_json(self, url, headers=None):
        self.calls.append(url)
        return self.payloads.get(url, {})


class _RecordingSearch:
    def __init__(self, results):
        self.results = results
        self.calls: list[str] = []

    def search(self, query, max_results):
        self.calls.append(query)
        return list(self.results)


class _StaticFetcher:
    def __init__(self, pages):
        self.pages = pages
        self.fetched: list[str] = []

    def fetch(self, url, expected_domain=None):
        self.fetched.append(url)
        return dict(self.pages[url])


class _DiscoveryClient:
    def get_web_research_quota(self, provider):
        return {"used": 0, "cap": 1000}

    def record_web_research_quota_use(self, provider, credits):
        pass


HOTLIST_URL = "https://hotlist.example/api/s?id=zhihu&latest"

_HOTLIST_PAYLOAD = {
    "status": "success",
    "items": [
        {"title": "发那科 数控 机床 价格", "url": "https://zhihu.example/q/1"},
        {"title": "无关热搜", "url": "https://zhihu.example/q/2"},
    ],
}


def _hotlist_discovery(json_fetcher, recording=None, *, fetcher=None):
    newsnow = NewsNowSearchProvider(
        fetcher=json_fetcher,
        platforms=["zhihu"],
        api_url="https://hotlist.example/api/s",
    )
    recording = recording or _RecordingSearch([])
    return DiscoveryJob(
        search_chain=[newsnow, recording],
        fetcher=fetcher or _StaticFetcher({}),
        client=_DiscoveryClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    ), recording


def test_sweep_fetches_hotlist_exactly_once_across_proposals(monkeypatch):
    """N proposals in one sweep: the hotlist endpoint is fetched EXACTLY once
    (lazily on first use), never per proposal."""
    json_fetcher = _JsonFetcher({HOTLIST_URL: _HOTLIST_PAYLOAD})
    discovery, recording = _hotlist_discovery(json_fetcher)
    client = FakeSweepClient()
    for i in range(3):
        proposal_id = f"p-{i}"
        client.proposals.append(
            {
                **_proposal(proposal_id),
                "normalizedEmployerSurface": "Acme Industrial Pte Ltd",
            }
        )
    job = IndustryEvidenceMaintenanceJob(client=client, discovery_job=discovery)

    assert job.run() is True
    assert json_fetcher.calls == [HOTLIST_URL], (
        "hotlist must be fetched exactly once per sweep"
    )
    assert recording.calls, "non-matching proposals still search"


def test_hotlist_match_short_circuits_per_proposal_search():
    """A proposal whose employer matches a hotlist entry performs ZERO
    search-chain calls and gets discovery sources derived from the hotlist
    payload (headline as the evidence excerpt)."""
    json_fetcher = _JsonFetcher({HOTLIST_URL: _HOTLIST_PAYLOAD})
    discovery, recording = _hotlist_discovery(
        json_fetcher,
        recording=_RecordingSearch(
            [SearchResult(url="https://search.example/x", title="never used")]
        ),
    )

    out = discovery.discover_for_proposal(
        {
            "proposalId": "p-cn",
            "normalizedEmployerSurface": "发那科",
            "companyKey": None,
        }
    )

    assert recording.calls == [], "search chain must not be invoked"
    assert out["sources"], "hotlist matches must produce discovery sources"
    excerpts = [source.get("evidenceExcerpt", "") for source in out["sources"]]
    assert any("发那科" in excerpt for excerpt in excerpts), excerpts
    assert any("无关热搜" not in excerpt for excerpt in excerpts)


def test_hotlist_non_match_falls_through_to_per_proposal_search():
    """A non-matching proposal still goes through the existing per-proposal
    search path and can reach ready_for_review via a search hit."""
    json_fetcher = _JsonFetcher({HOTLIST_URL: _HOTLIST_PAYLOAD})
    hit_url = "https://www.newlinemachine.com/"
    discovery, recording = _hotlist_discovery(
        json_fetcher,
        recording=_RecordingSearch(
            [
                SearchResult(
                    url=hit_url,
                    title="New Line Machine Tool",
                )
            ],
        ),
        fetcher=_StaticFetcher(
            {
                hit_url: {
                    "finalUrl": hit_url,
                    "title": "New Line Machine Tool",
                    "excerpt": "CNC machining center machine tool distributor",
                    "contentFingerprint": "sha256:x",
                    "domainGuardPassed": True,
                }
            }
        ),
    )

    out = discovery.discover_for_proposal(
        {
            "proposalId": "p-en",
            "normalizedEmployerSurface": "New Line Machine Tool Sdn Bhd",
            "companyKey": None,
        }
    )

    assert recording.calls, "non-matching proposal must search"
    assert out["status"] == "ready_for_review"
    assert out["sources"][0]["url"] == hit_url

# ---------------------------------------------------------------------------
# ready_for_review sweep coverage + CN registry classification refresh
# ---------------------------------------------------------------------------

def test_sweep_researches_unmapped_ready_proposals_but_skips_mapped(monkeypatch):
    """Unmapped ready_for_review proposals re-run research (identity
    candidates are only extracted during research); mapped ready proposals
    are reviewable as-is and must not be re-fetched every sweep round."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(sleep=0.0)
    client.proposals.append(
        _proposal("p-unmapped", status="ready_for_review", company_key=None)
    )
    _with_candidate(client, "p-unmapped", "https://site-a.example.com/products")
    client.proposals.append(
        _proposal("p-mapped", status="ready_for_review", company_key="acme-cnc")
    )
    _with_candidate(client, "p-mapped", "https://site-b.example.com/products")
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True

    assert "p-unmapped" in client.research_order
    assert "p-mapped" not in client.research_order


def test_sweep_demotes_stored_qcc_homepage_registry_rows(monkeypatch):
    """A stored qcc.com homepage (360-search landing) classified as
    registry/authoritative before the record-path guard is re-classified to
    search_result/discovery on re-research, so its fetch failure can no
    longer hard-block review with stale_or_failed_source."""
    client = FakeSweepClient()
    transport = _ConcurrentTransport(sleep=0.0, error=URLError("connection refused"))
    client.proposals.append(_proposal("p-cn", status="ready_for_review"))
    client.sources_by_proposal["p-cn"] = [
        {
            "sourceId": "c-cn",
            "url": "https://www.qcc.com/?utm_source=360zrkp&utm_query=%E6%B5%8E%E5%8D%97",
            "sourceType": "registry",
            "trustTier": "authoritative",
            "title": "企查查",
            "evidenceExcerpt": "企查查",
        }
    ]
    job = _sweep_job(client, transport, monkeypatch, concurrency=1)

    assert job.run() is True

    upserted = [op[1] for op in client.operations if op[0] == "upsert_source"]
    assert upserted, "the stored source must be re-upserted"
    assert upserted[0]["sourceType"] == "search_result"
    assert upserted[0]["trustTier"] == "discovery"
