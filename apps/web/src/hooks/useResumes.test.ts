import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useResumes } from './useResumes'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({ data: { success: true, data: [], samples: [] } })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

describe('useResumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches resumes and samples on mount by default', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, data: [], samples: [{ name: 'default', count: 0 }] },
    })
    const { result } = renderHook(() => useResumes())
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/samples')
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes', expect.any(Object))
    expect(result.current.selectedSample).toBe('default')
  })

  it('does not fetch resumes when autoFetch is false', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, data: [], samples: [] },
    })
    const { result } = renderHook(() => useResumes({ autoFetch: false }))
    await act(async () => {})

    // Only samples call, not resumes
    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/samples')
  })

  it('does not load samples when loadSamples is false', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, data: [] },
    })
    renderHook(() => useResumes({ loadSamples: false }))
    await act(async () => {})

    expect(mockApiClient.GET).not.toHaveBeenCalledWith('/api/resumes/samples')
  })

  it('sets error when samples fetch fails', async () => {
    mockApiClient.GET.mockResolvedValueOnce({ data: { success: false } })
    const { result } = renderHook(() => useResumes({ autoFetch: false }))
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load resume samples')
  })

  it('sets error when resumes fetch fails', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce({ data: { success: true, samples: [] } })
      .mockResolvedValueOnce({ data: { success: false } })
    const { result } = renderHook(() => useResumes())
    await act(async () => {})

    expect(result.current.error).toBe('Failed to load resume data')
  })

  it('setQuery and setFilter update state', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, data: [], samples: [] },
    })
    const { result } = renderHook(() => useResumes({ autoFetch: false }))
    await act(async () => {})

    act(() => {
      result.current.setQuery('test query')
    })
    expect(result.current.query).toBe('test query')

    act(() => {
      result.current.setFilters({ minExperience: 3 })
    })
    expect(result.current.filters.minExperience).toBe(3)
  })

  it('passes limit to API', async () => {
    mockApiClient.GET.mockResolvedValue({
      data: { success: true, data: [], samples: [] },
    })
    renderHook(() => useResumes({ limit: 50 }))
    await act(async () => {})

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes', {
      params: {
        query: expect.objectContaining({ limit: 50 }),
      },
    })
  })
})
