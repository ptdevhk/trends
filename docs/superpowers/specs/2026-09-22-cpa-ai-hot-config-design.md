# Design: CPA / AI routing hot-config (admin + CLI) — 2026-09-22

Status: **Approved in chat** (brainstorming summary table). Spec written for review before implementation plan.
Scope: Architectural — dual-plane AI routing (Convex live env + BFF process env) becomes operator-editable for model + base URL without code deploy; API key stays in secret/env plane.

## Problem

Operators change CPA routing (`AI_API_BASE`, `AI_MODEL`, `AI_FALLBACK_MODEL`, and related key material) by editing `.env` / host secrets and running `convex env set` / sync scripts. The admin Runtime settings page is **inspect-only**. Trends CLI has **no** AI config commands. BFF AI paths typically need a **process restart** after env change; Convex scoring already reads Convex env live.

Goal: system admins can hot-switch **model** and **API base URL** for both Convex scoring and BFF AI paths without a BFF restart, via **admin web + CLI**, with a safe model picker and optional gateway catalog refresh.

## Decisions (locked)

| # | Decision | Pick |
|---|----------|------|
| 1 | What is live-editable | Model + base URL hot; API key remains ops-editable via env/secret (not app DB) |
| 2 | Scope | Deployment-wide (not per workspace) |
| 3 | Model picker | Curated CPA DeepSeek list + “other” free-form `provider/model` |
| 3b | Catalog source | Optional live `GET {AI_API_BASE}/models` (CPA) to refresh options + curated snapshot fallback |
| 4 | Storage | **Hybrid:** model + URL in Convex settings; API key in env/secret store only |
| 5 | Surfaces | Admin web + Trends CLI (same writes) |
| 6 | Apply without restart | BFF/Convex read settings on AI call (short TTL cache); key change may still need BFF reload / secret sync |
| 7 | Model ID form | Store/display `provider/model`; strip prefix for CPA chat (existing contract); map bare/`dd/` from CPA list in UI |
| 8 | Validate on save | Optional Test Connection (`/models` + tiny chat); warn, do not hard-block “other” |
| 9 | Auth / audit | System admin only; append-only audit of who/when/what (no key values) |

**Out of scope (v1):** per-workspace overrides; storing API keys in Convex or sqlite exports; editing CPA host `config.yaml` from Trends; visual companion UI mocks.

## Current architecture (baseline)

- **Convex scoring:** reads `AI_API_BASE` / `AI_API_KEY` / `AI_MODEL` / `AI_FALLBACK_MODEL` from Convex env (live after `convex env set`).
- **BFF:** `apps/api/src/services/ai-config.ts` snapshots process env at import/use; Runtime page is read-only.
- **Model check:** `scripts/ai-model-check.sh` already probes `{AI_API_BASE}/models` and maintains a known-good list.
- **CPA:** OpenAI-compatible `GET /v1/models`; catalog is **gateway config snapshot** (not full upstream Poe list). Sample config declares prefixed `dd/` Poe-lite models.

## Design

### 1. Source of truth (hybrid)

**Convex `system_settings` (or a dedicated small settings document keyed for AI routing):**

- `aiApiBase` (string URL, trailing `/v1` normalized consistently with today)
- `aiModel` (string, `provider/model`)
- `aiFallbackModel` (string, `provider/model`)
- `updatedAt`, `updatedBy` (user id / CLI principal)

**Not stored in Convex:**

- `AI_API_KEY` — remains in process env / `~/.secrets/...` / Convex env secret. Admin UI shows masked presence only (`set` / `missing`), never the value. CLI may document `convex env set AI_API_KEY` / sync scripts; no plaintext key write API from the browser.

**Bootstrap / fallback:**

- If Convex setting row is absent, fall back to env (`AI_API_BASE`, `AI_MODEL`, `AI_FALLBACK_MODEL`) so existing deploys keep working.
- Env remains the seed for fresh installs and disaster recovery.

### 2. Read path (hot apply)

- **Convex LLM callers:** prefer settings document over Convex env for model + base; keep using Convex env (or process-injected secret) for the key. Short in-memory TTL (e.g. 5–30s) optional if load warrants it; correctness > micro-optimization.
- **BFF AI callers:** replace import-time-only snapshot for model/base with a getter that reads Convex settings (same TTL cache). Key continues from `process.env.AI_API_KEY` until an explicit env reload path exists.
- **No BFF restart** required for model/URL changes. Key rotation remains an ops restart or secret-sync step (documented).

### 3. Write path (admin + CLI)

**Admin web** (extend Runtime / new “AI routing” section under system settings):

- System-admin gated (same class as other dangerous Runtime controls).
- Fields: base URL, primary model, fallback model.
- Picker: curated defaults (at least `openai/deepseek-v4-flash`, `openai/deepseek-v4-flash-e`, plus other known CPA DeepSeek aliases operators use) + “other” text input.
- Optional **Refresh from gateway**: server-side call to `{base}/models` with server-held key; return id list for dropdown merge (never expose key to browser).
- Optional **Test connection**: server-side `/models` + minimal chat completion; surface pass/warn/fail; save still allowed on warn for “other”.
- Masked key status only; link/copy ops hint for rotating key via secrets + sync.

**Trends CLI** (same mutations):

- e.g. `trends ai-config get|set|test` (names flexible in plan) writing the same Convex settings and invoking the same test helper.
- Auth: existing admin/bootstrap CLI credentials; no weaker path than web.

**Audit:** append-only record (settings revision or dedicated audit row): actor, timestamp, previous/new model + base (no secrets).

### 4. Model identity mapping

- Canonical stored form: `provider/model` (BFF validation today).
- When calling CPA chat completions, strip `provider/` as Convex already does.
- When merging CPA `/models` ids (`deepseek-v4-flash`, `dd/deepseek-v4-flash`, etc.), map into picker entries that still save as `openai/...` or operator-chosen `provider/model` “other”; do not force `dd/` into app storage unless ops explicitly chooses it in “other”.

### 5. Dual-plane consistency

After a successful settings write:

1. Convex scoring paths see new model/base on next read (and next analysis).
2. BFF paths see new model/base within TTL.
3. Optionally best-effort `convex env set` mirror for `AI_MODEL` / `AI_API_BASE` so host env stays aligned for scripts (`ai-model-check.sh`, workers). Mirror is **nice-to-have** in v1 if it complicates auth; settings document is authoritative for app runtime.

### 6. Security

- Writes: system admin only.
- Reads of settings: admin (and existing Runtime audience); never return API key material.
- Gateway refresh / test: server-side only, uses env key.
- Preview/prod restore rules: treat AI settings like other env-local keys if export/import would clobber (align with existing `system_settings` env-local filtering patterns where applicable).

### 7. Testing

- Unit: settings read fallback to env; TTL/cache invalidation on write; model normalization; picker merge from `/models` fixture.
- API: admin authz 401/403; test-connection mocked upstream; audit fields present; key never in response body.
- CLI: get/set round-trip against test double or local Convex.
- No live CPA key required in CI; fixtures for `/models` + chat.

## Non-goals / deferred

- Editing CPA’s own model allowlist (`config.yaml` on ptcloud).
- Per-workspace model overrides.
- Storing or rotating API keys from the browser.
- Full LiteLLM-style multi-provider credential vault inside Trends.

## Success criteria

1. Admin can change primary model + base URL in UI; next Convex score and BFF AI call use the new values **without** BFF restart.
2. CLI can perform the same change and show current effective config.
3. API key never appears in Convex documents, API JSON, or audit payloads.
4. “Other” model accepted with warning if not in gateway list; curated defaults always available offline.
5. System non-admins cannot write; writes are audited.

## Sources consulted (brainstorm)

- OpenAI List models API (`GET /v1/models`)
- LiteLLM Admin UI + `lite` management CLI; model management / Test Connection patterns
- Live CPA endpoint existence + `deploy/samples/cpa/config.yaml` gateway snapshot listing
- Repo: `apps/api/src/services/ai-config.ts`, `scripts/ai-model-check.sh`, `docs/runbooks/ptcloud-cpa.md`
