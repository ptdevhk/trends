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
from datetime import datetime, timezone
from pathlib import Path

from browser_cdp import (
    CDPClient,
    CDP_PORT,
    CDPError,
    eval_json,
    open_cdp_session,
    wait_for,
)

DEFAULT_KEYWORD = "销售"
DEFAULT_SAMPLE = "sample-initial"
DEFAULT_SOURCE = "job5156"
DEFAULT_LIMIT = 50
SEEK_HOST = "my.employer.seek.com"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "output" / "resumes" / "samples"


def sanitize_sample_name(value: str) -> str:
    if not value:
        return ""
    cleaned = value.strip()
    cleaned = re.sub(r'[\\/:*?"<>|]', "-", cleaned)
    cleaned = re.sub(r"\s+", "-", cleaned)
    cleaned = re.sub(r"-+", "-", cleaned)
    cleaned = cleaned.lstrip(".")
    return cleaned[:80]


def build_search_url(
    keyword: str,
    location: str = "",
    min_age: int | None = None,
    max_age: int | None = None,
) -> str:
    params = {"keyword": keyword}
    if location:
        params["location"] = location
    if isinstance(min_age, int) and min_age > 0:
        params["tr_min_age"] = str(min_age)
    if isinstance(max_age, int) and max_age > 0:
        params["tr_max_age"] = str(max_age)
    return "https://hr.job5156.com/search?" + urllib.parse.urlencode(params)


def build_seek_search_url(
    keyword: str,
    market: str = "MY",
    role_titles: str = "",
) -> str:
    params: dict[str, str] = {"keywords": keyword}
    if market:
        params["market"] = market
    if role_titles:
        params["roleTitles"] = role_titles
    return f"https://{SEEK_HOST}/talentsearch?" + urllib.parse.urlencode(params)


def build_metadata(page_url: str, sample_name: str, status: dict | None, resumes: list, source: str = DEFAULT_SOURCE) -> dict:
    parsed = urllib.parse.urlparse(page_url)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

    is_seek = source == "seek" or ".employer.seek.com" in page_url

    if is_seek:
        keyword = (query.get("keywords", [""])[0] or "").strip()
        location = ""
    else:
        keyword = (query.get("keyword", [""])[0] or "").strip()
        location = (query.get("location", [""])[0] or "").strip()

    filters = {}
    for key, values in query.items():
        if key in ("keyword", "keywords", "location", "tr_auto_export", "tr_sample_name", "market", "roleTitles"):
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

    result = {
        "sourceUrl": source_url,
        "sourceKey": "seek" if is_seek else "job5156",
        "sourceHost": parsed.hostname.lower() if parsed.hostname else "",
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

    if is_seek:
        seek_mode = "talentsearch" if "/talentsearch" in parsed.path else "recommended"
        result["collectionContext"] = {
            "captureMode": "graphql-talentsearch" if seek_mode == "talentsearch" else "graphql-list",
            "operation": "SearchProfilesByNaturalLanguage" if seek_mode == "talentsearch" else "GetTalentSearchRecommendedCandidates",
            "profileType": "seek",
            "language": "en-MY",
            "searchQuery": keyword,
            "searchMode": "NATURAL_LANGUAGE",
            "pageNumber": 1,
        }

    return result


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
                    int(last.get("apiSnapshotCount") or 0),
                ]
                if max(counts) > 0:
                    return last
                auto_search = (last.get("autoSearch") or "").lower()
                elapsed = time.time() - start
                if auto_search in ("done", "skipped") and elapsed > 15:
                    pagination = last.get("pagination") or {}
                    total_items = int(pagination.get("totalItems") or 0)
                    if total_items <= 0:
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

        # Append only up to remaining capacity to enforce a strict global limit.
        remaining = max(0, limit - len(all_resumes))
        if remaining == 0:
            print(f"Reached limit of {limit} resumes.")
            break

        accepted_resumes = page_resumes[:remaining]
        truncated_count = len(page_resumes) - len(accepted_resumes)
        all_resumes.extend(accepted_resumes)

        if truncated_count > 0:
            print(
                f"  Found {len(page_resumes)} resumes "
                f"(accepted {len(accepted_resumes)}, truncated {truncated_count}, total {len(all_resumes)})"
            )
        else:
            print(f"  Found {len(accepted_resumes)} resumes (Total: {len(all_resumes)})")

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


async def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", default=DEFAULT_KEYWORD, help="Search keyword")
    parser.add_argument("--location", default="", help="Search location filter (e.g. 广东)")
    parser.add_argument("--min-age", type=int, default=None, help="Minimum age filter (inclusive)")
    parser.add_argument("--max-age", type=int, default=None, help="Maximum age filter (inclusive)")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max total resumes to scrape")
    parser.add_argument("--max-pages", type=int, default=10, help="Max pages to scrape")
    parser.add_argument("--sample", default=DEFAULT_SAMPLE, help="Sample file name")
    parser.add_argument("--port", type=int, default=CDP_PORT, help="CDP port")
    parser.add_argument("--source", default=DEFAULT_SOURCE, choices=["job5156", "seek"], help="Source platform (default: job5156)")
    parser.add_argument("--market", default="MY", help="Seek market code (default: MY)")
    parser.add_argument("--role-titles", default="", help="Seek roleTitles filter for name-search URL")
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

    if args.min_age is not None and args.max_age is not None and args.min_age > args.max_age:
        raise CDPError("Invalid age range (min-age cannot be greater than max-age).")

    source = args.source
    if source == "seek":
        search_url = build_seek_search_url(
            args.keyword,
            market=args.market,
            role_titles=args.role_titles,
        )
    else:
        search_url = build_search_url(
            args.keyword,
            args.location,
            min_age=args.min_age,
            max_age=args.max_age,
        )

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

        metadata = build_metadata(page_url, sample_name, status, resumes, source=source)
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
