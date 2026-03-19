import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseUrlSearchState, useUrlSearchState, type UrlSearchState } from './useUrlSearchState'

const { useSearchParamsMock, setSearchParamsMock } = vi.hoisted(() => ({
  useSearchParamsMock: vi.fn(),
  setSearchParamsMock: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useSearchParams: () => useSearchParamsMock(),
}))

describe('useUrlSearchState location parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves spaced locations as a single location token', () => {
    const state = parseUrlSearchState(new URLSearchParams('location=Kuala+Lumpur+MY'))

    expect(state.location).toBe('Kuala Lumpur MY')
    expect(state.filters.locations).toEqual(['Kuala Lumpur MY'])
  })

  it('parses canonical quoted OR phrase queries without flattening phrases', () => {
    const state = parseUrlSearchState(
      new URLSearchParams('location=Kuala+Lumpur+MY&keyword=%22Sales+Engineer%22+OR+%22Sales+Manager%22')
    )

    expect(state.location).toBe('Kuala Lumpur MY')
    expect(state.filters.locations).toEqual(['Kuala Lumpur MY'])
    expect(state.keywords).toEqual(['Sales Engineer', 'Sales Manager'])
  })

  it('keeps legacy whitespace keyword queries backward compatible', () => {
    const state = parseUrlSearchState(new URLSearchParams('keyword=CNC+%E9%94%80%E5%94%AE'))

    expect(state.keywords).toEqual(['CNC', '销售'])
  })

  it('serializes canonical OR phrase queries when syncing to the URL', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer', 'Sales Manager'],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {
        locations: ['Kuala Lumpur MY'],
      },
    }

    result.current.syncToUrl(nextState)

    expect(setSearchParamsMock).toHaveBeenCalledTimes(1)
    const [updater, options] = setSearchParamsMock.mock.calls[0] ?? []
    expect(options).toEqual({ replace: true })
    expect(typeof updater).toBe('function')

    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('location')).toBe('Kuala Lumpur MY')
    expect(updatedParams.get('keyword')).toBe('"Sales Engineer" OR "Sales Manager"')
  })
})
