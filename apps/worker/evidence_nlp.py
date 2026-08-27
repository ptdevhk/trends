# coding=utf-8
"""HTML/JSON-LD parsing, NLP regexes, and legal name normalization for evidence research."""

from __future__ import annotations

import html
import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_EXCERPT_LENGTH = 800

IDENTITY_LEGAL_SUFFIX_RE = re.compile(
    r"\b(?P<suffix>"
    r"SDN\.?\s+BHD\.?|"
    r"PTE\.?\s+LTD\.?|PTY\.?\s+LTD\.?|"
    r"COMPANY\s+LIMITED|GESELLSCHAFT\s+MIT\s+BESCHRAENKTER\s+HAFTUNG|"
    r"LIMITED|CORPORATION|BERHAD\.?|GMBH\.?|"
    r"BHD\.?|LTD\.?|LLC\.?|LLP\.?|PLC\.?|INC\.?|CORP\.?|CO\.?\s*,?\s*LTD\.?|"
    r"AB\.?|AS\.?|AG\.?|BV\.?|NV\.?|KK\.?|SA\.?"
    r")\b",
    re.IGNORECASE,
)
# CN registrant names: contiguous CJK run ending in a CN legal-form suffix.
# The ASCII legal-suffix extractor cannot see them, so CN registry evidence
# (shuidi/qcc excerpts) would otherwise produce no identity candidate and the
# human cockpit could never map the proposal to a canonical company.
_CJK_COMPANY_NAME_RE = re.compile(
    r"[一-鿿]{2,60}?(?:有限公司|股份有限公司|集团有限公司|有限责任公司|"
    r"机械有限公司|科技有限公司|电子有限公司|贸易有限公司|机电有限公司|"
    r"设备有限公司|自动化有限公司|工业有限公司|电气有限公司|"
    r"集团|厂|机械厂|公司)",
)
IDENTITY_NAME_RE = re.compile(
    r"\b([A-Za-z0-9][A-Za-z0-9&.,'()\-/ ]{2,100}?\s+"
    + IDENTITY_LEGAL_SUFFIX_RE.pattern
    + r")",
    re.IGNORECASE,
)
# Copyright lines carry the registrant's legal name most reliably; the
# captured span deliberately excludes a leading 4-digit year.
_COPYRIGHT_LEGAL_NAME_RE = re.compile(
    r"(?:(?:copyright\s*)?(?:©|&copy;)|\(c\)|\(C\)|copyright)"
    r"\s*(?:\d{4}\s*)?"
    r"([A-Za-z0-9][A-Za-z0-9&.,'()\-/ ]{2,100}?\s+"
    + IDENTITY_LEGAL_SUFFIX_RE.pattern
    + r")",
    re.IGNORECASE,
)


def _normalize_identity_name(value: str) -> str:
    """Normalize a legal-name candidate without claiming canonical identity."""
    normalized = re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip(" ,;:-()")
    normalized = re.sub(r"\s+\.", ".", normalized)
    normalized = re.sub(r"\.\s+", ". ", normalized)
    normalized = re.sub(r"\s*,\s*", ", ", normalized)
    if re.search(r"\b(?:SDN\.?\s+BHD|PTE\.?\s+LTD)$", normalized, re.IGNORECASE):
        normalized += "."
    return normalized.upper()


_PAGE_CHROME_TOKENS = frozenset(
    {
        "home", "about", "contact", "skip", "menu", "search", "login", "sign",
        "back", "page", "main", "footer", "learn", "more",
        "read", "terms", "privacy", "policy", "copyright", "reserved",
        "welcome", "browse", "close", "open", "content", "products",
        "services", "solutions", "legal", "name", "us", "our", "the", "and",
        "for", "with", "from",
    }
)


def _trim_page_chrome(value: str) -> str:
    """Drop leading page-chrome tokens from a captured legal-name span.

    IDENTITY_NAME_RE captures from the leftmost word to the legal suffix, so
    "Home About Us Contact LBSB SDN BHD." arrives as one span; the chrome
    prefix is not part of the legal name. Deterministic and conservative: only
    leading tokens from the chrome vocabulary (and bare 4-digit years, which
    precede footer copyright names) are removed, and at least two tokens
    always remain.
    """
    tokens = value.split()
    while len(tokens) > 2 and (
        tokens[0].strip(".,;:()").lower() in _PAGE_CHROME_TOKENS
        or re.fullmatch(r"\d{4}", tokens[0].strip(".,;:()"))
    ):
        tokens = tokens[1:]
    return " ".join(tokens)


def _suffix_case_ok(match) -> bool:
    """Short legal suffixes (AB/AS/AG/BV/NV/KK/SA/BHD/LTD/LLC/…) must be
    capitalized in the original text: the case-insensitive matcher would
    otherwise treat prose words like "as" or "ag" as suffixes."""
    suffix = match.group("suffix")
    if len(suffix) <= 3 and not suffix[0].isupper():
        return False
    return True


def _find_legal_names(text: str) -> List[str]:
    """Every legal-suffix name in page text, copyright lines first.

    Footer copyright lines ("© 2024 Alfa Laval AB") carry the registrant's
    legal name most reliably, so they are yielded before generic suffix
    matches. Each candidate is normalized, chrome-trimmed, deduplicated, and
    bounded to the same 8-80 char window the candidate pipeline accepts.
    Review-only: nothing here maps or approves identity.

    CJK registrant names (CN market) carry no ASCII legal suffix, so they
    are captured separately: a contiguous CJK company-name span (2-40 chars,
    ending in a CN legal-form suffix like 有限公司/股份有限公司/厂/集团) is
    yielded as a candidate before the ASCII regexes run.
    """
    source = str(text or "")
    names: List[str] = []
    seen: set = set()
    for match in _CJK_COMPANY_NAME_RE.finditer(source):
        candidate = match.group(0).strip()
        if 4 <= len(candidate) <= 80 and candidate not in seen:
            seen.add(candidate)
            names.append(candidate)
    for match in _COPYRIGHT_LEGAL_NAME_RE.finditer(source):
        if not _suffix_case_ok(match):
            continue
        # Copyright captures start right after the ©/year marker, so there is
        # no leading chrome to trim — and trimming would destroy registered
        # names that begin with an article (e.g. "The Store (Malaysia) Sdn.
        # Bhd.").
        candidate = _normalize_identity_name(match.group(1))
        if 8 <= len(candidate) <= 80 and candidate not in seen:
            seen.add(candidate)
            names.append(candidate)
    for match in IDENTITY_NAME_RE.finditer(source):
        if not _suffix_case_ok(match):
            continue
        candidate = _normalize_identity_name(_trim_page_chrome(match.group(1)))
        if 8 <= len(candidate) <= 80 and candidate not in seen:
            seen.add(candidate)
            names.append(candidate)
    return names


def _find_first_legal_name(text: str) -> Optional[str]:
    """First legal-suffix name in page text (footers/contact sections often
    carry the legal name beyond the excerpt window).

    Returns a normalized legal name bounded to the same 8-80 char window the
    candidate pipeline accepts, or None. Review-only: nothing here maps or
    approves identity.
    """
    names = _find_legal_names(text)
    return names[0] if names else None


def _excerpt_with_legal_name(excerpt: str, text: str) -> str:
    """Append a bounded ``Legal name:`` line to an excerpt when the full page
    text contains a legal-suffix name the excerpt window did not cover.

    The appended line is verbatim page content, so the stored excerpt stays a
    truthful bounded extract while the identity pipeline can see footer legal
    names. No-op when the name is already inside the excerpt or the line would
    exceed a bounded length.
    """
    legal_name = _find_first_legal_name(text)
    if not legal_name:
        return excerpt
    if legal_name in excerpt.upper():
        return excerpt
    legal_line = f"Legal name: {legal_name}"
    if len(legal_line) > 160:
        return excerpt
    return f"{excerpt}\n{legal_line}"


_LEGAL_SUFFIX_TOKENS = frozenset(
    {"sdn", "bhd", "pte", "ltd", "limited", "inc", "corp", "corporation", "co"}
)


def _walk_json_ld_nodes(node: Any):
    """Depth-first walk of parsed JSON-LD, yielding every object node."""
    if isinstance(node, list):
        for child in node:
            yield from _walk_json_ld_nodes(child)
    elif isinstance(node, dict):
        yield node
        graph = node.get("@graph")
        if graph is not None:
            yield from _walk_json_ld_nodes(graph)
        for key, value in node.items():
            if key.startswith("@") or key == "@graph":
                continue
            if isinstance(value, (dict, list)):
                yield from _walk_json_ld_nodes(value)


def _json_ld_org_names(raw: str) -> List[Dict[str, str]]:
    """Schema.org Organization names/alternateNames from JSON-LD script blocks.

    Legal names frequently live only in ``<script type="application/ld+json">``
    markup, which the plain-text extractor strips. Returns at most four
    ``{"name", "alternateName"}`` entries; review-only, never a mapping.
    """
    orgs: List[Dict[str, str]] = []
    for block in re.findall(
        r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
        str(raw or ""),
        flags=re.IGNORECASE | re.DOTALL,
    ):
        try:
            data = json.loads(block)
        except (ValueError, TypeError):
            continue
        for item in _walk_json_ld_nodes(data):
            type_value = item.get("@type") if isinstance(item, dict) else None
            types = type_value if isinstance(type_value, list) else [type_value]
            if "Organization" not in types:
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            alternate = str(item.get("alternateName") or "").strip()
            orgs.append({"name": name, "alternateName": alternate})
            if len(orgs) >= 4:
                return orgs
    return orgs


def _excerpt_with_organization_names(excerpt: str, raw: str) -> str:
    """Append bounded schema.org Organization lines to a fetched excerpt.

    JSON-LD script content is stripped by the text extractor, so append the
    organization's own name (and alternateName when present) as a structured
    line the identity pipeline can read. Verbatim page data, capped at two
    organizations and one line each.
    """
    lines = []
    for org in _json_ld_org_names(raw)[:2]:
        name = _normalize_identity_name(org["name"])
        if len(name) < 8 or len(name) > 80:
            continue
        line = f"Organization name: {name}"
        alternate = re.sub(r"\s+", " ", org.get("alternateName") or "").strip()
        if alternate and len(alternate) <= 80:
            line += f" | alt: {alternate.upper()}"
        lines.append(line)
    if not lines:
        return excerpt
    return f"{excerpt}\n" + "\n".join(lines)


def _identity_org_from_excerpt(evidence_excerpt: str) -> Optional[tuple]:
    """``(organization_name, alternate_name)`` from an appended
    ``Organization name:`` line, or None."""
    for line in str(evidence_excerpt or "").splitlines():
        match = re.match(
            r"^Organization name: (.+?)(?: \| alt: (.+))?$",
            line.strip(),
        )
        if match:
            return (match.group(1).strip(), (match.group(2) or "").strip())
    return None


def _distinctive_employer_tokens(employer_surface: str) -> set:
    """Distinctive employer tokens; lazy import keeps web_research out of the
    import graph when discovery is disabled (same pattern as
    ``_candidate_content_proves_employer``)."""
    from apps.worker.web_research.classify import distinctive_employer_tokens

    return distinctive_employer_tokens(employer_surface)


def _name_overlap_passes(
    employer_surface: str,
    surface_tokens: List[str],
    legal_name: str,
) -> bool:
    """Distinctive-token overlap gate shared by regex and org-line candidates.

    A legal name sharing any non-generic token with the employer surface is a
    viable candidate; fully generic surfaces fall back to a stricter
    two-token rule. Legal-suffix tokens never count toward overlap.

    CJK surfaces and CJK legal names compare by exact character overlap (a
    registrant sharing any 2+ char run with the employer surface is a viable
    candidate; the suffix 公司/有限 is never distinctive).
    """
    if re.search(r"[\u4e00-\u9fff]", employer_surface) or re.search(
        r"[\u4e00-\u9fff]", legal_name
    ):
        surface_cjk = set(re.findall(r"[\u4e00-\u9fff]", employer_surface))
        name_cjk = set(re.findall(r"[\u4e00-\u9fff]", legal_name))
        shared = surface_cjk & name_cjk
        # A short shared run (e.g. 科技) is not distinctive; require at least
        # two shared characters beyond the generic 公司/有限/股份 suffix, or
        # a longer shared run when the surface itself is short.
        generic = set("公司有限股份集团")
        distinctive_shared = shared - generic
        if len(distinctive_shared) >= 2:
            return True
        if len(surface_cjk) <= 4:
            return len(shared) >= 2
        return False
    name_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", legal_name.lower())
        if len(token) > 2 and token not in _LEGAL_SUFFIX_TOKENS
    }
    if not name_tokens:
        return False
    distinctive = _distinctive_employer_tokens(employer_surface)
    if distinctive:
        return any(token in name_tokens for token in distinctive)
    return (
        sum(
            token in name_tokens
            for token in surface_tokens
            if len(token) > 2 and token not in _LEGAL_SUFFIX_TOKENS
        )
        >= 2
    )


def _text_from_html(raw: str) -> str:
    without_scripts = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>",
        " ",
        raw,
        flags=re.IGNORECASE | re.DOTALL,
    )
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _title_from_html(raw: str) -> Optional[str]:
    match = re.search(r"<title\b[^>]*>(.*?)</title>", raw, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()
    return title[:300] or None


__all__ = [
    "IDENTITY_LEGAL_SUFFIX_RE",
    "IDENTITY_NAME_RE",
    "MAX_EXCERPT_LENGTH",
]
