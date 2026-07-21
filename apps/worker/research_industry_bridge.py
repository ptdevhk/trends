# coding=utf-8
"""
Industry-data → research companyKey bridge (mirrors apps/api research-industry-bridge).

New keys use brandCanonicalKey (e.g. FANUC → fanuc).
Legacy overrides: 宝力机械 → pro-technic-machinery, 宝惠 → polywell.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

LEGACY_OVERRIDES: List[Dict[str, Any]] = [
    {
        "companyKey": "pro-technic-machinery",
        "nameCn": "宝力机械",
        "nameEn": "Pro-Technic Machinery",
        "surfaces": [
            "宝力机械",
            "宝力机械有限公司",
            "Pro-Technic",
            "Pro-Technic Machinery",
        ],
    },
    {
        "companyKey": "polywell",
        "nameCn": "宝惠",
        "nameEn": "Polywell",
        "surfaces": ["宝惠", "Polywell", "Polywell Machinery"],
    },
]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def normalize_surface(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.casefold()
    text = re.sub(r"[\s\u00A0]+", "", text)
    text = re.sub(r"[^\w]+", "", text, flags=re.UNICODE)
    return text.strip()


def brand_canonical_key(brand: Dict[str, Any]) -> str:
    en = str(brand.get("nameEn") or "").strip()
    if en and re.match(r"^[A-Za-z0-9]+$", en) and re.search(r"[A-Za-z]", en):
        return en.lower()
    cn = str(brand.get("nameCn") or "").strip()
    return normalize_surface(cn) or str(brand.get("id", ""))


def brand_alias_surfaces(brand: Dict[str, Any]) -> List[str]:
    surfaces: List[str] = []
    for key in ("nameCn", "nameEn"):
        val = brand.get(key)
        if isinstance(val, str) and val.strip():
            surfaces.append(val.strip())
    aliases = brand.get("aliases") or []
    if isinstance(aliases, list):
        for a in aliases:
            if isinstance(a, str) and a.strip():
                surfaces.append(a.strip())
    return surfaces


def load_brands(project_root: Optional[Path] = None) -> List[Dict[str, Any]]:
    root = project_root or _project_root()
    path = root / "config" / "industry-data" / "brands.json"
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def find_legacy_override(surface: str) -> Optional[Dict[str, Any]]:
    key = normalize_surface(surface)
    if not key:
        return None
    for row in LEGACY_OVERRIDES:
        for s in row["surfaces"]:
            if normalize_surface(s) == key:
                return row
        if normalize_surface(row["companyKey"]) == key:
            return row
        if normalize_surface(row["nameCn"]) == key:
            return row
        en = row.get("nameEn")
        if en and normalize_surface(str(en)) == key:
            return row
    return None


def resolve_brand_exact(surface: str, brands: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    key = normalize_surface(surface)
    if not key:
        return None
    for brand in brands:
        for alias in brand_alias_surfaces(brand):
            if normalize_surface(alias) == key:
                return brand
    return None


def map_surface_to_research_company(
    surface: str,
    brands: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Returns { companyKey, nameCn, nameEn?, source } or None on miss.
    """
    raw = (surface or "").strip()
    if not raw:
        return None

    override = find_legacy_override(raw)
    if override:
        hit: Dict[str, Any] = {
            "companyKey": override["companyKey"],
            "nameCn": override["nameCn"],
            "source": "override",
            "matchTier": "override",
        }
        if override.get("nameEn"):
            hit["nameEn"] = override["nameEn"]
        return hit

    brand_list = list(brands) if brands is not None else load_brands()
    brand = resolve_brand_exact(raw, brand_list)
    if not brand:
        return None
    key = brand_canonical_key(brand)
    if not key:
        return None
    hit = {
        "companyKey": key,
        "nameCn": str(brand.get("nameCn") or ""),
        "source": "resolveEntity",
        "matchTier": "exact",
    }
    if brand.get("nameEn"):
        hit["nameEn"] = str(brand["nameEn"])
    return hit


def surfaces_present_in_text(
    title: str,
    snippet: Optional[str] = None,
    brands: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[str]:
    """
    Return industry/legacy surfaces that appear as substrings in title/snippet.
    Prefer longer surfaces first so full names beat short tokens.
    """
    text = f"{title} {snippet or ''}"
    text_norm = text  # substring search on original (CN case-sensitive ok)
    text_lower = text.casefold()
    found: List[tuple[int, str]] = []
    seen = set()

    def consider(surface: str) -> None:
        s = surface.strip()
        if len(s) < 2 or s in seen:
            return
        if s in text_norm or s.casefold() in text_lower:
            seen.add(s)
            found.append((len(s), s))

    for row in LEGACY_OVERRIDES:
        for s in row["surfaces"]:
            consider(str(s))
        consider(str(row["nameCn"]))
        if row.get("nameEn"):
            consider(str(row["nameEn"]))

    brand_list = list(brands) if brands is not None else load_brands()
    for brand in brand_list:
        for s in brand_alias_surfaces(brand):
            consider(s)

    found.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in found]


class IndustryBridgeResolver:
    """
    AliasResolver-compatible: resolve_alias first tries industry bridge, returns Convex-shaped hit.
    Also exposes surfaces_present_in for title-level brand detection (short CN brands inside long runs).
    """

    def __init__(
        self,
        brands: Optional[Sequence[Dict[str, Any]]] = None,
        *,
        fallback: Optional[Any] = None,
    ):
        self._brands = list(brands) if brands is not None else load_brands()
        self._fallback = fallback

    def surfaces_present_in(self, title: str, snippet: Optional[str] = None) -> List[str]:
        return surfaces_present_in_text(title, snippet, self._brands)

    def resolve_alias(self, alias: str) -> Optional[Dict[str, Any]]:
        hit = map_surface_to_research_company(alias, self._brands)
        if hit and hit.get("companyKey"):
            return {
                "companyKey": hit["companyKey"],
                "displayName": hit.get("nameCn") or hit["companyKey"],
                "nameCn": hit.get("nameCn"),
                "nameEn": hit.get("nameEn"),
            }
        if self._fallback is not None:
            return self._fallback.resolve_alias(alias)
        return None
