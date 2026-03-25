from __future__ import annotations

from typing import Any

from apps.worker import resume_tasks, scheduler as worker_scheduler, tasks


def _make_profile(keywords: Any, filters: Any = None) -> dict[str, Any]:
    profile = {
        "id": "profile-1",
        "location": "东莞",
        "keywords": keywords,
        "schedule": {"maxCandidates": 120},
    }
    if filters is not None:
        profile["filters"] = filters
    return profile


def test_run_resume_crawl_task_normalizes_keyword_list_with_spaces(monkeypatch) -> None:
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
    assert captured["args"]["keyword"] == "CNC 车床 销售 STAR"
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
    assert captured["args"]["keyword"] == "CNC 车床 销售"


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


def test_run_resume_crawl_task_passes_age_range_filters(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    monkeypatch.setattr(resume_tasks, "_resolve_convex_url", lambda: "http://127.0.0.1:3210")

    def fake_mutation(_convex_url: str, _mutation_path: str, args: dict[str, Any]) -> str:
        captured["args"] = args
        return "task-004"

    monkeypatch.setattr(resume_tasks, "_convex_mutation", fake_mutation)

    ok = resume_tasks.run_resume_crawl_task(
        _make_profile(["CNC", "车床", "销售"], filters={"minAge": 25, "maxAge": 40})
    )

    assert ok is True
    assert captured["args"]["minAge"] == 25
    assert captured["args"]["maxAge"] == 40


def test_run_workspace_summary_posts_summary_request(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_request_json(url: str, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
        captured["url"] = url
        captured["method"] = method
        captured["body"] = body
        return {
            "success": True,
            "channel": "telegram",
            "dryRun": True,
            "templateId": "summary-daily",
        }

    monkeypatch.setattr(tasks, "_request_json", fake_request_json)

    ok = tasks.run_workspace_summary(
        api_base_url="http://localhost:3000/",
        workspace_slug="hr",
        channel="telegram",
        dry_run=True,
        template_id="summary-daily",
        end_at="2026-03-26T12:00:00Z",
    )

    assert ok is True
    assert captured["url"] == "http://localhost:3000/api/summaries/run"
    assert captured["method"] == "POST"
    assert captured["body"] == {
        "workspaceSlug": "hr",
        "period": "daily",
        "channel": "telegram",
        "dryRun": True,
        "triggerSource": "worker_manual",
        "templateId": "summary-daily",
        "endAt": "2026-03-26T12:00:00Z",
    }


def test_run_workspace_summary_returns_false_when_api_fails(monkeypatch) -> None:
    monkeypatch.setattr(
        tasks,
        "_request_json",
        lambda *_args, **_kwargs: {"success": False, "error": "boom"},
    )

    ok = tasks.run_workspace_summary(api_base_url="http://localhost:3000", workspace_slug="dev")

    assert ok is False


def test_add_workspace_summary_job_requires_cron(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    monkeypatch.delenv("WORKER_SUMMARY_CRON", raising=False)
    scheduler = worker_scheduler.WorkerScheduler(timezone="UTC")

    def fake_add_custom_job(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(scheduler, "add_custom_job", fake_add_custom_job)

    scheduler.add_workspace_summary_job()

    assert calls == []


def test_add_workspace_summary_job_uses_env_config(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    monkeypatch.setenv("WORKER_SUMMARY_CRON", "15 18 * * 1-5")
    monkeypatch.setenv("WORKER_SUMMARY_WORKSPACE", "hr")
    monkeypatch.setenv("WORKER_SUMMARY_CHANNEL", "telegram")
    monkeypatch.setenv("WORKER_SUMMARY_DRY_RUN", "true")
    monkeypatch.setenv("WORKER_SUMMARY_TEMPLATE_ID", "summary-daily")
    scheduler = worker_scheduler.WorkerScheduler(timezone="UTC")

    def fake_add_custom_job(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(scheduler, "add_custom_job", fake_add_custom_job)

    scheduler.add_workspace_summary_job()

    assert len(calls) == 1
    assert calls[0]["func"] is tasks.run_workspace_summary
    assert calls[0]["job_id"] == "workspace_summary"
    assert calls[0]["cron_expression"] == "15 18 * * 1-5"
    assert calls[0]["workspace_slug"] == "hr"
    assert calls[0]["channel"] == "telegram"
    assert calls[0]["dry_run"] is True
    assert calls[0]["trigger_source"] == "worker_schedule"
    assert calls[0]["template_id"] == "summary-daily"
