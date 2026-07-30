"""Tests for industry maintenance run ledger emission + self-registration.

Covers Task 2 of the industry-maintenance-ops-automation plan: the worker
threads a runId through the maintenance job, emits a per-proposal ledger row
at each decision point, accumulates counts, and finishes the run. Ledger
writes are best-effort - a Convex outage must never abort maintenance.
"""
from unittest.mock import MagicMock

from apps.worker.industry_evidence_research import (
    IndustryEvidenceMaintenanceJob,
    run_industry_evidence_maintenance,
)


def _proposal(proposal_id="p-1", priority=70, company_key="acme"):
    return {
        "proposalId": proposal_id,
        "priority": priority,
        "companyKey": company_key,
        "normalizedEmployerSurface": "acme sdn bhd",
    }


def _ready_result(proposal_id="p-1"):
    return {
        "status": "ready_for_review",
        "sources": [],
        "suggestedIndustryClass": None,
        "materialChangeSummary": "two approved sources",
    }


def _needs_more_result():
    return {
        "status": "needs_more_evidence",
        "sources": [],
        "suggestedIndustryClass": None,
        "materialChangeSummary": "no candidate sources",
    }


def _stub_client(proposals=None, due_sources=None):
    client = MagicMock()
    client.list_industry_proposals.return_value = proposals or []
    client.list_industry_evidence_sources.return_value = []
    client.list_due_industry_evidence_sources.return_value = due_sources or []
    client.upsert_industry_evidence_source.return_value = {}
    client.set_industry_proposal_research_state.return_value = {}
    client.upsert_industry_proposal.return_value = {"proposalId": "p-1"}
    client.record_industry_evidence_freshness_check.return_value = {}
    client.mark_industry_evidence_profiles_checking.return_value = {}
    # Best-effort ledger methods return None on success.
    client.start_maintenance_run.return_value = {"runId": "run-1"}
    client.claim_maintenance_run.return_value = True
    client.append_maintenance_ledger.return_value = {"ok": True}
    client.finish_maintenance_run.return_value = {"runId": "run-1", "status": "completed"}
    return client


def test_ledger_written_per_proposal_and_finish_called():
    proposals = [_proposal("p-1", company_key="acme")]
    client = _stub_client(proposals=proposals)
    researcher = MagicMock()
    researcher.enrich_proposal.return_value = _ready_result("p-1")

    job = IndustryEvidenceMaintenanceJob(
        client=client, researcher=researcher, run_id="run-1"
    )
    ok = job.run()
    assert ok is True

    # At least one ledger row was appended for the proposal.
    assert client.append_maintenance_ledger.called
    ledger_call = client.append_maintenance_ledger.call_args[0][0]
    assert ledger_call["runId"] == "run-1"
    assert ledger_call["proposalId"] == "p-1"
    assert ledger_call["action"] == "ready"

    # finish_maintenance_run was called with the runId + an operator summary.
    finish = client.finish_maintenance_run.call_args[0][0]
    assert finish["runId"] == "run-1"
    assert finish["status"] == "completed"
    assert "operatorSummary" in finish


def test_needs_more_evidence_emits_needs_more_ledger_action():
    proposals = [_proposal("p-2", company_key="acme-2")]
    client = _stub_client(proposals=proposals)
    researcher = MagicMock()
    researcher.enrich_proposal.return_value = _needs_more_result()

    job = IndustryEvidenceMaintenanceJob(
        client=client, researcher=researcher, run_id="run-2"
    )
    assert job.run() is True

    actions = [c[0][0]["action"] for c in client.append_maintenance_ledger.call_args_list]
    assert "needs_more_evidence" in actions


def test_ledger_failure_does_not_abort():
    proposals = [_proposal("p-3")]
    client = _stub_client(proposals=proposals)
    client.append_maintenance_ledger.side_effect = RuntimeError("convex down")
    researcher = MagicMock()
    researcher.enrich_proposal.return_value = _ready_result("p-3")

    job = IndustryEvidenceMaintenanceJob(
        client=client, researcher=researcher, run_id="run-3"
    )
    # Maintenance completes despite ledger write failures.
    assert job.run() is True
    # finish was still attempted (best-effort).
    assert client.finish_maintenance_run.called


def test_no_run_id_skips_ledger():
    """When run_id is None (direct CLI), no ledger/finish calls are made."""
    proposals = [_proposal("p-4")]
    client = _stub_client(proposals=proposals)
    researcher = MagicMock()
    researcher.enrich_proposal.return_value = _ready_result("p-4")

    job = IndustryEvidenceMaintenanceJob(client=client, researcher=researcher)
    assert job.run() is True
    assert not client.append_maintenance_ledger.called
    assert not client.finish_maintenance_run.called


def test_run_industry_evidence_maintenance_self_registers_run_when_no_run_id(monkeypatch):
    """With the env gate enabled and no run_id, the function self-registers a run."""
    monkeypatch.setenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "1")
    client = _stub_client()
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.ResearchConvexClient",
        lambda *a, **k: client,
    )
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.build_discovery_job_from_env",
        lambda: None,
    )

    ok = run_industry_evidence_maintenance()
    assert ok is True
    client.start_maintenance_run.assert_called_once()
    client.claim_maintenance_run.assert_called_once()
    client.finish_maintenance_run.assert_called_once()
    start_payload = client.start_maintenance_run.call_args[0][0]
    assert start_payload["triggerSource"] == "schedule"
    assert start_payload["runId"]


def test_run_industry_evidence_maintenance_skipped_records_skipped_run(monkeypatch):
    """When the env gate is off but a run_id is supplied, finish as skipped."""
    monkeypatch.delenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", raising=False)
    client = _stub_client()
    monkeypatch.setattr(
        "apps.worker.industry_evidence_research.ResearchConvexClient",
        lambda *a, **k: client,
    )

    ok = run_industry_evidence_maintenance(run_id="run-skip")
    assert ok is True
    # No research ran, but the run was finished as skipped.
    client.finish_maintenance_run.assert_called_once()
    finish = client.finish_maintenance_run.call_args[0][0]
    assert finish["runId"] == "run-skip"
    assert finish["status"] == "skipped"
