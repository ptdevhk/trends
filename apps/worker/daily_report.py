# coding=utf-8
"""
Sales daily report builder — run `scripts/daily-report/build-live.ts` from the worker.

Builds the rolling 7-day window of daily report packs and persists them to
Convex (`daily_reports` table) plus `config/daily-reports/snapshots/`. Intended
to run after a successful research ingest so the hub 「销售日报」 link has fresh HTML.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Asia/Shanghai has no DST; fixed +08:00 is correct for calendar "today".
_SHANGHAI = timezone(timedelta(hours=8))


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def stamp_path(root: Optional[Path] = None) -> Path:
    base = root or project_root()
    return base / "output" / "worker" / "daily-report-stamp.json"


def daily_report_build_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    """
    Gate for chaining / scheduling the daily-report build.

    Explicit DAILY_REPORT_BUILD_ENABLED wins. When unset, follow
    RESEARCH_INGEST_ENABLED so ingest→report stays paired in demo/dev.
    """
    source = env if env is not None else os.environ
    raw = str(source.get("DAILY_REPORT_BUILD_ENABLED", "")).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    ingest = str(source.get("RESEARCH_INGEST_ENABLED", "")).strip().lower()
    return ingest in {"1", "true", "yes", "on"}


def shanghai_today_ymd(now: Optional[datetime] = None) -> str:
    dt = now or datetime.now(_SHANGHAI)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_SHANGHAI)
    else:
        dt = dt.astimezone(_SHANGHAI)
    return dt.strftime("%Y-%m-%d")


def build_daily_report_command(date_ymd: Optional[str] = None) -> List[str]:
    date = date_ymd or shanghai_today_ymd()
    return ["npx", "tsx", "scripts/daily-report/build-live.ts", date]


def already_built_for_date(date_ymd: str, root: Optional[Path] = None) -> bool:
    """True when stamp says this Shanghai calendar day already built successfully."""
    path = stamp_path(root)
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return str(data.get("date", "")) == date_ymd and data.get("ok") is True


def write_build_stamp(date_ymd: str, *, ok: bool, root: Optional[Path] = None) -> None:
    path = stamp_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "date": date_ymd,
                "ok": ok,
                "finishedAt": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def run_daily_report_build(
    date_ymd: Optional[str] = None,
    *,
    timeout_sec: int = 900,
    env: Optional[Dict[str, str]] = None,
    force: bool = False,
) -> bool:
    """
    Invoke the TypeScript live builder. Returns True on exit 0.

    Skips when the Shanghai calendar day was already built successfully unless
    ``force=True`` (manual operator trigger).

    Timeout defaults to 15m — Google News URL decode for ~150 wrappers can
    take ~1 minute; leave headroom for cold npx.
    """
    root = project_root()
    date = date_ymd or shanghai_today_ymd()
    if not force and already_built_for_date(date, root):
        logger.info("[daily-report] skip — already built for %s", date)
        return True

    cmd = build_daily_report_command(date)
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    logger.info("[daily-report] starting: %s (cwd=%s)", " ".join(cmd), root)
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(root),
            env=run_env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
    except subprocess.TimeoutExpired as err:
        logger.error("[daily-report] timed out after %ss: %s", timeout_sec, err)
        write_build_stamp(date, ok=False, root=root)
        return False
    except FileNotFoundError as err:
        logger.error("[daily-report] npx/tsx missing: %s", err)
        write_build_stamp(date, ok=False, root=root)
        return False

    if completed.stdout:
        for line in completed.stdout.strip().splitlines()[-20:]:
            logger.info("[daily-report] %s", line)
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-2000:]
        logger.error(
            "[daily-report] failed exit=%s\n%s",
            completed.returncode,
            tail,
        )
        write_build_stamp(date, ok=False, root=root)
        return False

    write_build_stamp(date, ok=True, root=root)
    logger.info("[daily-report] ok for %s", date)
    return True


__all__ = [
    "daily_report_build_enabled",
    "shanghai_today_ymd",
    "build_daily_report_command",
    "already_built_for_date",
    "write_build_stamp",
    "run_daily_report_build",
    "project_root",
    "stamp_path",
]
