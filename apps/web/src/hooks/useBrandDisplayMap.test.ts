import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useBrandDisplayMap } from './useBrandDisplayMap'

type BrandEntry = { displayName: string; zhHans: string }
type BrandDisplayResponse = { data: Record<string, BrandEntry> | null }

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn<(...args: unknown[]) => Promise<BrandDisplayResponse>>(async () => ({ data: null })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useBrandDisplayMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns resolve function immediately', () => {
    const { result } = renderHook(() => useBrandDisplayMap(false))
    expect(typeof result.current.resolve).toBe('function')
  })

  it('does not fetch when disabled', () => {
    renderHook(() => useBrandDisplayMap(false))
    expect(mockApiClient.GET).not.toHaveBeenCalled()
  })

  it('fetches brand display map when enabled', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    renderHook(() => useBrandDisplayMap(true))

    await act(async () => {})
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/industry/brand-display-map')
  })

  it('resolve returns zhHans for known brand', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    const { result } = renderHook(() => useBrandDisplayMap(true))
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('耐克')
  })

  it('resolve returns uppercase brandId for unknown brand', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    const { result } = renderHook(() => useBrandDisplayMap(true))
    await act(async () => {})

    expect(result.current.resolve('adidas')).toBe('ADIDAS')
  })

  it('resolve returns empty string for empty brandId', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: {} })
    const { result } = renderHook(() => useBrandDisplayMap(true))
    await act(async () => {})

    expect(result.current.resolve('')).toBe('')
    expect(result.current.resolve('  ')).toBe('')
  })

  it('resolve handles null data from API', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: null })
    const { result } = renderHook(() => useBrandDisplayMap(true))
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('NIKE')
  })

  it('resolve handles API error gracefully', async () => {
    mockApiClient.GET.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useBrandDisplayMap(true))
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('NIKE')
  })
})
