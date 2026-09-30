"""Unit checks for the worker's Seek source/externalId handling.

Regression guard for the live bug where `submitResumes` stamped every row as
`source: "hr.job5156.com"` (worker.py submit format loop) and where
`derive_external_id` preferred the name-search profileUrl over the collect
externalId GUID.

Run:
    CONVEX_URL=http://127.0.0.1:3210 uv run --with httpx python3 -m pytest \
        scripts/test_worker_seek_source.py -q
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("CONVEX_URL", "http://127.0.0.1:3210")

import worker  # noqa: E402


SEEK_GUID = "64454550-aea1-11ec-bfb2-005056b16351"


def test_seek_external_id_prefers_collect_guid_over_name_search_url():
    row = {
        "externalId": f"hk.employer.seek.com:profile:{SEEK_GUID}",
        "profileUrl": (
            "https://hk.employer.seek.com/talentsearch/profiles/search"
            "?searchQuery=Kumaresan+Ramasamy&market=my"
        ),
        "resumeId": "999",
        "perUserId": "abc",
    }
    assert worker.derive_external_id(row) == f"hk.employer.seek.com:profile:{SEEK_GUID}"


def test_seek_source_is_not_job5156():
    row = {"source": "hk.employer.seek.com", "externalId": f"hk.employer.seek.com:profile:{SEEK_GUID}"}
    assert worker.resolve_submit_source(row) == "hk.employer.seek.com"


def test_seek_source_detected_from_external_id_host_without_source_field():
    row = {"externalId": "hk.employer.seek.com:profile:guid-xyz"}
    assert worker.resolve_submit_source(row) == "hk.employer.seek.com"


def test_seek_source_detected_from_sourcekey_token():
    assert worker.resolve_submit_source({"sourceKey": "seek"}) == "hk.employer.seek.com"


def test_job5156_row_keeps_job5156_source_and_identity():
    row = {"profileUrl": "https://hr.job5156.com/resume/view/12345", "resumeId": "12345"}
    assert worker.resolve_submit_source(row) == "hr.job5156.com"
    assert worker.derive_external_id(row) == "hr.job5156.com/api/com/resume/12345"


# ── process_task search-URL construction (Seek must not use job5156) ──

SEEK_TH_JOB_URL = (
    "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=TH&pageNumber=1"
    "&roleTitles=Services+Engineer%2CService+Technician%2CService+Manager"
    "&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC"
    "&matchAll=false&sortBy=RELEVANCE"
)


def test_seek_task_config_detected_from_source_token():
    assert worker._is_seek_task_config({"source": "seek"}) is True
    assert worker._is_seek_task_config({"sourceKey": "seek"}) is True


def test_seek_task_config_detected_from_host():
    assert worker._is_seek_task_config({"sourceHost": "hk.employer.seek.com"}) is True


def test_seek_task_config_detected_from_market_code():
    assert worker._is_seek_task_config({"market": "TH"}) is True
    assert worker._is_seek_task_config({"market": "MY"}) is True


def test_job5156_task_config_is_not_seek():
    assert worker._is_seek_task_config(
        {"keyword": "CNC", "location": "广东", "minAge": 20, "maxAge": 40}
    ) is False


def test_resolve_task_search_url_seek_uses_job_url_verbatim():
    cfg = {"source": "seek", "keyword": "CNC", "market": "TH", "jobUrl": SEEK_TH_JOB_URL}
    assert worker.resolve_task_search_url(cfg) == SEEK_TH_JOB_URL


def test_resolve_task_search_url_seek_builds_talentsearch_for_market():
    url = worker.resolve_task_search_url({"source": "seek", "keyword": "CNC", "market": "TH"})
    assert url.startswith("https://hk.employer.seek.com/talentsearch?")
    assert "market=TH" in url
    assert "keywords=CNC" in url


def test_resolve_task_search_url_seek_market_from_job_url():
    cfg = {"source": "seek", "keyword": "CNC", "jobUrl": SEEK_TH_JOB_URL}
    url = worker.resolve_task_search_url(cfg)
    assert url == SEEK_TH_JOB_URL  # jobUrl preferred and returned verbatim
    assert worker._resolve_seek_market(cfg) == "TH"


def test_resolve_task_search_url_seek_defaults_market_my():
    url = worker.resolve_task_search_url({"source": "seek", "keyword": "CNC"})
    assert "market=MY" in url


def test_resolve_task_search_url_job5156_uses_job5156_host():
    url = worker.resolve_task_search_url({"keyword": "销售", "location": "广东"})
    assert url.startswith("https://hr.job5156.com/search?")
    assert "keyword=" in url


def test_resolve_task_search_url_seek_never_returns_job5156_host():
    for cfg in (
        {"source": "seek", "keyword": "CNC", "market": "TH"},
        {"source": "seek", "keyword": "CNC", "market": "MY"},
        {"sourceKey": "seek", "keyword": "CNC", "market": "HK"},
        {"jobUrl": SEEK_TH_JOB_URL},
    ):
        url = worker.resolve_task_search_url(cfg)
        assert "hr.job5156.com" not in url, cfg
        assert "hk.employer.seek.com/talentsearch" in url, cfg
