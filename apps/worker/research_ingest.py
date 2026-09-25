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
from apps.worker.research_customer_spread import (
    build_customer_feeds,
    load_customer_watchlist,
)
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


def spread_engine(env: Optional[Dict[str, str]] = None) -> str:
    """Customer-watchlist spread RSS engine. Default 'bing' (no socks tunnel needed);
    'google' rides the RESEARCH_GNEWS_SOCKS_PROXY egress via the gnews-* routing.
    Controlled by RESEARCH_CUSTOMER_SPREAD_ENGINE in {bing, google}."""
    source = env if env is not None else os.environ
    value = str(source.get("RESEARCH_CUSTOMER_SPREAD_ENGINE", "")).strip().lower()
    return value if value in {"bing", "google"} else "bing"


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


def default_mp_connectors_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "research-mp-connectors.yaml"


def load_mp_connector_feeds(connectors_path: Optional[Path] = None) -> List[Dict[str, str]]:
    """Opt-in mp (公众号 → RSS) connector feeds from the static catalog.

    NOT a plugin runtime: this only reads `config/research-mp-connectors.yaml`
    and returns feeds from plugins the operator explicitly set `enabled: true`.

    Rules (fail-safe, no network, no sidecar contact):
      - plugin `enabled` must be exactly True (truthy is not enough) to be considered;
      - a plugin with `status: archived` is skipped unconditionally (error log only
        when someone actually enabled it) — e.g. `wewe-rss`;
      - `enabled: true` + a non-empty `url` → feed included;
      - `enabled: true` + empty/missing `url` → HARD SKIP with an error log; the
        feed id is never returned, so it can never reach HttpRssPort.

    Platform derivation (`rss:{id}`) stays in `research_ports.parse_rss_xml` /
    `ResearchIngestJob.run` — this function returns plain `{id, url}` feeds.
    """
    path = connectors_path or default_mp_connectors_path()
    if not path.is_file():
        return []
    try:
        with open(path, encoding="utf-8") as handle:
            catalog = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError) as error:
        logger.warning("Failed to load mp connector catalog: %s", error)
        return []

    plugins = catalog.get("plugins") or []
    if not isinstance(plugins, list):
        logger.warning("mp connector catalog `plugins` is not a list; ignoring")
        return []

    feeds: List[Dict[str, str]] = []
    for plugin in plugins:
        if not isinstance(plugin, dict):
            continue
        plugin_id = str(plugin.get("id") or "unknown")
        enabled = plugin.get("enabled") is True
        if str(plugin.get("status") or "").strip().lower() == "archived":
            # Refuse archived connectors outright. Only log loudly when someone
            # actually enabled one — a disabled archived entry is expected state
            # and would otherwise log an error on every ingest cycle.
            if enabled:
                logger.error(
                    "mp connector %s is archived; refusing to ingest its feeds", plugin_id
                )
            continue
        if not enabled:
            continue
        raw_feeds = plugin.get("feeds") or []
        if not isinstance(raw_feeds, list):
            continue
        for feed in raw_feeds:
            if not isinstance(feed, dict):
                continue
            feed_id = feed.get("id")
            if not feed_id:
                continue
            url = str(feed.get("url") or "").strip()
            if not url:
                logger.error(
                    "mp connector %s feed %s is enabled but has no url; skipping",
                    plugin_id,
                    feed_id,
                )
                continue
            feeds.append({"id": str(feed_id), "url": url})
    return feeds


def load_rss_feeds(
    config_path: Optional[Path] = None,
    connectors_path: Optional[Path] = None,
) -> List[Dict[str, str]]:
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
            entry: Dict[str, Any] = {"id": str(feed_id), "url": str(url)}
            mad = source.get("max_age_days")
            if isinstance(mad, (int, float)) and mad:
                entry["max_age_days"] = int(mad)
            feeds.append(entry)

    # Opt-in mp connector feeds merge AFTER config.yaml rss.feeds. The shipped
    # catalog has every plugin disabled (and every url empty), so the default
    # adds zero feeds; an operator opts in per the runbook.
    seen_ids = {feed["id"] for feed in feeds}
    for feed in load_mp_connector_feeds(connectors_path):
        if feed["id"] in seen_ids:
            logger.warning("mp connector feed %s duplicates an rss.feeds id; skipping", feed["id"])
            continue
        seen_ids.add(feed["id"])
        feeds.append(feed)

    # Networked opt-in/out: filter catalog feed ids (gnews-*/bing-*) by the workspace
    # `research.enabledNewsSources` overlay. Non-catalog feeds are untouched.
    try:
        feeds = _filter_feeds_by_news_sources(feeds)
    except Exception as error:  # noqa: BLE001 — fail-open, never fail ingest
        logger.warning("[ResearchIngest] news-sources overlay filter skipped: %s", error)
    return feeds


def _filter_feeds_by_news_sources(feeds: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Drop catalog feed ids not in the effective news-sources set; keep non-catalog.

    Reads the workspace overlay via Convex `workspace_config:get` (no writeSecret).
    Convex unavailable / no row => seed defaults (all ON). Fail-open.
    """
    from apps.worker.research_convex import resolve_convex_url, convex_query
    from apps.worker.research_news_sources import (
        catalog_feed_ids,
        empty_news_sources_workspace,
        load_news_sources_seed,
        merge_news_sources,
        parse_news_sources_workspace,
    )

    seed = load_news_sources_seed()
    catalog = set(catalog_feed_ids(seed))
    workspace = empty_news_sources_workspace()
    try:
        ctx_url = resolve_convex_url()
        if not ctx_url:
            raise RuntimeError("no convex url")
        workspace_slug = (os.environ.get("WORKSPACE_SLUG") or "hr").strip() or "hr"
        row = convex_query(
            ctx_url,
            "workspace_config:get",
            {"workspaceSlug": workspace_slug, "configKey": "research.enabledNewsSources"},
        )
        raw = row.get("configValue") if isinstance(row, dict) else None
        workspace = parse_news_sources_workspace(raw)
    except Exception as error:  # noqa: BLE001 — Convex down -> all ON
        workspace = empty_news_sources_workspace()
        logger.debug("[ResearchIngest] news-sources overlay unavailable; using defaults: %s", error)

    effective = set(merge_news_sources(seed, workspace))
    filtered = [f for f in feeds if f["id"] not in catalog or f["id"] in effective]
    dropped = [f["id"] for f in feeds if f["id"] in catalog and f["id"] not in effective]
    if dropped:
        logger.info("[ResearchIngest] news-sources opt-out dropped %d catalog feeds: %s", len(dropped), dropped)
    return filtered


class ResearchIngestJob:
    def __init__(
        self,
        client: Optional[ResearchConvexClient] = None,
        hotlist_port: Optional[HotlistPort] = None,
        rss_port: Optional[RssPort] = None,
        platforms: Optional[Sequence[str]] = None,
        rss_feeds: Optional[Sequence[Dict[str, str]]] = None,
        customer_feeds: Optional[Sequence[Dict[str, Any]]] = None,
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
        self.rss_port = rss_port or HttpRssPort(
            socks_proxy=(os.environ.get("RESEARCH_GNEWS_SOCKS_PROXY") or "").strip() or None,
        )
        self.platforms = list(platforms) if platforms is not None else load_enabled_platforms()
        self.rss_feeds = list(rss_feeds) if rss_feeds is not None else load_rss_feeds()
        # Customer-watchlist spread feeds (客户监控 → 扩散). Chained after the
        # static RSS feeds so the daily-report corpus also receives watchlist rows.
        if customer_feeds is not None:
            self.customer_feeds = [dict(f) for f in customer_feeds]
        else:
            self.customer_feeds = []
            if self.client.convex_url:
                try:
                    ctx_url = self.client.convex_url
                    workspace_slug = (os.environ.get("WORKSPACE_SLUG") or "hr").strip() or "hr"
                    watch = load_customer_watchlist(ctx_url, workspace_slug)
                    self.customer_feeds = build_customer_feeds(watch, engine=spread_engine())
                except Exception as error:  # noqa: BLE001 — never break ingest on spread setup
                    logger.warning("[ResearchIngest] customer spread feed build failed: %s", error)
        self.now_ms: Callable[[], int] = now_ms or (lambda: int(time.time() * 1000))

    def run(self, config_overrides: Optional[Dict[str, Any]] = None) -> bool:
        """
        Full ingest cycle. Returns True on success.
        Direct Convex writes only — no BFF.
        """
        _ = config_overrides
        run_id = f"research-{uuid.uuid4().hex[:12]}"
        started_at = self.now_ms()
        enabled = (
            list(self.platforms)
            + [f"rss:{f['id']}" for f in self.rss_feeds]
            + [f"rss:{f['id']}" for f in self.customer_feeds]
        )

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
                    # Per-feed publish-age gate (max_age_days from config rss.feeds):
                    # dropped at Fetch so evergreen SEO rows never reach Convex.
                    feed_max_age = feed.get("max_age_days")
                    feed_max_age_int = (
                        int(feed_max_age) if isinstance(feed_max_age, (int, float)) and feed_max_age else None
                    )
                    # Route gnews-* feeds through the socks tunnel so Google's
                    # 503-region block doesn't drop today's real items at ingest.
                    feed_id = feed["id"]
                    use_socks = str(feed_id).startswith("gnews-")
                    items = self.rss_port.fetch(
                        feed_id,
                        feed["url"],
                        started_at,
                    ) if not use_socks else self.rss_port._normalized_items_with_proxy(
                        feed_id,
                        feed["url"],
                        started_at,
                    )
                    if feed_max_age_int is not None:
                        items = [
                            it
                            for it in items
                            if not (
                                it.published_at is not None
                                and it.published_at < started_at - feed_max_age_int * 86_400_000
                            )
                        ]
                    collected.extend(items)
                except Exception as error:  # noqa: BLE001 — soft-fail per feed
                    logger.warning(
                        "[ResearchIngest] rss %s failed: %s",
                        feed.get("id"),
                        error,
                    )

            # Customer-watchlist spread feeds (客户监控 → 扩散): same RSS loop, same
            # soft-fail + publish-age + socks routing as the static feeds, so watchlist
            # rows land in news_items under `rss:watch-<companyKey>` and reach the
            # daily-report corpus. Default Bing engine needs no tunnel.
            for feed in self.customer_feeds:
                try:
                    feed_max_age = feed.get("max_age_days")
                    feed_max_age_int = (
                        int(feed_max_age) if isinstance(feed_max_age, (int, float)) and feed_max_age else None
                    )
                    feed_id = feed["id"]
                    use_socks = str(feed_id).startswith("watch-gnews-") or str(feed.get("engine")) == "google"
                    items = self.rss_port.fetch(
                        feed_id,
                        feed["url"],
                        started_at,
                    ) if not use_socks else self.rss_port._normalized_items_with_proxy(
                        feed_id,
                        feed["url"],
                        started_at,
                    )
                    per_cap = int(feed.get("max_items") or 0) or DEFAULT_RSS_MAX_ITEMS_PER_FEED
                    if per_cap:
                        items = items[:per_cap]
                    if feed_max_age_int is not None:
                        items = [
                            it
                            for it in items
                            if not (
                                it.published_at is not None
                                and it.published_at < started_at - feed_max_age_int * 86_400_000
                            )
                        ]
                    collected.extend(items)
                except Exception as error:  # noqa: BLE001 — soft-fail per customer feed
                    logger.warning(
                        "[ResearchIngest] customer spread %s failed: %s",
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
                        promote_research_unresolved_to_proposals,
                        samples_from_unresolved_items,
                    )

                    samples = samples_from_unresolved_items(unresolved_items)
                    promoted = promote_research_unresolved_to_proposals(
                        self.client,
                        samples,
                    )
                    if promoted:
                        logger.info(
                            "[ResearchIngest] promoted %s unresolved employer surfaces "
                            "to governed proposals",
                            promoted,
                        )
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
    "load_mp_connector_feeds",
    "default_mp_connectors_path",
    "StaticHotlistPort",
    "StaticRssPort",
]
