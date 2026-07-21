"""Unit tests for research_ports NewsNow parse + hotlist port."""

from __future__ import annotations

import json
from pathlib import Path

from apps.worker.research_ports import parse_newsnow_payload

FIXTURE = Path(__file__).parent / "fixtures" / "newsnow_weibo_success.json"


def test_parse_newsnow_success_maps_items():
    payload = json.loads(FIXTURE.read_text())
    items = parse_newsnow_payload("weibo", payload, captured_at=1000)
    assert len(items) == 1
    assert items[0].title == "宝力机械扩产招聘"
    assert items[0].platform == "weibo"
    assert items[0].url == "https://example.com/a"
    assert items[0].external_id == "ext-1"
    assert items[0].content_hash  # non-empty


def test_parse_newsnow_rejects_bad_status():
    items = parse_newsnow_payload("weibo", {"status": "error", "items": [{"title": "x"}]}, 1)
    assert items == []


def test_parse_newsnow_accepts_cache_status():
    items = parse_newsnow_payload(
        "baidu",
        {"status": "cache", "items": [{"title": "标题", "url": "http://u"}]},
        2,
    )
    assert len(items) == 1
    assert items[0].platform == "baidu"


def test_newsnow_port_builds_query_and_parses():
    from apps.worker.research_ports import NewsNowHotlistPort

    calls = []

    def fake_get(url: str) -> str:
        calls.append(url)
        return json.dumps(
            {
                "status": "success",
                "items": [{"title": "T1", "url": "http://x", "id": "1"}],
            }
        )

    port = NewsNowHotlistPort(api_url="https://example.test/api/s", getter=fake_get)
    items = port.fetch("weibo", captured_at=9)
    assert len(items) == 1
    assert "id=weibo" in calls[0]
    assert "latest" in calls[0]
    assert items[0].title == "T1"
