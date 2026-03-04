# Release Note: Extension Keyword Mode Default Change

Date: 2026-03-04
Area: Resume Collector Browser Extension (`apps/browser-extension`)

## What Changed

The extension now uses `concat` keyword mode as the default behavior for auto-search.

- Old default behavior: space-joined keyword terms (equivalent to `spaced`)
- New default behavior: concatenated keyword terms with no separator (`concat`)

Example:

- Input keyword: `CNC 车床 销售 STAR`
- Default search submit keyword now: `CNC车床销售STAR`

## Backward-Compatible Override

If legacy multi-term spacing is needed, set URL param `tr_kw_mode=spaced`.

Example URL:

- `https://hr.job5156.com/search?keyword=CNC%20车床%20销售%20STAR&tr_kw_mode=spaced`

This keeps submitted keyword as:

- `CNC 车床 销售 STAR`

## User Impact

- Most users do not need to change anything.
- Users can switch system default in extension Options (`关键词模式`), or force mode per URL with `tr_kw_mode`.

## Operational Notes

- No migration is required.
- After upgrading extension files, reload the extension in Chrome before testing.
