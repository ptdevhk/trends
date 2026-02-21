---
name: browser-extension-dev
description: Develop and debug the Trends MV3 browser extension, including CDP automation, resume data capture/export, and the resume collection pipeline integration.
validation:
  descriptionTerms: [extension, browser, resume, collection]
  command:
    path: .claude/commands/browser-extension-dev.md
    requiredSections: [Dev Workflow, Collection Pipeline, CDP Automation]
---

# Browser Extension Dev

Use this skill for work under `apps/browser-extension/` and any workflow that depends on extension-driven resume collection.

## Workflow

1. Read `references/extension-workflow.md` to choose the correct debugging mode (container vs local).
2. For export/sample tasks, follow `references/collection-pipeline.md` and ensure exports include provenance metadata.
3. When validating behavior:
   - Prefer deterministic checks via the content-script accessor (`window.__TR_RESUME_DATA__.*`).
   - Confirm dedupe identifiers (`resumeId`, `perUserId`) are present in exports.
4. If automation is needed, use the existing CDP flows (`make refresh-sample`, `scripts/chrome-debug.sh`) instead of inventing new ones.

## Rules

- Run scripts from repo root unless a script explicitly documents otherwise.
- Do not rely on `--load-extension` inside the container; use the profile seeding workflow.
- Keep changes MV3-compatible and avoid inline injection patterns blocked by CSP (prefer `web_accessible_resources` patterns already in the codebase).

## References

- `references/extension-workflow.md`
- `references/collection-pipeline.md`

