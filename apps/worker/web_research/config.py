from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

@dataclass
class WebResearchConfig:
    enabled: bool
    search_providers: List[str]
    fetch_provider: str = "guarded"
    monthly_cap: int = 1000
    queries_per_proposal: int = 3
    # Target market for query packs + provider chain. Default "cn" because
    # internal users are China users (CN is the product core); MY is the
    # additional case via WEB_RESEARCH_MARKET=my.
    market: str = "cn"
    # 360 (so.com) is the CN-core free keyword search provider. It is a
    # separate opt-in (default off) because it is a live external service;
    # when off, the CN chain stays hotlist-first as before.
    so360_enabled: bool = False

def load_web_research_config(env: Optional[Dict[str, str]] = None) -> WebResearchConfig:
    source = env if env is not None else os.environ
    enabled = str(source.get("WEB_RESEARCH_ENABLED", "")).strip().lower() in {
        "1", "true", "yes", "on",
    }
    market = (
        str(source.get("WEB_RESEARCH_MARKET", "cn")).strip().lower() or "cn"
    )
    providers: List[str] = []
    if source.get("TAVILY_API_KEY"):
        providers.append("tavily")
    if source.get("BRAVE_API_KEY"):
        providers.append("brave")
    so360_enabled = str(source.get("WEB_RESEARCH_360_ENABLED", "")).strip().lower() in {
        "1", "true", "yes", "on",
    }
    if so360_enabled:
        # 360 search carries the CN keyword-search lane (only meaningful for
        # CN queries); it is tried after keyed providers and before the
        # hotlist so a working hotlist match still wins.
        providers.append("so360")
    if market == "cn":
        # CN-core zero-key provider: NewsNow hotlists filtered by employer
        # tokens, ahead of the generic zero-key fallbacks.
        providers.append("newsnow")
    providers.append("duckduckgo")  # zero-key, but bot-walled from many IPs
    providers.append("google_news")  # free zero-key RSS fallback, always last
    fetch_provider = "firecrawl" if source.get("FIRECRAWL_API_KEY") else "guarded"
    return WebResearchConfig(
        enabled=enabled,
        search_providers=providers,
        fetch_provider=fetch_provider,
        market=market,
        so360_enabled=so360_enabled,
    )
