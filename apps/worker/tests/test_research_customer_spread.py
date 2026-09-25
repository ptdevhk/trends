# coding=utf-8
"""Unit tests for customer-watchlist spread (客户监控 → 扩散)."""

from __future__ import annotations

from typing import Any, Dict, List

from apps.worker.research_customer_spread import (
    CUSTOMER_BRANCH_TERMS,
    build_customer_feeds,
    customer_branch_terms,
    customer_spread_terms,
    load_customer_watchlist,
    parse_customer_watchlist,
    spread_feed_url,
)
from apps.worker.research_convex import ResearchConvexClient
from apps.worker.research_ingest import ResearchIngestJob, spread_engine
from apps.worker.research_ports import StaticHotlistPort, StaticRssPort


class RecordingConvex:
    """Fake Convex transport (mirror of test_research_ingest).Records mutations."""

    def __init__(self):
        self.mutations: List[tuple] = []
        self.queries: List[tuple] = []
        self._news_ids: Dict[str, str] = {}
        self._id_seq = 0

    def mutator(self, convex_url: str, path: str, args: Dict[str, Any]) -> Any:
        assert "writeSecret" in args
        self.mutations.append((path, args))
        if path == "research_news:upsertItem":
            h = args["contentHash"]
            if h in self._news_ids:
                return {"id": self._news_ids[h], "created": False}
            self._id_seq += 1
            nid = f"news_{self._id_seq}"
            self._news_ids[h] = nid
            return {"id": nid, "created": True}
        if path == "research_ops:startIngestRun":
            return {"id": "run_doc", "created": True}
        if path == "research_ops:finishIngestRun":
            return {"id": "run_doc"}
        return {"ok": True}

    def querier(self, convex_url: str, path: str, args: Dict[str, Any]) -> Any:
        self.queries.append((path, args))
        return None


class WatchlistQuerier:
    def __init__(self, raw):
        self.raw = raw
        self.calls: List[tuple] = []

    def __call__(self, convex_url, path, args):
        self.calls.append((path, args))
        if path == "workspace_config:get":
            return {"configValue": self.raw}
        return None


def test_customer_branch_terms_each_known_branch_nonempty_other_empty():
    for branch in ("压铸", "模具", "五金", "冲压", "机加工", "钣金"):
        assert customer_branch_terms(branch), branch
    assert "die-casting" in customer_branch_terms("压铸")
    assert customer_branch_terms("其他") == []
    assert set(CUSTOMER_BRANCH_TERMS) == {
        "压铸", "模具", "五金", "冲压", "机加工", "钣金", "其他",
    }


def test_customer_spread_terms_dedupes_name_alias_branch():
    terms = customer_spread_terms(
        {"name": "铩硕精密", "aliases": ["SASO", "铩硕"], "downstreamBranch": "压铸"}
    )
    assert terms[0] == "铩硕精密"
    assert "SASO" in terms
    assert "铩硕" in terms
    assert "压铸" in terms
    assert terms.count("铩硕精密") == 1


def test_spread_feed_url_bing_and_google_quote_plus():
    assert spread_feed_url(["铩硕 精密", "压铸"], engine="bing") == (
        "https://www.bing.com/news/search?q=%E9%93%A9%E7%A1%95+%E7%B2%BE%E5%AF%86+%E5%8E%8B%E9%93%B8"
        "&format=rss&setlang=zh-hans"
    )
    assert "news.google.com/rss/search?q=" in spread_feed_url(["a"], engine="google")
    assert "hl=zh-CN" in spread_feed_url(["a"], engine="google")
    assert "setlang=zh-hans" in spread_feed_url(["a"], engine="bing")


def test_parse_customer_watchlist_skips_invalid_and_keeps_fields():
    raw = [
        {"name": "铩硕精密", "companyKey": "shuashuo", "downstreamBranch": "压铸", "status": "active"},
        {"name": "   ", "companyKey": "x"},
        "not-a-dict",
        {"name": "某公众号客户", "companyKey": "mp-cust", "downstreamBranch": "其他", "status": "needsTopic"},
    ]
    parsed = parse_customer_watchlist(raw)
    assert len(parsed) == 2
    assert parsed[0]["companyKey"] == "shuashuo"
    assert parsed[1]["status"] == "needsTopic"


def test_load_customer_watchlist_active_only_uses_right_config_key(monkeypatch):
    from unittest.mock import MagicMock
    from apps.worker import research_customer_spread as mod

    calls = []
    row = [
        {"name": "A客户", "companyKey": "a", "status": "active"},
        {"name": "B客户", "companyKey": "b", "status": "needsTopic"},
    ]

    def fake_convex_query(ctx_url, path, args):
        calls.append((path, args))
        return {"configValue": row}

    monkeypatch.setattr("apps.worker.research_convex.convex_query", fake_convex_query)
    entries = mod.load_customer_watchlist("https://example.convex.cloud", "hr")
    assert [e["companyKey"] for e in entries] == ["a"]
    assert calls[0][0] == "workspace_config:get"
    assert calls[0][1]["configKey"] == "research.customerWatchlist"


def test_build_customer_feeds_specific_plus_branch_feed_per_customer():
    entries = [
        {"companyKey": "shuashuo", "name": "铩硕精密", "aliases": ["SASO"], "downstreamBranch": "压铸"},
        {"companyKey": "customer-b", "name": "某客户", "aliases": [], "downstreamBranch": "其他"},
    ]
    feeds = build_customer_feeds(entries, engine="bing")
    ids = [f["id"] for f in feeds]
    # 压铸 customer → specific feed + first-branch-term feed (压铸)
    assert "watch-shuashuo" in ids
    assert any(i.startswith("watch-shuashuo-") for i in ids)
    # 其他 customer → specific feed only (no branch feed)
    assert "watch-customer-b" in ids
    assert not any(i.startswith("watch-customer-b-") for i in ids)
    specific = next(f for f in feeds if f["id"] == "watch-shuashuo")
    branch = next(f for f in feeds if f["id"].startswith("watch-shuashuo-"))
    assert specific["max_age_days"] == 7
    assert specific["engine"] == "bing"
    assert "setlang=zh-hans" in specific["url"]
    # branch feed query is the FIRST branch term alone (broad → dated news)
    assert "q=%E5%8E%8B%E9%93%B8&" in branch["url"]  # 压铸 single term


def test_research_ingest_job_iterates_customer_feeds_upserts_rss_watch():
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    items_by_feed = {
        "watch-shuashuo": [
            {
                "title": "铩硕精密智能压铸线投产",
                "url": "https://example.com/news/1",
                "guid": "g1",
                "published_at": 1000,
            }
        ],
    }

    class FeedRss(StaticRssPort):
        def fetch(self, feed_id: str, feed_url: str, captured_at: int):
            return StaticRssPort(items_by_feed=items_by_feed).fetch(feed_id, feed_url, captured_at)

    job = ResearchIngestJob(
        client=client,
        hotlist_port=StaticHotlistPort(items_by_platform={}),
        rss_port=FeedRss(),
        platforms=[],
        rss_feeds=[],
        customer_feeds=[
            {
                "id": "watch-shuashuo",
                "url": "https://www.bing.com/news/search?q=x&format=rss&setlang=zh-hans",
                "engine": "bing",
                "max_age_days": 7,
                "max_items": 40,
            }
        ],
        now_ms=lambda: 1000,
    )
    assert job.run() is True
    upserts = [a for p, a in rec.mutations if p == "research_news:upsertItem"]
    assert len(upserts) == 1
    assert upserts[0]["platform"] == "rss:watch-shuashuo"
    assert upserts[0]["sourceId"] == "watch-shuashuo"
    start = [a for p, a in rec.mutations if p == "research_ops:startIngestRun"][0]
    assert "rss:watch-shuashuo" in start["enabledPlatforms"]


def test_spread_engine_env_default_bing(monkeypatch):
    assert spread_engine() == "bing"
    monkeypatch.setenv("RESEARCH_CUSTOMER_SPREAD_ENGINE", "google")
    assert spread_engine() == "google"
    monkeypatch.setenv("RESEARCH_CUSTOMER_SPREAD_ENGINE", "bogus")
    assert spread_engine() == "bing"
