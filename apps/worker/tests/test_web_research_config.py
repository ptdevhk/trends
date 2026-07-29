from apps.worker.web_research.config import load_web_research_config

def test_disabled_by_default():
    cfg = load_web_research_config({})
    assert cfg.enabled is False
    assert cfg.monthly_cap == 1000
    assert cfg.search_providers == ["duckduckgo"]

def test_enabled_with_tavily_key_selects_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "1",
        "TAVILY_API_KEY": "tvly-x",
    })
    assert cfg.enabled is True
    assert cfg.search_providers == ["tavily", "duckduckgo"]

def test_brave_only_no_tavily():
    cfg = load_web_research_config({
        "WEB_RESEARCH_ENABLED": "true",
        "BRAVE_API_KEY": "brave-x",
    })
    assert cfg.search_providers == ["brave", "duckduckgo"]
