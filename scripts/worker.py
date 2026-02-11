import argparse
import asyncio
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import httpx
except ImportError:
    print("Please install httpx: uv pip install httpx")
    sys.exit(1)

# Ensure 'scripts' is in sys.path to import refresh_sample sibling
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import existing scraping logic
from refresh_sample import (
    CDPClient,
    CDPError,
    DEFAULT_KEYWORD,
    DEFAULT_SAMPLE,
    CDP_PORT,
    open_cdp_session,
    execute_scrape_job,
    build_search_url,
    eval_json,
    wait_for,
    resolve_accessor_context,
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
        logger.error(f"Mutation {name} failed: {e}")
        raise

async def process_task(task, client: httpx.AsyncClient):
    logger.info(f"Processing task {task['_id']}: {task['config']}")
    
    config = task["config"]
    limit = int(config["limit"])
    max_pages = int(config.get("maxPages", 10))
    keyword = str(config["keyword"]).strip()
    location = str(config["location"]).strip()
    
    # Build search URL
    search_url = build_search_url(keyword, location)
    
    async def on_progress(count, page):
        status_msg = f"Scraping page {page}..." if page > 0 else "Initializing..."
        result = await convex_mutation(client, "resume_tasks:updateProgress", {
            "taskId": task["_id"],
            "current": count,
            "page": page,
            "total": limit, # approximate
            "lastStatus": status_msg
        })
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
                raise CDPError(
                    f"No resumes extracted for keyword='{keyword}' location='{location}'. "
                    f"url='{final_url}' status={final_status}"
                )
            
            # Submit results
            if resumes:
                # Transform to match schema if needed, schema expects externalId, content, hash, source, tags
                formatted_resumes = []
                for r in resumes:
                    # simplistic mapping
                    external_id = r.get("id") or hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest()
                    formatted_resumes.append({
                        "externalId": external_id,
                        "content": r,
                        "hash": hashlib.md5(json.dumps(r, sort_keys=True).encode()).hexdigest(),
                        "source": "hr.job5156.com",
                        "tags": [] # Could add search profile ID here
                    })
                
                await convex_mutation(client, "resume_tasks:submitResumes", { 
                    "resumes": formatted_resumes 
                })
            
            await convex_mutation(client, "resume_tasks:complete", {
                "taskId": task["_id"],
                "status": "completed"
            })
            logger.info(f"Task {task['_id']} completed")

    except CancellationError as e:
        logger.info(f"Task {task['_id']} was cancelled: {e}")
        # No need to call complete, it's already cancelled
    except Exception as e:
        logger.error(f"Task failed: {e}")
        await convex_mutation(client, "resume_tasks:complete", {
            "taskId": task["_id"],
            "status": "failed",
            "error": str(e)
        })

async def worker_loop():
    async with httpx.AsyncClient() as client:
        logger.info(f"Worker {WORKER_ID} started. Polling {CONVEX_URL}...")
        while True:
            try:
                # 1. Claim task
                task = await convex_mutation(client, "resume_tasks:claim", {
                    "workerId": WORKER_ID
                })
                
                if task:
                    await process_task(task, client)
                else:
                    await asyncio.sleep(5) # Poll interval
                    
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Loop error: {e}")
                await asyncio.sleep(5)

if __name__ == "__main__":
    try:
        asyncio.run(worker_loop())
    except KeyboardInterrupt:
        pass
