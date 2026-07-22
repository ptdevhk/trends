# coding=utf-8
"""Unit tests for industry → research companyKey bridge (worker ingest path)."""

from __future__ import annotations

from apps.worker.research_industry_bridge import (
    IndustryBridgeResolver,
    brand_canonical_key,
    load_brands,
    map_surface_to_research_company,
)
from apps.worker.research_project import project_title


def test_brand_canonical_key_fanuc():
    assert brand_canonical_key({"id": 1, "nameCn": "发那科", "nameEn": "FANUC"}) == "fanuc"


def test_map_surface_fanuc_and_baoli_from_real_brands():
    brands = load_brands()
    assert len(brands) > 50
    fanuc = map_surface_to_research_company("发那科", brands)
    assert fanuc is not None
    assert fanuc["companyKey"] == "fanuc"
    fanuc_en = map_surface_to_research_company("FANUC", brands)
    assert fanuc_en is not None
    assert fanuc_en["companyKey"] == "fanuc"
    baoli = map_surface_to_research_company("宝力机械", brands)
    assert baoli is not None
    assert baoli["companyKey"] == "pro-technic-machinery"
    assert baoli["source"] == "override"


def test_industry_bridge_resolver_before_fallback():
    class EmptyFallback:
        def resolve_alias(self, alias: str):
            return None

    resolver = IndustryBridgeResolver(fallback=EmptyFallback())
    hit = resolver.resolve_alias("发那科")
    assert hit is not None
    assert hit["companyKey"] == "fanuc"


def test_project_title_uses_bridge_for_fanuc_without_k3_alias():
    """Ingest projection attaches signals when only industry bridge knows the brand."""

    class EmptyK3:
        def resolve_alias(self, alias: str):
            return None

    resolver = IndustryBridgeResolver(fallback=EmptyK3())
    drafts = project_title(
        "发那科推进智能制造与机器人集成",
        resolver=resolver,
        platform="test",
        seen_at=1,
        snippet="招聘应用工程师",
    )
    assert len(drafts) >= 1
    assert drafts[0].company_key == "fanuc"
    kinds = {d.kind for d in drafts}
    assert "company_mention" in kinds


def test_project_title_bridge_live_weibo_hiring_url():
    """Live NewsNow-shaped rows keep real URL + non-showcase platform on projected signals."""

    class EmptyK3:
        def resolve_alias(self, alias: str):
            return None

    resolver = IndustryBridgeResolver(fallback=EmptyK3())
    drafts = project_title(
        "发那科招聘应用工程师",
        resolver=resolver,
        platform="weibo",
        url="https://weibo.com/real/fanuc-hire",
        seen_at=1000,
        ingest_run_id="research-xyz",
    )
    assert drafts
    assert all(d.company_key == "fanuc" for d in drafts)
    assert any(d.kind == "hiring_signal" for d in drafts)
    assert all(d.evidence.get("platform") == "weibo" for d in drafts)
    assert all(d.evidence.get("url") == "https://weibo.com/real/fanuc-hire" for d in drafts)
    assert all(d.ingest_run_id == "research-xyz" for d in drafts)
