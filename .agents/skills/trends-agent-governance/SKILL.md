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

Apply this workflow for non-trivial technical planning and recommendation tasks.

## Workflow

1. Classify the task.
   - If the task is a technical design/recommendation task, require source evidence.
   - If the task is a trivial edit or command-only action, skip evidence unless explicitly requested.
2. Load local sources first.
   - Read implementation files and relevant docs in this repository.
   - Read `dev-docs/*.txt` material relevant to the task.
3. Query Context7 for libraries/frameworks/APIs involved in the recommendation.
4. Query official web sources only when freshness-sensitive facts are required.
5. Format output for portability.
   - Use repo-relative paths for implementation/report content (for example `apps/api/src/routes/resumes.ts`).
   - Write commands so they are copy/paste-ready from repository root in a fresh environment.
   - Avoid machine-specific absolute paths in implementation guidance.
6. Produce output with `Sources Used` section using the template in `references/evidence-template.md`.
   - Use repo-relative paths in `Sources Used`.
7. If AGENTS governance files changed, run:
   - `make sync-agent-policy`
   - `make check-agent-policy`

## References

- Source matrix rules: `references/source-matrix.md`
- Evidence format template: `references/evidence-template.md`
