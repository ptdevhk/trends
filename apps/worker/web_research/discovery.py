from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from apps.worker.industry_evidence_research import (
    IndustryEvidenceResearcher,
    employer_surface_for_search,
)
from apps.worker.web_research.classify import (
    classify_source,
    distinctive_employer_tokens,
    excerpt_proves_employer,
    looks_like_homepage_title,
)
from apps.worker.web_research.config import WebResearchConfig
from apps.worker.web_research.search import NewsNowSearchProvider, SearchProvider

logger = logging.getLogger(__name__)

# Market query packs (data, not code). "my" is the legacy default; "cn" is
# the product-core pack (internal users are CN users), selected via config.
def discovery_queries(employer_surface: str, market: str = "cn") -> List[str]:
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


# CJK equivalents of the ASCII legal-form/generic stops ("Sdn Bhd Ltd",
# "company", "group", "tech", ...) for hotlist matching.
_HOTLIST_STOP_TOKENS = frozenset(
    {"公司", "有限", "股份", "集团", "科技", "控股", "实业"}
)


def _hotlist_employer_tokens(employer_surface: str) -> set[str]:
    """CJK-aware distinctive tokens for hotlist matching.

    classify.distinctive_employer_tokens is ASCII-only; CN employer names
    (the product-core market) need the CJK-aware tokenizer from this module.
    """
    base = _employer_tokens(employer_surface)
    if not base:
        return set()
    tokens = distinctive_employer_tokens(employer_surface)
    tokens.update(
        token for token in base
        if not token.isascii() and token not in _HOTLIST_STOP_TOKENS
    )
    return tokens


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
        # A bot-walled provider can spend its full HTTP timeout on every
        # query. Disable it for the rest of this maintenance run after the
        # first failure so the next provider can carry the batch forward.
        self._failed_providers: set[str] = set()
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
            if name in self._failed_providers:
                continue
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
                self._failed_providers.add(name)
                continue
            self.client.record_web_research_quota_use(name, 1)
            if results:
                return results
        return []

    def discover_for_proposal(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        employer = employer_surface_for_search(proposal)
        if not employer or not self.config.enabled:
            return {"status": "needs_more_evidence", "sources": []}

        # P0.5: consult the once-per-sweep NewsNow hotlist snapshot first.
        # A distinctive-token match short-circuits the per-proposal search
        # chain; no match falls through to the existing per-proposal path.
        hotlist_candidates = self._hotlist_candidates_for_employer(employer)
        if hotlist_candidates:
            return self._finalize_candidates(proposal, employer, hotlist_candidates)

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

        return self._finalize_candidates(proposal, employer, raw_candidates)

    def _finalize_candidates(
        self,
        proposal: Dict[str, Any],
        employer: str,
        raw_candidates: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not raw_candidates:
            return {"status": "needs_more_evidence", "sources": []}

        # Relevance tightening: a hit whose *content* cannot be shown to
        # mention the employer is demoted to discovery tier before governed
        # enrichment, so curated-press homepage rows (the robo-machine-tools
        # failure mode) can no longer masquerade as proof sources. Rows are
        # kept for steward visibility, but they stay non-approval-safe.
        #
        # Demotion rules for a non-discovery candidate:
        #  - excerpt-provided hit whose excerpt+title lacks the employer, or
        #  - no excerpt at all AND a portal-style homepage title
        #    ("NST Online", "The Edge Malaysia"): the content that would be
        #    fetched is homepage boilerplate, which cannot prove relevance.
        for candidate in raw_candidates:
            if candidate["trustTier"] == "discovery":
                continue
            title = str(candidate.get("title") or "")
            excerpt = str(candidate.get("expectedExcerpt") or "")
            if excerpt_proves_employer(employer, title=title, excerpt=excerpt):
                continue
            if excerpt or looks_like_homepage_title(title):
                candidate["trustTier"] = "discovery"
                candidate["relevanceDemoted"] = True

        # Reuse the existing governed enrichment (fetch + classify + rank)
        result = self.researcher.enrich_proposal(proposal, raw_candidates)
        return {
            "status": result["status"],
            "sources": result["sources"],
            **({"suggestedIndustryClass": result["suggestedIndustryClass"]}
               if result.get("suggestedIndustryClass") else {}),
        }

    def _newsnow_provider(self) -> Optional[NewsNowSearchProvider]:
        for provider in self.search_chain:
            if isinstance(provider, NewsNowSearchProvider):
                return provider
        return None

    def _hotlist_candidates_for_employer(
        self, employer: str
    ) -> List[Dict[str, Any]]:
        """Distinctive-token matches from the once-per-sweep hotlist snapshot.

        Empty list when the chain has no NewsNow provider or nothing matched;
        the caller then falls through to the per-proposal search chain.
        Matched items become excerpt-provided candidates (the hotlist
        headline is the evidence excerpt), so no extra page fetch is needed
        for a headline.
        """
        provider = self._newsnow_provider()
        if provider is None:
            return []
        tokens = _hotlist_employer_tokens(employer)
        if not tokens:
            return []
        candidates: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for item in provider.hotlist_items():
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            if not title or not url or url in seen:
                continue
            if not any(token in title.casefold() for token in tokens):
                continue
            seen.add(url)
            tier = classify_source(url, employer)
            candidates.append({
                "url": url,
                "title": title,
                "expectedExcerpt": title,
                "sourceType": tier["sourceType"],
                "trustTier": tier["trustTier"],
            })
        return candidates
