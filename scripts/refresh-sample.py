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


def build_search_url(keyword: str) -> str:
    params = {"keyword": keyword}
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


async def resolve_accessor_context(client: CDPClient) -> int | None:
    probe = "(() => !!(window.__TR_RESUME_DATA__ && window.__TR_RESUME_DATA__.status))()"
    try:
        if await eval_json(client, probe):
            return None
    except CDPError:
        pass

    for ctx in pick_contexts(client.contexts):
        ctx_id = ctx.get("id")
        if not ctx_id:
            continue
        try:
            if await eval_json(client, probe, context_id=ctx_id):
                return ctx_id
        except CDPError:
            continue
    return None


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


async def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", default=DEFAULT_KEYWORD, help="Search keyword")
    parser.add_argument("--sample", default=DEFAULT_SAMPLE, help="Sample file name")
    parser.add_argument("--port", type=int, default=CDP_PORT, help="CDP port")
    args = parser.parse_args()

    sample_name = sanitize_sample_name(args.sample)
    if sample_name.lower().endswith(".json"):
        sample_name = sample_name[:-5]
    if not sample_name:
        sample_name = "sample"

    search_url = build_search_url(args.keyword)

    try:
        targets = fetch_json(f"http://127.0.0.1:{args.port}/json")
    except Exception as exc:
        raise CDPError("Chrome is not reachable on the CDP port.") from exc

    pages = [
        target
        for target in targets
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl")
    ]

    target = None
    for page in pages:
        if "hr.job5156.com/search" in (page.get("url") or ""):
            target = page
            break
    if not target:
        for page in pages:
            if "hr.job5156.com" in (page.get("url") or ""):
                target = page
                break
    if not target:
        target = create_target(args.port, search_url)
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
        await client.call("Page.navigate", {"url": search_url})

        await wait_for(client, "document.readyState === 'complete'", timeout=30.0)

        context_id = await resolve_accessor_context(client)
        if context_id is None:
            await wait_for(client, "document.readyState === 'complete'", timeout=5.0)
            context_id = await resolve_accessor_context(client)
        if context_id is None:
            raise CDPError(
                "Extension accessor not found. Ensure the extension is enabled for hr.job5156.com."
            )

        status = await wait_for(
            client,
            "window.__TR_RESUME_DATA__ ? window.__TR_RESUME_DATA__.status() : null",
            timeout=15.0,
            context_id=context_id,
        )
        if not status:
            raise CDPError("Extension did not report status in time.")

        if not status.get("loggedIn", False):
            print("Not logged in. Please log in manually and re-run.")
            print(f"Open: {search_url}")
            return 1

        await wait_for(
            client,
            "window.__TR_RESUME_DATA__ && window.__TR_RESUME_DATA__.isReady()",
            timeout=30.0,
            context_id=context_id,
        )

        await asyncio.sleep(1.0)

        resumes = await eval_json(
            client,
            "window.__TR_RESUME_DATA__ ? window.__TR_RESUME_DATA__.extract() : null",
            context_id=context_id,
        )

        if not isinstance(resumes, list):
            raise CDPError("Failed to extract resume data from the page.")

        status = await eval_json(
            client,
            "window.__TR_RESUME_DATA__ ? window.__TR_RESUME_DATA__.status() : null",
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
