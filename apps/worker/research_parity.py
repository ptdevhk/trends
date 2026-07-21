# coding=utf-8
"""Research Eng parity decision (mirrors packages/shared/src/research/parity.ts)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

AGGREGATE_RATIO_THRESHOLD = 0.8


def _safe_ratio(native: int, shadow: int) -> float:
    if shadow <= 0:
        return 1.0
    return native / shadow


def evaluate_research_parity(
    platform_breakdown: Sequence[Dict[str, Any]],
    golden_companies: Sequence[Dict[str, Any]],
    *,
    native_total: Optional[int] = None,
    shadow_total: Optional[int] = None,
) -> Dict[str, Any]:
    platforms: List[Dict[str, Any]] = []
    for row in platform_breakdown:
        native = int(row.get("nativeCount", row.get("native_count", 0)))
        shadow = int(row.get("shadowCount", row.get("shadow_count", 0)))
        platform = str(row.get("platform", ""))
        zero_with_shadow = shadow > 0 and native == 0
        platforms.append(
            {
                "platform": platform,
                "nativeCount": native,
                "shadowCount": shadow,
                "ratio": _safe_ratio(native, shadow),
                "zeroWithShadow": zero_with_shadow,
            }
        )

    computed_native = sum(p["nativeCount"] for p in platforms)
    computed_shadow = sum(p["shadowCount"] for p in platforms)
    n_total = computed_native if native_total is None else int(native_total)
    s_total = computed_shadow if shadow_total is None else int(shadow_total)
    aggregate_ratio = _safe_ratio(n_total, s_total)

    golden_results = []
    for g in golden_companies:
        key = str(g.get("companyKey", g.get("company_key", "")))
        count = int(g.get("signalCount", g.get("signal_count", 0)))
        golden_results.append(
            {"companyKey": key, "signalCount": count, "pass": count >= 1}
        )

    native_non_empty = n_total > 0
    reasons: List[str] = []
    if aggregate_ratio < AGGREGATE_RATIO_THRESHOLD:
        reasons.append(f"aggregateRatio {aggregate_ratio:.3f} < {AGGREGATE_RATIO_THRESHOLD}")
    for p in platforms:
        if p["zeroWithShadow"]:
            reasons.append(f"platform {p['platform']} has shadow without native")
    for g in golden_results:
        if not g["pass"]:
            reasons.append(f"golden company {g['companyKey']} has no signals")
    if not native_non_empty:
        reasons.append("native ingest empty")

    green = (
        aggregate_ratio >= AGGREGATE_RATIO_THRESHOLD
        and not any(p["zeroWithShadow"] for p in platforms)
        and all(g["pass"] for g in golden_results)
        and native_non_empty
    )

    return {
        "nativeTotal": n_total,
        "shadowTotal": s_total,
        "aggregateRatio": aggregate_ratio,
        "platformBreakdown": platforms,
        "goldenCompanyResults": golden_results,
        "nativeNonEmpty": native_non_empty,
        "green": green,
        "reasons": reasons,
    }


def next_green_streak(previous: int, green: bool) -> int:
    if not green:
        return 0
    return max(0, int(previous)) + 1
