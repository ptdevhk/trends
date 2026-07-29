# Verified Industry Evidence Summary and Source Preview

## Status

Reusable Trends recruiter-UX pattern, approved 2026-07-29.

## Intent

Show human-approved external evidence for a resume employer without making each search result behave like an audit page. The initial use case is MY CNC / machinery `行业验证` for strong known-company evidence.

## Search result

Show one compact block for the strongest or most role-relevant verified employer:

- `✓ CNC 行业验证` badge;
- canonical employer name;
- one-sentence evidence summary;
- approved source count;
- compact source chips (`Official`, `SSM / MSIC`, `OEM`, or another reviewed source type);
- last human-review date;
- `+N verified employers` when more approved employers exist.

Normal search results expose only human-approved `verified` profiles. Pending, rejected, stale-review, and conflicting states belong in Resume Detail or the stewardship UI.

## Source preview

Each source chip opens a rich preview on hover, keyboard focus, or mobile tap. The preview contains:

- source identity and domain;
- source type;
- evidence title;
- short reviewed excerpt;
- trust explanation;
- human-approval state;
- freshness metadata where useful;
- safe `Open source` action.

The interaction is inspired by compact citation previews: source identity stays scannable, while the recruiter can inspect proof without leaving the result list.

## Resume Detail

Resume Detail expands the same approved verdict revision into:

- every approved source and excerpt;
- current verdict and industry class;
- matched employer alias and canonical company identity;
- reviewer and approval timestamp;
- freshness and refresh-due status;
- revision history;
- authorized internal visibility for conflicts and rejected evidence;
- `Request refresh` action.

## Data contract

The compact result and full detail must reference the same approved verdict revision ID. A materialized search evidence summary should include:

```ts
type VerifiedIndustryEvidenceSummary = {
  verdictRevisionId: string
  companyKey: string
  displayName: string
  industryClass: string
  verifiedYears: number
  summary: string
  reviewedAt: number
  sources: Array<{
    sourceId: string
    sourceType: string
    domain: string
    title: string
    excerpt: string
    url: string
    trustLabel: string
    fetchedAt?: number
  }>
  additionalVerifiedEmployerCount: number
}
```

Only approved evidence may be projected into this recruiter-facing structure.

## Interaction and safety rules

- No live web fetch on search, filter, scoring, or detail request paths.
- No unreviewed source URLs on recruiter-facing result cards.
- Desktop preview opens on hover and keyboard focus.
- Mobile preview opens on first tap; the explicit link opens the source.
- External URLs use safe new-tab handling.
- Evidence excerpts are short reviewer-selected summaries.
- A stale source creates a maintenance proposal; it does not silently flip a verdict.
- Show one primary employer block, then collapse the rest behind `+N verified employers`.

## Accessibility

- Source chips are real buttons or links with stable accessible names.
- Tooltip content is reachable by keyboard and remains open while focused.
- Trust state is communicated in text, not color alone.
- `行业验证` includes an accessible explanation of what is verified.
- Mobile users can dismiss a preview without navigating.

## Testing expectations

- Primary employer selection is deterministic and role-relevant.
- Search summary and Resume Detail use the same verdict revision.
- Candidate/rejected evidence never leaks into the normal result card.
- Hover, focus, tap, escape, and safe external-link behavior are covered.
- Multiple-employer collapse and `+N` preview are covered.
- Missing favicon, missing excerpt, stale source, and unavailable URL states degrade cleanly.

## Canonical wiki artifact

The active project copy lives in `projects/trends/work/2026-07-29-my-industry-evidence-self-maintenance-search-ux/ux-template.md` in the SkillWiki vault.
