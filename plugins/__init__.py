"""
TrendRadar Plugin System

This module provides automatic plugin discovery and registration.
Plugins are extensions that live outside the core trendradar/ package
to avoid conflicts when syncing with upstream.

Plugin Types:
    - crawlers: Data source plugins (fetch news from platforms)
    - notifiers: Notification channel plugins (send alerts)
    - ai_providers: AI provider plugins (analysis, translation)

Usage:
    from plugins import discover_plugins, get_crawler, get_notifier

    # Discover all plugins
    plugins = discover_plugins()

    # Get a specific crawler
    my_crawler = get_crawler("my_source")
"""

import importlib
import importlib.util
import os
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .crawlers.base import BaseCrawler
    from .notifiers.base import BaseNotifier
    from .ai_providers.base import BaseAIProvider

# Plugin registries
_crawlers: dict[str, type["BaseCrawler"]] = {}
_notifiers: dict[str, type["BaseNotifier"]] = {}
_ai_providers: dict[str, type["BaseAIProvider"]] = {}

# Flag to track if plugins have been discovered
_discovered = False


def _discover_plugins_in_directory(
    directory: Path,
    base_class_name: str,
    registry: dict,
) -> None:
    """Discover and register plugins from a directory."""
    if not directory.exists():
        return

    for file_path in directory.glob("*.py"):
        if file_path.name.startswith("_"):
            continue

        module_name = file_path.stem
        try:
            spec = importlib.util.spec_from_file_location(
                f"plugins.custom.{module_name}",
                file_path,
            )
            if spec is None or spec.loader is None:
                continue

            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            # Find classes that inherit from the base class
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (
                    isinstance(attr, type)
                    and hasattr(attr, "name")
                    and attr_name != base_class_name
                ):
                    plugin_name = getattr(attr, "name", None)
                    if plugin_name:
                        registry[plugin_name] = attr

        except Exception as e:
            # Log but don't crash on plugin load errors
            print(f"Warning: Failed to load plugin {file_path}: {e}")


def discover_plugins() -> dict[str, dict]:
    """
    Discover and register all plugins.

    Returns:
        Dictionary with counts of discovered plugins by type
    """
    global _discovered
    if _discovered:
        return {
            "crawlers": len(_crawlers),
            "notifiers": len(_notifiers),
            "ai_providers": len(_ai_providers),
        }

    plugins_dir = Path(__file__).parent

    # Discover custom crawlers
    _discover_plugins_in_directory(
        plugins_dir / "crawlers" / "custom",
        "BaseCrawler",
        _crawlers,
    )

    # Discover custom notifiers
    _discover_plugins_in_directory(
        plugins_dir / "notifiers" / "custom",
        "BaseNotifier",
        _notifiers,
    )

    # Discover custom AI providers
    _discover_plugins_in_directory(
        plugins_dir / "ai_providers" / "custom",
        "BaseAIProvider",
        _ai_providers,
    )

    _discovered = True

    return {
        "crawlers": len(_crawlers),
        "notifiers": len(_notifiers),
        "ai_providers": len(_ai_providers),
    }


def get_crawler(name: str) -> type["BaseCrawler"] | None:
    """Get a registered crawler by name."""
    if not _discovered:
        discover_plugins()
    return _crawlers.get(name)


def get_notifier(name: str) -> type["BaseNotifier"] | None:
    """Get a registered notifier by name."""
    if not _discovered:
        discover_plugins()
    return _notifiers.get(name)


def get_ai_provider(name: str) -> type["BaseAIProvider"] | None:
    """Get a registered AI provider by name."""
    if not _discovered:
        discover_plugins()
    return _ai_providers.get(name)


def list_crawlers() -> list[str]:
    """List all registered crawler names."""
    if not _discovered:
        discover_plugins()
    return list(_crawlers.keys())


def list_notifiers() -> list[str]:
    """List all registered notifier names."""
    if not _discovered:
        discover_plugins()
    return list(_notifiers.keys())


def list_ai_providers() -> list[str]:
    """List all registered AI provider names."""
    if not _discovered:
        discover_plugins()
    return list(_ai_providers.keys())


def register_crawler(cls: type["BaseCrawler"]) -> type["BaseCrawler"]:
    """Decorator to manually register a crawler."""
    if hasattr(cls, "name"):
        _crawlers[cls.name] = cls
    return cls


def register_notifier(cls: type["BaseNotifier"]) -> type["BaseNotifier"]:
    """Decorator to manually register a notifier."""
    if hasattr(cls, "name"):
        _notifiers[cls.name] = cls
    return cls


def register_ai_provider(cls: type["BaseAIProvider"]) -> type["BaseAIProvider"]:
    """Decorator to manually register an AI provider."""
    if hasattr(cls, "name"):
        _ai_providers[cls.name] = cls
    return cls
