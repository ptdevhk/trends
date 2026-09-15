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
})
