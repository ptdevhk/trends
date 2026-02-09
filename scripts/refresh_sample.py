#!/usr/bin/env python3
"""
Refresh resume sample data via Chrome DevTools Protocol (CDP).

Chrome must be running with remote debugging enabled. Example:
  ./apps/browser-extension/scripts/cmux-setup-profile.sh
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

CDP_PORT = 9222
DEFAULT_KEYWORD = "销售"
DEFAULT_SAMPLE = "sample-initial"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "resumes" / "samples"


class CDPError(RuntimeError):
    pass


def fetch_json(url: str, timeout: float = 2.0):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def create_target(port: int, url: str):
    encoded = urllib.parse.quote(url, safe="")
    endpoint = f"http://127.0.0.1:{port}/json/new?{encoded}"
    try:
        return fetch_json(endpoint, timeout=3.0)
    except Exception:
        return None


def sanitize_sample_name(value: str) -> str:
    if not value:
        return ""
    cleaned = value.strip()
    cleaned = re.sub(r'[\\/:*?"<>|]', "-", cleaned)
    cleaned = re.sub(r"\s+", "-", cleaned)
    cleaned = re.sub(r"-+", "-", cleaned)
    cleaned = cleaned.lstrip(".")
    return cleaned[:80]


def build_search_url(keyword: str, location: str = "") -> str:
    params = {"keyword": keyword}
    if location:
        params["location"] = location
    return "https://hr.job5156.com/search?" + urllib.parse.urlencode(params)


def build_metadata(page_url: str, sample_name: str, status: dict | None, resumes: list) -> dict:
    parsed = urllib.parse.urlparse(page_url)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    keyword = (query.get("keyword", [""])[0] or "").strip()
    location = (query.get("location", [""])[0] or "").strip()

    filters = {}
    for key, values in query.items():
        if key in ("keyword", "location", "tr_auto_export", "tr_sample_name"):
            continue
        if not values:
            continue
        value = values[0]
        if value:
            filters[key] = value

    query.pop("tr_auto_export", None)
    query.pop("tr_sample_name", None)
    clean_query = urllib.parse.urlencode(
        [(k, v[0]) for k, v in query.items() if v and v[0] != ""]
    )
    source_url = urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", clean_query, "")
    )

    generated_by = "browser-extension"
    if status:
        version = status.get("extensionVersion") or ""
        if version and version != "unknown":
            generated_by = f"browser-extension@{version}"

    pagination = (status or {}).get("pagination") or {}
    total_pages = pagination.get("totalPages", 1)

    generated_at = (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

    reproduction_params = urllib.parse.urlencode(
        {"tr_auto_export": "json", "tr_sample_name": sample_name}
    )

    return {
        "sourceUrl": source_url,
        "searchCriteria": {
            "keyword": keyword,
            "location": location,
            "filters": filters,
        },
        "generatedAt": generated_at,
        "generatedBy": generated_by,
        "totalPages": total_pages,
        "totalResumes": len(resumes),
        "reproduction": f"Navigate to sourceUrl, then add ?{reproduction_params}",
    }


class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self._next_id = 0
        self.contexts: dict[int, dict] = {}

    async def _recv(self):
        raw = await self.ws.recv()
        msg = json.loads(raw)
        if "method" in msg:
            self._handle_event(msg)
            return ("event", msg)
        return ("response", msg)

    def _handle_event(self, msg: dict):
        method = msg.get("method")
        params = msg.get("params") or {}
        if method == "Runtime.executionContextCreated":
            context = params.get("context")
            if context and "id" in context:
                self.contexts[context["id"]] = context
        elif method == "Runtime.executionContextDestroyed":
            context_id = params.get("executionContextId")
            if context_id in self.contexts:
                self.contexts.pop(context_id, None)
        elif method == "Runtime.executionContextsCleared":
            self.contexts = {}

    async def call(self, method: str, params: dict | None = None, timeout: float = 20.0):
        self._next_id += 1
        request_id = self._next_id
        message = {"id": request_id, "method": method}
        if params:
            message["params"] = params
        await self.ws.send(json.dumps(message))
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise CDPError(f"Timeout waiting for {method}")
            try:
                kind, msg = await asyncio.wait_for(self._recv(), timeout=remaining)
            except asyncio.TimeoutError as exc:
                raise CDPError(f"Timeout waiting for {method}") from exc
            if kind == "response" and msg.get("id") == request_id:
                if "error" in msg:
                    raise CDPError(f"{method} failed: {msg['error']}")
                return msg.get("result") or {}


async def eval_json(client: CDPClient, expression: str, context_id: int | None = None):
    params = {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    }
    if context_id:
        params["contextId"] = context_id
    result = await client.call("Runtime.evaluate", params=params)
    if "exceptionDetails" in result:
        raise CDPError("Runtime.evaluate threw an exception")
    return (result.get("result") or {}).get("value")


def pick_contexts(contexts: dict[int, dict]) -> list[dict]:
    isolated = []
    for ctx in contexts.values():
        aux = ctx.get("auxData") or {}
        if aux.get("type") == "isolated":
            isolated.append(ctx)
    if not isolated:
        isolated = list(contexts.values())
    def rank(ctx: dict) -> tuple[int, str]:
        name = ctx.get("name") or ""
        if "Resume" in name or "智通直聘" in name:
            return (0, name)
        return (1, name)
    isolated.sort(key=rank)
    return isolated


async def resolve_accessor_context(client: CDPClient) -> tuple[bool, int | None]:
    probe = """(() => {
      const api = window.__TR_RESUME_DATA__;
      return !!(
        api &&
        typeof api.status === "function" &&
        typeof api.extract === "function"
      );
    })()"""
    try:
        if await eval_json(client, probe):
            return True, None
    except CDPError:
        pass

    for ctx in pick_contexts(client.contexts):
        ctx_id = ctx.get("id")
        if not ctx_id:
            continue
        try:
            if await eval_json(client, probe, context_id=ctx_id):
                return True, ctx_id
        except CDPError:
            continue
    return False, None


async def wait_for(
    client: CDPClient,
    expression: str,
    timeout: float = 20.0,
    interval: float = 0.5,
    context_id: int | None = None,
):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = await eval_json(client, expression, context_id=context_id)
        except CDPError:
            last = None
        if last:
            return last
        await asyncio.sleep(interval)
    return last


async def execute_scrape_job(
    client: CDPClient,
    context_id: int | None,
    limit: int = 200,
    max_pages: int = 10,
    allow_empty: bool = False,
    progress_callback: callable = None,
) -> list[dict]:
    """
    Executes the multi-page scraping logic.
    Returns a list of extracted resumes.
    """
    
    async def wait_for_results(timeout: float = 45.0):
        start = time.time()
        last = None
        while time.time() - start < timeout:
            last = await eval_json(
                client,
                """(() => {
                  const api = window.__TR_RESUME_DATA__;
                  return api && typeof api.status === "function" ? api.status() : null;
                })()""",
                context_id=context_id,
            )
            if last:
                counts = [
                    int(last.get("cardCount") or 0),
                ]
                if max(counts) > 0:
                    return last
                auto_search = (last.get("autoSearch") or "").lower()
                if auto_search in ("done", "skipped") and time.time() - start > 5:
                    break
            await asyncio.sleep(0.8)
        return last

    status = await wait_for_results()

    # Polyfill goToNextPage if missing (handling stale extension state)
    await eval_json(
        client,
        """(() => {
            const api = window.__TR_RESUME_DATA__;
            if (api && !api.goToNextPage) {
                console.log("🎯 [Dev] Polyfilling goToNextPage");
                api.goToNextPage = () => {
                    const nextBtn = document.querySelector('.el-pagination .btn-next');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                };
            }
        })()""",
        context_id=context_id,
    )

    await asyncio.sleep(0.5)
    all_resumes = []
    current_page = 1
    
    while True:
        print(f"Scraping page {current_page}...")
        
        # Wait for results to stabilize on this page
        status = await wait_for_results()
        await asyncio.sleep(0.5)

        # Extract resumes from current page
        page_resumes = await eval_json(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              return api && typeof api.extract === "function" ? api.extract() : null;
            })()""",
            context_id=context_id,
        )

        if not isinstance(page_resumes, list):
            if not allow_empty and not all_resumes:
                raise CDPError("Failed to extract resume data from the page.")
            page_resumes = []
        
        if not page_resumes and not allow_empty and not all_resumes:
            raise CDPError(
                "No resumes extracted. Ensure you are logged in and results are loaded."
            )

        # Append to collection
        all_resumes.extend(page_resumes)
        print(f"  Found {len(page_resumes)} resumes (Total: {len(all_resumes)})")

        if progress_callback:
            await progress_callback(len(all_resumes), current_page)

        # Check limits
        if len(all_resumes) >= limit:
            print(f"Reached limit of {limit} resumes.")
            break
        
        if current_page >= max_pages:
            print(f"Reached max pages limit of {max_pages}.")
            break

        # Try to go to next page
        has_next = await eval_json(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              return api && typeof api.goToNextPage === "function" ? api.goToNextPage() : false;
            })()""",
            context_id=context_id,
        )

        if not has_next:
            print("No next page available.")
            break

        # Wait for page number to increment
        next_page = current_page + 1
        print(f"Navigating to page {next_page}...")
        
        try:
            await wait_for(
                client,
                f"""(() => {{
                  const api = window.__TR_RESUME_DATA__;
                  const status = api && typeof api.status === "function" ? api.status() : null;
                  return status && status.pagination && status.pagination.currentPage === {next_page};
                }})()""",
                timeout=15.0,
                context_id=context_id,
            )
            current_page = next_page
        except CDPError:
            print("Timeout waiting for next page load.")
            break
            
    return all_resumes


from contextlib import asynccontextmanager

@asynccontextmanager
async def open_cdp_session(port: int, search_url: str = None):
    """
    Context manager that connects to Chrome, finds/creates target,
    resolves extension context, and yields (client, context_id).
    """
    try:
        targets = fetch_json(f"http://127.0.0.1:{port}/json")
    except Exception as exc:
        raise CDPError("Chrome is not reachable on the CDP port.") from exc

    pages = [
        target
        for target in targets
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl")
    ]

    target = None
    # Prefer existing search tab
    if search_url:
        target_domain = urllib.parse.urlparse(search_url).netloc
        for page in pages:
            if target_domain in (page.get("url") or ""):
                target = page
                break
    
    # Fallback to any job5156 tab
    if not target:
        for page in pages:
            if "hr.job5156.com" in (page.get("url") or ""):
                target = page
                break
                
    # Create new if needed
    if not target and search_url:
        target = create_target(port, search_url)
        
    if not target and pages:
        target = pages[0]
        
    if not target:
        raise CDPError("No debuggable Chrome pages found.")

    ws_url = target.get("webSocketDebuggerUrl")
    if not ws_url:
        raise CDPError("Selected target has no webSocketDebuggerUrl.")

    print(f"Using target: {target.get('title') or target.get('url')}")

    async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
        client = CDPClient(ws)
        await client.call("Page.enable")
        await client.call("Runtime.enable")
        
        if search_url:
             # If url doesn't match, navigate? 
             # For now, let's assume we want to ensure we differ slightly or just reload
             pass

        accessor_found, context_id = await resolve_accessor_context(client)
        if not accessor_found:
            # Maybe we need to navigate or reload?
            if search_url:
                 await client.call("Page.navigate", {"url": search_url})
                 await wait_for(client, "document.readyState === 'complete'", timeout=30.0)
            
            accessor_found, context_id = await resolve_accessor_context(client)
            
        if not accessor_found:
             # Try waiting a bit more
             await wait_for(client, "document.readyState === 'complete'", timeout=5.0)
             accessor_found, context_id = await resolve_accessor_context(client)

        if not accessor_found:
            raise CDPError(
                "Extension accessor not found. Ensure the extension is enabled for hr.job5156.com."
            )

        # Wait for extension status
        status = await wait_for(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              return api && typeof api.status === "function" ? api.status() : null;
            })()""",
            timeout=15.0,
            context_id=context_id,
        )
        if not status:
            raise CDPError("Extension did not report status in time.")

        # Check ready state
        await wait_for(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              if (!api) return false;
              if (typeof api.isReady === "function") return !!api.isReady();
              return !!document.querySelector(".el-checkbox-group.resume-search-item-list-content-block");
            })()""",
            timeout=30.0,
            context_id=context_id,
        )
        
        yield client, context_id


async def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", default=DEFAULT_KEYWORD, help="Search keyword")
    parser.add_argument("--location", default="", help="Search location filter (e.g. 广东)")
    parser.add_argument("--limit", type=int, default=200, help="Max total resumes to scrape")
    parser.add_argument("--max-pages", type=int, default=10, help="Max pages to scrape")
    parser.add_argument("--sample", default=DEFAULT_SAMPLE, help="Sample file name")
    parser.add_argument("--port", type=int, default=CDP_PORT, help="CDP port")
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Allow writing an empty sample (default: fail when zero resumes)",
    )
    args = parser.parse_args()

    sample_name = sanitize_sample_name(args.sample)
    if sample_name.lower().endswith(".json"):
        sample_name = sample_name[:-5]
    if not sample_name:
        sample_name = "sample"

    search_url = build_search_url(args.keyword, args.location)

    async with open_cdp_session(args.port, search_url) as (client, context_id):
        # We might need to ensure navigation if the page wasn't already on the right URL
        # The context manager does a best effort, but let's be safe.
        current_url = await eval_json(client, "window.location.href", context_id=context_id)
        if search_url.split('?')[0] not in str(current_url):
             await client.call("Page.navigate", {"url": search_url})
             await wait_for(client, "document.readyState === 'complete'", timeout=30.0)


        resumes = await execute_scrape_job(
            client=client,
            context_id=context_id,
            limit=args.limit,
            max_pages=args.max_pages,
            allow_empty=args.allow_empty,
        )

        status = await eval_json(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              return api && typeof api.status === "function" ? api.status() : null;
            })()""",
            context_id=context_id,
        ) or status

        page_url = await eval_json(client, "window.location.href", context_id=context_id)
        if not page_url:
            page_url = search_url

        metadata = build_metadata(page_url, sample_name, status, resumes)
        payload = {"metadata": metadata, "data": resumes}

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"{sample_name}.json"
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        print(f"Saved {len(resumes)} resumes to {output_path}")
        return 0


def main():
    try:
        code = asyncio.run(run())
    except CDPError as exc:
        print(f"Error: {exc}")
        print("Hint: Start Chrome with --remote-debugging-port=9222")
        return 1
    except KeyboardInterrupt:
        print("Aborted.")
        return 1
    return code


if __name__ == "__main__":
    sys.exit(main())
