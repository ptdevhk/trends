from __future__ import annotations
import html
import logging
import re
from dataclasses import dataclass
from typing import Any, List, Optional, Protocol
from urllib.parse import parse_qs, quote_plus, urlparse

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str = ""
    # Publisher host (e.g. from the Google News RSS <source url>) used to
    # classify a redirect-url hit by its real publisher, not news.google.com.
    publisher_domain: str = ""
    # Publisher-provided article summary (e.g. cleaned Google News RSS
    # <description>) used as the evidence excerpt in place of fetching a
    # JS-gated or homepage URL.
    discovery_snippet: str = ""


class SearchProvider(Protocol):
    def search(self, query: str, max_results: int) -> List[SearchResult]: ...


def _unwrap_ddg_redirect(url: str) -> str:
    parsed = urlparse(url)
    if "duckduckgo.com" in (parsed.hostname or ""):
        uddg = parse_qs(parsed.query).get("uddg")
        if uddg:
            return uddg[0]
    return url


class DuckDuckGoSearchProvider:
    """Free, no-key HTML endpoint. Use gently (dev default)."""
    BASE = "https://html.duckduckgo.com/html/?q="

    def __init__(self, *, fetcher: Any):
        self.fetcher = fetcher  # object with fetch_text(url) -> str

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        html = self.fetcher.fetch_text(self.BASE + quote_plus(query))
        results: List[SearchResult] = []
        anchors = re.findall(
            r'<a class="result__a" href="([^"]+)"[^>]*>(.*?)</a>',
            html, re.DOTALL,
        )
        snippets = re.findall(
            r'<a class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL,
        )
        for i, (url, title) in enumerate(anchors[:max_results]):
            clean_title = re.sub(r"<[^>]+>", "", title).strip()
            snippet = (
                re.sub(r"<[^>]+>", "", snippets[i]).strip()
                if i < len(snippets) else ""
            )
            results.append(SearchResult(
                url=_unwrap_ddg_redirect(url), title=clean_title, snippet=snippet,
            ))
        return results


class TavilySearchProvider:
    def __init__(self, *, api_key: str, fetcher: Any):
        self.api_key = api_key
        self.fetcher = fetcher  # object with post_json(url, payload) -> dict

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        data = self.fetcher.post_json(
            "https://api.tavily.com/search",
            {"query": query, "max_results": max_results,
             "search_depth": "basic"},
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        return [
            SearchResult(url=r["url"], title=r.get("title", ""),
                         snippet=r.get("content", ""))
            for r in data.get("results", [])[:max_results]
        ]


class BraveSearchProvider:
    def __init__(self, *, api_key: str, fetcher: Any):
        self.api_key = api_key
        self.fetcher = fetcher  # object with get_json(url, headers) -> dict

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        data = self.fetcher.get_json(
            "https://api.search.brave.com/res/v1/web/search"
            f"?q={quote_plus(query)}&count={max_results}",
            headers={"X-Subscription-Token": self.api_key},
        )
        web = data.get("web", {}).get("results", [])
        return [
            SearchResult(url=r["url"], title=r.get("title", ""),
                         snippet=r.get("description", ""))
            for r in web[:max_results]
        ]


class GoogleNewsRssSearchProvider:
    """Free, no-key Google News RSS search. Reporting-tier results only."""
    BASE = "https://news.google.com/rss/search?q="

    def __init__(self, *, fetcher: Any, hl: str = "en-MY", gl: str = "MY",
                 ceid: str = "MY:en"):
        self.fetcher = fetcher  # object with fetch_text(url) -> str
        self.hl = hl
        self.gl = gl
        self.ceid = ceid

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        import xml.etree.ElementTree as ET
        url = (
            self.BASE + quote_plus(query)
            + f"&hl={self.hl}&gl={self.gl}&ceid={quote_plus(self.ceid)}"
        )
        raw = self.fetcher.fetch_text(url)
        try:
            root = ET.fromstring(raw)
        except ET.ParseError:
            return []
        results: List[SearchResult] = []
        for item in root.iter("item"):
            title = item.findtext("title") or ""
            link = item.findtext("link") or ""
            desc = item.findtext("description") or ""
            source_el = item.find("source")
            source_name = source_el.text if source_el is not None else ""
            source_url = (source_el.get("url") or "") if source_el is not None else ""
            link_host = ""
            if source_url:
                link_host = urlparse(source_url).hostname or ""
            # Google no longer redirects news.google.com RSS article links
            # for non-JS clients (interstitial/HTTP 400), so store the
            # publisher homepage from <source url> as the source URL and
            # keep the real article title + publisher-provided description
            # as the evidence excerpt. Fall back to the <link> redirect
            # only when <source url> is absent.
            target = source_url or link
            if not target:
                continue
            discovery_snippet = re.sub(
                r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(desc))
            ).strip()[:800]
            results.append(SearchResult(
                url=target,
                title=title,
                snippet=source_name or "",
                publisher_domain=link_host,
                discovery_snippet=discovery_snippet,
            ))
            if len(results) >= max_results:
                break
        return results


class NewsNowSearchProvider:
    """NewsNow-compatible upstream (ourongxing/newsnow), the CN-core zero-key
    provider. Hotlists are not keyword-searchable upstream: fetch each
    configured platform's hotlist and filter client-side by employer tokens."""

    def __init__(self, *, fetcher: Any, platforms: List[str] | None = None,
                 api_url: str | None = None, tokens: Optional[set] = None):
        self.fetcher = fetcher  # object with get_json(url, headers=...) -> dict
        self.platforms = platforms or [
            "zhihu", "weibo", "baidu", "toutiao", "thepaper",
        ]
        self.api_url = (api_url or "https://newsnow.busiyi.world/api/s").rstrip("/")
        self.tokens = tokens or set()  # employer tokens for filtering

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        results: List[SearchResult] = []
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/126.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": self.api_url.rsplit("/api", 1)[0] + "/",
        }
        query_tokens = self.tokens or {
            t for t in re.findall(r"[a-z0-9一-鿿]+", query.casefold())
            if len(t) >= 2
        }
        for platform in self.platforms:
            if len(results) >= max_results:
                break
            try:
                data = self.fetcher.get_json(
                    f"{self.api_url}?id={platform}&latest", headers=headers)
            except Exception:
                continue
            for item in (data.get("items") or []):
                title = str(item.get("title") or "").strip()
                url = str(item.get("url") or "").strip()
                if not title or not url:
                    continue
                haystack = title.casefold()
                if query_tokens and not any(
                        tok in haystack for tok in query_tokens):
                    continue
                results.append(SearchResult(
                    url=url, title=title, snippet=f"NewsNow {platform}"))
                if len(results) >= max_results:
                    break
        return results


def build_search_chain(config, *, fetcher) -> List[SearchProvider]:
    import os
    chain: List[SearchProvider] = []
    for name in config.search_providers:
        if name == "tavily":
            api_key = os.environ.get("TAVILY_API_KEY")
            if not api_key:
                logger.warning(
                    "[WebResearch] skipping tavily: TAVILY_API_KEY not set")
                continue
            chain.append(TavilySearchProvider(
                api_key=api_key, fetcher=fetcher))
        elif name == "brave":
            api_key = os.environ.get("BRAVE_API_KEY")
            if not api_key:
                logger.warning(
                    "[WebResearch] skipping brave: BRAVE_API_KEY not set")
                continue
            chain.append(BraveSearchProvider(
                api_key=api_key, fetcher=fetcher))
        elif name == "newsnow":
            # Reuse the existing hotlist upstream override (self-hosted
            # newsnow / TrendRadar) instead of a second env var.
            chain.append(NewsNowSearchProvider(
                fetcher=fetcher,
                api_url=os.environ.get("RESEARCH_HOTLIST_API_URL") or None,
            ))
        elif name == "duckduckgo":
            chain.append(DuckDuckGoSearchProvider(fetcher=fetcher))
        elif name == "google_news":
            chain.append(GoogleNewsRssSearchProvider(fetcher=fetcher))
    return chain
