from apps.worker.web_research.config import load_web_research_config

def test_disabled_by_default():
    cfg = load_web_research_config({})
    assert cfg.enabled is False
    assert cfg.monthly_cap == 1000
    assert cfg.search_providers == ["duckduckgo", "google_news"]
    assert cfg.market == "my"  # legacy default: MY pack; CN is opt-in

def test_enabled_with_tavily_key_selects_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "TAVILY_API_KEY": "tvly-x",
    })
    assert cfg.enabled is True
    assert cfg.search_providers == ["tavily", "duckduckgo", "google_news"]

def test_brave_only_no_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "true",
        "BRAVE_API_KEY": "brave-x",
    })
    assert cfg.search_providers == ["brave", "duckduckgo", "google_news"]

def test_default_market_is_my_legacy_default():
    cfg = load_web_research_config({})
    assert cfg.market == "my"

def test_market_cn_respected():
    cfg = load_web_research_config({"WEB_RESEARCH_MARKET": "cn"})
    assert cfg.market == "cn"
    assert cfg.search_providers == ["newsnow", "duckduckgo", "google_news"]

def test_market_is_case_and_whitespace_insensitive():
    cfg = load_web_research_config({"WEB_RESEARCH_MARKET": " CN "})
    assert cfg.market == "cn"
    assert cfg.search_providers == ["newsnow", "duckduckgo", "google_news"]

def test_cn_market_keyed_providers_still_prepend():
    cfg = load_web_research_config({
        "WEB_RESEARCH_MARKET": "cn",
        "TAVILY_API_KEY": "tvly-x",
        "BRAVE_API_KEY": "brave-x",
    })
    assert cfg.search_providers == [
        "tavily", "brave", "newsnow", "duckduckgo", "google_news",
    ]

def test_my_market_explicit_omits_newsnow():
    cfg = load_web_research_config({
        "WEB_RESEARCH_MARKET": "my",
        "TAVILY_API_KEY": "tvly-x",
    })
    assert cfg.search_providers == ["tavily", "duckduckgo", "google_news"]
