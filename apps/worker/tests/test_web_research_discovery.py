from apps.worker.industry_evidence_research import (
    IndustryEvidenceMaintenanceJob,
    IndustryEvidenceResearcher,
)
from apps.worker.web_research.discovery import DiscoveryJob
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
