# coding=utf-8
"""
Worker timezone helpers
"""

import os
from typing import Optional

from trendradar.utils.time import (
    DEFAULT_TIMEZONE,
    apply_process_timezone,
    resolve_timezone,
)


def _load_config_timezone() -> Optional[str]:
    try:
        from trendradar.core import load_config

        config = load_config()
        configured = config.get("TIMEZONE")
        if isinstance(configured, str) and configured.strip():
            return configured.strip()
    except Exception:
        return None
    return None


def resolve_worker_timezone() -> str:
    env_timezone = os.environ.get("TIMEZONE", "").strip() or None
    configured_timezone = _load_config_timezone() if env_timezone is None else None
    return resolve_timezone(
        env_timezone=env_timezone,
        configured_timezone=configured_timezone,
        default_timezone=DEFAULT_TIMEZONE,
    )


def bootstrap_worker_timezone() -> str:
    timezone = resolve_worker_timezone()
    os.environ["TIMEZONE"] = timezone
    apply_process_timezone(timezone)
    return timezone
