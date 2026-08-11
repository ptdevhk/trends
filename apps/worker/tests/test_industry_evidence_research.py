"""Governed industry evidence research/freshness worker tests."""

from __future__ import annotations

import socket
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch
from urllib.error import URLError

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

    def get_industry_proposal(self, proposal_id):
        return next(
            (proposal for proposal in self.proposals if proposal.get("proposalId") == proposal_id),
            None,
        )

    def list_industry_proposals(self, status=None, limit=None):
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

    def upsert_industry_identity_candidate(self, payload):
        self.operations.append(("identity_candidate", dict(payload)))
        return {"candidateFingerprint": payload["candidateFingerprint"], "created": True}

    def complete_industry_research_request(self, payload):
        self.operations.append(("complete_request", dict(payload)))
        return {"completed": True, "state": payload["state"]}


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


def test_targeted_job_processes_only_leased_exact_proposal_and_completes_request():
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "target", "companyKey": "target-cnc", "status": "new"},
        {"proposalId": "other", "companyKey": "other-cnc", "status": "new"},
    ]
    target_url = "https://target.example/products"
    other_url = "https://other.example/products"
    client.sources_by_proposal["target"] = [
        {"sourceId": "target-source", "url": target_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    client.sources_by_proposal["other"] = [
        {"sourceId": "other-source", "url": other_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    client.due = [{"companyKey": "unrelated", "verdictRevisionId": "rev-1"}]
    fetcher = StaticFetcher(
        {
            target_url: _page(final_url=target_url, excerpt="Target CNC machine tools"),
            other_url: _page(final_url=other_url, excerpt="Other CNC machine tools"),
        }
    )
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["target"],
        claimed_requests=[{"requestId": "request-target", "proposalId": "target", "leaseId": "lease-1"}],
    )

    assert job.run() is True
    assert fetcher.calls == [target_url]
    assert any(name == "complete_request" and payload["state"] == "completed" for name, payload in client.operations)
    assert not any(name == "set_research_state" and payload.get("proposalId") == "other" for name, payload in client.operations)
    assert not any(name == "mark_checking" for name, _ in client.operations)


def test_targeted_job_marks_identity_candidate_request_for_unmapped_employer():
    client = FakeIndustryClient()
    client.proposals = [{"proposalId": "vision", "normalizedEmployerSurface": "Vision Machine Tools", "status": "new"}]
    source_url = "https://vision.example/about"
    client.sources_by_proposal["vision"] = [
        {"sourceId": "vision-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher(
        {
            source_url: _page(
                final_url=source_url,
                excerpt="VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
            )
        }
    )
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["vision"],
        claimed_requests=[{"requestId": "request-vision", "proposalId": "vision", "leaseId": "lease-2"}],
    )

    assert job.run() is True
    candidate_ops = [payload for name, payload in client.operations if name == "identity_candidate"]
    assert candidate_ops and candidate_ops[0]["normalizedLegalName"] == "VISION MACHINE TOOLS SDN. BHD."
    assert any(name == "complete_request" and payload["state"] == "needs_identity_review" for name, payload in client.operations)


def test_identity_persistence_failure_does_not_claim_review_ready_candidate():
    class CandidateWriteFailureClient(FakeIndustryClient):
        def upsert_industry_identity_candidate(self, payload):
            raise RuntimeError("candidate store unavailable")

    client = CandidateWriteFailureClient()
    client.proposals = [{"proposalId": "vision", "normalizedEmployerSurface": "Vision Machine Tools", "status": "new"}]
    source_url = "https://vision.example/about"
    client.sources_by_proposal["vision"] = [
        {"sourceId": "vision-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt="VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["vision"],
        claimed_requests=[{"requestId": "request-vision", "proposalId": "vision", "leaseId": "lease-2"}],
    )

    assert job.run() is True
    assert not any(name == "identity_candidate" for name, _ in client.operations)
    assert any(name == "complete_request" and payload["state"] == "completed" for name, payload in client.operations)


# --- Identity-candidate extraction: fetch-time legal-name capture + ---
# --- distinctive-token overlap (2026-08-09)                           ---


def test_find_first_legal_name_finds_footer_names():
    from apps.worker.industry_evidence_research import _find_first_legal_name

    assert _find_first_legal_name("Home About Us Contact LBSB SDN BHD.") == "LBSB SDN BHD."
    assert _find_first_legal_name("KSB in Malaysia | KSB Malaysia Pumps and Valves Sdn Bhd") == (
        "KSB MALAYSIA PUMPS AND VALVES SDN BHD."
    )
    assert _find_first_legal_name("About Us - LBSB") is None
    assert _find_first_legal_name("") is None
    assert _find_first_legal_name("AB") is None  # below the 8-char window


def test_excerpt_with_legal_name_appends_only_when_name_is_outside_window():
    from apps.worker.industry_evidence_research import (
        _excerpt_with_legal_name,
        MAX_EXCERPT_LENGTH,
    )

    filler = "x" * MAX_EXCERPT_LENGTH
    full = filler + " Footer: LBSB SDN BHD."
    excerpt = _excerpt_with_legal_name(full[:MAX_EXCERPT_LENGTH], full)
    assert excerpt == full[:MAX_EXCERPT_LENGTH] + "\nLegal name: LBSB SDN BHD."

    # Name already inside the excerpt window: no duplicate line.
    inside = "LBSB SDN BHD." + filler
    assert _excerpt_with_legal_name(inside[:MAX_EXCERPT_LENGTH], inside) == inside[:MAX_EXCERPT_LENGTH]

    # No legal name anywhere: excerpt unchanged.
    assert _excerpt_with_legal_name(filler, filler) == filler


def test_guarded_fetcher_captures_footer_legal_name_beyond_excerpt_window():
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
            return "https://lbsb.example/about"

        @staticmethod
        def read(_limit):
            # The legal name sits beyond the first 800 chars of page text.
            body = (
                "<title>About Us - LBSB</title><p>"
                + "x" * 2000
                + "</p><footer>LBSB SDN BHD. All rights reserved.</footer>"
            )
            return body.encode("utf-8")

    with (
        patch(
            "apps.worker.industry_evidence_research._resolved_host_is_public",
            return_value=True,
        ),
        patch("apps.worker.industry_evidence_research.urlopen", return_value=Response()),
    ):
        result = GuardedEvidenceFetcher().fetch("https://lbsb.example/about")

    assert "Legal name: LBSB SDN BHD." in result["excerpt"]


def test_targeted_job_extracts_candidate_with_single_distinctive_token_overlap():
    """Regression for the observed LBSB miss: surface "lbsb group of
    companies" + legal name "LBSB SDN BHD." share only the "lbsb" token, which
    the old two-token overlap gate dropped."""
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "lbsb", "normalizedEmployerSurface": "lbsb group of companies", "status": "new"}
    ]
    source_url = "https://lbsb.example/about"
    client.sources_by_proposal["lbsb"] = [
        {"sourceId": "lbsb-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(final_url=source_url, excerpt="Legal name: LBSB SDN BHD."),
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["lbsb"],
        claimed_requests=[],
    )

    assert job.run() is True
    candidates = [payload for name, payload in client.operations if name == "identity_candidate"]
    assert candidates and candidates[0]["normalizedLegalName"] == "LBSB SDN BHD."


def test_targeted_job_rejects_legal_name_without_distinctive_overlap():
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "abc", "normalizedEmployerSurface": "abc holdings", "status": "new"}
    ]
    source_url = "https://abc.example/about"
    client.sources_by_proposal["abc"] = [
        {"sourceId": "abc-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt="ABC HOLDINGS buys stakes; XYZ CORPORATION is a financial services group.",
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["abc"],
        claimed_requests=[],
    )

    assert job.run() is True
    assert not any(name == "identity_candidate" for name, _ in client.operations)


# --- Extended legal-name extraction (copyright/AB/Berhad, best-match) ---------


def test_find_legal_names_copyright_ab_and_year_stripped():
    from apps.worker.industry_evidence_research import _find_legal_names

    # Swedish AB suffix + copyright line; the year must not enter the name.
    assert _find_legal_names("© 2024 Alfa Laval AB. All rights reserved.") == [
        "ALFA LAVAL AB"
    ]
    assert _find_legal_names("Copyright © 2024 Tenaga Nasional Berhad") == [
        "TENAGA NASIONAL BERHAD"
    ]
    # Article-leading registered names keep "The" on the copyright path.
    store_names = _find_legal_names("© 2024 The Store (Malaysia) Sdn. Bhd.")
    assert store_names[0] == "THE STORE (MALAYSIA) SDN. BHD."
    # Copyright names come first, before generic suffix matches.
    assert _find_legal_names(
        "About ACME Engineering Sdn Bhd. © 2024 Alfa Laval AB"
    )[0] == "ALFA LAVAL AB"


def test_find_legal_names_extra_suffixes_and_short_suffix_case_guard():
    from apps.worker.industry_evidence_research import _find_legal_names

    names = _find_legal_names("ABC Engineering LLC and Top Glove Bhd")
    assert "ABC ENGINEERING LLC" in names
    assert "TOP GLOVE BHD" in names
    assert _find_legal_names("Sony Computer Entertainment Europe Ltd") == [
        "SONY COMPUTER ENTERTAINMENT EUROPE LTD"
    ]
    # Short suffixes (AB/AS/AG/BV/NV/KK/SA) must be capitalized in the text;
    # prose "as" must never be treated as a legal suffix.
    assert _find_legal_names("this is as we know") == []
    assert _find_legal_names("known as the market leader") == []
    assert _find_legal_names("Alfa Laval AB is a Swedish company") == ["ALFA LAVAL AB"]


def test_targeted_job_extracts_candidate_from_copyright_footer_name():
    """Round-1 drain miss: alfalaval.com carries the legal name only in the
    footer copyright line ("© 2024 Alfa Laval AB"), which the old suffix
    vocabulary (no AB) and excerpt window missed."""
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "alfa", "normalizedEmployerSurface": "alfa laval", "status": "new"}
    ]
    source_url = "https://www.alfalaval.example/"
    client.sources_by_proposal["alfa"] = [
        {"sourceId": "alfa-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt="Heat transfer, Separation, Fluid handling. © 2024 Alfa Laval AB. All rights reserved.",
        ),
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["alfa"],
        claimed_requests=[],
    )

    assert job.run() is True
    candidates = [payload for name, payload in client.operations if name == "identity_candidate"]
    assert candidates and candidates[0]["normalizedLegalName"] == "ALFA LAVAL AB"


def test_targeted_job_best_match_skips_wrong_first_name():
    """A wrong first legal-suffix name (no surface overlap) must not hide the
    employer's own legal name later in the same text."""
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "alfa2", "normalizedEmployerSurface": "alfa laval", "status": "new"}
    ]
    source_url = "https://www.alfalaval.example/contact"
    client.sources_by_proposal["alfa2"] = [
        {"sourceId": "alfa2-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt=(
                "Partner: GLOBAL HOLDINGS LTD handles logistics. "
                "© 2024 Alfa Laval AB. All rights reserved."
            ),
        ),
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["alfa2"],
        claimed_requests=[],
    )

    assert job.run() is True
    candidates = [payload for name, payload in client.operations if name == "identity_candidate"]
    assert candidates and candidates[0]["normalizedLegalName"] == "ALFA LAVAL AB"


def test_guarded_fetcher_retries_www_fallback_after_primary_failures():
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
            return "https://www.watsons.example.my/"

        @staticmethod
        def read(_limit):
            return b"<title>Watsons Malaysia</title><p>beauty &amp; health</p>"

    calls = {"count": 0}

    def fake_urlopen(request, timeout):
        calls["count"] += 1
        if "www." not in request.full_url:
            raise URLError("connection refused on bare host")
        return Response()

    with (
        patch(
            "apps.worker.industry_evidence_research._resolved_host_is_public",
            return_value=True,
        ),
        patch("apps.worker.industry_evidence_research.urlopen", side_effect=fake_urlopen),
    ):
        result = GuardedEvidenceFetcher(max_attempts=2).fetch(
            "https://watsons.example.my/", expected_domain="watsons.example.my"
        )

    assert calls["count"] == 3  # 2 primary attempts + 1 www fallback
    assert result["domainGuardPassed"] is True
    assert "Watsons Malaysia" in result["title"]


# --- JSON-LD organization-name capture (2026-08-09) --------------------------


def test_json_ld_org_names_extracts_organization_and_alternate():
    from apps.worker.industry_evidence_research import _json_ld_org_names

    raw = """
    <html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization",
     "name":"Leong Bee & Soo Bee Sdn Bhd","alternateName":"LBSB","url":"https://lbsb.com"}
    </script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":["Organization","WebSite"],"name":"Orange Vise Company LLC"},
      {"@type":"WebSite","name":"Ignored Site"}]}
    </script>
    </head><body>Home About Us</body></html>
    """
    orgs = _json_ld_org_names(raw)
    assert orgs == [
        {"name": "Leong Bee & Soo Bee Sdn Bhd", "alternateName": "LBSB"},
        {"name": "Orange Vise Company LLC", "alternateName": ""},
    ]
    # Broken JSON-LD blocks are skipped, not fatal; valid siblings survive.
    broken = raw.replace('"name":"Orange Vise Company LLC"', '"name": BROKEN }')
    orgs = _json_ld_org_names(broken)
    assert orgs[0]["name"] == "Leong Bee & Soo Bee Sdn Bhd"
    assert _json_ld_org_names("<html><p>no json-ld</p></html>") == []


def test_excerpt_with_organization_names_appends_org_line():
    from apps.worker.industry_evidence_research import _excerpt_with_organization_names

    excerpt = "Home About Us Contact"
    raw = '<script type="application/ld+json">{"@type":"Organization","name":"Leong Bee & Soo Bee Sdn Bhd","alternateName":"LBSB"}</script>'
    result = _excerpt_with_organization_names(excerpt, raw)
    assert result == "Home About Us Contact\nOrganization name: LEONG BEE & SOO BEE SDN BHD. | alt: LBSB"

    # No JSON-LD organization: excerpt unchanged.
    assert _excerpt_with_organization_names(excerpt, "<html><p>plain</p></html>") == excerpt


def test_guarded_fetcher_captures_json_ld_org_name():
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
            return "https://lbsb.example/"

        @staticmethod
        def read(_limit):
            body = (
                "<html><head><title>About Us - LBSB</title>"
                '<script type="application/ld+json">'
                '{"@type":"Organization","name":"Leong Bee & Soo Bee Sdn Bhd",'
                '"alternateName":"LBSB","url":"https://lbsb.example"}</script>'
                "</head><body><p>Bandsaw blades, carbide tipped circular sawblades.</p></body></html>"
            )
            return body.encode("utf-8")

    with (
        patch(
            "apps.worker.industry_evidence_research._resolved_host_is_public",
            return_value=True,
        ),
        patch("apps.worker.industry_evidence_research.urlopen", return_value=Response()),
    ):
        result = GuardedEvidenceFetcher().fetch("https://lbsb.example/")

    assert "Organization name: LEONG BEE & SOO BEE SDN BHD. | alt: LBSB" in result["excerpt"]


def test_targeted_job_extracts_candidate_from_json_ld_alt_name():
    """The LBSB regression: the legal name lives only in JSON-LD as
    "Leong Bee & Soo Bee Sdn Bhd" with alternateName "LBSB"; the surface
    "lbsb group of companies" matches via the alternate name only."""
    client = FakeIndustryClient()
    client.proposals = [
        {"proposalId": "lbsb", "normalizedEmployerSurface": "lbsb group of companies", "status": "new"}
    ]
    source_url = "https://lbsb.example/about"
    client.sources_by_proposal["lbsb"] = [
        {"sourceId": "lbsb-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt=(
                "Bandsaw blades, carbide tipped circular sawblades.\n"
                "Organization name: LEONG BEE & SOO BEE SDN BHD. | alt: LBSB"
            ),
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["lbsb"],
        claimed_requests=[],
    )

    assert job.run() is True
    candidates = [payload for name, payload in client.operations if name == "identity_candidate"]
    assert candidates
    assert candidates[0]["normalizedLegalName"] == "LEONG BEE & SOO BEE SDN BHD."


# --- No-churn guard: needs_more_evidence with unchanged evidence stays put --


def _needs_more_proposal(proposal_id: str, surface: str) -> Dict[str, Any]:
    return {
        "proposalId": proposal_id,
        "normalizedEmployerSurface": surface,
        "status": "needs_more_evidence",
    }


def test_no_churn_keeps_needs_more_evidence_on_unchanged_sources():
    """The panasonic churn regression: a needs_more_evidence proposal whose
    re-research pass returns the same stored sources must not flip back to
    ready_for_review."""
    client = FakeIndustryClient()
    client.proposals = [_needs_more_proposal("p-churn", "Vision Machine Tools")]
    source_url = "https://vision.example/about"
    client.sources_by_proposal["p-churn"] = [
        {"sourceId": "vision-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt="VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["p-churn"],
        claimed_requests=[],
    )

    assert job.run() is True
    final_state = [
        payload for name, payload in client.operations
        if name == "set_research_state" and payload.get("status") != "researching"
    ][-1]
    assert final_state["status"] == "needs_more_evidence"
    assert "no material evidence change" in final_state["materialChangeSummary"]
    assert not any(name == "complete_request" for name, _ in client.operations)


def test_no_churn_allows_flip_when_new_evidence_source_appears():
    """A genuinely new evidence source is a material change: the proposal may
    move to ready_for_review."""
    class DiscoveryJob:
        def discover_for_proposal(self, proposal):
            return {
                "sources": [
                    {
                        "url": "https://vision.example/products",
                        "sourceType": "official_site",
                        "trustTier": "primary",
                        "expectedExcerpt": "VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
                    }
                ]
            }

    client = FakeIndustryClient()
    client.proposals = [_needs_more_proposal("p-new-evidence", "Vision Machine Tools")]
    fetcher = StaticFetcher({
        "https://vision.example/products": _page(
            final_url="https://vision.example/products",
            excerpt="VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        discovery_job=DiscoveryJob(),
        mode="targeted",
        target_proposal_ids=["p-new-evidence"],
        claimed_requests=[],
    )

    assert job.run() is True
    final_state = [
        payload for name, payload in client.operations
        if name == "set_research_state" and payload.get("status") != "researching"
    ][-1]
    assert final_state["status"] == "ready_for_review"


def test_no_churn_does_not_hold_back_new_proposals():
    """The guard applies only to needs_more_evidence proposals; a fresh
    proposal with real evidence still reaches ready_for_review."""
    client = FakeIndustryClient()
    client.proposals = [{"proposalId": "p-fresh", "normalizedEmployerSurface": "Vision Machine Tools", "status": "new"}]
    source_url = "https://vision.example/about"
    client.sources_by_proposal["p-fresh"] = [
        {"sourceId": "vision-source", "url": source_url, "sourceType": "official_site", "trustTier": "primary"}
    ]
    fetcher = StaticFetcher({
        source_url: _page(
            final_url=source_url,
            excerpt="VISION MACHINE TOOLS SDN. BHD. manufactures CNC machine tools.",
        )
    })
    job = IndustryEvidenceMaintenanceJob(
        client=client,
        researcher=IndustryEvidenceResearcher(fetcher=fetcher, now_ms=lambda: 200),
        mode="targeted",
        target_proposal_ids=["p-fresh"],
        claimed_requests=[],
    )

    assert job.run() is True
    final_state = [
        payload for name, payload in client.operations
        if name == "set_research_state" and payload.get("status") != "researching"
    ][-1]
    assert final_state["status"] == "ready_for_review"
