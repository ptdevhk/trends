# Source Matrix

Use this order for non-trivial technical design/recommendation tasks.

1. Local repository files
   - Prefer implementation files and config in this repository.
   - Include relevant cached docs under `dev-docs/*.txt`.
2. Context7
   - Query library/framework/API documentation for behavioral correctness and usage details.
3. Official web sources
   - Use only for freshness-sensitive facts (new releases, policy changes, current status).

Output pathing rules:
- Use repo-relative paths in implementation/report content so the output is portable to fresh environments.
- Use repo-relative paths in `Sources Used` to document what was consulted.

If a source tier is not used, state `none` for that tier in `Sources Used`.
