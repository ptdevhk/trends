# coding=utf-8
"""Tests for research unresolved → industry steward queue."""

from __future__ import annotations

import json
from pathlib import Path

from apps.worker.research_ports import NormalizedNewsItem
from apps.worker.research_unresolved import (
    append_research_unresolved_to_queue,
    samples_from_unresolved_items,
)


def test_append_research_unresolved_writes_queue(tmp_path: Path):
    samples = [
        {
            "surface": "未知机床厂",
            "title": "未知机床厂扩产",
            "platform": "weibo",
            "url": "https://weibo.com/x",
        }
    ]
    n = append_research_unresolved_to_queue(tmp_path, samples)
    assert n == 1
    path = tmp_path / "output" / "industry-data" / "unresolved-queue.json"
    assert path.is_file()
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert data["events"][0]["surface"] == "未知机床厂"
    assert data["events"][0]["reason"] == "miss"
    assert data["events"][0]["normalizedKey"]


def test_samples_from_unresolved_items_uses_alias_candidates():
    items = [
        NormalizedNewsItem(
            source_id="weibo",
            platform="weibo",
            title="未知机床厂中标大单",
            content_hash="h1",
            captured_at=1,
            url="https://weibo.com/1",
        )
    ]
    samples = samples_from_unresolved_items(items)
    assert samples
    assert samples[0]["platform"] == "weibo"
