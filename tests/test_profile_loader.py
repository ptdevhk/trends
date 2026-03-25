from __future__ import annotations

from apps.worker.profile_loader import ProfileLoader


def test_load_profiles_uses_schedule_max_candidates(tmp_path) -> None:
    config_dir = tmp_path / "profiles"
    config_dir.mkdir()
    (config_dir / "profile.yaml").write_text(
        """
id: summary-ready
name: Summary Ready
location: 东莞
keywords:
  - CNC
schedule:
  enabled: true
  cron: "0 9 * * 1-5"
  timezone: Asia/Hong_Kong
  maxCandidates: 120
  notifyOnlyOnNew: true
""".strip(),
        encoding="utf-8",
    )

    profiles = ProfileLoader(config_dir=str(config_dir)).load_profiles()

    assert len(profiles) == 1
    assert profiles[0]["limit"] == 120
    assert profiles[0]["schedule"] == {
        "enabled": True,
        "cron": "0 9 * * 1-5",
        "timezone": "Asia/Hong_Kong",
        "maxCandidates": 120,
        "notifyOnlyOnNew": True,
    }


def test_load_profiles_keeps_legacy_schedule_limit_fallback(tmp_path) -> None:
    config_dir = tmp_path / "profiles"
    config_dir.mkdir()
    (config_dir / "legacy.yaml").write_text(
        """
id: legacy-limit
name: Legacy Limit
location: 东莞
keywords:
  - 销售
schedule:
  enabled: true
  cron: "0 8 * * 1-5"
  limit: 80
""".strip(),
        encoding="utf-8",
    )

    profiles = ProfileLoader(config_dir=str(config_dir)).load_profiles()

    assert len(profiles) == 1
    assert profiles[0]["limit"] == 80
    assert profiles[0]["schedule"]["maxCandidates"] == 80
