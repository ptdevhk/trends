"""Unit tests for research_ports NewsNow parse + hotlist port."""

from __future__ import annotations

import json
from pathlib import Path

from apps.worker.research_ports import (
    parse_newsnow_payload,
    parse_rss_xml,
    strip_html_to_text,
    url_matches_expected_domain,
)

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


def test_domain_safety_drops_mismatch():
    assert url_matches_expected_domain("https://www.weibo.com/x", "weibo.com") is True
    assert url_matches_expected_domain("https://evil.example/x", "weibo.com") is False
    payload = {
        "status": "success",
        "items": [
            {"title": "ok", "url": "https://www.weibo.com/x"},
            {"title": "bad", "url": "https://evil.example/x"},
        ],
    }
    items = parse_newsnow_payload(
        "weibo",
        payload,
        1,
        expected_domain="weibo.com",
    )
    assert len(items) == 1
    assert "weibo.com" in (items[0].url or "")


def test_strip_html_to_text_removes_anchor_markup():
    raw = (
        '<a href="https://news.google.com/rss/articles/ABC?oc=5" target="_blank">'
        "提质升级，智造未来|FANUC</a>&nbsp;&nbsp;"
        '<font color="#6f6f6f">nfplus.nfnews.com</font>'
    )
    clean = strip_html_to_text(raw)
    assert "<a" not in clean
    assert "href=" not in clean
    assert "FANUC" in clean
    assert "nfplus.nfnews.com" in clean


def test_parse_rss_xml_strips_html_description():
    xml = """<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item>
        <title>发那科新闻</title>
        <link>https://news.google.com/rss/articles/XYZ</link>
        <description><![CDATA[<a href="https://news.google.com/rss/articles/XYZ" target="_blank">发那科新闻</a>&nbsp;<font>source.com</font>]]></description>
        <guid>XYZ</guid>
      </item>
    </channel></rss>
    """
    items = parse_rss_xml("gnews-fanuc-cn", xml, captured_at=1)
    assert len(items) == 1
    assert items[0].url == "https://news.google.com/rss/articles/XYZ"
    assert items[0].raw_snippet is not None
    assert "<a" not in items[0].raw_snippet
    assert "href=" not in items[0].raw_snippet
    assert "发那科新闻" in items[0].raw_snippet


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


def test_resolve_newsnow_api_url_from_env():
    from apps.worker.research_ports import resolve_newsnow_api_url

    assert resolve_newsnow_api_url({}) is None
    assert resolve_newsnow_api_url({"RESEARCH_HOTLIST_API_URL": "  "}) is None
    assert (
        resolve_newsnow_api_url({"RESEARCH_HOTLIST_API_URL": "https://alt.example/api/s"})
        == "https://alt.example/api/s"
    )


def test_resolve_newsnow_proxy_url_from_env():
    from apps.worker.research_ports import resolve_newsnow_proxy_url

    assert resolve_newsnow_proxy_url({}) is None
    assert (
        resolve_newsnow_proxy_url({"RESEARCH_HOTLIST_PROXY_URL": "http://proxy.local:8080"})
        == "http://proxy.local:8080"
    )


def test_newsnow_request_url_uses_alternate_api():
    from apps.worker.research_ports import DEFAULT_NEWSNOW_API_URL, newsnow_request_url

    assert newsnow_request_url(None, "weibo") == f"{DEFAULT_NEWSNOW_API_URL}?id=weibo&latest"
    assert (
        newsnow_request_url("https://alt.example/api/s/", "baidu")
        == "https://alt.example/api/s?id=baidu&latest"
    )


def test_newsnow_port_uses_proxy_handler_when_proxy_url_set(monkeypatch):
    """Drive shipped _opener/proxy_url: ProxyHandler is installed when proxy is set."""
    from urllib.request import ProxyHandler

    from apps.worker.research_ports import NewsNowHotlistPort

    seen = {}

    def fake_build_opener(*handlers):
        seen["handlers"] = handlers

        class _Resp:
            def read(self):
                return b'{"status":"success","items":[{"title":"via-proxy","id":"p1"}]}'

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _Opener:
            def open(self, request, timeout=None):
                seen["opened_url"] = request.full_url
                return _Resp()

        return _Opener()

    monkeypatch.setattr("apps.worker.research_ports.build_opener", fake_build_opener)
    port = NewsNowHotlistPort(
        api_url="https://alt.example/api/s",
        proxy_url="http://proxy.local:8080",
    )
    items = port.fetch("weibo", captured_at=1)
    assert len(items) == 1
    assert items[0].title == "via-proxy"
    assert any(isinstance(h, ProxyHandler) for h in seen["handlers"])
    assert "id=weibo" in seen["opened_url"]
    assert seen["opened_url"].startswith("https://alt.example/api/s")
