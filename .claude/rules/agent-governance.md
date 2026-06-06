# Agent Governance Workflow

Use this file as a short router. `AGENTS.md` is the canonical governance policy; `.claude/dev-loop.config.md` is the operational dev-loop configuration.

## Task Classification

1. **Dev-loop work**: implementation, debugging, review, prep, investigate, merge, and browser verification follow `@dev-loop` plus `.claude/dev-loop.config.md`.
2. **Governance work**: architecture, design, library/framework/API recommendations, technical planning, and AGENTS policy changes follow `AGENTS.md`.
3. **Trivial work**: simple edits, formatting, and command-only tasks skip evidence unless requested.

## Source Priority

Use the strict source order from `AGENTS.md`: local repository sources, Context7, DevTools for browser-facing verification, then official web only for freshness-sensitive facts.

## Evidence Reporting

For non-trivial technical recommendations, include `Sources Used` with only categories actually consulted. Omit unused categories.

## Output Portability

Use repo-relative paths and repo-root commands in reusable guidance. Avoid machine-specific paths unless describing this local workspace.

## Governance File Changes

If `AGENTS.md` or its generated mirror changes, run `make sync-agent-policy` and `make check-agent-policy`. If this skill package changes, run `make sync-project-skills` and `make check-project-skills`.
