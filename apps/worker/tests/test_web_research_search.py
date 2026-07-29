from apps.worker.web_research.search import (
    DuckDuckGoSearchProvider,
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
    ]
