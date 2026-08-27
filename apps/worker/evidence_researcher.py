# coding=utf-8
"""Governed company-industry evidence research and freshness maintenance."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional, Sequence
from urllib.parse import urlparse

import apps.worker.industry_evidence_research as _shim
from apps.worker.evidence_classifier import (
    SOURCE_ORDER,
    TRUST_ORDER,
    classify_industry_excerpt,
)
from apps.worker.evidence_nlp import (
    MAX_EXCERPT_LENGTH,
    _excerpt_with_legal_name,
    _find_legal_names,
    _identity_org_from_excerpt,
    _name_overlap_passes,
    _normalize_identity_name,
)
from apps.worker.evidence_transport import (
    DomainConcurrencyLimiter,
    GuardedEvidenceFetcher,
    _env_clamped_int,
    safe_public_evidence_url,
)
from apps.worker.research_convex import ResearchConvexClient

logger = logging.getLogger(__name__)

MAX_SOURCES_PER_PROPOSAL = 8


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
        # Strong classes: only confident, *content-verified* classifications
        # may drive the proposed industry class. Fetched boilerplate rows
        # (registry/directory homepages whose content does not mention the
        # employer) never contribute a class — that is what makes the
        # proposed class differ across sources on the same company.
        strong_classes = {
            industry_class
            for industry_class, confidence in classifications
            if confidence >= 0.65
        }
        reviewable_classes = {
            industry_class
            for industry_class, confidence in classifications
            if confidence >= 0.65
            and any(
                source.get("sourceType") != "search_result"
                and source.get("trustTier") != "discovery"
                and source.get("fetchStatus") == "fetched"
                and source.get("domainGuardPassed") is not False
                and source.get("suggestedIndustryClass") == industry_class
                and (
                    not employer_surface
                    or _source_content_proves_employer(
                        employer_surface, source
                    )
                )
                for source in sources
            )
        }
        conflicts = len(reviewable_classes) > 1 or any(
            source.get("domainGuardPassed") is False for source in sources
        )
        ranked_classes = sorted(
            classifications,
            key=lambda item: (-item[1], item[0]),
        )
        suggested_class = (
            ranked_classes[0][0] if ranked_classes else None
        )
        # The strongest classifier vote is the aggregate signal, but it must
        # still be grounded: a suggested class backed only by unproven
        # boilerplate rows (registry/directory homepages that do not mention
        # the employer) is dropped to "unknown". The human cockpit then sees
        # a clean single-class proposal instead of a source conflict between
        # the aggregate class and boilerplate "unknown" votes.
        if suggested_class and suggested_class not in reviewable_classes:
            suggested_class = None
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
            **(
                {"suggestedIndustryClass": suggested_class}
                if suggested_class
                else {}
            ),
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
        convex_client_cls = getattr(_shim, "ResearchConvexClient", ResearchConvexClient)
        self.client = client or convex_client_cls()
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

    def _refresh_cn_registry_classifications(
        self, proposal: Dict[str, Any], candidates: Sequence[Dict[str, Any]]
    ) -> None:
        """Re-classify stored CN registry-domain candidates with the current
        rules before re-fetch.

        Registry rows stored before the record-path guard (qcc.com
        homepages and 360-search landings) were treated as authoritative
        registry evidence; they fail fetch and hard-block review with
        stale_or_failed_source (observed 2026-08-14). classify_source is
        pure (url + employer surface), so re-running it is idempotent for
        already-correct rows and only demotes the misclassified ones.
        """
        from apps.worker.web_research.classify import (
            _CN_REGISTRY_DOMAINS,
            classify_source,
        )

        employer_surface = employer_surface_for_search(proposal)
        for candidate in candidates:
            url = str(candidate.get("url") or "").strip()
            host = (urlparse(url).hostname or "").lower().removeprefix("www.")
            if host not in _CN_REGISTRY_DOMAINS:
                continue
            verdict = classify_source(url, employer_surface)
            candidate["sourceType"] = verdict["sourceType"]
            candidate["trustTier"] = verdict["trustTier"]

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
        # Re-research path: stored rows keep their original classification;
        # refresh CN registry-domain rows under the current rules so
        # misclassified homepages/search landings are demoted before re-fetch.
        self._refresh_cn_registry_classifications(proposal, candidates)
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
        # ready_for_review proposals are included so unmapped ones re-run
        # identity-candidate extraction (candidates are only built during
        # research) and re-fetch their sources under the current
        # classification rules. Mapped ready proposals are reviewable as-is
        # and are skipped to avoid fetch churn every sweep round.
        for status in ("new", "researching", "needs_more_evidence", "ready_for_review"):
            for proposal in self.client.list_industry_proposals(status, limit=scan_limit):
                proposal_id = str(proposal.get("proposalId") or "")
                if not proposal_id:
                    continue
                if status == "ready_for_review" and str(
                    proposal.get("companyKey") or ""
                ).strip():
                    continue
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
    convex_client_cls = getattr(_shim, "ResearchConvexClient", ResearchConvexClient)
    client = convex_client_cls()

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

    build_discovery_job_fn = getattr(
        _shim, "build_discovery_job_from_env", build_discovery_job_from_env
    )
    discovery_job = build_discovery_job_fn()
    # Allow operators to scale the per-run proposal batch via env var.
    # Default 200 (2026-08-09 P0.1: backlog drain is network-bound, runs
    # minutes each; sweep headroom scan_limit = proposal_limit * 3 sits just
    # under the Convex list cap of 500). Lower (e.g., 20) for scheduled runs.
    proposal_limit = int(os.environ.get("INDUSTRY_PROPOSAL_LIMIT", "200"))
    maintenance_job_cls = getattr(
        _shim, "IndustryEvidenceMaintenanceJob", IndustryEvidenceMaintenanceJob
    )
    return maintenance_job_cls(
        client=client,
        discovery_job=discovery_job,
        run_id=run_id,
        mode=mode or ("targeted" if proposal_ids else "sweep"),
        target_proposal_ids=claimed_proposal_ids,
        claimed_requests=claimed_requests,
        proposal_limit=proposal_limit,
    ).run()


__all__ = [
    "IndustryEvidenceMaintenanceJob",
    "IndustryEvidenceResearcher",
    "MAX_SOURCES_PER_PROPOSAL",
    "build_discovery_job_from_env",
    "employer_surface_for_search",
    "industry_evidence_maintenance_enabled",
    "run_industry_evidence_maintenance",
]
