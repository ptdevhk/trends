import os
from pathlib import Path


def resolve_worker_status_path() -> Path:
    """
    Resolve where the worker scheduler writes its runtime status JSON.

    Environment:
    - WORKER_STATUS_PATH: Optional absolute/relative path override
    """
    env_path = os.environ.get("WORKER_STATUS_PATH", "").strip()
    if env_path:
        return Path(env_path).expanduser()

    project_root = Path(__file__).resolve().parents[2]
    return project_root / "output" / "worker" / "status.json"

