from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from apps.worker.industry_evidence_research import IndustryEvidenceResearcher
from apps.worker.web_research.classify import classify_source
from apps.worker.web_research.config import WebResearchConfig
from apps.worker.web_research.search import SearchProvider

logger = logging.getLogger(__name__)

# Market query packs (data, not code). "my" is the legacy default; "cn" is
# the product-core pack (internal users are CN users), selected via config.
def discovery_queries(employer_surface: str, market: str = "my") -> List[str]:
    """Term-based templates: exact-phrase quoting over-constrains free
    providers (Google News ANDs quoted phrases; SME employers vanish)."""
    if market == "my":
        return [
            f"{employer_surface} Malaysia",
            f"{employer_surface} CNC machine",
            f"{employer_surface} machinery",
        ]
    if market == "cn":
        return [
            f"{employer_surface} 公司",
            f"{employer_surface} 机床",
            f"{employer_surface} 数控",
        ]
    return [f"{employer_surface} company"]


def _employer_tokens(employer_surface: str) -> set[str]:
    import re
    stop = {"sdn", "bhd", "malaysia", "the", "and", "co", "company",
            "inc", "ltd", "pte", "m"}
    return {
        t for t in re.findall(r"[a-z0-9一-鿿]+", employer_surface.casefold())
        if len(t) >= 3 and t not in stop
    }


def _hit_mentions_employer(hit: Any, tokens: set[str]) -> bool:
    if not tokens:
        return True  # degenerate surface: don't filter out everything
    haystack = f"{hit.title} {hit.snippet} {hit.url}".casefold()
    return any(tok in haystack for tok in tokens)

class DiscoveryJob:
    def __init__(
        self, *, search_chain: List[SearchProvider], fetcher,
        client, config: WebResearchConfig,
        researcher: Optional[IndustryEvidenceResearcher] = None,
    ):
        self.search_chain = search_chain
        self.fetcher = fetcher
        self.client = client
        self.config = config
        self.researcher = researcher or IndustryEvidenceResearcher(
            fetcher=fetcher)

    def _quota_ok(self, provider_name: str) -> bool:
        try:
            quota = self.client.get_web_research_quota(provider_name)
        except Exception as error:  # fail closed: skip, don't crash the run
            logger.warning(
                "[WebResearch] quota read failed for %s: %s",
                provider_name, error,
            )
            return False
        return int(quota.get("used", 0)) < int(quota.get("cap", 1000))

    def _search_all(self, query: str, max_results: int,
                    tokens: Optional[set] = None) -> List[Any]:
        for provider in self.search_chain:
            name = type(provider).__name__
            if not self._quota_ok(name):
                continue
            if tokens is not None and hasattr(provider, "tokens"):
                # Token-aware providers (e.g. NewsNowSearchProvider) filter
                # client-side by employer tokens; hand them the current
                # proposal's tokens before each search.
                provider.tokens = set(tokens)
            try:
                results = provider.search(query, max_results)
            except Exception as error:  # soft-fail onward to next provider
                logger.warning(
                    "[WebResearch] provider %s failed: %s", name, error)
                continue
            self.client.record_web_research_quota_use(name, 1)
            if results:
                return results
        return []

    def discover_for_proposal(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        employer = str(
            proposal.get("normalizedEmployerSurface")
            or proposal.get("companyKey") or ""
        ).strip()
        if not employer or not self.config.enabled:
            return {"status": "needs_more_evidence", "sources": []}

        tokens = _employer_tokens(employer)
        market = getattr(self.config, "market", "my")
        seen: set[str] = set()
        raw_candidates: List[Dict[str, Any]] = []
        for query in discovery_queries(employer, market)[: self.config.queries_per_proposal]:
            for hit in self._search_all(query, max_results=5, tokens=tokens):
                if hit.url in seen:
                    continue
                if not _hit_mentions_employer(hit, tokens):
                    continue
                seen.add(hit.url)
                if getattr(hit, "publisher_domain", ""):
                    # classify on the publisher domain, not the
                    # news.google.com redirect
                    tier = classify_source(
                        "https://" + hit.publisher_domain, employer)
                else:
                    tier = classify_source(hit.url, employer)
                candidate = {
                    "url": hit.url,
                    "sourceType": tier["sourceType"],
                    "trustTier": tier["trustTier"],
                }
                if getattr(hit, "title", ""):
                    candidate["title"] = hit.title
                if getattr(hit, "discovery_snippet", ""):
                    # Excerpt-provided candidate: enrich uses the
                    # publisher-provided summary instead of fetching the
                    # (often homepage or JS-gated) URL.
                    candidate["expectedExcerpt"] = hit.discovery_snippet
                raw_candidates.append(candidate)

        if not raw_candidates:
            return {"status": "needs_more_evidence", "sources": []}

        # Reuse the existing governed enrichment (fetch + classify + rank)
        result = self.researcher.enrich_proposal(proposal, raw_candidates)
        return {
            "status": result["status"],
            "sources": result["sources"],
            **({"suggestedIndustryClass": result["suggestedIndustryClass"]}
               if result.get("suggestedIndustryClass") else {}),
        }
