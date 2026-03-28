from __future__ import annotations

from apps.worker.profile_loader import ProfileLoader


def test_load_profiles_uses_runtime_api_payload(monkeypatch) -> None:
    seen_url: list[str] = []

    def fake_request_json(url: str):
        seen_url.append(url)
        return {
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "job5156-cn-cnc-sales",
                    "name": "China Job5156 CNC Sales",
                    "cron": "0 9 * * 1-5",
                    "profile": {
                        "id": "job5156-cn-cnc-sales",
                        "name": "China Job5156 CNC Sales",
                        "location": "China",
                        "keywords": ["CNC", "销售"],
                        "schedule": {
                            "enabled": True,
                            "cron": "0 9 * * 1-5",
                            "timezone": "Asia/Shanghai",
                            "maxCandidates": 120,
                            "notifyOnlyOnNew": True,
                        },
                    },
                },
            ],
        }

    monkeypatch.setattr("apps.worker.profile_loader._request_json", fake_request_json)

    profiles = ProfileLoader(api_base_url="http://worker-api.test").load_profiles()

    assert seen_url == ["http://worker-api.test/api/search-profiles/runtime"]
    assert len(profiles) == 1
    assert profiles[0]["id"] == "job5156-cn-cnc-sales"
    assert profiles[0]["workspaceSlug"] == "dev"
    assert profiles[0]["cron"] == "0 9 * * 1-5"
    assert profiles[0]["schedule"] == {
        "enabled": True,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai",
        "maxCandidates": 120,
        "notifyOnlyOnNew": True,
    }


def test_load_profiles_ignores_malformed_runtime_items(monkeypatch) -> None:
    monkeypatch.setattr(
        "apps.worker.profile_loader._request_json",
        lambda url: {
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "missing-location",
                    "name": "Missing Location",
                    "cron": "0 9 * * 1-5",
                    "profile": {
                        "id": "missing-location",
                        "keywords": ["CNC"],
                        "schedule": {"enabled": True, "cron": "0 9 * * 1-5"},
                    },
                },
                {
                    "workspaceSlug": "dev",
                    "profileId": "valid-profile",
                    "name": "Valid Profile",
                    "cron": "*/30 * * * *",
                    "profile": {
                        "id": "valid-profile",
                        "name": "Valid Profile",
                        "location": "东莞",
                        "keywords": ["招聘", "简历"],
                        "schedule": {"enabled": True, "cron": "*/30 * * * *"},
                    },
                },
                {
                    "workspaceSlug": "",
                    "profileId": "missing-workspace",
                    "name": "Missing Workspace",
                    "cron": "0 8 * * 1-5",
                    "profile": {
                        "id": "missing-workspace",
                        "name": "Missing Workspace",
                        "location": "东莞",
                        "keywords": ["销售"],
                        "schedule": {"enabled": True, "cron": "0 8 * * 1-5"},
                    },
                },
            ],
        },
    )

    profiles = ProfileLoader(api_base_url="http://worker-api.test").load_profiles()

    assert profiles == [
        {
            "id": "valid-profile",
            "name": "Valid Profile",
            "location": "东莞",
            "keywords": ["招聘", "简历"],
            "schedule": {"enabled": True, "cron": "*/30 * * * *"},
            "cron": "*/30 * * * *",
            "workspaceSlug": "dev",
        },
    ]
