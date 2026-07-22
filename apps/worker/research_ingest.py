# coding=utf-8
"""
Research Eng ingest orchestration: fetch → upsert news → project signals → Convex.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

import yaml

from apps.worker.research_convex import ResearchConvexClient
from apps.worker.research_industry_bridge import IndustryBridgeResolver
from apps.worker.research_ports import (
    HttpHotlistPort,
    HttpRssPort,
    HotlistPort,
    NewsNowHotlistPort,
    NormalizedNewsItem,
    RssPort,
    StaticHotlistPort,
    StaticRssPort,
    resolve_newsnow_api_url,
    resolve_newsnow_proxy_url,
)
from apps.worker.research_project import project_signals_for_items

logger = logging.getLogger(__name__)


def research_ingest_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    source = env if env is not None else os.environ
    value = str(source.get("RESEARCH_INGEST_ENABLED", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


def legacy_trendradar_crawl_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    source = env if env is not None else os.environ
    value = str(source.get("LEGACY_TRENDRADAR_CRAWL", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


def load_enabled_platforms(config_path: Optional[Path] = None) -> List[str]:
    path = config_path or Path(__file__).resolve().parents[2] / "config" / "config.yaml"
    if not path.is_file():
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError) as error:
        logger.warning("Failed to load config for research platforms: %s", error)
        return []

    platforms_cfg = config.get("platforms") or {}
    if not platforms_cfg.get("enabled", True):
        return []
    sources = platforms_cfg.get("sources") or []
    return [str(s["id"]) for s in sources if isinstance(s, dict) and s.get("id")]


def load_rss_feeds(config_path: Optional[Path] = None) -> List[Dict[str, str]]:
    path = config_path or Path(__file__).resolve().parents[2] / "config" / "config.yaml"
    if not path.is_file():
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError) as error:
        logger.warning("Failed to load config for research RSS: %s", error)
        return []

    rss_cfg = config.get("rss") or {}
    if not rss_cfg.get("enabled", True):
        return []
    feeds = []
    # config/config.yaml uses `feeds`; accept legacy `sources` as alias
    raw_list = rss_cfg.get("feeds") or rss_cfg.get("sources") or []
    for source in raw_list:
        if not isinstance(source, dict):
            continue
        if source.get("enabled") is False:
            continue
        feed_id = source.get("id")
        url = source.get("url")
        if feed_id and url:
            feeds.append({"id": str(feed_id), "url": str(url)})
    return feeds


class ResearchIngestJob:
    def __init__(
        self,
        client: Optional[ResearchConvexClient] = None,
        hotlist_port: Optional[HotlistPort] = None,
        rss_port: Optional[RssPort] = None,
        platforms: Optional[Sequence[str]] = None,
        rss_feeds: Optional[Sequence[Dict[str, str]]] = None,
        now_ms: Optional[Callable[[], int]] = None,
    ):
        self.client = client or ResearchConvexClient()
        if hotlist_port is not None:
            self.hotlist_port = hotlist_port
        else:
            api_url = resolve_newsnow_api_url()
            proxy_url = resolve_newsnow_proxy_url()
            base_url = (os.environ.get("RESEARCH_HOTLIST_BASE_URL") or "").strip() or None
            # Prefer NewsNow-compatible API; path-style BASE_URL only when API unset
            if api_url or not base_url:
                self.hotlist_port = NewsNowHotlistPort(
                    api_url=api_url,
                    proxy_url=proxy_url,
                )
            else:
                self.hotlist_port = HttpHotlistPort(base_url=base_url)
        self.rss_port = rss_port or HttpRssPort()
        self.platforms = list(platforms) if platforms is not None else load_enabled_platforms()
        self.rss_feeds = list(rss_feeds) if rss_feeds is not None else load_rss_feeds()
        self.now_ms: Callable[[], int] = now_ms or (lambda: int(time.time() * 1000))

    def run(self, config_overrides: Optional[Dict[str, Any]] = None) -> bool:
        """
        Full ingest cycle. Returns True on success.
        Direct Convex writes only — no BFF.
        """
        _ = config_overrides
        run_id = f"research-{uuid.uuid4().hex[:12]}"
        started_at = self.now_ms()
        enabled = list(self.platforms) + [f"rss:{f['id']}" for f in self.rss_feeds]

        try:
            self.client.start_ingest_run(run_id, started_at, enabled)
        except Exception as error:  # noqa: BLE001
            logger.error("[ResearchIngest] start_ingest_run failed: %s", error)
            return False

        news_inserted = 0
        news_updated = 0
        signals_inserted = 0
        unresolved = 0
        collected: List[NormalizedNewsItem] = []
        news_item_ids: Dict[str, str] = {}

        try:
            for platform_id in self.platforms:
                try:
                    items = self.hotlist_port.fetch(platform_id, started_at)
                    collected.extend(items)
                except Exception as error:  # noqa: BLE001 — soft-fail per platform
                    logger.warning(
                        "[ResearchIngest] hotlist %s failed: %s",
                        platform_id,
                        error,
                    )

            for feed in self.rss_feeds:
                try:
                    items = self.rss_port.fetch(feed["id"], feed["url"], started_at)
                    collected.extend(items)
                except Exception as error:  # noqa: BLE001 — soft-fail per feed
                    logger.warning(
                        "[ResearchIngest] rss %s failed: %s",
                        feed.get("id"),
                        error,
                    )

            for item in collected:
                result = self.client.upsert_news_item(item.to_convex_args())
                if result and result.get("created"):
                    news_inserted += 1
                else:
                    news_updated += 1
                if result and result.get("id"):
                    news_item_ids[item.content_hash] = result["id"]

            # C: industry-data resolveEntity surface first, then K3 resolveAlias fallback
            resolver = IndustryBridgeResolver(fallback=self.client)
            drafts, unresolved, unresolved_items = project_signals_for_items(
                collected,
                resolver,
                ingest_run_id=run_id,
                news_item_ids=news_item_ids,
            )
            for draft in drafts:
                sig_result = self.client.upsert_signal(draft.to_convex_args())
                if sig_result and sig_result.get("created", True):
                    signals_inserted += 1

            if unresolved_items:
                try:
                    from apps.worker.research_unresolved import (
                        append_research_unresolved_to_queue,
                        samples_from_unresolved_items,
                    )

                    samples = samples_from_unresolved_items(unresolved_items)
                    appended = append_research_unresolved_to_queue(
                        Path(__file__).resolve().parents[2],
                        samples,
                    )
                    if appended:
                        logger.info(
                            "[ResearchIngest] appended %s unresolved samples to industry queue",
                            appended,
                        )
                except Exception as queue_error:  # noqa: BLE001 — soft-fail steward path
                    logger.warning(
                        "[ResearchIngest] unresolved queue append failed: %s",
                        queue_error,
                    )

            self.client.finish_ingest_run(
                run_id,
                self.now_ms(),
                "success",
                news_inserted=news_inserted,
                news_updated=news_updated,
                signals_inserted=signals_inserted,
                unresolved_mentions=unresolved,
            )
            logger.info(
                "[ResearchIngest] success run=%s news+%s/~%s signals+%s unresolved=%s",
                run_id,
                news_inserted,
                news_updated,
                signals_inserted,
                unresolved,
            )
            return True
        except Exception as error:  # noqa: BLE001
            logger.error("[ResearchIngest] failed run=%s: %s", run_id, error)
            try:
                self.client.finish_ingest_run(
                    run_id,
                    self.now_ms(),
                    "failed",
                    news_inserted=news_inserted,
                    news_updated=news_updated,
                    signals_inserted=signals_inserted,
                    unresolved_mentions=unresolved,
                    error=str(error),
                )
            except Exception as finish_error:  # noqa: BLE001
                logger.error("[ResearchIngest] finish failed: %s", finish_error)
            return False


def run_research_ingest(config_overrides: Optional[Dict[str, Any]] = None) -> bool:
    """Entry point for scheduler / operator trigger.

    When config_overrides contains platforms (list), that list is used instead of
    config/config.yaml platforms.sources. Missing key → YAML fallback.
    Empty list is valid (no hotlist platforms this run).
    """
    if not research_ingest_enabled():
        logger.info("[ResearchIngest] skipped — RESEARCH_INGEST_ENABLED not set")
        return True
    overrides = config_overrides or {}
    job_kwargs: Dict[str, Any] = {}
    if "platforms" in overrides and isinstance(overrides["platforms"], (list, tuple)):
        job_kwargs["platforms"] = [
            str(p).strip() for p in overrides["platforms"] if str(p).strip()
        ]
    job = ResearchIngestJob(**job_kwargs)
    return job.run(config_overrides=overrides)


# Re-export static ports for tests
__all__ = [
    "ResearchIngestJob",
    "run_research_ingest",
    "research_ingest_enabled",
    "legacy_trendradar_crawl_enabled",
    "load_enabled_platforms",
    "load_rss_feeds",
    "StaticHotlistPort",
    "StaticRssPort",
]
