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

  it('documents that BulkActionBar status chips gate on resultsLoading', () => {
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/BulkActionBar.tsx'),
      'utf8',
    )
    // Status chips mutate filters; they must share the resultsLoading gate with
    // select/export actions so deferred lag cannot apply a status toggle mid-load.
    expect(bar).toMatch(/disabled=\{resultsLoading\}/)
    expect(bar).toMatch(/onStatusToggle/)
  })

  it('documents that company-policy toggle shares the resultsLoading gate', () => {
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/BulkActionBar.tsx'),
      'utf8',
    )
    const toggle = readFileSync(
      path.join(process.cwd(), 'src/components/CompanyPolicyHiddenToggle.tsx'),
      'utf8',
    )
    expect(toggle).toMatch(/disabled\??:\s*boolean/)
    expect(bar).toMatch(/CompanyPolicyHiddenToggle[\s\S]*disabled=\{resultsLoading\}/)
  })

  it('documents that search clear controls gate on loading', () => {
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/search/GoogleSearchBar.tsx'),
      'utf8',
    )
    const header = readFileSync(
      path.join(process.cwd(), 'src/components/search/SearchHeader.tsx'),
      'utf8',
    )
    // Clear/JD paste remutate the query while deferred results lag; keep them
    // closed until loading clears, matching the submit button gate.
    expect(bar.match(/disabled=\{loading\}/g)?.length).toBeGreaterThanOrEqual(3)
    expect(header).toMatch(
      /aria-label=\{t\('resumes\.searchPage\.header\.clearJobDescription'[\s\S]{0,400}?disabled=\{loading\}/,
    )
  })

  it('documents that recent-search listbox and copy-link gate on loading', () => {
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/search/GoogleSearchBar.tsx'),
      'utf8',
    )
    const header = readFileSync(
      path.join(process.cwd(), 'src/components/search/SearchHeader.tsx'),
      'utf8',
    )
    expect(bar).toMatch(/isListboxOpen\s*=\s*focused\s*&&\s*!jdPopoverOpen\s*&&\s*!loading/)
    expect(header).toMatch(
      /disabled=\{loading\}[\s\S]{0,300}?aria-label=\{t\('resumes\.searchPage\.header\.copyLink'/,
    )
  })

  it('documents that submit and escape-clear gate on loading', () => {
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/search/GoogleSearchBar.tsx'),
      'utf8',
    )
    // Enter can still submit a form whose submit button is disabled; Escape
    // still remutates via onChange('') — both must share the loading gate.
    expect(bar).toMatch(/if\s*\(\s*isComposing\s*\|\|\s*loading\s*\)/)
    expect(bar).toMatch(/trimmedValue\s*&&\s*!loading/)
  })

  it('documents that MobileFilterSheet auto-closes while headerLoading', () => {
    // FacetBadge refuses new opens during headerLoading, but an already-open
    // sheet must also close so filter toggles cannot race deferred results.
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    expect(page).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*headerLoading\s*\)\s*\{[\s\S]*?setFiltersOpen\(false\)/,
    )
  })

  it('documents that AnalysisTaskMonitor stays disabled while headerLoading', () => {
    // Opening the history dialog mid deferred-lag is fine UX-wise, but cancel
    // and other actions from an unsettled search context should wait — gate the
    // trigger the same way as ShareLink / Analyze.
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/ResumeSearchPage.tsx'),
      'utf8',
    )
    const monitor = readFileSync(
      path.join(process.cwd(), 'src/components/AnalysisTaskMonitor.tsx'),
      'utf8',
    )
    expect(monitor).toMatch(/disabled\??:\s*boolean/)
    expect(monitor).toMatch(/disabled=\{disabled\}/)
    expect(page).toMatch(/<AnalysisTaskMonitor\s+disabled=\{headerLoading\}\s*\/>/)
  })

  it('documents that PublicShare FacetBadge and sheet share the resultsLoading gate', () => {
    // Public share loads resume docs asynchronously; filter opens must match
    // ResumeSearchPage headerLoading parity so toggles cannot race docs===undefined.
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/PublicSharePage.tsx'),
      'utf8',
    )
    expect(page).toMatch(/const resultsLoading = docs === undefined/)
    expect(page).toMatch(/isFilterTransitionPending:\s*resultsLoading/)
    expect(page.match(/<FacetBadge[\s\S]*?disabled=\{resultsLoading\}/g)?.length).toBeGreaterThanOrEqual(2)
    expect(page).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*resultsLoading\s*\)\s*\{[\s\S]*?setFiltersOpen\(false\)/,
    )
    expect(page).toMatch(/resultsLoading=\{resultsLoading\}/)
  })

  it('documents that PublicShare ShareLink stays disabled while resultsLoading', () => {
    const page = readFileSync(
      path.join(process.cwd(), 'src/pages/PublicSharePage.tsx'),
      'utf8',
    )
    expect(page).toMatch(
      /<ShareLinkButton[\s\S]*?disabled=\{resultsLoading\}/,
    )
  })

  it('documents that GoogleSearchBar skips prefetch while loading', () => {
    // Prefetching the draft query while a search is already in flight races the
    // deferred result set; keep preload closed until loading clears.
    const bar = readFileSync(
      path.join(process.cwd(), 'src/components/search/GoogleSearchBar.tsx'),
      'utf8',
    )
    expect(bar).toMatch(/useSearchPreload\(trimmedValue,\s*prefetchSearch\s*&&\s*!loading\)/)
  })

  it('documents that SearchHero ModeToggle and remutators gate on loading', () => {
    const hero = readFileSync(
      path.join(process.cwd(), 'src/components/search/SearchHero.tsx'),
      'utf8',
    )
    expect(hero).toMatch(/aiStats=\{loading \? undefined : aiModeStats\}/)
    expect(hero).toMatch(/disabled=\{loading\}/)
    expect(hero.match(/disabled=\{loading\}/g)?.length).toBeGreaterThanOrEqual(3)
  })
})
