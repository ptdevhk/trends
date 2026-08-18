import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def resolve_crawl_progress_path() -> Path:
    """
    Resolve where the worker persists per-profile crawl dispatch progress.

    Environment:
    - WORKER_CRAWL_PROGRESS_PATH: Optional absolute/relative path override
    """
    env_path = os.environ.get("WORKER_CRAWL_PROGRESS_PATH", "").strip()
    if env_path:
        return Path(env_path).expanduser()

    project_root = Path(__file__).resolve().parents[2]
    return project_root / "output" / "worker" / "crawl-progress.json"


def load_crawl_progress(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load persisted per-profile crawl progress; missing/corrupt files yield {}."""
    target = path or resolve_crawl_progress_path()
    try:
        if not target.exists():
            return {}
        data = json.loads(target.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as error:
        logger.warning("[CrawlProgress] Failed to load %s: %s", target, error)
        return {}


def save_crawl_progress(progress: Dict[str, Any], path: Optional[Path] = None) -> bool:
    """Atomically persist progress (tmp file + rename); best-effort, returns success."""
    target = path or resolve_crawl_progress_path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(f"{target.name}.tmp")
        tmp.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(target)
        return True
    except OSError as error:
        logger.error("[CrawlProgress] Failed to save %s: %s", target, error)
        return False


def update_profile_record(
    progress: Dict[str, Any],
    profile_id: str,
    *,
    idempotency_key: str,
    task_id: Optional[str] = None,
    outcome: str,
    dispatched_at: Optional[str] = None,
    last_status: Optional[str] = None,
    last_progress: Optional[Dict[str, Any]] = None,
    last_polled_at: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """
    Merge dispatch-observation fields into a profile's progress record.

    Records are keyed by profile id (one entry per profile); a retried trigger
    with the same idempotency key updates the same entry in place, so duplicate
    triggers cannot duplicate progress state. `dispatchedAt` is only set on the
    first dispatch; every update refreshes `updatedAt`.
    """
    key = str(profile_id)
    record = progress.get(key)
    if not isinstance(record, dict):
        record = {}
        progress[key] = record

    record["idempotencyKey"] = idempotency_key
    record["outcome"] = outcome
    if task_id is not None:
        record["taskId"] = task_id
    if dispatched_at is not None:
        record.setdefault("dispatchedAt", dispatched_at)
    if last_status is not None:
        record["lastStatus"] = last_status
    if last_progress is not None:
        record["lastProgress"] = last_progress
    if last_polled_at is not None:
        record["lastPolledAt"] = last_polled_at
    if error is not None:
        record["error"] = error
    else:
        record.pop("error", None)
    record["updatedAt"] = datetime.now(timezone.utc).isoformat()
