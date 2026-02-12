# Agent Governance Workflow

Apply this workflow automatically to every task in this repository.

## Task Classification

1. **Non-trivial tasks** (architecture, design, library/framework/API recommendations, technical planning): Full evidence required.
2. **Trivial tasks** (simple edits, running commands, formatting): Evidence optional unless explicitly requested.

## Source Priority (strict order)

For non-trivial tasks, consult sources in this order:

1. **Local repository files** — implementation files, config, and cached docs under `dev-docs/*.txt`.
2. **Context7** — query library/framework/API documentation for correctness and usage details.
3. **DevTools MCP** — browser snapshots, console messages, network requests, and script evaluation for live verification.
4. **Official web sources** — use only for freshness-sensitive facts (new releases, policy changes, current status).

## Output Portability

For implementation and report content:

1. Use repo-relative paths (for example `apps/api/src/routes/resumes.ts`) so output is reusable in a fresh environment.
2. Write commands that are copy/paste-ready from repository root.
3. Avoid machine-specific absolute paths.

## Evidence Reporting

For non-trivial technical design/recommendation responses, append:

    ## Sources Used
    - Local files:
      - apps/example/path.ts
    - Context7:
      - /org/project
    - DevTools MCP:
      - take_snapshot — description of what was verified
      - evaluate_script — description of what was checked
    - Web:
      - https://example.com/reference

If a category has no sources, set it to `none`.

## Reviser Workflow

After implementing changes to UI or browser-facing code:

1. **Snapshot** — `take_snapshot` to capture the a11y tree and confirm expected elements exist.
2. **Console** — `list_console_messages` (filter: error, warn) to verify no regressions.
3. **Evaluate** — `evaluate_script` to assert runtime state matches expectations.
4. **Compare** — Diff snapshot before/after the change to confirm the fix.

Skip this step for backend-only changes that have no browser-visible effect.

## Governance File Changes

If any AGENTS governance files are modified during a session, run:
- `make sync-agent-policy`
- `make check-agent-policy`
