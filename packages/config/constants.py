"""
TrendRadar Configuration Constants

This module provides sensible defaults for all configuration options.
Only secrets (API keys, tokens, etc.) need to be set via environment variables.

Usage:
    from packages.config import get_config_value, DEFAULTS

    # Get a config value with fallback to default
    timezone = get_config_value("TIMEZONE")  # Returns "Asia/Shanghai" if not set

    # Access defaults directly
    default_port = DEFAULTS["MCP_PORT"]
"""

import os
from typing import Any

# =============================================================================
# Default Configuration Values
# =============================================================================

DEFAULTS: dict[str, Any] = {
    # -------------------------------------------------------------------------
    # Core Settings
    # -------------------------------------------------------------------------
    "TIMEZONE": "Asia/Shanghai",
    "DEBUG": False,
    "OUTPUT_DIR": "output",

    # -------------------------------------------------------------------------
    # Crawler Settings
    # -------------------------------------------------------------------------
    "REQUEST_INTERVAL": 0.5,  # Seconds between requests
    "RANK_THRESHOLD": 50,     # Minimum rank threshold for news items
    "REPORT_MODE": "incremental",  # daily | current | incremental

    # -------------------------------------------------------------------------
    # Storage Settings
    # -------------------------------------------------------------------------
    "STORAGE_BACKEND": "auto",  # auto | sqlite | s3
    # auto: GitHub Actions → remote, otherwise → local

    # -------------------------------------------------------------------------
    # AI Settings
    # -------------------------------------------------------------------------
    "AI_MODEL": "deepseek/deepseek-chat",
    "AI_ANALYSIS_ENABLED": True,
    "AI_ANALYSIS_WINDOW_START": "06:00",
    "AI_ANALYSIS_WINDOW_END": "23:00",
    "AI_MAX_RETRIES": 3,
    "AI_TIMEOUT": 60,  # Seconds

    # -------------------------------------------------------------------------
    # MCP Server Settings
    # -------------------------------------------------------------------------
    "MCP_PORT": 3333,
    "MCP_HOST": "0.0.0.0",
    "MCP_TRANSPORT": "stdio",  # stdio | http

    # -------------------------------------------------------------------------
    # Notification Settings
    # -------------------------------------------------------------------------
    "NOTIFICATION_BATCH_SIZE": 10,
    "NOTIFICATION_RETRY_COUNT": 3,
    "NOTIFICATION_RETRY_DELAY": 5,  # Seconds

    # -------------------------------------------------------------------------
    # Report Settings
    # -------------------------------------------------------------------------
    "REPORT_MAX_ITEMS": 100,
    "REPORT_INCLUDE_AI_ANALYSIS": True,
    "SKIP_ROOT_INDEX": False,  # Skip writing root index.html in dev mode
}

# =============================================================================
# Required Secrets (Must be set via environment variables)
# =============================================================================

SECRETS: list[str] = [
    # AI (required for AI features)
    "AI_API_KEY",

    # Optional: Notification channels (at least one recommended)
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "FEISHU_WEBHOOK_URL",
    "DINGTALK_WEBHOOK_URL",
    "DINGTALK_SECRET",
    "WEWORK_WEBHOOK_URL",
    "SLACK_WEBHOOK_URL",
    "BARK_URL",
    "NTFY_URL",
    "NTFY_TOPIC",
    "GENERIC_WEBHOOK_URL",

    # Email
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_USER",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
    "EMAIL_TO",

    # Remote storage (optional)
    "S3_ENDPOINT_URL",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET_NAME",
    "S3_REGION",
]

# =============================================================================
# Helper Functions
# =============================================================================


def get_config_value(key: str, default: Any = None) -> Any:
    """
    Get a configuration value with the following precedence:
    1. Environment variable
    2. Provided default parameter
    3. DEFAULTS dictionary value

    Args:
        key: The configuration key to look up
        default: Optional override for the default value

    Returns:
        The configuration value

    Examples:
        >>> get_config_value("TIMEZONE")
        'Asia/Shanghai'
        >>> get_config_value("CUSTOM_KEY", "my_default")
        'my_default'
    """
    # Check environment first
    env_value = os.environ.get(key)
    if env_value is not None:
        # Type coercion based on default type
        default_value = default if default is not None else DEFAULTS.get(key)
        if isinstance(default_value, bool):
            return env_value.lower() in ("true", "1", "yes", "on")
        if isinstance(default_value, int):
            try:
                return int(env_value)
            except ValueError:
                pass
        if isinstance(default_value, float):
            try:
                return float(env_value)
            except ValueError:
                pass
        return env_value

    # Use provided default or fall back to DEFAULTS
    if default is not None:
        return default
    return DEFAULTS.get(key)


def get_secret(key: str, required: bool = False) -> str | None:
    """
    Get a secret value from environment variables.

    Args:
        key: The secret key to look up
        required: If True, raises ValueError when secret is not set

    Returns:
        The secret value or None if not set

    Raises:
        ValueError: If required=True and secret is not set
    """
    value = os.environ.get(key)
    if required and not value:
        raise ValueError(
            f"Required secret '{key}' is not set. "
            f"Set it in ~/.secrets/com.trends.app.env or as an environment variable."
        )
    return value


def is_secret_set(key: str) -> bool:
    """Check if a secret is set in environment variables."""
    return bool(os.environ.get(key))


def get_all_config() -> dict[str, Any]:
    """
    Get all configuration values, merging defaults with environment overrides.

    Returns:
        Dictionary of all configuration values
    """
    config = DEFAULTS.copy()
    for key in config:
        env_value = os.environ.get(key)
        if env_value is not None:
            config[key] = get_config_value(key)
    return config
