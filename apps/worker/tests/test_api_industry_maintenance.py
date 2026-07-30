"""Tests for the POST /worker/industry/maintenance endpoint.

Covers Task 3: the endpoint force-enables the env gate, threads runId/trigger
through to run_industry_evidence_maintenance, and restores the env afterwards.
"""
from unittest.mock import patch

from fastapi.testclient import TestClient


def _client():
    from apps.worker.api import app
    return TestClient(app)


class TestIndustryMaintenanceEndpoint:
    def test_success_force_enables_and_restores_env(self, monkeypatch):
        monkeypatch.delenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", raising=False)
        with patch(
            "apps.worker.api.run_industry_evidence_maintenance",
            return_value=True,
        ) as mock_run:
            with _client() as client:
                response = client.post(
                    "/worker/industry/maintenance",
                    json={"runId": "run-1", "trigger": "manual"},
                )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["mode"] == "industry-maintenance"
        # The function was called with the runId + trigger passthrough.
        mock_run.assert_called_once_with("run-1", "manual")

    def test_failure_returns_500(self, monkeypatch):
        monkeypatch.delenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", raising=False)
        with patch(
            "apps.worker.api.run_industry_evidence_maintenance",
            return_value=False,
        ):
            with _client() as client:
                response = client.post("/worker/industry/maintenance")
        assert response.status_code == 500

    def test_env_restored_when_preset(self, monkeypatch):
        """If the env gate was already set, the endpoint restores it (not clears)."""
        monkeypatch.setenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "0")
        with patch("apps.worker.api.run_industry_evidence_maintenance", return_value=True):
            with _client() as client:
                client.post("/worker/industry/maintenance")
        # Restored to the original "0", not cleared.
        import os
        assert os.environ.get("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED") == "0"

    def test_env_cleared_when_not_preset(self, monkeypatch):
        """If the env gate was unset, the endpoint clears it after (no residue)."""
        monkeypatch.delenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", raising=False)
        with patch("apps.worker.api.run_industry_evidence_maintenance", return_value=True):
            with _client() as client:
                client.post("/worker/industry/maintenance")
        import os
        assert "INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED" not in os.environ
