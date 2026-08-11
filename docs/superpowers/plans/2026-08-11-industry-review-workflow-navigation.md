# Industry Review Workflow Navigation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the review inbox navigation bounce (workspace reviewers/admins get kicked to resumes home when opening a proposal) and complete the review workflow entry points: scroll-to-detail on selection, legacy evidence notice for workspace reviewers, and a role-aware 行业验证 entry in the workspace Settings sidebar.

**Architecture:** Context-aware navigation base derived from the route param (`teamSlug` present on `/:teamSlug/system/...`, absent on `/admin/system`), mirroring `WorkspaceDebugPage`. The legacy notice and settings sidebar gate widen from dev-system-admin-only to active-workspace reviewer/admin via the existing `hasWorkspaceIndustryReviewAccess` helper.

**Tech Stack:** React 19 (root-pinned), react-router-dom 6, Vitest + Testing Library, lucide-react icons, shared package `@trends/shared`.

## Global Constraints

- React 19 is pinned at the repo root — never touch the root pin or let `package-lock.json` drift.
- react-i18next test mocks MUST return a module-scope `t` (hoisted above `vi.mock`); never an inline arrow inside the mock factory.
- Keep `t` in `useCallback`/`useMemo` deps; never omit it to "fix" loops.
- Copy: always `t('key', { defaultValue: '...' })`; no new locale keys in this feature (all copy reuses existing keys).
- Node 22 (`.nvmrc`). Tests: `cd apps/web && npx vitest run <file>`; full suite `npm test -- --run`; typecheck `npm run typecheck`.
- Commits are local-only on `preview-v0.4.23` — do NOT push.
- Do not edit `dev-docs/AGENTS.md`.
- Working-tree note: a draft of Task 1 (route-rendered tests + base-path fix) already exists uncommitted from a pre-brainstorming pass; reconcile it with the code below rather than re-deriving.

---

### Task 1: Workspace-scoped review navigation base

**Files:**
- Modify: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx` (imports ~line 3; body ~lines 59-68; `selectProposal` ~line 366)
- Test: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`

**Interfaces:**
- Consumes: `useParams()` route param `teamSlug` (present on `/:teamSlug/system/*` routes, absent on `/admin/system`).
- Produces: component-level `const reviewBasePath: string` — later tasks reuse it for navigation only.

- [ ] **Step 1: Ensure the route-rendered regression tests exist (draft already in working tree — verify/complete)**

In `SystemSettingsIndustryVerificationPage.test.tsx`:

```tsx
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <output data-testid="test-location-search">{location.search}</output>
      <output data-testid="test-location-path">{location.pathname}</output>
    </>
  )
}

function renderPageAtRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/:teamSlug/system/settings/industry-verification/*"
          element={(
            <>
              <LocationProbe />
              <SystemSettingsIndustryVerificationPage />
            </>
          )}
        />
        <Route
          path="/admin/system/settings/industry-verification/*"
          element={(
            <>
              <LocationProbe />
              <SystemSettingsIndustryVerificationPage />
            </>
          )}
        />
        <Route path="*" element={<div data-testid="wrong-route">wrong route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}
```

And the two tests:

```tsx
it('keeps proposal navigation on the workspace-scoped base for workspace reviewers', async () => {
  const user = userEvent.setup()
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
  })
  useWorkspaceMock.mockReturnValue({
    slug: 'hr',
    name: 'hr',
    isAdmin: false,
    surface: 'workspace',
    isSystemSurface: false,
    isPublicSurface: false,
  })

  renderPageAtRoute('/hr/system/settings/industry-verification')

  await user.click(await screen.findByTestId('industry-review-row-proposal-1'))

  expect(screen.getByTestId('test-location-path')).toHaveTextContent(
    '/hr/system/settings/industry-verification/proposals/proposal-1',
  )
  expect(requestJsonMock).toHaveBeenCalledWith('/api/company-industry-proposals/proposal-1/review-packet')
  expect(screen.queryByTestId('wrong-route')).not.toBeInTheDocument()
})

it('keeps proposal navigation on the canonical admin base for system admins', async () => {
  const user = userEvent.setup()

  renderPageAtRoute('/admin/system/settings/industry-verification')

  await user.click(await screen.findByTestId('industry-review-row-proposal-1'))

  expect(screen.getByTestId('test-location-path')).toHaveTextContent(
    '/admin/system/settings/industry-verification/proposals/proposal-1',
  )
  expect(requestJsonMock).toHaveBeenCalledWith('/api/company-industry-proposals/proposal-1/review-packet')
  expect(screen.queryByTestId('wrong-route')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify the workspace test fails**

Run: `cd apps/web && npx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx -t "workspace-scoped base"`
Expected: FAIL — `test-location-path` contains `/admin/system/...` (the buggy constant base), not `/hr/system/...`. The system-admin test PASSES (canonical base unchanged — it is a guard, not the regression).

- [ ] **Step 3: Implement the context-aware base**

In `SystemSettingsIndustryVerificationPage.tsx`, replace the destructure:

```tsx
const { proposalId: proposalIdFromRoute } = useParams()
```

with:

```tsx
const { teamSlug, proposalId: proposalIdFromRoute } = useParams()
// The review page renders at two bases: the canonical dev system surface
// (/admin/system, no route param) and the workspace-scoped surface
// (/:teamSlug/system). In-page navigation must stay on the active base —
// hardcoding /admin/system sends workspace admins/reviewers into
// SystemAccessGate, which bounces them to their workspace home.
const reviewBasePath = teamSlug
  ? `/${teamSlug}/system/settings/industry-verification`
  : `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
```

In `selectProposal`, replace both `SYSTEM_ROUTE_PREFIX`-based pathname literals:

```tsx
function selectProposal(proposalId: string | undefined) {
  const nextParams = new URLSearchParams(searchParams)
  nextParams.delete('proposalId')
  nextParams.delete('status')
  navigate({
    pathname: proposalId
      ? `${reviewBasePath}/proposals/${encodeURIComponent(proposalId)}`
      : reviewBasePath,
    search: nextParams.toString() ? `?${nextParams.toString()}` : '',
  }, { replace: true })
}
```

- [ ] **Step 4: Run the full page test file**

Run: `cd apps/web && npx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`
Expected: ALL PASS (both new tests + all pre-existing standalone tests — the standalone `renderPage` has no route, so `teamSlug` is undefined and the base falls back to `/admin/system`, keeping legacy behavior).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
git commit -m "fix(web): keep review proposal navigation on the active workspace base

selectProposal hardcoded SYSTEM_ROUTE_PREFIX (/admin/system), so workspace
admins/reviewers were bounced to their workspace home by SystemAccessGate
when opening a proposal (查看 / row click / Previous-Next). The base is now
derived from the route param: workspace-scoped /:teamSlug/system for
workspace users, canonical /admin/system for dev system admins."
```

---

### Task 2: Scroll-to-detail on selection

**Files:**
- Modify: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx` (import line 1; body; detail wrapper ~line 431; `selectProposal`; new effect)
- Test: `apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`

**Interfaces:**
- Consumes: `selectedProposal` memo (existing), `selectProposal` from Task 1.
- Produces: `data-testid="industry-review-detail-section"` on the detail wrapper; behavior — smooth-scroll to detail on user-initiated selection only.

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```tsx
it('scrolls the detail section into view after a user-initiated selection', async () => {
  const user = userEvent.setup()
  const scrollIntoView = vi.fn()
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  try {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
    })
    useWorkspaceMock.mockReturnValue({
      slug: 'hr',
      name: 'hr',
      isAdmin: false,
      surface: 'workspace',
      isSystemSurface: false,
      isPublicSurface: false,
    })
    renderPageAtRoute('/hr/system/settings/industry-verification')

    await user.click(await screen.findByTestId('industry-review-row-proposal-1'))
    await screen.findByText('ACME CNC')

    await waitFor(() => {
      const detailCalls = scrollIntoView.mock.instances.filter(
        (el) => (el as HTMLElement).dataset?.testid === 'industry-review-detail-section',
      )
      expect(detailCalls.length).toBeGreaterThan(0)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
  }
})

it('does not scroll the detail section on an initial deep link', async () => {
  const scrollIntoView = vi.fn()
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  try {
    useAuthMock.mockReturnValue({
      memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
    })
    useWorkspaceMock.mockReturnValue({
      slug: 'hr',
      name: 'hr',
      isAdmin: false,
      surface: 'workspace',
      isSystemSurface: false,
      isPublicSurface: false,
    })
    renderPageAtRoute('/hr/system/settings/industry-verification/proposals/proposal-1')

    await screen.findByText('ACME CNC')

    const detailCalls = scrollIntoView.mock.instances.filter(
      (el) => (el as HTMLElement).dataset?.testid === 'industry-review-detail-section',
    )
    expect(detailCalls).toHaveLength(0)
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
  }
})
```

- [ ] **Step 2: Run to verify both fail**

Run: `cd apps/web && npx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx -t "scrolls the detail section"`
Expected: FAIL (first: no scroll calls; second: currently also fails only if a scroll targets the detail — it will pass trivially, which is fine; the regression is the first test).

- [ ] **Step 3: Implement**

Import `useRef`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

Component body (next to the other refs/state):

```tsx
const detailSectionRef = useRef<HTMLDivElement | null>(null)
const userInitiatedSelectionRef = useRef(false)
```

First line of `selectProposal`:

```tsx
userInitiatedSelectionRef.current = true
```

New effect (place after the packet-loading effect, before the sources effect):

```tsx
useEffect(() => {
  if (!userInitiatedSelectionRef.current || !selectedProposal) return
  userInitiatedSelectionRef.current = false
  detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}, [selectedProposal])
```

Attach the ref + testid to the detail wrapper (`<div className="space-y-6">` that contains the placeholder/detail cards):

```tsx
<div className="space-y-6" ref={detailSectionRef} data-testid="industry-review-detail-section">
```

- [ ] **Step 4: Run to verify both pass**

Run: `cd apps/web && npx vitest run src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx`
Expected: ALL PASS (including the pre-existing targeted-row scroll test at "opens an off-page canonical target..." — it mocks scrollIntoView the same way and restores it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.tsx apps/web/src/pages/system-settings/SystemSettingsIndustryVerificationPage.test.tsx
git commit -m "feat(web): scroll the review detail into view after user-initiated selection

The detail section renders below the inbox, so selecting a row (查看 / row
click / Previous-Next) appeared to do nothing. Selection-driven selections
now smooth-scroll the detail into view; initial deep links keep the existing
targeted-row scroll behavior."
```

---

### Task 3: `LegacyIndustryEvidenceNotice` reviewBasePath prop

**Files:**
- Modify: `apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx`
- Create: `apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: prop `reviewBasePath?: string` (default `'${SYSTEM_ROUTE_PREFIX}/settings/industry-verification'`). Task 4 passes workspace-scoped values.

- [ ] **Step 1: Write the failing tests (new file)**

`apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Module-scope t per repo convention — never an inline arrow in the factory.
const mockT = (key: string, options?: Record<string, unknown>) => {
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}))

import { LegacyIndustryEvidenceNotice } from './LegacyIndustryEvidenceNotice'

describe('LegacyIndustryEvidenceNotice', () => {
  it('defaults the review link to the canonical admin base', () => {
    render(<LegacyIndustryEvidenceNotice showReviewAction />)
    const link = screen.getByRole('link', { name: 'Review industry evidence' })
    expect(link).toHaveAttribute(
      'href',
      '/admin/system/settings/industry-verification?status=ready_for_review',
    )
  })

  it('uses the workspace-scoped base when provided', () => {
    render(
      <LegacyIndustryEvidenceNotice
        showReviewAction
        reviewBasePath="/hr/system/settings/industry-verification"
      />,
    )
    const link = screen.getByRole('link', { name: 'Review industry evidence' })
    expect(link).toHaveAttribute(
      'href',
      '/hr/system/settings/industry-verification?status=ready_for_review',
    )
  })

  it('deep-links a review target under the provided base', () => {
    render(
      <LegacyIndustryEvidenceNotice
        showReviewAction
        reviewBasePath="/hr/system/settings/industry-verification"
        reviewTarget={{ employerLabel: 'ACME', proposalId: 'prop-9' }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Review ACME' })
    expect(link).toHaveAttribute(
      'href',
      '/hr/system/settings/industry-verification/proposals/prop-9',
    )
  })

  it('renders no link without showReviewAction', () => {
    render(<LegacyIndustryEvidenceNotice />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/web && npx vitest run src/components/industry-evidence/LegacyIndustryEvidenceNotice.test.tsx`
Expected: FAIL (module has no `reviewBasePath` prop yet — workspace-base tests see `/admin/system/...` hrefs).

- [ ] **Step 3: Implement**

In `LegacyIndustryEvidenceNotice.tsx`:

- Delete the module constant: `const REVIEW_INBOX_HREF = ...` (line 6).
- Extend the props type:

```tsx
type LegacyIndustryEvidenceNoticeProps = {
  compact?: boolean
  showReviewAction?: boolean
  reviewTarget?: IndustryEvidenceReviewTarget
  /** Base of the review surface for the current viewer; defaults to the canonical dev system base. */
  reviewBasePath?: string
}
```

- Destructure with default and derive `reviewHref` from the base:

```tsx
export function LegacyIndustryEvidenceNotice({
  compact = false,
  showReviewAction = false,
  reviewTarget,
  reviewBasePath = `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`,
}: LegacyIndustryEvidenceNoticeProps) {
  const { t } = useTranslation()
  const reviewHref = reviewTarget
    ? `${reviewBasePath}/proposals/${encodeURIComponent(reviewTarget.proposalId)}`
    : `${reviewBasePath}?status=ready_for_review`
```

(`SYSTEM_ROUTE_PREFIX` import stays.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && npx vitest run src/components/industry-evidence/LegacyIndustryEvidenceNotice.test.tsx`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.tsx apps/web/src/components/industry-evidence/LegacyIndustryEvidenceNotice.test.tsx
git commit -m "feat(web): make the legacy evidence notice review link base configurable

Default stays the canonical /admin/system base; workspace callers can pass
a workspace-scoped base (used in the next task)."
```

---

### Task 4: Legacy evidence notice audience at call sites

**Files:**
- Modify: `apps/web/src/components/search/SearchResultsList.tsx` (import ~line 11/14; body ~line 136; usage ~line 411)
- Modify: `apps/web/src/components/ResumeCard.tsx` (imports; body ~line 465)
- Modify: `apps/web/src/components/ResumeDetail.tsx` (imports; body ~line 165; usage ~line 535)
- Test: `apps/web/src/components/search/SearchResultsList.test.tsx`
- Test: `apps/web/src/components/ResumeCard.test.tsx`
- Test: `apps/web/src/components/ResumeDetail.test.tsx`

**Interfaces:**
- Consumes: `LegacyIndustryEvidenceNotice` `reviewBasePath` prop (Task 3); `useWorkspace()` slug; `hasWorkspaceIndustryReviewAccess(memberships, slug)`.
- Produces: gate `showIndustryEvidenceReviewGuidance` = dev system admin OR active-workspace admin/reviewer; `legacyReviewBasePath` = canonical or `/{slug}/system/settings/industry-verification`.

- [ ] **Step 1: Write the failing tests (three files)**

**`SearchResultsList.test.tsx`** — add a hoisted WorkspaceContext mock (the file currently has none):

```tsx
const useWorkspaceMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => useWorkspaceMock(),
}))
```

In `beforeEach`, default `useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })`.

Append two tests (copy the legacy fixture verbatim from the existing test at line 168 — `item.resume.ingestData = { evidenceText: '', industryTags: ['cnc'], ... roleSignals: [{ type: 'sales', ... industryVerifiedYears: 3, verifyIn: 'workHistory', matchedWorkEntries: [{ companyName: 'Vision Machine Tools', ... industryVerified: true ... }] }] }`):

```tsx
it('guides an active-workspace reviewer to the workspace review inbox for legacy signals', () => {
  useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'reviewer' }],
  })
  const item = createItem(0)
  item.resume.ingestData = { /* same legacy fixture as the system-admin test */ }

  render(
    <SearchResultsList
      expandedIds={new Set()}
      hasMore={false}
      items={[item]}
      onLoadMore={vi.fn()}
      onToggleExpanded={vi.fn()}
    />,
  )

  expect(screen.getByText('Industry evidence needs human review')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Review industry evidence' }))
    .toHaveAttribute('href', '/hr/system/settings/industry-verification?status=ready_for_review')
})

it('hides legacy review guidance from plain members', () => {
  useWorkspaceMock.mockReturnValue({ slug: 'hr', isPublicSurface: false })
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'user-1', workspaceSlug: 'hr', role: 'user' }],
  })
  const item = createItem(0)
  item.resume.ingestData = { /* same legacy fixture */ }

  render(
    <SearchResultsList
      expandedIds={new Set()}
      hasMore={false}
      items={[item]}
      onLoadMore={vi.fn()}
      onToggleExpanded={vi.fn()}
    />,
  )

  expect(screen.queryByText('Industry evidence needs human review')).not.toBeInTheDocument()
})
```

**`ResumeCard.test.tsx`** — WorkspaceContext mock already exists (`useWorkspace: () => ({ slug: 'hr' })`). Append:

```tsx
it('shows the legacy rules badge for an active-workspace reviewer', () => {
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }],
  })

  render(
    <ResumeCard
      resume={baseResume}
      onViewDetails={vi.fn()}
      roleSignals={[{
        type: 'sales',
        matchedSignals: ['CNC Sales'],
        signalCount: 1,
        occurrences: 1,
        years: 4,
        roleRelevantYears: 4,
        industryVerifiedYears: 0,
        verifyIn: 'workHistory',
        matchedWorkEntries: [{
          companyName: 'Vision Machine Tools',
          jobTitle: 'Sales Engineer',
          years: 4,
          industryVerified: false,
          matchedSignals: ['CNC Sales'],
        }],
      }]}
    />,
  )

  expect(screen.getByText('Legacy rules signal')).toBeInTheDocument()
})

it('hides the legacy rules badge from plain members', () => {
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'user' }],
  })

  render(
    <ResumeCard
      resume={baseResume}
      onViewDetails={vi.fn()}
      roleSignals={[{ type: 'sales', matchedSignals: ['CNC Sales'], signalCount: 1, occurrences: 1, years: 4 }]}
    />,
  )

  expect(screen.queryByText('Legacy rules signal')).not.toBeInTheDocument()
})
```

**`ResumeDetail.test.tsx`** — add a WorkspaceContext mock (file has none):

```tsx
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'hr' }),
}))
```

Append (mirror the inline resume fixture of the existing "renders the full materialized..." test — name Alice, `ingestData` with the same legacy `roleSignals` shape as above and `verifiedIndustryEvidenceSummaries: []`):

```tsx
it('guides an active-workspace reviewer to the workspace review inbox for legacy signals', () => {
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }],
  })

  render(
    <ResumeDetail
      resume={{ /* inline fixture: name Alice, ingestData.roleSignals legacy fixture, verifiedIndustryEvidenceSummaries: [] */ }}
    />,
  )

  expect(screen.getByRole('link', { name: 'Review industry evidence' }))
    .toHaveAttribute('href', '/hr/system/settings/industry-verification?status=ready_for_review')
})

it('hides legacy review guidance from plain members', () => {
  useAuthMock.mockReturnValue({
    memberships: [{ userId: 'u1', workspaceSlug: 'hr', role: 'user' }],
  })

  render(
    <ResumeDetail resume={{ /* same inline fixture */ }} />,
  )

  expect(screen.queryByText('Industry evidence needs human review')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/web && npx vitest run src/components/search/SearchResultsList.test.tsx src/components/ResumeCard.test.tsx src/components/ResumeDetail.test.tsx`
Expected: FAIL — reviewer cases see no notice/badge (gate is still dev-admin-only); member cases may pass (already hidden).

- [ ] **Step 3: Implement**

**`SearchResultsList.tsx`** — imports:

```tsx
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { hasSystemAdminAccess, hasWorkspaceIndustryReviewAccess, SYSTEM_ROUTE_PREFIX } from '@/lib/workspace-access'
```

Replace the guidance computation (currently `const showIndustryEvidenceReviewGuidance = hasSystemAdminAccess(memberships)`):

```tsx
const { slug: workspaceSlug } = useWorkspace()
const isSystemAdmin = hasSystemAdminAccess(memberships)
const showIndustryEvidenceReviewGuidance = isSystemAdmin || hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug)
const legacyReviewBasePath = isSystemAdmin
  ? `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
  : `/${workspaceSlug}/system/settings/industry-verification`
```

Usage (~line 411):

```tsx
{hasLegacyIndustryEvidence && showIndustryEvidenceReviewGuidance ? (
  <LegacyIndustryEvidenceNotice showReviewAction reviewBasePath={legacyReviewBasePath} />
) : null}
```

**`ResumeCard.tsx`** — imports: add `useWorkspace` from `@/contexts/WorkspaceContext`; add `hasWorkspaceIndustryReviewAccess` to the existing `workspace-access` import. Body (before `showLegacyRoleSignal`):

```tsx
const { slug: workspaceSlug } = useWorkspace()
```

Replace:

```tsx
const showLegacyRoleSignal = primaryRoleEvidenceProvenance === 'legacy' && hasSystemAdminAccess(memberships)
```

with:

```tsx
const showLegacyRoleSignal = primaryRoleEvidenceProvenance === 'legacy'
  && (hasSystemAdminAccess(memberships) || hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug))
```

**`ResumeDetail.tsx`** — imports: add `useWorkspace`; extend the `workspace-access` import with `hasWorkspaceIndustryReviewAccess` and `SYSTEM_ROUTE_PREFIX`. Replace:

```tsx
const showIndustryEvidenceReviewGuidance = hasSystemAdminAccess(memberships)
```

with:

```tsx
const { slug: workspaceSlug } = useWorkspace()
const isSystemAdmin = hasSystemAdminAccess(memberships)
const showIndustryEvidenceReviewGuidance = isSystemAdmin || hasWorkspaceIndustryReviewAccess(memberships, workspaceSlug)
const legacyReviewBasePath = isSystemAdmin
  ? `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`
  : `/${workspaceSlug}/system/settings/industry-verification`
```

Usage (~line 535):

```tsx
<LegacyIndustryEvidenceNotice
  showReviewAction
  reviewTarget={industryReviewTarget}
  reviewBasePath={legacyReviewBasePath}
/>
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && npx vitest run src/components/search/SearchResultsList.test.tsx src/components/ResumeCard.test.tsx src/components/ResumeDetail.test.tsx`
Expected: ALL PASS — including the pre-existing system-admin test at `SearchResultsList.test.tsx` line 168 (dev admin → canonical `/admin/system` href unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/search/SearchResultsList.tsx apps/web/src/components/search/SearchResultsList.test.tsx apps/web/src/components/ResumeCard.tsx apps/web/src/components/ResumeCard.test.tsx apps/web/src/components/ResumeDetail.tsx apps/web/src/components/ResumeDetail.test.tsx
git commit -m "feat(web): show legacy evidence review guidance to active-workspace reviewers/admins

The legacy notice gate widened from dev-system-admin-only to also include
the active workspace's admins and reviewers, with a workspace-scoped link
base (/hr/system/...). Dev system admins keep the canonical /admin/system
links; plain members and public share surfaces stay notice-free."
```

---

### Task 5: Shared settings nav — review-access flag + item

**Files:**
- Modify: `packages/shared/src/system-debug-metadata.ts` (`SurfaceNavDefinition` type; `SETTINGS_NAV_ITEMS`)
- Test: `packages/shared/src/system-debug-metadata.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SurfaceNavDefinition.requiresReviewAccess?: boolean`; new item `{ id: 'industry-verification', ..., requiresReviewAccess: true }` in `SETTINGS_NAV_ITEMS` — Task 6 consumes the flag.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/system-debug-metadata.test.ts`, inside the `SETTINGS_NAV_ITEMS` describe block, append:

```ts
it('includes an industry verification entry gated on review access', () => {
  const item = SETTINGS_NAV_ITEMS.find((entry) => entry.id === 'industry-verification')
  expect(item).toMatchObject({
    hrefSuffix: '/system/settings/industry-verification',
    matchesSuffixes: ['/system/settings/industry-verification'],
    requiresReviewAccess: true,
  })
  expect(item?.requiresAdmin).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared && npx vitest run src/system-debug-metadata.test.ts -t "industry verification"`
Expected: FAIL (item not found).

- [ ] **Step 3: Implement**

In `system-debug-metadata.ts`, add the optional flag to `SurfaceNavDefinition`:

```ts
export type SurfaceNavDefinition = {
  id: string
  titleKey: string
  defaultTitle: string
  hrefSuffix: string
  matchesSuffixes: string[]
  requiresAdmin?: boolean
  requiresReviewAccess?: boolean
}
```

In `SETTINGS_NAV_ITEMS`, insert after the `policies` entry (before `export-fields`):

```ts
{
  id: "industry-verification",
  titleKey: "debugConfig.settingsNavIndustryVerification",
  defaultTitle: "Industry verification",
  hrefSuffix: "/system/settings/industry-verification",
  matchesSuffixes: ["/system/settings/industry-verification"],
  requiresReviewAccess: true,
},
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/shared && npx vitest run src/system-debug-metadata.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/system-debug-metadata.ts packages/shared/src/system-debug-metadata.test.ts
git commit -m "feat(shared): add review-access-gated industry verification entry to workspace settings nav"
```

---

### Task 6: SettingsSidebar role-aware filter

**Files:**
- Modify: `apps/web/src/components/SettingsSidebar.tsx`
- Test: `apps/web/src/components/SettingsSidebar.test.tsx`

**Interfaces:**
- Consumes: `SETTINGS_NAV_ITEMS` + `requiresReviewAccess` flag (Task 5); `hasWorkspaceIndustryReviewAccess(memberships, slug)`.
- Produces: 行业验证 item visible to active-workspace admins/reviewers, hidden from members.

- [ ] **Step 1: Write the failing tests**

In `SettingsSidebar.test.tsx`:

- Add an AuthContext mock (file has none):

```tsx
const authState = vi.hoisted(() => ({
  memberships: [] as Array<{ userId: string; workspaceSlug: string; role: string }>,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ memberships: authState.memberships }),
}))
```

- Add the industry-verification item to the mocked `SETTINGS_NAV_ITEMS` array in the existing `@trends/shared` mock:

```tsx
{ id: 'industry-verification', titleKey: 'nav.industryVerification', defaultTitle: 'Industry verification', hrefSuffix: '/system/settings/industry-verification', matchesSuffixes: ['/system/settings/industry-verification'], requiresReviewAccess: true },
```

- In `beforeEach`, reset `authState.memberships = []`.

Append:

```tsx
it('shows the industry verification entry to an active-workspace reviewer', () => {
  workspaceState.isAdmin = false
  authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'reviewer' }]

  renderWithRouter(<SettingsSidebar />)

  const link = screen.getByRole('link', { name: 'Industry verification' })
  expect(link).toHaveAttribute('href', '/dev/system/settings/industry-verification')
})

it('shows the industry verification entry to an active-workspace admin', () => {
  authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'admin' }]

  renderWithRouter(<SettingsSidebar />)

  expect(screen.getByRole('link', { name: 'Industry verification' })).toBeInTheDocument()
})

it('hides the industry verification entry from plain members', () => {
  workspaceState.isAdmin = false
  authState.memberships = [{ userId: 'u1', workspaceSlug: 'dev', role: 'user' }]

  renderWithRouter(<SettingsSidebar />)

  expect(screen.queryByRole('link', { name: 'Industry verification' })).not.toBeInTheDocument()
})

it('hides the industry verification entry from a reviewer of another workspace', () => {
  workspaceState.isAdmin = false
  authState.memberships = [{ userId: 'u1', workspaceSlug: 'hr', role: 'reviewer' }]

  renderWithRouter(<SettingsSidebar />)

  expect(screen.queryByRole('link', { name: 'Industry verification' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failures**

Run: `cd apps/web && npx vitest run src/components/SettingsSidebar.test.tsx`
Expected: FAIL — reviewer/other-workspace cases (item not rendered for reviewers yet).

- [ ] **Step 3: Implement**

In `SettingsSidebar.tsx`:

- Imports:

```tsx
import { Factory } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { hasWorkspaceIndustryReviewAccess } from '@/lib/workspace-access'
```

- Icon map: add `'industry-verification': Factory` to `NAV_ICONS`.
- Component body:

```tsx
const { memberships } = useAuth()
const canReviewIndustryEvidence = hasWorkspaceIndustryReviewAccess(memberships, slug)
```

- Filter (replace the current single-line filter):

```tsx
const navItems = useMemo<NavItem[]>(() => {
  return SETTINGS_NAV_ITEMS
    .filter((item) => (
      (!item.requiresAdmin || isAdmin)
      && (!item.requiresReviewAccess || canReviewIndustryEvidence)
    ))
    .map((item) => ({
      ...item,
      title: t(item.titleKey, { defaultValue: item.defaultTitle }),
      href: `/${slug}${item.hrefSuffix}`,
      matches: item.matchesSuffixes.map((suffix) => `/${slug}${suffix}`),
      icon: NAV_ICONS[item.id] ?? Home,
    }))
}, [canReviewIndustryEvidence, isAdmin, slug, t])
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && npx vitest run src/components/SettingsSidebar.test.tsx`
Expected: ALL PASS (existing tests too — default `isAdmin: true` keeps admin-gated items visible).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SettingsSidebar.tsx apps/web/src/components/SettingsSidebar.test.tsx
git commit -m "feat(web): show industry verification in the workspace settings sidebar for reviewers/admins

SETTINGS_NAV_ITEMS items with requiresReviewAccess render when the active
workspace user is an admin or reviewer; plain members and reviewers of
other workspaces do not see the entry."
```

---

### Task 7: Docs, full verification, browser E2E

**Files:**
- Modify: `CLAUDE.md` (add work entry line)
- Delete: `docs/superpowers/plans/2026-08-11-review-inbox-navigation-fix.md` (untracked, superseded by the spec + this plan)

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Update CLAUDE.md**

Add one bullet to the reference index near the other 2026-08 entries:

```markdown
- Completed review-workflow navigation fix (2026-08-11): `docs/superpowers/specs/2026-08-11-industry-review-workflow-navigation-design.md` · workspace-scoped review base (fixes SystemAccessGate bounce on 查看/row/prev-next) · scroll-to-detail · legacy notice for workspace reviewers/admins · 行业验证 settings sidebar entry for reviewers
```

- [ ] **Step 2: Remove the superseded plan draft**

```bash
rm docs/superpowers/plans/2026-08-11-review-inbox-navigation-fix.md
```

- [ ] **Step 3: Full unit verification**

Run:
```bash
cd apps/web && npm run typecheck
cd apps/web && npm test -- --run
cd packages/shared && npx vitest run src/system-debug-metadata.test.ts
```
Expected: typecheck clean; 1900+ web tests pass; shared test passes.

- [ ] **Step 4: Browser E2E — full review loop as hr-reviewer**

Dev server (`:5173`) and CDP browser (`:9222`) must be running; session logged in as `hr-reviewer` (hr workspace, role reviewer).

```bash
playwright-cli attach --cdp=http://localhost:9222
playwright-cli goto "http://localhost:5173/hr/resumes?location=Malaysia&q=CNC%20Sales&minRoleYears=1&roleType=sales"
playwright-cli snapshot
# Expect: notice 结果仅限行业认证雇主 · 目录中 35 家认证雇主 with 前往审核 link
playwright-cli click "前往审核"
# Expect: review inbox (审核收件箱, 80 个待处理提案), URL /hr/system/settings/industry-verification
# click the first 查看 (use its ref from snapshot) — EXPECT: no bounce; detail section in view with proposal header/evidence
# Previous / Next buttons walk the queue without leaving the surface
# Approve (green check) → confirmation → row shows Approved in this session; Undo → row back to ready
playwright-cli goto "http://localhost:5173/hr/settings"
playwright-cli snapshot
# Expect: sidebar contains 行业验证 entry linking /hr/system/settings/industry-verification
playwright-cli goto "http://localhost:5173/admin/system/settings/industry-verification"
# Expect (unchanged, expected): hr-reviewer is bounced to /hr/resumes by SystemAccessGate
```

Take a screenshot of the detail view: `playwright-cli screenshot --filename /tmp/trends-sync/review-detail-fixed.png`.

- [ ] **Step 5: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: record review workflow navigation fix work entry"
```

## Self-Review Notes

- Spec coverage: navigation base (Task 1), scroll-to-detail (Task 2), legacy notice prop (Task 3), call-site gates incl. public-share exclusion (Task 4), sidebar flag+item (Task 5), sidebar filter (Task 6), verification + E2E (Task 7). All spec sections mapped.
- Placeholder scan: the only inline "same fixture as X" references point to concrete existing fixtures in the same files (SearchResultsList legacy fixture at line 168; ResumeDetail inline resume pattern; ResumeCard roleSignals fixtures at lines 465-490) — implementer copies them verbatim.
- Type consistency: `reviewBasePath` (string) consistent across Tasks 1/3/4; `requiresReviewAccess` consistent across Tasks 5/6; `legacyReviewBasePath`/`canReviewIndustryEvidence` naming consistent within Task 4.
