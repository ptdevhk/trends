# K3 Company Registry + Company Policy — Design (Slice B)

**Status:** Slice B landed; **Slice C accepted** 2026-07-17 (hide + soft workflow; no ranking)  
**Work item:** `projects/trends/work/2026-07-10-company-registry-policy-architecture`  
**Origin:** `raw/transcripts/2026-07-09-task-company-level-allowlist-blocklist-filter.md`  
**Slice C design:** `docs/superpowers/specs/2026-07-17-company-policy-slice-c-hide-soft-workflow.md`  
**Slice C plan:** `docs/superpowers/plans/2026-07-17-company-policy-slice-c-hide-soft-workflow.md`

## Goal (this slice)

Ship a first-class **company registry** and **workspace-scoped company policy** operator surface so HR can manage known-good / no-hire companies **before** search/runtime enforcement lands.

Out of scope for Slice B:

- Search list ranking / hide / workflow enforcement
- Work-history auto-match projections on resumes
- Market/global policy UI (schema supports it; UI is workspace-only)
- Prompt-only score boosts
- Merging 宝力机械 and 宝惠 under any umbrella name

## Locked product rules

| Rule | Detail |
|------|--------|
| Exact names | `宝力机械` / `Pro-Technic Machinery` and `宝惠` / `Polywell` are **separate** |
| No BaoLi umbrella | Never use `BaoLi` as a shared employer group in active config |
| Identity vs policy | Registry IDs are canonical; policy is an append-only overlay |
| Score boundary | Policy does **not** rewrite canonical AI score |
| Scope resolution | Most specific wins: workspace > market > global (resolve helper ready; UI writes workspace) |

## Architecture

```
[Operator UI /settings/policies]
        |  REST
[API BFF /api/companies*, /api/company-policies*]
        |  Convex write secret
[Convex]
  companies              immutable companyKey + display names + status
  company_aliases        normalized alias -> companyKey
  company_policy_revisions  append-only effect revisions per scope
```

### Tables

**companies**

- `companyKey` (string, immutable external id)
- `status`: `provisional` | `confirmed` | `merged`
- `displayName`, `nameCn?`, `nameEn?`
- `mergedIntoCompanyKey?`
- timestamps + optional `createdBy`

**company_aliases**

- `companyKey`, `aliasNormalized`, `aliasDisplay`, `source` (`seed` | `operator` | `observed`)

**company_policy_revisions**

- `companyKey`
- `scopeType`: `workspace` | `market` | `global`
- `scopeId`: workspace slug | `CN`/`MY` | `global`
- `revision` (monotonic per company+scope)
- effects (optional each):
  - `visibility`: `default` | `hide`
  - `workflow`: `default` | `blocked`
  - `rankingEffect`: `none` | `band_known_good` | `band_known_bad` | `boost` | `demote`
  - `reasonCodes[]`, `summary?`
- `createdAt`, `createdBy?`

Effective policy for a scope = highest `revision` row for `(scopeType, scopeId, companyKey)`.

### Operator presets (UI convenience only)

| Preset | rankingEffect | visibility | workflow |
|--------|---------------|------------|----------|
| Known good | `band_known_good` | `default` | `default` |
| No-hire | `band_known_bad` | `hide` | `blocked` |
| Clear / none | `none` | `default` | `default` |

## Operator surface

- Route: `/:workspace/settings/policies`
- Tabs: **Candidates** (existing blacklist) · **Companies** (registry + policy)
- Legacy `/:workspace/settings/blocks` redirects to policies (candidates tab)
- Nav label: **Policies** (matches both paths)

## Seed

On demand / bootstrap mutation:

1. Confirm companies + aliases for Pro-Technic and Polywell
2. Optional: workspace policy revision for Pro-Technic as known-good in `hr` (operator can clear)

## Later slices (not this PR)

1. Match `workHistory.companyName` → companyKey via aliases; entry snapshots
2. Resume-level derived summary + projections
3. Search badges / ranking band / hide filter
4. Unresolved provisional queue UI
5. Market/global policy editor

## Acceptance (Slice B)

- [ ] Schema + Convex CRUD for companies, aliases, policy revisions
- [ ] Seed preserves separate Pro-Technic vs Polywell
- [ ] API requires workspace auth; no cross-workspace override
- [ ] Policies page manages candidate blocks + company policies
- [ ] No search/score formula change
- [ ] Tests for Convex + API core paths
