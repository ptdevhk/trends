"""Unit tests for scheduler.py pure function helpers."""

from datetime import timedelta
from unittest.mock import patch

import pytest

from apps.worker.scheduler import WorkerScheduler, create_scheduler


# ============================================
# WorkerScheduler._get_interval
# ============================================


class TestGetInterval:
    def test_explicit_parameter_wins(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {}, clear=True):
            assert s._get_interval(15) == 15

    def test_env_variable_fallback(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_INTERVAL_MINUTES": "45"}, clear=False):
            assert s._get_interval(None) == 45

    def test_default_when_no_param_or_env(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {}, clear=True):
            assert s._get_interval(None) == WorkerScheduler.DEFAULT_INTERVAL_MINUTES

    def test_invalid_env_uses_default(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_INTERVAL_MINUTES": "abc"}, clear=False):
            assert s._get_interval(None) == WorkerScheduler.DEFAULT_INTERVAL_MINUTES

    def test_empty_env_uses_default(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_INTERVAL_MINUTES": "  "}, clear=False):
            assert s._get_interval(None) == WorkerScheduler.DEFAULT_INTERVAL_MINUTES

    def test_zero_interval(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_INTERVAL_MINUTES": "0"}, clear=False):
            assert s._get_interval(None) == 0


# ============================================
# WorkerScheduler._get_cron
# ============================================


class TestGetCron:
    def test_explicit_parameter_wins(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {}, clear=True):
            assert s._get_cron("*/15 * * * *") == "*/15 * * * *"

    def test_env_variable_fallback(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_CRON": "0 * * * *"}, clear=False):
            assert s._get_cron(None) == "0 * * * *"

    def test_none_when_no_param_or_env(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {}, clear=True):
            assert s._get_cron(None) is None

    def test_empty_env_returns_none(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_CRON": "  "}, clear=False):
            assert s._get_cron(None) is None

    def test_param_overrides_env(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        with patch.dict("os.environ", {"WORKER_CRON": "0 * * * *"}, clear=False):
            assert s._get_cron("*/5 * * * *") == "*/5 * * * *"


# ============================================
# WorkerScheduler._format_interval
# ============================================


class TestFormatInterval:
    def test_days(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(days=1)) == "1d"
        assert s._format_interval(timedelta(days=7)) == "7d"

    def test_hours(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(hours=6)) == "6h"
        assert s._format_interval(timedelta(hours=1)) == "1h"

    def test_minutes(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(minutes=30)) == "30m"
        assert s._format_interval(timedelta(minutes=5)) == "5m"

    def test_seconds(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(seconds=45)) == "45s"

    def test_zero(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(seconds=0)) == "0s"

    def test_negative(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_interval(timedelta(seconds=-5)) == "0s"


# ============================================
# WorkerScheduler._get_schedule_type / _get_schedule_value
# ============================================


class TestScheduleTypeAndValue:
    def test_interval_type(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.cron_expression = None
        s.interval_minutes = 30
        assert s._get_schedule_type() == "interval"
        assert s._get_schedule_value() == "30 minutes"

    def test_cron_type(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.cron_expression = "0 * * * *"
        s.interval_minutes = 30
        assert s._get_schedule_type() == "cron"
        assert s._get_schedule_value() == "0 * * * *"

    def test_custom_interval_value(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.cron_expression = None
        s.interval_minutes = 15
        assert s._get_schedule_value() == "15 minutes"


# ============================================
# WorkerScheduler._format_job_trigger
# ============================================


class TestFormatJobTrigger:
    def test_none_trigger(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        assert s._format_job_trigger(None) is None

    def test_interval_trigger(self):
        from apscheduler.triggers.interval import IntervalTrigger

        s = WorkerScheduler.__new__(WorkerScheduler)
        trigger = IntervalTrigger(minutes=30)
        result = s._format_job_trigger(trigger)
        assert result is not None
        assert result.startswith("interval:")
        assert "30m" in result

    def test_cron_trigger(self):
        from apscheduler.triggers.cron import CronTrigger

        s = WorkerScheduler.__new__(WorkerScheduler)
        trigger = CronTrigger.from_crontab("0 3 * * *")
        result = s._format_job_trigger(trigger)
        assert result is not None
        assert result.startswith("cron:")


# ============================================
# create_scheduler
# ============================================


class TestCreateScheduler:
    def test_env_run_immediately_true(self):
        with patch.dict("os.environ", {"WORKER_RUN_IMMEDIATELY": "true"}, clear=False):
            s = create_scheduler(interval_minutes=60, run_immediately=False)
            assert s.run_immediately is True

    def test_env_run_immediately_1(self):
        with patch.dict("os.environ", {"WORKER_RUN_IMMEDIATELY": "1"}, clear=False):
            s = create_scheduler(interval_minutes=60, run_immediately=False)
            assert s.run_immediately is True

    def test_env_run_immediately_false(self):
        with patch.dict("os.environ", {"WORKER_RUN_IMMEDIATELY": "false"}, clear=False):
            s = create_scheduler(interval_minutes=60, run_immediately=False)
            assert s.run_immediately is False

    def test_param_overrides_env(self):
        with patch.dict("os.environ", {"WORKER_RUN_IMMEDIATELY": "true"}, clear=False):
            s = create_scheduler(interval_minutes=60, run_immediately=True)
            assert s.run_immediately is True

    def test_default_interval(self):
        with patch.dict("os.environ", {}, clear=True):
            s = create_scheduler()
            assert s.interval_minutes == WorkerScheduler.DEFAULT_INTERVAL_MINUTES

    def test_custom_interval(self):
        with patch.dict("os.environ", {}, clear=True):
            s = create_scheduler(interval_minutes=15)
            assert s.interval_minutes == 15

    def test_custom_cron(self):
        with patch.dict("os.environ", {}, clear=True):
            s = create_scheduler(cron_expression="0 * * * *")
            assert s.cron_expression == "0 * * * *"

    def test_custom_timezone(self):
        with patch.dict("os.environ", {}, clear=True):
            s = create_scheduler(timezone="Asia/Shanghai")
            assert s.timezone == "Asia/Shanghai"

    def test_config_overrides(self):
        with patch.dict("os.environ", {}, clear=True):
            overrides = {"key": "value"}
            s = create_scheduler(config_overrides=overrides)
            assert s.config_overrides == overrides


# ============================================
# WorkerScheduler.get_stats
# ============================================


class TestGetStats:
    def test_initial_stats(self):
        s = WorkerScheduler.__new__(WorkerScheduler)
        s.stats = {
            "jobs_executed": 0,
            "jobs_failed": 0,
            "jobs_missed": 0,
            "last_run": None,
            "last_success": None,
            "last_failure": None,
        }
        s.cron_expression = None
        s.interval_minutes = 30
        s.scheduler = type("MockScheduler", (), {"get_jobs": lambda self: [], "running": False})()

        result = s.get_stats()
        assert result["jobs_executed"] == 0
        assert result["jobs_failed"] == 0
        assert result["schedule_type"] == "interval"
        assert result["schedule_value"] == "30 minutes"
        assert result["running"] is False
        assert result["jobs"] == []

    def test_stats_with_job_info(self):
        from unittest.mock import MagicMock

        s = WorkerScheduler.__new__(WorkerScheduler)
        s.stats = {
            "jobs_executed": 5,
            "jobs_failed": 1,
            "jobs_missed": 0,
            "last_run": None,
            "last_success": None,
            "last_failure": None,
        }
        s.cron_expression = "0 3 * * *"
        s.interval_minutes = 30

        mock_job = MagicMock()
        mock_job.id = "crawl_analyze"
        mock_job.name = "Crawl & Analyze"
        mock_job.next_run_time = None

        mock_scheduler = MagicMock()
        mock_scheduler.get_jobs.return_value = [mock_job]
        mock_scheduler.running = True
        s.scheduler = mock_scheduler

        result = s.get_stats()
        assert result["jobs_executed"] == 5
        assert result["schedule_type"] == "cron"
        assert result["running"] is True
        assert len(result["jobs"]) == 1
        assert result["jobs"][0]["id"] == "crawl_analyze"


# ============================================
# WorkerScheduler.add_custom_job validation
# ============================================


class TestAddCustomJob:
    def test_raises_without_interval_or_cron(self):
        from apscheduler.schedulers.blocking import BlockingScheduler

        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.scheduler = BlockingScheduler(timezone="UTC")

        with pytest.raises(ValueError, match="Either interval_minutes or cron_expression"):
            s.add_custom_job(func=lambda: None, job_id="test_job")

    def test_add_with_interval(self):
        from apscheduler.schedulers.blocking import BlockingScheduler

        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.scheduler = BlockingScheduler(timezone="UTC")

        s.add_custom_job(func=lambda: None, job_id="test_interval_job", interval_minutes=10)
        jobs = s.scheduler.get_jobs()
        assert any(j.id == "test_interval_job" for j in jobs)

    def test_add_with_cron(self):
        from apscheduler.schedulers.blocking import BlockingScheduler

        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.scheduler = BlockingScheduler(timezone="UTC")

        s.add_custom_job(func=lambda: None, job_id="test_cron_job", cron_expression="0 * * * *")
        jobs = s.scheduler.get_jobs()
        assert any(j.id == "test_cron_job" for j in jobs)

    def test_add_with_job_name(self):
        from apscheduler.schedulers.blocking import BlockingScheduler

        s = WorkerScheduler.__new__(WorkerScheduler)
        s.timezone = "UTC"
        s.scheduler = BlockingScheduler(timezone="UTC")

        s.add_custom_job(
            func=lambda: None,
            job_id="test_named_job",
            interval_minutes=5,
            job_name="My Named Job",
        )
        jobs = s.scheduler.get_jobs()
        named_job = next(j for j in jobs if j.id == "test_named_job")
        assert named_job.name == "My Named Job"
