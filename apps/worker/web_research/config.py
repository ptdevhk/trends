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

def load_web_research_config(env: Optional[Dict[str, str]] = None) -> WebResearchConfig:
    source = env if env is not None else os.environ
    enabled = str(source.get("WEB_RESEARCH_ENABLED", "")).strip().lower() in {
        "1", "true", "yes", "on",
    }
    providers: List[str] = []
    if source.get("TAVILY_API_KEY"):
        providers.append("tavily")
    if source.get("BRAVE_API_KEY"):
        providers.append("brave")
    providers.append("duckduckgo")  # zero-key, but bot-walled from many IPs
    providers.append("google_news")  # free zero-key RSS fallback, always last
    fetch_provider = "firecrawl" if source.get("FIRECRAWL_API_KEY") else "guarded"
    return WebResearchConfig(
        enabled=enabled,
        search_providers=providers,
        fetch_provider=fetch_provider,
    )
