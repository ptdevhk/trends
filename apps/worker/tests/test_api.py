"""Unit tests for api.py FastAPI endpoints using TestClient."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path: Path):
    """Create a TestClient with status path redirected to tmp."""
    status_file = tmp_path / "status.json"

    with patch("apps.worker.api.resolve_worker_status_path", return_value=status_file):
        from apps.worker.api import app

        with TestClient(app) as c:
            yield c


@pytest.fixture
def sample_status():
    """Sample worker status JSON."""
    return {
        "jobs_executed": 10,
        "jobs_failed": 1,
        "jobs_missed": 2,
        "last_run": "2026-05-22T10:00:00+00:00",
        "last_success": "2026-05-22T10:00:00+00:00",
        "last_failure": "2026-05-22T09:30:00+00:00",
        "schedule_type": "interval",
        "schedule_value": "30 minutes",
        "running": True,
        "jobs": [
            {
                "id": "crawl_analyze",
                "name": "Crawl & Analyze",
                "next_run": "2026-05-22T10:30:00+00:00",
                "trigger": "interval:30m",
            }
        ],
    }


# ============================================
# GET /
# ============================================


class TestRootEndpoint:
    def test_root_returns_info(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "name" in data
        assert "version" in data
        assert data["docs"] == "/docs"
        assert data["health"] == "/health"


# ============================================
# GET /health
# ============================================


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
        assert "version" in data


# ============================================
# GET /worker/status
# ============================================


class TestWorkerStatusEndpoint:
    def test_status_no_file(self, client, tmp_path):
        """When status file doesn't exist, return default empty status."""
        response = client.get("/worker/status")
        assert response.status_code == 200
        data = response.json()
        assert data["jobs_executed"] == 0
        assert data["jobs_failed"] == 0
        assert data["jobs_missed"] == 0
        assert data["running"] is False
        assert data["jobs"] == []

    def test_status_with_file(self, client, tmp_path, sample_status):
        """When status file exists, return parsed content."""
        status_file = tmp_path / "status.json"
        status_file.write_text(json.dumps(sample_status), encoding="utf-8")

        response = client.get("/worker/status")
        assert response.status_code == 200
        data = response.json()
        assert data["jobs_executed"] == 10
        assert data["jobs_failed"] == 1
        assert data["running"] is True
        assert len(data["jobs"]) == 1
        assert data["jobs"][0]["id"] == "crawl_analyze"

    def test_status_invalid_json(self, client, tmp_path):
        """When status file has invalid JSON, return 500."""
        status_file = tmp_path / "status.json"
        status_file.write_text("not json{{{", encoding="utf-8")

        response = client.get("/worker/status")
        assert response.status_code == 500


# ============================================
# POST /worker/crawl
# ============================================


class TestWorkerCrawlEndpoint:
    def test_crawl_success(self, client):
        with patch("apps.worker.api.run_crawl_analyze", return_value=True):
            response = client.post("/worker/crawl")
            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["mode"] == "crawl"
            assert "started_at" in data
            assert "finished_at" in data

    def test_crawl_failure(self, client):
        with patch("apps.worker.api.run_crawl_analyze", return_value=False):
            response = client.post("/worker/crawl")
            assert response.status_code == 500


# ============================================
# POST /worker/run
# ============================================


class TestWorkerRunEndpoint:
    def test_run_once_success(self, client):
        with patch("apps.worker.api.run_crawl_analyze", return_value=True):
            response = client.post("/worker/run?once=true")
            assert response.status_code == 200
            data = response.json()
            assert data["mode"] == "worker-run"

    def test_run_once_failure(self, client):
        with patch("apps.worker.api.run_crawl_analyze", return_value=False):
            response = client.post("/worker/run?once=true")
            assert response.status_code == 500

    def test_run_not_once_rejected(self, client):
        response = client.post("/worker/run?once=false")
        assert response.status_code == 400


# ============================================
# POST /worker/summary
# ============================================


class TestWorkerSummaryEndpoint:
    def test_summary_success(self, client):
        with patch("apps.worker.api.run_workspace_summary", return_value=True):
            response = client.post(
                "/worker/summary",
                json={"workspaceSlug": "dev", "period": "daily", "channel": "telegram"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["mode"] == "summary"

    def test_summary_failure(self, client):
        with patch("apps.worker.api.run_workspace_summary", return_value=False):
            response = client.post(
                "/worker/summary",
                json={"workspaceSlug": "dev", "period": "daily", "channel": "telegram"},
            )
            assert response.status_code == 500

    def test_summary_default_values(self, client):
        with patch("apps.worker.api.run_workspace_summary", return_value=True) as mock:
            response = client.post("/worker/summary", json={})
            assert response.status_code == 200
            call_kwargs = mock.call_args[1]
            assert call_kwargs["workspace_slug"] == "dev"
            assert call_kwargs["period"] == "daily"
            assert call_kwargs["channel"] == "telegram"
            assert call_kwargs["dry_run"] is False

    def test_summary_custom_values(self, client):
        with patch("apps.worker.api.run_workspace_summary", return_value=True) as mock:
            response = client.post(
                "/worker/summary",
                json={
                    "workspaceSlug": "prod",
                    "period": "weekly",
                    "channel": "feishu",
                    "dryRun": True,
                    "templateId": "tmpl-123",
                },
            )
            assert response.status_code == 200
            call_kwargs = mock.call_args[1]
            assert call_kwargs["workspace_slug"] == "prod"
            assert call_kwargs["period"] == "weekly"
            assert call_kwargs["channel"] == "feishu"
            assert call_kwargs["dry_run"] is True
            assert call_kwargs["template_id"] == "tmpl-123"
