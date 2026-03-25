# coding=utf-8
"""
TrendRadar Worker - Scheduled task definitions

This module defines the tasks that can be scheduled by the worker.
Each task is a self-contained unit of work that can be executed
independently.
"""

import logging
import os
import sys
import traceback
import json
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from apps.worker.timezone import resolve_worker_timezone
from trendradar.utils.time import get_configured_time

logger = logging.getLogger(__name__)


def run_crawl_analyze(config_overrides: Optional[Dict[str, Any]] = None) -> bool:
    """
    Execute a full crawl and analyze cycle.

    This is the main scheduled task that:
    1. Loads configuration (with optional overrides)
    2. Creates a NewsAnalyzer instance
    3. Runs the full crawl -> store -> analyze -> report -> notify pipeline

    Args:
        config_overrides: Optional dictionary of config values to override

    Returns:
        True if the task completed successfully, False otherwise
    """
    timezone = resolve_worker_timezone()
    start_time = get_configured_time(timezone)
    logger.info(f"[Task] Starting crawl_analyze at {start_time.isoformat()}")

    try:
        # Import here to avoid circular imports and ensure fresh config each run
        from trendradar.core import load_config
        from trendradar.__main__ import NewsAnalyzer

        os.environ.setdefault("SKIP_ROOT_INDEX", "true")

        # Load configuration
        config = load_config()

        # Apply any overrides
        if config_overrides:
            for key, value in config_overrides.items():
                if isinstance(value, dict) and key in config:
                    config[key].update(value)
                else:
                    config[key] = value
            logger.debug(f"[Task] Applied config overrides: {list(config_overrides.keys())}")

        # Create and run analyzer
        analyzer = NewsAnalyzer(config=config)
        analyzer.run()

        elapsed = (get_configured_time(timezone) - start_time).total_seconds()
        logger.info(f"[Task] crawl_analyze completed successfully in {elapsed:.1f}s")
        return True

    except Exception as e:
        elapsed = (get_configured_time(timezone) - start_time).total_seconds()
        logger.error(f"[Task] crawl_analyze failed after {elapsed:.1f}s: {e}")
        logger.debug(traceback.format_exc())
        return False


def run_crawl_only(config_overrides: Optional[Dict[str, Any]] = None) -> bool:
    """
    Execute only the crawl phase (no notifications).

    Useful for data collection without triggering notifications.

    Args:
        config_overrides: Optional dictionary of config values to override

    Returns:
        True if the task completed successfully, False otherwise
    """
    # Disable notifications for crawl-only mode
    overrides = config_overrides or {}
    overrides["ENABLE_NOTIFICATION"] = False

    return run_crawl_analyze(config_overrides=overrides)


def health_check() -> bool:
    """
    Perform a basic health check.

    Verifies that:
    1. Configuration can be loaded
    2. Storage backend is accessible

    Returns:
        True if healthy, False otherwise
    """
    try:
        from trendradar.core import load_config
        from trendradar.context import AppContext

        config = load_config()
        ctx = AppContext(config)

        # Try to access storage
        storage = ctx.get_storage_manager()
        logger.debug(f"[Health] Storage backend: {storage.backend_name}")

        ctx.cleanup()
        return True

    except Exception as e:
        logger.error(f"[Health] Health check failed: {e}")
        return False


def _worker_api_base_url(override: Optional[str] = None) -> str:
    base_url = override or os.environ.get("TRENDS_API_URL", "http://localhost:3000")
    return base_url.rstrip("/")


def _skills_state_path() -> Path:
    return Path("apps/worker/skills-version-state.json")


def _request_json(url: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = None
    headers = {"Accept": "application/json"}

    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=payload, method=method, headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
            raise RuntimeError(f"Unexpected JSON payload from {url}")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"HTTP {error.code} from {url}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Network error for {url}: {error}") from error


def _load_last_skills_version() -> Optional[int]:
    state_path = _skills_state_path()
    if not state_path.exists():
        return None

    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None

    version = payload.get("skillsVersion")
    if isinstance(version, int):
        return version
    if isinstance(version, float) and version.is_integer():
        return int(version)
    return None


def _save_last_skills_version(version: int) -> None:
    state_path = _skills_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "skillsVersion": version,
                "updatedAt": get_configured_time(resolve_worker_timezone()).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def run_skills_version_check(
    api_base_url: Optional[str] = None,
    reingest_limit: int = 200,
) -> bool:
    base_url = _worker_api_base_url(api_base_url)

    try:
        version_response = _request_json(f"{base_url}/api/resumes/skills-version")
        if version_response.get("success") is not True:
            logger.error("[Task] Skills version request failed: %s", version_response)
            return False

        current_version = version_response.get("version")
        if not isinstance(current_version, int):
            logger.error("[Task] Invalid skills version payload: %s", version_response)
            return False

        previous_version = _load_last_skills_version()
        if previous_version is None:
            _save_last_skills_version(current_version)
            logger.info("[Task] Initialized skills version tracker at v%s", current_version)
            return True

        if current_version == previous_version:
            logger.info("[Task] Skills version unchanged (v%s)", current_version)
            return True

        logger.info(
            "[Task] Skills version changed from v%s to v%s, triggering re-ingest",
            previous_version,
            current_version,
        )
        trigger_response = _request_json(
            f"{base_url}/api/resumes/trigger-reingest",
            method="POST",
            body={"limit": max(1, int(reingest_limit))},
        )

        if trigger_response.get("success") is not True:
            logger.error("[Task] Failed to trigger re-ingest: %s", trigger_response)
            return False

        _save_last_skills_version(current_version)
        logger.info(
            "[Task] Re-ingest triggered successfully (scheduled=%s, hasMore=%s)",
            trigger_response.get("scheduled", 0),
            trigger_response.get("hasMore", False),
        )
        return True

    except Exception as error:
        logger.error("[Task] skills_version_check failed: %s", error)
        logger.debug(traceback.format_exc())
        return False


def run_scoring_auto_tune(
    api_base_url: Optional[str] = None,
    dry_run: bool = False,
    period_days: int = 14,
    top_k: int = 10,
    min_labeled_actions: int = 20,
    ndcg_improvement_threshold: float = 0.02,
) -> bool:
    base_url = _worker_api_base_url(api_base_url)
    logger.info(
        "[Task] Starting scoring auto-tune (dry_run=%s, period_days=%s, k=%s)",
        dry_run,
        period_days,
        top_k,
    )

    try:
        response = _request_json(
            f"{base_url}/api/scoring-evaluation/run-tuner",
            method="POST",
            body={
                "dryRun": bool(dry_run),
                "periodDays": max(1, int(period_days)),
                "k": max(1, int(top_k)),
                "minLabeledActions": max(1, int(min_labeled_actions)),
                "ndcgImprovementThreshold": float(ndcg_improvement_threshold),
            },
        )

        if response.get("success") is not True:
            logger.error("[Task] scoring auto-tune request failed: %s", response)
            return False

        result = response.get("result", {})
        status = result.get("status")
        reason = result.get("reason")
        logger.info("[Task] scoring auto-tune completed with status=%s reason=%s", status, reason)
        return True
    except Exception as error:
        logger.error("[Task] scoring auto-tune failed: %s", error)
        logger.debug(traceback.format_exc())
        return False


def run_workspace_summary(
    api_base_url: Optional[str] = None,
    workspace_slug: str = "dev",
    channel: str = "telegram",
    dry_run: bool = False,
    template_id: Optional[str] = None,
    end_at: Optional[str] = None,
    to: Optional[str] = None,
    subject: Optional[str] = None,
    webhook_url: Optional[str] = None,
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> bool:
    base_url = _worker_api_base_url(api_base_url)
    normalized_workspace = workspace_slug.strip() or "dev"
    normalized_channel = channel.strip() or "telegram"
    logger.info(
        "[Task] Starting workspace summary (workspace=%s, channel=%s, dry_run=%s)",
        normalized_workspace,
        normalized_channel,
        dry_run,
    )

    request_body: Dict[str, Any] = {
        "workspaceSlug": normalized_workspace,
        "period": "daily",
        "channel": normalized_channel,
        "dryRun": bool(dry_run),
    }

    if template_id and template_id.strip():
        request_body["templateId"] = template_id.strip()
    if end_at and end_at.strip():
        request_body["endAt"] = end_at.strip()
    if to and to.strip():
        request_body["to"] = to.strip()
    if subject and subject.strip():
        request_body["subject"] = subject.strip()
    if webhook_url and webhook_url.strip():
        request_body["webhookUrl"] = webhook_url.strip()
    if bot_token and bot_token.strip():
        request_body["botToken"] = bot_token.strip()
    if chat_id and chat_id.strip():
        request_body["chatId"] = chat_id.strip()

    try:
        response = _request_json(
            f"{base_url}/api/summaries/run",
            method="POST",
            body=request_body,
        )

        if response.get("success") is not True:
            logger.error("[Task] workspace summary request failed: %s", response)
            return False

        logger.info(
            "[Task] workspace summary completed (channel=%s, dry_run=%s, template=%s)",
            response.get("channel"),
            response.get("dryRun"),
            response.get("templateId"),
        )
        return True
    except Exception as error:
        logger.error("[Task] workspace summary failed: %s", error)
        logger.debug(traceback.format_exc())
        return False
