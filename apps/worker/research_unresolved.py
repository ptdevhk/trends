# coding=utf-8
"""
Append research ingest unresolved brand samples into the industry-data steward queue.

Compatible with apps/api industry-unresolved-store shape:
  output/industry-data/unresolved-queue.json
"""

from __future__ import annotations

import json
import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from apps.worker.research_ports import NormalizedNewsItem
from apps.worker.research_resolve import extract_candidate_aliases

MAX_SAMPLES_PER_RUN = 20
MAX_EVENTS_FILE = 2000


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def default_unresolved_queue_path(project_root: Optional[Path] = None) -> Path:
    root = project_root or _project_root()
    return root / "output" / "industry-data" / "unresolved-queue.json"


def normalize_surface_key(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.casefold()
    text = re.sub(r"[\s\u00A0\u3000]+", " ", text)
    # Mirror @trends/shared normalizeCompanyAlias so Python and TypeScript
    # triggers coalesce on the same unresolved employer surface.
    text = re.sub(r"[()（）\[\]【】.,，。·・'\"`]", "", text)
    return text.strip()


def samples_from_unresolved_items(
    items: Sequence[NormalizedNewsItem],
    *,
    max_samples: int = MAX_SAMPLES_PER_RUN,
) -> List[Dict[str, Any]]:
    """
    Build steward samples for items that have alias candidates but produced no signals
    (caller should only pass items that failed to project).
    """
    samples: List[Dict[str, Any]] = []
    for item in items:
        if len(samples) >= max_samples:
            break
        candidates = extract_candidate_aliases(item.title, item.raw_snippet)
        if not candidates:
            continue
        surface = candidates[0]
        samples.append(
            {
                "surface": surface,
                "title": item.title,
                "platform": item.platform,
                "url": item.url,
                "captured_at": item.captured_at,
            }
        )
    return samples


def _event_from_sample(sample: Dict[str, Any], *, at: Optional[str] = None) -> Dict[str, Any]:
    surface = str(sample.get("surface") or sample.get("title") or "").strip()
    return {
        "surface": surface,
        "normalizedKey": normalize_surface_key(surface),
        "reason": "miss",
        "at": at or datetime.now(timezone.utc).isoformat(),
    }


def append_research_unresolved_to_queue(
    project_root: Path,
    samples: Sequence[Dict[str, Any]],
    *,
    max_per_run: int = MAX_SAMPLES_PER_RUN,
) -> int:
    """
    Append research miss events to unresolved-queue.json.
    Returns number of events appended.
    """
    if not samples:
        return 0
    capped = list(samples)[:max_per_run]
    path = default_unresolved_queue_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)

    existing_events: List[Dict[str, Any]] = []
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("events"), list):
                existing_events = [e for e in raw["events"] if isinstance(e, dict)]
        except (OSError, json.JSONDecodeError):
            existing_events = []

    now = datetime.now(timezone.utc).isoformat()
    new_events = [_event_from_sample(s, at=now) for s in capped if s.get("surface") or s.get("title")]
    if not new_events:
        return 0

    merged = (existing_events + new_events)[-MAX_EVENTS_FILE:]
    payload = {
        "version": 1,
        "updatedAt": now,
        "events": merged,
        "aggregates": [],  # steward tools recompute; keep file readable
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(new_events)


def promote_research_unresolved_to_proposals(
    client: Any,
    samples: Sequence[Dict[str, Any]],
    *,
    max_per_run: int = MAX_SAMPLES_PER_RUN,
) -> int:
    """Make Convex proposals primary while keeping the JSON queue diagnostic-only.

    Only the normalized employer surface and aggregate trigger/priority are sent.
    News titles, snippets, and URLs are deliberately excluded from proposal
    sample references because they are not resume evidence.
    """
    grouped: Dict[str, int] = {}
    for sample in list(samples)[:max_per_run]:
        surface = str(sample.get("surface") or "").strip()
        normalized = normalize_surface_key(surface)
        if normalized:
            grouped[normalized] = grouped.get(normalized, 0) + 1

    promoted = 0
    for normalized, count in sorted(grouped.items()):
        proposal_id = "industry-maintenance-" + hashlib.sha256(
            f"surface:{normalized}".encode("utf-8")
        ).hexdigest()[:20]
        client.upsert_industry_proposal(
            {
                "proposalId": proposal_id,
                "normalizedEmployerSurface": normalized,
                "triggerReasons": (
                    ["frequent_employer", "unknown_employer"]
                    if count >= 3
                    else ["unknown_employer"]
                ),
                "priority": min(100, 40 + max(0, count - 1) * 8),
            }
        )
        promoted += 1
    return promoted
