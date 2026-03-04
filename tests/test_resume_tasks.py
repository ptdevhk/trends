from __future__ import annotations

from typing import Any

from apps.worker import resume_tasks


def _make_profile(keywords: Any) -> dict[str, Any]:
    return {
        "id": "profile-1",
        "location": "东莞",
        "keywords": keywords,
        "schedule": {"maxCandidates": 120},
    }


def test_run_resume_crawl_task_concatenates_keyword_list(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    monkeypatch.setattr(resume_tasks, "_resolve_convex_url", lambda: "http://127.0.0.1:3210")

    def fake_mutation(convex_url: str, mutation_path: str, args: dict[str, Any]) -> str:
        captured["convex_url"] = convex_url
        captured["mutation_path"] = mutation_path
        captured["args"] = args
        return "task-001"

    monkeypatch.setattr(resume_tasks, "_convex_mutation", fake_mutation)

    ok = resume_tasks.run_resume_crawl_task(
        _make_profile(["CNC", "车床", "销售", "STAR"])
    )

    assert ok is True
    assert captured["convex_url"] == "http://127.0.0.1:3210"
    assert captured["mutation_path"] == "resume_tasks:dispatch"
    assert captured["args"]["keyword"] == "CNC车床销售STAR"
    assert captured["args"]["location"] == "东莞"
    assert captured["args"]["limit"] == 120


def test_run_resume_crawl_task_trims_and_skips_empty_keyword_items(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    monkeypatch.setattr(resume_tasks, "_resolve_convex_url", lambda: "http://127.0.0.1:3210")

    def fake_mutation(_convex_url: str, _mutation_path: str, args: dict[str, Any]) -> str:
        captured["args"] = args
        return "task-002"

    monkeypatch.setattr(resume_tasks, "_convex_mutation", fake_mutation)

    ok = resume_tasks.run_resume_crawl_task(
        _make_profile(["  CNC  ", "", "   ", "车床", "  销售  "])
    )

    assert ok is True
    assert captured["args"]["keyword"] == "CNC车床销售"


def test_run_resume_crawl_task_keeps_non_list_keyword_string(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    monkeypatch.setattr(resume_tasks, "_resolve_convex_url", lambda: "http://127.0.0.1:3210")

    def fake_mutation(_convex_url: str, _mutation_path: str, args: dict[str, Any]) -> str:
        captured["args"] = args
        return "task-003"

    monkeypatch.setattr(resume_tasks, "_convex_mutation", fake_mutation)

    ok = resume_tasks.run_resume_crawl_task(_make_profile("CNC 车床"))

    assert ok is True
    assert captured["args"]["keyword"] == "CNC 车床"


def test_run_resume_crawl_task_returns_false_for_empty_keyword(monkeypatch) -> None:
    called = {"mutation": False}

    monkeypatch.setattr(resume_tasks, "_resolve_convex_url", lambda: "http://127.0.0.1:3210")

    def fake_mutation(_convex_url: str, _mutation_path: str, _args: dict[str, Any]) -> str:
        called["mutation"] = True
        return "task-unexpected"

    monkeypatch.setattr(resume_tasks, "_convex_mutation", fake_mutation)

    ok = resume_tasks.run_resume_crawl_task(_make_profile(["", "   "]))

    assert ok is False
    assert called["mutation"] is False
