# 51job (CN Market)

Source for Chinese mainland resumes. Uses `ehire.51job.com` employer portal.

## Prerequisites

- Logged into `ehire.51job.com` in Chrome with an employer account
- The talent search page must be fully loaded with visible candidate rows before collection starts
- The browser extension must be loaded and active

## Default URL

```
https://ehire.51job.com/Revision/talent/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40
```

## Collection mechanism

CDP-based via `scripts/resume/collect_browser_source.py` with `--source 51job`. The collector:

1. Navigates to the talent search URL
2. Waits for `window.__TR_RESUME_DATA__` to report ready state (`sourceKey === "51job"`)
3. Calls `api.collect()` which paginates through results and extracts resume data
4. Returns JSON payload with metadata + resume array

## Known issues

### Login redirect
If the collector raises "51job redirected to a login page", the session has expired or wasn't logged in. Log into `ehire.51job.com` in Chrome, navigate back to the talent search page, then rerun.

### Slow page load
51job search pages can be slow to render results. The collector waits up to 90 seconds for the page to report ready. If it times out with "Timed out waiting for the source page to finish loading results", ensure the page is fully loaded with visible candidate rows. The `domReady` flag must report `true` before the collector proceeds.

### HMAC signing
51job detail pages use per-request HMAC `sign` parameters computed by obfuscated frontend JS. The extension cannot replicate these signatures, so 51job detail enrichment goes through real browser tabs (slower than job5156 direct fetch). This doesn't affect the snapshot collection itself but means restored 51job samples may have less enriched detail than job5156 samples until the extension processes them.

## Age filter

The default URL includes `tr_min_age=25&tr_max_age=40`. Adjust these params to target different age ranges, or remove them for unfiltered results.
