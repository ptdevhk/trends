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
    query = {key.lower(): values for key, values in parse_qs(parsed.query).items()}
    for key in ("resumeid", "resume_id", "profileresumeid", "openprofileid"):
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


def external_id(row: dict[str, str]) -> str:
    value = first_value(row, ["External ID", "externalId", "external_id"])
    return value.lower()


def is_placeholder_external_id(value: str) -> bool:
    return value.strip().lower() in {"unknown", "externalid:unknown"}


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


def build_external_index(rows: list[dict[str, str]]) -> tuple[dict[str, dict[str, str]], dict[str, int]]:
    buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        value = external_id(row)
        if value and not is_placeholder_external_id(value):
            buckets[value].append(row)
    index = {value: rows_for_value[0] for value, rows_for_value in buckets.items()}
    duplicates = {
        value: len(rows_for_value)
        for value, rows_for_value in buckets.items()
        if len(rows_for_value) > 1
    }
    return index, duplicates


def current_row_id(row: dict[str, str]) -> str:
    return first_value(
        row,
        ["Current Convex Resume ID", "Current Resume ID", "Resume ID", "resumeId"],
    )


def resolve_current_row(
    reference: dict[str, str],
    current_index: dict[str, dict[str, str]],
    duplicates: dict[str, int],
    external_index: dict[str, dict[str, str]],
    external_duplicates: dict[str, int],
    row_number: int,
    *,
    require_match: bool,
) -> dict[str, str] | None:
    pid = profile_id(reference)
    external = external_id(reference)
    if external and is_placeholder_external_id(external):
        raise ValueError(f"reference row {row_number} has placeholder external ID {external}")

    matched: list[tuple[str, dict[str, str]]] = []
    missing: list[str] = []
    if pid:
        if duplicates.get(pid, 0) > 1:
            raise ValueError(
                f"profile resume ID {pid} matches multiple current resumes ({duplicates[pid]})"
            )
        current = current_index.get(pid)
        if current is None:
            missing.append(f"profile resume ID {pid}")
        else:
            matched.append((f"profile resume ID {pid}", current))

    if external:
        if external_duplicates.get(external, 0) > 1:
            raise ValueError(
                f"external ID {external} matches multiple current resumes ({external_duplicates[external]})"
            )
        current = external_index.get(external)
        if current is None:
            missing.append(f"external ID {external}")
        else:
            matched.append((f"external ID {external}", current))

    if matched and missing:
        raise ValueError(
            f"reference row {row_number} stable selectors do not converge: "
            f"{', '.join(missing)} did not match"
        )
    if len(matched) > 1:
        first_label, first_row = matched[0]
        first_id = current_row_id(first_row)
        for label, row in matched[1:]:
            row_id = current_row_id(row)
            same_row = row is first_row or (first_id and row_id and first_id == row_id)
            if not same_row:
                raise ValueError(
                    f"reference row {row_number} stable selectors conflict: "
                    f"{first_label} resolves to {first_id or '<unknown>'}, "
                    f"but {label} resolves to {row_id or '<unknown>'}"
                )
    if matched:
        return matched[0][1]
    if require_match and (pid or external):
        raise ValueError(
            f"reference row {row_number} stable selectors did not match any current resume"
        )
    return None


def build_target_manifest(
    reference_rows: list[dict[str, str]],
    current_index: dict[str, dict[str, str]],
    duplicates: dict[str, int],
    excluded: set[str],
    external_index: dict[str, dict[str, str]] | None = None,
    external_duplicates: dict[str, int] | None = None,
) -> dict[str, Any]:
    external_index = external_index or {}
    external_duplicates = external_duplicates or {}
    targets: list[dict[str, str]] = []
    for row_number, reference in enumerate(reference_rows, start=1):
        pid = profile_id(reference)
        if pid in excluded:
            continue
        current = resolve_current_row(
            reference,
            current_index,
            duplicates,
            external_index,
            external_duplicates,
            row_number,
            require_match=True,
        ) or {}
        target = {
            "referenceResumeId": first_value(
                reference,
                ["Old Resume ID", "Reference Resume ID", "Resume ID", "resumeId"],
            ),
            "currentResumeId": first_value(
                current,
                ["Current Convex Resume ID", "Current Resume ID", "Resume ID", "resumeId"],
            ),
            "profileResumeId": pid,
            "profileUrl": first_value(current, ["Profile URL", "profileUrl", "profile_url"])
            or first_value(reference, ["Profile URL", "profileUrl", "profile_url"]),
            "externalId": first_value(current, ["External ID", "externalId"])
            or first_value(reference, ["External ID", "externalId"]),
            "identityKey": first_value(
                current,
                ["Canonical Identity Key", "Identity Key", "identityKey"],
            )
            or first_value(
                reference,
                ["Canonical Identity Key", "Identity Key", "identityKey"],
            ),
            "source": first_value(current, ["Source", "source"])
            or first_value(reference, ["Source", "source"]),
        }
        target = {key: value for key, value in target.items() if value}
        if not any(target.get(key) for key in ("profileResumeId", "profileUrl", "externalId", "identityKey")):
            raise ValueError(f"reference row {row_number} is missing stable identity")
        targets.append(target)

    if not targets:
        raise ValueError("target manifest contains no resolvable rows")
    return {
        "version": 1,
        "generatedBy": "resume-ai-scoring-audit",
        "targets": targets,
    }


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


def summarize(
    rows: list[dict[str, str]],
    duplicates: dict[str, int],
    args: argparse.Namespace,
    external_duplicates: dict[str, int] | None = None,
) -> dict[str, Any]:
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
        "duplicateCurrentExternalIds": external_duplicates or {},
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
    parser.add_argument("--out-manifest", type=Path)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--score-threshold", type=float, default=80.0)
    parser.add_argument("--exclude-profile-id", action="append", default=[])
    return parser.parse_args()


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp")
    try:
        with temporary_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    reference_rows = read_csv(args.reference_csv)
    current_rows = read_csv(args.current_export)
    current_index, duplicates = build_current_index(current_rows)
    external_index, external_duplicates = build_external_index(current_rows)
    excluded = set(args.exclude_profile_id)

    if args.out_manifest is not None:
        args.out_manifest.unlink(missing_ok=True)

    manifest: dict[str, Any] | None = None
    if args.out_manifest is not None:
        try:
            manifest = build_target_manifest(
                reference_rows,
                current_index,
                duplicates,
                excluded,
                external_index=external_index,
                external_duplicates=external_duplicates,
            )
        except ValueError as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False, indent=2))
            return 3

    joined: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for row_number, reference in enumerate(reference_rows, start=1):
        pid = profile_id(reference)
        if pid in excluded:
            skipped.append({"reason": "excluded_profile_id", "profileResumeId": pid})
            continue
        reference_external_id = external_id(reference)
        has_stable_identity = bool(
            pid
            or reference_external_id
            or first_value(reference, ["Profile URL", "profileUrl", "profile_url"])
            or first_value(reference, ["Canonical Identity Key", "Identity Key", "identityKey"])
        )
        if not has_stable_identity:
            skipped.append({"reason": "missing_stable_identity", "row": str(reference)})
            continue
        try:
            current = resolve_current_row(
                reference,
                current_index,
                duplicates,
                external_index,
                external_duplicates,
                row_number,
                require_match=False,
            )
        except ValueError as error:
            print(json.dumps({"error": str(error)}, ensure_ascii=False, indent=2))
            return 3
        joined.append(output_row(reference, current, args.score_threshold))

    args.out_csv.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(joined[0].keys()) if joined else []
    with args.out_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(joined)

    summary = summarize(joined, duplicates, args, external_duplicates)
    summary["skippedReferenceRows"] = skipped
    count_matches_expected = args.expected_count is None or len(joined) == args.expected_count
    if count_matches_expected and manifest is not None and args.out_manifest is not None:
        write_json_atomic(args.out_manifest, manifest)
        summary["targetManifest"] = str(args.out_manifest)
        summary["targetManifestCount"] = len(manifest["targets"])
    with args.out_json.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not count_matches_expected:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
