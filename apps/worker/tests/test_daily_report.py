"""Unit tests for sales daily-report worker module + ingest chain."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from apps.worker.daily_report import (
    already_built_for_date,
    build_daily_report_command,
    daily_report_build_enabled,
    run_daily_report_build,
    shanghai_today_ymd,
    stamp_path,
    write_build_stamp,
)
from apps.worker.scheduler import WorkerScheduler


def test_daily_report_build_enabled_explicit_and_ingest_follow():
    assert daily_report_build_enabled({"DAILY_REPORT_BUILD_ENABLED": "1"}) is True
    assert daily_report_build_enabled({"DAILY_REPORT_BUILD_ENABLED": "0"}) is False
    assert daily_report_build_enabled({"RESEARCH_INGEST_ENABLED": "1"}) is True
    assert daily_report_build_enabled({"RESEARCH_INGEST_ENABLED": "0"}) is False
    assert daily_report_build_enabled({}) is False
    # Explicit off wins over ingest on
    assert (
        daily_report_build_enabled(
            {"DAILY_REPORT_BUILD_ENABLED": "0", "RESEARCH_INGEST_ENABLED": "1"}
        )
        is False
    )


def test_shanghai_today_ymd_fixed_offset():
    # 2026-09-21 20:00 UTC = 2026-09-22 04:00 +08
    dt = datetime(2026, 9, 21, 20, 0, 0, tzinfo=timezone.utc)
    assert shanghai_today_ymd(dt) == "2026-09-22"


def test_build_daily_report_command_defaults_to_today():
    cmd = build_daily_report_command("2026-09-22")
    assert cmd == ["npx", "tsx", "scripts/daily-report/build-live.ts", "2026-09-22"]


def test_stamp_roundtrip(tmp_path: Path):
    date = "2026-09-22"
    assert already_built_for_date(date, tmp_path) is False
    write_build_stamp(date, ok=True, root=tmp_path)
    assert already_built_for_date(date, tmp_path) is True
    assert stamp_path(tmp_path).is_file()
    data = json.loads(stamp_path(tmp_path).read_text(encoding="utf-8"))
    assert data["date"] == date
    assert data["ok"] is True


def test_run_daily_report_build_skips_when_stamped(tmp_path: Path, monkeypatch):
    write_build_stamp("2026-09-22", ok=True, root=tmp_path)
    monkeypatch.setattr("apps.worker.daily_report.project_root", lambda: tmp_path)
    with patch("apps.worker.daily_report.subprocess.run") as run:
        assert run_daily_report_build("2026-09-22") is True
        run.assert_not_called()


def test_run_daily_report_build_force_ignores_stamp(tmp_path: Path, monkeypatch):
    write_build_stamp("2026-09-22", ok=True, root=tmp_path)
    monkeypatch.setattr("apps.worker.daily_report.project_root", lambda: tmp_path)
    completed = MagicMock(returncode=0, stdout="ok\n", stderr="")
    with patch("apps.worker.daily_report.subprocess.run", return_value=completed) as run:
        assert run_daily_report_build("2026-09-22", force=True) is True
        run.assert_called_once()


def test_run_daily_report_build_records_failure_stamp(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("apps.worker.daily_report.project_root", lambda: tmp_path)
    completed = MagicMock(returncode=1, stdout="", stderr="boom")
    with patch("apps.worker.daily_report.subprocess.run", return_value=completed):
        assert run_daily_report_build("2026-09-22") is False
    assert already_built_for_date("2026-09-22", tmp_path) is False
    data = json.loads(stamp_path(tmp_path).read_text(encoding="utf-8"))
    assert data["ok"] is False


def test_scheduler_registers_daily_report_job_when_enabled():
    with patch.dict("os.environ", {"DAILY_REPORT_BUILD_ENABLED": "1"}, clear=False):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.interval_minutes = 30
        s.cron_expression = None
        s.config_overrides = {}
        s.scheduler = MagicMock()
        s.add_daily_report_build_job()
        s.scheduler.add_job.assert_called_once()
        assert s.scheduler.add_job.call_args.kwargs["id"] == "daily_report_build"


def test_scheduler_skips_daily_report_job_when_disabled():
    with patch.dict(
        "os.environ",
        {"DAILY_REPORT_BUILD_ENABLED": "0", "RESEARCH_INGEST_ENABLED": "0"},
        clear=False,
    ):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.interval_minutes = 30
        s.cron_expression = None
        s.config_overrides = {}
        s.scheduler = MagicMock()
        s.add_daily_report_build_job()
        s.scheduler.add_job.assert_not_called()


def test_research_ingest_chains_daily_report_on_success(monkeypatch):
    from apps.worker import tasks

    monkeypatch.setattr(tasks, "_is_maintenance_mode", lambda: False)
    monkeypatch.setattr(
        "apps.worker.research_ingest.run_research_ingest",
        lambda config_overrides=None: True,
    )
    called = {"n": 0}

    def fake_build(*_a, **_k):
        called["n"] += 1
        return True

    monkeypatch.setattr(
        "apps.worker.daily_report.daily_report_build_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "apps.worker.daily_report.run_daily_report_build",
        fake_build,
    )
    assert tasks.run_research_ingest() is True
    assert called["n"] == 1


def test_research_ingest_skips_chain_when_build_disabled(monkeypatch):
    from apps.worker import tasks

    monkeypatch.setattr(tasks, "_is_maintenance_mode", lambda: False)
    monkeypatch.setattr(
        "apps.worker.research_ingest.run_research_ingest",
        lambda config_overrides=None: True,
    )
    called = {"n": 0}

    monkeypatch.setattr(
        "apps.worker.daily_report.daily_report_build_enabled",
        lambda: False,
    )
    monkeypatch.setattr(
        "apps.worker.daily_report.run_daily_report_build",
        lambda *_a, **_k: called.__setitem__("n", called["n"] + 1) or True,
    )
    assert tasks.run_research_ingest() is True
    assert called["n"] == 0
