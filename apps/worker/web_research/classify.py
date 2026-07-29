# apps/worker/web_research/classify.py
from __future__ import annotations
import re
from urllib.parse import urlparse

_REGISTRY_DOMAINS = {"ssm.com.my", "mydata-ssm.com.my", "dosm.gov.my"}
_DIRECTORY_DOMAINS = {
    "yellowpages.com.my", "yellowpages.com", "kompass.com",
    "alibaba.com", "made-in-china.com", "industrydirectory.com.my",
}
_REPORTING_DOMAINS = {
    "thestar.com.my", "nst.com.my", "theedgemalaysia.com",
    "businesstimes.com.sg", "reuters.com", "bloomberg.com",
    "themalaysianreserve.com", "theborneopost.com", "malaymail.com",
    "freemalaysiatoday.com", "bernama.com", "thepeakmagazine.com.sg",
    "straitstimes.com", "channelnewsasia.com", "yahoo.com",
}

def _employer_tokens(employer_surface: str) -> set[str]:
    stop = {"sdn", "bhd", "m", "sdnbhd", "malaysia", "the", "and",
            "co", "company", "inc", "ltd", "pte"}
    tokens = {
        t for t in re.findall(r"[a-z0-9]+", employer_surface.casefold())
        if len(t) >= 3 and t not in stop
    }
    return tokens

def classify_source(url: str, employer_surface: str) -> dict:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    # Google News RSS redirect URLs (arrive only when the RSS source url was
    # absent) — the article itself is a reporting-tier news hit.
    if host == "news.google.com" or host.endswith(".news.google.com"):
        return {"sourceType": "reporting", "trustTier": "corroborating"}
    if host in _REGISTRY_DOMAINS:
        return {"sourceType": "registry", "trustTier": "authoritative"}
    if host in _DIRECTORY_DOMAINS:
        return {"sourceType": "directory", "trustTier": "corroborating"}
    if host in _REPORTING_DOMAINS:
        return {"sourceType": "reporting", "trustTier": "corroborating"}
    # Official site: employer token appears in the domain
    tokens = _employer_tokens(employer_surface)
    if tokens and any(tok in host for tok in tokens):
        return {"sourceType": "official_site", "trustTier": "primary"}
    # Default: unvetted search hit — never approval-safe
    return {"sourceType": "search_result", "trustTier": "discovery"}
