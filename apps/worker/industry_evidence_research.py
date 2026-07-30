# coding=utf-8
"""Governed company-industry evidence research and freshness maintenance.

The worker may enrich open proposals and record observations. It intentionally
has no operation that approves proposals or writes current verdict revisions.
"""

from __future__ import annotations

import hashlib
import html
import ipaddress
import logging
import os
import re
import socket
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

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


def industry_evidence_maintenance_enabled(
    env: Optional[Dict[str, str]] = None,
) -> bool:
    source = env if env is not None else os.environ
    value = str(source.get("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


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


class GuardedEvidenceFetcher:
    """Bounded public HTTP fetcher with DNS, redirect-domain, and excerpt guards."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
        max_attempts: int = DEFAULT_FETCH_RETRIES,
    ):
        self.timeout_seconds = max(1, min(30, int(timeout_seconds)))
        self.max_attempts = max(1, min(3, int(max_attempts)))

    def fetch(self, url: str, expected_domain: Optional[str] = None) -> Dict[str, Any]:
        if not safe_public_evidence_url(url):
            raise ValueError("unsafe_url")
        initial = urlparse(url)
        if not initial.hostname or not _resolved_host_is_public(initial.hostname):
            raise ValueError("unsafe_or_unresolved_host")

        last_error: Optional[Exception] = None
        for attempt in range(self.max_attempts):
            try:
                request = Request(
                    url,
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
                    excerpt = text[:MAX_EXCERPT_LENGTH]
                    return {
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
            except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
                last_error = error
                if attempt + 1 < self.max_attempts:
                    continue
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
                    excerpt = expected_excerpt[:MAX_EXCERPT_LENGTH]
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

        employer_surface = str(
            proposal.get("normalizedEmployerSurface")
            or proposal.get("companyKey") or ""
        ).strip()
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
        proposal_limit: int = 20,
        freshness_limit: int = 50,
        discovery_job: Optional[Any] = None,
        run_id: Optional[str] = None,
    ):
        self.client = client or ResearchConvexClient()
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.researcher = researcher or IndustryEvidenceResearcher(now_ms=self.now_ms)
        self.proposal_limit = max(1, min(50, int(proposal_limit)))
        self.freshness_limit = max(1, min(100, int(freshness_limit)))
        self.discovery_job = discovery_job
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
            "operatorSummary": summary,
        }
        if failure_message:
            payload["failureMessage"] = failure_message
        try:
            self.client.finish_maintenance_run(payload)
        except Exception as error:  # noqa: BLE001 - best-effort observability
            logger.warning("[MaintenanceLedger] finish failed: %s", error)

    def _research_open_proposals(self) -> None:
        proposals_by_id: Dict[str, Dict[str, Any]] = {}
        for status in ("new", "researching", "needs_more_evidence"):
            for proposal in self.client.list_industry_proposals(status):
                proposal_id = str(proposal.get("proposalId") or "")
                if proposal_id:
                    proposals_by_id[proposal_id] = proposal
        proposals = sorted(
            proposals_by_id.values(),
            key=lambda proposal: (
                -float(proposal.get("priority") or 0),
                str(proposal.get("proposalId") or ""),
            ),
        )[: self.proposal_limit]
        for proposal in proposals:
            proposal_id = str(proposal.get("proposalId") or "")
            if not proposal_id:
                continue
            self.client.set_industry_proposal_research_state(
                {"proposalId": proposal_id, "status": "researching"}
            )
            candidates = self.client.list_industry_evidence_sources(
                proposal_id=proposal_id
            )
            if not candidates and self.discovery_job is not None:
                discovered = self.discovery_job.discover_for_proposal(proposal)
                candidates = discovered.get("sources") or []
            # Relevance tightening also gates re-enrichment: recycled
            # candidates whose employer cannot be proven from their existing
            # content are demoted to discovery tier before fetch/classify,
            # so homepage rows from earlier noisy runs cannot re-flip a
            # proposal to ready_for_review.
            employer_surface = str(
                proposal.get("normalizedEmployerSurface")
                or proposal.get("companyKey") or ""
            ).strip()
            demoted_count = 0
            for candidate in candidates:
                if candidate.get("trustTier") == "discovery":
                    continue
                if not employer_surface:
                    continue
                if not _candidate_content_proves_employer(
                    employer_surface, candidate
                ):
                    candidate["trustTier"] = "discovery"
                    candidate["relevanceDemoted"] = True
                    demoted_count += 1
            result = self.researcher.enrich_proposal(proposal, candidates)
            for source in result["sources"]:
                source.pop("domainGuardPassed", None)
                source.pop("errorCode", None)
                self.client.upsert_industry_evidence_source(source)
            self.client.set_industry_proposal_research_state(
                {
                    "proposalId": proposal_id,
                    "status": result["status"],
                    **(
                        {"suggestedIndustryClass": result["suggestedIndustryClass"]}
                        if result.get("suggestedIndustryClass")
                        else {}
                    ),
                    "suggestedVerificationLevel": "candidate",
                    "materialChangeSummary": result["materialChangeSummary"],
                }
            )
            self._counts["proposalsResearched"] += 1
            self._counts["sourcesDemoted"] += demoted_count
            # Ledger: record the proposal outcome.
            if result["status"] == "ready_for_review":
                self._counts["readyCreated"] += 1
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
                fetched = self.researcher.fetcher.fetch(
                    source["url"], expected_domain=source.get("sourceDomain")
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
            self._counts["freshnessChecked"] += 1
            outcome = observation["outcome"]
            if outcome != "unchanged":
                self._counts["freshnessRefreshed"] += 1
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
            self._research_open_proposals()
            self._freshness_checks()
            self._finish_run("completed")
            return True
        except Exception as error:  # noqa: BLE001
            logger.error("[IndustryEvidenceMaintenance] failed: %s", error)
            self._counts["errors"] += 1
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

    if not run_id:
        run_id = str(uuid.uuid4())
        client.start_maintenance_run(
            {
                "runId": run_id,
                "workspaceSlug": os.environ.get("WORKSPACE_SLUG", "dev").strip() or "dev",
                "triggerSource": trigger,
            }
        )
        client.claim_maintenance_run(run_id)

    discovery_job = build_discovery_job_from_env()
    return IndustryEvidenceMaintenanceJob(
        client=client, discovery_job=discovery_job, run_id=run_id
    ).run()


__all__ = [
    "GuardedEvidenceFetcher",
    "IndustryEvidenceMaintenanceJob",
    "IndustryEvidenceResearcher",
    "build_discovery_job_from_env",
    "classify_industry_excerpt",
    "industry_evidence_maintenance_enabled",
    "run_industry_evidence_maintenance",
    "safe_public_evidence_url",
]
