# Agent Instructions (Browser Extension)

These instructions apply to `apps/browser-extension/`. Use them for any extension work.

## Scope
- Target site: `https://hr.job5156.com/search`
- Extension path (container): `/root/workspace/apps/browser-extension`
- Manifest: MV3

## Debugging
### Cmux container (this workspace)
- Chrome is systemd-managed and branded (137+): `--load-extension` is not supported.
- Preferred setup (fresh container):
  - `cd apps/browser-extension && npm run setup-profile`
  - `systemctl restart cmux-devtools cmux-cdp-proxy`
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

## Unique IDs (dedupe support)
- The extension captures API rows to include `resumeId` and `perUserId` in exports.
- If IDs are missing:
  - Ensure search results are loaded.
  - Wait for auto-export completion.
  - Check `<html>` attributes: `data-tr-api-rows`, `data-tr-api-last`, `data-tr-auto-export`.

## CSP / API hook
- API capture is injected via `page-hook.js` (web-accessible resource).
- Do not rely on inline script injection; CSP will block it on this site.

## Safety / commits
- `profile-seed/Preferences` and `profile-seed/Secure Preferences` may contain sensitive data.
- Review and sanitize before pushing to GitHub.
