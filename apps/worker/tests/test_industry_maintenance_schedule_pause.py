"""Worker honors industryMaintenanceSchedulePaused for schedule triggers only."""

from unittest.mock import MagicMock

from apps.worker.industry_evidence_research import run_industry_evidence_maintenance


def _stub_client(*, paused: bool = False):
    client = MagicMock()
    client.get_schedule_paused.return_value = {"paused": paused}
    client.list_industry_proposals.return_value = []
    client.list_industry_evidence_sources.return_value = []
    client.list_due_industry_evidence_sources.return_value = []
    client.start_maintenance_run.return_value = {"runId": "run-1"}
    client.claim_maintenance_run.return_value = True
    client.append_maintenance_ledger.return_value = {"ok": True}
    client.finish_maintenance_run.return_value = {
        "runId": "run-1",
        "status": "completed",
    }
    return client


def test_schedule_trigger_paused_finishes_skipped(monkeypatch):
    monkeypatch.setenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "1")
    client = _stub_client(paused=True)
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.ResearchConvexClient",
        lambda *a, **k: client,
    )
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.build_discovery_job_from_env",
        lambda: None,
    )

    ok = run_industry_evidence_maintenance(trigger="schedule")
    assert ok is True
    client.finish_maintenance_run.assert_called_once()
    finish = client.finish_maintenance_run.call_args[0][0]
    assert finish["status"] == "skipped"
    assert "paused" in finish.get("operatorSummary", "").lower() or "paused" in (
        finish.get("failureMessage") or ""
    ).lower()
    # No research path: discovery not required once paused.
    client.start_maintenance_run.assert_called_once()


def test_manual_trigger_paused_does_not_skip_for_pause(monkeypatch):
    monkeypatch.setenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "1")
    client = _stub_client(paused=True)
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.ResearchConvexClient",
        lambda *a, **k: client,
    )
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.build_discovery_job_from_env",
        lambda: None,
    )

    ok = run_industry_evidence_maintenance(run_id="run-manual", trigger="manual")
    assert ok is True
    # get_schedule_paused must NOT gate manual runs
    client.get_schedule_paused.assert_not_called()
    finish = client.finish_maintenance_run.call_args[0][0]
    # Job still runs (empty proposals) and finishes completed, not skipped for pause
    assert finish["status"] != "skipped" or "paused" not in (
        finish.get("operatorSummary") or ""
    ).lower()


def test_schedule_unpaused_runs_normally(monkeypatch):
    monkeypatch.setenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "1")
    client = _stub_client(paused=False)
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.ResearchConvexClient",
        lambda *a, **k: client,
    )
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.build_discovery_job_from_env",
        lambda: None,
    )

    ok = run_industry_evidence_maintenance(trigger="schedule")
    assert ok is True
    client.get_schedule_paused.assert_called()
    finish = client.finish_maintenance_run.call_args[0][0]
    assert finish["status"] == "completed"
