# Agent Governance Workflow

Apply this workflow automatically to every task in this repository.

## Task Classification

1. **Non-trivial tasks** (architecture, design, library/framework/API recommendations, technical planning): Full evidence required.
2. **Trivial tasks** (simple edits, running commands, formatting): Evidence optional unless explicitly requested.

## Source Priority (strict order)

For non-trivial tasks, consult sources in this order:

1. **Local repository files** — implementation files, config, and cached docs under `dev-docs/*.txt`.
2. **Context7** — query library/framework/API documentation for correctness and usage details.
3. **Official web sources** — use only for freshness-sensitive facts (new releases, policy changes, current status).

## Evidence Reporting

For non-trivial technical design/recommendation responses, append:

    ## Sources Used
    - Local files:
      - /absolute/path/one
    - Context7:
      - /org/project
    - Web:
      - https://example.com/reference

If a category has no sources, set it to `none`.

## Governance File Changes

If any AGENTS governance files are modified during a session, run:
- `make sync-agent-policy`
- `make check-agent-policy`
