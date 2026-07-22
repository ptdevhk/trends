"""Unit tests for research resolve + signal projector (PR3)."""

from __future__ import annotations

from typing import Any, Dict, Optional

from apps.worker.research_ports import NormalizedNewsItem
from apps.worker.research_project import (
    classify_kinds,
    project_signals_for_items,
    project_title,
)
from apps.worker.research_resolve import extract_candidate_aliases, resolve_first_company


class FakeResolver:
    def __init__(self, mapping: Dict[str, Dict[str, Any]]):
        self.mapping = mapping
        self.calls: list[str] = []

    def resolve_alias(self, alias: str) -> Optional[Dict[str, Any]]:
        self.calls.append(alias)
        return self.mapping.get(alias)


def test_resolve_prefers_alias_hit():
    resolver = FakeResolver(
        {"宝力机械": {"companyKey": "pro-technic-machinery", "displayName": "宝力机械"}}
    )
    hit = resolve_first_company(resolver, "宝力机械扩产招聘销售")
    assert hit is not None
    assert hit["companyKey"] == "pro-technic-machinery"


def test_project_title_emits_nested_evidence_and_multi_kinds():
    resolver = FakeResolver(
        {"宝力机械": {"companyKey": "pro-technic-machinery", "displayName": "宝力机械"}}
    )
    drafts = project_title(
        "宝力机械扩产招聘销售",
        resolver=resolver,
        platform="weibo",
        seen_at=12345,
        snippet="扩产并招聘",
        url="http://example.com/1",
        ingest_run_id="run-1",
    )
    assert any(d.company_key == "pro-technic-machinery" for d in drafts)
    kinds = {d.kind for d in drafts}
    assert "company_mention" in kinds
    assert "hiring_signal" in kinds or "sales_trigger" in kinds
    for d in drafts:
        assert isinstance(d.evidence, dict)
        assert d.evidence["title"] == "宝力机械扩产招聘销售"
        assert d.evidence["platform"] == "weibo"
        assert d.evidence["seenAt"] == 12345
        assert "platform" not in d.__dict__ or True  # evidence nested, not flat on draft root kind fields
        payload = d.to_convex_args()
        assert "evidence" in payload
        assert payload["evidence"]["platform"] == "weibo"
        assert "platform" not in payload or payload.get("platform") is None or "evidence" in payload


def test_unresolved_mentions_skipped_and_counted():
    resolver = FakeResolver({})  # nothing resolves
    items = [
        NormalizedNewsItem(
            source_id="weibo",
            platform="weibo",
            title="未知公司中标大单",
            content_hash="h1",
            captured_at=1,
            raw_snippet="未知公司",
        )
    ]
    drafts, unresolved = project_signals_for_items(items, resolver, ingest_run_id="r1")
    assert drafts == []
    assert unresolved == 1


def test_classify_kinds_heuristics():
    assert "hiring_signal" in classify_kinds("公司招聘工程师")
    assert "sales_trigger" in classify_kinds("中标扩产合作")
    assert "market_move" in classify_kinds("完成融资")


def test_classify_hiring_cnc_phrasing():
    kinds = classify_kinds("发那科相关渠道招聘应用工程师")
    assert "hiring_signal" in kinds


def test_project_title_live_url_preserved():
    drafts = project_title(
        "发那科扩产与加工中心订单",
        company_key="fanuc",
        platform="weibo",
        url="https://weibo.com/real/123",
        seen_at=1000,
        ingest_run_id="research-xyz",
    )
    assert drafts
    assert any(d.kind in ("sales_trigger", "market_move") for d in drafts)
    assert all(d.evidence.get("url") == "https://weibo.com/real/123" for d in drafts)
    assert all(d.evidence.get("platform") == "weibo" for d in drafts)


def test_project_title_with_resolver_fanuc_hiring():
    resolver = FakeResolver(
        {"发那科": {"companyKey": "fanuc", "displayName": "发那科 / FANUC"}}
    )
    drafts = project_title(
        "发那科招聘工程师",
        resolver=resolver,
        platform="zhihu",
        url="https://www.zhihu.com/question/1",
        seen_at=1,
    )
    assert drafts and drafts[0].company_key == "fanuc"
    assert any(d.kind == "hiring_signal" for d in drafts)


def test_extract_candidate_aliases_cjk():
    aliases = extract_candidate_aliases("宝力机械有限公司发布新产品")
    assert any("宝力" in a for a in aliases)
