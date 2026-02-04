# Agent Instructions (Browser Extension)

These instructions apply to `apps/browser-extension/`. Use them for any extension work.

## Scope
- Target site: `https://hr.job5156.com/search`
- Extension path (container): `/root/workspace/apps/browser-extension`
- Manifest: MV3

## Running Scripts

Run from **project root** using shell scripts (simplest, works with any package manager):

```bash
./apps/browser-extension/scripts/cmux-setup-profile.sh   # Setup profile + restart Chrome
./apps/browser-extension/scripts/open-search.sh          # Open search page
./apps/browser-extension/scripts/check-profile-seed.sh   # Validate profile seed
```

**Package managers:** Local dev uses `bun`, CI uses `npm`.

## Debugging
### Cmux container (this workspace)
- Chrome is systemd-managed and branded (137+): `--load-extension` is not supported.
- Preferred setup (fresh container):
  - `./apps/browser-extension/scripts/cmux-setup-profile.sh`
- Manual fallback: `chrome://extensions` → Developer mode → Load unpacked → select `/root/workspace/apps/browser-extension`.
- Profile location: `/root/.config/chrome/Default` (must match the extension path).

### Local (macOS/Linux)
- Use `npm run debug` to launch a debug profile with `--load-extension` (Chromium/Chrome for Testing preferred).
- Debug profile path: `apps/browser-extension/.chrome-debug-profile` (gitignored).

## Auto Export (for quick verification)
- Enable via URL or localStorage:
  - URL: `?tr_auto_export=md` (default to Markdown)
  - localStorage key: `tr_auto_export`
- Modes:
  - `md` / `markdown` → download Markdown (default)
  - `csv` → download CSV
  - `json` → download structured JSON
  - `raw` → log raw payload to console
  - `raw_json` / `rawjson` → download raw payload JSON
  - `console` / `log` → log structured data
  - `both` → CSV + console
  - `all` → CSV + JSON + console
  - Tokens can be combined: `md,rawjson,saveas,rawpage`
  - `rawpage` / `page` adds full page HTML into raw payload (large)
  - `saveas` prompts the browser download dialog
- Downloads land in `/root/Downloads` as `resumes_<type>_<date>_<id>.*`.

## Sample Data Generation (for dev/testing)

Generate sample files with provenance metadata for `output/resumes/samples/`:

```
https://hr.job5156.com/search?keyword=销售&tr_auto_export=json&tr_sample_name=sample-initial
```

The exported JSON includes `metadata.sourceUrl` and `metadata.searchCriteria` for reproduction.

### CDP Automation
The project uses CDP to automate sample refreshes:

```bash
make refresh-sample                          # Default: 销售 -> sample-initial.json
make refresh-sample KEYWORD=python SAMPLE=sample-python
make refresh-sample ALLOW_EMPTY=1            # Allow saving empty sample
```

CDP reads from the content script accessor:

```
window.__TR_RESUME_DATA__.extract()
window.__TR_RESUME_DATA__.status()
```

Ensure Chrome is running with remote debugging enabled and the extension is loaded on `hr.job5156.com/search`.

## Auto Search (URL Keyword)
- Enable via URL: `?keyword=<search term>`
- Supports: Simplified Chinese, Traditional Chinese, English, mixed
- Combined example: `?keyword=python&tr_auto_export=csv`
- Data attributes set on `<html>`:
  - `data-tr-auto-search` = "done" or "skipped"
  - `data-tr-search-keyword` = the keyword used
- Order: auto-search runs before auto-export.

## Unique IDs (dedupe support)
- The extension captures API rows to include `resumeId` and `perUserId` in exports.
- If IDs are missing:
  - Ensure search results are loaded.
  - Wait for auto-export completion.
  - Check `<html>` attributes: `data-tr-api-rows`, `data-tr-api-last`, `data-tr-auto-export`.

## CSP / API hook
- API capture is injected via `page-hook.js` (web-accessible resource).
- Do not rely on inline script injection; CSP will block it on this site.

## Chrome DevTools MCP (Browser Automation)

The `chrome-devtools-9222` MCP server provides browser automation tools for agents. **Important:** The `9222` in the name is just an identifier—it's a proxy to Chrome's actual remote debugging port (configured separately). You don't need to manage ports; just use the MCP tools directly.

### Available Tools
- `mcp__chrome-devtools-9222__list_pages` - List open browser pages
- `mcp__chrome-devtools-9222__navigate_page` - Navigate to URL
- `mcp__chrome-devtools-9222__take_snapshot` - Get page accessibility tree (preferred over screenshots)
- `mcp__chrome-devtools-9222__take_screenshot` - Capture page screenshot
- `mcp__chrome-devtools-9222__click` - Click elements by UID from snapshot
- `mcp__chrome-devtools-9222__fill` - Fill form inputs
- `mcp__chrome-devtools-9222__evaluate_script` - Run JavaScript on page

### Workflow
1. Call `list_pages` to see available pages and their IDs
2. Call `select_page` if needed to switch context
3. Call `navigate_page` with `url` parameter to load a page
4. Call `take_snapshot` to get the page's accessibility tree with element UIDs
5. Use UIDs from snapshot for `click`, `fill`, etc.

### Example: Navigate and Inspect
```
1. mcp__chrome-devtools-9222__list_pages({})
   → Returns pages list with IDs

2. mcp__chrome-devtools-9222__navigate_page({"url": "https://hr.job5156.com/search"})
   → Navigates to the search page

3. mcp__chrome-devtools-9222__take_snapshot({})
   → Returns page elements with UIDs for interaction
```

### Troubleshooting
- **Connection refused**: Chrome may not be running with remote debugging enabled. Run `./apps/browser-extension/scripts/cmux-setup-profile.sh` to restart Chrome with proper flags.
- **Page not found**: Call `list_pages` first to see what's available.
- **Stale UIDs**: Always get a fresh snapshot before interacting with elements.

## Safety / commits
- `profile-seed/Preferences` and `profile-seed/Secure Preferences` may contain sensitive data.
- Review and sanitize before pushing to GitHub.
