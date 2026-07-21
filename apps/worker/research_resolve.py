# coding=utf-8
"""
Company alias resolution for Research Eng via direct Convex companies:resolveAlias.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger(__name__)

# CJK runs and latin tokens; substring candidates help when company names sit inside titles.
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]{2,40}")
_LATIN_COMPANY_RE = re.compile(r"\b([A-Z][A-Za-z0-9&.\- ]{1,40})\b")
_COMPANY_SUFFIXES = (
    "有限公司",
    "股份有限公司",
    "集团",
    "机械",
    "科技",
    "实业",
    "控股",
    "股份",
)


class AliasResolver(Protocol):
    def resolve_alias(self, alias: str) -> Optional[Dict[str, Any]]: ...


def _cjk_substrings(run: str, *, max_len: int = 12) -> List[str]:
    """Prefer longer substrings first (alias tables usually store full brand names)."""
    n = len(run)
    out: List[str] = []
    for length in range(min(n, max_len), 1, -1):
        for start in range(0, n - length + 1):
            out.append(run[start : start + length])
    return out


def extract_candidate_aliases(title: str, snippet: Optional[str] = None) -> List[str]:
    text = f"{title} {snippet or ''}".strip()
    candidates: List[str] = []
    seen = set()

    def add(alias: str) -> None:
        alias = alias.strip()
        if alias and alias not in seen:
            seen.add(alias)
            candidates.append(alias)

    for run in _CJK_RUN_RE.findall(text):
        add(run)
        for suffix in _COMPANY_SUFFIXES:
            if suffix in run:
                # Prefer the span ending at the first company-ish suffix
                idx = run.find(suffix)
                add(run[: idx + len(suffix)])
        for sub in _cjk_substrings(run):
            add(sub)

    for match in _LATIN_COMPANY_RE.finditer(text):
        alias = match.group(1).strip()
        if len(alias) >= 2:
            add(alias)
    # Cap candidate fan-out for title-scale inputs
    return candidates[:48]


def resolve_first_company(
    resolver: AliasResolver,
    title: str,
    snippet: Optional[str] = None,
    *,
    extra_aliases: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Try extra aliases first, then industry surfaces in text (if resolver supports it),
    then extracted candidates.
    Returns resolveAlias row { companyKey, ... } or None.
    """
    aliases: List[str] = []
    seen = set()

    def add_many(items: List[str]) -> None:
        for alias in items:
            a = (alias or "").strip()
            if a and a not in seen:
                seen.add(a)
                aliases.append(a)

    add_many(list(extra_aliases or []))
    # Industry bridge: short brand CN (e.g. 发那科) inside long CJK runs
    present = getattr(resolver, "surfaces_present_in", None)
    if callable(present):
        try:
            add_many(list(present(title, snippet) or []))
        except Exception as error:  # noqa: BLE001
            logger.warning("surfaces_present_in failed: %s", error)
    add_many(extract_candidate_aliases(title, snippet))
    for alias in aliases:
        try:
            hit = resolver.resolve_alias(alias)
        except Exception as error:  # noqa: BLE001 — isolate resolver failures per alias
            logger.warning("resolveAlias failed for %r: %s", alias, error)
            continue
        if hit and hit.get("companyKey"):
            return hit
    return None
