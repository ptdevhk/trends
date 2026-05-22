"""Unit tests for profile_loader.py."""

from unittest.mock import patch, MagicMock

import pytest

from apps.worker.profile_loader import ProfileLoader


def _make_runtime_response(items=None):
    """Build a mock API response for the runtime endpoint."""
    return {
        "success": True,
        "items": items or [],
    }


def _make_profile_item(
    workspace_slug="dev",
    profile_id="prof-1",
    name="Test Profile",
    location="Kuala Lumpur",
    cron="0 9 * * 1-5",
    keywords=None,
    schedule=None,
):
    """Build a single profile item from the runtime API."""
    return {
        "workspaceSlug": workspace_slug,
        "profileId": profile_id,
        "cron": cron,
        "profile": {
            "id": profile_id,
            "name": name,
            "location": location,
            "keywords": keywords or ["engineer", "python"],
            "schedule": schedule or {"type": "cron", "cron": cron},
        },
    }


# ============================================
# ProfileLoader.load_profiles
# ============================================


class TestLoadProfiles:
    def test_empty_items(self):
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result == []

    def test_single_valid_profile(self):
        item = _make_profile_item()
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert len(result) == 1
            assert result[0]["id"] == "prof-1"
            assert result[0]["name"] == "Test Profile"
            assert result[0]["cron"] == "0 9 * * 1-5"
            assert result[0]["workspaceSlug"] == "dev"

    def test_multiple_valid_profiles(self):
        items = [
            _make_profile_item(profile_id="p1", name="Profile 1"),
            _make_profile_item(profile_id="p2", name="Profile 2", workspace_slug="prod"),
        ]
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response(items)):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert len(result) == 2
            assert result[0]["id"] == "p1"
            assert result[1]["id"] == "p2"

    def test_api_failure_raises(self):
        with patch(
            "apps.worker.profile_loader._request_json",
            return_value={"success": False, "error": "unauthorized"},
        ):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            with pytest.raises(RuntimeError, match="runtime request failed"):
                loader.load_profiles()

    def test_missing_items_key_raises(self):
        with patch(
            "apps.worker.profile_loader._request_json",
            return_value={"success": True},
        ):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            with pytest.raises(RuntimeError, match="missing items"):
                loader.load_profiles()

    def test_skip_non_dict_item(self):
        items = [
            _make_profile_item(),
            "not a dict",
            42,
        ]
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response(items)):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert len(result) == 1

    def test_skip_missing_workspace_slug(self):
        item = _make_profile_item()
        del item["workspaceSlug"]
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result == []

    def test_skip_missing_cron(self):
        item = _make_profile_item()
        item["cron"] = ""
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result == []

    def test_skip_missing_profile_dict(self):
        item = {"workspaceSlug": "dev", "cron": "0 * * * *"}
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result == []

    def test_skip_profile_missing_required_fields(self):
        """Profile must have id, name, location, keywords (list), schedule (dict)."""
        item = _make_profile_item()
        del item["profile"]["location"]
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result == []

    def test_profile_id_from_profile_dict(self):
        """When profile.id is present, it's used over profileId."""
        item = _make_profile_item(profile_id="from-profile-id")
        item["profile"]["id"] = "from-profile-dict"
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result[0]["id"] == "from-profile-dict"

    def test_profile_name_fallback_to_profile_id(self):
        """When profile.name is missing, fallback to profileId."""
        item = _make_profile_item()
        del item["profile"]["name"]
        with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response([item])):
            loader = ProfileLoader(api_base_url="http://localhost:9999")
            result = loader.load_profiles()
            assert result[0]["name"] == "prof-1"

    def test_api_base_url_from_env(self):
        with patch.dict("os.environ", {"TRENDS_API_URL": "http://custom:8080"}, clear=False):
            with patch("apps.worker.profile_loader._request_json", return_value=_make_runtime_response()):
                loader = ProfileLoader()
                assert loader.api_base_url == "http://custom:8080"
