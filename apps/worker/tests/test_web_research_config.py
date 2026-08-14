from apps.worker.web_research.config import load_web_research_config

def test_disabled_by_default():
    cfg = load_web_research_config({})
    assert cfg.enabled is False
    assert cfg.monthly_cap == 1000
    assert cfg.search_providers == ["newsnow", "duckduckgo", "google_news"]
    assert cfg.market == "cn"  # core default: internal users are China users; MY is opt-in

def test_enabled_with_tavily_key_selects_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "TAVILY_API_KEY": "tvly-x",
    })
    assert cfg.enabled is True
    assert cfg.search_providers == [
        "tavily", "newsnow", "duckduckgo", "google_news",
    ]

def test_brave_only_no_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "true",
        "BRAVE_API_KEY": "brave-x",
    })
    assert cfg.search_providers == [
        "brave", "newsnow", "duckduckgo", "google_news",
    ]

def test_default_market_is_cn_core_default():
    cfg = load_web_research_config({})
    assert cfg.market == "cn"

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

def test_so360_opt_in_appends_cn_keyword_provider():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "WEB_RESEARCH_MARKET": "cn",
        "WEB_RESEARCH_360_ENABLED": "1",
    })
    assert cfg.so360_enabled is True
    assert cfg.search_providers == [
        "so360", "newsnow", "duckduckgo", "google_news",
    ]

def test_so360_off_by_default():
    cfg = load_web_research_config({"WEB_RESEARCH_ENABLED": "1"})
    assert cfg.so360_enabled is False
    assert cfg.search_providers == ["newsnow", "duckduckgo", "google_news"]

def test_so360_my_market_still_appends_but_chain_skips_cn_lane():
    # 360 only makes sense for CN keyword searches; the chain builder still
    # includes it (config-level opt-in is market-agnostic).
    cfg = load_web_research_config({
        "WEB_RESEARCH_MARKET": "my",
        "WEB_RESEARCH_360_ENABLED": "1",
        "TAVILY_API_KEY": "tvly-x",
    })
    assert cfg.search_providers == [
        "tavily", "so360", "duckduckgo", "google_news",
    ]
