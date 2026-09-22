# CPA / AI Routing Hot-Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let system admins hot-switch deployment-wide AI **model** and **API base URL** (Convex scoring + BFF AI paths) via admin Runtime UI and Trends CLI, without a BFF restart; keep API keys in env/secrets only.

**Architecture:** Hybrid source of truth — `system_settings` keys `aiApiBase` / `aiModel` / `aiFallbackModel` with env fallback; short-TTL BFF cache; Convex analyze path async-reads settings then env; admin-only GET/PUT + optional Test Connection and CPA `GET /models` refresh; CLI mirrors the same HTTP APIs. Never store or return API key material in settings/audit JSON.

**Tech Stack:** Convex `system_settings`, Hono OpenAPI BFF (`apps/api`), React Runtime page (`apps/web`), Go Cobra CLI (`packages/cli`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-cpa-ai-hot-config-design.md`

## Global Constraints

- Deployment-wide only (no per-workspace overrides).
- API key stays in process/Convex env / host secrets — never in `system_settings` value, API responses, or audit payloads.
- Canonical model form: `provider/model` (e.g. `openai/deepseek-v4-flash`); strip prefix for CPA chat (existing `resolveChatCompletionModel`).
- Model/URL changes apply without BFF restart; key rotation may still need env reload (document only).
- Writes require workspace **admin** (`requireAdmin` / `getAdminAccessError`); record `updatedBy` + `updatedAt`.
- Do not edit CPA host `config.yaml` from Trends.
- No commit/push unless the human explicitly asks; keep changes local.
- Prefer TDD; mirror patterns from resume work-history limit (`system_settings` + Runtime card + BFF routes).

## File map

| Area | Create / Modify |
|------|-----------------|
| Shared curated models | Create `packages/shared/src/ai-routing-models.ts` (+ test); export from shared index |
| Convex settings | Modify `packages/convex/convex/system_settings.ts` (+ tests) |
| Convex read path | Modify `packages/convex/convex/lib/analysis_config.ts`, `analyze.ts` (async resolve) |
| BFF effective config | Create `apps/api/src/services/ai-routing-settings.ts` (+ test) |
| BFF routes | Modify `apps/api/src/routes/config.ts` and/or `system.ts` (+ tests) |
| BFF sticky callers | Modify `ai-config.ts`, `ai-matching.ts`, `ai-chat-client.ts` as needed |
| Web Runtime | Modify `SystemSettingsRuntimePage.tsx`, `lib.ts`, i18n keys ×3 locales, page tests |
| CLI | Create `packages/cli/cmd/ai_config.go` (+ client methods); register in `root.go` |
| Export filter | Modify `deploy/lib-convex-export-filter.sh` if AI keys must stay env-local |
| Ops note | Short note in `docs/runbooks/llm-api-provider-fallback.md` or `ptcloud-cpa.md` |

---

### Task 1: Shared curated model list + normalization helpers

**Files:**
- Create: `packages/shared/src/ai-routing-models.ts`
- Create: `packages/shared/src/__tests__/ai-routing-models.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

**Interfaces:**
- Produces: `CURATED_AI_ROUTING_MODELS: readonly string[]`, `normalizeAiApiBase(url: string): string`, `isProviderModelForm(model: string): boolean`, `mapGatewayModelIdToProviderModel(id: string): string`

- [ ] **Step 1: Write failing tests** for curated list containing at least `openai/deepseek-v4-flash` and `openai/deepseek-v4-flash-e`; `normalizeAiApiBase` trims and ensures no trailing slash beyond `/v1` consistency (document: keep `/v1` suffix if present, strip trailing `/` only); `isProviderModelForm` requires exactly one `/` with non-empty sides; `mapGatewayModelIdToProviderModel("deepseek-v4-flash")` → `openai/deepseek-v4-flash`, `"dd/deepseek-v4-flash"` → `openai/deepseek-v4-flash`, already-prefixed passthrough.

- [ ] **Step 2: Run** `cd packages/shared && bunx vitest run src/__tests__/ai-routing-models.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement** helpers + curated list (include other known DeepSeek aliases used in `scripts/ai-model-check.sh` KNOWN_MODELS that are CPA-relevant).

- [ ] **Step 4: Re-run tests** — expect PASS. Export from shared index.

- [ ] **Step 5: Commit only if human asked** — otherwise leave unstaged.

---

### Task 2: Convex AI routing settings get/set

**Files:**
- Modify: `packages/convex/convex/system_settings.ts`
- Modify: `packages/convex/__tests__/system-settings.test.ts`

**Interfaces:**
- Consumes: shared `normalizeAiApiBase`, `isProviderModelForm`
- Produces:
  - Keys: `aiApiBase`, `aiModel`, `aiFallbackModel` (string values)
  - `getAiRoutingSettings` query → `{ apiBase: string | null; model: string | null; fallbackModel: string | null; updatedAt?: number; updatedBy?: string }` (null = unset / use env)
  - `setAiRoutingSettings` mutation → args `{ apiBase?: string; model?: string; fallbackModel?: string; updatedBy: string; reason?: string }` — validates forms; empty string clears to env fallback; returns effective stored object
  - `getAiRoutingSettingsInternal` internalQuery for analyze path

- [ ] **Step 1: Write failing Convex tests** for set/get round-trip, validation reject of bare model without `/`, clear-to-null behavior.

- [ ] **Step 2: Run** `cd packages/convex && bunx vitest run __tests__/system-settings.test.ts` — expect FAIL on new cases.

- [ ] **Step 3: Implement** get/set/internal mirroring `setResumeWorkHistoryLimit` pattern (patch or insert by key; can store a single JSON object under one key `aiRouting` **or** three keys — prefer **one key `aiRouting`** with `{ apiBase, model, fallbackModel }` to keep audit/atomic writes simple).

- [ ] **Step 4: Tests PASS.

---

### Task 3: Convex analyze read path prefers settings

**Files:**
- Modify: `packages/convex/convex/lib/analysis_config.ts`
- Modify: `packages/convex/convex/analyze.ts` (and any caller of sync `resolveAnalyzeLlmRuntimeConfig` that must become async)
- Modify: `packages/convex/__tests__/analysis_config.test.ts`

**Interfaces:**
- Produces: `async function resolveAnalyzeLlmRuntimeConfigFromSettings(settings: { apiBase: string | null; model: string | null; fallbackModel: string | null } | null): { apiBase; primary; fallback }` — settings non-null fields override env getters; missing fields fall back to `getAiApiBase` / `getAiModel` / `getAiFallbackModel`.
- `callLLM` / tracking wrappers: load settings via internal query once per call (or per batch) then resolve.

- [ ] **Step 1: Failing unit tests** — settings.model overrides env; null settings = env-only.

- [ ] **Step 2: Implement** pure merge helper + wire `analyze.ts` to fetch `getAiRoutingSettingsInternal` before LLM call.

- [ ] **Step 3: Run analysis_config + analyze-related tests — PASS. Do not change embeddings model env in v1 unless trivially shared.

---

### Task 4: BFF effective AI config service (TTL cache)

**Files:**
- Create: `apps/api/src/services/ai-routing-settings.ts`
- Create: `apps/api/src/services/__tests__/ai-routing-settings.test.ts`
- Modify: `apps/api/src/services/ai-config.ts` — add `async function loadEffectiveAIConfig(): Promise<AIConfig>` that merges settings over `loadAIConfig()` for `model`, `fallbackModel`, `apiBase` only; key always from env.

**Interfaces:**
- Produces: `getCachedAiRoutingSettings(): Promise<AiRoutingSettings>`, `invalidateAiRoutingSettingsCache()`, `loadEffectiveAIConfig(): Promise<AIConfig>`
- TTL: 5–15 seconds; invalidate on successful PUT.

- [ ] **Step 1: Failing tests** with mocked `callConvexQuery` — cache hit within TTL; invalidate forces refresh; env fallback when Convex null/error.

- [ ] **Step 2: Implement** service + `loadEffectiveAIConfig`.

- [ ] **Step 3: Update `AIMatchingService`** to call `loadEffectiveAIConfig()` per request (or refresh fields each call) instead of constructor-bound `aiConfig` snapshot for model/base. Keep apiKey from env each call.

- [ ] **Step 4: Ensure `callChatCompletion` default path uses effective config when callers omit `config`.**

- [ ] **Step 5: Focused API unit tests PASS.**

---

### Task 5: BFF routes — get/put/test/models

**Files:**
- Modify: `apps/api/src/routes/config.ts` (extend `/ai-status`) **and/or** add under `system.ts`:
  - `GET /api/config/ai-routing` — effective + stored + masked key presence
  - `PUT /api/config/ai-routing` — admin only; body `{ apiBase?, model?, fallbackModel?, reason? }`
  - `POST /api/config/ai-routing/test` — admin only; server-side `/models` optional + tiny chat; no key in response
  - `GET /api/config/ai-routing/models` — admin only; proxy CPA `{effectiveBase}/models` using env key; map ids via shared helper; on failure return curated list + warning
- Modify: existing `GET /api/config/ai-status` to report **effective** model/base (and optional `source: "settings" | "env"`) without breaking `parseAIStatusPayload` — extend payload additively.
- Create/Modify tests: `apps/api/src/routes/config.test.ts` or new `ai-routing.test.ts`

**Auth:** `requireAdmin` / `getAdminAccessError` + `getAuthenticatedActorId` for `updatedBy`.

- [ ] **Step 1: Failing route tests** — 401/403 on PUT; happy PUT writes Convex; GET never contains raw apiKey; test endpoint mocks fetch.

- [ ] **Step 2: Implement routes**; invalidate cache on PUT.

- [ ] **Step 3: Tests PASS.**

---

### Task 6: Admin Runtime UI — editable AI routing card

**Files:**
- Modify: `apps/web/src/pages/system-settings/SystemSettingsRuntimePage.tsx`
- Modify: `apps/web/src/pages/system-settings/lib.ts` (`AIStatus` / new parsers)
- Modify: `apps/web/src/pages/system-settings/SystemSettingsRuntimePage.test.tsx` (create if missing)
- Modify: i18n locale files for zh-Hans / en / ms (titleKey pattern used by Runtime)

**UI behavior:**
- Show current effective model, fallback, apiBase, masked key.
- Select from curated list + “other” text field.
- Buttons: Save, Refresh models (calls GET models), Test connection (POST test).
- Toast success/error; disable Save for non-admins if page already gates — follow work-history card pattern.

- [ ] **Step 1: Failing component tests** for parse helpers + save payload shape.

- [ ] **Step 2: Implement UI** on Runtime page (keep existing AI inspect section; upgrade to editable).

- [ ] **Step 3: i18n keys + guard if repo has titleKey tests.

- [ ] **Step 4: Web vitest PASS** for Runtime page.

---

### Task 7: Trends CLI `ai-config get|set|test`

**Files:**
- Create: `packages/cli/cmd/ai_config.go`
- Modify: `packages/cli/cmd/root.go` — `rootCmd.AddCommand(newAiConfigCmd())`
- Modify: `packages/cli/internal/client/api.go` (+ auth already present)
- Add Go tests if package has cmd test pattern; otherwise smoke via `go test` on client helpers

**CLI:**
```text
trends ai-config get
trends ai-config set --model openai/deepseek-v4-flash --api-base https://cpa.pt-mes.com/v1 [--fallback ...]
trends ai-config test
```

- [ ] **Step 1: Implement client methods** hitting the new BFF routes (session auth like other cmds).

- [ ] **Step 2: Implement cobra commands**; agent-friendly output.

- [ ] **Step 3: `go test ./...` under `packages/cli`** (or package subset) PASS.

- [ ] **Step 4: Update** `.claude/skills/trends-cli/SKILL.md` with the three commands.

---

### Task 8: Export filter + ops doc + verification

**Files:**
- Modify: `deploy/lib-convex-export-filter.sh` — treat `aiRouting` (or chosen key) as env-local like `maintenanceMode` if preview sync must not clobber prod AI routing (recommended: **yes**, filter it).
- Modify: `docs/runbooks/llm-api-provider-fallback.md` — short “hot-config” subsection pointing at Runtime + CLI; note key still env-only.

- [ ] **Step 1: Add filter** + comment.

- [ ] **Step 2: Run focused suites:**

```bash
cd packages/shared && bunx vitest run src/__tests__/ai-routing-models.test.ts
cd packages/convex && bunx vitest run __tests__/system-settings.test.ts __tests__/analysis_config.test.ts
cd apps/api && bunx vitest run src/services/__tests__/ai-routing-settings.test.ts src/routes/ai-routing.test.ts
cd apps/web && bunx vitest run src/pages/system-settings/SystemSettingsRuntimePage.test.tsx
cd packages/cli && go test ./...
```

- [ ] **Step 3: Manual local smoke** (when stack up): set model via CLI → GET effective → Runtime shows new value → trigger one analyze or BFF chat path without restart.

---

## Execution notes for Orca / Claude Code workers

1. Work from repo root `/root/workspace` (or Orca worktree of same repo).
2. Follow tasks in order 1→8; do not skip tests.
3. Do **not** commit unless the human says so.
4. Do **not** push; do **not** touch prod.
5. Prefer one worker for Tasks 1–5 (backend), optional second for Tasks 6–7 (UI/CLI) after Task 5 lands interfaces.

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Hybrid storage (model/URL in settings; key env) | 2, 4, 5 |
| Deployment-wide | Global |
| Curated + other picker | 1, 6 |
| CPA `/models` refresh | 5, 6 |
| Hot apply / no BFF restart | 3, 4 |
| Admin web + CLI | 6, 7 |
| Test connection soft warn | 5, 6 |
| Audit updatedBy/At | 2, 5 |
| No key in responses | 5 |
| Export env-local | 8 |
