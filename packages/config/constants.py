# coding=utf-8
"""
TrendRadar Default Constants

This module contains all default values used throughout the application.
These constants serve as fallbacks when config.yaml or environment variables
do not specify values.

Usage:
    from packages.config.constants import DEFAULTS

    # Access nested values
    batch_size = DEFAULTS["NOTIFICATION"]["BATCH_SIZE"]["DEFAULT"]
    rank_threshold = DEFAULTS["REPORT"]["RANK_THRESHOLD"]
"""

from typing import Any, Dict, List

# =============================================================================
# Application Defaults
# =============================================================================

APP_DEFAULTS: Dict[str, Any] = {
    "TIMEZONE": "Asia/Shanghai",
    "DEBUG": False,
    "SHOW_VERSION_UPDATE": True,
}

# =============================================================================
# Crawler Defaults
# =============================================================================

CRAWLER_DEFAULTS: Dict[str, Any] = {
    "REQUEST_INTERVAL": 100,  # milliseconds between requests
    "USE_PROXY": False,
    "ENABLE_CRAWLER": True,
}

# =============================================================================
# Report Defaults
# =============================================================================

REPORT_DEFAULTS: Dict[str, Any] = {
    "MODE": "daily",  # daily, current, incremental
    "DISPLAY_MODE": "keyword",
    "RANK_THRESHOLD": 10,
    "SORT_BY_POSITION_FIRST": False,
    "MAX_NEWS_PER_KEYWORD": 0,  # 0 means no limit
}

# =============================================================================
# Notification Batch Size Defaults
# =============================================================================

BATCH_SIZE_DEFAULTS: Dict[str, int] = {
    "DEFAULT": 4000,
    "DINGTALK": 20000,
    "FEISHU": 29000,
    "BARK": 3600,
    "SLACK": 4000,
    "WEWORK": 4000,
    "TELEGRAM": 3800,
    "GENERIC_WEBHOOK": 4000,
}

# Platform-specific message limits (not configurable)
MESSAGE_LIMITS: Dict[str, int] = {
    "TELEGRAM_MAX_MESSAGE_LENGTH": 4096,
    "BARK_MAX_MESSAGE_LENGTH": 4096,
}

NOTIFICATION_DEFAULTS: Dict[str, Any] = {
    "ENABLED": True,
    "BATCH_SIZE": BATCH_SIZE_DEFAULTS,
    "BATCH_SEND_INTERVAL": 1.0,  # seconds between batch sends
    "MAX_ACCOUNTS_PER_CHANNEL": 3,
    "FEISHU_MESSAGE_SEPARATOR": "---",
}

# =============================================================================
# Push Window Defaults
# =============================================================================

PUSH_WINDOW_DEFAULTS: Dict[str, Any] = {
    "ENABLED": False,
    "START": "08:00",
    "END": "22:00",
    "ONCE_PER_DAY": True,
}

# =============================================================================
# Weight Defaults (for news scoring)
# =============================================================================

WEIGHT_DEFAULTS: Dict[str, float] = {
    "RANK": 0.6,
    "FREQUENCY": 0.3,
    "HOTNESS": 0.1,
}

# =============================================================================
# RSS Defaults
# =============================================================================

RSS_DEFAULTS: Dict[str, Any] = {
    "ENABLED": False,
    "REQUEST_INTERVAL": 2000,  # milliseconds
    "TIMEOUT": 15,  # seconds
    "USE_PROXY": False,
    "FRESHNESS_FILTER": {
        "ENABLED": True,
        "MAX_AGE_DAYS": 3,
    },
}

# =============================================================================
# Display Defaults
# =============================================================================

DISPLAY_DEFAULTS: Dict[str, Any] = {
    "REGION_ORDER": ["hotlist", "rss", "new_items", "standalone", "ai_analysis"],
    "REGIONS": {
        "HOTLIST": True,
        "NEW_ITEMS": True,
        "RSS": True,
        "STANDALONE": False,
        "AI_ANALYSIS": True,
    },
    "STANDALONE": {
        "MAX_ITEMS": 20,
    },
}

# =============================================================================
# AI Model Defaults (LiteLLM)
# =============================================================================

AI_DEFAULTS: Dict[str, Any] = {
    "MODEL": "deepseek/deepseek-chat",
    "TIMEOUT": 120,  # seconds
    "TEMPERATURE": 1.0,
    "MAX_TOKENS": 5000,
    "NUM_RETRIES": 2,
}

# =============================================================================
# AI Analysis Defaults
# =============================================================================

AI_ANALYSIS_DEFAULTS: Dict[str, Any] = {
    "ENABLED": False,
    "LANGUAGE": "Chinese",
    "PROMPT_FILE": "ai_analysis_prompt.txt",
    "MODE": "follow_report",
    "MAX_NEWS_FOR_ANALYSIS": 50,
    "INCLUDE_RSS": True,
    "INCLUDE_RANK_TIMELINE": False,
    "ANALYSIS_WINDOW": {
        "ENABLED": False,
        "START": "09:00",
        "END": "22:00",
        "ONCE_PER_DAY": False,
    },
}

# =============================================================================
# AI Translation Defaults
# =============================================================================

AI_TRANSLATION_DEFAULTS: Dict[str, Any] = {
    "ENABLED": False,
    "LANGUAGE": "English",
    "PROMPT_FILE": "ai_translation_prompt.txt",
}

# =============================================================================
# Storage Defaults
# =============================================================================

STORAGE_DEFAULTS: Dict[str, Any] = {
    "BACKEND": "auto",  # auto, local, remote
    "FORMATS": {
        "SQLITE": True,
        "TXT": True,
        "HTML": True,
    },
    "LOCAL": {
        "DATA_DIR": "output",
        "RETENTION_DAYS": 0,  # 0 means no auto-cleanup
    },
    "REMOTE": {
        "RETENTION_DAYS": 0,
    },
    "PULL": {
        "ENABLED": False,
        "DAYS": 7,
    },
}

# =============================================================================
# Webhook Defaults
# =============================================================================

WEBHOOK_DEFAULTS: Dict[str, Any] = {
    "WEWORK_MSG_TYPE": "markdown",
    "NTFY_SERVER_URL": "https://ntfy.sh",
}

# =============================================================================
# Combined DEFAULTS Dictionary
# =============================================================================

DEFAULTS: Dict[str, Any] = {
    "APP": APP_DEFAULTS,
    "CRAWLER": CRAWLER_DEFAULTS,
    "REPORT": REPORT_DEFAULTS,
    "NOTIFICATION": NOTIFICATION_DEFAULTS,
    "PUSH_WINDOW": PUSH_WINDOW_DEFAULTS,
    "WEIGHT": WEIGHT_DEFAULTS,
    "RSS": RSS_DEFAULTS,
    "DISPLAY": DISPLAY_DEFAULTS,
    "AI": AI_DEFAULTS,
    "AI_ANALYSIS": AI_ANALYSIS_DEFAULTS,
    "AI_TRANSLATION": AI_TRANSLATION_DEFAULTS,
    "STORAGE": STORAGE_DEFAULTS,
    "WEBHOOK": WEBHOOK_DEFAULTS,
    "MESSAGE_LIMITS": MESSAGE_LIMITS,
}


# =============================================================================
# Convenience Accessors
# =============================================================================

def get_batch_size(channel: str) -> int:
    """Get the default batch size for a notification channel.

    Args:
        channel: Channel name (e.g., 'feishu', 'dingtalk', 'slack')

    Returns:
        Default batch size for the channel
    """
    key = channel.upper()
    return BATCH_SIZE_DEFAULTS.get(key, BATCH_SIZE_DEFAULTS["DEFAULT"])


def get_weight(weight_type: str) -> float:
    """Get the default weight for scoring.

    Args:
        weight_type: Weight type ('rank', 'frequency', 'hotness')

    Returns:
        Default weight value
    """
    return WEIGHT_DEFAULTS.get(weight_type.upper(), 0.0)


def get_default(section: str, key: str, fallback: Any = None) -> Any:
    """Get a default value from a section.

    Args:
        section: Section name (e.g., 'APP', 'CRAWLER', 'REPORT')
        key: Key within the section
        fallback: Value to return if key not found

    Returns:
        Default value or fallback
    """
    section_defaults = DEFAULTS.get(section.upper(), {})
    return section_defaults.get(key, fallback)
