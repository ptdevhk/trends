# apps/worker/web_research/classify.py
from __future__ import annotations
import re
from urllib.parse import urlparse

_REGISTRY_DOMAINS = {"ssm.com.my", "mydata-ssm.com.my", "dosm.gov.my"}
# CN structured company-registry surfaces. Shuidi/xin.baidu/qcc/tianyancha
# are the CN equivalents of the MY SSM registry lane: machine-verifiable
# company records whose evidence excerpt carries the employer's registered
# name. aiqicha.baidu.com is the same lane but rate-gates anon access, so it
# stays discovery-only.
_CN_REGISTRY_DOMAINS = {
    "shuidi.cn",
    "xin.baidu.com",
    "qcc.com",
    "tianyancha.com",
    "aiqicha.baidu.com",
}
# Company-record path patterns per CN registry domain. Only these are
# machine-verifiable registration records; homepages and 360-search
# landings (e.g. qcc.com/?utm_source=360zrkp) are unvetted web hits that
# fail fetch and hard-block review (observed 2026-08-14 on the CN lane).
_CN_REGISTRY_RECORD_PATHS = {
    # shuidi record: /company-<hex-id>.html, hall: /company-<hex-id>/hall.html
    "shuidi.cn": re.compile(r"^/company-[0-9a-fA-F]+(?:/|\.html)"),
    "qcc.com": re.compile(r"^/firm/"),
    "tianyancha.com": re.compile(r"^/company/\d+"),
    "xin.baidu.com": re.compile(r"^/detail/compinfo"),
}
_DIRECTORY_DOMAINS = {
    "yellowpages.com.my", "yellowpages.com", "kompass.com",
    "alibaba.com", "made-in-china.com", "industrydirectory.com.my",
    "tradingview.com", "klsescreener.com", "i3investor.com",
    "edgeprop.my", "bursamalaysia.com", "marketwatch.com",
    "jobui.com", "zhipin.com", "job51.com", "liepin.com", "51job.com",
}
_REPORTING_DOMAINS = {
    "thestar.com.my", "nst.com.my", "theedgemalaysia.com",
    "businesstimes.com.sg", "reuters.com", "bloomberg.com",
    "themalaysianreserve.com", "theborneopost.com", "malaymail.com",
    "freemalaysiatoday.com", "bernama.com", "thepeakmagazine.com.sg",
    "straitstimes.com", "channelnewsasia.com", "yahoo.com",
    "36kr.com", "ifeng.com", "sohu.com", "163.com", "sina.com.cn",
    "jiemian.com", "thepaper.cn", "cls.cn", "caixin.com", "21jingji.com",
    "baike.so.com", "baike.baidu.com",
}

def _employer_tokens(employer_surface: str) -> set[str]:
    stop = {"sdn", "bhd", "m", "sdnbhd", "malaysia", "the", "and",
            "co", "company", "inc", "ltd", "pte"}
    tokens = {
        t for t in re.findall(r"[a-z0-9]+", employer_surface.casefold())
        if len(t) >= 3 and t not in stop
    }
    return tokens


# Ultra-generic words that appear in virtually any news homepage or
# boilerplate. Tokens in this set can never *on their own* prove employer
# relevance (they caused the robo-machine-tools and southern-pipe
# false-ready runs). Sector nouns ("industry", "pipe", "sports", …) are
# included: "pipe industry" describes a sector, not a company.
_GENERIC_TOKENS = {
    "new", "line", "group", "global", "tech", "technology", "systems",
    "system", "solutions", "industries", "industrial", "international",
    "power", "star", "edge", "world", "holdings", "ventures", "capital",
    "services", "engineering", "enterprise", "enterprises",
    "equipment", "supply", "supplies", "online", "malaysia-news",
    "industry", "pipe", "southern", "sports", "sport", "lighting",
    "automation", "precision", "technology", "corporation",
}


_PORTAL_SUFFIXES = (
    "online", "news", "portal", "homepage", "home page",
)


_PORTAL_PHRASES = (
    "malaysia news", "world news", "business news", "breaking news",
    "make better decisions", "latest news",
)


def distinctive_employer_tokens(employer_surface: str) -> set[str]:
    """Employer tokens minus ultra-generic words. Empty means the surface
    has no distinctive vocabulary (fail-open handled by callers)."""
    return _employer_tokens(employer_surface) - _GENERIC_TOKENS

def classify_source(url: str, employer_surface: str) -> dict:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    # Google News RSS redirect URLs (arrive only when the RSS source url was
    # absent) — the article itself is a reporting-tier news hit.
    if host == "news.google.com" or host.endswith(".news.google.com"):
        return {"sourceType": "reporting", "trustTier": "corroborating"}
    if host in _REGISTRY_DOMAINS:
        return {"sourceType": "registry", "trustTier": "authoritative"}
    if host in _CN_REGISTRY_DOMAINS:
        # CN registry lane: authoritative only for real company-record
        # URLs. Homepages, search landings, and list pages are unvetted web
        # hits — they fail fetch or carry boilerplate classes, so they are
        # discovery-tier (never approval-safe). aiqicha (which rate-gates
        # anonymous access) is discovery-only regardless.
        record_path = _CN_REGISTRY_RECORD_PATHS.get(host)
        if host == "aiqicha.baidu.com" or not (
            record_path and record_path.match(urlparse(url).path)
        ):
            return {"sourceType": "search_result", "trustTier": "discovery"}
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


_GENERIC_TITLE_MARKERS = (
    "home", "homepage", "news", "latest", "portal", "official site",
)


def excerpt_proves_employer(
    employer_surface: str,
    *,
    title: str = "",
    excerpt: str = "",
) -> bool:
    """Relevance-tightening gate: does the *content evidence* for a hit
    provably mention the employer? URL is deliberately excluded — every
    curated press homepage would pass on domain alone (the
    robo-machine-tools failure mode, 2026-07-30).

    Only *distinctive* tokens count: ultra-generic words ("new", "line",
    "industry", "pipe", …) appear in any English news homepage and must not
    prove relevance on their own.

    Fail-open only for a *degenerate* surface (no usable employer tokens at
    all, e.g. "Sdn Bhd"). A surface whose entire vocabulary is generic
    sector nouns fails closed instead — otherwise every business homepage
    would "prove" it (the southern-pipe fail-open, 2026-07-30).
    """
    all_tokens = _employer_tokens(employer_surface)
    if not all_tokens:
        return True
    tokens = distinctive_employer_tokens(employer_surface)
    if not tokens:
        return False
    haystack = f"{title} {excerpt}".casefold()
    return any(tok in haystack for tok in tokens)


def looks_like_homepage_title(title: str) -> bool:
    """Publisher-portal titles signal a homepage row rather than an
    article-level source: 'NST Online', 'BBC Home', 'Killeen Daily Herald:
    Killeen News, Sports, Weather', portal taglines like 'Malaysia News &
    World Updates'."""
    lowered = title.strip().casefold()
    if not lowered:
        return False
    if any(marker in lowered for marker in _GENERIC_TITLE_MARKERS):
        return True
    if any(phrase in lowered for phrase in _PORTAL_PHRASES):
        return True
    words = [w.strip("|:–—-,. ") for w in lowered.split()]
    if any(w in _PORTAL_SUFFIXES for w in words):
        return True
    # Publisher self-titles are short: "The Edge Malaysia", "Reuters".
    if len(words) <= 3 and not any(ch.isdigit() for ch in lowered):
        return True
    return False
