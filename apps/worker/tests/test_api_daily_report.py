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
