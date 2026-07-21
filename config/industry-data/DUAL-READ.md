# Dual-read and skills.md cutover (R1)

## Current sources of truth (dual-read)

| Surface | Loader | Used by |
|---------|--------|---------|
| Brands + origin + aliases + familyId | `brands.json` via `IndustryDataService.loadBrands` / `resolveEntity` | Industry verify, brand match, origin meta |
| Companies | `keywords-structured.md` | `verifyCompany` / companyHits keys |
| Brand alias patterns for field-aware hits | `config/resume/skills.md` company patterns | `IngestComputeService.computeBrandHits` |

`resolveEntity` is the **unified** brand/company surface API for R1. Ingest still dual-reads skills patterns for equipment/sales context hits so we do not silently drop skills.md behavior.

## After goldens are green

1. Keep brands.json as canonical brand IDs / origin / aliases / familyId.
2. Generate or retire skills.md company-pattern lines from brands v2 (script TBD in a follow-up if not same PR).
3. Until generation lands, dual-read remains intentional and documented.

## Out of scope

- Phase 3 score formula
- R4 Tavily/Firecrawl
- K3 company policy
