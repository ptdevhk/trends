# coding=utf-8
"""Industry classification logic and trust/source order constants."""

from __future__ import annotations

from typing import Any, Dict

SOURCE_ORDER = {
    "official_site": 0,
    "registry": 1,
    "taxonomy": 2,
    "oem_partner": 3,
    "trade_body": 4,
    "directory": 5,
    "reporting": 6,
    "other": 7,
    "search_result": 8,
}

TRUST_ORDER = {
    "primary": 0,
    "authoritative": 1,
    "corroborating": 2,
    "discovery": 3,
}


def classify_industry_excerpt(text: str) -> Dict[str, Any]:
    normalized = text.casefold()
    scores = {
        "cnc": sum(
            keyword in normalized
            for keyword in (
                "cnc",
                "machining centre",
                "machining center",
                "machine tool",
                "数控",
                "加工中心",
            )
        ),
        "automation": sum(
            keyword in normalized
            for keyword in ("automation", "robotics", "plc", "自动化", "机器人")
        ),
        "metrology": sum(
            keyword in normalized
            for keyword in ("metrology", "measurement", "cmm", "计量", "测量")
        ),
        "industrial": sum(
            keyword in normalized
            for keyword in ("industrial", "machinery", "manufacturing", "工业", "机械")
        ),
    }
    best_class, best_score = max(scores.items(), key=lambda item: (item[1], item[0]))
    if best_score <= 0:
        return {"industryClass": "unknown", "confidence": 0.2}
    confidence = min(0.95, 0.55 + best_score * 0.12)
    return {"industryClass": best_class, "confidence": round(confidence, 2)}


__all__ = [
    "SOURCE_ORDER",
    "TRUST_ORDER",
    "classify_industry_excerpt",
]
