# Agent Governance Workflow

Apply the evidence and source workflow to non-trivial tasks. Trivial tasks (simple edits, running commands, formatting) skip evidence unless explicitly requested.

## Task Classification

1. **Non-trivial tasks** (architecture, design, library/framework/API recommendations, technical planning): Full evidence required.
2. **Trivial tasks** (simple edits, running commands, formatting): Evidence optional unless explicitly requested.

## Source Priority (strict order)

For non-trivial tasks, consult sources in this order:

1. **Local repository files** — implementation files, config, and cached docs under `dev-docs/*.txt`.
2. **Context7** — query library/framework/API documentation for correctness and usage details.
3. **DevTools MCP** — browser snapshots, console messages, network requests, and script evaluation for live verification. **Only when the task involves browser-facing changes.**
4. **Official web sources** — use only for freshness-sensitive facts (new releases, policy changes, current status).

## Output Portability

1. Use repo-relative paths (for example `apps/api/src/routes/resumes.ts`) so output is reusable in a fresh environment.
2. Write commands that are copy/paste-ready from repository root.
3. Avoid machine-specific absolute paths.

## Evidence Reporting

For non-trivial technical design/recommendation responses, include a `Sources Used` section with only the categories actually consulted:

    ## Sources Used
    - Local files: apps/example/path.ts
    - Context7: /org/project
    - DevTools MCP: take_snapshot — verified X (omit if no browser changes)
    - Web: https://example.com/reference (omit if no web sources used)

Omit entire categories that were not consulted — no need to list `none`.

## Reviser Workflow

After implementing changes to UI or browser-facing code with a running dev server and chrome-debug:

1. **Snapshot** — `take_snapshot` to confirm expected elements exist.
2. **Console** — `list_console_messages` (filter: error, warn) to verify no regressions.
3. **Evaluate** — `evaluate_script` to assert runtime state (optional, for state-dependent fixes).
4. **Compare** — Diff snapshot before/after (optional, for visual regressions).

Skip the entire reviser workflow when:
- The change is backend-only with no browser-visible effect
- The dev server / chrome-debug is not running
- The change is trivial (text, formatting, non-interactive)

## Governance File Changes

If any AGENTS governance files are modified during a session, run:
- `make sync-agent-policy`
- `make check-agent-policy`
