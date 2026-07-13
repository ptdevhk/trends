"""Red tests for audit_hr_feedback_export.py full-score audit integration.

Before implementation, these tests define the contract:
- When export contains aiScore=79, relatedExpAuditFactor=78, industryDb=40,
  category related-exp audit-factor stats use 78, not 79.
- Summary JSON separately reports final AI score min/median/max and
  related-exp audit-factor min/median/max.
- Missing related-exp audit factor is counted separately from missing final AI score.
- Legacy exports without explicit audit-factor fields fall back to Current AI Score.
"""

import csv
import io
import json
import statistics
import sys
from pathlib import Path

import pytest

# Allow running from repo root or skill directory
SKILL_DIR = Path(__file__).resolve().parent
REPO_ROOT = SKILL_DIR.parent.parent.parent.parent.parent
sys.path.insert(0, str(SKILL_DIR))

from audit_hr_feedback_export import (
    build_target_manifest,
    classify_alignment,
    first_value,
    format_number,
    main,
    parse_float,
    output_row,
    read_csv,
    summarize,
)


class TestTargetManifest:
    def test_preserves_reference_order_and_carries_stable_selectors(self):
        references = [
            {
                "Old Resume ID": "old-2",
                "Profile Resume ID": "100002",
                "Profile URL": "https://example.com/candidate/2?resumeId=100002",
            },
            {
                "Old Resume ID": "old-1",
                "Profile Resume ID": "100001",
            },
        ]
        current = {
            "100002": {
                "Resume ID": "current-2",
                "External ID": "external-2",
                "Profile URL": "https://example.com/candidate/2?resumeId=100002",
                "Source": "51job",
            },
            "100001": {
                "Resume ID": "current-1",
                "External ID": "external-1",
                "Profile URL": "https://example.com/candidate/1?resumeId=100001",
                "Source": "51job",
            },
        }

        manifest = build_target_manifest(references, current, duplicates={}, excluded=set())

        assert manifest["version"] == 1
        assert [target["referenceResumeId"] for target in manifest["targets"]] == ["old-2", "old-1"]
        assert manifest["targets"][0] == {
            "referenceResumeId": "old-2",
            "currentResumeId": "current-2",
            "profileResumeId": "100002",
            "profileUrl": "https://example.com/candidate/2?resumeId=100002",
            "externalId": "external-2",
            "source": "51job",
        }
        assert "name" not in manifest["targets"][0]

    def test_rejects_missing_stable_identity(self):
        with pytest.raises(ValueError, match="missing stable identity"):
            build_target_manifest(
                [{"Old Resume ID": "old-only"}],
                current_index={},
                duplicates={},
                excluded=set(),
            )

    def test_rejects_ambiguous_current_profile_resume_id(self):
        with pytest.raises(ValueError, match="multiple current resumes"):
            build_target_manifest(
                [{"Old Resume ID": "old-1", "Profile Resume ID": "100001"}],
                current_index={"100001": {"Resume ID": "current-1"}},
                duplicates={"100001": 2},
                excluded=set(),
            )

    def test_resolves_external_only_reference_to_current_row(self):
        current = {"Resume ID": "current-external", "External ID": "external-only"}

        manifest = build_target_manifest(
            [{"Old Resume ID": "old-external", "External ID": "external-only"}],
            current_index={},
            duplicates={},
            excluded=set(),
            external_index={"external-only": current},
            external_duplicates={},
        )

        assert manifest["targets"] == [
            {
                "referenceResumeId": "old-external",
                "currentResumeId": "current-external",
                "externalId": "external-only",
            }
        ]

    def test_rejects_ambiguous_current_external_id(self):
        with pytest.raises(ValueError, match="external ID external-1 matches multiple"):
            build_target_manifest(
                [{"Old Resume ID": "old-1", "External ID": "external-1"}],
                current_index={},
                duplicates={},
                excluded=set(),
                external_index={"external-1": {"Resume ID": "current-1"}},
                external_duplicates={"external-1": 2},
            )

    def test_rejects_conflicting_profile_and_external_matches(self):
        with pytest.raises(ValueError, match="stable selectors conflict"):
            build_target_manifest(
                [{
                    "Old Resume ID": "old-1",
                    "Profile Resume ID": "100001",
                    "External ID": "external-2",
                }],
                current_index={"100001": {"Resume ID": "current-1"}},
                duplicates={},
                excluded=set(),
                external_index={"external-2": {"Resume ID": "current-2"}},
                external_duplicates={},
            )

    def test_rejects_placeholder_external_identity(self):
        with pytest.raises(ValueError, match="placeholder external ID"):
            build_target_manifest(
                [{"Old Resume ID": "old-1", "External ID": "UNKNOWN"}],
                current_index={},
                duplicates={},
                excluded=set(),
                external_index={},
                external_duplicates={},
            )

    def test_builds_ordered_34_target_contract(self):
        references = [
            {
                "Old Resume ID": f"old-{index:02d}",
                "Profile Resume ID": str(100000 + index),
                "External ID": f"external-{index:02d}",
            }
            for index in range(34)
        ]
        current_rows = [
            {
                "Resume ID": f"current-{index:02d}",
                "Profile Resume ID": str(100000 + index),
                "External ID": f"external-{index:02d}",
            }
            for index in range(34)
        ]

        manifest = build_target_manifest(
            references,
            current_index={row["Profile Resume ID"]: row for row in current_rows},
            duplicates={},
            excluded=set(),
            external_index={row["External ID"]: row for row in current_rows},
            external_duplicates={},
        )

        assert len(manifest["targets"]) == 34
        assert [target["referenceResumeId"] for target in manifest["targets"]] == [
            f"old-{index:02d}" for index in range(34)
        ]
        assert [target["currentResumeId"] for target in manifest["targets"]] == [
            f"current-{index:02d}" for index in range(34)
        ]

    def test_skill_documents_current_34_row_contract(self):
        skill_text = (SKILL_DIR.parent / "SKILL.md").read_text(encoding="utf-8")

        assert "--expected-count 34" in skill_text
        assert "hr-feedback-42" not in skill_text


class TestManifestPublication:
    def test_expected_count_failure_leaves_no_runnable_manifest(self, tmp_path, monkeypatch):
        reference_csv = tmp_path / "reference.csv"
        current_csv = tmp_path / "current.csv"
        out_csv = tmp_path / "audit.csv"
        out_json = tmp_path / "audit.json"
        out_manifest = tmp_path / "targets.json"
        _write_csv(reference_csv, [{
            "Old Resume ID": "old-1",
            "Profile Resume ID": "100001",
            "External ID": "external-1",
        }])
        _write_csv(current_csv, [{
            "Resume ID": "current-1",
            "Profile Resume ID": "100001",
            "External ID": "external-1",
        }])
        monkeypatch.setattr(sys, "argv", [
            "audit_hr_feedback_export.py",
            "--reference-csv", str(reference_csv),
            "--current-export", str(current_csv),
            "--out-csv", str(out_csv),
            "--out-json", str(out_json),
            "--out-manifest", str(out_manifest),
            "--expected-count", "2",
        ])

        assert main() == 2
        assert not out_manifest.exists()

    def test_main_joins_external_only_reference(self, tmp_path, monkeypatch):
        reference_csv = tmp_path / "reference.csv"
        current_csv = tmp_path / "current.csv"
        out_csv = tmp_path / "audit.csv"
        out_json = tmp_path / "audit.json"
        _write_csv(reference_csv, [{
            "Old Resume ID": "old-1",
            "External ID": "external-only",
        }])
        _write_csv(current_csv, [{
            "Resume ID": "current-external",
            "External ID": "external-only",
        }])
        monkeypatch.setattr(sys, "argv", [
            "audit_hr_feedback_export.py",
            "--reference-csv", str(reference_csv),
            "--current-export", str(current_csv),
            "--out-csv", str(out_csv),
            "--out-json", str(out_json),
            "--expected-count", "1",
        ])

        assert main() == 0
        rows = read_csv(out_csv)
        assert rows[0]["Current Resume ID"] == "current-external"


# ---------------------------------------------------------------------------
# Helpers to build minimal CSV rows for testing
# ---------------------------------------------------------------------------

def _csv_rows(fields: list[str], data: list[dict[str, str]]) -> list[dict[str, str]]:
    """Parse CSV from field list + row dicts using csv.DictReader."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in data:
        writer.writerow({k: row.get(k, "") for k in fields})
    output.seek(0)
    return list(csv.DictReader(output))


def _write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# classify_alignment
# ---------------------------------------------------------------------------

class TestClassifyAlignment:
    def test_strong_match_above_threshold(self):
        assert classify_alignment("strong_match", 85, 70) == "aligned_high"

    def test_strong_match_below_threshold(self):
        assert classify_alignment("strong_match", 69, 70) == "strong_below_threshold"

    def test_not_suitable_above_80(self):
        assert classify_alignment("not_suitable", 82, 70) == "still_high_score"

    def test_not_suitable_below_80(self):
        assert classify_alignment("not_suitable", 30, 70) == "aligned_low"

    def test_missing_ai_score(self):
        assert classify_alignment("strong_match", None, 70) == "missing_ai_score"


# ---------------------------------------------------------------------------
# first_value
# ---------------------------------------------------------------------------

class TestFirstValue:
    def test_returns_first_matching_key(self):
        row = {"Final AI Score": "79", "aiScore": "88"}
        assert first_value(row, ["Final AI Score", "finalAiScore", "AI Score", "aiScore"]) == "79"

    def test_falls_back_to_second_key(self):
        row = {"aiScore": "88"}
        assert first_value(row, ["Final AI Score", "finalAiScore", "AI Score", "aiScore"]) == "88"

    def test_returns_empty_string_when_none_match(self):
        row = {}
        assert first_value(row, ["Final AI Score", "aiScore"]) == ""


# ---------------------------------------------------------------------------
# format_number
# ---------------------------------------------------------------------------

class TestFormatNumber:
    def test_integer(self):
        assert format_number(79) == "79"

    def test_float_one_decimal(self):
        assert format_number(78.5) == "78.5"

    def test_none(self):
        assert format_number(None) == ""


# ---------------------------------------------------------------------------
# parse_float
# ---------------------------------------------------------------------------

class TestParseFloat:
    def test_integer_string(self):
        assert parse_float("79") == 79.0

    def test_empty_string(self):
        assert parse_float("") is None

    def test_none_string(self):
        assert parse_float(None) is None


# ---------------------------------------------------------------------------
# output_row: related-exp audit factor vs final AI score
# ---------------------------------------------------------------------------

class TestOutputRowAuditFactor:
    """When current export contains explicit audit-factor columns, the row
    must carry both final AI score and the related-exp audit factor."""

    def test_audit_factor_from_explicit_column(self):
        reference = {
            "Old CSV Row": "1",
            "Old Resume ID": "r1",
            "Profile Resume ID": "pid-1",
            "HR Category": "strong_match",
            "Old AI Score": "75",
        }
        current = {
            "Resume ID": "r1",
            "AI Score": "79",
            "Final AI Score": "79",
            "relatedExpAuditFactor": "78",
            "relatedExpContribution": "39",
            "Industry DB": "40",
            "Recommendation": "match",
            "HR Category": "strong_match",
        }
        row = output_row(reference, current, 70)
        # Current AI Score = final AI score
        assert row["Current AI Score"] == "79"
        # Related Exp should be the audit factor from the explicit column
        assert row["Related Exp"] == "78"

    def test_audit_factor_falls_back_to_relatedExp_column(self):
        reference = {
            "Old CSV Row": "1",
            "Old Resume ID": "r1",
            "Profile Resume ID": "pid-1",
            "HR Category": "match",
            "Old AI Score": "70",
        }
        current = {
            "Resume ID": "r1",
            "AI Score": "60",
            "Related Exp": "40",
            "Industry DB": "20",
        }
        row = output_row(reference, current, 70)
        assert row["Current AI Score"] == "60"
        assert row["Related Exp"] == "40"

    def test_audit_factor_falls_back_to_relatedExp_column(self):
        reference = {
            "Old CSV Row": "1",
            "Old Resume ID": "r1",
            "Profile Resume ID": "pid-1",
            "HR Category": "match",
            "Old AI Score": "70",
        }
        current = {
            "Resume ID": "r1",
            "AI Score": "60",
            "relatedExp": "40",
            "Industry DB": "20",
        }
        row = output_row(reference, current, 70)
        assert row["Related Exp"] == "40"

    def test_legacy_fallback_when_no_audit_factor_columns(self):
        """Legacy exports without explicit audit-factor fields should fall
        back to Current AI Score for the related-exp factor."""
        reference = {
            "Old CSV Row": "1",
            "Old Resume ID": "r1",
            "Profile Resume ID": "pid-1",
            "HR Category": "match",
            "Old AI Score": "70",
        }
        current = {
            "Resume ID": "r1",
            "AI Score": "60",
            "Current AI Score": "60",
        }
        row = output_row(reference, current, 70)
        # Current AI Score = 60 (from AI Score column → current_final_ai_score)
        assert row["Current AI Score"] == "60"
        # Related Exp falls back to Current AI Score=60 (no explicit audit-factor column)
        assert row["Related Exp"] == "60"

    def test_new_audit_fields_in_output(self):
        """Explicit audit-factor columns populate new output fields."""
        reference = {
            "Old CSV Row": "1",
            "Old Resume ID": "r1",
            "Profile Resume ID": "pid-1",
            "HR Category": "match",
            "Old AI Score": "70",
        }
        current = {
            "Resume ID": "r1",
            "AI Score": "79",
            "Final AI Score": "79",
            "finalAiScore": "79",
            "relatedExpAuditFactor": "78",
            "relatedExpContribution": "39",
            "Industry DB": "40",
            "Recommendation": "match",
        }
        row = output_row(reference, current, 70)
        assert row["Current Final AI Score"] == "79"
        assert row["Related Exp Audit Factor"] == "78"
        assert row["Related Exp Contribution"] == "39"
        assert row["Industry DB"] == "40"
        assert row["Current Recommendation"] == "match"
        # Backward compat
        assert row["Current AI Score"] == "79"
        assert row["Related Exp"] == "78"


# ---------------------------------------------------------------------------
# summarize: separate final score vs audit-factor stats
# ---------------------------------------------------------------------------

class TestSummarizeAuditFactorSeparation:
    """Summary JSON must separately report final AI score and related-exp
    audit-factor stats per category. The gate metric (relatedExpHighFactorCount)
    must use the audit factor, not the final score."""

    def _make_args(self, **overrides):
        class Args:
            reference_csv = Path("/tmp/ref.csv")
            current_export = Path("/tmp/cur.csv")
            out_csv = Path("/tmp/out.csv")
            out_json = None
            score_threshold = 80
            expected_count = None
        args = Args()
        for k, v in overrides.items():
            setattr(args, k, v)
        return args

    def test_audit_factor_stats_separate_from_final_score(self):
        """relatedExp=78, industryDb=40 → final score 79. Audit factor stats
        should use 78, not 79."""
        reference_rows = [
            {"Old CSV Row": str(i + 1), "Old Resume ID": f"r{i}", "Profile Resume ID": f"pid-{i}",
             "HR Category": cat, "Old AI Score": "70"}
            for i, cat in enumerate(["strong_match", "match", "potential"])
        ]
        current_rows = [
            {"Resume ID": f"r{i}", "AI Score": str(s), "Final AI Score": str(s),
             "relatedExpAuditFactor": str(a), "Industry DB": str(d), "Recommendation": "match"}
            for i, s, a, d in [
                (0, "79", "78", "40"),
                (1, "65", "50", "40"),
                (2, "45", "30", "30"),
            ]
        ]
        ref_fields = list(reference_rows[0].keys())
        cur_fields = list(current_rows[0].keys())

        ref_csv = _csv_rows(ref_fields, reference_rows)
        cur_csv = _csv_rows(cur_fields, current_rows)

        rows = []
        for ref in ref_csv:
            pid = ref["Profile Resume ID"]
            cur = next((c for c in cur_csv if c["Resume ID"] == ref["Old Resume ID"]), None)
            rows.append(output_row(ref, cur, 80))

        summary = summarize(rows, {}, self._make_args())

        assert summary["actualCount"] == 3
        assert summary["scoringModel"] == "final=round(related_exp*0.5)+industry_db; auditFactor=related_exp"

        strong = summary["categories"]["strong_match"]
        # Final AI Score = 79
        assert strong["finalScoreMedian"] == 79
        # Related Exp Audit Factor = 78 (back-compat scoreMedian uses audit factors)
        assert strong["relatedExpFactorMedian"] == 78


class TestSummarizeMissingCounts:
    """Missing related-exp audit factor must be counted separately from
    missing final AI score."""

    def _make_args(self, **overrides):
        class Args:
            reference_csv = Path("/tmp/ref.csv")
            current_export = Path("/tmp/cur.csv")
            out_csv = Path("/tmp/out.csv")
            out_json = None
            score_threshold = 80
            expected_count = None
        args = Args()
        for k, v in overrides.items():
            setattr(args, k, v)
        return args

    def test_missing_current_resume_counted(self):
        reference_rows = [
            {"Old CSV Row": "1", "Old Resume ID": "r0", "Profile Resume ID": "pid-0",
             "HR Category": "match", "Old AI Score": "70"},
            {"Old CSV Row": "2", "Old Resume ID": "r1", "Profile Resume ID": "pid-1",
             "HR Category": "match", "Old AI Score": "70"},
        ]
        current_rows = [
            {"Resume ID": "r0", "AI Score": "79", "Final AI Score": "79",
             "relatedExpAuditFactor": "78", "Industry DB": "40"},
        ]
        ref_fields = list(reference_rows[0].keys())
        cur_fields = list(current_rows[0].keys())

        ref_csv = _csv_rows(ref_fields, reference_rows)
        cur_csv = _csv_rows(cur_fields, current_rows)

        rows = []
        for ref in ref_csv:
            pid = ref["Profile Resume ID"]
            cur = next((c for c in cur_csv if c["Resume ID"] == ref["Old Resume ID"]), None)
            rows.append(output_row(ref, cur, 80))

        summary = summarize(rows, {}, self._make_args())

        assert summary["actualCount"] == 2
        match_cat = summary["categories"]["match"]
        assert match_cat["missingCurrent"] == 1  # pid-1 has no current row


class TestTopLevelJsonFields:
    """Top-level JSON must include scoring model, final score metric, and
    audit factor metric fields."""

    def _make_args(self, **overrides):
        class Args:
            reference_csv = Path("/tmp/ref.csv")
            current_export = Path("/tmp/cur.csv")
            out_csv = Path("/tmp/out.csv")
            out_json = None
            score_threshold = 80
            expected_count = None
        args = Args()
        for k, v in overrides.items():
            setattr(args, k, v)
        return args

    def test_scoring_model_and_metrics_present(self):
        reference_rows = [
            {"Old CSV Row": "1", "Old Resume ID": "r0", "Profile Resume ID": "pid-0",
             "HR Category": "match", "Old AI Score": "70"},
        ]
        current_rows = [
            {"Resume ID": "r0", "AI Score": "79", "Final AI Score": "79",
             "relatedExpAuditFactor": "78", "Industry DB": "40"},
        ]
        ref_csv = _csv_rows(list(reference_rows[0].keys()), reference_rows)
        cur_csv = _csv_rows(list(current_rows[0].keys()), current_rows)

        rows = []
        for ref in ref_csv:
            pid = ref["Profile Resume ID"]
            cur = next((c for c in cur_csv if c["Resume ID"] == ref["Old Resume ID"]), None)
            rows.append(output_row(ref, cur, 80))

        summary = summarize(rows, {}, self._make_args())

        assert "scoringModel" in summary
        assert "finalScoreMetric" in summary
        assert "auditFactorMetric" in summary
        assert summary["scoringModel"] == "final=round(related_exp*0.5)+industry_db; auditFactor=related_exp"
        assert summary["finalScoreMetric"] == "Final AI Score"
        assert summary["auditFactorMetric"] == "Related Exp Audit Factor"
        assert summary["actualCount"] == 1
        assert summary["countMatchesExpected"] is True
