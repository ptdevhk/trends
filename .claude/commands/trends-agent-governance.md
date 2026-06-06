# Trends Agent Governance

Thin command wrapper for the canonical Trends governance policy.

## Workflow

1. If the task is implementation, debugging, review, prep, investigate, merge, or browser verification, follow `@dev-loop` and `.claude/dev-loop.config.md`.
2. If the task is architecture, design, library/framework/API recommendation, technical planning, or governance policy, follow `AGENTS.md`.
3. Keep reusable guidance portable: repo-relative paths, repo-root commands, and no machine-specific paths.
4. If governance policy changes, run the sync/check commands listed in `AGENTS.md`.
5. If the governance skill package changes, run `make sync-project-skills` and `make check-project-skills`.

## Source Matrix

Use the canonical source order in `AGENTS.md`: local repository sources, Context7, DevTools MCP for browser-facing verification, then official web only for freshness-sensitive facts.

## Evidence Template

For non-trivial technical recommendations, include `Sources Used` with only categories actually consulted. Omit unused categories.
