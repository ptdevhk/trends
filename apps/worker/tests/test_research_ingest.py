"""Unit tests for research ingest (PR2) — stable hash, direct Convex contracts, scheduler flag."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest
import yaml

from apps.worker.research_convex import ResearchConvexClient
from apps.worker.research_ingest import (
    ResearchIngestJob,
    legacy_trendradar_crawl_enabled,
    load_mp_connector_feeds,
    load_rss_feeds,
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


def test_research_ingest_job_wires_api_url_and_proxy_from_env(monkeypatch):
    """Shipped ResearchIngestJob constructor applies RESEARCH_HOTLIST_* env to NewsNow port."""
    from apps.worker.research_ports import NewsNowHotlistPort

    monkeypatch.setenv("RESEARCH_HOTLIST_API_URL", "https://alt.example/api/s")
    monkeypatch.setenv("RESEARCH_HOTLIST_PROXY_URL", "http://proxy.local:8080")
    monkeypatch.delenv("RESEARCH_HOTLIST_BASE_URL", raising=False)

    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    job = ResearchIngestJob(
        client=client,
        platforms=[],
        rss_feeds=[],
        now_ms=lambda: 1,
    )
    assert isinstance(job.hotlist_port, NewsNowHotlistPort)
    assert job.hotlist_port.api_url == "https://alt.example/api/s"
    assert job.hotlist_port.proxy_url == "http://proxy.local:8080"


def test_ingest_continues_when_one_platform_raises():
    """Soft-fail: one platform raises, another still upserts news."""
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )

    class MixedHotlist:
        def fetch(self, platform_id: str, captured_at: int):
            if platform_id == "bad":
                raise RuntimeError("upstream")
            return StaticHotlistPort(
                items_by_platform={
                    "weibo": [{"title": "ok title", "external_id": "e-ok", "url": "http://ok"}],
                }
            ).fetch(platform_id, captured_at)

    job = ResearchIngestJob(
        client=client,
        hotlist_port=MixedHotlist(),
        rss_port=StaticRssPort(),
        platforms=["bad", "weibo"],
        rss_feeds=[],
        now_ms=lambda: 1000,
    )
    ok = job.run()
    assert ok is True
    paths = [p for p, _ in rec.mutations]
    assert "research_news:upsertItem" in paths
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


def test_run_research_ingest_builds_job_with_override_platforms(monkeypatch):
    """config_overrides platforms list is passed into ResearchIngestJob."""
    seen: Dict[str, Any] = {}

    class CaptureJob:
        def __init__(self, **kwargs):
            seen["platforms"] = kwargs.get("platforms")

        def run(self, config_overrides=None):
            seen["config_overrides"] = config_overrides
            return True

    monkeypatch.setenv("RESEARCH_INGEST_ENABLED", "1")
    monkeypatch.setattr("apps.worker.research_ingest.ResearchIngestJob", CaptureJob)
    assert run_research_ingest({"platforms": ["cls-hot", "weibo"]}) is True
    assert seen["platforms"] == ["cls-hot", "weibo"]


def test_ingest_job_fetches_only_constructor_platforms():
    """Platforms list on the job limits which hotlist sources are fetched."""
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    fetched: List[str] = []

    class TrackingHotlist:
        def fetch(self, platform_id: str, captured_at: int):
            fetched.append(platform_id)
            return StaticHotlistPort(
                items_by_platform={
                    "weibo": [{"title": "w", "external_id": "w1", "url": "https://weibo.com/1"}],
                    "zhihu": [{"title": "z", "external_id": "z1", "url": "https://zhihu.com/1"}],
                }
            ).fetch(platform_id, captured_at)

    job = ResearchIngestJob(
        client=client,
        hotlist_port=TrackingHotlist(),
        rss_port=StaticRssPort(),
        platforms=["weibo"],
        rss_feeds=[],
        now_ms=lambda: 1000,
    )
    assert job.run() is True
    assert fetched == ["weibo"]
    titles = [a["title"] for p, a in rec.mutations if p == "research_news:upsertItem"]
    assert titles == ["w"]


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


def test_load_rss_feeds_reads_feeds_key():
    """config.yaml uses rss.feeds (not sources); must load CNC Google News feeds."""
    from apps.worker.research_ingest import load_rss_feeds
    feeds = load_rss_feeds()
    ids = {f["id"] for f in feeds}
    assert "gnews-fanuc-cn" in ids
    assert all("url" in f for f in feeds)


def test_load_rss_feeds_gnews_lab_stubs_enablement():
    """gnews hit-rate lab stubs (docs/runbooks/research-gnews-hitrate-lab.md):
    the three on-topic candidates (创世纪机床/乔锋机床/压铸) are enabled so 订阅
    can lift without WeChat, so load_rss_feeds() MUST return them. The homonym/
    noise stubs (gnews-baoli, gnews-polywell) stay disabled and MUST stay absent.
    """
    ids = {f["id"] for f in load_rss_feeds()}
    assert "gnews-fanuc-cn" in ids
    # on-topic trio enabled -> present
    for lab_id in ("gnews-genesis", "gnews-qiaofeng", "gnews-diecast"):
        assert lab_id in ids, lab_id
    # homonym/noise stubs stay disabled -> absent
    for lab_id in ("gnews-baoli", "gnews-polywell"):
        assert lab_id not in ids, lab_id
    # no werss-* ids leak through
    assert not any(fid.startswith("werss-") for fid in ids)


def test_load_rss_feeds_phase_b_werss_stubs_stay_commented():
    """Phase B WeRSS stubs in config.yaml must stay commented out until an operator
    stands up the sidecar. If they were live, ingest would dial 127.0.0.1 every
    cycle and soft-fail per feed; if they were live under a bare `werss-*` id they
    would also leak into the titled 综合热榜 (platform would not be `rss:`-prefixed).
    """
    from apps.worker.research_ingest import ResearchIngestJob, load_rss_feeds

    feeds = load_rss_feeds()
    ids = {f["id"] for f in feeds}
    assert "werss-cnc-diecast" not in ids
    assert "werss-machine-tool" not in ids
    assert not any(fid.startswith("werss-") for fid in ids)

    # When an operator uncomments them, the configured id must be `werss-<mp_id>`
    # so the derived platform is `rss:werss-<mp_id>` (see test_parse_rss_xml_
    # werss_platform_derivation and isHotlistPlatform).
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    job = ResearchIngestJob(
        client=client,
        hotlist_port=StaticHotlistPort(items_by_platform={}),
        rss_port=StaticRssPort(),
        platforms=[],
        rss_feeds=[
            {"id": "werss-cnc-diecast", "url": "http://127.0.0.1:8000/feeds/mp1.xml"},
        ],
        now_ms=lambda: 1,
    )
    assert job.run() is True
    start = [a for p, a in rec.mutations if p == "research_ops:startIngestRun"][0]
    assert "rss:werss-cnc-diecast" in start["enabledPlatforms"]
    assert "werss-cnc-diecast" not in start["enabledPlatforms"]


def _write_catalog(plugins: List[Dict[str, Any]], tmp_path: Path) -> Path:
    path = tmp_path / "research-mp-connectors.yaml"
    path.write_text(yaml.safe_dump({"plugins": plugins}, allow_unicode=True), encoding="utf-8")
    return path


def test_connector_feed_id_derives_rss_platform_at_job_level():
    """An enabled connector feed reaches enabledPlatforms as `rss:<id>`, never bare."""
    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    job = ResearchIngestJob(
        client=client,
        hotlist_port=StaticHotlistPort(items_by_platform={}),
        rss_port=StaticRssPort(),
        platforms=[],
        rss_feeds=[{"id": "mp2rss-cnc-diecast", "url": "https://mp.example/feeds/mp1.xml"}],
        now_ms=lambda: 1,
    )
    assert job.run() is True
    start = [a for p, a in rec.mutations if p == "research_ops:startIngestRun"][0]
    assert "rss:mp2rss-cnc-diecast" in start["enabledPlatforms"]
    assert "mp2rss-cnc-diecast" not in start["enabledPlatforms"]


def test_load_mp_connector_feeds_default_catalog_adds_zero_feeds():
    """Shipped catalog: every plugin disabled + urls empty → zero extra feeds."""
    feeds = load_mp_connector_feeds()
    ids = {f["id"] for f in feeds}
    assert ids == set()
    assert not any("werss-" in i or "wechat2rss-" in i or "mp2rss-" in i for i in ids)
    assert not any("wewe" in i for i in ids)


def test_load_rss_feeds_default_shipped_catalog_adds_zero_extra_ids():
    """End-to-end default: config.yaml feeds only; the shipped catalog adds nothing."""
    ids = {f["id"] for f in load_rss_feeds()}
    assert "gnews-fanuc-cn" in ids
    assert not any(
        i.startswith(("werss-", "wechat2rss-", "mp2rss-", "wewe-")) for i in ids
    )


def test_load_rss_feeds_merges_enabled_connector_after_config_yaml(tmp_path):
    """With a real config.yaml stub + an enabled mp2rss plugin + a URL, the feed is merged."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump(
            {
                "rss": {
                    "enabled": True,
                    "feeds": [{"id": "gnews-fanuc-cn", "url": "https://g.example/rss"}],
                }
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    catalog = _write_catalog(
        [
            {
                "id": "mp2rss",
                "kind": "saas",
                "enabled": True,
                "feeds": [
                    {"id": "mp2rss-cnc-diecast", "url": "https://mp.example/feeds/mp1.xml"}
                ],
            }
        ],
        tmp_path,
    )
    feeds = load_rss_feeds(config_path=cfg, connectors_path=catalog)
    ids = [f["id"] for f in feeds]
    assert "gnews-fanuc-cn" in ids
    assert "mp2rss-cnc-diecast" in ids
    # Connector feeds merge AFTER config.yaml rss.feeds.
    assert ids.index("mp2rss-cnc-diecast") > ids.index("gnews-fanuc-cn")


def test_load_rss_feeds_enabled_connector_without_url_never_reaches_rss_port(tmp_path):
    """An enabled-but-URL-less connector feed must not appear in the job's feed list."""
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        yaml.safe_dump({"rss": {"enabled": True, "feeds": []}}, allow_unicode=True),
        encoding="utf-8",
    )
    catalog = _write_catalog(
        [{"id": "mp2rss", "enabled": True, "feeds": [{"id": "mp2rss-cnc-diecast", "url": ""}]}],
        tmp_path,
    )
    feeds = load_rss_feeds(config_path=cfg, connectors_path=catalog)
    assert feeds == []

    # End-to-end: the job never calls the RSS port for that id.
    fetched: List[str] = []

    class RecordingRss:
        def fetch(self, feed_id: str, feed_url: str, captured_at: int):
            fetched.append(feed_id)
            return []

    rec = RecordingConvex()
    client = ResearchConvexClient(
        convex_url="https://example.convex.cloud",
        write_secret="secret",
        mutator=rec.mutator,
        querier=rec.querier,
    )
    job = ResearchIngestJob(
        client=client,
        hotlist_port=StaticHotlistPort(items_by_platform={}),
        rss_port=RecordingRss(),
        platforms=[],
        rss_feeds=feeds,
        now_ms=lambda: 1,
    )
    assert job.run() is True
    assert fetched == []
    start = [a for p, a in rec.mutations if p == "research_ops:startIngestRun"][0]
    assert not any("mp2rss" in p for p in start["enabledPlatforms"])


def test_load_mp_connector_feeds_enabled_but_empty_url_excluded_and_error(tmp_path, caplog):
    """Enabled plugin + empty/missing url → HARD SKIP (excluded) with an error log."""
    catalog = _write_catalog(
        [
            {
                "id": "mp2rss",
                "enabled": True,
                "feeds": [{"id": "mp2rss-cnc-diecast", "url": ""}],
            }
        ],
        tmp_path,
    )
    with caplog.at_level("ERROR", logger="apps.worker.research_ingest"):
        feeds = load_mp_connector_feeds(catalog)
    ids = {f["id"] for f in feeds}
    assert "mp2rss-cnc-diecast" not in ids
    assert any("enabled but has no url" in r.message for r in caplog.records)


def test_load_mp_connector_feeds_wewe_rss_never_ingested(tmp_path, caplog):
    """wewe-rss (archived) is refused even if someone flips enabled to true."""
    catalog = _write_catalog(
        [
            {
                "id": "wewe-rss",
                "status": "archived",
                "enabled": True,
                "feeds": [
                    {"id": "wewe-rss-cnc-diecast", "url": "https://w.example/feeds/mp1.xml"}
                ],
            }
        ],
        tmp_path,
    )
    with caplog.at_level("ERROR", logger="apps.worker.research_ingest"):
        feeds = load_mp_connector_feeds(catalog)
    ids = {f["id"] for f in feeds}
    assert "wewe-rss-cnc-diecast" not in ids
    assert any("archived" in r.message for r in caplog.records)
