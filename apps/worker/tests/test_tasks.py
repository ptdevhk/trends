"""Unit tests for apps.worker.tasks pure function helpers."""

import json
from typing import Any, Dict
from unittest.mock import patch

import pytest

from apps.worker.tasks import (
    normalize_summary_channel,
    normalize_summary_period,
    _worker_api_base_url,
    _load_last_skills_version,
    _save_last_skills_version,
    list_summary_profiles_runtime,
)


# ---------------------------------------------------------------------------
# normalize_summary_period
# ---------------------------------------------------------------------------

class TestNormalizeSummaryPeriod:
    def test_valid_periods(self):
        assert normalize_summary_period("daily") == "daily"
        assert normalize_summary_period("weekly") == "weekly"
        assert normalize_summary_period("monthly") == "monthly"

    def test_case_insensitive(self):
        assert normalize_summary_period("Daily") == "daily"
        assert normalize_summary_period("WEEKLY") == "weekly"
        assert normalize_summary_period("Monthly") == "monthly"

    def test_whitespace_trimmed(self):
        assert normalize_summary_period("  daily  ") == "daily"
        assert normalize_summary_period("\tweekly\n") == "weekly"

    def test_empty_and_none_fallback(self):
        assert normalize_summary_period("") == "daily"
        assert normalize_summary_period(None) == "daily"

    def test_invalid_value_fallback(self):
        assert normalize_summary_period("yearly") == "daily"
        assert normalize_summary_period("quarterly") == "daily"


# ---------------------------------------------------------------------------
# normalize_summary_channel
# ---------------------------------------------------------------------------

class TestNormalizeSummaryChannel:
    def test_valid_channels(self):
        assert normalize_summary_channel("email") == "email"
        assert normalize_summary_channel("wechat_work") == "wechat_work"
        assert normalize_summary_channel("feishu") == "feishu"
        assert normalize_summary_channel("telegram") == "telegram"

    def test_case_insensitive(self):
        assert normalize_summary_channel("Email") == "email"
        assert normalize_summary_channel("TELEGRAM") == "telegram"
        assert normalize_summary_channel("FeiShu") == "feishu"

    def test_whitespace_trimmed(self):
        assert normalize_summary_channel("  telegram  ") == "telegram"

    def test_empty_and_none_fallback(self):
        assert normalize_summary_channel("") == "telegram"
        assert normalize_summary_channel(None) == "telegram"

    def test_invalid_value_fallback(self):
        assert normalize_summary_channel("slack") == "telegram"
        assert normalize_summary_channel("sms") == "telegram"


# ---------------------------------------------------------------------------
# _worker_api_base_url
# ---------------------------------------------------------------------------

class TestWorkerApiBaseUrl:
    def test_default_url(self):
        with patch.dict("os.environ", {}, clear=True):
            # Remove TRENDS_API_URL if set
            import os
            os.environ.pop("TRENDS_API_URL", None)
            assert _worker_api_base_url() == "http://localhost:3000"

    def test_env_override(self):
        with patch.dict("os.environ", {"TRENDS_API_URL": "http://myhost:5000"}):
            assert _worker_api_base_url() == "http://myhost:5000"

    def test_parameter_override(self):
        assert _worker_api_base_url("http://custom:9000") == "http://custom:9000"

    def test_trailing_slash_stripped(self):
        assert _worker_api_base_url("http://host:3000/") == "http://host:3000"

    def test_parameter_overrides_env(self):
        with patch.dict("os.environ", {"TRENDS_API_URL": "http://env:3000"}):
            assert _worker_api_base_url("http://param:3000") == "http://param:3000"


# ---------------------------------------------------------------------------
# _load_last_skills_version / _save_last_skills_version
# ---------------------------------------------------------------------------

class TestSkillsVersionPersistence:
    def test_load_missing_file(self, tmp_skills_state):
        assert _load_last_skills_version() is None

    def test_save_and_load_roundtrip(self, tmp_skills_state):
        _save_last_skills_version(42)
        assert _load_last_skills_version() == 42

    def test_load_valid_integer(self, tmp_skills_state):
        tmp_skills_state.write_text(json.dumps({"skillsVersion": 7}))
        assert _load_last_skills_version() == 7

    def test_load_float_that_is_integer(self, tmp_skills_state):
        tmp_skills_state.write_text(json.dumps({"skillsVersion": 10.0}))
        assert _load_last_skills_version() == 10

    def test_load_float_non_integer_returns_none(self, tmp_skills_state):
        tmp_skills_state.write_text(json.dumps({"skillsVersion": 10.5}))
        assert _load_last_skills_version() is None

    def test_load_non_dict_returns_none(self, tmp_skills_state):
        tmp_skills_state.write_text("[]")
        assert _load_last_skills_version() is None

    def test_load_missing_key_returns_none(self, tmp_skills_state):
        tmp_skills_state.write_text(json.dumps({"otherKey": 5}))
        assert _load_last_skills_version() is None

    def test_load_invalid_json_returns_none(self, tmp_skills_state):
        tmp_skills_state.write_text("not json")
        assert _load_last_skills_version() is None

    def test_save_creates_parent_dirs(self, tmp_skills_state):
        # tmp_skills_state is a file in tmp_path — parent already exists
        _save_last_skills_version(1)
        assert _load_last_skills_version() == 1


# ---------------------------------------------------------------------------
# list_summary_profiles_runtime (with mocked HTTP)
# ---------------------------------------------------------------------------

class TestListSummaryProfilesRuntime:
    def _mock_urlopen(self, response_bytes: bytes):
        """Create a mock for urllib.request.urlopen that returns given bytes."""
        from unittest.mock import MagicMock

        mock_response = MagicMock()
        mock_response.read.return_value = response_bytes
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        return mock_response

    def test_basic_profile_list(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p1",
                    "cron": "0 9 * * *",
                    "name": "Morning Report",
                    "channel": "telegram",
                    "period": "daily",
                    "dryRun": False,
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert len(result) == 1
        assert result[0]["workspaceSlug"] == "dev"
        assert result[0]["profileId"] == "p1"
        assert result[0]["cron"] == "0 9 * * *"
        assert result[0]["period"] == "daily"
        assert result[0]["channel"] == "telegram"
        assert result[0]["dryRun"] is False

    def test_email_profile_with_recipient(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "prod",
                    "profileId": "p2",
                    "cron": "0 8 * * 1",
                    "name": "Weekly Email",
                    "channel": "email",
                    "period": "weekly",
                    "dryRun": True,
                    "to": "team@example.com",
                    "subject": "Weekly Report",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert len(result) == 1
        assert result[0]["channel"] == "email"
        assert result[0]["to"] == "team@example.com"
        assert result[0]["subject"] == "Weekly Report"
        assert result[0]["dryRun"] is True

    def test_email_profile_without_recipient_skipped(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p3",
                    "cron": "0 9 * * *",
                    "channel": "email",
                    "period": "daily",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert len(result) == 0

    def test_missing_required_fields_skipped(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {"workspaceSlug": "dev"},  # missing profileId and cron
                {"profileId": "p4"},       # missing workspaceSlug and cron
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert len(result) == 0

    def test_non_dict_items_skipped(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": ["not a dict", 42, None],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert len(result) == 0

    def test_template_id_included_when_present(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p5",
                    "cron": "0 9 * * *",
                    "channel": "telegram",
                    "period": "daily",
                    "templateId": "tpl-001",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert result[0]["templateId"] == "tpl-001"

    def test_template_id_omitted_when_empty(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p6",
                    "cron": "0 9 * * *",
                    "channel": "telegram",
                    "period": "daily",
                    "templateId": "",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert "templateId" not in result[0]

    def test_invalid_channel_normalized(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p7",
                    "cron": "0 9 * * *",
                    "channel": "slack",
                    "period": "daily",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert result[0]["channel"] == "telegram"  # fallback

    def test_api_failure_raises(self, mock_api_base):
        payload = json.dumps({"success": False, "error": "bad"}).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            with pytest.raises(RuntimeError, match="Summary profile runtime request failed"):
                list_summary_profiles_runtime(api_base_url=mock_api_base)

    def test_missing_items_raises(self, mock_api_base):
        payload = json.dumps({"success": True}).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            with pytest.raises(RuntimeError, match="missing items"):
                list_summary_profiles_runtime(api_base_url=mock_api_base)

    def test_name_defaults_to_profile_id(self, mock_api_base):
        payload = json.dumps({
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "p8",
                    "cron": "0 9 * * *",
                    "channel": "telegram",
                    "period": "daily",
                }
            ],
        }).encode("utf-8")

        with patch("apps.worker.tasks.urlopen", return_value=self._mock_urlopen(payload)):
            result = list_summary_profiles_runtime(api_base_url=mock_api_base)

        assert result[0]["name"] == "p8"
