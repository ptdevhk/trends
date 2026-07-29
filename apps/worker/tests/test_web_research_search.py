from apps.worker.web_research.search import (
    DuckDuckGoSearchProvider,
    GoogleNewsRssSearchProvider,
    NewsNowSearchProvider,
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
      <description>&lt;a href="https://news.google.com/rss/articles/CBMiAAAAAAA"&gt;New Line Machine Tool expands CNC plant in Penang&lt;/a&gt;&#160;&#160;&lt;font color="#6f6f6f"&gt;The Malaysian Reserve&lt;/font&gt;</description>
      <source url="https://www.themalaysianreserve.com">The Malaysian Reserve</source>
    </item>
    <item>
      <title>Penang manufacturing investments rise</title>
      <link>https://news.google.com/rss/articles/CBMiBBBBBBB</link>
      <description>&lt;a href="https://news.google.com/rss/articles/CBMiBBBBBBB"&gt;Penang manufacturing investments rise&lt;/a&gt;&#160;&#160;&lt;font color="#6f6f6f"&gt;Free Malaysia Today&lt;/font&gt;</description>
    </item>
  </channel>
</rss>
"""

GN_URL = (
    "https://news.google.com/rss/search?q=New+Line+Machine+Tool"
    "&hl=en-MY&gl=MY&ceid=MY%3Aen"
)


def test_search_result_publisher_domain_defaults_empty():
    result = SearchResult(url="https://x.example/", title="x")
    assert result.publisher_domain == ""
    assert result.discovery_snippet == ""


def test_google_news_rss_emits_publisher_homepage_real_title_and_description():
    provider = GoogleNewsRssSearchProvider(fetcher=FakeFetcher({GN_URL: GN_RSS}))
    results = provider.search("New Line Machine Tool", max_results=5)
    assert results == [
        SearchResult(
            url="https://www.themalaysianreserve.com",
            title="New Line Machine Tool expands CNC plant in Penang",
            snippet="The Malaysian Reserve",
            publisher_domain="www.themalaysianreserve.com",
            discovery_snippet=(
                "New Line Machine Tool expands CNC plant in Penang"
                " The Malaysian Reserve"
            ),
        ),
        SearchResult(
            url="https://news.google.com/rss/articles/CBMiBBBBBBB",
            title="Penang manufacturing investments rise",
            snippet="",
            publisher_domain="",
            discovery_snippet=(
                "Penang manufacturing investments rise Free Malaysia Today"
            ),
        ),
    ]


def test_google_news_rss_falls_back_to_article_link_when_source_url_absent():
    rss_no_source = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>New Line Machine Tool expands CNC plant in Penang</title>
      <link>https://news.google.com/rss/articles/CBMiCCCCCCC</link>
      <description>&lt;a href="https://news.google.com/rss/articles/CBMiCCCCCCC"&gt;New Line Machine Tool expands CNC plant in Penang&lt;/a&gt;&#160;&#160;&lt;font color="#6f6f6f"&gt;The Edge Malaysia&lt;/font&gt;</description>
    </item>
  </channel>
</rss>
"""
    provider = GoogleNewsRssSearchProvider(
        fetcher=FakeFetcher({GN_URL: rss_no_source})
    )
    results = provider.search("New Line Machine Tool", max_results=5)
    assert results == [
        SearchResult(
            url="https://news.google.com/rss/articles/CBMiCCCCCCC",
            title="New Line Machine Tool expands CNC plant in Penang",
            snippet="",
            publisher_domain="",
            discovery_snippet=(
                "New Line Machine Tool expands CNC plant in Penang"
                " The Edge Malaysia"
            ),
        ),
    ]


def test_google_news_rss_discovery_snippet_capped_at_800_chars():
    long_text = "CNC machining news " + "x" * 2000
    from xml.sax.saxutils import escape
    desc = escape(f'<a href="https://x.example/a">{long_text}</a>')
    rss_long = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Long item</title>
      <link>https://news.google.com/rss/articles/CBMiDDDDDDD</link>
      <description>{desc}</description>
      <source url="https://x.example">X Example</source>
    </item>
  </channel>
</rss>
"""
    provider = GoogleNewsRssSearchProvider(
        fetcher=FakeFetcher({GN_URL: rss_long})
    )
    results = provider.search("New Line Machine Tool", max_results=5)
    assert len(results) == 1
    assert len(results[0].discovery_snippet) == 800


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


def test_build_chain_skips_keyed_provider_when_env_key_absent(monkeypatch):
    # config lists tavily (e.g. from a config file) but the env var the
    # chain builder reads is missing: skip with a warning, no KeyError.
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    cfg = load_web_research_config({"WEB_RESEARCH_ENABLED": "1"})
    cfg.search_providers = ["tavily", "duckduckgo"]
    chain = build_search_chain(cfg, fetcher=FakeFetcher({}))
    assert [type(p).__name__ for p in chain] == ["DuckDuckGoSearchProvider"]


# --- NewsNow provider (CN-core zero-key) ---------------------------------

NEWSNOW_ZHIHU = {
    "status": "success",
    "items": [
        {"title": "发那科 机床 价格", "url": "https://zhihu.com/q/1"},
        {"title": "无关热搜", "url": "https://zhihu.com/q/2"},
    ],
}

NEWSNOW_ZHIHU_URL = "https://newsnow.busiyi.world/api/s?id=zhihu&latest"


class FakeJsonFetcher:
    def __init__(self, payloads=None, errors=None):
        self.payloads = payloads or {}
        self.errors = errors or {}
        self.calls = []

    def get_json(self, url, headers=None):
        self.calls.append(url)
        if url in self.errors:
            raise self.errors[url]
        return self.payloads.get(url, {})


def test_newsnow_filters_hotlist_items_by_employer_tokens():
    fetcher = FakeJsonFetcher(payloads={NEWSNOW_ZHIHU_URL: NEWSNOW_ZHIHU})
    provider = NewsNowSearchProvider(
        fetcher=fetcher, platforms=["zhihu"], tokens={"发那科"})
    results = provider.search("发那科 机床", max_results=5)
    assert [r.url for r in results] == ["https://zhihu.com/q/1"]
    assert results[0].title == "发那科 机床 价格"
    assert "NewsNow" in results[0].snippet
    assert fetcher.calls == [NEWSNOW_ZHIHU_URL]


def test_newsnow_derives_tokens_from_query_when_tokens_unset():
    fetcher = FakeJsonFetcher(payloads={NEWSNOW_ZHIHU_URL: NEWSNOW_ZHIHU})
    provider = NewsNowSearchProvider(fetcher=fetcher, platforms=["zhihu"])
    results = provider.search("发那科 机床", max_results=5)
    assert [r.url for r in results] == ["https://zhihu.com/q/1"]


def test_newsnow_respects_max_results():
    payload = {
        "status": "success",
        "items": [
            {"title": "发那科 机床 价格", "url": "https://zhihu.com/q/1"},
            {"title": "发那科 数控 招聘", "url": "https://zhihu.com/q/2"},
            {"title": "发那科 公司 官网", "url": "https://zhihu.com/q/3"},
        ],
    }
    fetcher = FakeJsonFetcher(payloads={NEWSNOW_ZHIHU_URL: payload})
    provider = NewsNowSearchProvider(
        fetcher=fetcher, platforms=["zhihu"], tokens={"发那科"})
    results = provider.search("发那科", max_results=2)
    assert len(results) == 2
    assert [r.url for r in results] == [
        "https://zhihu.com/q/1", "https://zhihu.com/q/2",
    ]


def test_newsnow_platform_exception_soft_skipped():
    fetcher = FakeJsonFetcher(
        payloads={NEWSNOW_ZHIHU_URL: NEWSNOW_ZHIHU},
        errors={
            "https://newsnow.busiyi.world/api/s?id=weibo&latest":
                RuntimeError("weibo 403"),
        },
    )
    provider = NewsNowSearchProvider(
        fetcher=fetcher, platforms=["weibo", "zhihu"], tokens={"发那科"})
    results = provider.search("发那科", max_results=5)
    assert [r.url for r in results] == ["https://zhihu.com/q/1"]
    # weibo raised; zhihu still queried afterwards
    assert fetcher.calls == [
        "https://newsnow.busiyi.world/api/s?id=weibo&latest",
        NEWSNOW_ZHIHU_URL,
    ]


def test_newsnow_rejects_items_without_title_or_url():
    payload = {
        "status": "success",
        "items": [
            {"title": "", "url": "https://zhihu.com/q/0"},
            {"title": "发那科 机床", "url": ""},
            {"title": "发那科 机床 价格", "url": "https://zhihu.com/q/1"},
        ],
    }
    fetcher = FakeJsonFetcher(payloads={NEWSNOW_ZHIHU_URL: payload})
    provider = NewsNowSearchProvider(
        fetcher=fetcher, platforms=["zhihu"], tokens={"发那科"})
    results = provider.search("发那科", max_results=5)
    assert [r.url for r in results] == ["https://zhihu.com/q/1"]


def test_newsnow_no_token_match_returns_empty():
    fetcher = FakeJsonFetcher(payloads={NEWSNOW_ZHIHU_URL: NEWSNOW_ZHIHU})
    provider = NewsNowSearchProvider(
        fetcher=fetcher, platforms=["zhihu"], tokens={"不存在公司"})
    assert provider.search("不存在公司", max_results=5) == []


def test_build_chain_cn_market_places_newsnow_before_zero_key_fallbacks(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "WEB_RESEARCH_MARKET": "cn",
    })
    chain = build_search_chain(cfg, fetcher=FakeJsonFetcher())
    assert [type(p).__name__ for p in chain] == [
        "NewsNowSearchProvider", "DuckDuckGoSearchProvider",
        "GoogleNewsRssSearchProvider",
    ]


def test_build_chain_my_market_omits_newsnow(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "WEB_RESEARCH_MARKET": "my",
    })
    chain = build_search_chain(cfg, fetcher=FakeJsonFetcher())
    assert [type(p).__name__ for p in chain] == [
        "DuckDuckGoSearchProvider", "GoogleNewsRssSearchProvider",
    ]


def test_build_chain_cn_market_keyed_providers_still_prepend(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-x")
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "WEB_RESEARCH_MARKET": "cn",
        "TAVILY_API_KEY": "tvly-x",
    })
    chain = build_search_chain(cfg, fetcher=FakeJsonFetcher())
    assert [type(p).__name__ for p in chain] == [
        "TavilySearchProvider", "NewsNowSearchProvider",
        "DuckDuckGoSearchProvider", "GoogleNewsRssSearchProvider",
    ]


def test_build_chain_newsnow_uses_research_hotlist_api_url_override(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    monkeypatch.setenv("RESEARCH_HOTLIST_API_URL", "https://alt.example/api/s")
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "WEB_RESEARCH_MARKET": "cn",
    })
    chain = build_search_chain(cfg, fetcher=FakeJsonFetcher())
    newsnow = chain[0]
    assert type(newsnow).__name__ == "NewsNowSearchProvider"
    assert newsnow.api_url == "https://alt.example/api/s"
    monkeypatch.delenv("RESEARCH_HOTLIST_API_URL", raising=False)
    chain = build_search_chain(cfg, fetcher=FakeJsonFetcher())
    assert chain[0].api_url == "https://newsnow.busiyi.world/api/s"
