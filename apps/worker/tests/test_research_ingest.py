"""Unit tests for research ingest (PR2) — stable hash, direct Convex contracts, scheduler flag."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

from apps.worker.research_convex import ResearchConvexClient
from apps.worker.research_ingest import (
    ResearchIngestJob,
    legacy_trendradar_crawl_enabled,
    research_ingest_enabled,
    run_research_ingest,
)
from apps.worker.research_ports import (
    StaticHotlistPort,
    StaticRssPort,
    stable_content_hash,
)
from apps.worker.scheduler import WorkerScheduler


class RecordingConvex:
    """Fake Convex transport that records mutation/query paths (no BFF)."""

    def __init__(self, alias_map: Optional[Dict[str, Dict[str, Any]]] = None):
        self.mutations: List[tuple[str, Dict[str, Any]]] = []
        self.queries: List[tuple[str, Dict[str, Any]]] = []
        self.alias_map = alias_map or {}
        self._news_ids: Dict[str, str] = {}
        self._id_seq = 0

    def mutator(self, convex_url: str, path: str, args: Dict[str, Any]) -> Any:
        assert "/api/" not in path  # path is Convex function path, not HTTP
        assert "writeSecret" in args
        self.mutations.append((path, args))
        if path == "research_news:upsertItem":
            content_hash = args["contentHash"]
            if content_hash in self._news_ids:
                return {"id": self._news_ids[content_hash], "created": False}
            self._id_seq += 1
            nid = f"news_{self._id_seq}"
            self._news_ids[content_hash] = nid
            return {"id": nid, "created": True}
        if path == "research_signals:upsert":
            self._id_seq += 1
            return {"id": f"sig_{self._id_seq}", "created": True}
        if path == "research_ops:startIngestRun":
            return {"id": "run_doc", "created": True}
        if path == "research_ops:finishIngestRun":
            return {"id": "run_doc"}
        return {"ok": True}

    def querier(self, convex_url: str, path: str, args: Dict[str, Any]) -> Any:
        assert "writeSecret" in args
        self.queries.append((path, args))
        if path == "companies:resolveAlias":
            return self.alias_map.get(args.get("alias"))
        return None


def test_stable_content_hash_prefers_external_id():
    h1 = stable_content_hash(platform="weibo", title="A", external_id="x1")
    h2 = stable_content_hash(platform="weibo", title="B different", external_id="x1")
    assert h1 == h2
    h3 = stable_content_hash(platform="weibo", title="A", url="http://a")
    h4 = stable_content_hash(platform="weibo", title="A", url="http://a")
    assert h3 == h4
    assert h3 != h1


def test_research_convex_client_uses_direct_paths_not_bff():
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    client.upsert_news_item(
        {
            "sourceId": "weibo",
            "platform": "weibo",
            "title": "t",
            "contentHash": "h",
            "capturedAt": 1,
        }
    )
    client.start_ingest_run("run-1", 1, ["weibo"])
    paths = [p for p, _ in rec.mutations]
    assert "research_news:upsertItem" in paths
    assert "research_ops:startIngestRun" in paths
    # Ensure no accidental BFF-style paths
    for path, args in rec.mutations:
        assert not path.startswith("/api/")
        assert args["writeSecret"] == "secret"


def test_ingest_writes_news_and_finishes_run():
    rec = RecordingConvex(
        alias_map={"宝力机械": {"companyKey": "pro-technic-machinery", "displayName": "宝力机械"}}
    )
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    hotlist = StaticHotlistPort(
        items_by_platform={
            "weibo": [
                {"title": "宝力机械扩产", "external_id": "e1", "url": "http://x"},
            ]
        }
    )
    job = ResearchIngestJob(
        client=client,
        hotlist_port=hotlist,
        rss_port=StaticRssPort(),
        platforms=["weibo"],
        rss_feeds=[],
        now_ms=lambda: 1000,
    )
    ok = job.run()
    assert ok is True
    paths = [p for p, _ in rec.mutations]
    assert "research_ops:startIngestRun" in paths
    assert "research_news:upsertItem" in paths
    assert "research_ops:finishIngestRun" in paths
    finish = [a for p, a in rec.mutations if p == "research_ops:finishIngestRun"][0]
    assert finish["status"] == "success"
    assert finish["newsInserted"] == 1


def test_research_ingest_enabled_flag():
    assert research_ingest_enabled({"RESEARCH_INGEST_ENABLED": "1"}) is True
    assert research_ingest_enabled({"RESEARCH_INGEST_ENABLED": "true"}) is True
    assert research_ingest_enabled({}) is False
    assert research_ingest_enabled({"RESEARCH_INGEST_ENABLED": "0"}) is False


def test_legacy_crawl_flag_defaults_off():
    assert legacy_trendradar_crawl_enabled({}) is False
    assert legacy_trendradar_crawl_enabled({"LEGACY_TRENDRADAR_CRAWL": "1"}) is True


def test_run_research_ingest_respects_enable_gate():
    with patch.dict("os.environ", {"RESEARCH_INGEST_ENABLED": ""}, clear=False):
        # When disabled, returns True without calling Convex
        assert run_research_ingest() is True


def test_scheduler_registers_research_job_when_enabled():
    with patch.dict("os.environ", {"RESEARCH_INGEST_ENABLED": "1"}, clear=False):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.interval_minutes = 30
        s.cron_expression = None
        s.config_overrides = {}
        s.scheduler = MagicMock()
        s.add_research_ingest_job()
        s.scheduler.add_job.assert_called_once()
        kwargs = s.scheduler.add_job.call_args
        assert kwargs.kwargs.get("id") == "research_ingest" or (
            len(kwargs.args) >= 1 and kwargs.kwargs.get("id") == "research_ingest"
        )
        # id is keyword
        assert kwargs.kwargs["id"] == "research_ingest"


def test_scheduler_skips_research_job_when_disabled():
    with patch.dict("os.environ", {"RESEARCH_INGEST_ENABLED": "0"}, clear=False):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.interval_minutes = 30
        s.cron_expression = None
        s.config_overrides = {}
        s.scheduler = MagicMock()
        s.add_research_ingest_job()
        s.scheduler.add_job.assert_not_called()
