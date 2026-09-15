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
})
