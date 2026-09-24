# coding=utf-8
"""Tests for the research news-sources Python twin + worker filter."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.worker.research_news_sources import (
    catalog_feed_ids,
    empty_news_sources_workspace,
    load_news_sources_seed,
    merge_news_sources,
    parse_news_sources_workspace,
)


@pytest.fixture
def seed_dict():
    return {
        "groups": [
            ("cnc-core", ["a", "b", "c"]),
            ("components", ["d", "e"]),
            ("market", ["f"]),
        ],
        "defaultGroupIds": ["cnc-core", "components", "market"],
    }


def test_catalog_feed_ids_unique_order(seed_dict):
    assert catalog_feed_ids(seed_dict) == ["a", "b", "c", "d", "e", "f"]


def test_empty_workspace_default_on(seed_dict):
    assert merge_news_sources(seed_dict, empty_news_sources_workspace()) == [
        "a", "b", "c", "d", "e", "f",
    ]


def test_master_off(seed_dict):
    w = empty_news_sources_workspace()
    w["masterEnabled"] = False
    assert merge_news_sources(seed_dict, w) == []


def test_excluded_group(seed_dict):
    w = empty_news_sources_workspace()
    w["excludedGroups"] = ["components"]
    assert merge_news_sources(seed_dict, w) == ["a", "b", "c", "f"]


def test_excluded_feed(seed_dict):
    w = empty_news_sources_workspace()
    w["excludedFeeds"] = ["b"]
    assert merge_news_sources(seed_dict, w) == ["a", "c", "d", "e", "f"]


def test_enabled_feed_escape_hatch(seed_dict):
    w = empty_news_sources_workspace()
    w["excludedGroups"] = ["market"]
    w["enabledFeeds"] = ["f"]
    assert merge_news_sources(seed_dict, w) == ["a", "b", "c", "d", "e", "f"]


def test_excluded_feed_beats_enabled(seed_dict):
    w = empty_news_sources_workspace()
    w["excludedGroups"] = ["market"]
    w["enabledFeeds"] = ["f"]
    w["excludedFeeds"] = ["f"]
    assert merge_news_sources(seed_dict, w) == ["a", "b", "c", "d", "e"]


def test_bad_exclude_all_falls_back_full(seed_dict):
    w = empty_news_sources_workspace()
    w["excludedGroups"] = ["cnc-core", "components", "market"]
    assert merge_news_sources(seed_dict, w) == ["a", "b", "c", "d", "e", "f"]


def test_parse_workspace_missing_raw():
    assert parse_news_sources_workspace(None) == empty_news_sources_workspace()


def test_parse_workspace_explicit():
    w = parse_news_sources_workspace({
        "masterEnabled": False,
        "excludedGroups": ["market"],
        "excludedFeeds": ["b"],
        "enabledFeeds": ["f"],
    })
    assert w["masterEnabled"] is False
    assert w["excludedGroups"] == ["market"]


def test_load_seed_from_real_file():
    seed = load_news_sources_seed()
    # real catalog: 10 groups, every enabled gnews/bing id assigned exactly once
    ids = catalog_feed_ids(seed)
    from collections import Counter
    counts = Counter(ids)
    dups = [k for k, v in counts.items() if v > 1]
    assert not dups
    assert len(seed["defaultGroupIds"]) == 10
    assert len(ids) >= 70


def test_worker_filter_keeps_non_catalog_and_drops_optout():
    from apps.worker.research_ingest import _filter_feeds_by_news_sources
    feeds = [
        {"id": "gnews-cnc-machine", "url": "u1"},   # catalog
        {"id": "bing-cnc-machine", "url": "u2"},    # catalog
        {"id": "hacker-news", "url": "u3"},          # non-catalog -> keep
    ]
    with mock.patch(
        "apps.worker.research_convex.convex_query",
        return_value={
            "configValue": {"masterEnabled": False, "excludedGroups": [], "excludedFeeds": [], "enabledFeeds": []}
        },
    ):
        out = _filter_feeds_by_news_sources(feeds)
        assert {f["id"] for f in out} == {"hacker-news"}
        assert {f["id"] for f in out} == {"hacker-news"}


def test_worker_filter_default_all_on():
    from apps.worker.research_ingest import _filter_feeds_by_news_sources
    feeds = [{"id": "gnews-cnc-machine", "url": "u1"}, {"id": "hacker-news", "url": "u3"}]
    with mock.patch(
        "apps.worker.research_convex.convex_query",
        side_effect=RuntimeError("convex down"),  # fail-open -> defaults (all ON)
    ):
        out = _filter_feeds_by_news_sources(feeds)
        assert {f["id"] for f in out} == {"gnews-cnc-machine", "hacker-news"}
