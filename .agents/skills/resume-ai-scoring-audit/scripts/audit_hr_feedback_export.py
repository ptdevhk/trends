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


def current_score(row: dict[str, str]) -> float | None:
    return parse_float(
        first_value(
            row,
            [
                "Current AI Score",
                "AI Score",
                "aiScore",
                "Gate AI Score",
                "Stored AI Score",
            ],
        )
    )


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
        "Current Recommendation": first_value(current_row, ["Current Recommendation", "Recommendation", "recommendation"]),
        "Current Alignment": alignment,
        "Current Analysis Key": first_value(current_row, ["Current Analysis Key"]),
        "Current Job Description ID": first_value(current_row, ["Current Job Description ID"]),
        "Current Prompt Version": first_value(current_row, ["Current Prompt Version"]),
        "Current Analyzed At": first_value(current_row, ["Current Analyzed At"]),
        "Industry DB": first_value(current_row, ["Industry DB", "industryDb"]),
        "Related Exp": first_value(current_row, ["Related Exp", "relatedExp", "Display Related Exp"]),
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
        scores = [parse_float(row["Current AI Score"]) for row in category_rows]
        numeric_scores = [score for score in scores if score is not None]
        categories[category] = {
            "count": len(category_rows),
            "matchedCurrent": sum(1 for row in category_rows if row["Current Alignment"] != "missing_current_resume"),
            "missingCurrent": sum(1 for row in category_rows if row["Current Alignment"] == "missing_current_resume"),
            "missingAiScore": sum(1 for row in category_rows if row["Current Alignment"] == "missing_ai_score"),
            "highScoreCount": sum(1 for score in numeric_scores if score >= args.score_threshold),
            "scoreMin": min(numeric_scores) if numeric_scores else None,
            "scoreMedian": statistics.median(numeric_scores) if numeric_scores else None,
            "scoreMax": max(numeric_scores) if numeric_scores else None,
            "alignmentCounts": dict(Counter(row["Current Alignment"] for row in category_rows)),
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
