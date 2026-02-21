# Browser Extension Dev

Use this command when working on `apps/browser-extension/` or any resume collection workflow that depends on the extension.

## Dev Workflow

1. Choose environment:
   - Container: use seeded-profile scripts (no `--load-extension`).
   - Local: use the extension debug profile workflow.
2. Run the canonical scripts from repo root:
   - `./apps/browser-extension/scripts/cmux-setup-profile.sh`
   - `./apps/browser-extension/scripts/open-search.sh`
   - `./apps/browser-extension/scripts/check-profile-seed.sh`
3. Validate capture/export deterministically:
   - `window.__TR_RESUME_DATA__.status()`
   - `window.__TR_RESUME_DATA__.extract()`
4. Ensure dedupe IDs (`resumeId`, `perUserId`) are present in structured exports.

## Collection Pipeline

Preferred quick verification via URL flags:
- `?keyword=<term>` to auto-search
- `?tr_auto_export=json` to export structured JSON
- `?tr_sample_name=<name>` to tag a reproducible sample name

Expected outputs:
- structured export includes provenance (`metadata.sourceUrl`, `metadata.searchCriteria`)
- `<html>` debug attributes reflect capture state (`data-tr-*`)

## CDP Automation

Use existing make targets instead of ad-hoc scripts:

```bash
make refresh-sample                          # default: 销售 -> sample-initial.json
make refresh-sample KEYWORD=python SAMPLE=sample-python
make refresh-sample ALLOW_EMPTY=1
```

If CDP cannot connect, re-run the container Chrome setup:
- `./apps/browser-extension/scripts/cmux-setup-profile.sh`

