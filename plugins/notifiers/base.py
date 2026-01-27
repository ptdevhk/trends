"""
Base Notifier Plugin Interface

All custom notifiers should inherit from BaseNotifier and implement
the required methods.

Example:
    import os
    from plugins.notifiers.base import BaseNotifier, NotificationResult

    class DiscordNotifier(BaseNotifier):
        name = "discord"
        display_name = "Discord"
        env_keys = ["DISCORD_WEBHOOK_URL"]

        def send(self, message: str, **kwargs) -> NotificationResult:
            webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
            if not webhook_url:
                return NotificationResult(
                    success=False,
                    error="DISCORD_WEBHOOK_URL not set"
                )

            # Send to Discord...
            return NotificationResult(success=True)

        def is_configured(self) -> bool:
            return bool(os.environ.get("DISCORD_WEBHOOK_URL"))
"""

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class NotificationResult:
    """Result of a notification send attempt."""

    success: bool
    error: str | None = None
    response: Any = None
    retry_after: int | None = None  # Seconds to wait before retry

    def __bool__(self) -> bool:
        return self.success


class BaseNotifier(ABC):
    """
    Abstract base class for notifier plugins.

    All custom notifiers must inherit from this class and implement:
        - name: Unique identifier for the notifier
        - send(): Method to send notifications

    Optional:
        - env_keys: List of required environment variable names
        - display_name: Human-readable name
        - is_configured(): Check if notifier is properly configured
        - format_message(): Custom message formatting
    """

    # Required: Unique identifier for the notifier
    name: str = ""

    # Optional: Human-readable display name
    display_name: str = ""

    # Optional: Description of the notifier
    description: str = ""

    # Optional: List of required environment variable names
    env_keys: list[str] = []

    # Optional: Maximum message length (0 = no limit)
    max_message_length: int = 0

    def __init__(self, config: dict | None = None):
        """Initialize the notifier with optional config."""
        self._config = config or {}
        self.configure(self._config)

    def configure(self, config: dict) -> None:
        """
        Configure the notifier with settings from config.yaml.

        Override this method to handle custom configuration options.

        Args:
            config: The full configuration dictionary
        """
        pass

    @abstractmethod
    def send(self, message: str, **kwargs: Any) -> NotificationResult:
        """
        Send a notification message.

        Args:
            message: The message content to send
            **kwargs: Additional options (title, html, etc.)

        Returns:
            NotificationResult indicating success or failure
        """
        raise NotImplementedError

    def is_configured(self) -> bool:
        """
        Check if this notifier is properly configured.

        Default implementation checks if all required env vars are set.

        Returns:
            True if notifier can be used
        """
        return all(os.environ.get(key) for key in self.env_keys)

    def is_enabled(self, config: dict) -> bool:
        """
        Check if this notifier is enabled in the configuration.

        Args:
            config: The full configuration dictionary

        Returns:
            True if notifier should be used
        """
        # Default: enabled if configured
        return self.is_configured()

    def format_message(self, message: str, format_type: str = "text") -> str:
        """
        Format a message for this notification channel.

        Override this method to customize message formatting.

        Args:
            message: The raw message content
            format_type: "text", "html", or "markdown"

        Returns:
            Formatted message string
        """
        if self.max_message_length and len(message) > self.max_message_length:
            return message[: self.max_message_length - 3] + "..."
        return message

    def get_display_name(self) -> str:
        """Get human-readable display name."""
        return self.display_name or self.name.replace("_", " ").title()

    def send_batch(
        self, messages: list[str], **kwargs: Any
    ) -> list[NotificationResult]:
        """
        Send multiple messages in batch.

        Default implementation sends messages one by one.
        Override for more efficient batch sending.

        Args:
            messages: List of messages to send
            **kwargs: Additional options passed to send()

        Returns:
            List of NotificationResult for each message
        """
        return [self.send(msg, **kwargs) for msg in messages]
