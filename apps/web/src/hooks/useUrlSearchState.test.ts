import { describe, expect, it } from 'vitest'

import { parseUrlSearchState } from './useUrlSearchState'

describe('useUrlSearchState location parsing', () => {
  it('preserves spaced locations as a single location token', () => {
    const state = parseUrlSearchState(new URLSearchParams('location=Kuala+Lumpur+MY'))

    expect(state.location).toBe('Kuala Lumpur MY')
    expect(state.filters.locations).toEqual(['Kuala Lumpur MY'])
  })
})
