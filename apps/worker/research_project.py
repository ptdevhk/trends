# coding=utf-8
"""
Rule-based signal projector for Research Eng P1.

Kinds: company_mention | hiring_signal | market_move | sales_trigger
Evidence is always a nested object.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from apps.worker.research_ports import NormalizedNewsItem
from apps.worker.research_resolve import AliasResolver, resolve_first_company

HIRING_RE = re.compile(
    r"招聘|hiring|岗位|职位|招人|headcount|招聘会|应用工程师|人才|校招|社招",
    re.IGNORECASE,
)
SALES_RE = re.compile(
    r"采购|中标|扩产|合作|订单|签约|采购意向|招标|扩能",
    re.IGNORECASE,
)
MARKET_RE = re.compile(
    r"融资|上市|并购|收购|投产|发布|涨价|降价|市占|加工中心|智能制造|数控系统",
    re.IGNORECASE,
)

SIGNAL_KINDS = frozenset({"company_mention", "hiring_signal", "market_move", "sales_trigger"})


@dataclass
class SignalDraft:
    company_key: str
    kind: str
    title: str
    evidence: Dict[str, Any]
    captured_at: int
    summary: Optional[str] = None
    score: Optional[float] = None
    ingest_run_id: Optional[str] = None

    def to_convex_args(self) -> Dict[str, Any]:
        args: Dict[str, Any] = {
            "companyKey": self.company_key,
            "kind": self.kind,
            "title": self.title,
            "evidence": self.evidence,
            "capturedAt": self.captured_at,
        }
        if self.summary is not None:
            args["summary"] = self.summary
        if self.score is not None:
            args["score"] = self.score
        if self.ingest_run_id is not None:
            args["ingestRunId"] = self.ingest_run_id
        return args


def classify_kinds(title: str, snippet: Optional[str] = None) -> List[str]:
    """
    Always include company_mention when a company is resolved (caller adds that).
    Additional kinds from heuristics.
    """
    text = f"{title} {snippet or ''}"
    kinds: List[str] = []
    if HIRING_RE.search(text):
        kinds.append("hiring_signal")
    if SALES_RE.search(text):
        kinds.append("sales_trigger")
    if MARKET_RE.search(text):
        kinds.append("market_move")
    return kinds


def project_title(
    title: str,
    *,
    resolver: Optional[AliasResolver] = None,
    company_key: Optional[str] = None,
    platform: str = "test",
    seen_at: Optional[int] = None,
    snippet: Optional[str] = None,
    url: Optional[str] = None,
    news_item_id: Optional[str] = None,
    ingest_run_id: Optional[str] = None,
    extra_aliases: Optional[List[str]] = None,
) -> List[SignalDraft]:
    """
    Project signals from a single title. Used by unit tests and ingest.
    If company_key is provided, skip resolve; otherwise use resolver.
    """
    captured = seen_at if seen_at is not None else 0
    resolved_key = company_key
    if not resolved_key:
        if resolver is None:
            return []
        hit = resolve_first_company(resolver, title, snippet, extra_aliases=extra_aliases)
        if not hit:
            return []
        resolved_key = str(hit["companyKey"])

    evidence: Dict[str, Any] = {
        "title": title,
        "platform": platform,
        "seenAt": captured,
    }
    if url is not None:
        evidence["url"] = url
    if snippet is not None:
        evidence["snippet"] = snippet
    if news_item_id is not None:
        evidence["newsItemId"] = news_item_id

    kinds = ["company_mention"] + classify_kinds(title, snippet)
    # de-dupe while preserving order
    seen = set()
    ordered: List[str] = []
    for kind in kinds:
        if kind in SIGNAL_KINDS and kind not in seen:
            seen.add(kind)
            ordered.append(kind)

    drafts: List[SignalDraft] = []
    for kind in ordered:
        drafts.append(
            SignalDraft(
                company_key=resolved_key,
                kind=kind,
                title=title,
                evidence=dict(evidence),
                captured_at=captured,
                summary=snippet,
                ingest_run_id=ingest_run_id,
            )
        )
    return drafts


def project_signals_for_items(
    items: Sequence[NormalizedNewsItem],
    resolver: AliasResolver,
    *,
    ingest_run_id: Optional[str] = None,
    news_item_ids: Optional[Dict[str, str]] = None,
    alias_hints: Optional[Dict[str, List[str]]] = None,
) -> tuple[List[SignalDraft], int, List[NormalizedNewsItem]]:
    """
    Project signals for a batch of news items.
    Returns (drafts, unresolved_mention_count, unresolved_items_with_candidates).
    Unresolved mentions are skipped (not emitted) and counted.
    """
    drafts: List[SignalDraft] = []
    unresolved = 0
    unresolved_items: List[NormalizedNewsItem] = []
    id_map = news_item_ids or {}
    hints = alias_hints or {}

    for item in items:
        extra = hints.get(item.content_hash) or hints.get(item.title) or []
        item_drafts = project_title(
            item.title,
            resolver=resolver,
            platform=item.platform,
            seen_at=item.captured_at,
            snippet=item.raw_snippet,
            url=item.url,
            news_item_id=id_map.get(item.content_hash),
            ingest_run_id=ingest_run_id,
            extra_aliases=list(extra) if extra else None,
        )
        if not item_drafts:
            # Only count as unresolved when we had extractable alias candidates
            from apps.worker.research_resolve import extract_candidate_aliases

            if extract_candidate_aliases(item.title, item.raw_snippet):
                unresolved += 1
                unresolved_items.append(item)
            continue
        drafts.extend(item_drafts)
    return drafts, unresolved, unresolved_items
