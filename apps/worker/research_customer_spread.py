# coding=utf-8
"""
Customer-watchlist spread (客户监控 → 扩散).

Given the workspace customer-watchlist (`research.customerWatchlist`), synthesize
zero-key Google/Bing News RSS search feeds that spread each customer's name,
aliases and downstream-branch terms into dated news rows, then reuse the thin
RSS port to fetch + hash + upsert them as real `news_items` rows under the
`rss:watch-<customerKey>` platform prefix so the daily-report corpus sees them.

Single source of truth for branch → query terms lives in the shared TS
(`CUSTOMER_BRANCH_TERMS` in packages/shared/src/research/daily-report-live.ts);
this module mirrors the vocabulary so the worker can build queries without a TS
round-trip. Keep the two in sync.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

# Workspace config key (same as the BFF service).
CUSTOMER_WATCHLIST_CONFIG_KEY = "research.customerWatchlist"

# Mirror of shared CUSTOMER_BRANCH_TERMS (keep in sync with daily-report-live.ts).
CUSTOMER_BRANCH_TERMS: Dict[str, List[str]] = {
    "压铸": ["压铸", "压铸机", "压铸厂", "die-casting", "铸件"],
    "模具": ["模具", "注塑", "冲压模"],
    "五金": ["五金", "冲压", "钣金"],
    "冲压": ["冲压", "冲压件", "五金"],
    "机加工": ["机加工", "加工", "零件加工", "机加"],
    "钣金": ["钣金", "折弯", "激光切割"],
    "其他": [],
}

# Publish-age gate for spread rows: only <pubDate> within the daily-report window.
SPREAD_MAX_AGE_DAYS = 7
# Per-customer result cap (Bing/Google RSS returns ≤ ~50-100; keep rows bounded).
SPREAD_MAX_ITEMS_PER_CUSTOMER = 40


def customer_branch_terms(branch: str) -> List[str]:
    return list(CUSTOMER_BRANCH_TERMS.get(branch, []))


def customer_spread_terms(entry: Dict) -> List[str]:
    """name + aliases + branch terms, deduped, non-empty (same as shared)."""
    seen = set()
    out: List[str] = []
    for raw in (
        [str(entry.get("name") or "")]
        + [str(a) for a in (entry.get("aliases") or [])]
        + customer_branch_terms(str(entry.get("downstreamBranch") or ""))
    ):
        term = raw.strip()
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def parse_customer_watchlist(raw) -> List[Dict]:
    """Dumb Python mirror of the BFF parseCustomerWatchlist (array + id + strings)."""
    if not isinstance(raw, list):
        return []
    out: List[Dict] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        entry = {
            "id": str(item.get("id") or f"{i}"),
            "companyKey": str(item.get("companyKey") or "customer"),
            "name": name,
            "aliases": [str(a) for a in (item.get("aliases") or []) if str(a).strip()],
            "downstreamBranch": str(item.get("downstreamBranch") or "其他"),
            # status: only spread ACTIVE targets (needsTopic = not yet usable).
            "status": str(item.get("status") or "active"),
        }
        out.append(entry)
    return out


def load_customer_watchlist(ctx_url: Optional[str], workspace_slug: str) -> List[Dict]:
    """Read the workspace customer watchlist via Convex `workspace_config:get`.

    Fail-open: Convex/unavailable → empty list (no spread this run).
    """
    if not ctx_url:
        return []
    try:
        from apps.worker.research_convex import convex_query

        row = convex_query(
            ctx_url,
            "workspace_config:get",
            {"workspaceSlug": workspace_slug, "configKey": CUSTOMER_WATCHLIST_CONFIG_KEY},
        )
        raw = row.get("configValue") if isinstance(row, dict) else None
        return [
            e
            for e in parse_customer_watchlist(raw)
            if e["status"] == "active"
        ]
    except Exception as error:  # noqa: BLE001 — fail-open, never break ingest
        logger.warning("[CustomerSpread] watchlist read failed: %s", error)
        return []


def spread_feed_url(terms: List[str], *, engine: str = "bing") -> str:
    """Zero-key RSS search URL for a customer term set (CN audience).

    bing: `https://www.bing.com/news/search?q=...&format=rss&setlang=zh-hans`
    google: `https://news.google.com/rss/search?q=...&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
    Terms joined with `+`, URL-encoded.
    """
    q = quote_plus(" ".join(terms))
    if engine == "google":
        return (
            f"https://news.google.com/rss/search?q={q}"
            "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
        )
    return f"https://www.bing.com/news/search?q={q}&format=rss&setlang=zh-hans"


def build_customer_feeds(
    entries: List[Dict],
    *,
    engine: str = "bing",
    max_items: int = SPREAD_MAX_ITEMS_PER_CUSTOMER,
) -> List[Dict]:
    """One feed per active customer → `{id: 'watch-<companyKey>', url, max_age_days}`.

    Feed id is deterministic per companyKey so `parse_rss_xml` yields a stable
    `platform='rss:watch-<companyKey>'` for dedupe + filtering + source label.
    """
    feeds: List[Dict] = []
    seen_ids = set()
    for entry in entries:
        company_key = str(entry.get("companyKey") or "").strip() or "customer"
        terms = customer_spread_terms(entry)
        if not terms:
            logger.info("[CustomerSpread] %s has no spread terms; skipping", company_key)
            continue
        feed_id = f"watch-{company_key}"
        if feed_id in seen_ids:
            continue
        seen_ids.add(feed_id)
        feeds.append(
            {
                "id": feed_id,
                "url": spread_feed_url(terms, engine=engine),
                "engine": engine,
                "max_age_days": SPREAD_MAX_AGE_DAYS,
                "max_items": int(max_items),
                "customerKey": company_key,
            }
        )
    return feeds
