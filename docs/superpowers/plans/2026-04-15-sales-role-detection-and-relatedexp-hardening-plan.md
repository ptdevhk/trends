# Sales Role Detection And RelatedExp Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop non-sales or sales-support resumes from satisfying direct-sales `minRoleYears` / sales-floor logic, while reducing drift between `skills.md`, ingest heuristics, search intent inference, and AI analysis.

**Architecture:** Ship this in two tracks. Track A is the production fix: separate broad sales-signal years from direct-sales-role years, make filters and floors rely on strict direct-role evidence, and align keyword sales-intent inference across web and backend. Track B is canonicalization: move sales-role vocabulary into `config/resume/skills.md` / `skills.en.md` as a stronger structured source, but keep weighting, auxiliary-context, and boilerplate heuristics in code where they are easier to test and evolve.

**Tech Stack:** TypeScript, Vitest, React/Vite, Hono API, Convex, YAML/Markdown config

---

## Scope Decisions

- `config/resume/skills.md` is already part of the pipeline, but today it is only canonical for domain keywords, synonyms, experience signals, company patterns, and industry context. It is **not** yet canonical for direct-sales-role detection rules.
- The LLM prompt is an **existing consumer** of role evidence, not the source of truth for role classification. Direct sales-role detection must stay deterministic before AI scoring.
- `apps/api/src/services/ingest-compute-service.ts` should remain the home of auxiliary-context, boilerplate, weighting, and match-source heuristics.
- `packages/shared/src/analysis-key.ts` already has shared sales-intent logic via `isSalesRequiredContext(...)`, but it is not used everywhere and is currently too narrow for all sales-title synonyms.
- The immediate fix should ship without waiting for a full `skills.md` refactor. The canonicalization work is a follow-up task in the same plan, not a blocker for the bug fix.

## Current Source Map

- `config/resume/skills.md`
  - Existing zh-Hans knowledge base parsed by `SkillsKnowledgeService`.
- `config/resume/skills.en.md`
  - Locale pair that must stay structurally aligned with `skills.md`.
- `apps/api/src/services/skills-knowledge.ts`
  - Parser/service for `skills.md`.
- `apps/api/src/services/ingest-compute-service.ts`
  - Current hard-coded sales/engineer signal library plus match-source heuristics.
- `apps/api/src/services/ingest-compute-service.test.ts`
  - Best place to lock the false-positive resume patterns that triggered this investigation.
- `apps/api/src/services/rule-scoring.ts`
  - Type definitions for `RoleSignalSummary` and `MatchedWorkEntry`; consumers of `roleRelevantYears`.
- `packages/convex/convex/analyze.ts`
  - Write-time `inferSalesRelatedExpFloor()` and score normalization.
- `packages/convex/convex/__tests__/analysis-strict-evidence.test.ts`
  - Best place to lock floor / no-floor behavior.
- `packages/convex/convex/resumes.ts`
  - Convex-side `minRoleYears` filtering path.
- `packages/convex/convex/__tests__/resumes-paginated-default.test.ts`
  - Best place to lock filtered-result behavior.
- `packages/convex/convex/analysis_tasks.ts`
  - Backend target-role inference for keyword-only analysis lanes.
- `packages/shared/src/analysis-key.ts`
  - Shared helper `isSalesRequiredContext(...)`; candidate home for canonical sales-intent detection.
- `apps/web/src/hooks/useResumeSearchState.ts`
  - Current web-side sales-intent inference for `minRoleYears`.
- `apps/web/src/hooks/useResumeSearchState.test.tsx`
  - Existing tests for inferred sales-role filtering.
- `config/resume/ai-prompts.md`
  - Existing zh-Hans prompt source; prompt policy already says direct sales must come from explicit sales roles.
- `config/resume/ai-prompts.en.md`
  - Locale pair; update only if prompt wording changes.
- `packages/shared/src/generated/resume-ai-prompts.ts`
  - Generated artifact; do not edit directly.
- `scripts/resume/check-skills-locales.ts`
  - Needs updates if `skills.md` / `skills.en.md` gain new structured sections.

## Non-Negotiable Behavioral Target

- A resume can still carry broad sales-adjacent evidence for ranking and explanation.
- Only **direct sales-role evidence** may contribute to sales `roleRelevantYears`.
- `minRoleYears` with `roleType=sales` must gate on strict direct-sales-role years, not on adjacent/support/description-only years.
- `inferSalesRelatedExpFloor()` must only floor to `80` when direct-sales-role evidence is present.
- Sales-intent inference for keyword-only searches must use one shared helper, not multiple literal `sales|销售` checks.

### Task 1: Lock The Current Failure Modes With Failing Tests

**Files:**
- Modify: `apps/api/src/services/ingest-compute-service.test.ts`
- Modify: `packages/convex/convex/__tests__/analysis-strict-evidence.test.ts`
- Modify: `packages/convex/convex/__tests__/resumes-paginated-default.test.ts`
- Modify: `apps/web/src/hooks/useResumeSearchState.test.tsx`
- Create: `packages/shared/src/analysis-key.test.ts`

- [ ] **Step 1: Add an ingest regression test for engineer/support resumes with sales mentions**

```ts
it("counts only direct sales-title years as sales roleRelevantYears", () => {
  const result = service.computeOne("resume-sales-support-vs-direct", {
    data: [{
      ...SAMPLE_RESUME_ENGINEER.data[0],
      extractedAt: "2026-04-15T00:00:00.000Z",
      workHistory: [
        {
          raw: "2021-01~2025-01 某设备公司 项目工程师",
          companyName: "某设备公司",
          jobTitle: "项目工程师",
          description: "参与销售商务谈判，协助代理商推进订单与验收",
          startDate: "2021-01",
          endDate: "2025-01",
        },
        {
          raw: "2020-01~2021-01 某机床公司 销售工程师",
          companyName: "某机床公司",
          jobTitle: "销售工程师",
          description: "负责客户开发与报价跟进",
          startDate: "2020-01",
          endDate: "2021-01",
        },
      ],
    }],
  })

  const salesRole = result.roleSignals.find((item) => item.type === "sales")
  expect(salesRole?.years).toBeGreaterThan(4)
  expect(salesRole?.roleRelevantYears).toBeCloseTo(1, 1)
})
```

- [ ] **Step 2: Add a floor regression test for description-only sales mentions**

```ts
it("does not apply the sales related_exp floor for description-only sales support", () => {
  const normalized = normalizeAnalysisResult(
    {
      score: 20,
      recommendation: "potential",
      summary: "summary",
      highlights: [],
      breakdown: { related_exp: 35, industry_db: 0 },
    },
    {
      ingestData: {
        industryDbV2Raw: 0,
        companyHits: [],
        brandHits: [],
        roleSignals: [{
          type: "sales",
          years: 6,
          roleRelevantYears: 0,
          matchedSignals: ["销售"],
          matchedWorkEntries: [{
            jobTitle: "项目工程师",
            years: 6,
            industryVerified: false,
            matchedSignals: ["销售"],
            directRoleMatch: false,
          }],
          verifyIn: "workHistory",
        }],
      },
    } as unknown,
    { targetRoleType: "sales" },
  )

  expect(normalized.breakdown?.related_exp).toBe(35)
})
```

- [ ] **Step 3: Add a floor positive test for non-`sales` direct titles**

```ts
it("applies the sales related_exp floor for direct business development titles", () => {
  const normalized = normalizeAnalysisResult(
    {
      score: 20,
      recommendation: "potential",
      summary: "summary",
      highlights: [],
      breakdown: { related_exp: 35, industry_db: 0 },
    },
    {
      ingestData: {
        industryDbV2Raw: 0,
        companyHits: [],
        brandHits: [],
        roleSignals: [{
          type: "sales",
          years: 4,
          roleRelevantYears: 4,
          matchedSignals: ["business development manager"],
          matchedWorkEntries: [{
            jobTitle: "Business Development Manager",
            years: 4,
            industryVerified: true,
            matchedSignals: ["business development manager"],
            directRoleMatch: true,
          }],
          verifyIn: "workHistory",
        }],
      },
    } as unknown,
    { targetRoleType: "sales" },
  )

  expect(normalized.breakdown?.related_exp).toBe(80)
})
```

- [ ] **Step 4: Add a Convex filter regression test**

```ts
it("filters by strict sales roleRelevantYears instead of adjacent sales years", async () => {
  const directSales = buildResumeDoc("resume-direct", 90)
  directSales.ingestData = {
    ruleScores: {},
    industryTags: [],
    experienceLevel: "mid",
    computedAt: 1,
    skillsVersion: 1,
    roleSignals: [{
      type: "sales",
      matchedSignals: ["销售工程师"],
      signalCount: 2,
      occurrences: 1,
      years: 11,
      roleRelevantYears: 11,
      verifyIn: "workHistory",
    }],
  }

  const supportOnly = buildResumeDoc("resume-support", 80)
  supportOnly.ingestData = {
    ruleScores: {},
    industryTags: [],
    experienceLevel: "mid",
    computedAt: 1,
    skillsVersion: 1,
    roleSignals: [{
      type: "sales",
      matchedSignals: ["销售"],
      signalCount: 1,
      occurrences: 2,
      years: 12,
      roleRelevantYears: 0,
      verifyIn: "workHistory",
    }],
  }

  const result = await handler(ctx, {
    paginationOpts: { cursor: null, numItems: 10 },
    minRoleYears: 10,
    roleFilterType: "sales",
  })

  expect(result.page).toHaveLength(1)
})
```

- [ ] **Step 5: Add shared/web sales-intent inference tests**

```ts
expect(isSalesRequiredContext("account manager")).toBe(true)
expect(isSalesRequiredContext("business development manager")).toBe(true)
expect(isSalesRequiredContext("channel manager")).toBe(true)
expect(isSalesRequiredContext("应用工程师")).toBe(false)
```

Run:
```bash
bun test apps/api/src/services/ingest-compute-service.test.ts
bun test packages/convex/convex/__tests__/analysis-strict-evidence.test.ts
bun test packages/convex/convex/__tests__/resumes-paginated-default.test.ts
bun test apps/web/src/hooks/useResumeSearchState.test.tsx
bun test packages/shared/src/analysis-key.test.ts
```

Expected:
- New tests fail before implementation.
- Failures point at inflated `roleRelevantYears`, over-eager floor behavior, or too-narrow sales-intent inference.

- [ ] **Step 6: Commit the red test baseline**

```bash
git add apps/api/src/services/ingest-compute-service.test.ts \
  packages/convex/convex/__tests__/analysis-strict-evidence.test.ts \
  packages/convex/convex/__tests__/resumes-paginated-default.test.ts \
  apps/web/src/hooks/useResumeSearchState.test.tsx \
  packages/shared/src/analysis-key.test.ts
git commit -m "test: lock sales role detection regressions"
```

### Task 2: Separate Broad Sales Signals From Direct Sales Role Years

**Files:**
- Modify: `apps/api/src/services/ingest-compute-service.ts`
- Modify: `apps/api/src/services/rule-scoring.ts`

- [ ] **Step 1: Extend matched work-entry metadata for direct-role evidence**

```ts
export interface MatchedWorkEntry {
  companyName?: string;
  jobTitle?: string;
  years: number;
  industryVerified: boolean;
  matchedSignals: string[];
  directRoleMatch?: boolean;
}
```

- [ ] **Step 2: Add a focused helper for strict sales-role relevance**

```ts
private hasDirectRoleEvidence(
  roleType: string,
  matchedSignals: RoleSignalMatch[],
): boolean {
  if (roleType !== "sales") {
    return true
  }

  return matchedSignals.some((signal) => signal.source === "jobTitle")
}
```

- [ ] **Step 3: Use the helper when accumulating `roleRelevantYears`**

```ts
const directRoleMatch = this.hasDirectRoleEvidence(roleType, matchedSignals)

existing.years += years
if (directRoleMatch) {
  existing.roleRelevantYears += years
}

if (industryVerification.verified && directRoleMatch) {
  existing.industryVerifiedRelevantYears += years
}

existing.matchedWorkEntries.push({
  companyName,
  jobTitle,
  years,
  industryVerified: industryVerification.verified,
  matchedSignals: matchedSignals.map((signal) => signal.label),
  directRoleMatch,
})
```

- [ ] **Step 4: Preserve existing behavior for non-sales role types**

```ts
if (roleType !== "sales") {
  existing.roleRelevantYears += years
  if (industryVerification.verified) {
    existing.industryVerifiedRelevantYears += years
  }
}
```

Run:
```bash
bun test apps/api/src/services/ingest-compute-service.test.ts
```

Expected:
- The new ingest regression tests pass.
- Existing engineer-role tests stay green.

- [ ] **Step 5: Commit the strict role-years split**

```bash
git add apps/api/src/services/ingest-compute-service.ts \
  apps/api/src/services/rule-scoring.ts \
  apps/api/src/services/ingest-compute-service.test.ts
git commit -m "fix: separate direct sales role years from support signals"
```

### Task 3: Harden Sales Floor And Shared Sales-Intent Inference

**Files:**
- Modify: `packages/convex/convex/analyze.ts`
- Modify: `packages/convex/convex/analysis_tasks.ts`
- Modify: `packages/shared/src/analysis-key.ts`
- Modify: `apps/web/src/hooks/useResumeSearchState.ts`
- Modify: `apps/web/src/hooks/useResumeSearchState.test.tsx`
- Modify: `packages/shared/src/analysis-key.test.ts`

- [ ] **Step 1: Expand the shared sales-intent helper to cover direct sales-title synonyms**

```ts
export function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
  const haystack = texts
    .map((text) => normalizeText(text))
    .filter((text): text is string => Boolean(text))
    .join(" ")

  if (!haystack) {
    return false
  }

  return /(?:^|\b)(?:sales|sale|business development|bd|account manager|key account manager|channel sales|channel manager)(?:\b|$)|销售|销售工程师|销售经理|业务拓展|大客户|渠道|客户开发/.test(haystack)
}
```

- [ ] **Step 2: Replace literal `sales|销售` checks with the shared helper**

```ts
function inferTargetRoleType(config: { keywords?: string[]; jobDescriptionTitle?: string; jobDescriptionContent?: string }): "sales" | undefined {
  return isSalesRequiredContext(
    ...(config.keywords ?? []),
    config.jobDescriptionTitle,
    config.jobDescriptionContent,
  ) ? "sales" : undefined
}
```

```ts
function queryImpliesSalesRole(query: string | undefined, keywords: string[]): boolean {
  return isSalesRequiredContext(query, ...keywords)
}
```

- [ ] **Step 3: Make the sales floor depend on strict direct-role evidence**

```ts
const hasWorkEntryEvidence = Array.isArray(rawSignal.matchedWorkEntries)
  && rawSignal.matchedWorkEntries.some((rawEntry) => {
    if (!isRecord(rawEntry)) {
      return false
    }
    return rawEntry.directRoleMatch === true
  })

if (relevantYears >= 3 && hasWorkEntryEvidence) {
  return 80
}
```

Run:
```bash
bun test packages/convex/convex/__tests__/analysis-strict-evidence.test.ts
bun test packages/shared/src/analysis-key.test.ts
bun test apps/web/src/hooks/useResumeSearchState.test.tsx
```

Expected:
- Description-only sales support no longer triggers the floor.
- `business development manager` / `account manager` / `channel manager` infer a sales lane consistently across shared, backend, and web.

- [ ] **Step 4: Commit shared sales-intent and floor hardening**

```bash
git add packages/convex/convex/analyze.ts \
  packages/convex/convex/analysis_tasks.ts \
  packages/shared/src/analysis-key.ts \
  packages/shared/src/analysis-key.test.ts \
  apps/web/src/hooks/useResumeSearchState.ts \
  apps/web/src/hooks/useResumeSearchState.test.tsx \
  packages/convex/convex/__tests__/analysis-strict-evidence.test.ts
git commit -m "fix: harden sales floor and shared sales intent inference"
```

### Task 4: Promote `skills.md` To Canonical Sales Vocabulary Input

**Files:**
- Modify: `config/resume/skills.md`
- Modify: `config/resume/skills.en.md`
- Modify: `apps/api/src/services/skills-knowledge.ts`
- Modify: `scripts/resume/check-skills-locales.ts`
- Modify: `apps/api/src/services/ingest-compute-service.ts`
- Modify: `packages/shared/src/analysis-key.ts`

- [ ] **Step 1: Add a structured sales-role policy section to both locale files**

```md
## 角色信号策略

### sales
- directTitleSignals: 销售工程师, 销售经理, 业务拓展, account manager, key account manager, business development manager, channel manager, channel sales
- contextSignals: 销售, 业务, 大客户, 渠道, account, business development, channel
- auxiliaryPrefixes: 配合, 协助, 辅助, 支持, 协同
- directDutyCues: 客户, 渠道, 订单, 回款, 报价, 开拓, 拓展, 拜访, 维护, 成交, 合同, 经销商
```

- [ ] **Step 2: Extend the parser and locale checker**

```ts
export interface RoleSignalPolicy {
  sales?: {
    directTitleSignals: string[]
    contextSignals: string[]
    auxiliaryPrefixes: string[]
    directDutyCues: string[]
  }
}
```

- [ ] **Step 3: Replace the hard-coded sales vocabulary with parsed policy data**

```ts
const rolePolicy = this.skillsKnowledgeService.getRoleSignalPolicy()
const salesPolicy = rolePolicy.sales
const salesSignals = [
  ...(salesPolicy?.directTitleSignals ?? []),
  ...(salesPolicy?.contextSignals ?? []),
]
```

- [ ] **Step 4: Keep heuristics in code, not in prompt text**

```ts
// Keep COMPANY_BOILERPLATE_PATTERNS and source-weight logic in code.
// skills.md becomes the vocabulary source; heuristics remain executable policy.
```

Run:
```bash
bun run check:resume-skills-locales
bun test apps/api/src/services/skills-knowledge.test.ts
bun test apps/api/src/services/ingest-compute-service.test.ts
bun test packages/shared/src/analysis-key.test.ts
```

Expected:
- `skills.md` becomes a stronger canonical vocabulary source.
- The parser and locale checker both understand the new section.
- The production fix still works if sales vocabulary is loaded from config instead of hard-coded arrays.

- [ ] **Step 5: Commit the vocabulary canonicalization**

```bash
git add config/resume/skills.md \
  config/resume/skills.en.md \
  apps/api/src/services/skills-knowledge.ts \
  scripts/resume/check-skills-locales.ts \
  apps/api/src/services/ingest-compute-service.ts \
  packages/shared/src/analysis-key.ts
git commit -m "refactor: load sales role vocabulary from resume skills config"
```

### Task 5: Align Prompt Source And End-To-End Verification

**Files:**
- Modify: `config/resume/ai-prompts.md`
- Modify: `config/resume/ai-prompts.en.md`
- Verify: `packages/shared/src/generated/resume-ai-prompts.ts`
- Verify: `packages/convex/convex/resumes.ts`
- Verify: `apps/web/src/hooks/useResumeSearchState.ts`

- [ ] **Step 1: Update prompt wording only if it still overstates permissive description-based sales evidence**

```md
- 只有当岗位标题或结构化岗位信号明确显示直接销售角色时，才应将该年限视为 direct sales years。
- 描述中的销售协作、客户支持、项目配合可作为邻近证据，但不应直接抬高 direct sales role years。
```

- [ ] **Step 2: Regenerate and verify prompt artifacts**

Run:
```bash
bun run sync:resume-ai-prompts
bun run check:resume-ai-prompts
```

Expected:
- `packages/shared/src/generated/resume-ai-prompts.ts` updates only through the sync script.
- Prompt source and generated runtime stay in sync.

- [ ] **Step 3: Run focused end-to-end verification on the exact debug lane**

Run:
```bash
bun test apps/api/src/services/ingest-compute-service.test.ts
bun test packages/convex/convex/__tests__/analysis-strict-evidence.test.ts
bun test packages/convex/convex/__tests__/resumes-paginated-default.test.ts
bun test apps/web/src/hooks/useResumeSearchState.test.tsx
bun test packages/shared/src/analysis-key.test.ts
make check
```

Expected:
- All focused regression tests pass.
- `make check` passes.

- [ ] **Step 4: Verify the exact local query against the running dev stack**

Run:
```bash
curl -s 'http://localhost:5173/api/resumes?source=convex&location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=10&roleType=sales&minAge=25&maxAge=40&limit=200'
```

Expected:
- The result set no longer treats adjacent/support sales evidence as `10+` years of direct sales experience.
- `罗先生` and `武先生` are excluded from the strict `10-year sales` lane unless direct sales-title evidence alone is sufficient.
- Direct sales resumes with real sales titles still remain.

- [ ] **Step 5: Commit the prompt alignment and final verification**

```bash
git add config/resume/ai-prompts.md \
  config/resume/ai-prompts.en.md \
  packages/shared/src/generated/resume-ai-prompts.ts
git commit -m "chore: align resume prompts with strict sales role policy"
```

## Notes For The Implementer

- Do not edit `packages/shared/src/generated/resume-ai-prompts.ts` directly.
- If Track A is urgent, ship Tasks 1-3 first. Task 4 is the right canonicalization follow-up, but it should not block the production bug fix.
- `apps/api/src/schemas/resumes.ts` still does not parse `minRoleYears`, `roleType`, `minAge`, or `maxAge` for the REST `GET /api/resumes` route. That does **not** block `/dev/resumes` because the page uses Convex directly, but it is a consistency gap worth planning separately if the API route is part of operator workflows.
