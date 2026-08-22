from __future__ import annotations
import html
import logging
import re
import threading
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol
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


class So360SearchProvider:
    """Free, no-key CN keyword search (so.com).

    The results page rows are ``<li class="res-list">`` blocks carrying the
    title, snippet, and an opaque ``so.com/link`` redirect URL. The redirect
    stub page embeds the real target in a meta-refresh; resolving it lets
    classify_source see the publisher domain (registry/directory/official
    site) instead of www.so.com.
    """

    BASE = "https://www.so.com/s?q="
    _RESULT_BLOCK_RE = re.compile(
        r'<li class="res-list"[^>]*>(.*?)</li>', re.DOTALL)
    _RESULT_HREF_RE = re.compile(
        r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
    _RESULT_SNIPPET_RE = re.compile(
        r'<p class="res-desc[^"]*"[^>]*>(.*?)</p>', re.DOTALL)
    _META_REFRESH_RE = re.compile(
        r'<meta[^>]*http-equiv=["\']refresh["\'][^>]*'
        r'content=["\']0;URL=[\'"]([^\'"]+)[\'"]',
        re.IGNORECASE,
    )

    def __init__(self, *, fetcher: Any):
        self.fetcher = fetcher  # object with fetch_text(url) -> str
        self._resolved: Dict[str, str] = {}

    def _resolve_link(self, url: str) -> str:
        """Resolve an opaque so.com/link redirect to its real target."""
        if url in self._resolved:
            return self._resolved[url]
        target = url
        try:
            page = self.fetcher.fetch_text(url)
            match = self._META_REFRESH_RE.search(page)
            if match:
                target = html.unescape(match.group(1)).strip()
        except Exception:  # noqa: BLE001 - fall back to the link URL
            target = url
        self._resolved[url] = target
        return target

    @staticmethod
    def _absolute(href: str) -> str:
        href = href.strip()
        if href.startswith("//"):
            return "https:" + href
        if href.startswith("/"):
            return "https://www.so.com" + href
        return href

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        page = self.fetcher.fetch_text(self.BASE + quote_plus(query))
        results: List[SearchResult] = []
        for block in self._RESULT_BLOCK_RE.finditer(page):
            raw_block = block.group(1)
            anchor = self._RESULT_HREF_RE.search(raw_block)
            if not anchor:
                continue
            href = self._absolute(anchor.group(1))
            title = re.sub(r"<[^>]+>", " ", anchor.group(2)).strip()
            if not href or not title:
                continue
            snippet_match = self._RESULT_SNIPPET_RE.search(raw_block)
            snippet = (
                re.sub(r"<[^>]+>", " ", snippet_match.group(1)).strip()
                if snippet_match else ""
            )
            url = (
                self._resolve_link(href)
                if href.startswith("https://www.so.com/link")
                else href
            )
            results.append(SearchResult(url=url, title=title, snippet=snippet))
            if len(results) >= max_results:
                break
        return results


class NewsNowHotlistSnapshot:
    """Lazily-fetched, once-per-sweep snapshot of NewsNow platform hotlists.

    Thread-safe: concurrent first uses fetch exactly once under a lock; every
    later use serves the cached items without touching the transport. One
    snapshot lives per DiscoveryJob (one per maintenance sweep), so the
    hotlist endpoint is hit once per sweep instead of once per proposal.
    """

    def __init__(
        self,
        *,
        fetcher: Any,
        platforms: List[str],
        api_url: str,
        headers: Dict[str, str],
    ):
        self._fetcher = fetcher  # object with get_json(url, headers=...) -> dict
        self._platforms = list(platforms)
        self._api_url = api_url
        self._headers = dict(headers)
        self._items: List[Dict[str, Any]] = []
        self._fetched = False
        self._lock = threading.Lock()

    def items(self) -> List[Dict[str, Any]]:
        """All hotlist items across platforms (fetched once per sweep)."""
        with self._lock:
            if not self._fetched:
                for platform in self._platforms:
                    try:
                        data = self._fetcher.get_json(
                            f"{self._api_url}?id={platform}&latest",
                            headers=self._headers,
                        )
                    except Exception:
                        continue
                    for item in (data.get("items") or []):
                        title = str(item.get("title") or "").strip()
                        url = str(item.get("url") or "").strip()
                        if title and url:
                            self._items.append(
                                {"title": title, "url": url, "platform": platform}
                            )
                self._fetched = True
            return list(self._items)


class NewsNowSearchProvider:
    """NewsNow-compatible upstream (ourongxing/newsnow), the CN-core zero-key
    provider. Hotlists are not keyword-searchable upstream: fetch each
    configured platform's hotlist ONCE per sweep (see NewsNowHotlistSnapshot)
    and filter client-side by employer tokens."""

    def __init__(self, *, fetcher: Any, platforms: List[str] | None = None,
                 api_url: str | None = None, tokens: Optional[set] = None):
        self.fetcher = fetcher  # object with get_json(url, headers=...) -> dict
        self.platforms = platforms or [
            "zhihu", "weibo", "baidu", "toutiao", "thepaper",
        ]
        self.api_url = (api_url or "https://newsnow.busiyi.world/api/s").rstrip("/")
        self.tokens = tokens or set()  # employer tokens for filtering
        self.snapshot = NewsNowHotlistSnapshot(
            fetcher=self.fetcher,
            platforms=self.platforms,
            api_url=self.api_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": self.api_url.rsplit("/api", 1)[0] + "/",
            },
        )

    def hotlist_items(self) -> List[Dict[str, Any]]:
        """Once-per-sweep hotlist items (lazily fetched, then cached)."""
        return self.snapshot.items()

    def search(self, query: str, max_results: int) -> List[SearchResult]:
        results: List[SearchResult] = []
        query_tokens = self.tokens or {
            t for t in re.findall(r"[a-z0-9一-鿿]+", query.casefold())
            if len(t) >= 2
        }
        for item in self.hotlist_items():
            if len(results) >= max_results:
                break
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            if not title or not url:
                continue
            if query_tokens and not any(
                    tok in title.casefold() for tok in query_tokens):
                continue
            results.append(SearchResult(
                url=url, title=title,
                snippet=f"NewsNow {item.get('platform') or ''}"))
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
        elif name == "so360":
            chain.append(So360SearchProvider(fetcher=fetcher))
        elif name == "duckduckgo":
            chain.append(DuckDuckGoSearchProvider(fetcher=fetcher))
        elif name == "google_news":
            chain.append(GoogleNewsRssSearchProvider(fetcher=fetcher))
    return chain
