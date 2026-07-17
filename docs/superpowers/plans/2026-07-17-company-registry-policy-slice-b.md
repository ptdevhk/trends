# K3 Company Registry + Policy — Implementation Plan (Slice B)

**Design:** `docs/superpowers/specs/2026-07-17-company-registry-policy-design.md`  
**Work item:** `projects/trends/work/2026-07-10-company-registry-policy-architecture`

## Locked decisions (2026-07-17)

| Decision | Choice |
|----------|--------|
| First cut | **Slice B** — registry + workspace policy + full operator surface first |
| Storage SoT | Convex tables (`companies`, `company_aliases`, `company_policy_revisions`) |
| Operator surface | `/:ws/settings/policies` (Candidates + Companies); legacy `/blocks` redirects |
| First runtime | **None in Slice B** (no search ranking/hide yet) |
| Seed | Pro-Technic + Polywell separate; optional known-good workspace policy for Pro-Technic |

## Tasks

### Done in this implementation

1. Shared helpers/types (`packages/shared/src/company-policy.ts`)
2. Convex schema + `companies.ts` mutations/queries + convex-test
3. API `/api/companies*` + `/api/company-policies*` + route tests
4. Web Policies page + nav + i18n
5. Design + this plan doc

### Follow-up (next slices)

1. Match `workHistory.companyName` → companyKey; entry snapshots
2. Resume-level policy summary projection
3. Search badges + ranking band + hide filter (read path only; no score rewrite)
4. Unresolved provisional queue UI
5. Market/global policy editor

## Verification

```bash
# shared helpers
bunx vitest run packages/shared/src/company-policy.test.ts packages/shared/src/system-debug-metadata.test.ts

# convex
cd packages/convex && bunx vitest run __tests__/companies-convex-test.test.ts

# api
cd apps/api && bunx vitest run src/routes/companies.test.ts

# web
cd apps/web && bunx vitest run src/pages/PoliciesPage.test.tsx src/components/SettingsSidebar.test.tsx
```
