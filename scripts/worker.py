import asyncio
import hashlib
import json
import logging
import os
import re
import time
import sys
from typing import Any, Optional
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit

try:
    import httpx
except ImportError:
    print("Please install httpx: uv pip install httpx")
    sys.exit(1)

# Ensure 'scripts' is in sys.path to import refresh_sample sibling
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import existing scraping logic
from browser_cdp import (
    CDPError,
    CDP_PORT,
    eval_json,
    open_cdp_session,
    resolve_accessor_context,
    wait_for,
)
from refresh_sample import (
    build_search_url,
    execute_scrape_job,
)

class CancellationError(Exception):
    """Raised when a task is cancelled via Convex."""
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
# Reduce logging noise from libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger("worker")

CONVEX_URL = os.environ.get("CONVEX_URL")
WORKER_ID = os.environ.get("WORKER_ID", f"worker-{os.getpid()}")

if not CONVEX_URL:
    logger.error("CONVEX_URL environment variable is required")
    sys.exit(1)

# Ensure URL ends with /api
API_URL = f"{CONVEX_URL.rstrip('/')}/api"

_LAST_HEARTBEAT_WARNING_AT = 0.0
JOB5156_HOST = "hr.job5156.com"

def _is_connection_error(error: Exception) -> bool:
    return isinstance(error, (httpx.RequestError, httpx.TimeoutException))

def _read_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None

def _to_optional_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed

def _normalize_token(value: str) -> Optional[str]:
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed.lower()

def _extract_job5156_resume_id(pathname: str) -> Optional[str]:
    old_route_match = re.match(r"^/api/com/resume/([^/?#]+)", pathname, flags=re.IGNORECASE)
    if old_route_match:
        return unquote(old_route_match.group(1))

    view_route_match = re.match(r"^/resume/view/([^/?#]+)", pathname, flags=re.IGNORECASE)
    if view_route_match:
        return unquote(view_route_match.group(1))

    return None

def _normalize_job5156_profile_url_for_identity(value: str) -> Optional[str]:
    direct_resume_id = _extract_job5156_resume_id(value)
    if direct_resume_id:
        return f"{JOB5156_HOST}/api/com/resume/{quote(direct_resume_id, safe='')}".lower()

    parsed = urlsplit(value)
    if not parsed.netloc and not parsed.scheme:
        parsed = urlsplit(f"https://{value}")

    hostname = (parsed.hostname or "").lower()
    if hostname != JOB5156_HOST:
        return None

    resume_id = _extract_job5156_resume_id(parsed.path)
    if not resume_id:
        return None

    return f"{JOB5156_HOST}/api/com/resume/{quote(resume_id, safe='')}".lower()

def _normalize_profile_url(value: str) -> Optional[str]:
    trimmed = value.strip()
    if not trimmed:
        return None

    lowered = trimmed.lower()
    if lowered in ("javascript:;", "javascript:void(0)", "#"):
        return None

    normalized_job5156 = _normalize_job5156_profile_url_for_identity(trimmed)
    if normalized_job5156:
        return normalized_job5156

    parsed = urlsplit(trimmed)
    if not parsed.netloc and not parsed.scheme:
        parsed = urlsplit(f"https://{trimmed}")

    if parsed.netloc:
        host = parsed.netloc.lower()
        path = parsed.path.rstrip("/") or "/"
        query_pairs = sorted(
            (key, val)
            for key, val in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_")
        )
        query = urlencode(query_pairs)
        suffix = f"?{query}" if query else ""
        return f"{host}{path}{suffix}".lower()

    fallback = lowered
    if fallback.startswith("http://"):
        fallback = fallback[len("http://"):]
    if fallback.startswith("https://"):
        fallback = fallback[len("https://"):]
    if "#" in fallback:
        fallback = fallback.split("#", 1)[0]
    fallback = fallback.rstrip("/")
    return fallback or None

def derive_external_id(resume: dict[str, Any]) -> str:
    profile_url = (
        _read_str(resume.get("profileUrl"))
        or _read_str(resume.get("profile_url"))
        or _read_str(resume.get("profileURL"))
        or _read_str(resume.get("url"))
    )
    if profile_url:
        normalized_profile_url = _normalize_profile_url(profile_url)
        if normalized_profile_url:
            return normalized_profile_url

    resume_id = _read_str(resume.get("resumeId")) or _read_str(resume.get("resume_id"))
    if resume_id:
        normalized_resume_id = _normalize_token(resume_id)
        if normalized_resume_id:
            return normalized_resume_id

    per_user_id = _read_str(resume.get("perUserId")) or _read_str(resume.get("per_user_id"))
    if per_user_id:
        normalized_per_user_id = _normalize_token(per_user_id)
        if normalized_per_user_id:
            return normalized_per_user_id

    external_id = _read_str(resume.get("externalId")) or _read_str(resume.get("external_id"))
    if external_id:
        normalized_external_id = _normalize_token(external_id)
        if normalized_external_id:
            return normalized_external_id

    return hashlib.md5(json.dumps(resume, sort_keys=True).encode()).hexdigest()

async def convex_mutation(client: httpx.AsyncClient, name: str, args: dict):
    url = f"{API_URL}/mutation"
    payload = {"path": name, "args": args}
    try:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data["status"] != "success":
            raise Exception(f"Convex error: {data.get('errorMessage')}")
        return data["value"]
    except Exception as e:
        if _is_connection_error(e):
            logger.error("Mutation %s failed (Convex unreachable at %s): %s", name, CONVEX_URL, e)
        else:
            logger.error("Mutation %s failed: %s", name, e)
        raise

async def convex_query(client: httpx.AsyncClient, name: str, args: dict):
    url = f"{API_URL}/query"
    payload = {"path": name, "args": args}
    try:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        if data["status"] != "success":
            raise Exception(f"Convex error: {data.get('errorMessage')}")
        return data["value"]
    except Exception as e:
        if _is_connection_error(e):
            logger.error("Query %s failed (Convex unreachable at %s): %s", name, CONVEX_URL, e)
        else:
            logger.error("Query %s failed: %s", name, e)
        raise

async def heartbeat(
    client: httpx.AsyncClient,
    state: str,
    active_task_id: Optional[str] = None,
    last_error: Optional[str] = None,
):
    payload = {
        "workerId": WORKER_ID,
        "state": state,
    }
    if active_task_id:
        payload["activeTaskId"] = active_task_id
    if last_error:
        payload["lastError"] = last_error[:1000]

    try:
        await convex_mutation(client, "resume_tasks:heartbeat", payload)
    except Exception as error:
        global _LAST_HEARTBEAT_WARNING_AT
        now = time.monotonic()
        # Heartbeat failures are expected when Convex is down; rate-limit warnings.
        if now - _LAST_HEARTBEAT_WARNING_AT >= 30:
            _LAST_HEARTBEAT_WARNING_AT = now
            logger.warning("Heartbeat failed: %s", error)

async def process_task(task, client: httpx.AsyncClient):
    logger.info(f"Processing task {task['_id']}: {task['config']}")
    await heartbeat(client, "processing", active_task_id=task["_id"])
    
    config = task["config"]
    limit = int(config["limit"])
    max_pages = int(config.get("maxPages", 10))
    keyword = str(config["keyword"]).strip()
    location = str(config["location"]).strip()
    auto_analyze = bool(config.get("autoAnalyze"))
    min_age = _to_optional_positive_int(config.get("minAge"))
    max_age = _to_optional_positive_int(config.get("maxAge"))
    try:
        analysis_top_n = max(1, int(config.get("analysisTopN", 10)))
    except (TypeError, ValueError):
        analysis_top_n = 10
    
    # Build search URL
    if min_age is not None and max_age is not None and min_age > max_age:
        raise RuntimeError(f"Invalid age range (minAge={min_age} maxAge={max_age})")

    search_url = build_search_url(keyword, location, min_age=min_age, max_age=max_age)
    logger.info("Search filters: keyword=%s location=%s minAge=%s maxAge=%s", keyword, location, min_age, max_age)
    
    async def on_progress(count, page):
        status_msg = f"Scraping page {page}..." if page > 0 else "Initializing..."
        total_for_progress = max(limit, count)
        result = await convex_mutation(client, "resume_tasks:updateProgress", {
            "taskId": task["_id"],
            "current": count,
            "page": page,
            "total": total_for_progress,
            "lastStatus": status_msg
        })
        await heartbeat(client, "processing", active_task_id=task["_id"])
        if result and isinstance(result, dict) and result.get("status") == "cancelled":
            raise CancellationError("Task was cancelled by user")

    try:
        # Initial check
        await on_progress(0, 0)
        
        async with open_cdp_session(CDP_PORT, search_url) as (cdp_client, context_id):
            current_url = await eval_json(cdp_client, "window.location.href", context_id=context_id)
            logger.info(f"Active page: {current_url}")

            logger.info("Starting scrape job...")
            resumes = await execute_scrape_job(
                client=cdp_client,
                context_id=context_id,
                limit=limit,
                max_pages=max_pages,
                allow_empty=True, # Don't crash worker on empty results, just return empty
                progress_callback=on_progress
            )
            
            if not resumes:
                first_status = await eval_json(
                    cdp_client,
                    """(() => {
                      const api = window.__TR_RESUME_DATA__;
                      return api && typeof api.status === "function" ? api.status() : null;
                    })()""",
                    context_id=context_id,
                )
                logger.warning(
                    "Scrape returned 0 resumes (first attempt). Retrying once with hard navigation. status=%s",
                    first_status,
                )

                await cdp_client.call("Page.navigate", {"url": search_url})
                await wait_for(cdp_client, "document.readyState === 'complete'", timeout=30.0)
                accessor_found, retry_context_id = await resolve_accessor_context(cdp_client)
                if not accessor_found:
                    raise CDPError("Extension accessor not found after retry navigation.")

                resumes = await execute_scrape_job(
                    client=cdp_client,
                    context_id=retry_context_id,
                    limit=limit,
                    max_pages=max_pages,
                    allow_empty=True,
                    progress_callback=on_progress,
                )
                context_id = retry_context_id

            logger.info(f"Scraped {len(resumes)} resumes")

            if not resumes:
                final_status = await eval_json(
                    cdp_client,
                    """(() => {
                      const api = window.__TR_RESUME_DATA__;
                      return api && typeof api.status === "function" ? api.status() : null;
                    })()""",
                    context_id=context_id,
                )
                final_url = await eval_json(cdp_client, "window.location.href", context_id=context_id)
                logger.warning(
                    "No resumes extracted for keyword='%s' location='%s'. url='%s' status=%s",
                    keyword,
                    location,
                    final_url,
                    final_status,
                )
            
            # Submit results
            submit_stats = {
                "input": 0,
                "submitted": 0,
                "deduped": 0,
                "identityDeduped": 0,
                "identityMatched": 0,
                "legacyExternalIdMatched": 0,
                "inserted": 0,
                "updated": 0,
                "unchanged": 0,
            }
            analysis_task_id = None
            auto_analyzed = 0
            if resumes:
                # Transform to match schema if needed, schema expects externalId, content, hash, source, tags
                formatted_resumes = []
                for r in resumes:
                    external_id = derive_external_id(r)
                    formatted_resumes.append({
                        "externalId": external_id,
                        "content": r,
                        "hash": hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest(),
                        "source": "hr.job5156.com",
                        "tags": [] # Could add search profile ID here
                    })

                submit_result = await convex_mutation(client, "resume_tasks:submitResumes", {
                    "resumes": formatted_resumes 
                })
                if isinstance(submit_result, dict):
                    submit_stats["input"] = int(submit_result.get("input", len(formatted_resumes)))
                    submit_stats["submitted"] = int(submit_result.get("submitted", len(formatted_resumes)))
                    submit_stats["deduped"] = int(submit_result.get("deduped", 0))
                    submit_stats["identityDeduped"] = int(submit_result.get("identityDeduped", 0))
                    submit_stats["identityMatched"] = int(submit_result.get("identityMatched", 0))
                    submit_stats["legacyExternalIdMatched"] = int(submit_result.get("legacyExternalIdMatched", 0))
                    submit_stats["inserted"] = int(submit_result.get("inserted", 0))
                    submit_stats["updated"] = int(submit_result.get("updated", 0))
                    submit_stats["unchanged"] = int(submit_result.get("unchanged", 0))
                else:
                    submit_stats["input"] = len(formatted_resumes)
                    submit_stats["submitted"] = len(formatted_resumes)

            if auto_analyze and keyword:
                try:
                    search_hits = await convex_query(client, "resumes:search", {
                        "query": keyword,
                        "limit": analysis_top_n,
                    })
                    resume_ids = [
                        item.get("_id")
                        for item in search_hits
                        if isinstance(item, dict) and item.get("_id")
                    ]
                    if resume_ids:
                        analysis_task_id = await convex_mutation(client, "analysis_tasks:dispatch", {
                            "keywords": [keyword],
                            "resumeIds": resume_ids,
                        })
                        auto_analyzed = len(resume_ids)
                        logger.info(
                            "Auto-dispatched analysis task %s for collection task %s (%d candidates)",
                            analysis_task_id,
                            task["_id"],
                            len(resume_ids),
                        )
                    else:
                        logger.info(
                            "Auto-analysis requested for collection task %s but no candidates matched keyword '%s'",
                            task["_id"],
                            keyword,
                        )
                except Exception as analysis_error:
                    logger.warning(
                        "Auto-analysis dispatch failed for collection task %s: %s",
                        task["_id"],
                        analysis_error,
                    )

            complete_payload = {
                "taskId": task["_id"],
                "status": "completed",
                "results": {
                    "extracted": len(resumes),
                    "submitted": submit_stats["submitted"],
                    "deduped": submit_stats["deduped"],
                    "identityDeduped": submit_stats.get("identityDeduped", 0),
                    "identityMatched": submit_stats.get("identityMatched", 0),
                    "legacyExternalIdMatched": submit_stats.get("legacyExternalIdMatched", 0),
                    "inserted": submit_stats["inserted"],
                    "updated": submit_stats["updated"],
                    "unchanged": submit_stats["unchanged"],
                    "autoAnalyzed": auto_analyzed,
                }
            }
            if analysis_task_id:
                complete_payload["results"]["autoAnalysisTaskId"] = str(analysis_task_id)
            
            await convex_mutation(client, "resume_tasks:complete", complete_payload)
            await heartbeat(client, "idle")
            logger.info(f"Task {task['_id']} completed")

    except CancellationError as e:
        logger.info(f"Task {task['_id']} was cancelled: {e}")
        await heartbeat(client, "idle")
        # No need to call complete, it's already cancelled
    except Exception as e:
        logger.error(f"Task failed: {e}")
        await heartbeat(client, "error", active_task_id=task["_id"], last_error=str(e))
        await convex_mutation(client, "resume_tasks:complete", {
            "taskId": task["_id"],
            "status": "failed",
            "error": str(e)
        })
        await heartbeat(client, "idle")

async def worker_loop():
    async with httpx.AsyncClient() as client:
        logger.info(f"Worker {WORKER_ID} started. Polling {CONVEX_URL}...")
        await heartbeat(client, "idle")
        connection_backoff_seconds = 5
        last_connection_log_at = 0.0
        while True:
            try:
                await heartbeat(client, "idle")
                # 1. Claim task
                task = await convex_mutation(client, "resume_tasks:claim", {
                    "workerId": WORKER_ID
                })
                connection_backoff_seconds = 5
                
                if task:
                    await heartbeat(client, "processing", active_task_id=task["_id"])
                    await process_task(task, client)
                else:
                    await asyncio.sleep(5) # Poll interval
                    
            except KeyboardInterrupt:
                break
            except Exception as e:
                if _is_connection_error(e):
                    now = time.monotonic()
                    if now - last_connection_log_at >= 30:
                        last_connection_log_at = now
                        logger.error(
                            "Convex is not reachable at %s (is it running?). Try `make dev-convex-status`, `make dev-convex-refresh`, or `make dev`.",
                            CONVEX_URL,
                        )
                    await asyncio.sleep(connection_backoff_seconds)
                    connection_backoff_seconds = min(connection_backoff_seconds * 2, 60)
                    continue

                logger.error(f"Loop error: {e}")
                await heartbeat(client, "error", last_error=str(e))
                await asyncio.sleep(5)

if __name__ == "__main__":
    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        pass
