# coding=utf-8
"""
TrendRadar Configuration Package

Provides default constants and configuration utilities.

Usage:
    from packages.config import DEFAULTS, get_batch_size, get_weight

    # Access the full defaults dictionary
    timeout = DEFAULTS["AI"]["TIMEOUT"]

    # Use convenience functions
    feishu_batch = get_batch_size("feishu")
    rank_weight = get_weight("rank")
"""

from .constants import (
    DEFAULTS,
    # Section defaults
    APP_DEFAULTS,
    CRAWLER_DEFAULTS,
    REPORT_DEFAULTS,
    NOTIFICATION_DEFAULTS,
    BATCH_SIZE_DEFAULTS,
    MESSAGE_LIMITS,
    PUSH_WINDOW_DEFAULTS,
    WEIGHT_DEFAULTS,
    RSS_DEFAULTS,
    DISPLAY_DEFAULTS,
    AI_DEFAULTS,
    AI_ANALYSIS_DEFAULTS,
    AI_TRANSLATION_DEFAULTS,
    STORAGE_DEFAULTS,
    WEBHOOK_DEFAULTS,
    # Convenience functions
    get_batch_size,
    get_weight,
    get_default,
)

__all__ = [
    "DEFAULTS",
    "APP_DEFAULTS",
    "CRAWLER_DEFAULTS",
    "REPORT_DEFAULTS",
    "NOTIFICATION_DEFAULTS",
    "BATCH_SIZE_DEFAULTS",
    "MESSAGE_LIMITS",
    "PUSH_WINDOW_DEFAULTS",
    "WEIGHT_DEFAULTS",
    "RSS_DEFAULTS",
    "DISPLAY_DEFAULTS",
    "AI_DEFAULTS",
    "AI_ANALYSIS_DEFAULTS",
    "AI_TRANSLATION_DEFAULTS",
    "STORAGE_DEFAULTS",
    "WEBHOOK_DEFAULTS",
    "get_batch_size",
    "get_weight",
    "get_default",
]
