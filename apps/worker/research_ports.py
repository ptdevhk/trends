# coding=utf-8
"""
Thin hotlist / RSS ports for Research Eng ingest.

Port *ideas* from TrendRadar DataFetcher safety patterns; do not import NewsAnalyzer.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


@dataclass
class NormalizedNewsItem:
    source_id: str
    platform: str
    title: str
    content_hash: str
    captured_at: int
    external_id: Optional[str] = None
    url: Optional[str] = None
    rank: Optional[int] = None
    published_at: Optional[int] = None
    raw_snippet: Optional[str] = None

    def to_convex_args(self) -> Dict[str, Any]:
        args: Dict[str, Any] = {
            "sourceId": self.source_id,
            "platform": self.platform,
            "title": self.title,
            "contentHash": self.content_hash,
            "capturedAt": self.captured_at,
        }
        if self.external_id is not None:
            args["externalId"] = self.external_id
        if self.url is not None:
            args["url"] = self.url
        if self.rank is not None:
            args["rank"] = self.rank
        if self.published_at is not None:
            args["publishedAt"] = self.published_at
        if self.raw_snippet is not None:
            args["rawSnippet"] = self.raw_snippet
        return args


def stable_content_hash(
    *,
    platform: str,
    title: str,
    url: Optional[str] = None,
    external_id: Optional[str] = None,
) -> str:
    """Stable contentHash for news dedupe. Prefer external_id when present."""
    if external_id:
        material = f"{platform}|id:{external_id}"
    else:
        normalized_title = re.sub(r"\s+", " ", title.strip().lower())
        material = f"{platform}|title:{normalized_title}|url:{url or ''}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class HotlistPort(Protocol):
    def fetch(self, platform_id: str, captured_at: int) -> List[NormalizedNewsItem]: ...


class RssPort(Protocol):
    def fetch(self, feed_id: str, feed_url: str, captured_at: int) -> List[NormalizedNewsItem]: ...


@dataclass
class StaticHotlistPort:
    """In-memory / injectable hotlist for tests and offline runs."""

    items_by_platform: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def fetch(self, platform_id: str, captured_at: int) -> List[NormalizedNewsItem]:
        raw_items = self.items_by_platform.get(platform_id, [])
        result: List[NormalizedNewsItem] = []
        for idx, raw in enumerate(raw_items):
            title = str(raw.get("title") or "").strip()
            if not title:
                continue
            url = raw.get("url")
            external_id = raw.get("external_id") or raw.get("id")
            content_hash = stable_content_hash(
                platform=platform_id,
                title=title,
                url=url,
                external_id=str(external_id) if external_id else None,
            )
            result.append(
                NormalizedNewsItem(
                    source_id=platform_id,
                    platform=platform_id,
                    title=title,
                    content_hash=content_hash,
                    captured_at=captured_at,
                    external_id=str(external_id) if external_id else None,
                    url=url,
                    rank=raw.get("rank", idx + 1),
                    raw_snippet=raw.get("snippet"),
                )
            )
        return result


@dataclass
class HttpHotlistPort:
    """
    Minimal hotlist fetcher with timeout/retry safety.
    Expects a simple JSON list endpoint when RESEARCH_HOTLIST_BASE_URL is set;
    otherwise returns empty (config-only dry path).
    """

    base_url: Optional[str] = None
    timeout_seconds: float = 15.0
    max_retries: int = 2

    def fetch(self, platform_id: str, captured_at: int) -> List[NormalizedNewsItem]:
        if not self.base_url:
            logger.debug("HttpHotlistPort: no base_url; platform=%s empty", platform_id)
            return []
        url = f"{self.base_url.rstrip('/')}/{platform_id}"
        body = self._get_with_retries(url)
        if body is None:
            return []
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            logger.warning("HttpHotlistPort: invalid JSON for %s", platform_id)
            return []
        items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
        static = StaticHotlistPort(items_by_platform={platform_id: items})
        return static.fetch(platform_id, captured_at)

    def _get_with_retries(self, url: str) -> Optional[str]:
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                request = Request(url, headers={"Accept": "application/json", "User-Agent": "trends-research-ingest/1.0"})
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    return response.read().decode("utf-8", errors="replace")
            except (HTTPError, URLError, TimeoutError, OSError) as error:
                last_error = error
                logger.warning("Hotlist fetch attempt %s failed for %s: %s", attempt + 1, url, error)
        if last_error:
            logger.error("Hotlist fetch exhausted retries for %s: %s", url, last_error)
        return None


@dataclass
class StaticRssPort:
    items_by_feed: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def fetch(self, feed_id: str, feed_url: str, captured_at: int) -> List[NormalizedNewsItem]:
        raw_items = self.items_by_feed.get(feed_id, [])
        result: List[NormalizedNewsItem] = []
        for raw in raw_items:
            title = str(raw.get("title") or "").strip()
            if not title:
                continue
            url = raw.get("url") or raw.get("link")
            external_id = raw.get("external_id") or raw.get("guid") or url
            content_hash = stable_content_hash(
                platform=f"rss:{feed_id}",
                title=title,
                url=url,
                external_id=str(external_id) if external_id else None,
            )
            result.append(
                NormalizedNewsItem(
                    source_id=feed_id,
                    platform=f"rss:{feed_id}",
                    title=title,
                    content_hash=content_hash,
                    captured_at=captured_at,
                    external_id=str(external_id) if external_id else None,
                    url=url,
                    published_at=raw.get("published_at"),
                    raw_snippet=raw.get("snippet") or raw.get("summary"),
                )
            )
        return result


@dataclass
class HttpRssPort:
    timeout_seconds: float = 15.0
    max_retries: int = 2

    def fetch(self, feed_id: str, feed_url: str, captured_at: int) -> List[NormalizedNewsItem]:
        body = self._get_with_retries(feed_url)
        if not body:
            return []
        return parse_rss_xml(feed_id, body, captured_at)

    def _get_with_retries(self, url: str) -> Optional[str]:
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                request = Request(
                    url,
                    headers={"Accept": "application/rss+xml, application/xml, text/xml", "User-Agent": "trends-research-ingest/1.0"},
                )
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    return response.read().decode("utf-8", errors="replace")
            except (HTTPError, URLError, TimeoutError, OSError) as error:
                last_error = error
                logger.warning("RSS fetch attempt %s failed for %s: %s", attempt + 1, url, error)
        if last_error:
            logger.error("RSS fetch exhausted retries for %s: %s", url, last_error)
        return None


def parse_rss_xml(feed_id: str, xml_text: str, captured_at: int) -> List[NormalizedNewsItem]:
    """Minimal RSS 2.0 item parser for thin-port ingest."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        logger.warning("RSS parse error for feed %s", feed_id)
        return []

    items: List[NormalizedNewsItem] = []
    # RSS channel/item or Atom entry
    channel_items = root.findall(".//item")
    if not channel_items:
        channel_items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    for node in channel_items:
        title = _child_text(node, "title") or _child_text(node, "{http://www.w3.org/2005/Atom}title")
        if not title:
            continue
        link = _child_text(node, "link") or _atom_link(node)
        guid = _child_text(node, "guid") or _child_text(node, "{http://www.w3.org/2005/Atom}id") or link
        summary = _child_text(node, "description") or _child_text(node, "{http://www.w3.org/2005/Atom}summary")
        content_hash = stable_content_hash(
            platform=f"rss:{feed_id}",
            title=title,
            url=link,
            external_id=guid,
        )
        items.append(
            NormalizedNewsItem(
                source_id=feed_id,
                platform=f"rss:{feed_id}",
                title=title.strip(),
                content_hash=content_hash,
                captured_at=captured_at,
                external_id=guid,
                url=link,
                raw_snippet=summary[:500] if summary else None,
            )
        )
    return items


def _child_text(node: ET.Element, tag: str) -> Optional[str]:
    child = node.find(tag)
    if child is None or child.text is None:
        return None
    return child.text.strip()


def _atom_link(node: ET.Element) -> Optional[str]:
    link = node.find("{http://www.w3.org/2005/Atom}link")
    if link is None:
        return None
    return link.attrib.get("href")
