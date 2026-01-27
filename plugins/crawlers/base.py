"""
Base Crawler Plugin Interface

All custom crawlers should inherit from BaseCrawler and implement
the required methods.

Example:
    from plugins.crawlers.base import BaseCrawler, NewsItem

    class MySourceCrawler(BaseCrawler):
        name = "my_source"
        display_name = "My Source"

        def fetch(self) -> list[NewsItem]:
            # Fetch news from your source
            return [
                NewsItem(
                    title="Breaking News",
                    url="https://example.com/news/1",
                    source=self.name,
                    rank=1,
                )
            ]

        def is_enabled(self, config: dict) -> bool:
            return "my_source" in config.get("platforms", [])
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class NewsItem:
    """Represents a single news item fetched from a source."""

    title: str
    url: str
    source: str
    rank: int = 0
    hot_value: int | None = None
    description: str | None = None
    timestamp: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for storage/serialization."""
        return {
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "rank": self.rank,
            "hot_value": self.hot_value,
            "description": self.description,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "extra": self.extra,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "NewsItem":
        """Create from dictionary."""
        timestamp = data.get("timestamp")
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)
        return cls(
            title=data["title"],
            url=data["url"],
            source=data["source"],
            rank=data.get("rank", 0),
            hot_value=data.get("hot_value"),
            description=data.get("description"),
            timestamp=timestamp,
            extra=data.get("extra", {}),
        )


class BaseCrawler(ABC):
    """
    Abstract base class for crawler plugins.

    All custom crawlers must inherit from this class and implement:
        - name: Unique identifier for the crawler
        - fetch(): Method to fetch news items

    Optional:
        - display_name: Human-readable name
        - is_enabled(): Check if crawler should run
        - configure(): Set up crawler with config
    """

    # Required: Unique identifier for the crawler
    name: str = ""

    # Optional: Human-readable display name
    display_name: str = ""

    # Optional: Description of the crawler
    description: str = ""

    def __init__(self, config: dict | None = None):
        """Initialize the crawler with optional config."""
        self._config = config or {}
        self.configure(self._config)

    def configure(self, config: dict) -> None:
        """
        Configure the crawler with settings from config.yaml.

        Override this method to handle custom configuration options.

        Args:
            config: The full configuration dictionary
        """
        pass

    @abstractmethod
    def fetch(self) -> list[NewsItem]:
        """
        Fetch news items from the source.

        Returns:
            List of NewsItem objects

        Raises:
            Exception: If fetching fails (will be caught and logged)
        """
        raise NotImplementedError

    def is_enabled(self, config: dict) -> bool:
        """
        Check if this crawler is enabled in the configuration.

        Default implementation checks if crawler name is in platforms list.

        Args:
            config: The full configuration dictionary

        Returns:
            True if crawler should run
        """
        platforms = config.get("platforms", [])
        return self.name in platforms

    def get_display_name(self) -> str:
        """Get human-readable display name."""
        return self.display_name or self.name.replace("_", " ").title()
