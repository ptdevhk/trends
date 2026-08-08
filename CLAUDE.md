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
- Completed Seek talentsearch detail + MY expand **v0.4.21** (2026-07-24): `{WIKI_VAULT}/projects/trends/work/2026-07-24-seek-talentsearch-detail-v0.4.21/` · `84b20e23` + local tag `v0.4.21` · ext 1.3.6 (not pushed)
- Completed web-research real-source layer (2026-07-30): `{WIKI_VAULT}/projects/trends/work/2026-07-30-web-research-real-source-layer/` · 16 local commits `c2142e23..830ae8ef` (not pushed) · **CN is the core market (internal users are China users); MY is additional** · CN upstream = NewsNow-compatible API ([ourongxing/newsnow](https://github.com/ourongxing/newsnow), TrendRadar upstream) via existing `RESEARCH_HOTLIST_API_URL` hook · `WEB_RESEARCH_MARKET` default `cn`
- Completed Research hub CNC + pulse keywords (2026-07-22): `{WIKI_VAULT}/projects/trends/work/2026-07-22-research-hub-cnc-pulse-keywords/` · local tip `c519b6e4` (not pushed)
- Completed ingestComputeEpoch + search-freshness doctor (2026-07-21): `{WIKI_VAULT}/projects/trends/work/2026-07-21-ingest-compute-epoch-search-freshness/` · compound same slug · commits `4447382a` + `0bd7aa85` + `02c5ce6d` (2026-07-22: greenwash fix, floors 100, MY preview/local 142 parity)
- Completed Seek MY talentsearch editor + minRoleYears gate (2026-07-18): `{WIKI_VAULT}/projects/trends/work/2026-07-18-seek-my-talentsearch-profile-editor-search-gate/`
- Completed clear-analyses AI-only / HR status preserve (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-17-clear-analyses-ai-only-hr-status/`
- Completed K3 company policy B+C (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-10-company-registry-policy-architecture/`
- Completed preview auth migration P1 (2026-07-17): `{WIKI_VAULT}/projects/trends/work/2026-07-16-preview-auth-workspace-portability/`
- Industry-data R1+R2+R4 (discuss/review, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-industry-data-r1-r2-r4-web-steward/`
- Company-policy follow-ups (human-only, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-company-policy-followups-human-only/`
- Workspace portability P2–P4 (human-only, do not auto-claim): `{WIKI_VAULT}/projects/trends/work/2026-07-17-workspace-portability-p2-p4-human-only/`
- Prod deferred (do not local-claim): `{WIKI_VAULT}/projects/trends/work/2026-06-18-prod-unpin-auth-readiness/`
- Completed seats/onboarding (2026-07-16): `{WIKI_VAULT}/projects/trends/work/2026-07-16-admin-user-workspace-onboarding/`

## Test/CI Conventions (loop-class regressions — do not reintroduce)

CI Tests workflow stalled for hours in 2026-07 ("Maximum update depth exceeded"
infinite loops + hangs). The following conventions are hard-won; the guards are
enforced by tests/CI:

- **React 19 is pinned at the repo root** (root devDeps `react`/`react-dom`
  `^19`). `apps/web/vitest.config.ts` aliases every react import to the ROOT
  copy, so a stale root hoist silently runs tests on a different React major
  (the July-2026 root cause: a stale lockfile hoisted React 18 to root while
  the bun tree had 19). `apps/web/src/test/setup.ts` hard-fails at test start
  if resolved React is not 19.x. Never remove the root pin; never let
  `package-lock.json` drift out of the tree (it is committed and CI-installs it).
- **Mount-effect load callbacks must not depend on `t`.** The loop pattern:
  `useEffect(() => { void load() }, [load])` where `load = useCallback(..., [t])`
  and `t` changes identity per render → effect re-runs every render → infinite
  loop. Omit `t` from the deps array and keep the convention comment +
  `// eslint-disable-next-line react-hooks/exhaustive-deps`.
- **react-i18next test mocks must return a module-scope `t`.** An inline
  `t: (key) => ...` arrow inside a `vi.mock('react-i18next', ...)` factory
  creates a fresh `t` every render, destabilizing every `useCallback([..., t])`
  in the tree. Hoist it: `const mockT = (key, opts) => ...` at module scope,
  then `t: mockT`. `src/test/setup.ts` provides a shared default.
- **Loop watchdog:** `apps/web/vitest.config.ts` `onConsoleLog` throws on
  "Maximum update depth exceeded" so loops fail in seconds, not at the
  30-minute CI timeout.
- **Node 22 / CI parity:** `.nvmrc` pins node 22 (what the Checks + Tests
  workflows run). Before pushing, run `make ci-local` (node-major check +
  i18n + agent policy + `CI=true make check-build` + `make test-coverage`) —
  it reproduces the CI gates locally. `NODE_VERSION_STRICT=1` upgrades the
  node-major mismatch to a hard failure.

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
- `make check` must fail if policy checks fail.
-->
<!-- AGENT_POLICY:END -->
