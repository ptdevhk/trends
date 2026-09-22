"""Tests for POST /worker/research/daily-report."""

from unittest.mock import patch

from fastapi.testclient import TestClient


def _client():
    from apps.worker.api import app

    return TestClient(app)


class TestDailyReportBuildEndpoint:
    def test_success_force_enables_and_restores_env(self, monkeypatch):
        monkeypatch.delenv("DAILY_REPORT_BUILD_ENABLED", raising=False)
        with patch(
            "apps.worker.api.run_daily_report_build_task",
            return_value=True,
        ) as mock_run:
            with _client() as client:
                response = client.post(
                    "/worker/research/daily-report",
                    json={"date": "2026-09-22", "force": True},
                )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "daily-report-build"
        assert data["backfill_results"] is None
        mock_run.assert_called_once_with("2026-09-22", force=True)

    def test_failure_returns_500(self, monkeypatch):
        monkeypatch.delenv("DAILY_REPORT_BUILD_ENABLED", raising=False)
        with patch(
            "apps.worker.api.run_daily_report_build_task",
            return_value=False,
        ):
            with _client() as client:
                response = client.post("/worker/research/daily-report")
        assert response.status_code == 500

    def test_backfill_days_builds_sequential_dates(self, monkeypatch):
        monkeypatch.delenv("DAILY_REPORT_BUILD_ENABLED", raising=False)
        monkeypatch.setenv("DAILY_REPORT_BUILD_ENABLED", "0")
        with patch(
            "apps.worker.api.run_daily_report_build_task",
            return_value=True,
        ) as mock_run:
            with _client() as client:
                response = client.post(
                    "/worker/research/daily-report",
                    json={"date": "2026-09-22", "backfill_days": 3},
                )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "daily-report-build"
        assert data["backfill_results"] is not None
        assert len(data["backfill_results"]) == 3
        assert [r["date"] for r in data["backfill_results"]] == [
            "2026-09-20",
            "2026-09-21",
            "2026-09-22",
        ]
        assert all(r["ok"] for r in data["backfill_results"])
        assert mock_run.call_count == 3
        mock_run.assert_any_call("2026-09-20", force=True)
        mock_run.assert_any_call("2026-09-21", force=True)
        mock_run.assert_any_call("2026-09-22", force=True)

    def test_backfill_days_defaults_end_to_shanghai_today(self, monkeypatch):
        monkeypatch.delenv("DAILY_REPORT_BUILD_ENABLED", raising=False)
        with patch(
            "apps.worker.api.run_daily_report_build_task",
            return_value=True,
        ) as mock_run, patch(
            "apps.worker.daily_report.shanghai_today_ymd",
            return_value="2026-09-22",
        ):
            with _client() as client:
                response = client.post(
                    "/worker/research/daily-report",
                    json={"backfill_days": 2},
                )
        assert response.status_code == 200
        data = response.json()
        assert [r["date"] for r in data["backfill_results"]] == [
            "2026-09-21",
            "2026-09-22",
        ]
        assert mock_run.call_count == 2
        mock_run.assert_any_call("2026-09-21", force=True)
        mock_run.assert_any_call("2026-09-22", force=True)

    def test_backfill_failure_returns_500_and_reports_failed_day(self, monkeypatch):
        monkeypatch.delenv("DAILY_REPORT_BUILD_ENABLED", raising=False)

        def fake_run(date_ymd, *, force):
            return date_ymd != "2026-09-21"

        with patch(
            "apps.worker.api.run_daily_report_build_task",
            side_effect=fake_run,
        ):
            with _client() as client:
                response = client.post(
                    "/worker/research/daily-report",
                    json={"date": "2026-09-22", "backfill_days": 3},
                )
        assert response.status_code == 500
