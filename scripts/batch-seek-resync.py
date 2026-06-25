#!/usr/bin/env python3
"""
Batch re-sync missing resumes from Seek talent search via CDP.

Reads a CSV of missing candidates, navigates to each Seek search page,
waits for the browser extension to capture data, extracts it, and submits
to the Convex backend.

Prerequisites:
  - Chrome running with --remote-debugging-port=9222
  - Browser extension installed and logged into Seek
  - Convex backend accessible (tunnel or local)

Usage:
  python scripts/batch-seek-resync.py /tmp/missing-resumes-for-resync.csv [options]

Options:
  --port PORT        CDP port (default: 9222)
  --convex-url URL   Convex URL (default: http://127.0.0.1:3210)
  --workspace SLUG   Workspace slug (default: hr)
  --limit N          Max candidates to process (default: all)
  --dry-run          Extract data but don't submit to Convex
  --delay SECS       Delay between candidates (default: 3)
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from browser_cdp import (
    CDPClient,
    CDPError,
    eval_json,
    open_cdp_session,
    wait_for,
)

SEEK_HOST = "hk.employer.seek.com"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "resumes" / "batch-resync"


def build_seek_url(name: str, market: str = "MY") -> str:
    params = {"keywords": name, "market": market}
    return f"https://{SEEK_HOST}/talentsearch?" + urllib.parse.urlencode(params)


def read_csv_rows(csv_path: str) -> list[dict]:
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("Name", "").strip()
            url = row.get("Seek Search URL", "").strip()
            csv_id = row.get("CSV Resume ID", "").strip()
            if name:
                rows.append({"name": name, "url": url, "csv_id": csv_id})
    return rows


def convex_mutation(path: str, args: dict, convex_url: str) -> dict:
    """Call a Convex mutation via HTTP API."""
    payload = {"path": path, "args": args}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{convex_url}/api/mutation",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def submit_to_convex(resumes: list[dict], convex_url: str, workspace: str) -> dict:
    """Submit extracted resumes to Convex via resume_tasks:submitResumes."""
    return convex_mutation("resume_tasks:submitResumes", {"resumes": resumes}, convex_url)


def reject_on_convex(identity_key: str, write_secret: str, convex_url: str, workspace: str) -> dict:
    """Set candidate_status to rejected."""
    return convex_mutation("candidate_status:upsert", {
        "workspaceSlug": workspace,
        "identityKey": identity_key,
        "status": "rejected",
        "notes": "batch-rejected via seek-resync",
        "updatedBy": "batch-seek-resync",
        "writeSecret": write_secret,
    }, convex_url)


async def extract_one_candidate(
    client: CDPClient,
    context_id: int,
    name: str,
    seek_url: str,
    timeout: float = 30.0,
) -> list[dict] | None:
    """Navigate to Seek name search, type name, wait for extension, extract resumes."""
    # Navigate to name search page
    await client.call("Page.navigate", {"url": "https://hk.employer.seek.com/talentsearch/profiles/search"})
    await wait_for(client, "document.readyState === 'complete'", timeout=20.0)
    await asyncio.sleep(3)

    # Focus and type into the name search input using execCommand (React-compatible)
    typed = await eval_json(
        client,
        f"""(() => {{
          const input = document.getElementById('nameSearchInput');
          if (!input) return false;
          input.focus();
          input.value = '';
          document.execCommand('insertText', false, {json.dumps(name)});
          return input.value;
        }})()""",
        context_id=context_id,
    )
    if not typed:
        return None

    await asyncio.sleep(0.5)

    # Submit the form
    await eval_json(
        client,
        """(() => {
          const input = document.getElementById('nameSearchInput');
          const form = input.closest('form');
          if (form) { form.requestSubmit(); return true; }
          return false;
        })()""",
        context_id=context_id,
    )

    await asyncio.sleep(3)

    # Wait for extension to capture data
    start = time.time()
    while time.time() - start < timeout:
        status = await eval_json(
            client,
            """(() => {
              const api = window.__TR_RESUME_DATA__;
              return api && typeof api.status === "function" ? api.status() : null;
            })()""",
            context_id=context_id,
        )
        if status:
            card_count = int(status.get("cardCount") or 0)
            api_count = int(status.get("apiSnapshotCount") or 0)
            total_items = int((status.get("pagination") or {}).get("totalItems") or 0)
            if max(card_count, api_count) > 0 or total_items > 0:
                break
        await asyncio.sleep(1.0)

    # Extract
    resumes = await eval_json(
        client,
        """(() => {
          const api = window.__TR_RESUME_DATA__;
          return api && typeof api.extract === "function" ? api.extract() : null;
        })()""",
        context_id=context_id,
    )

    if not isinstance(resumes, list) or not resumes:
        return None

    # For name search, we might get multiple results. Filter by exact name match.
    name_lower = name.lower().strip()
    exact = [r for r in resumes if (r.get("name") or "").lower().strip() == name_lower]
    if exact:
        return exact[:1]

    return resumes[:1]


async def run():
    parser = argparse.ArgumentParser(description="Batch re-sync missing Seek resumes")
    parser.add_argument("csv_path", help="CSV file with Name, Seek Search URL, CSV Resume ID")
    parser.add_argument("--port", type=int, default=9222, help="CDP port")
    parser.add_argument("--convex-url", default="http://127.0.0.1:3210", help="Convex URL")
    parser.add_argument("--workspace", default="hr", help="Workspace slug")
    parser.add_argument("--limit", type=int, default=0, help="Max candidates (0=all)")
    parser.add_argument("--dry-run", action="store_true", help="Don't submit to Convex")
    parser.add_argument("--write-secret", default="", help="Convex write secret for candidate_status rejection")
    parser.add_argument("--delay", type=float, default=3.0, help="Delay between candidates")
    args = parser.parse_args()

    rows = read_csv_rows(args.csv_path)
    if args.limit > 0:
        rows = rows[:args.limit]
    print(f"Candidates to process: {len(rows)}")
    print(f"Convex: {args.convex_url}")
    print(f"Workspace: {args.workspace}")
    print(f"Mode: {'dry-run' if args.dry_run else 'execute'}")
    print("---")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_collected = []
    stats = {"success": 0, "no_match": 0, "error": 0, "submitted": 0}

    # Navigate to Seek first to establish the extension context
    first_url = rows[0]["url"] or build_seek_url(rows[0]["name"]) if rows else f"https://{SEEK_HOST}/talentsearch"
    async with open_cdp_session(args.port, first_url) as (client, context_id):
        for i, row in enumerate(rows):
            name = row["name"]
            seek_url = row["url"] or build_seek_url(name)
            csv_id = row["csv_id"]

            print(f"[{i+1}/{len(rows)}] {name}...", end=" ", flush=True)

            try:
                resumes = await extract_one_candidate(
                    client, context_id, name, seek_url, timeout=25.0,
                )
            except CDPError as e:
                print(f"ERROR: {e}")
                stats["error"] += 1
                await asyncio.sleep(args.delay)
                continue

            if not resumes:
                print("no match")
                stats["no_match"] += 1
                await asyncio.sleep(args.delay)
                continue

            # Tag with original csv_id for traceability
            for r in resumes:
                r["_resyncCsvId"] = csv_id

            resume = resumes[0]
            resume_name = resume.get("name", "?")
            stats["success"] += 1
            print(f"found: {resume_name}")

            all_collected.append({
                "csv_id": csv_id,
                "name": name,
                "resume": resume,
            })

            if not args.dry_run:
                # Submit to Convex immediately
                ext_id = resume.get("externalId") or f"seek:name:{name.lower().strip()}"
                content = {k: v for k, v in resume.items() if not k.startswith("_")}
                content_hash = str(hash(json.dumps(content, sort_keys=True)))

                submit_result = submit_to_convex(
                    resumes=[{
                        "externalId": ext_id,
                        "content": content,
                        "hash": content_hash[:32],
                        "source": resume.get("source", "hk.employer.seek.com"),
                        "tags": ["seek-resync", "batch-reject"],
                    }],
                    convex_url=args.convex_url,
                    workspace=args.workspace,
                )
                if "error" in submit_result:
                    print(f"  submit error: {submit_result['error']}")
                else:
                    inserted = submit_result.get("inserted", 0)
                    updated = submit_result.get("updated", 0)
                    deduped = submit_result.get("deduped", 0)
                    stats["submitted"] += 1
                    print(f"  submitted: inserted={inserted} updated={updated} deduped={deduped}")

                    # Set candidate_status to rejected
                    if args.write_secret:
                        ik = resume.get("identityKey") or f"externalId:{ext_id}"
                        rej = reject_on_convex(ik, args.write_secret, args.convex_url, args.workspace)
                        if "error" in rej:
                            print(f"  reject error: {rej['error']}")

            await asyncio.sleep(args.delay)

    # Save collected data
    output_path = OUTPUT_DIR / f"batch-resync-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    output_path.write_text(
        json.dumps(all_collected, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("---")
    print(f"Results: {stats['success']} found, {stats['no_match']} no match, {stats['error']} errors")
    if not args.dry_run:
        print(f"Submitted: {stats['submitted']}")
    print(f"Saved to: {output_path}")


def main():
    try:
        asyncio.run(run())
    except CDPError as exc:
        print(f"Error: {exc}")
        print("Hint: Start Chrome with: make chrome-debug")
        return 1
    except KeyboardInterrupt:
        print("\nAborted.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
