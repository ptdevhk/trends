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
    connect_to_browser,
    wait_for_results,
    eval_json,
    resolve_accessor_context,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
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
    limit = config["limit"]
    max_pages = config.get("maxPages", 10)
    keyword = config["keyword"]
    location = config["location"]
    
    # Initialize browser connection
    try:
        cdp_client, context_id = await connect_to_browser(CDP_PORT)
    except Exception as e:
        await convex_mutation(client, "resume_tasks:complete", {
            "taskId": task["_id"],
            "status": "failed",
            "error": f"Browser connection failed: {e}"
        })
        return

    # Prepare search
    # Note: We rely on the browser already being open or we need navigation logic here.
    # For now, we reuse refresh_sample logic which assumes active tab.
    # Ideally, we should navigate:
    # await cdp_client.navigate(build_search_url(...)) 
    
    # ... (Reuse scraping loop from refresh-sample.py, adapted for progress reporting) ...
    # This is a simplified version for the adapter proof-of-concept
    
    collected_count = 0
    current_page = 1
    
    try:
        while True:
            # Report progress
            await convex_mutation(client, "resume_tasks:updateProgress", {
                "taskId": task["_id"],
                "current": collected_count,
                "page": current_page
            })
            
            # Scrape (mocking the extraction call here for brevity, 
            # in real impl we call the specialized extraction functions)
            # ...
            
            # Simulate work for POC
            await asyncio.sleep(2)
            collected_count += 20
            
            if collected_count >= limit or current_page >= max_pages:
                break
                
            current_page += 1
            
        # Submit results
        # await convex_mutation(client, "resume_tasks:submitResumes", { "resumes": [...] })
        
        await convex_mutation(client, "resume_tasks:complete", {
            "taskId": task["_id"],
            "status": "completed"
        })
        logger.info(f"Task {task['_id']} completed")

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
