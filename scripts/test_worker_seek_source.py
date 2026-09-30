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
