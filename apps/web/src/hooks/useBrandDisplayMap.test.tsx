import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { BrandDisplayMapProvider, useBrandDisplayMapResolve } from '@/contexts/BrandDisplayMapContext'
import { useBrandDisplayMap } from './useBrandDisplayMap'

type BrandEntry = { displayName: string; zhHans: string }
type BrandDisplayResponse = { data: Record<string, BrandEntry> | null }

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn<(...args: unknown[]) => Promise<BrandDisplayResponse>>(async () => ({ data: null })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'test' }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <BrandDisplayMapProvider>{children}</BrandDisplayMapProvider>
}

describe('useBrandDisplayMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns resolve function immediately', () => {
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    expect(typeof result.current.resolve).toBe('function')
  })

  it('fetches brand display map via provider', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    renderHook(() => useBrandDisplayMap(), { wrapper })

    await act(async () => {})
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/industry/brand-display-map')
  })

  it('resolve returns zhHans for known brand', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('耐克')
  })

  it('resolve returns uppercase brandId for unknown brand', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('adidas')).toBe('ADIDAS')
  })

  it('resolve returns empty string for empty brandId', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: {} })
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('')).toBe('')
    expect(result.current.resolve('  ')).toBe('')
  })

  it('resolve handles null data from API', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: null })
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('NIKE')
  })

  it('resolve handles API error gracefully', async () => {
    mockApiClient.GET.mockRejectedValueOnce(new Error('network'))
    const { result } = renderHook(() => useBrandDisplayMap(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('NIKE')
  })

  it('only makes one fetch regardless of how many hooks consume it', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    renderHook(
      () => ({
        a: useBrandDisplayMap(),
        b: useBrandDisplayMap(),
        c: useBrandDisplayMap(),
      }),
      { wrapper },
    )
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
  })
})

describe('useBrandDisplayMapResolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('works directly with provider', async () => {
    mockApiClient.GET.mockResolvedValueOnce({
      data: { nike: { displayName: 'Nike', zhHans: '耐克' } },
    })
    const { result } = renderHook(() => useBrandDisplayMapResolve(), { wrapper })
    await act(async () => {})

    expect(result.current.resolve('nike')).toBe('耐克')
  })
})
