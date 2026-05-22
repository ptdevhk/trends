"""Shared fixtures for worker tests."""

from pathlib import Path
from typing import Any, Dict, Optional
from unittest.mock import patch

import pytest


@pytest.fixture
def tmp_skills_state(tmp_path: Path):
    """Provide a temporary skills-version-state.json path and patch the module."""
    state_file = tmp_path / "skills-version-state.json"
    with patch("apps.worker.tasks._skills_state_path", return_value=state_file):
        yield state_file


@pytest.fixture
def mock_api_base():
    """Return a fake API base URL for HTTP-mocked tests."""
    return "http://localhost:9999"
