# coding=utf-8

from packages.config import APP_DEFAULTS
from trendradar.utils.time import DEFAULT_TIMEZONE, get_configured_time, resolve_timezone


def test_default_timezone_is_hong_kong() -> None:
    assert APP_DEFAULTS["TIMEZONE"] == "Asia/Hong_Kong"
    assert DEFAULT_TIMEZONE == "Asia/Hong_Kong"


def test_resolve_timezone_env_precedence() -> None:
    resolved = resolve_timezone(
        env_timezone="America/New_York",
        configured_timezone="Europe/London",
        default_timezone="Asia/Hong_Kong",
    )
    assert resolved == "America/New_York"


def test_resolve_timezone_config_precedence_when_env_missing() -> None:
    resolved = resolve_timezone(
        env_timezone=None,
        configured_timezone="Europe/London",
        default_timezone="Asia/Hong_Kong",
    )
    assert resolved == "Europe/London"


def test_resolve_timezone_falls_back_to_default_on_invalid(capsys) -> None:
    resolved = resolve_timezone(
        env_timezone="Invalid/Timezone",
        configured_timezone="Another/Invalid",
        default_timezone="Asia/Hong_Kong",
    )

    captured = capsys.readouterr()
    assert resolved == "Asia/Hong_Kong"
    assert "未知时区" in captured.out


def test_get_configured_time_uses_default_for_invalid_timezone(capsys) -> None:
    current = get_configured_time("Invalid/Timezone")

    captured = capsys.readouterr()
    assert getattr(current.tzinfo, "zone", None) == "Asia/Hong_Kong"
    assert "未知时区" in captured.out
