"""Unit tests for timezone.py and status_store.py."""

from pathlib import Path
from unittest.mock import patch

import pytest

from apps.worker.status_store import resolve_worker_status_path


# ============================================
# status_store.resolve_worker_status_path
# ============================================


class TestResolveWorkerStatusPath:
    def test_default_path(self):
        with patch.dict("os.environ", {}, clear=True):
            path = resolve_worker_status_path()
            assert path.name == "status.json"
            assert "output" in str(path)
            assert "worker" in str(path)

    def test_env_override(self, tmp_path: Path):
        custom = tmp_path / "custom-status.json"
        with patch.dict("os.environ", {"WORKER_STATUS_PATH": str(custom)}, clear=False):
            path = resolve_worker_status_path()
            assert path == custom

    def test_env_override_with_tilde(self):
        with patch.dict("os.environ", {"WORKER_STATUS_PATH": "~/tmp/worker-status.json"}, clear=False):
            path = resolve_worker_status_path()
            assert "~" not in str(path)  # Should be expanded
            assert path.name == "worker-status.json"

    def test_empty_env_uses_default(self):
        with patch.dict("os.environ", {"WORKER_STATUS_PATH": "  "}, clear=False):
            path = resolve_worker_status_path()
            assert path.name == "status.json"

    def test_no_env_uses_default(self):
        with patch.dict("os.environ", {}, clear=True):
            path = resolve_worker_status_path()
            assert path.name == "status.json"
