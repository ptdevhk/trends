#!/usr/bin/env python3
"""Join an HR reference resume export to a current Trends export.

The stable join key is the job-board profile resume id, not Convex resume ids.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


PROFILE_ID_RE = re.compile(r"(?<!\d)(\d{6,12})(?!\d)")


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def first_value(row: dict[str, str], names: list[str]) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def profile_id_from_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    for key in ("resumeId", "resume_id", "profileResumeId"):
        values = query.get(key)
        if values and values[0].strip():
            return values[0].strip()
    match = PROFILE_ID_RE.search(value)
    return match.group(1) if match else ""


def profile_id(row: dict[str, str]) -> str:
    direct = first_value(
        row,
        [
            "Profile Resume ID",
            "profileResumeId",
            "profile_resume_id",
            "External ID",
            "externalId",
        ],
    )
    if direct and direct.isdigit():
        return direct

    url_value = first_value(row, ["Profile URL", "profileUrl", "profile_url"])
    from_url = profile_id_from_url(url_value)
    if from_url:
        return from_url

    if direct:
        match = PROFILE_ID_RE.search(direct)
        if match:
            return match.group(1)
    return ""


def parse_float(value: str) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    if value.is_integer():
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def current_final_ai_score(row: dict[str, str]) -> float | None:
    """Read the final product AI score from the current export row.

    Read order: explicit Final AI Score → finalAiScore → AI Score → aiScore → legacy fallback.
    """
    return parse_float(
        first_value(
            row,
            [
                "Final AI Score",
                "finalAiScore",
                "AI Score",
                "aiScore",
                "Current Final AI Score",
                "Current AI Score",
            ],
        )
    )


def current_related_exp_audit_factor(row: dict[str, str]) -> float | None:
    """Read the related-exp audit factor from the current export row.

    This is the raw/effective 0-100 factor from breakdown.related_exp,
    NOT the final AI score. Read order: explicit audit-factor columns →
    Related Exp → relatedExp → legacy Current AI Score fallback.
    """
    return parse_float(
        first_value(
            row,
            [
                "Related Exp Audit Factor",
                "relatedExpAuditFactor",
                "Related Exp",
                "relatedExp",
                "Current Related Exp",
                "Current AI Score",
            ],
        )
    )


def current_score(row: dict[str, str]) -> float | None:
    """Backward-compatible alias for current_final_ai_score."""
    return current_final_ai_score(row)


def old_score(row: dict[str, str]) -> float | None:
    return parse_float(first_value(row, ["Old AI Score", "AI Score", "aiScore"]))


def classify_alignment(category: str, score: float | None, threshold: float) -> str:
    normalized = category.strip().lower()
    if score is None:
        return "missing_ai_score"
    high = score >= threshold
    if normalized == "not_suitable":
        return "still_high_score" if high else "aligned_low"
    if normalized == "requires_field_office_confirmation":
        return "aligned_high" if high else "confirmation_below_threshold"
    if normalized == "strong_match":
        return "aligned_high" if high else "strong_below_threshold"
    if normalized == "former_employee":
        return "former_employee_high" if high else "former_employee_low"
    return "high_score" if high else "below_threshold"


def build_current_index(rows: list[dict[str, str]]) -> tuple[dict[str, dict[str, str]], dict[str, int]]:
    buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        pid = profile_id(row)
        if pid:
            buckets[pid].append(row)
    index = {pid: values[0] for pid, values in buckets.items()}
    duplicates = {pid: len(values) for pid, values in buckets.items() if len(values) > 1}
    return index, duplicates


def output_row(reference: dict[str, str], current: dict[str, str] | None, threshold: float) -> dict[str, str]:
    pid = profile_id(reference)
    old = old_score(reference)
    score = current_score(current or {})
    delta = None if old is None or score is None else score - old
    category = first_value(reference, ["HR Category", "hrCategory"])
    current_row = current or {}
    alignment = "missing_current_resume" if current is None else classify_alignment(category, score, threshold)

    # Full-score audit integration: separate final AI score from related-exp audit factor.
    # - Related Exp Audit Factor = breakdown.related_exp (raw/effective 0-100 factor)
    # - Final AI Score = round(related_exp * 0.5) + industry_db
    # - Related Exp Contribution = round(related_exp * 0.5)
    related_exp_audit_factor_raw = current_related_exp_audit_factor(current_row)
    related_exp_audit_factor = format_number(related_exp_audit_factor_raw)
    final_ai_score_raw = current_final_ai_score(current_row)
    final_ai_score = format_number(final_ai_score_raw)
    related_exp_contribution_raw = first_value(current_row, ["Related Exp Contribution", "relatedExpContribution"])
    industry_db_raw = first_value(current_row, ["Industry DB", "industryDb"])
    recommendation = first_value(current_row, ["Current Recommendation", "Recommendation", "recommendation"])

    # P1 evidence ceiling fields — present in exports after evidence ceiling is active;
    # absent in older exports (empty string fallback is safe for audit comparison).
    evidence_band_max = first_value(current_row, ["Evidence Band Max", "evidenceBandMax"])
    effective_related_exp = first_value(current_row, ["Effective Related Exp", "effectiveRelatedExp"])
    missing_reasons = first_value(current_row, ["Missing Reasons", "missingReasons"])

    return {
        "Old CSV Row": first_value(reference, ["Old CSV Row"]),
        "Old Resume ID": first_value(reference, ["Old Resume ID", "Resume ID", "resumeId"]),
        "Current Resume ID": first_value(current_row, ["Current Convex Resume ID", "Resume ID", "resumeId"]),
        "External ID": first_value(current_row, ["External ID", "externalId"]) or first_value(reference, ["External ID"]),
        "Profile Resume ID": pid,
        "Profile URL": first_value(current_row, ["Profile URL", "profileUrl"]) or first_value(reference, ["Profile URL"]),
        "Name": first_value(current_row, ["Name", "name"]) or first_value(reference, ["Name"]),
        "Age": first_value(current_row, ["Age", "age"]) or first_value(reference, ["Age"]),
        "Location": first_value(current_row, ["Location", "location"]) or first_value(reference, ["Location"]),
        "Source": first_value(current_row, ["Source", "source"]) or first_value(reference, ["Source"]),
        "HR Category": category,
        "HR Expected": first_value(reference, ["HR Expected"]),
        "HR Feedback": first_value(reference, ["HR Feedback"]),
        "HR Wiki Flag": first_value(reference, ["HR Wiki Flag"]),
        "Old AI Score": format_number(old),
        "Current AI Score": format_number(score),
        "Score Delta": format_number(delta),
        # Full-score audit fields
        "Current Final AI Score": final_ai_score,
        "Related Exp Audit Factor": related_exp_audit_factor,
        "Related Exp Contribution": related_exp_contribution_raw,
        "Industry DB": industry_db_raw,
        "Current Recommendation": recommendation,
        "Current Alignment": alignment,
        "Current Analysis Key": first_value(current_row, ["Current Analysis Key"]),
        "Current Job Description ID": first_value(current_row, ["Current Job Description ID"]),
        "Current Prompt Version": first_value(current_row, ["Current Prompt Version"]),
        "Current Analyzed At": first_value(current_row, ["Current Analyzed At"]),
        # Legacy column — kept for backward compatibility
        "Related Exp": related_exp_audit_factor,
        # P1 evidence ceiling fields
        "Evidence Band Max": evidence_band_max,
        "Effective Related Exp": effective_related_exp,
        "Missing Reasons": missing_reasons,
        "Score Source": first_value(current_row, ["Score Source", "scoreSource"]),
        "Status": first_value(current_row, ["Status", "status"]),
        "Action": first_value(current_row, ["Action", "action"]),
        "Role Evidence": first_value(current_row, ["Role Evidence", "roleEvidence"]),
        "Matched Work Entries": first_value(current_row, ["Matched Work Entries", "matchedWorkEntries"]),
        "Brand Hits": first_value(current_row, ["Brand Hits", "brandHits"]),
        "Company Hits": first_value(current_row, ["Company Hits", "companyHits"]),
        "Rule Score": first_value(current_row, ["Rule Score", "ruleScore"]),
        "Current AI Summary": first_value(current_row, ["Current AI Summary", "AI Summary", "aiSummary"]),
        "Current Highlights": first_value(current_row, ["Current Highlights"]),
        "Current Concerns": first_value(current_row, ["Current Concerns"]),
        "Work History": first_value(current_row, ["Work History", "workHistory"]) or first_value(reference, ["Work History"]),
        "Self Intro": first_value(current_row, ["Self Intro", "selfIntro"]) or first_value(reference, ["Self Intro"]),
    }


def summarize(rows: list[dict[str, str]], duplicates: dict[str, int], args: argparse.Namespace) -> dict[str, Any]:
    by_category: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_category[row["HR Category"] or "unknown"].append(row)

    categories: dict[str, Any] = {}
    for category, category_rows in sorted(by_category.items()):
        # Final AI scores
        final_scores = [parse_float(row.get("Current Final AI Score", row.get("Current AI Score", ""))) for row in category_rows]
        numeric_final_scores = [s for s in final_scores if s is not None]

        # Related-exp audit factors (0-100 raw/effective factor)
        audit_factors = [parse_float(row.get("Related Exp Audit Factor", row.get("Related Exp", ""))) for row in category_rows]
        numeric_audit_factors = [f for f in audit_factors if f is not None]

        # Industry DB values
        industry_db_values = [parse_float(row.get("Industry DB", "")) for row in category_rows]
        numeric_industry_db = [v for v in industry_db_values if v is not None]

        # P1 evidence ceiling stats
        evidence_band_max_values = [parse_float(row.get("Evidence Band Max", "")) for row in category_rows]
        numeric_evidence_band = [v for v in evidence_band_max_values if v is not None]

        categories[category] = {
            "count": len(category_rows),
            "matchedCurrent": sum(1 for row in category_rows if row["Current Alignment"] != "missing_current_resume"),
            "missingCurrent": sum(1 for row in category_rows if row["Current Alignment"] == "missing_current_resume"),
            # Final AI score stats
            "missingFinalAiScore": sum(1 for s in final_scores if s is None),
            "finalHighScoreCount": sum(1 for s in numeric_final_scores if s >= args.score_threshold),
            "finalScoreMin": min(numeric_final_scores) if numeric_final_scores else None,
            "finalScoreMedian": statistics.median(numeric_final_scores) if numeric_final_scores else None,
            "finalScoreMax": max(numeric_final_scores) if numeric_final_scores else None,
            # Related-exp audit-factor stats (gate metric)
            "missingRelatedExpAuditFactor": sum(1 for f in audit_factors if f is None),
            "relatedExpHighFactorCount": sum(1 for f in numeric_audit_factors if f >= args.score_threshold),
            "relatedExpFactorMin": min(numeric_audit_factors) if numeric_audit_factors else None,
            "relatedExpFactorMedian": statistics.median(numeric_audit_factors) if numeric_audit_factors else None,
            "relatedExpFactorMax": max(numeric_audit_factors) if numeric_audit_factors else None,
            # Backward-compat aliases
            "missingAiScore": sum(1 for s in final_scores if s is None),
            "highScoreCount": sum(1 for f in numeric_audit_factors if f >= args.score_threshold),
            "scoreMin": min(numeric_audit_factors) if numeric_audit_factors else None,
            "scoreMedian": statistics.median(numeric_audit_factors) if numeric_audit_factors else None,
            "scoreMax": max(numeric_audit_factors) if numeric_audit_factors else None,
            "alignmentCounts": dict(Counter(row["Current Alignment"] for row in category_rows)),
            # Industry DB
            "industryDbMin": min(numeric_industry_db) if numeric_industry_db else None,
            "industryDbMedian": statistics.median(numeric_industry_db) if numeric_industry_db else None,
            "industryDbMax": max(numeric_industry_db) if numeric_industry_db else None,
            # P1 evidence ceiling stats (empty when evidence ceiling not yet active)
            **({"evidenceBandStats": {
                "count": len(numeric_evidence_band),
                "bands": dict(Counter(str(int(v)) if v is not None else "missing" for v in evidence_band_max_values)),
            }} if numeric_evidence_band else {}),
        }

    return {
        "referenceCsv": str(args.reference_csv),
        "currentExport": str(args.current_export),
        "outputCsv": str(args.out_csv),
        "scoreThreshold": args.score_threshold,
        "expectedCount": args.expected_count,
        "actualCount": len(rows),
        "countMatchesExpected": args.expected_count is None or len(rows) == args.expected_count,
        "duplicateCurrentProfileIds": duplicates,
        # Full-score audit integration: explicit scoring model declaration
        "scoringModel": "final=round(related_exp*0.5)+industry_db; auditFactor=related_exp",
        "finalScoreMetric": "Final AI Score",
        "auditFactorMetric": "Related Exp Audit Factor",
        "categories": categories,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-csv", type=Path, required=True)
    parser.add_argument("--current-export", type=Path, required=True)
    parser.add_argument("--out-csv", type=Path, required=True)
    parser.add_argument("--out-json", type=Path, required=True)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--score-threshold", type=float, default=80.0)
    parser.add_argument("--exclude-profile-id", action="append", default=[])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    reference_rows = read_csv(args.reference_csv)
    current_rows = read_csv(args.current_export)
    current_index, duplicates = build_current_index(current_rows)
    excluded = set(args.exclude_profile_id)

    joined: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for reference in reference_rows:
        pid = profile_id(reference)
        if not pid:
            skipped.append({"reason": "missing_profile_id", "row": str(reference)})
            continue
        if pid in excluded:
            skipped.append({"reason": "excluded_profile_id", "profileResumeId": pid})
            continue
        joined.append(output_row(reference, current_index.get(pid), args.score_threshold))

    args.out_csv.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(joined[0].keys()) if joined else []
    with args.out_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(joined)

    summary = summarize(joined, duplicates, args)
    summary["skippedReferenceRows"] = skipped
    with args.out_json.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.expected_count is not None and len(joined) != args.expected_count:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
