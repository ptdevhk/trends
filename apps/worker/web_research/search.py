from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Any, List, Optional, Protocol
from urllib.parse import parse_qs, quote_plus, urlparse


@dataclass
class SearchResult:
    url: str
    title: str
    snippet: str = ""


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


def build_search_chain(config, *, fetcher) -> List[SearchProvider]:
    import os
    chain: List[SearchProvider] = []
    for name in config.search_providers:
        if name == "tavily":
            chain.append(TavilySearchProvider(
                api_key=os.environ["TAVILY_API_KEY"], fetcher=fetcher))
        elif name == "brave":
            chain.append(BraveSearchProvider(
                api_key=os.environ["BRAVE_API_KEY"], fetcher=fetcher))
        elif name == "duckduckgo":
            chain.append(DuckDuckGoSearchProvider(fetcher=fetcher))
    return chain
