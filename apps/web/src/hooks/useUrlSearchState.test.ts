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
      new URLSearchParams('location=Kuala+Lumpur+MY&q=%22Sales+Engineer%22+OR+%22Sales+Manager%22')
    )

    expect(state.query).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(state.location).toBe('Kuala Lumpur MY')
    expect(state.filters.locations).toEqual(['Kuala Lumpur MY'])
    expect(state.keywords).toEqual(['Sales Engineer', 'Sales Manager'])
  })

  it('keeps legacy whitespace keyword queries backward compatible', () => {
    const state = parseUrlSearchState(new URLSearchParams('keyword=CNC+%E9%94%80%E5%94%AE'))

    expect(state.query).toBe('CNC 销售')
    expect(state.keywords).toEqual(['CNC', '销售'])
  })

  it('parses required keywords from rkw param', () => {
    const state = parseUrlSearchState(
      new URLSearchParams('keyword=%22Sales+Engineer%22+OR+%22Sales+Manager%22&rkw=CNC%2Cmachine+tools')
    )

    expect(state.keywords).toEqual(['Sales Engineer', 'Sales Manager'])
    expect(state.requiredKeywords).toEqual(['CNC', 'machine tools'])
  })

  it('parses sid without treating it as explicit URL search state', () => {
    const state = parseUrlSearchState(new URLSearchParams('sid=session-share-1'))

    expect(state.shareSessionId).toBe('session-share-1')
  })

  it('serializes canonical OR phrase queries when syncing to the URL', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      query: '"Sales Engineer" OR "Sales Manager"',
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer', 'Sales Manager'],
      requiredKeywords: [],
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
    expect(updatedParams.get('q')).toBe('"Sales Engineer" OR "Sales Manager"')
    expect(updatedParams.get('rkw')).toBeNull()
  })

  it('serializes required keywords into rkw param', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      query: '"Sales Engineer" OR "Sales Manager"',
      location: 'Kuala Lumpur MY',
      keywords: ['Sales Engineer', 'Sales Manager'],
      requiredKeywords: ['CNC', 'machine tools'],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {},
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('rkw')).toBe('CNC,machine tools')
  })

  it('removes sid when syncing explicit state back into the URL', () => {
    const currentParams = new URLSearchParams('sid=session-share-1')
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      shareSessionId: 'session-share-1',
      query: 'CNC',
      location: 'Dongguan',
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedExperienceLevel: undefined,
      filters: {},
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams
    expect(updatedParams.get('sid')).toBeNull()
    expect(updatedParams.get('location')).toBe('Dongguan')
    expect(updatedParams.get('q')).toBe('CNC')
  })
})
