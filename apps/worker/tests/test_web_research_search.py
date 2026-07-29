from apps.worker.web_research.search import (
    DuckDuckGoSearchProvider,
    GoogleNewsRssSearchProvider,
    SearchResult,
    build_search_chain,
)
from apps.worker.web_research.config import load_web_research_config

DDG_HTML = """
<html><body>
<a class="result__a" href="https://newline.example.com/">New Line Machine Tool</a>
<a class="result__snippet">CNC machining center distributor Malaysia</a>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Frobo.example.com%2Fabout">Robo Machine Tools</a>
</body></html>
"""


class FakeFetcher:
    def __init__(self, pages):
        self.pages = pages

    def fetch_text(self, url):
        return self.pages[url]


GN_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>New Line Machine Tool - Google News</title>
    <item>
      <title>New Line Machine Tool expands CNC plant in Penang</title>
      <link>https://news.google.com/rss/articles/CBMiAAAAAAA</link>
      <source url="https://www.themalaysianreserve.com">The Malaysian Reserve</source>
    </item>
    <item>
      <title>Penang manufacturing investments rise</title>
      <link>https://news.google.com/rss/articles/CBMiBBBBBBB</link>
    </item>
  </channel>
</rss>
"""

GN_URL = (
    "https://news.google.com/rss/search?q=New+Line+Machine+Tool"
    "&hl=en-MY&gl=MY&ceid=MY%3Aen"
)


def test_google_news_rss_prefers_source_url_and_uses_link_fallback():
    provider = GoogleNewsRssSearchProvider(fetcher=FakeFetcher({GN_URL: GN_RSS}))
    results = provider.search("New Line Machine Tool", max_results=5)
    assert results == [
        SearchResult(
            url="https://www.themalaysianreserve.com",
            title="New Line Machine Tool expands CNC plant in Penang",
            snippet="The Malaysian Reserve",
        ),
        SearchResult(
            url="https://news.google.com/rss/articles/CBMiBBBBBBB",
            title="Penang manufacturing investments rise",
            snippet="",
        ),
    ]


def test_google_news_rss_respects_max_results():
    provider = GoogleNewsRssSearchProvider(fetcher=FakeFetcher({GN_URL: GN_RSS}))
    results = provider.search("New Line Machine Tool", max_results=1)
    assert len(results) == 1
    assert results[0].url == "https://www.themalaysianreserve.com"


def test_google_news_rss_bad_xml_returns_empty():
    provider = GoogleNewsRssSearchProvider(
        fetcher=FakeFetcher({GN_URL: "<html>captcha</html>"})
    )
    assert provider.search("New Line Machine Tool", max_results=5) == []


def test_duckduckgo_parses_results_and_unwraps_redirects():
    provider = DuckDuckGoSearchProvider(fetcher=FakeFetcher({
        "https://html.duckduckgo.com/html/?q=test": DDG_HTML,
    }))
    results = provider.search("test", max_results=5)
    assert any(r.url == "https://newline.example.com/" for r in results)
    assert any(r.url == "https://robo.example.com/about" for r in results)


def test_build_chain_orders_keyed_providers_first(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-x")
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "TAVILY_API_KEY": "tvly-x",
    })
    chain = build_search_chain(cfg, fetcher=FakeFetcher({}))
    assert [type(p).__name__ for p in chain] == [
        "TavilySearchProvider", "DuckDuckGoSearchProvider",
        "GoogleNewsRssSearchProvider",
    ]


def test_build_chain_zero_key_defaults(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    cfg = load_web_research_config({"WEB_RESEARCH_ENABLED": "1"})
    chain = build_search_chain(cfg, fetcher=FakeFetcher({}))
    assert [type(p).__name__ for p in chain] == [
        "DuckDuckGoSearchProvider", "GoogleNewsRssSearchProvider",
    ]
