"""Governed industry evidence research/freshness worker tests."""

from __future__ import annotations

import socket
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

from apps.worker.industry_evidence_research import (
    MAX_EXCERPT_LENGTH,
    GuardedEvidenceFetcher,
    IndustryEvidenceMaintenanceJob,
    IndustryEvidenceResearcher,
    industry_evidence_maintenance_enabled,
    safe_public_evidence_url,
)
from apps.worker.research_unresolved import promote_research_unresolved_to_proposals
from apps.worker.scheduler import WorkerScheduler


class StaticFetcher:
    def __init__(self, pages: Dict[str, Dict[str, Any]]):
        self.pages = pages
        self.calls: List[str] = []

    def fetch(self, url: str, expected_domain=None):
        self.calls.append(url)
        value = self.pages[url]
        if isinstance(value, Exception):
            raise value
        return dict(value)


class FakeIndustryClient:
    def __init__(self):
        self.proposals: List[Dict[str, Any]] = []
        self.sources_by_proposal: Dict[str, List[Dict[str, Any]]] = {}
        self.due: List[Dict[str, Any]] = []
        self.operations: List[tuple[str, Dict[str, Any]]] = []

    def list_industry_proposals(self, status=None):
        return list(self.proposals)

    def set_industry_proposal_research_state(self, payload):
        self.operations.append(("set_research_state", dict(payload)))
        return payload

    def list_industry_evidence_sources(self, *, proposal_id=None, company_key=None):
        return list(self.sources_by_proposal.get(proposal_id or "", []))

    def upsert_industry_evidence_source(self, payload):
        self.operations.append(("upsert_source", dict(payload)))
        return {"sourceId": payload["sourceId"], "created": True}

    def list_due_industry_evidence_sources(self, now, limit):
        return list(self.due)[:limit]

    def mark_industry_evidence_profiles_checking(self, profiles):
        self.operations.append(("mark_checking", {"profiles": profiles}))
        return {"marked": len(profiles)}

    def upsert_industry_proposal(self, payload):
        self.operations.append(("upsert_proposal", dict(payload)))
        return {"proposalId": payload["proposalId"], "created": True}

    def record_industry_evidence_freshness_check(self, payload):
        self.operations.append(("record_check", dict(payload)))
        return {"checkId": payload["checkId"], "created": True}


def _page(
    *,
    final_url: str,
    excerpt: str,
    fingerprint: str = "sha256:new",
    domain_guard_passed: bool = True,
):
    return {
        "finalUrl": final_url,
        "status": 200,
        "title": "Evidence page",
        "excerpt": excerpt,
        "contentFingerprint": fingerprint,
        "domainGuardPassed": domain_guard_passed,
    }


def test_official_sources_are_researched_before_directories_and_registry_maps_cnc():
    official = "https://acme.example/products"
    registry = "https://registry.example.gov.my/acme"
    directory = "https://directory.example/acme"
    fetcher = StaticFetcher(
        {
            official: _page(
                final_url=official,
                excerpt="Official CNC machining centres and machine tools.",
            ),
            registry: _page(
                final_url=registry,
                excerpt="MSIC 28220 manufacture of machine tools and CNC equipment.",
            ),
            directory: _page(
                final_url=directory,
                excerpt="Industrial machinery directory entry.",
            ),
        }
    )
    researcher = IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 100)

    result = researcher.enrich_proposal(
        {"proposalId": "proposal-1", "companyKey": "acme-cnc"},
        [
            {
                "url": directory,
                "sourceType": "directory",
                "trustTier": "corroborating",
            },
            {
                "url": registry,
                "sourceType": "registry",
                "trustTier": "authoritative",
            },
            {
                "url": official,
                "sourceType": "official_site",
                "trustTier": "primary",
            },
        ],
    )

    assert fetcher.calls == [official, registry, directory]
    assert result["status"] == "ready_for_review"
    assert result["suggestedIndustryClass"] == "cnc"
    assert result["suggestedVerificationLevel"] == "candidate"


def test_search_results_are_discovery_only_and_never_treated_as_proof():
    search_url = "https://search.example/results?q=acme"
    researcher = IndustryEvidenceResearcher(
        fetcher=StaticFetcher(
            {
                search_url: _page(
                    final_url=search_url,
                    excerpt="ACME CNC machine tools",
                )
            }
        ),
        now_ms=lambda: 100,
    )

    result = researcher.enrich_proposal(
        {"proposalId": "proposal-search"},
        [
            {
                "url": search_url,
                "sourceType": "search_result",
                "trustTier": "primary",
            }
        ],
    )

    assert result["status"] == "needs_more_evidence"
    assert result["sources"][0]["trustTier"] == "discovery"
    assert result["suggestedVerificationLevel"] == "candidate"


def test_expected_excerpt_candidate_skips_fetch_and_classifies_excerpt():
    homepage = "https://theedgemalaysia.com"
    excerpt = (
        "ACME Engineering expands CNC machining centre capacity in Penang "
        "The Edge Malaysia"
    )
    fetcher = StaticFetcher({})
    researcher = IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 100)

    result = researcher.enrich_proposal(
        {"proposalId": "proposal-excerpt", "companyKey": "acme"},
        [
            {
                "url": homepage,
                "sourceType": "reporting",
                "trustTier": "corroborating",
                "title": "ACME Engineering expands CNC capacity",
                "expectedExcerpt": excerpt,
            }
        ],
    )

    assert fetcher.calls == [], (
        "candidates carrying expectedExcerpt must not be fetched"
    )
    assert result["sources"], "expected the excerpt candidate to be kept"
    source = result["sources"][0]
    assert source["url"] == homepage
    assert source["fetchStatus"] == "fetched"
    assert source["evidenceExcerpt"] == excerpt
    assert source["title"] == "ACME Engineering expands CNC capacity"
    assert source["contentFingerprint"].startswith("sha256:")
    assert source["domainGuardPassed"] is True
    assert source["suggestedIndustryClass"] == "cnc"
    assert result["status"] == "ready_for_review"
    assert result["suggestedIndustryClass"] == "cnc"


def test_expected_excerpt_capped_and_title_optional():
    homepage = "https://theedgemalaysia.com"
    long_excerpt = "CNC machine tools " + "x" * 2000
    fetcher = StaticFetcher({})
    researcher = IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 100)

    result = researcher.enrich_proposal(
        {"proposalId": "proposal-excerpt-long"},
        [
            {
                "url": homepage,
                "sourceType": "reporting",
                "trustTier": "corroborating",
                "expectedExcerpt": long_excerpt,
            }
        ],
    )

    assert fetcher.calls == []
    source = result["sources"][0]
    assert len(source["evidenceExcerpt"]) == MAX_EXCERPT_LENGTH
    assert "title" not in source


def test_unsafe_urls_are_rejected_before_fetch():
    assert safe_public_evidence_url("http://127.0.0.1/private") is False
    assert safe_public_evidence_url("http://user:pass@example.com/private") is False
    assert safe_public_evidence_url("file:///etc/passwd") is False

    fetcher = StaticFetcher({})
    result = IndustryEvidenceResearcher(fetcher=fetcher).enrich_proposal(
        {"proposalId": "proposal-unsafe"},
        [
            {
                "url": "http://127.0.0.1/private",
                "sourceType": "official_site",
                "trustTier": "primary",
            }
        ],
    )
    assert fetcher.calls == []
    assert result["sources"] == []
    assert result["status"] == "needs_more_evidence"


def test_redirect_domain_mismatch_and_conflicting_evidence_require_review():
    official = "https://acme.example/about"
    registry = "https://registry.example.gov.my/acme"
    researcher = IndustryEvidenceResearcher(
        fetcher=StaticFetcher(
            {
                official: _page(
                    final_url="https://unrelated.example/about",
                    excerpt="CNC machining centres",
                    domain_guard_passed=False,
                ),
                registry: _page(
                    final_url=registry,
                    excerpt="Automation robotics and PLC integration",
                ),
            }
        )
    )
    result = researcher.enrich_proposal(
        {"proposalId": "proposal-conflict", "companyKey": "acme"},
        [
            {
                "url": official,
                "sourceType": "official_site",
                "trustTier": "primary",
                "expectedDomain": "acme.example",
            },
            {
                "url": registry,
                "sourceType": "registry",
                "trustTier": "authoritative",
            },
        ],
    )

    assert result["conflicts"] is True
    assert "conflicting evidence" in result["materialChangeSummary"]


def test_guarded_fetcher_retries_timeout_with_bounded_attempts():
    class Headers:
        @staticmethod
        def get_content_charset():
            return "utf-8"

    class Response:
        status = 200
        headers = Headers()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        @staticmethod
        def geturl():
            return "https://acme.example/products"

        @staticmethod
        def read(_limit):
            return b"<title>ACME</title><p>CNC machine tools</p>"

    calls = {"count": 0}

    def fake_urlopen(_request, timeout):
        assert timeout == 3
        calls["count"] += 1
        if calls["count"] == 1:
            raise socket.timeout("temporary")
        return Response()

    with (
        patch(
            "apps.worker.industry_evidence_research._resolved_host_is_public",
            return_value=True,
        ),
        patch("apps.worker.industry_evidence_research.urlopen", side_effect=fake_urlopen),
    ):
        result = GuardedEvidenceFetcher(
            timeout_seconds=3,
            max_attempts=2,
        ).fetch("https://acme.example/products", expected_domain="acme.example")

    assert calls["count"] == 2
    assert result["domainGuardPassed"] is True
    assert result["contentFingerprint"].startswith("sha256:")


def test_job_writes_only_proposals_sources_and_checks_never_truth():
    client = FakeIndustryClient()
    client.proposals = [{"proposalId": "proposal-1", "companyKey": "acme-cnc"}]
    source_url = "https://acme.example/products"
    client.sources_by_proposal["proposal-1"] = [
        {
            "sourceId": "candidate-1",
            "url": source_url,
            "sourceType": "official_site",
            "trustTier": "primary",
        }
    ]
    client.due = [
        {
            "sourceId": "approved-1",
            "companyKey": "acme-cnc",
            "verdictRevisionId": "revision-1",
            "approvedSourceCount": 1,
            "url": source_url,
            "sourceDomain": "acme.example",
            "sourceType": "official_site",
            "trustTier": "primary",
            "contentFingerprint": "sha256:old",
        }
    ]
    fetcher = StaticFetcher(
        {
            source_url: _page(
                final_url=source_url,
                excerpt="CNC machine tools",
                fingerprint="sha256:new",
            )
        }
    )
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        now_ms=lambda: 200,
    )

    assert job.run() is True
    operation_names = [name for name, _payload in client.operations]
    assert "set_research_state" in operation_names
    assert "upsert_source" in operation_names
    assert "upsert_proposal" in operation_names
    assert "record_check" in operation_names
    assert not any("approve" in name or "revision" in name or "profile" in name for name in operation_names)
    final_state = [
        payload
        for name, payload in client.operations
        if name == "set_research_state"
    ][-1]
    assert final_state["status"] == "ready_for_review"
    assert final_state["suggestedVerificationLevel"] == "candidate"


def test_temporary_outage_creates_review_proposal_without_truth_mutation():
    client = FakeIndustryClient()
    source_url = "https://acme.example/products"
    client.due = [
        {
            "sourceId": "approved-1",
            "companyKey": "acme-cnc",
            "verdictRevisionId": "revision-1",
            "approvedSourceCount": 1,
            "url": source_url,
            "sourceDomain": "acme.example",
            "sourceType": "official_site",
            "trustTier": "primary",
            "contentFingerprint": "sha256:old",
        }
    ]
    fetcher = StaticFetcher({source_url: RuntimeError("temporary_timeout")})
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        now_ms=lambda: 200,
    )

    assert job.run() is True
    proposal = [
        payload for name, payload in client.operations if name == "upsert_proposal"
    ][0]
    check = [payload for name, payload in client.operations if name == "record_check"][0]
    assert proposal["priority"] == 100
    assert proposal["triggerReasons"] == ["scheduled_freshness", "source_unavailable"]
    assert check["outcome"] == "unavailable"
    assert not any(name in {"approve", "upsert_profile"} for name, _ in client.operations)


def test_unresolved_samples_promote_without_news_body_or_url_leakage():
    client = FakeIndustryClient()
    promoted = promote_research_unresolved_to_proposals(
        client,
        [
            {
                "surface": "Unknown CNC Co",
                "title": "private-ish news title",
                "url": "https://news.example/item",
            },
            {"surface": "Unknown CNC Co", "title": "another title"},
        ],
    )
    assert promoted == 1
    payload = client.operations[0][1]
    assert payload["normalizedEmployerSurface"] == "unknown cnc co"
    assert "title" not in payload
    assert "url" not in payload


def test_scheduler_registers_hybrid_maintenance_only_when_enabled():
    with patch.dict(
        "os.environ",
        {
            "INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED": "1",
            "INDUSTRY_EVIDENCE_MAINTENANCE_INTERVAL_HOURS": "12",
        },
        clear=False,
    ):
        scheduler = WorkerScheduler.__new__(WorkerScheduler)
        scheduler.timezone = "UTC"
        scheduler.scheduler = MagicMock()
        scheduler.add_industry_evidence_maintenance_job()
        scheduler.scheduler.add_job.assert_called_once()
        kwargs = scheduler.scheduler.add_job.call_args.kwargs
        assert kwargs["id"] == "industry_evidence_maintenance"

    assert industry_evidence_maintenance_enabled({}) is False
