# coding=utf-8
"""
Unit tests for the customer-watchlist spread (客户监控 → 扩散) cosmetic source fix.

Verifies that a duplicate article that exists under BOTH a `rss:watch-*`
(customer) platform and a static feed (e.g. gnews-diecast) is attributed to the
**customer** platform when choosing which row to surface, so the daily report's
source label shows the customer name, not the generic 压铸网.
"""
from __future__ import annotations

import os
import re
from typing import Dict, List

from apps.worker.research_customer_spread import (
    build_customer_feeds,
    customer_branch_terms,
    parse_customer_watchlist,
    spread_feed_url,
)

os.environ.setdefault("WORKSPACE_SLUG", "hr")

# This is a pure-python placeholder: the real prefer-watch dedupe lives in the
# shared buildLivePack / build-live.ts. These tests guard the *worker-side* feed
# shape so the customer platform is stable and labelable.


def test_branch_feed_uses_single_broad_term():
    """A multi-term branch query returns 0 Bing items; the fix uses the FIRST
    branch term alone (broad → dated news), so the feed url is that single term."""
    feeds = build_customer_feeds(
        [{"companyKey": "shuashuo", "name": "铩硕精密", "downstreamBranch": "压铸", "status": "active"}],
        engine="bing",
    )
    branch = [f for f in feeds if f["id"].startswith("watch-shuashuo-")]
    assert len(branch) == 1
    # url encodes 压铸 single term only (not 压铸+压铸机+…)
    assert "q=%E5%8E%8B%E9%93%B8&" in branch[0]["url"]


def test_branch_feed_specific_feed_pair():
    env = re.compile(r"^watch-[^-]+(-.+)?$")
    feeds = build_customer_feeds(
        [{"companyKey": "shuashuo", "name": "铩硕精密", "downstreamBranch": "压铸", "status": "active"}],
        engine="bing",
    )
    ids = [f["id"] for f in feeds]
    assert "watch-shuashuo" in ids
    assert sum(1 for i in ids if env.match(i)) == 2  # specific + branch


def test_branch_term_first_is_broad():
    terms = customer_branch_terms("压铸")
    assert terms[0] == "压铸"


# Note: the prefer-watch dedupe itself is tested in the shared daily-report-live
# (buildLivePack) + build-live.ts; the worker only guarantees the feed/platform
# shape above. No network is touched in these unit tests.
