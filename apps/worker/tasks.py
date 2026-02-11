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
from typing import Optional, Dict, Any

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
