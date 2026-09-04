#!/usr/bin/env python3
"""Drive a real SEEK TH talentsearch auto-sync collect on the live :9222
chrome-debug profile (extension already configured for preview.pt-mes.com).

Launch the profile jobUrl + tr_auto_sync=true in the existing SEEK tab, then
watch the extension's live status attributes until the run stops (done /
failed / cancelled). Mirrors the launch-URL contract pinned in
packages/shared/src/seek-my-th-e2e-fixtures.ts (jobUrl verbatim + only
tr_auto_sync=true appended). Does NOT export sample files and does NOT submit
from here - the extension's own auto-sync loop performs the preview POST
/ api/resumes/submit calls.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from browser_cdp import (  # noqa: E402
    CDPClient,
    CDPError,
    create_target,
    eval_json,
    fetch_cdp_json,
    select_cdp_target,
    wait_for,
)

# TH quick-start profile jobUrl (source of truth: packages/shared/src/seek-my-th-e2e-fixtures.ts)
JOB_URL = (
    "https://hk.employer.seek.com/talentsearch?searchQuery=CNC&market=TH&pageNumber=1"
    "&roleTitles=Services+Engineer%2CService+Technician%2CService+Manager%2CService+Coordinator%2CService+Supervisor"
    "&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE"
)

STATUS_ATTRS = [
    "data-tr-auto-sync",
    "data-tr-auto-sync-count",
    "data-tr-auto-sync-pages",
    "data-tr-auto-sync-target-start",
    "data-tr-auto-sync-target-end",
    "data-tr-auto-sync-effective-page-size",
    "data-tr-auto-sync-selected-count",
    "data-tr-auto-sync-remaining-capacity",
    "data-tr-auto-sync-stop-reason",
]


def status_expr(attrs: list[str]) -> str:
    names = json.dumps(attrs)
    return (
        "(() => {"
        "  const el = document.documentElement;"
        f"  const names = {names};"
        "  const out = {};"
        "  for (const n of names) out[n] = el.getAttribute(n);"
        "  out.url = window.location.href;"
        "  out.cardCount = (window.__TR_RESUME_DATA__ && typeof window.__TR_RESUME_DATA__.status === 'function') ? "
        "    (window.__TR_RESUME_DATA__.status().cardCount ?? null) : null;"
        "  return out;"
        "})()"
    )


def terminal_auto_sync(value: str | None) -> bool:
    return value in ("done", "failed", "cancelled", "skipped")


async def run(port: int, timeout_s: float, poll_s: float, launch_new: bool) -> int:
    targets = fetch_cdp_json(port, "/json")
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    target = select_cdp_target(pages, JOB_URL)

    if target is None:
        if not launch_new:
            print("No SEEK tab found; pass --launch-new to open one.", file=sys.stderr)
            return 2
        target = create_target(port, JOB_URL)
        if target is None:
            print("Failed to create CDP target.", file=sys.stderr)
            return 2

    ws_url = target["webSocketDebuggerUrl"]
    print(f"Attached to tab: {target.get('url', '')[:110]}")

    async with __import__("websockets").connect(ws_url, max_size=64 * 1024 * 1024) as ws:
        client = CDPClient(ws)
        await client.call("Page.enable")
        await client.call("Runtime.enable")

        # Force full reload with the auto-sync launch URL so the content script
        # captures tr_auto_sync=true at document_start (sessionStorage handshake).
        launch_url = JOB_URL + ("&" if "?" in JOB_URL else "?") + "tr_auto_sync=true"
        print("Launching:", launch_url[:160], "...")
        await client.call("Page.navigate", {"url": launch_url})
        await wait_for(client, "document.readyState === 'complete'", timeout=30.0)

        # Wait for the extension accessor to be present.
        accessor_found, context_id = False, None
        for _ in range(3):
            try:
                ok, ctx = await _resolve_accessor(client)
                if ok:
                    accessor_found, context_id = True, ctx
                    break
            except CDPError:
                pass
            await asyncio.sleep(2.0)
        if not accessor_found:
            print("Extension accessor not found after navigation.", file=sys.stderr)
            return 2

        deadline = time.time() + timeout_s
        last_status = None
        terminal = None
        while time.time() < deadline:
            try:
                last_status = await eval_json(client, status_expr(STATUS_ATTRS), context_id=context_id)
            except CDPError as exc:
                print("status poll error:", exc, file=sys.stderr)
                last_status = None
            if isinstance(last_status, dict):
                state = last_status.get("data-tr-auto-sync")
                print(
                    f"[{time.strftime('%H:%M:%S')}] auto-sync={state} "
                    f"count={last_status.get('data-tr-auto-sync-count')} "
                    f"pages={last_status.get('data-tr-auto-sync-pages')} "
                    f"stop={last_status.get('data-tr-auto-sync-stop-reason')} "
                    f"cards={last_status.get('cardCount')}",
                    flush=True,
                )
                if terminal_auto_sync(state):
                    terminal = last_status
                    break
            await asyncio.sleep(poll_s)

        print("\n=== FINAL ===")
        if terminal is not None:
            print(json.dumps({k: terminal.get(k) for k in STATUS_ATTRS}, indent=2))
            print("finalUrl:", terminal.get("url"))
            final_state = terminal.get("data-tr-auto-sync")
            if final_state == "done":
                print("RESULT: PASS (auto-sync completed)")
                return 0
            print(f"RESULT: NOT-PASS (auto-sync ended state={final_state})")
            return 1

        print("Timed out while auto-sync still running.")
        if isinstance(last_status, dict):
            print(json.dumps({k: last_status.get(k) for k in STATUS_ATTRS}, indent=2))
        return 1


async def _resolve_accessor(client: CDPClient) -> tuple[bool, int | None]:
    probe = (
        "(() => { const api = window.__TR_RESUME_DATA__;"
        " return !!(api && typeof api.status === 'function' && typeof api.extract === 'function'); })()"
    )
    try:
        if await eval_json(client, probe, timeout=8.0):
            return True, None
    except CDPError:
        pass
    # isolated world contexts (extension content scripts)
    for ctx_id in list(client.contexts.keys()):
        aux = (client.contexts.get(ctx_id) or {}).get("auxData") or {}
        if aux.get("type") != "isolated":
            continue
        try:
            if await eval_json(client, probe, context_id=ctx_id, timeout=8.0):
                return True, ctx_id
        except CDPError:
            continue
    return False, None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9222)
    parser.add_argument("--timeout", type=float, default=600.0, help="Max wall-clock seconds to watch")
    parser.add_argument("--poll", type=float, default=5.0, help="Status poll interval seconds")
    parser.add_argument("--launch-new", action="store_true", help="Open a new tab if no SEEK tab exists")
    args = parser.parse_args()
    try:
        return asyncio.run(run(args.port, args.timeout, args.poll, args.launch_new))
    except CDPError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
