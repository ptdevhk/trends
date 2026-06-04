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


def _enable_headless_collector(monkeypatch) -> None:
    monkeypatch.setenv("ENABLE_HEADLESS_COLLECTOR", "true")


def test_run_resume_crawl_task_normalizes_keyword_list_with_spaces(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    _enable_headless_collector(monkeypatch)
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
    assert captured["args"]["idempotencyKey"] == "profile:profile-1:cnc-车床-销售-star:东莞:120:10"


def test_run_resume_crawl_task_trims_and_skips_empty_keyword_items(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    _enable_headless_collector(monkeypatch)
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

    _enable_headless_collector(monkeypatch)
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

    _enable_headless_collector(monkeypatch)
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

    _enable_headless_collector(monkeypatch)
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
        period="weekly",
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
        "period": "weekly",
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


def test_run_workspace_summary_falls_back_to_daily_for_invalid_period(monkeypatch) -> None:
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
        api_base_url="http://localhost:3000",
        workspace_slug="dev",
        period="quarterly",
    )

    assert ok is True
    assert captured["body"]["period"] == "daily"
    assert captured["body"]["channel"] == "telegram"


def test_list_summary_profiles_runtime_normalizes_payload(monkeypatch) -> None:
    monkeypatch.setattr(
        tasks,
        "_request_json",
        lambda *_args, **_kwargs: {
            "success": True,
            "items": [
                {
                    "workspaceSlug": "dev",
                    "profileId": "daily-ops",
                    "name": "Daily Ops",
                    "cron": "0 9 * * *",
                    "period": "monthly",
                    "channel": "slack",
                    "dryRun": 1,
                    "templateId": "summary-daily",
                },
                {
                    "workspaceSlug": "hr",
                    "profileId": "hr-weekly",
                    "name": "HR Weekly",
                    "cron": "0 10 * * 1",
                    "period": "weekly",
                    "channel": "email",
                    "dryRun": False,
                    "to": "ops@example.com",
                    "subject": "Weekly HR Summary",
                },
                {
                    "workspaceSlug": "hr",
                    "profileId": "missing-email",
                    "name": "Missing Email",
                    "cron": "0 8 * * *",
                    "period": "daily",
                    "channel": "email",
                    "dryRun": False,
                },
            ],
        },
    )

    items = tasks.list_summary_profiles_runtime(api_base_url="http://localhost:3000/")

    assert items == [
        {
            "workspaceSlug": "dev",
            "profileId": "daily-ops",
            "name": "Daily Ops",
            "cron": "0 9 * * *",
            "period": "monthly",
            "channel": "telegram",
            "dryRun": True,
            "templateId": "summary-daily",
        },
        {
            "workspaceSlug": "hr",
            "profileId": "hr-weekly",
            "name": "HR Weekly",
            "cron": "0 10 * * 1",
            "period": "weekly",
            "channel": "email",
            "dryRun": False,
            "to": "ops@example.com",
            "subject": "Weekly HR Summary",
        },
    ]


def test_worker_scheduler_load_profile_jobs_schedules_runtime_profiles(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []
    constructed: list[bool] = []

    _enable_headless_collector(monkeypatch)

    class FakeLoader:
        def __init__(self) -> None:
            constructed.append(True)

        def load_profiles(self) -> list[dict[str, Any]]:
            return [
                {
                    "id": "job5156-cn-cnc-sales",
                    "cron": "0 9 * * 1-5",
                    "location": "China",
                    "keywords": ["CNC", "销售"],
                    "workspaceSlug": "dev",
                    "schedule": {"enabled": True, "cron": "0 9 * * 1-5"},
                },
            ]

    monkeypatch.setattr(worker_scheduler, "ProfileLoader", FakeLoader)

    scheduler = worker_scheduler.WorkerScheduler(timezone="UTC")
    monkeypatch.setattr(scheduler, "add_custom_job", lambda **kwargs: calls.append(kwargs))

    scheduler.load_profile_jobs()

    assert constructed == [True]
    assert calls == [
        {
            "func": worker_scheduler.run_resume_crawl_task,
            "job_id": "crawl_profile_job5156-cn-cnc-sales",
            "cron_expression": "0 9 * * 1-5",
            "profile": {
                "id": "job5156-cn-cnc-sales",
                "cron": "0 9 * * 1-5",
                "location": "China",
                "keywords": ["CNC", "销售"],
                "workspaceSlug": "dev",
                "schedule": {"enabled": True, "cron": "0 9 * * 1-5"},
            },
        },
    ]


def test_worker_scheduler_load_profile_jobs_logs_and_skips_loader_failures(monkeypatch, caplog) -> None:
    _enable_headless_collector(monkeypatch)

    class BrokenLoader:
        def __init__(self) -> None:
            pass

        def load_profiles(self) -> list[dict[str, Any]]:
            raise RuntimeError("runtime unavailable")

    monkeypatch.setattr(worker_scheduler, "ProfileLoader", BrokenLoader)

    scheduler = worker_scheduler.WorkerScheduler(timezone="UTC")
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(scheduler, "add_custom_job", lambda **kwargs: calls.append(kwargs))

    scheduler.load_profile_jobs()

    assert calls == []
    assert "Failed to load profile jobs: runtime unavailable" in caplog.text


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
    monkeypatch.setenv("WORKER_SUMMARY_PERIOD", "weekly")
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
    assert calls[0]["period"] == "weekly"
    assert calls[0]["channel"] == "telegram"
    assert calls[0]["dry_run"] is True
    assert calls[0]["trigger_source"] == "worker_schedule"
    assert calls[0]["template_id"] == "summary-daily"
    assert calls[0]["job_name"] == "Workspace Summary (hr)"


def test_add_summary_profile_jobs_schedules_runtime_profiles(monkeypatch) -> None:
    calls: list[dict[str, Any]] = []

    monkeypatch.setattr(
        worker_scheduler,
        "list_summary_profiles_runtime",
        lambda api_base_url=None: [
            {
                "workspaceSlug": "dev",
                "profileId": "daily-ops",
                "name": "Daily Ops",
                "cron": "0 9 * * *",
                "period": "daily",
                "channel": "telegram",
                "dryRun": False,
            },
            {
                "workspaceSlug": "hr",
                "profileId": "weekly-email",
                "name": "Weekly Email",
                "cron": "0 10 * * 1",
                "period": "weekly",
                "channel": "email",
                "dryRun": True,
                "to": "ops@example.com",
                "subject": "Weekly HR Summary",
            },
        ],
    )
    scheduler = worker_scheduler.WorkerScheduler(timezone="UTC")

    def fake_add_custom_job(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(scheduler, "add_custom_job", fake_add_custom_job)

    scheduler.add_summary_profile_jobs(api_base_url="http://localhost:3000")

    assert len(calls) == 2
    assert calls[0]["func"] is tasks.run_workspace_summary
    assert calls[0]["job_id"] == "workspace_summary:dev:daily-ops"
    assert calls[0]["job_name"] == "Summary Profile: dev / Daily Ops"
    assert calls[0]["cron_expression"] == "0 9 * * *"
    assert calls[0]["workspace_slug"] == "dev"
    assert calls[0]["period"] == "daily"
    assert calls[0]["channel"] == "telegram"
    assert calls[0]["dry_run"] is False
    assert calls[0]["trigger_source"] == "worker_schedule"

    assert calls[1]["job_id"] == "workspace_summary:hr:weekly-email"
    assert calls[1]["job_name"] == "Summary Profile: hr / Weekly Email"
    assert calls[1]["channel"] == "email"
    assert calls[1]["to"] == "ops@example.com"
    assert calls[1]["subject"] == "Weekly HR Summary"


def test_start_saves_rebuilt_jobs_before_initial_crawl(monkeypatch) -> None:
    order: list[str] = []
    scheduler = worker_scheduler.WorkerScheduler(run_immediately=True, timezone="UTC")

    monkeypatch.setattr(scheduler, "add_crawl_job", lambda: order.append("add_crawl_job"))
    monkeypatch.setattr(scheduler, "load_profile_jobs", lambda: order.append("load_profile_jobs"))
    monkeypatch.setattr(
        scheduler,
        "add_skills_version_check_job",
        lambda: order.append("add_skills_version_check_job"),
    )
    monkeypatch.setattr(
        scheduler,
        "add_scoring_auto_tune_job",
        lambda: order.append("add_scoring_auto_tune_job"),
    )
    monkeypatch.setattr(
        scheduler,
        "add_summary_profile_jobs",
        lambda: order.append("add_summary_profile_jobs"),
    )
    monkeypatch.setattr(
        scheduler,
        "add_workspace_summary_job",
        lambda: order.append("add_workspace_summary_job"),
    )
    monkeypatch.setattr(scheduler, "_save_stats", lambda: order.append("save_stats"))
    monkeypatch.setattr(
        worker_scheduler,
        "run_crawl_analyze",
        lambda **_kwargs: order.append("run_crawl_analyze") or True,
    )
    monkeypatch.setattr(scheduler.scheduler, "get_jobs", lambda: [])
    monkeypatch.setattr(scheduler.scheduler, "start", lambda: order.append("scheduler.start"))

    scheduler.start()

    assert order == [
        "add_crawl_job",
        "load_profile_jobs",
        "add_skills_version_check_job",
        "add_scoring_auto_tune_job",
        "add_summary_profile_jobs",
        "add_workspace_summary_job",
        "save_stats",
        "run_crawl_analyze",
        "save_stats",
        "scheduler.start",
    ]
