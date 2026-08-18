import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from apps.worker.crawl_progress import (
    load_crawl_progress,
    save_crawl_progress,
    update_profile_record,
)

logger = logging.getLogger(__name__)


def _idempotency_part(value: Any) -> str:
    normalized = re.sub(r"\s+", "-", str(value).strip().lower())
    normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff._:-]+", "-", normalized)
    return normalized.strip("-") or "none"


def _build_profile_dispatch_idempotency_key(
    *,
    profile_id: str,
    keyword_str: str,
    location: str,
    limit: int,
    max_pages: int,
    min_age: Optional[int],
    max_age: Optional[int],
    max_salary: Optional[int],
    auto_analyze: bool,
    analysis_top_n: int,
) -> str:
    parts = [
        "profile",
        _idempotency_part(profile_id or "unknown"),
        _idempotency_part(keyword_str),
        _idempotency_part(location),
        str(limit),
        str(max_pages),
    ]
    if min_age is not None or max_age is not None:
        parts.append(f"age-{min_age or 'none'}-{max_age or 'none'}")
    if max_salary is not None:
        parts.append(f"salary-max-{max_salary}")
    if auto_analyze:
        parts.append(f"analyze-{analysis_top_n}")
    return ":".join(parts)


def _read_env_var_from_file(file_path: Path, key: str) -> Optional[str]:
    if not file_path.exists():
        return None

    pattern = re.compile(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = pattern.match(line)
        if not match or match.group(1) != key:
            continue

        value = match.group(2).strip()
        if (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]

        return value or None

    return None


def _resolve_convex_url() -> Optional[str]:
    direct = os.environ.get("CONVEX_URL")
    if direct:
        return direct

    vite = os.environ.get("VITE_CONVEX_URL")
    if vite:
        return vite

    project_root = Path(__file__).resolve().parents[2]
    candidate_files = [
        project_root / "packages" / "convex" / ".env.local",
        project_root / "apps" / "web" / ".env.local",
        project_root / ".env.local",
        project_root / ".env",
    ]

    for file_path in candidate_files:
        file_direct = _read_env_var_from_file(file_path, "CONVEX_URL")
        if file_direct:
            return file_direct

        file_vite = _read_env_var_from_file(file_path, "VITE_CONVEX_URL")
        if file_vite:
            return file_vite

    return None


def _convex_mutation(convex_url: str, mutation_path: str, args: Dict[str, Any]) -> Any:
    api_url = f"{convex_url.rstrip('/')}/api/mutation"
    payload = json.dumps({"path": mutation_path, "args": args}).encode("utf-8")
    request = Request(
        api_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"Convex mutation failed ({error.code}): {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Convex mutation network error: {error}") from error

    data = json.loads(body)
    if data.get("status") != "success":
        message = data.get("errorMessage") or "Unknown Convex mutation error"
        raise RuntimeError(message)

    return data.get("value")


def _convex_query(convex_url: str, query_path: str, args: Dict[str, Any]) -> Any:
    api_url = f"{convex_url.rstrip('/')}/api/query"
    payload = json.dumps({"path": query_path, "args": args}).encode("utf-8")
    request = Request(
        api_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"Convex query failed ({error.code}): {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Convex query network error: {error}") from error

    data = json.loads(body)
    if data.get("status") != "success":
        message = data.get("errorMessage") or "Unknown Convex query error"
        raise RuntimeError(message)

    return data.get("value")


def _to_positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
        if parsed <= 0:
            return fallback
        return parsed
    except (TypeError, ValueError):
        return fallback


def _to_optional_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
        if parsed <= 0:
            return None
        return parsed
    except (TypeError, ValueError):
        return None


def run_resume_crawl_task(profile: Dict[str, Any]) -> bool:
    """
    Dispatch a collection task to Convex for a specific search profile.

    This keeps scheduled profile crawls on the same collection pipeline used by
    the web/API critical path (collection_tasks -> scraper worker -> resumes).
    """

    if os.environ.get("ENABLE_HEADLESS_COLLECTOR") != "true":
        logger.info(
            "[Task] Headless collector disabled; skipping scheduled dispatch for profile %s",
            profile.get("id"),
        )
        return False

    profile_id = str(profile.get("id") or "")
    location = str(profile.get("location") or "").strip()

    keywords = profile.get("keywords", [])
    if isinstance(keywords, list):
        normalized_keywords: list[str] = []
        seen_keywords: set[str] = set()
        for item in keywords:
            token = str(item).strip()
            if not token or token in seen_keywords:
                continue
            seen_keywords.add(token)
            normalized_keywords.append(token)
        keyword_str = " ".join(normalized_keywords)
    else:
        keyword_str = str(keywords).strip()

    schedule = profile.get("schedule")
    max_candidates = None
    if isinstance(schedule, dict):
        max_candidates = schedule.get("maxCandidates")

    ai_config = profile.get("ai")
    auto_analyze = bool(profile.get("autoAnalyze", False))
    if isinstance(ai_config, dict) and profile.get("autoAnalyze") is None:
        auto_analyze = True

    limit = _to_positive_int(max_candidates or profile.get("limit"), 50)
    max_pages = _to_positive_int(profile.get("maxPages"), 10)
    analysis_top_n = _to_positive_int(profile.get("analysisTopN"), 10)

    filters = profile.get("filters")
    min_age = None
    max_age = None
    max_salary = None
    if isinstance(filters, dict):
        min_age = _to_optional_positive_int(filters.get("minAge"))
        max_age = _to_optional_positive_int(filters.get("maxAge"))
        salary_range = filters.get("salaryRange")
        if isinstance(salary_range, dict):
            max_salary = _to_optional_positive_int(salary_range.get("max"))

    if min_age is not None and max_age is not None and min_age > max_age:
        logger.error(
            "[Task] Profile %s has invalid age range; skipping dispatch (minAge=%s maxAge=%s)",
            profile_id,
            min_age,
            max_age,
        )
        return False

    if not keyword_str:
        logger.error("[Task] Profile %s missing keywords; skipping dispatch", profile_id)
        return False

    if not location:
        logger.error("[Task] Profile %s missing location; skipping dispatch", profile_id)
        return False

    convex_url = _resolve_convex_url()
    if not convex_url:
        logger.error("[Task] CONVEX_URL is not configured; cannot dispatch profile %s", profile_id)
        return False

    idempotency_key = _build_profile_dispatch_idempotency_key(
        profile_id=profile_id,
        keyword_str=keyword_str,
        location=location,
        limit=limit,
        max_pages=max_pages,
        min_age=min_age,
        max_age=max_age,
        max_salary=max_salary,
        auto_analyze=auto_analyze,
        analysis_top_n=analysis_top_n,
    )

    logger.info(
        "[Task] Dispatching profile crawl: id=%s location=%s keywords=%s limit=%s maxPages=%s",
        profile_id,
        location,
        keyword_str,
        limit,
        max_pages,
    )

    # Persisted per-profile dispatch state: a restarted scheduler can report the
    # last committed task instead of fire-and-forget. Writes are synchronous per
    # step, so nothing is buffered in memory to lose on shutdown.
    progress = load_crawl_progress()
    prior = progress.get(str(profile_id))
    prior = prior if isinstance(prior, dict) else {}
    prior_task_id = prior.get("taskId")

    try:
        if prior_task_id and prior.get("idempotencyKey") == idempotency_key:
            polled = _convex_query(convex_url, "resume_tasks:getById", {"taskId": prior_task_id})
            if isinstance(polled, dict) and polled.get("_id"):
                last_progress = polled.get("progress")
                if not isinstance(last_progress, dict):
                    last_progress = None
                update_profile_record(
                    progress,
                    profile_id,
                    idempotency_key=idempotency_key,
                    task_id=prior_task_id,
                    outcome=prior.get("outcome") or "reused",
                    last_status=polled.get("status"),
                    last_progress=last_progress,
                    last_polled_at=datetime.now(timezone.utc).isoformat(),
                )
                save_crawl_progress(progress)
                logger.info(
                    "[Task] Profile %s task %s last seen status=%s progress=%s",
                    profile_id,
                    prior_task_id,
                    polled.get("status"),
                    last_progress,
                )

        mutation_args: Dict[str, Any] = {
            "keyword": keyword_str,
            "location": location,
            "limit": limit,
            "maxPages": max_pages,
            "autoAnalyze": auto_analyze,
            "analysisTopN": analysis_top_n,
            "idempotencyKey": idempotency_key,
        }
        if min_age is not None:
            mutation_args["minAge"] = min_age
        if max_age is not None:
            mutation_args["maxAge"] = max_age
        if max_salary is not None:
            mutation_args["maxSalary"] = max_salary

        envelope = _convex_mutation(
            convex_url,
            "resume_tasks:dispatch",
            mutation_args,
        )

        if isinstance(envelope, dict):
            queued = envelope.get("queued") is True
            task_id = envelope.get("taskId") if queued else None
            reason = envelope.get("reason")
        elif isinstance(envelope, str) and envelope:
            queued, task_id, reason = True, envelope, None
        else:
            queued, task_id, reason = False, None, None

        if queued:
            outcome = (
                "reused"
                if prior_task_id and prior.get("idempotencyKey") == idempotency_key
                else "queued"
            )
            update_profile_record(
                progress,
                profile_id,
                idempotency_key=idempotency_key,
                task_id=task_id,
                outcome=outcome,
                dispatched_at=datetime.now(timezone.utc).isoformat(),
            )
            save_crawl_progress(progress)
            logger.info("[Task] Profile %s dispatched collection task %s", profile_id, task_id)
            return True

        outcome = "skipped_maintenance" if reason == "maintenance" else "skipped"
        update_profile_record(
            progress,
            profile_id,
            idempotency_key=idempotency_key,
            outcome=outcome,
            error=(
                None
                if reason == "maintenance"
                else f"unexpected dispatch response: {envelope!r}"
            ),
        )
        save_crawl_progress(progress)
        logger.warning("[Task] Profile %s dispatch not queued (reason=%s)", profile_id, reason)
        return False
    except Exception as error:
        update_profile_record(
            progress,
            profile_id,
            idempotency_key=idempotency_key,
            outcome="error",
            error=str(error),
        )
        save_crawl_progress(progress)
        logger.error("[Task] Failed to dispatch profile %s: %s", profile_id, error)
        return False
