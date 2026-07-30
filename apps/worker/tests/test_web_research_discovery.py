from apps.worker.industry_evidence_research import (
    IndustryEvidenceMaintenanceJob,
    IndustryEvidenceResearcher,
)
from apps.worker.web_research.discovery import DiscoveryJob, discovery_queries
from apps.worker.web_research.search import SearchResult
from apps.worker.web_research.config import load_web_research_config

class StaticSearch:
    def __init__(self, results):
        self.results = results
        self.calls = []
    def search(self, query, max_results):
        self.calls.append(query)
        return list(self.results)

class StaticFetcher:
    def __init__(self, pages):
        self.pages = pages
        self.fetched = []
        self.calls = self.fetched
    def fetch(self, url, expected_domain=None):
        self.fetched.append(url)
        return dict(self.pages[url])

class FakeClient:
    def __init__(self, quota=0, cap=1000):
        self.quota = quota
        self.cap = cap
        self.quota_calls = []
    def get_web_research_quota(self, provider):
        return {"used": self.quota, "cap": self.cap}
    def record_web_research_quota_use(self, provider, credits):
        self.quota_calls.append((provider, credits))

class RaisingSearch:
    def __init__(self):
        self.calls = []
    def search(self, query, max_results):
        self.calls.append(query)
        raise RuntimeError("provider exploded")

class QuotaErrorClient(FakeClient):
    def get_web_research_quota(self, provider):
        raise RuntimeError("convex unreachable")

def _proposal():
    return {
        "proposalId": "p-1",
        "normalizedEmployerSurface": "New Line Machine Tool Sdn Bhd",
        "companyKey": None,
    }

def test_discovery_enriches_empty_proposal_to_ready_for_review():
    search = StaticSearch([
        SearchResult(url="https://www.newlinemachine.com/",
                     title="New Line Machine Tool"),
    ])
    fetcher = StaticFetcher({
        "https://www.newlinemachine.com/": {
            "finalUrl": "https://www.newlinemachine.com/",
            "title": "New Line Machine Tool",
            "excerpt": "CNC machining center machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "ready_for_review"
    assert out["sources"][0]["sourceType"] == "official_site"
    assert out["sources"][0]["trustTier"] == "primary"
    assert out["suggestedIndustryClass"] == "cnc"

def test_quota_exhausted_short_circuits_no_search():
    search = StaticSearch([SearchResult(url="https://x.example/", title="x")])
    job = DiscoveryJob(
        search_chain=[search],
        fetcher=StaticFetcher({}),
        client=FakeClient(quota=1000, cap=1000),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "needs_more_evidence"
    assert search.calls == []  # hard stop: no provider call made

def test_provider_exception_soft_fails_to_next_provider_in_chain():
    failing = RaisingSearch()
    working = StaticSearch([
        SearchResult(url="https://www.newlinemachine.com/",
                     title="New Line Machine Tool"),
    ])
    fetcher = StaticFetcher({
        "https://www.newlinemachine.com/": {
            "finalUrl": "https://www.newlinemachine.com/",
            "title": "New Line Machine Tool",
            "excerpt": "CNC machining center machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[failing, working], fetcher=fetcher,
        client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    # first provider's RuntimeError must not abort the proposal
    assert failing.calls, "first provider was attempted"
    assert working.calls, "chain fell through to the next provider"
    assert out["status"] == "ready_for_review"
    assert out["sources"][0]["url"] == "https://www.newlinemachine.com/"

def test_quota_read_failure_fails_closed_without_crashing_run():
    search = StaticSearch([SearchResult(url="https://x.example/", title="x")])
    job = DiscoveryJob(
        search_chain=[search],
        fetcher=StaticFetcher({}),
        client=QuotaErrorClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "needs_more_evidence"  # no exception escapes
    assert search.calls == []  # provider treated as exhausted: never called

def test_discovery_disabled_config_returns_needs_more_evidence():
    search = StaticSearch([SearchResult(url="https://x.example/", title="x")])
    job = DiscoveryJob(
        search_chain=[search],
        fetcher=StaticFetcher({}),
        client=FakeClient(),
        config=load_web_research_config({}),  # WEB_RESEARCH_ENABLED unset
    )
    out = job.discover_for_proposal(_proposal())
    assert out == {"status": "needs_more_evidence", "sources": []}
    assert search.calls == []


def test_discovery_queries_are_term_based():
    queries = discovery_queries("DSME Engineering Sdn Bhd", "my")
    assert queries, "expected at least one MY query template"
    for q in queries:
        assert '"' not in q  # no exact-phrase quoting: Google News ANDs phrases
    assert "Malaysia" in queries[0]


def test_discovery_queries_default_market_is_cn():
    assert discovery_queries("发那科") == discovery_queries("发那科", "cn")


def test_discovery_queries_cn_pack_term_based():
    queries = discovery_queries("发那科", "cn")
    assert len(queries) == 3
    for q in queries:
        assert '"' not in q
    joined = " ".join(queries)
    assert "公司" in joined
    assert "机床" in joined
    assert "数控" in joined
    assert all(q.startswith("发那科") for q in queries)


def test_discovery_queries_unknown_market_falls_back_to_generic():
    assert discovery_queries("Acme Corp", "sg") == ["Acme Corp company"]


class TokenAwareSearch:
    """Duck-typed token-aware provider stand-in (mirrors NewsNowSearchProvider)."""
    def __init__(self, results):
        self.results = results
        self.calls = []
        self.tokens = set()
        self.tokens_at_search = []

    def search(self, query, max_results):
        self.calls.append(query)
        self.tokens_at_search.append(set(self.tokens))
        return list(self.results)


def test_token_aware_provider_receives_employer_tokens_before_search():
    search = TokenAwareSearch([
        SearchResult(url="https://www.newlinemachine.com/",
                     title="New Line Machine Tool"),
    ])
    fetcher = StaticFetcher({
        "https://www.newlinemachine.com/": {
            "finalUrl": "https://www.newlinemachine.com/",
            "title": "New Line Machine Tool",
            "excerpt": "CNC machining center machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "ready_for_review"
    assert search.calls, "provider was searched"
    expected = {"new", "line", "machine", "tool"}
    for tokens_seen in search.tokens_at_search:
        assert tokens_seen == expected


def test_tokenless_provider_not_given_tokens_attribute():
    search = StaticSearch([
        SearchResult(url="https://www.newlinemachine.com/",
                     title="New Line Machine Tool"),
    ])
    fetcher = StaticFetcher({
        "https://www.newlinemachine.com/": {
            "finalUrl": "https://www.newlinemachine.com/",
            "title": "New Line Machine Tool",
            "excerpt": "CNC machining center machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "ready_for_review"
    assert not hasattr(search, "tokens")


def test_discovery_uses_config_market_for_query_pack():
    search = StaticSearch([
        SearchResult(url="https://www.newlinemachine.com/",
                     title="New Line Machine Tool"),
    ])
    fetcher = StaticFetcher({
        "https://www.newlinemachine.com/": {
            "finalUrl": "https://www.newlinemachine.com/",
            "title": "New Line Machine Tool",
            "excerpt": "CNC machining center machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({
            "WEB_RESEARCH_ENABLED": "1",
            "WEB_RESEARCH_MARKET": "cn",
        }),
    )
    proposal = {
        "proposalId": "p-1",
        "normalizedEmployerSurface": "发那科",
        "companyKey": None,
    }
    job.discover_for_proposal(proposal)
    assert any("公司" in q for q in search.calls)
    assert not any("Malaysia" in q for q in search.calls)


def test_discovery_filters_unrelated_hits():
    kept_url = "https://theedgemalaysia.com/x"
    dropped_url = "https://www.haasf1team.com/news"
    search = StaticSearch([
        SearchResult(url=kept_url,
                     title="DSME Engineering expands in Penang",
                     snippet=""),
        SearchResult(url=dropped_url,
                     title="Haas F1 Team to Promote HaasTooling.com",
                     snippet="F1 racing news"),
    ])
    fetcher = StaticFetcher({
        kept_url: {
            "finalUrl": kept_url,
            "title": "DSME Engineering expands in Penang",
            "excerpt": "CNC machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    proposal = {
        "proposalId": "p-1",
        "normalizedEmployerSurface": "DSME Engineering Sdn Bhd",
        "companyKey": None,
    }
    out = job.discover_for_proposal(proposal)
    urls = [s["url"] for s in out["sources"]]
    assert kept_url in urls
    assert dropped_url not in urls


def test_discovery_classifies_google_news_hit_by_publisher_domain():
    hit_url = "https://news.google.com/rss/articles/CBMiX"
    search = StaticSearch([
        SearchResult(
            url=hit_url,
            title="DSME Engineering expands Penang CNC plant",
            snippet="The Edge Malaysia",
            publisher_domain="theedgemalaysia.com",
        ),
    ])
    fetcher = StaticFetcher({
        hit_url: {
            "finalUrl": "https://theedgemalaysia.com/article/dsme-penang",
            "title": "DSME Engineering expands Penang CNC plant",
            "excerpt": "DSME Engineering CNC machine tool distributor",
            "contentFingerprint": "sha256:x",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    proposal = {
        "proposalId": "p-1",
        "normalizedEmployerSurface": "DSME Engineering Sdn Bhd",
        "companyKey": None,
    }
    out = job.discover_for_proposal(proposal)
    assert out["sources"], "expected the google news hit to be kept"
    # classified on the publisher domain, not the news.google.com redirect
    assert out["sources"][0]["sourceType"] == "reporting"
    assert out["sources"][0]["trustTier"] == "corroborating"
    # the fetch path follows the redirect and stores the real article url
    assert out["sources"][0]["url"] == (
        "https://theedgemalaysia.com/article/dsme-penang"
    )


def test_discovery_hit_with_discovery_snippet_is_enriched_without_fetch():
    homepage = "https://theedgemalaysia.com"
    snippet = (
        "DSME Engineering expands Penang CNC plant with new machining "
        "centres The Edge Malaysia"
    )
    search = StaticSearch([
        SearchResult(
            url=homepage,
            title="DSME Engineering expands Penang CNC plant",
            snippet="The Edge Malaysia",
            publisher_domain="theedgemalaysia.com",
            discovery_snippet=snippet,
        ),
    ])
    fetcher = StaticFetcher({})
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    proposal = {
        "proposalId": "p-1",
        "normalizedEmployerSurface": "DSME Engineering Sdn Bhd",
        "companyKey": None,
    }
    out = job.discover_for_proposal(proposal)
    assert fetcher.calls == [], (
        "excerpt-carrying hit must skip the fetch path entirely"
    )
    assert out["sources"], "expected the google news hit to be kept"
    source = out["sources"][0]
    assert source["url"] == homepage
    assert source["fetchStatus"] == "fetched"
    assert source["evidenceExcerpt"] == snippet
    assert source["title"] == "DSME Engineering expands Penang CNC plant"
    assert source["sourceType"] == "reporting"
    assert source["trustTier"] == "corroborating"
    assert source["contentFingerprint"].startswith("sha256:")
    assert source["domainGuardPassed"] is True


# --- Step 5: maintenance-job wiring -------------------------------------

class _RecordingDiscovery:
    def __init__(self, sources):
        self.sources = sources
        self.calls = []
    def discover_for_proposal(self, proposal):
        self.calls.append(proposal["proposalId"])
        return {"status": "ready_for_review", "sources": list(self.sources)}

class _MaintenanceFakeClient:
    def __init__(self, candidates):
        self.candidates = candidates
        self.upserted = []
        self.states = []
        self.due = []
    def list_industry_proposals(self, status=None):
        if status == "new":
            return [{
                "proposalId": "p-1",
                "normalizedEmployerSurface": "New Line Machine Tool Sdn Bhd",
                "priority": 1,
            }]
        return []
    def list_industry_evidence_sources(self, proposal_id=None, company_key=None):
        return list(self.candidates)
    def set_industry_proposal_research_state(self, payload):
        self.states.append(payload)
    def upsert_industry_evidence_source(self, payload):
        self.upserted.append(payload)
    def list_due_industry_evidence_sources(self, now, limit):
        return list(self.due)

def _fetched_source():
    # DiscoveryJob output shape: fully-enriched source dict, which also
    # carries every candidate field enrich_proposal reads (url, sourceType,
    # trustTier, sourceId) — passed through as candidates directly.
    return {
        "sourceId": "industry-source-disc",
        "proposalId": "p-1",
        "url": "https://www.newlinemachine.com/",
        "sourceType": "official_site",
        "trustTier": "primary",
        "title": "New Line Machine Tool",
        "evidenceExcerpt": "CNC machining center machine tool distributor",
        "fetchedAt": 1,
        "contentFingerprint": "sha256:x",
        "fetchStatus": "fetched",
        "suggestedIndustryClass": "cnc",
        "workerConfidence": 0.9,
        "domainGuardPassed": True,
    }

_PAGE = {
    "finalUrl": "https://www.newlinemachine.com/",
    "title": "New Line Machine Tool",
    "excerpt": "CNC machining center machine tool distributor",
    "contentFingerprint": "sha256:x",
    "domainGuardPassed": True,
}

def _job(client, discovery_job, fetcher):
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher),
        discovery_job=discovery_job,
    )
    return job

def test_maintenance_job_discovers_when_no_candidates():
    fetcher = StaticFetcher({"https://www.newlinemachine.com/": _PAGE})
    discovery = _RecordingDiscovery([_fetched_source()])
    client = _MaintenanceFakeClient(candidates=[])
    job = _job(client, discovery, fetcher)
    assert job.run() is True
    assert discovery.calls == ["p-1"]
    assert client.upserted, "discovered sources should be upserted after enrichment"
    assert client.upserted[0]["url"] == "https://www.newlinemachine.com/"
    assert client.upserted[0]["sourceType"] == "official_site"
    assert client.states[-1]["status"] == "ready_for_review"

def test_maintenance_job_skips_discovery_when_candidates_exist():
    fetcher = StaticFetcher({"https://www.newlinemachine.com/": _PAGE})
    discovery = _RecordingDiscovery([_fetched_source()])
    client = _MaintenanceFakeClient(candidates=[{
        "url": "https://www.newlinemachine.com/",
        "sourceType": "official_site",
        "trustTier": "primary",
    }])
    job = _job(client, discovery, fetcher)
    assert job.run() is True
    assert discovery.calls == []
    assert client.states[-1]["status"] == "ready_for_review"

def test_maintenance_job_without_discovery_job_preserves_existing_behavior():
    client = _MaintenanceFakeClient(candidates=[])
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=StaticFetcher({})),
    )
    assert job.run() is True  # no discovery: empty candidates -> needs_more_evidence
    assert client.upserted == []
    assert client.states[-1]["status"] == "needs_more_evidence"

# ---------------------------------------------------------------------------
# Employer-relevance tightening (2026-07-30): generic hits whose excerpt
# provably fails to mention the employer are demoted to discovery tier and
# can no longer flip a proposal to ready_for_review on their own.
# ---------------------------------------------------------------------------

class ListingSearch:
    """Returns curated MY press homepages with unrelated excerpts."""
    def __init__(self, results):
        self.results = results
        self.calls = []
    def search(self, query, max_results):
        self.calls.append(query)
        return list(self.results)


def test_homepage_hits_without_employer_excerpt_cannot_flip_ready():
    """The robo-machine-tools failure mode: curated reporting domains with
    homepage titles and no excerpt must NOT count as proof sources."""
    search = ListingSearch([
        SearchResult(url="https://www.nst.com.my/", title="NST Online"),
        SearchResult(url="https://theedgemalaysia.com/",
                     title="The Edge Malaysia"),
    ])
    fetcher = StaticFetcher({
        "https://www.nst.com.my/": {
            "finalUrl": "https://www.nst.com.my/",
            "title": "NST Online",
            "excerpt": "Malaysia news, world updates, sports and lifestyle.",
            "contentFingerprint": "sha256:a",
            "domainGuardPassed": True,
        },
        "https://theedgemalaysia.com/": {
            "finalUrl": "https://theedgemalaysia.com/",
            "title": "The Edge Malaysia",
            "excerpt": "Make better decisions with Malaysian business news.",
            "contentFingerprint": "sha256:b",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "needs_more_evidence"
    assert all(
        source["trustTier"] == "discovery" for source in out["sources"]
    ), "unproven homepage rows must be demoted to discovery tier"
    # Rows are still recorded for steward visibility (not dropped silently);
    # enrichment caps sources per proposal, so at least one survives.
    assert len(out["sources"]) >= 1


def test_homepage_hit_with_employer_excerpt_keeps_reviewable_tier():
    """Excerpt-provided hit (GNews RSS description) that mentions the
    employer keeps its reviewable tier and can flip ready_for_review."""
    search = ListingSearch([
        SearchResult(
            url="https://www.thestar.com.my/",
            title="New Line Machine Tool wins Penang machining contract",
            discovery_snippet=(
                "New Line Machine Tool Sdn Bhd secured a CNC machining "
                "contract with a Penang aerospace supplier."
            ),
        ),
    ])
    job = DiscoveryJob(
        search_chain=[search], fetcher=StaticFetcher({}), client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "ready_for_review"
    assert out["sources"][0]["trustTier"] == "corroborating"
    assert out["sources"][0]["fetchStatus"] == "fetched"


def test_mixed_proven_and_unproven_hits_only_proven_counts():
    """A proposal with one proven excerpt hit + two homepage noise hits
    flips ready via the proven hit alone; noise stays discovery tier."""
    search = ListingSearch([
        SearchResult(
            url="https://www.thestar.com.my/",
            title="New Line Machine Tool expands Penang plant",
            discovery_snippet=(
                "New Line Machine Tool Sdn Bhd expanded its CNC machine "
                "tool distribution plant in Penang."
            ),
        ),
        SearchResult(url="https://www.nst.com.my/", title="NST Online"),
        SearchResult(url="https://themalaysianreserve.com/",
                     title="The Malaysian Reserve"),
    ])
    fetcher = StaticFetcher({
        "https://www.nst.com.my/": {
            "finalUrl": "https://www.nst.com.my/",
            "title": "NST Online",
            "excerpt": "Malaysia news, world updates, sports and lifestyle.",
            "contentFingerprint": "sha256:a",
            "domainGuardPassed": True,
        },
        "https://themalaysianreserve.com/": {
            "finalUrl": "https://themalaysianreserve.com/",
            "title": "The Malaysian Reserve",
            "excerpt": "Malaysian business and corporate news.",
            "contentFingerprint": "sha256:c",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal(_proposal())
    assert out["status"] == "ready_for_review"
    tiers = {s["url"]: s["trustTier"] for s in out["sources"]}
    assert tiers["https://www.thestar.com.my/"] == "corroborating"
    assert tiers["https://www.nst.com.my/"] == "discovery"
    # Discovery-tier rows rank below reviewable ones in enrichment's source
    # cap; when present they must also be demoted. Assert across either the
    # surviving row or (if capped away) its absence is acceptable — what
    # matters is only the proven hit drove the status.
    surviving = [
        s for s in out["sources"]
        if s["url"] == "https://themalaysianreserve.com/"
    ]
    assert not surviving or surviving[0]["trustTier"] == "discovery"
    proof = [
        s for s in out["sources"]
        if s.get("fetchStatus") == "fetched"
        and s.get("sourceType") != "search_result"
        and s.get("trustTier") != "discovery"
    ]
    assert [s["url"] for s in proof] == ["https://www.thestar.com.my/"]

def test_sector_token_surface_cannot_flip_ready_on_boilerplate():
    """southern-pipe failure mode: sector nouns (industry/pipe/southern)
    appear in any business homepage; with no distinctive token left the
    surface fails open ONLY when there's truly nothing distinctive."""
    search = ListingSearch([
        SearchResult(url="https://theedgemalaysia.com/",
                     title="The Edge Malaysia - Make Better Decisions"),
    ])
    fetcher = StaticFetcher({
        "https://theedgemalaysia.com/": {
            "finalUrl": "https://theedgemalaysia.com/",
            "title": "The Edge Malaysia - Make Better Decisions",
            "excerpt": "BURSA SGX Top Stocks, industry news and pipe reviews.",
            "contentFingerprint": "sha256:z",
            "domainGuardPassed": True,
        },
    })
    job = DiscoveryJob(
        search_chain=[search], fetcher=fetcher, client=FakeClient(),
        config=load_web_research_config({"WEB_RESEARCH_ENABLED": "1"}),
    )
    out = job.discover_for_proposal({
        "proposalId": "p-sp",
        "normalizedEmployerSurface": "southern pipe industry malaysia sdn bhd",
        "companyKey": None,
    })
    # Homepage title is portal-style → demoted even though sector tokens
    # appear in the fetched boilerplate. Nothing reviewable may remain.
    assert out["status"] == "needs_more_evidence"
    assert not any(
        s.get("trustTier") != "discovery" for s in out["sources"]
    )

# ---------------------------------------------------------------------------
# Re-enrichment tightening: employer-relevance also gates the fetch path for
# proposals that already have candidate sources (recycled needs_more_evidence
# rows with homepage content must not re-flip ready_for_review).
# ---------------------------------------------------------------------------

def test_reenrichment_demotes_homepage_content_candidates():
    from apps.worker.industry_evidence_research import (
        IndustryEvidenceMaintenanceJob,
    )

    class C:
        def __init__(self):
            self.sources = [{
                "sourceId": "s-1",
                "proposalId": "p-sp",
                "url": "https://theedgemalaysia.com/",
                "sourceType": "reporting",
                "trustTier": "corroborating",
                "fetchStatus": "fetched",
            }]
            self.status_calls = []
        def list_industry_proposals(self, status):
            if status == "needs_more_evidence":
                return [{
                    "proposalId": "p-sp",
                    "normalizedEmployerSurface":
                        "southern pipe industry malaysia sdn bhd",
                    "priority": 51,
                }]
            return []
        def list_industry_evidence_sources(self, proposal_id=None, **kw):
            return list(self.sources)
        def set_industry_proposal_research_state(self, payload):
            self.status_calls.append(payload)
        def upsert_industry_evidence_source(self, payload):
            for row in self.sources:
                if row["sourceId"] == payload["sourceId"]:
                    row.update(payload)
        def list_due_industry_evidence_sources(self, *a, **k):
            return []

    client = C()
    fetcher = StaticFetcher({
        "https://theedgemalaysia.com/": {
            "finalUrl": "https://theedgemalaysia.com/",
            "title": "The Edge Malaysia - Make Better Decisions",
            "excerpt": "The Edge Malaysia - Make Better Decisions Thursday "
                       "30 Jul 2026 BURSA SGX Top Stories",
            "contentFingerprint": "sha256:z",
            "domainGuardPassed": True,
        },
    })
    job = IndustryEvidenceMaintenanceJob(client=client, fetcher=fetcher) \
        if False else IndustryEvidenceMaintenanceJob(client=client)
    # researcher uses its own fetcher; build job with matching fetcher
    job.researcher = IndustryEvidenceResearcher(fetcher=fetcher)
    job.run()
    final = client.status_calls[-1]
    assert final["status"] == "needs_more_evidence", client.status_calls
    # demoted rows recorded for steward visibility
    assert client.sources[0]["trustTier"] == "discovery"
