from __future__ import annotations

from typing import Any

from apps.worker import crawl_progress


def test_resolve_crawl_progress_path_default(monkeypatch) -> None:
    monkeypatch.delenv("WORKER_CRAWL_PROGRESS_PATH", raising=False)
    path = crawl_progress.resolve_crawl_progress_path()
    assert str(path).endswith("output/worker/crawl-progress.json")


def test_resolve_crawl_progress_path_env_override(monkeypatch) -> None:
    monkeypatch.setenv("WORKER_CRAWL_PROGRESS_PATH", "/tmp/x/crawl.json")
    assert str(crawl_progress.resolve_crawl_progress_path()) == "/tmp/x/crawl.json"


def test_load_missing_file_returns_empty(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("WORKER_CRAWL_PROGRESS_PATH", str(tmp_path / "nope.json"))
    assert crawl_progress.load_crawl_progress() == {}


def test_save_and_load_roundtrip(monkeypatch, tmp_path) -> None:
    path = tmp_path / "crawl-progress.json"
    monkeypatch.setenv("WORKER_CRAWL_PROGRESS_PATH", str(path))
    progress = {"profile-1": {"taskId": "task-001", "outcome": "queued"}}

    assert crawl_progress.save_crawl_progress(progress) is True
    assert crawl_progress.load_crawl_progress() == progress
    assert not (tmp_path / "crawl-progress.json.tmp").exists()


def test_load_corrupt_file_returns_empty(monkeypatch, tmp_path) -> None:
    path = tmp_path / "crawl-progress.json"
    path.write_text("{not json", encoding="utf-8")
    monkeypatch.setenv("WORKER_CRAWL_PROGRESS_PATH", str(path))

    assert crawl_progress.load_crawl_progress() == {}


def test_update_profile_record_creates_and_updates_in_place() -> None:
    progress: dict[str, Any] = {}
    crawl_progress.update_profile_record(
        progress,
        "profile-1",
        idempotency_key="k1",
        task_id="t1",
        outcome="queued",
        dispatched_at="2026-08-18T10:00:00+00:00",
    )
    crawl_progress.update_profile_record(
        progress,
        "profile-1",
        idempotency_key="k1",
        task_id="t1",
        outcome="reused",
        last_status="processing",
        last_progress={"current": 5, "page": 1, "total": 20},
    )

    assert list(progress.keys()) == ["profile-1"]
    record = progress["profile-1"]
    assert record["dispatchedAt"] == "2026-08-18T10:00:00+00:00"
    assert record["outcome"] == "reused"
    assert record["lastStatus"] == "processing"
    assert record["lastProgress"] == {"current": 5, "page": 1, "total": 20}
    assert record["updatedAt"] != "2026-08-18T10:00:00+00:00"


def test_update_profile_record_clears_error_when_absent() -> None:
    progress: dict[str, Any] = {}
    crawl_progress.update_profile_record(
        progress, "p1", idempotency_key="k1", outcome="error", error="boom"
    )
    crawl_progress.update_profile_record(progress, "p1", idempotency_key="k1", outcome="queued")

    assert "error" not in progress["p1"]
