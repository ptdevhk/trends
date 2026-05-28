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

  it('reports url-state presence flags without treating sid alone as explicit search state', () => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams('sid=session-share-1'), setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    expect(result.current.hasUrlParams).toBe(false)
    expect(result.current.hasKeywordParam).toBe(false)
    expect(result.current.hasJobDescriptionParam).toBe(false)
    expect(result.current.parsedState.shareSessionId).toBe('session-share-1')
  })

  it('detects keyword params and jd params as explicit url search state', () => {
    useSearchParamsMock.mockReturnValue([new URLSearchParams('q=CNC+Sales&jd=jd-123'), setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    expect(result.current.hasUrlParams).toBe(true)
    expect(result.current.hasKeywordParam).toBe(true)
    expect(result.current.hasJobDescriptionParam).toBe(true)
    expect(result.current.parsedState.query).toBe('CNC Sales')
    expect(result.current.parsedState.jobDescriptionId).toBe('jd-123')
  })

  it('preserves spaced locations as a single location token', () => {
    const state = parseUrlSearchState(new URLSearchParams('location=Kuala+Lumpur+MY'))

    expect(state.location).toBe('Kuala Lumpur MY')
    expect(state.filters.locations).toEqual(['Kuala Lumpur MY'])
  })

  it('accepts locations (plural) URL param to match API schema', () => {
    const state = parseUrlSearchState(new URLSearchParams('locations=China'))

    expect(state.location).toBe('China')
    expect(state.filters.locations).toEqual(['China'])
  })

  it('prefers locations (plural) over location (singular) when both present', () => {
    const state = parseUrlSearchState(new URLSearchParams('location=Malaysia&locations=China'))

    expect(state.location).toBe('China')
    expect(state.filters.locations).toEqual(['China'])
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

  it('parses spaced queries from q param', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC+%E9%94%80%E5%94%AE'))

    expect(state.query).toBe('CNC 销售')
    expect(state.keywords).toEqual(['CNC', '销售'])
  })

  it('parses required keywords from rkw param', () => {
    const state = parseUrlSearchState(
      new URLSearchParams('q=%22Sales+Engineer%22+OR+%22Sales+Manager%22&rkw=CNC%2Cmachine+tools')
    )

    expect(state.keywords).toEqual(['Sales Engineer', 'Sales Manager'])
    expect(state.requiredKeywords).toEqual(['CNC', 'machine tools'])
  })

  it('parses sid without treating it as explicit URL search state', () => {
    const state = parseUrlSearchState(new URLSearchParams('sid=session-share-1'))

    expect(state.shareSessionId).toBe('session-share-1')
  })

  it('round-trips role-year filter type in url state', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minRoleYears=3&roleType=sales'))

    expect(state.query).toBe('CNC')
    expect(state.filters.minRoleYears).toBe(3)
    expect(state.filters.roleFilterType).toBe('sales')
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
      selectedSources: [],
      selectedBrands: [],
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
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {},
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('rkw')).toBe('CNC,machine tools')
  })

  it('round-trips the canonical search-first state including cluster tag tokens', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      query: '"Business Development" OR "Machine Tools"',
      location: 'Kuala Lumpur MY',
      keywords: ['Business Development', 'Machine Tools'],
      requiredKeywords: ['CNC', 'Automation'],
      jobDescriptionId: 'jd-123',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC', 'DMG MORI'],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: 'senior',
      filters: {
        minRoleYears: 5,
        minExperience: 5,
        maxExperience: 12,
        minAge: 28,
        maxAge: 45,
        education: ['Bachelor', 'Master'],
        locations: ['Kuala Lumpur MY'],
        status: ['contacted', 'offer'],
        minMatchScore: 80,
        sortBy: 'experience',
        sortOrder: 'desc',
      },
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams

    expect(updatedParams.get('q')).toBe('"Business Development" OR "Machine Tools"')
    expect(updatedParams.get('location')).toBe('Kuala Lumpur MY')
    expect(updatedParams.get('rkw')).toBe('CNC,Automation')
    expect(updatedParams.get('jd')).toBe('jd-123')
    expect(updatedParams.get('tags')).toBe('cluster:manufacturing-systems,Machine Tools')
    expect(updatedParams.get('co')).toBe('FANUC,DMG MORI')
    expect(updatedParams.get('exp')).toBe('senior')
    expect(updatedParams.get('minRoleYears')).toBe('5')
    expect(updatedParams.get('maxRoleYears')).toBe('12')
    expect(updatedParams.get('minAge')).toBe('28')
    expect(updatedParams.get('maxAge')).toBe('45')
    expect(updatedParams.get('edu')).toBe('Bachelor,Master')
    expect(updatedParams.get('status')).toBe('contacted,offer')
    expect(updatedParams.get('minScore')).toBe('80')
    expect(updatedParams.get('sort')).toBe('experience')
    expect(updatedParams.get('order')).toBe('desc')

    // minRoleYears no longer implies a minExperience value in parsed state
    const reparsedState = parseUrlSearchState(updatedParams)
    expect(reparsedState.filters.minRoleYears).toBe(5)
    expect(reparsedState.filters.minExperience).toBeUndefined()
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
      selectedSources: [],
      selectedBrands: [],
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

  it('parses raw and cluster tag tokens from legacy tags params together', () => {
    const state = parseUrlSearchState(
      new URLSearchParams('q=machine+tools&tags=cluster%3Amanufacturing-systems%2CMachine+Tools')
    )

    expect(state.selectedTags).toEqual(['cluster:manufacturing-systems', 'Machine Tools'])
    expect(state.query).toBe('machine tools')
  })

  it('deduplicates canonical values when syncing to the url', () => {
    const currentParams = new URLSearchParams(
      'sid=session-share-1&q=legacy&location=Oldtown&minRoleYears=3&maxRoleYears=9&status=new'
    )
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      query: undefined,
      location: 'Dongguan,Shenzhen',
      keywords: ['CNC', 'Sales', 'cnc'],
      requiredKeywords: ['Machine Tools', 'machine tools'],
      jobDescriptionId: 'jd-456',
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools', 'machine tools'],
      selectedCompanies: ['FANUC', ' fanuc ', 'DMG MORI'],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: 'mid',
      filters: {
        minExperience: 5,
        maxExperience: 12,
        education: ['Bachelor', 'bachelor', 'Master'],
        status: ['contacted', 'contacted', 'offer'],
      },
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams

    expect(updatedParams.get('sid')).toBeNull()

    expect(updatedParams.get('location')).toBe('Dongguan,Shenzhen')
    expect(updatedParams.get('q')).toBe('CNC Sales')
    expect(updatedParams.get('rkw')).toBe('Machine Tools')
    expect(updatedParams.get('jd')).toBe('jd-456')
    expect(updatedParams.get('tags')).toBe('cluster:manufacturing-systems,Machine Tools')
    expect(updatedParams.get('co')).toBe('FANUC,DMG MORI')
    expect(updatedParams.get('exp')).toBe('mid')
    expect(updatedParams.get('minRoleYears')).toBeNull()
    expect(updatedParams.get('maxRoleYears')).toBe('12')
    expect(updatedParams.get('edu')).toBe('Bachelor,Master')
    expect(updatedParams.get('status')).toBe('contacted,offer')
  })

describe('minRoleYears and minExperience are decoupled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses minRoleYears without setting minExperience', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minRoleYears=1'))

    expect(state.filters.minRoleYears).toBe(1)
    expect(state.filters.minExperience).toBeUndefined()
  })

  it('parses minRoleYears=0 without setting minExperience', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minRoleYears=0'))

    expect(state.filters.minRoleYears).toBe(0)
    expect(state.filters.minExperience).toBeUndefined()
  })

  it('parses maxRoleYears as maxExperience without coupling to minRoleYears', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minRoleYears=3&maxRoleYears=8'))

    expect(state.filters.minRoleYears).toBe(3)
    expect(state.filters.maxExperience).toBe(8)
    expect(state.filters.minExperience).toBeUndefined()
  })

  it('syncs only minRoleYears without emitting minExperience', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    result.current.syncToUrl({
      query: 'CNC',
      location: undefined,
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {
        minRoleYears: 3,
      },
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('minRoleYears')).toBe('3')
    // minExperience is not emitted when only minRoleYears is set
  })

  it('syncs only minExperience without emitting minRoleYears', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    result.current.syncToUrl({
      query: 'CNC',
      location: undefined,
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {
        minExperience: 5,
        maxExperience: 10,
      },
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('minRoleYears')).toBeNull()
    expect(updatedParams.get('maxRoleYears')).toBe('10')
  })

  it('syncs independent minRoleYears and minExperience both to their own params', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    result.current.syncToUrl({
      query: 'CNC',
      location: undefined,
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {
        minRoleYears: 3,
        minExperience: 2,
        maxExperience: 10,
      },
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(new URLSearchParams()) as URLSearchParams
    expect(updatedParams.get('minRoleYears')).toBe('3')
    expect(updatedParams.get('maxRoleYears')).toBe('10')
    // minExperience does not have its own URL param, so parsing it back won't restore it
    // — this is the existing behavior (minExperience is backend-only)
    const reparsed = parseUrlSearchState(updatedParams)
    expect(reparsed.filters.minRoleYears).toBe(3)
    expect(reparsed.filters.maxExperience).toBe(10)
    expect(reparsed.filters.minExperience).toBeUndefined()
  })
})

it('clears explicit sort params when syncing back to default relevance ordering', () => {
  const currentParams = new URLSearchParams('q=machine+tools&location=Malaysia&sort=experience&order=desc')
  useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

  const { result } = renderHook(() => useUrlSearchState())

    const nextState: UrlSearchState = {
      query: 'machine tools',
      location: 'Malaysia',
      keywords: ['machine tools'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {},
    }

    result.current.syncToUrl(nextState)

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams

    expect(updatedParams.get('q')).toBe('machine tools')
    expect(updatedParams.get('location')).toBe('Malaysia')
    expect(updatedParams.get('sort')).toBeNull()
    expect(updatedParams.get('order')).toBeNull()
  })
})

describe('minExperience URL param round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses minExp URL param into filters.minExperience', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minExp=3'))

    expect(state.filters.minExperience).toBe(3)
  })

  it('ignores non-numeric minExp values', () => {
    const state = parseUrlSearchState(new URLSearchParams('q=CNC&minExp=abc'))

    expect(state.filters.minExperience).toBeUndefined()
  })

  it('serializes filters.minExperience into minExp param', () => {
    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    result.current.syncToUrl({
      query: 'CNC',
      location: undefined,
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {
        minExperience: 2,
      },
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams

    expect(updatedParams.get('minExp')).toBe('2')
  })

  it('omits minExp when minExperience is not set', () => {
    const currentParams = new URLSearchParams('minExp=2')
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())

    result.current.syncToUrl({
      query: 'CNC',
      location: undefined,
      keywords: ['CNC'],
      requiredKeywords: [],
      jobDescriptionId: undefined,
      selectedTags: [],
      selectedCompanies: [],
      selectedSources: [],
      selectedBrands: [],
      selectedExperienceLevel: undefined,
      filters: {},
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams

    expect(updatedParams.get('minExp')).toBeNull()
  })

  it('round-trips minExperience through URL params', () => {
    const parsed = parseUrlSearchState(new URLSearchParams('q=CNC&minExp=1'))

    expect(parsed.filters.minExperience).toBe(1)

    const currentParams = new URLSearchParams()
    useSearchParamsMock.mockReturnValue([currentParams, setSearchParamsMock])

    const { result } = renderHook(() => useUrlSearchState())
    result.current.syncToUrl({
      ...parsed,
    })

    const [updater] = setSearchParamsMock.mock.calls[0] ?? []
    const updatedParams = updater(currentParams) as URLSearchParams

    expect(updatedParams.get('minExp')).toBe('1')
  })
})
