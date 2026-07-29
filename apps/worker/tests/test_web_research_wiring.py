"""Scheduler-entry wiring tests for web research discovery."""

from __future__ import annotations

import pytest

from apps.worker import industry_evidence_research as ier
from apps.worker.web_research.discovery import DiscoveryJob
from apps.worker.web_research.http import GuardedWebResearchFetcher
from apps.worker.web_research.search import DuckDuckGoSearchProvider

_WEB_RESEARCH_ENV_KEYS = [
    "WEB_RESEARCH_ENABLED",
    "TAVILY_API_KEY",
    "BRAVE_API_KEY",
    "FIRECRAWL_API_KEY",
]


def test_build_discovery_job_from_env_returns_none_when_disabled(monkeypatch):
    for key in _WEB_RESEARCH_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    assert ier.build_discovery_job_from_env() is None


def test_build_discovery_job_from_env_returns_none_when_empty(monkeypatch):
    monkeypatch.setenv("WEB_RESEARCH_ENABLED", "")
    for key in _WEB_RESEARCH_ENV_KEYS:
        if key != "WEB_RESEARCH_ENABLED":
            monkeypatch.delenv(key, raising=False)
    assert ier.build_discovery_job_from_env() is None


def test_build_discovery_job_from_env_builds_duckduckgo_chain(monkeypatch):
    for key in _WEB_RESEARCH_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("WEB_RESEARCH_ENABLED", "1")
    job = ier.build_discovery_job_from_env()
    assert isinstance(job, DiscoveryJob)
    assert len(job.search_chain) == 1
    assert isinstance(job.search_chain[0], DuckDuckGoSearchProvider)
    assert isinstance(job.fetcher, GuardedWebResearchFetcher)
    assert job.config.enabled is True


def test_run_industry_evidence_maintenance_skip_path_unchanged(monkeypatch):
    monkeypatch.delenv("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", raising=False)
    monkeypatch.setenv("WEB_RESEARCH_ENABLED", "1")

    def _fail_job(*args, **kwargs):
        raise AssertionError("job must not be constructed on the skip path")

    monkeypatch.setattr(ier, "IndustryEvidenceMaintenanceJob", _fail_job)
    assert ier.run_industry_evidence_maintenance() is True


def test_guarded_web_research_fetcher_fetch_text_rejects_unsafe_url():
    fetcher = GuardedWebResearchFetcher()
    with pytest.raises(ValueError):
        fetcher.fetch_text("http://localhost/x")
