"""Unit tests for main.py CLI entry point."""

import logging
from unittest.mock import patch

import pytest

from apps.worker.main import setup_logging


# ============================================
# setup_logging
# ============================================


class TestSetupLogging:
    def test_verbose_sets_debug(self):
        setup_logging(verbose=True)
        assert logging.getLogger().level == logging.DEBUG

    def test_quiet_sets_warning(self):
        setup_logging(quiet=True)
        assert logging.getLogger().level == logging.WARNING

    def test_default_sets_info(self):
        setup_logging()
        assert logging.getLogger().level == logging.INFO

    def test_apscheduler_level_follows(self):
        setup_logging(verbose=True)
        assert logging.getLogger("apscheduler").level == logging.DEBUG

    def test_apscheduler_quiet(self):
        setup_logging(quiet=True)
        assert logging.getLogger("apscheduler").level == logging.WARNING


# ============================================
# parse_args (via sys.argv patching)
# ============================================


class TestParseArgs:
    def test_default_values(self):
        with patch("sys.argv", ["worker"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.interval is None
            assert args.cron is None
            assert args.run_now is False
            assert args.once is False
            assert args.health is False

    def test_interval(self):
        with patch("sys.argv", ["worker", "--interval", "15"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.interval == 15

    def test_cron(self):
        with patch("sys.argv", ["worker", "--cron", "0 * * * *"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.cron == "0 * * * *"

    def test_run_now(self):
        with patch("sys.argv", ["worker", "--run-now"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.run_now is True

    def test_once(self):
        with patch("sys.argv", ["worker", "--once"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.once is True

    def test_health(self):
        with patch("sys.argv", ["worker", "--health"]):
            from apps.worker.main import parse_args
            args = parse_args()
            assert args.health is True


# ============================================
# main (via sys.argv patching)
# ============================================


class TestMain:
    def test_health_check_pass(self):
        with patch("apps.worker.main.run_health_check", return_value=0):
            with patch("sys.argv", ["worker", "--health"]):
                from apps.worker.main import main
                result = main()
                assert result == 0

    def test_health_check_fail(self):
        with patch("apps.worker.main.run_health_check", return_value=1):
            with patch("sys.argv", ["worker", "--health"]):
                from apps.worker.main import main
                result = main()
                assert result == 1

    def test_once_success(self):
        with patch("apps.worker.main.run_once", return_value=0):
            with patch("sys.argv", ["worker", "--once"]):
                from apps.worker.main import main
                result = main()
                assert result == 0

    def test_once_failure(self):
        with patch("apps.worker.main.run_once", return_value=1):
            with patch("sys.argv", ["worker", "--once"]):
                from apps.worker.main import main
                result = main()
                assert result == 1

    def test_scheduler_success(self):
        with patch("apps.worker.main.run_scheduler", return_value=0):
            with patch("sys.argv", ["worker", "--interval", "15"]):
                from apps.worker.main import main
                result = main()
                assert result == 0

    def test_scheduler_error(self):
        with patch("apps.worker.main.run_scheduler", return_value=1):
            with patch("sys.argv", ["worker", "--cron", "0 * * * *"]):
                from apps.worker.main import main
                result = main()
                assert result == 1
