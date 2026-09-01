# Extension Workflow (Dev/Debug)

Scope: `apps/browser-extension/` (MV3). Target site: `https://hr.job5156.com/search`.

## Container (this workspace)

Chrome is systemd-managed and branded; `--load-extension` is not supported. Prefer the seeded-profile flow:

```bash
./apps/browser-extension/scripts/cmux-setup-profile.sh   # setup profile + restart Chrome
./apps/browser-extension/scripts/open-search.sh          # open target page
./apps/browser-extension/scripts/check-profile-seed.sh   # validate profile seed
```

Manual fallback: `chrome://extensions` → Developer mode → Load unpacked → select `apps/browser-extension`.

## Local (macOS/Linux)

Use `npm run debug` from `apps/browser-extension/` to launch an isolated debug profile (CFT/Chromium still accept `--load-extension`). Branded Chrome 137+ dropped that flag; 152 still ignores it.

Collect Chrome on macOS is the live `:9222` profile. Install with the playwright-cli SSOT:

```bash
chrome-debug --load-unpacked /abs/path/to/apps/browser-extension
# or: make chrome-debug
```

`chrome-debug --restart` re-applies the saved path. Do not load from a disposable worktree. setup-profile.sh refuses on darwin. Container seed stays container-only.

Unattended isolated debug/dev uses debug:pipe / load-unpacked:cli (new browser, pipe transport). It cannot attach to the live employer :9222 session. Do not stack it on collect Chrome.

## Auto Export (quick verification)

Enable via URL query or localStorage:
- URL: `?tr_auto_export=md` (default markdown)
- localStorage: `tr_auto_export`

Common modes:
- `md` / `markdown` → download Markdown
- `csv` → download CSV
- `json` → download structured JSON (preferred for samples)
- `rawjson` → download raw API payload JSON
- `console` → log structured data
- `all` → CSV + JSON + console

Tokens can be combined: `md,rawjson,saveas,rawpage`.

Downloads land in `/root/Downloads` in the container.

## Auto Search

Enable via `?keyword=<term>`. Auto-search runs before auto-export.

The extension sets `<html>` attributes for debugging:
- `data-tr-auto-search` = `done|skipped`
- `data-tr-search-keyword` = keyword used
- `data-tr-api-rows` / `data-tr-api-last` / `data-tr-auto-export` for capture/export status

## Data Extractor Accessor (for deterministic checks)

Use the content-script accessor:
- `window.__TR_RESUME_DATA__.status()`
- `window.__TR_RESUME_DATA__.extract()`

If IDs are missing, ensure results are fully loaded before export.
