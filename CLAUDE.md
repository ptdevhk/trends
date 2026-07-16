# Trends Agent Reference Index

## Path Aliases
- `{REPO_ROOT}` = repository root (`/root/workspace`)
- `{WIKI_VAULT}` = skillwiki vault root (default `~/wiki`; resolve with `skillwiki path`)

## Repo Entry Points
- Canonical agent policy: `{REPO_ROOT}/AGENTS.md`
- Agent runbook: `{REPO_ROOT}/docs/agent-runbook.md`
- Browser extension guide: `{REPO_ROOT}/apps/browser-extension/CLAUDE.md`
- Dev docs usage: `{REPO_ROOT}/dev-docs/README.md`
- Generated governance mirror: `{REPO_ROOT}/dev-docs/AGENTS.md`

## Wiki Entry Points
- Vault root: `{WIKI_VAULT}`
- Trends wiki index: `{WIKI_VAULT}/projects/trends/index.md`
- Trends project README: `{WIKI_VAULT}/projects/trends/README.md`
- Open K3 planned: `{WIKI_VAULT}/projects/trends/work/2026-07-10-company-registry-policy-architecture/`
- Prod deferred (do not local-claim): `{WIKI_VAULT}/projects/trends/work/2026-06-18-prod-unpin-auth-readiness/`
- Completed seats/onboarding (2026-07-16): `{WIKI_VAULT}/projects/trends/work/2026-07-16-admin-user-workspace-onboarding/`

<!-- AGENT_POLICY:BEGIN -->
<!--
## Agent Governance Policy (Canonical)

- Canonical policy file: `AGENTS.md`
- Generated mirror file: `dev-docs/AGENTS.md`
- Do not edit `dev-docs/AGENTS.md` directly.
- After policy edits, run `make sync-agent-policy` or `bunx tsx scripts/agent-governance/sync-policy.ts`.

### Source Matrix (strict order)
1. Local repository sources, including `dev-docs/` cached docs and implementation files.
2. Context7 references for library/framework/API behavior and usage details.
3. DevTools MCP — browser snapshots, console, network for live verification (browser-facing changes only).
4. Official web sources only when freshness-sensitive or time-sensitive facts are required.

### Evidence Contract
- For non-trivial technical design/recommendation responses, include a `Sources Used` section.
- Include only categories actually consulted. Omit categories not used — no need to list `none`.

### Enforcement
- Sync generated policy mirror with `make sync-agent-policy`.
- Validate policy drift with `make check-agent-policy`.
- Validate governance skill package and installed copy with `make check-agent-skill` (or `make check-agent-skill TARGET=all` when both skill roots matter).
- `make check` must fail if policy or governance skill checks fail.
-->
<!-- AGENT_POLICY:END -->
