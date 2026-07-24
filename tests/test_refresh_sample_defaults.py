from __future__ import annotations

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
RESUME_SCRIPTS_DIR = SCRIPTS_DIR / "resume"


def _load_module(module_name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_collect_browser_source_defaults_to_top50() -> None:
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        module = _load_module("test_collect_browser_source", RESUME_SCRIPTS_DIR / "collect_browser_source.py")
    finally:
        sys.path.pop(0)

    parser = module.build_parser()
    args = parser.parse_args(["--source", "seek"])

    assert args.limit == 50


def test_refresh_sample_defaults_to_top50(tmp_path: Path) -> None:
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        module = _load_module("test_refresh_sample", SCRIPTS_DIR / "refresh_sample.py")
    finally:
        sys.path.pop(0)

    captured: dict[str, object] = {}

    class _FakeSession:
        async def __aenter__(self):
            return object(), 1

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def fake_open_cdp_session(port: int, search_url: str):
        captured["port"] = port
        captured["search_url"] = search_url
        return _FakeSession()

    async def fake_execute_scrape_job(*, client, context_id, limit, max_pages, allow_empty, progress_callback=None):
        captured["limit"] = limit
        captured["max_pages"] = max_pages
        captured["allow_empty"] = allow_empty
        return [{"resumeId": "resume-1"}]

    async def fake_eval_json(client, expression, context_id=None):
        if expression == "window.location.href":
            return captured.get("search_url", "https://hr.job5156.com/search?keyword=%E9%94%80%E5%94%AE")
        return {
            "extensionVersion": "test",
            "pagination": {"totalPages": 1},
        }

    original_argv = sys.argv[:]
    try:
        module.open_cdp_session = fake_open_cdp_session
        module.execute_scrape_job = fake_execute_scrape_job
        module.eval_json = fake_eval_json
        module.OUTPUT_DIR = tmp_path
        sys.argv = ["refresh_sample.py"]

        exit_code = asyncio.run(module.run())
    finally:
        sys.argv = original_argv

    assert exit_code == 0
    assert captured["limit"] == 50
    assert (tmp_path / "sample-initial.json").exists()


def test_collect_browser_source_gives_51job_more_time_for_top50() -> None:
    sys.path.insert(0, str(SCRIPTS_DIR))
    try:
        module = _load_module("test_collect_browser_source_timeout", RESUME_SCRIPTS_DIR / "collect_browser_source.py")
    finally:
        sys.path.pop(0)

    captured: dict[str, object] = {}

    async def fake_eval_json(client, expression, context_id=None, timeout=0):
        captured["timeout"] = timeout
        return {"metadata": {}, "resumes": [{"resumeId": "resume-1"}]}

    original_eval_json = module.eval_json
    try:
        module.eval_json = fake_eval_json
        asyncio.run(module.collect_payload(object(), 1, source="51job", limit=50, max_pages=1))
    finally:
        module.eval_json = original_eval_json

    assert captured["timeout"] > 180
