#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPTS_ROOT = SCRIPT_DIR.parent
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.append(str(SCRIPTS_ROOT))

from browser_cdp import (
    CDPError,
    CDP_PORT,
    describe_page,
    eval_json,
    normalize_cdp_origin,
    open_cdp_session,
)

DEFAULT_LIMIT = 50
DEFAULT_MAX_PAGES = 10
DEFAULT_COLLECT_TIMEOUT_SEC = 180.0
JOB51_COLLECT_TIMEOUT_SEC = 420.0

SOURCE_URLS = {
    "job5156": "https://hr.job5156.com/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40",
    "51job": "https://ehire.51job.com/Revision/talent/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40",
    "seek": "https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1",
}

SOURCE_HOSTS = {
    "job5156": "hr.job5156.com",
    "51job": "ehire.51job.com",
    "seek": "my.employer.seek.com",
}


def resolve_source_host(source: str, url: str) -> str:
	if source == "seek":
		hostname = (urlparse(url).hostname or "").lower()
		if hostname:
			return hostname
	return SOURCE_HOSTS.get(source, "unknown")


def resolve_collect_timeout_sec(source: str) -> float:
    if source == "51job":
        return JOB51_COLLECT_TIMEOUT_SEC
    return DEFAULT_COLLECT_TIMEOUT_SEC


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=sorted(SOURCE_URLS.keys()), required=True, help="Browser source alias")
    parser.add_argument("--url", help="Direct source URL override")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Maximum resumes to collect")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES, help="Maximum pages to visit")
    parser.add_argument("--cdp-endpoint", default=str(CDP_PORT), help="CDP port, origin, or websocket endpoint")
    parser.add_argument("--check-only", action="store_true", help="Verify CDP and extension readiness without collecting")
    return parser


def parse_positive_int(value: int, name: str) -> int:
    if value < 1:
        raise CDPError(f"{name} must be >= 1")
    return value


async def read_status(client: Any, context_id: int | None) -> dict[str, Any]:
    status = await eval_json(
        client,
        """(() => {
          const api = window.__TR_RESUME_DATA__;
          return api && typeof api.status === "function" ? api.status() : null;
        })()""",
        context_id=context_id,
        timeout=30.0,
    )
    return status if isinstance(status, dict) else {}


def is_supported_source_page(source: str, page_url: str) -> bool:
    if not page_url:
        return False

    parsed_url = urlparse(page_url)
    hostname = (parsed_url.hostname or "").lower()
    pathname = parsed_url.path.rstrip("/") or "/"

    if source == "job5156":
        return hostname == "hr.job5156.com" and pathname == "/search"

    if source == "51job":
        return hostname == "ehire.51job.com" and "/talent/search" in pathname

    if source == "seek":
        return hostname.endswith(".employer.seek.com") and (pathname == "/candidates/recommended" or pathname == "/talentsearch")

    return False


def describe_unsupported_source_page(source: str, page_url: str, page_title: str, search_url: str) -> str:
    parsed_url = urlparse(page_url)
    hostname = (parsed_url.hostname or "").lower()
    pathname = parsed_url.path.rstrip("/") or "/"

    if source == "seek" and pathname == "/account/select":
        return (
            "SEEK requires an employer account selection before candidate pages are available. "
            f"Complete the account selection in Chrome, let it land on /candidates/recommended, then rerun. "
            f"Requested page: {search_url}. Current page: {page_url}"
        )

    if source == "51job" and ("/login" in pathname or "login" in page_url.lower()):
        return (
            "51job redirected to a login page before the talent search results were available. "
            "Log in inside Chrome, reopen the talent search page, then rerun. "
            f"Requested page: {search_url}. Current page: {page_url}"
        )

    if source == "seek" and hostname.endswith(".employer.seek.com") and pathname == "/jobs":
        detail = f" (title: {page_title})" if page_title else ""
        return (
            "SEEK redirected to the jobs list instead of the candidates page. "
            "Open the Talent Search or recommended candidates page in the same logged-in employer account, then rerun. "
            f"Requested page: {search_url}. Current page: {page_url}{detail}"
        )

    detail = f" (title: {page_title})" if page_title else ""
    return (
        f"{source} redirected to an unsupported page: {page_url}{detail}. "
        f"Requested page: {search_url}"
    )


async def wait_for_ready_state(
    client: Any,
    context_id: int | None,
    source: str,
    search_url: str,
) -> dict[str, Any]:
    last_page: dict[str, Any] = {}
    for _ in range(90):
        last_page = await describe_page(client, context_id)
        current_url = str(last_page.get("url") or "").strip()
        current_title = str(last_page.get("title") or "").strip()
        if current_url and not is_supported_source_page(source, current_url):
            raise CDPError(
                describe_unsupported_source_page(source, current_url, current_title, search_url)
            )

        status = await read_status(client, context_id)
        if not status:
            await asyncio.sleep(1.0)
            continue
        if status.get("loggedIn") is False:
            raise CDPError("Browser session is not logged in on the target source.")

        auto_search = str(status.get("autoSearch") or "")
        auto_location = str(status.get("autoLocation") or "")
        auto_age = str(status.get("autoAge") or "")
        if auto_search == "running" or auto_location == "running" or auto_age == "running":
            await asyncio.sleep(1.0)
            continue

        card_count = int(status.get("cardCount") or 0)
        api_snapshot_count = int(status.get("apiSnapshotCount") or 0)
        pagination = status.get("pagination") or {}
        total_items = int(pagination.get("totalItems") or 0)
        dom_ready = bool(status.get("domReady"))

        if max(card_count, api_snapshot_count) > 0:
            return status
        if total_items > 0:
            return status
        if auto_search == "failed" or auto_location == "failed" or auto_age == "failed":
            return status

        # For sources that report domReady, wait until the page is
        # fully interactive before giving up on counts.  Without this,
        # a 51job page that has not finished loading its search results
        # will appear to have zero items and the collector will proceed
        # to collect() on an empty page.
        if dom_ready:
            return status

        await asyncio.sleep(1.0)

    current_url = str(last_page.get("url") or "").strip()
    current_title = str(last_page.get("title") or "").strip()
    detail = ""
    if source == "51job":
        detail = " The 51job search page may need time to load its results. Ensure the page is fully loaded with visible candidate rows before rerunning."
    raise CDPError(
        "Timed out waiting for the source page to finish loading results."
        + detail
        + (f" Current page: {current_url}." if current_url else "")
        + (f" Title: {current_title}." if current_title else "")
    )


async def ensure_collect_method(client: Any, context_id: int | None) -> None:
    has_collect = await eval_json(
        client,
        """(() => {
          const api = window.__TR_RESUME_DATA__;
          return !!(api && typeof api.collect === "function");
        })()""",
        context_id=context_id,
        timeout=15.0,
    )
    if not has_collect:
        raise CDPError("Extension accessor does not expose collect(). Reload the browser extension.")


async def collect_payload(
    client: Any,
    context_id: int | None,
    source: str,
    limit: int,
    max_pages: int,
) -> dict[str, Any]:
    payload = await eval_json(
        client,
        f"""(() => {{
          const api = window.__TR_RESUME_DATA__;
          if (!api || typeof api.collect !== "function") {{
            throw new Error("collect() is unavailable");
          }}
          return api.collect({json.dumps({"limit": limit, "maxPages": max_pages})});
        }})()""",
        context_id=context_id,
        timeout=resolve_collect_timeout_sec(source),
    )
    if not isinstance(payload, dict):
        raise CDPError("Collector did not return a payload.")
    return payload


async def run() -> int:
    parser = build_parser()
    args = parser.parse_args()

    limit = parse_positive_int(args.limit, "limit")
    max_pages = parse_positive_int(args.max_pages, "max-pages")
    search_url = (args.url or SOURCE_URLS[args.source]).strip()
    if not search_url:
        raise CDPError("A source URL is required.")

    normalized_endpoint = normalize_cdp_origin(args.cdp_endpoint)

    async with open_cdp_session(args.cdp_endpoint, search_url) as (client, context_id):
        status = await wait_for_ready_state(client, context_id, args.source, search_url)
        source_key = str(status.get("sourceKey") or "")
        if source_key != args.source:
            raise CDPError(f"Expected source {args.source}, got {source_key or 'unknown'}.")

        if args.check_only:
            print(json.dumps({
                "mode": "check",
                "endpoint": normalized_endpoint,
                "source": args.source,
                "sourceHost": resolve_source_host(args.source, search_url),
                "url": search_url,
                "status": status,
            }, ensure_ascii=False))
            return 0

        await ensure_collect_method(client, context_id)
        payload = await collect_payload(
            client,
            context_id,
            source=args.source,
            limit=limit,
            max_pages=max_pages,
        )

        print(json.dumps({
            "mode": "collect",
            "endpoint": normalized_endpoint,
            "source": args.source,
            "sourceHost": resolve_source_host(args.source, search_url),
            "url": search_url,
            "status": status,
            "payload": payload,
        }, ensure_ascii=False))
        return 0


def main() -> int:
    try:
        return asyncio.run(run())
    except CDPError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print("Hint: Start Chrome with remote debugging on port 9222 and keep the extension loaded.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Aborted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
