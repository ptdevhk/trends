"""Unit tests for apps.worker.resume_tasks pure function helpers."""

from pathlib import Path
from typing import Any, Optional
from unittest.mock import patch

import pytest

from apps.worker.resume_tasks import (
    _read_env_var_from_file,
    _to_positive_int,
    _to_optional_positive_int,
)


# ---------------------------------------------------------------------------
# _read_env_var_from_file
# ---------------------------------------------------------------------------

class TestReadEnvVarFromFile:
    def test_simple_value(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("MY_KEY=my_value\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "my_value"

    def test_quoted_double(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text('MY_KEY="my value"\n')
        assert _read_env_var_from_file(env_file, "MY_KEY") == "my value"

    def test_quoted_single(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("MY_KEY='my value'\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "my value"

    def test_export_prefix(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("export MY_KEY=exported_val\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "exported_val"

    def test_missing_key(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("OTHER_KEY=value\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") is None

    def test_missing_file(self, tmp_path: Path):
        missing = tmp_path / "nonexistent"
        assert _read_env_var_from_file(missing, "MY_KEY") is None

    def test_comment_lines_ignored(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("# comment\nMY_KEY=val\n# another\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "val"

    def test_empty_lines_ignored(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("\n\nMY_KEY=val\n\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "val"

    def test_empty_value_returns_none(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text('MY_KEY=""\n')
        assert _read_env_var_from_file(env_file, "MY_KEY") is None

    def test_first_match_wins(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("MY_KEY=first\nMY_KEY=second\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") == "first"

    def test_empty_quotes_value_returns_none(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("MY_KEY=''\n")
        assert _read_env_var_from_file(env_file, "MY_KEY") is None


# ---------------------------------------------------------------------------
# _to_positive_int
# ---------------------------------------------------------------------------

class TestToPositiveInt:
    def test_valid_positive(self):
        assert _to_positive_int(5, 10) == 5
        assert _to_positive_int(100, 10) == 100

    def test_string_number(self):
        assert _to_positive_int("42", 10) == 42

    def test_zero_returns_fallback(self):
        assert _to_positive_int(0, 10) == 10

    def test_negative_returns_fallback(self):
        assert _to_positive_int(-5, 10) == 10

    def test_none_returns_fallback(self):
        assert _to_positive_int(None, 10) == 10

    def test_non_numeric_string_returns_fallback(self):
        assert _to_positive_int("abc", 10) == 10

    def test_float_truncates(self):
        # Python int(3.7) == 3 — truncation, not error
        assert _to_positive_int(3.7, 10) == 3

    def test_float_string_returns_fallback(self):
        assert _to_positive_int("3.7", 10) == 10


# ---------------------------------------------------------------------------
# _to_optional_positive_int
# ---------------------------------------------------------------------------

class TestToOptionalPositiveInt:
    def test_valid_positive(self):
        assert _to_optional_positive_int(5) == 5
        assert _to_optional_positive_int(100) == 100

    def test_string_number(self):
        assert _to_optional_positive_int("42") == 42

    def test_zero_returns_none(self):
        assert _to_optional_positive_int(0) is None

    def test_negative_returns_none(self):
        assert _to_optional_positive_int(-5) is None

    def test_none_returns_none(self):
        assert _to_optional_positive_int(None) is None

    def test_non_numeric_string_returns_none(self):
        assert _to_optional_positive_int("abc") is None

    def test_float_truncates(self):
        # Python int(3.7) == 3 — truncation, not error
        assert _to_optional_positive_int(3.7) == 3
