import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useIndustryKeywords, CATEGORY_ORDER, CATEGORY_LABELS } from './useIndustryKeywords'

type ApiResult<T> = {
  data?: T
  error?: { message: string } | undefined
}

const mockGet = vi.hoisted(() => vi.fn(async (): Promise<ApiResult<unknown>> => ({
  data: { success: true },
  error: undefined,
})))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { GET: mockGet },
}))

vi.mock('@/lib/search-profile-sources', () => ({
  getSearchProfileCollectionSource: () => undefined,
}))

function mockIndustry(data: unknown[] = []): ApiResult<{ success: boolean; data: unknown[] }> {
  return { data: { success: true, data }, error: undefined }
}

function mockCustom(tags: unknown[] = [], systemLocations: unknown[] = []): ApiResult<{ success: boolean; tags: unknown[]; systemLocations: unknown[] }> {
  return { data: { success: true, tags, systemLocations }, error: undefined }
}

function mockBrands(data: unknown[] = []): ApiResult<{ success: boolean; data: unknown[] }> {
  return { data: { success: true, data }, error: undefined }
}

function mockProfiles(profiles: unknown[] = []): ApiResult<{ success: boolean; profiles: unknown[] }> {
  return { data: { success: true, profiles }, error: undefined }
}

function setupMocks(overrides: {
  industry?: ApiResult<{ success: boolean; data: unknown[] }>
  custom?: ApiResult<{ success: boolean; tags: unknown[]; systemLocations: unknown[] }>
  brands?: ApiResult<{ success: boolean; data: unknown[] }>
  profiles?: ApiResult<{ success: boolean; profiles: unknown[] }>
} = {}) {
  mockGet
    .mockResolvedValueOnce(overrides.industry ?? mockIndustry())
    .mockResolvedValueOnce(overrides.custom ?? mockCustom())
    .mockResolvedValueOnce(overrides.brands ?? mockBrands())
    .mockResolvedValueOnce(overrides.profiles ?? mockProfiles())
}

describe('useIndustryKeywords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts loading and transitions to loaded', async () => {
    setupMocks()

    const { result } = renderHook(() => useIndustryKeywords())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeNull()
  })

  it('sets error when industry endpoint fails', async () => {
    mockGet
      .mockResolvedValueOnce({ data: undefined, error: { message: 'fail' } } as ApiResult<unknown>)
      .mockResolvedValueOnce(mockCustom())
      .mockResolvedValueOnce(mockBrands())
      .mockResolvedValueOnce(mockProfiles())

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load industry keywords')
    })
    expect(result.current.keywords).toEqual([])
  })

  it('fetches and maps industry keywords', async () => {
    setupMocks({
      industry: mockIndustry([
        { id: 1, keyword: 'CNC', category: 'machining' },
        { id: 2, keyword: 'EDM', category: 'edm' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.keywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: 'CNC', category: 'machining' }),
        expect.objectContaining({ keyword: 'EDM', category: 'edm' }),
      ])
    )
  })

  it('filters custom keywords by visible flag', async () => {
    setupMocks({
      custom: mockCustom([
        { id: 'c1', keyword: 'Visible', category: 'custom', visible: true },
        { id: 'c2', keyword: 'Hidden', category: 'custom', visible: false },
        { id: 'c3', keyword: 'Default', category: 'custom' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const customKw = result.current.keywords.filter((k) => k.category === 'custom')
    expect(customKw).toHaveLength(2)
    expect(customKw.map((k) => k.keyword)).toContain('Visible')
    expect(customKw.map((k) => k.keyword)).toContain('Default')
    expect(customKw.map((k) => k.keyword)).not.toContain('Hidden')
  })

  it('maps system locations with category=location', async () => {
    setupMocks({
      custom: mockCustom([], [
        { id: 'loc1', keyword: 'Shanghai', level: 'city', visible: true },
        { id: 'loc2', keyword: 'Hidden City', level: 'city', visible: false },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const locations = result.current.keywords.filter((k) => k.category === 'location')
    expect(locations).toHaveLength(1)
    expect(locations[0].keyword).toBe('Shanghai')
  })

  it('maps brand keywords from nameCn', async () => {
    setupMocks({
      brands: mockBrands([
        { id: 100, nameCn: 'Haas', nameEn: 'Haas Automation', type: 'cnc', origin: 'US' },
        { id: 101, nameCn: '', nameEn: 'Empty', type: 'cnc', origin: 'US' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const brands = result.current.keywords.filter((k) => k.category === 'brand')
    expect(brands).toHaveLength(1)
    expect(brands[0]).toMatchObject({ keyword: 'Haas', english: 'Haas Automation', category: 'brand' })
  })

  it('deduplicates keywords within the same category', async () => {
    setupMocks({
      industry: mockIndustry([
        { id: 1, keyword: 'CNC', category: 'machining' },
        { id: 2, keyword: '  CNC  ', category: 'machining' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const cncKeywords = result.current.keywords.filter((k) => k.keyword.trim().toLowerCase() === 'cnc')
    expect(cncKeywords).toHaveLength(1)
  })

  it('grouped organizes keywords by category', async () => {
    setupMocks({
      industry: mockIndustry([
        { id: 1, keyword: 'CNC', category: 'machining' },
        { id: 2, keyword: 'Lathe', category: 'lathe' },
        { id: 3, keyword: 'Mill', category: 'machining' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.grouped.machining).toHaveLength(2)
    expect(result.current.grouped.lathe).toHaveLength(1)
    expect(result.current.grouped.edm).toHaveLength(0)
  })

  it('hotKeywords filters for seed items', async () => {
    setupMocks({
      custom: mockCustom([
        { id: 'seed-cnc', keyword: 'CNC Hot', category: 'custom', visible: true, source: 'system' },
        { id: 'c2', keyword: 'Not Hot', category: 'custom', visible: true, source: 'workspace' },
      ]),
    })

    const { result } = renderHook(() => useIndustryKeywords())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.hotKeywords).toHaveLength(1)
    expect(result.current.hotKeywords[0].keyword).toBe('CNC Hot')
  })

  it('CATEGORY_ORDER has all categories', () => {
    expect(CATEGORY_ORDER).toEqual([
      'machining', 'lathe', 'edm', 'measurement', 'smt', '3d_printing',
      'location', 'brand', 'custom',
    ])
  })

  it('CATEGORY_LABELS has labels for all categories', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })
})
