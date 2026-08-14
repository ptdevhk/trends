"""Scheduler-entry wiring tests for web research discovery."""

from __future__ import annotations

import pytest

from apps.worker import industry_evidence_research as ier
from apps.worker.web_research.discovery import DiscoveryJob
from apps.worker.web_research.http import GuardedWebResearchFetcher
from apps.worker.web_research.search import (
    DuckDuckGoSearchProvider,
    GoogleNewsRssSearchProvider,
    NewsNowSearchProvider,
    So360SearchProvider,
)

_WEB_RESEARCH_ENV_KEYS = [
    "WEB_RESEARCH_ENABLED",
    "WEB_RESEARCH_MARKET",
    "TAVILY_API_KEY",
    "BRAVE_API_KEY",
    "FIRECRAWL_API_KEY",
    "WEB_RESEARCH_360_ENABLED",
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


def test_build_discovery_job_from_env_builds_zero_key_chain(monkeypatch):
    for key in _WEB_RESEARCH_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("WEB_RESEARCH_ENABLED", "1")
    job = ier.build_discovery_job_from_env()
    assert isinstance(job, DiscoveryJob)
    # Default market is "cn" (product core): NewsNow leads the zero-key chain.
    assert len(job.search_chain) == 3
    assert isinstance(job.search_chain[0], NewsNowSearchProvider)
    assert isinstance(job.search_chain[1], DuckDuckGoSearchProvider)
    assert isinstance(job.search_chain[2], GoogleNewsRssSearchProvider)
    assert isinstance(job.fetcher, GuardedWebResearchFetcher)
    assert job.config.enabled is True


def test_build_discovery_job_from_env_so360_opt_in_prepends_cn_keyword_lane(monkeypatch):
    for key in _WEB_RESEARCH_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("WEB_RESEARCH_ENABLED", "1")
    monkeypatch.setenv("WEB_RESEARCH_360_ENABLED", "1")
    job = ier.build_discovery_job_from_env()
    assert isinstance(job, DiscoveryJob)
    assert len(job.search_chain) == 4
    assert isinstance(job.search_chain[0], So360SearchProvider)
    assert isinstance(job.search_chain[1], NewsNowSearchProvider)
    assert job.config.so360_enabled is True


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


class _FakeRedirectResponse:
    """urlopen stand-in: urllib has already followed the redirect, so the
    response's geturl() reports the (unsafe) final target."""
    def __init__(self, final_url, payload=b"{}"):
        self._final_url = final_url
        self._payload = payload
        self.read_calls = 0
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False
    def geturl(self):
        return self._final_url
    def read(self, n=-1):
        self.read_calls += 1
        return self._payload


def test_post_json_rejects_unsafe_redirect_before_reading_body(monkeypatch):
    response = _FakeRedirectResponse("http://localhost/admin")
    monkeypatch.setattr(
        "apps.worker.web_research.http.urlopen",
        lambda request, timeout: response,
    )
    fetcher = GuardedWebResearchFetcher(min_host_interval_seconds=0)
    with pytest.raises(ValueError):
        fetcher.post_json("https://api.tavily.com/search", {"query": "x"})
    assert response.read_calls == 0  # body never read


def test_get_json_rejects_unsafe_redirect_before_reading_body(monkeypatch):
    response = _FakeRedirectResponse("http://localhost/admin")
    monkeypatch.setattr(
        "apps.worker.web_research.http.urlopen",
        lambda request, timeout: response,
    )
    fetcher = GuardedWebResearchFetcher(min_host_interval_seconds=0)
    with pytest.raises(ValueError):
        fetcher.get_json("https://api.search.brave.com/res/v1/web/search?q=x")
    assert response.read_calls == 0  # body never read


def test_guarded_web_research_fetcher_zero_interval_and_default_init():
    fetcher = GuardedWebResearchFetcher(min_host_interval_seconds=0)
    assert fetcher._min_host_interval == 0.0
    default = GuardedWebResearchFetcher()
    assert default._min_host_interval == 1.5
    # default init still delegates page fetch to a GuardedEvidenceFetcher
    assert default.page_fetcher is not None


def test_throttle_sleeps_when_same_host_hit_twice_rapidly(monkeypatch):
    fetcher = GuardedWebResearchFetcher(min_host_interval_seconds=999)
    sleeps = []
    monkeypatch.setattr(
        "apps.worker.web_research.http.time.sleep",
        lambda seconds: sleeps.append(seconds),
    )
    url = "https://example.com/a"
    fetcher._throttle(url)
    assert sleeps == []  # first hit never waits
    fetcher._throttle(url)
    assert len(sleeps) == 1
    assert sleeps[0] > 0


def test_throttle_is_per_host(monkeypatch):
    fetcher = GuardedWebResearchFetcher(min_host_interval_seconds=999)
    sleeps = []
    monkeypatch.setattr(
        "apps.worker.web_research.http.time.sleep",
        lambda seconds: sleeps.append(seconds),
    )
    fetcher._throttle("https://a.example.com/x")
    fetcher._throttle("https://b.example.com/y")
    assert sleeps == []  # different hosts are independent
