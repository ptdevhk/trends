from __future__ import annotations

import asyncio
import json
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from typing import Any

import websockets

CDP_PORT = 9222


class CDPError(RuntimeError):
    pass


def normalize_cdp_origin(endpoint: int | str | None = None) -> str:
    if endpoint is None:
        return f"http://127.0.0.1:{CDP_PORT}"

    if isinstance(endpoint, int):
        if endpoint < 1:
            raise CDPError(f"Invalid CDP port: {endpoint}")
        return f"http://127.0.0.1:{endpoint}"

    raw = str(endpoint).strip()
    if not raw:
        return f"http://127.0.0.1:{CDP_PORT}"

    if raw.isdigit():
        parsed_port = int(raw)
        if parsed_port < 1:
            raise CDPError(f"Invalid CDP port: {raw}")
        return f"http://127.0.0.1:{parsed_port}"

    parsed = urllib.parse.urlparse(raw if "://" in raw else f"http://{raw}")
    if parsed.scheme in ("ws", "wss"):
        http_scheme = "https" if parsed.scheme == "wss" else "http"
        if not parsed.netloc:
            raise CDPError(f"Invalid CDP endpoint: {endpoint}")
        return f"{http_scheme}://{parsed.netloc}".rstrip("/")

    if parsed.scheme in ("http", "https") and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    raise CDPError(f"Invalid CDP endpoint: {endpoint}")


def _build_cdp_url(endpoint: int | str | None, path: str) -> str:
    origin = normalize_cdp_origin(endpoint)
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{origin}{normalized_path}"


def fetch_json(url: str, timeout: float = 2.0, method: str = "GET") -> Any:
    request = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def fetch_cdp_json(endpoint: int | str | None, path: str, timeout: float = 2.0) -> Any:
    return fetch_json(_build_cdp_url(endpoint, path), timeout=timeout)


def create_target(endpoint: int | str | None, url: str):
    encoded = urllib.parse.quote(url, safe="")
    target_url = _build_cdp_url(endpoint, f"/json/new?{encoded}")
    for method in ("PUT", "GET"):
        try:
            return fetch_json(target_url, timeout=3.0, method=method)
        except Exception:
            continue
    return None


def normalize_target_match_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    return urllib.parse.urlunparse(parsed._replace(fragment=""))


def select_cdp_target(pages: list[dict[str, Any]], search_url: str | None = None):
    if search_url:
        target_url = normalize_target_match_url(search_url)
        for page in pages:
            page_url = normalize_target_match_url(str(page.get("url") or ""))
            if page_url == target_url:
                return page

        target_domain = urllib.parse.urlparse(search_url).netloc
        for page in pages:
            if target_domain in (page.get("url") or ""):
                return page

    for page in pages:
        page_url = str(page.get("url") or "")
        if "hr.job5156.com" in page_url or ".employer.seek.com" in page_url or "ehire.51job.com" in page_url:
            return page

    return pages[0] if pages else None


def _describe_missing_accessor(search_url: str | None, current_url: str, current_title: str) -> str:
    context = []
    if search_url:
        context.append(f"requested page: {search_url}")
    if current_url:
        context.append(f"current page: {current_url}")
    if current_title:
        context.append(f"title: {current_title}")

    if search_url and ".employer.seek.com" in search_url:
        parsed = urllib.parse.urlparse(current_url) if current_url else None
        pathname = (parsed.path.rstrip("/") or "/") if parsed else ""
        hostname = (parsed.hostname or "").lower() if parsed else ""
        if pathname == "/account/select":
            return (
                "SEEK requires selecting the employer account in Chrome before candidate pages are available. "
                + (f"({'; '.join(context)})" if context else "")
            )
        if hostname.endswith(".employer.seek.com") and pathname == "/jobs":
            return (
                "SEEK redirected to the jobs list instead of the recommended candidates page. "
                "Open the Talent Search recommended candidates page in the same logged-in employer account, then rerun. "
                + (f"({'; '.join(context)})" if context else "")
            )

    return "Extension accessor not found. Ensure the extension is enabled for the target page." + (
        f" ({'; '.join(context)})" if context else ""
    )


class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self._next_id = 0
        self.contexts: dict[int, dict[str, Any]] = {}

    async def _recv(self):
        raw = await self.ws.recv()
        msg = json.loads(raw)
        if "method" in msg:
            self._handle_event(msg)
            return ("event", msg)
        return ("response", msg)

    def _handle_event(self, msg: dict[str, Any]):
        method = msg.get("method")
        params = msg.get("params") or {}
        if method == "Runtime.executionContextCreated":
            context = params.get("context")
            if isinstance(context, dict) and "id" in context:
                self.contexts[int(context["id"])] = context
        elif method == "Runtime.executionContextDestroyed":
            context_id = params.get("executionContextId")
            if isinstance(context_id, int) and context_id in self.contexts:
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


async def eval_json(
    client: CDPClient,
    expression: str,
    context_id: int | None = None,
    timeout: float = 20.0,
):
    params = {
        "expression": expression,
        "returnByValue": True,
        "awaitPromise": True,
    }
    if context_id:
        params["contextId"] = context_id
    result = await client.call("Runtime.evaluate", params=params, timeout=timeout)
    if "exceptionDetails" in result:
        raise CDPError("Runtime.evaluate threw an exception")
    return (result.get("result") or {}).get("value")


def pick_contexts(contexts: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    isolated = []
    for ctx in contexts.values():
        aux = ctx.get("auxData") or {}
        if aux.get("type") == "isolated":
            isolated.append(ctx)
    if not isolated:
        isolated = list(contexts.values())

    def rank(ctx: dict[str, Any]) -> tuple[int, str]:
        name = str(ctx.get("name") or "")
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
        if not isinstance(ctx_id, int):
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


async def describe_page(client: CDPClient, context_id: int | None = None) -> dict[str, Any]:
    info = await eval_json(
        client,
        """(() => ({
          url: window.location.href || "",
          title: document.title || "",
          readyState: document.readyState || "",
        }))()""",
        context_id=context_id,
        timeout=10.0,
    )
    return info if isinstance(info, dict) else {}


@asynccontextmanager
async def open_cdp_session(endpoint: int | str | None = None, search_url: str | None = None):
    try:
        targets = fetch_cdp_json(endpoint, "/json")
    except Exception as exc:
        raise CDPError("Chrome is not reachable on the CDP endpoint.") from exc

    pages = [
        target
        for target in targets
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl")
    ]

    target = select_cdp_target(pages, search_url)

    if not target and search_url:
        target = create_target(endpoint, search_url)

    if not target:
        raise CDPError("No debuggable Chrome pages found.")

    ws_url = target.get("webSocketDebuggerUrl")
    if not ws_url:
        raise CDPError("Selected target has no webSocketDebuggerUrl.")

    async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
        client = CDPClient(ws)
        await client.call("Page.enable")
        await client.call("Runtime.enable")

        if search_url:
            await client.call("Page.navigate", {"url": search_url})
            await wait_for(client, "document.readyState === 'complete'", timeout=30.0)

        accessor_found, context_id = await resolve_accessor_context(client)
        if not accessor_found:
            if search_url:
                await client.call("Page.navigate", {"url": search_url})
                await wait_for(client, "document.readyState === 'complete'", timeout=30.0)

            accessor_found, context_id = await resolve_accessor_context(client)

        if not accessor_found:
            await wait_for(client, "document.readyState === 'complete'", timeout=5.0)
            accessor_found, context_id = await resolve_accessor_context(client)

        if not accessor_found:
            page = await describe_page(client)
            current_url = str(page.get("url") or "").strip()
            current_title = str(page.get("title") or "").strip()
            raise CDPError(_describe_missing_accessor(search_url, current_url, current_title))

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
