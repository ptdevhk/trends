# Trends Agent Governance

Apply this governance workflow for non-trivial technical planning and recommendation tasks in this repository.

## Workflow

1. Classify the task.
   - If the task is technical design/recommendation, source evidence is required.
   - If the task is a trivial edit or command-only action, evidence is optional unless explicitly requested.
2. Load local sources first.
   - Read relevant implementation and configuration files in this repository.
   - Read relevant cached docs under `./dev-docs/*.txt`.
3. Query Context7 for library/framework/API behavior and usage details.
4. Query official web sources only when freshness-sensitive facts are required.
5. Format output for portability.
   - Use repo-relative paths for implementation/report content (for example `apps/api/src/routes/resumes.ts`).
   - Write commands so they are copy/paste-ready from repository root in a fresh environment.
   - Avoid machine-specific absolute paths in implementation guidance.
6. Include a `Sources Used` section in the final response using the template below.
   - Keep local evidence paths absolute in `Sources Used`.
7. If AGENTS governance files changed, run:
   - `make sync-agent-policy`
   - `make check-agent-policy`

## Source Matrix

Use this strict order for non-trivial technical design/recommendation tasks:

1. Local repository files
   - Prefer implementation files and config in this repository.
   - Include relevant cached docs under `./dev-docs/*.txt`.
2. Context7
   - Query library/framework/API documentation for correctness and usage details.
3. Official web sources
   - Use only for freshness-sensitive facts (new releases, policy changes, current status).

Output pathing rules:
- Use repo-relative paths in implementation/report content so the output is portable to fresh environments.
- Use absolute local paths only in `Sources Used` to document exactly what was consulted.

If a source tier is not used, set it to `none` in `Sources Used`.

## Evidence Template

Use this template in non-trivial technical design/recommendation responses:

```markdown
## Sources Used
- Local files (absolute paths consulted):
  - /absolute/path/one
  - /absolute/path/two
- Context7:
  - /org/project
  - /org/project/version
- Web:
  - https://example.com/reference
```

If a category is not used, set it to `none`.
