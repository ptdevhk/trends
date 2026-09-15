import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldShowSearchHeaderLoading } from './search-header-loading'

describe('shouldShowSearchHeaderLoading', () => {
  it('is true while the search request is in flight', () => {
    expect(
      shouldShowSearchHeaderLoading({
        loading: true,
        eagerCount: 0,
        deferredCount: 0,
      }),
    ).toBe(true)
  })

  it('is true while a filter transition is pending', () => {
    expect(
      shouldShowSearchHeaderLoading({
        loading: false,
        isFilterPending: true,
        eagerCount: 0,
        deferredCount: 0,
      }),
    ).toBe(true)
  })

  it('stays true when eager results exist but deferred list has not caught up', () => {
    // Pass 9/10 false CNC empty: loading cleared, deferred still [].
    expect(
      shouldShowSearchHeaderLoading({
        loading: false,
        eagerCount: 200,
        deferredCount: 0,
      }),
    ).toBe(true)
  })

  it('is false for a confirmed empty settled search', () => {
    expect(
      shouldShowSearchHeaderLoading({
        loading: false,
        eagerCount: 0,
        deferredCount: 0,
      }),
    ).toBe(false)
  })

  it('is false once deferred results match a non-empty eager list', () => {
    expect(
      shouldShowSearchHeaderLoading({
        loading: false,
        eagerCount: 200,
        deferredCount: 127,
      }),
    ).toBe(false)
  })

  it('documents that list empty-state must share the same loading gate', () => {
    // ResumeSearchPage passes headerLoading into SearchResultsList so deferred
    // lag cannot flash 没有匹配到简历 while the header still says 加载中.
    const src = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    expect(src).toMatch(/loading=\{headerLoading\}/)
    expect(src.match(/loading=\{headerLoading\}/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('documents that Analyze stays disabled for the same loading gate', () => {
    // Eager analysisCandidates can be non-empty while deferred results still
    // lag; Analyze must not become clickable until headerLoading clears.
    const src = readFileSync(
      path.join(process.cwd(), 'src/hooks/useResumeSearchState.ts'),
      'utf8',
    )
    expect(src).toMatch(/const disableAnalyzeResults =[\s\S]*headerLoading/)
  })

  it('documents that ModeToggle suppresses eager aiStats while headerLoading', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    expect(src).toMatch(/aiStats=\{headerLoading \? undefined : aiModeStats\}/)
    expect(src).toMatch(/disabled=\{headerLoading\}/)
  })

  it('documents that SearchHeader sort stays disabled while loading', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/components/search/SearchHeader.tsx'),
      'utf8',
    )
    expect(src).toMatch(/disabled=\{loading\}/)
  })

  it('documents that FacetSidebar uses headerLoading as the pending gate', () => {
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    const sidebar = readFileSync(
      path.join(process.cwd(), 'src/components/search/FacetSidebar.tsx'),
      'utf8',
    )
    expect(page).toMatch(/isFilterTransitionPending:\s*headerLoading/)
    expect(sidebar).toMatch(/<fieldset[\s\S]*disabled=\{isFilterTransitionPending\}/)
  })

  it('documents that ShareLink stays disabled while headerLoading', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    expect(src).toMatch(/<ShareLinkButton[\s\S]*disabled=\{headerLoading\}/)
  })

  it('documents that AiSummary and HrFeedback share the headerLoading gate', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    expect(src).toMatch(/loading=\{aiSummary\.loading \|\| headerLoading\}/)
    expect(src).toMatch(/summary=\{headerLoading \? undefined : aiSummary\.summary\}/)
    expect(src).toMatch(
      /HrFeedbackImportDialog disabled=\{!canManageCandidateData \|\| headerLoading\}/,
    )
  })

  it('documents that FacetBadge stays disabled while headerLoading', () => {
    // FacetSidebar fields already respect isFilterTransitionPending, but the
    // badge that opens the mobile/tablet sheet must also refuse clicks until
    // deferred results settle — otherwise filters open on a lagging set.
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    const badge = readFileSync(
      path.join(process.cwd(), 'src/components/search/FacetBadge.tsx'),
      'utf8',
    )
    expect(badge).toMatch(/disabled\??:\s*boolean/)
    expect(page.match(/<FacetBadge[\s\S]*?disabled=\{headerLoading\}/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
