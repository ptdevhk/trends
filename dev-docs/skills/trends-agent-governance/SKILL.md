---
name: trends-agent-governance
description: Enforce source selection, evidence reporting, and policy sync for Trends technical guidance. Use when handling architecture, design, library, framework, API recommendation, or AGENTS governance tasks.
validation:
  descriptionTerms: [architecture, design, library, api]
  command:
    path: .claude/commands/trends-agent-governance.md
    requiredSections: [Source Matrix, Evidence Template, Workflow]
  rules:
    path: .claude/rules/agent-governance.md
    requiredSections: [Source Priority, Evidence Reporting, Task Classification]
---

# Trends Agent Governance

Lightweight adapter for Trends-specific governance. Do not duplicate the
dev-loop pipeline here.

## Workflow

1. For implementation, debugging, review, prep, investigate, merge, and browser verification work, follow `@dev-loop` and `.claude/dev-loop.config.md`.
2. For non-trivial architecture, design, library, framework, API, or governance recommendations, apply the canonical policy in `AGENTS.md`.
3. Use the source order from `AGENTS.md`: local repo, Context7, DevTools for browser-facing verification, then official web only for freshness-sensitive facts.
4. Include `Sources Used` only for non-trivial technical recommendations, and list only source categories actually consulted.
5. Keep reusable guidance portable: repo-relative paths, repo-root commands, and no machine-specific paths.
6. If governance policy or this skill package changes, run the relevant sync/check commands from `AGENTS.md`.

## References

- Canonical policy: `AGENTS.md`
- Pipeline config: `.claude/dev-loop.config.md`
- Evidence reminder: `references/evidence-template.md`
