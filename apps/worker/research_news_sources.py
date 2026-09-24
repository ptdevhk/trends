# coding=utf-8
"""
Research news-source opt-in/out twin (Python).

Mirror of packages/shared/src/research/research-news-sources.ts so the WORKER
(offline, direct-Convex) can compute the same effective `rss:{feed_id}` set as
the daily-report build + hub. Reads config/research_news_sources.yaml, merges the
workspace overlay (`research.enabledNewsSources`) opt-out shape, and filters the
catalog ids. Non-catalog feeds are untouched.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import yaml


def default_news_sources_path() -> Path:
    return Path(__file__).resolve().parents[2] / "config" / "research_news_sources.yaml"


def load_news_sources_seed(path: Optional[Path] = None) -> Dict:
    """Group-id -> [feed-ids] + defaultGroupIds, in YAML order (dict preserves order)."""
    p = path or default_news_sources_path()
    with open(p, encoding="utf-8") as handle:
        doc = yaml.safe_load(handle) or {}
    groups_meta: List[tuple] = []
    for g in doc.get("groups", []):
        groups_meta.append((g.get("id"), g.get("feeds", [])))
    defaults = (doc.get("defaults") or {}).get("groups", []) or []
    return {
        "groups": groups_meta,  # [(group_id, [feed,...])]
        "defaultGroupIds": defaults,
    }


def _as_list(raw, key) -> List[str]:
    val = raw.get(key) if isinstance(raw, dict) else None
    if not isinstance(val, list):
        return []
    return [str(x).strip() for x in val if isinstance(x, str) and x.strip()]


def empty_news_sources_workspace() -> Dict:
    return {"masterEnabled": True, "excludedGroups": [], "excludedFeeds": [], "enabledFeeds": []}


def parse_news_sources_workspace(raw) -> Dict:
    if not isinstance(raw, dict):
        return empty_news_sources_workspace()
    master = raw.get("masterEnabled")
    return {
        "masterEnabled": master if isinstance(master, bool) else True,
        "excludedGroups": _as_list(raw, "excludedGroups"),
        "excludedFeeds": _as_list(raw, "excludedFeeds"),
        "enabledFeeds": _as_list(raw, "enabledFeeds"),
    }


def catalog_feed_ids(seed: Dict) -> List[str]:
    out: List[str] = []
    for _, feeds in seed["groups"]:
        for f in feeds:
            if f not in out:
                out.append(f)
    return out


def merge_news_sources(seed: Dict, workspace: Dict) -> List[str]:
    """Effective active feed-id set (catalog order), opt-out semantics.

    master off => []. Bad exclude-all with master on => full catalog (never empty).
    """
    if workspace.get("masterEnabled") is False:
        return []

    default_group_set = set(seed["defaultGroupIds"])
    excluded_groups = set(workspace.get("excludedGroups", []))
    base: List[str] = []
    base_set: set = set()
    for group_id, feeds in seed["groups"]:
        if group_id not in default_group_set:
            continue
        if group_id in excluded_groups:
            continue
        for f in feeds:
            if f in base_set:
                continue
            base_set.add(f)
            base.append(f)

    catalog_set = set(catalog_feed_ids(seed))
    enabled_set = {f for f in workspace.get("enabledFeeds", []) if f in catalog_set}
    excluded_set = set(workspace.get("excludedFeeds", []))

    effective: List[str] = []
    effective_set: set = set()
    for f in base:
        if f in excluded_set:
            continue
        effective_set.add(f)
        effective.append(f)
    for f in enabled_set:
        if f in excluded_set:
            continue
        if f in effective_set:
            continue
        effective_set.add(f)
        effective.append(f)

    if not effective and catalog_set:
        return catalog_feed_ids(seed)
    return effective
