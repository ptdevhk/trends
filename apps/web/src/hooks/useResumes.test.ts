import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useResumes } from './useResumes'

const mockApiClient = vi.hoisted(() => ({
  GET: vi.fn(async () => ({
    data: { success: true },
    error: undefined,
  })),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: mockApiClient,
}))

function mockSamplesResponse(samples: Array<{ name: string; displayName?: string }> = []) {
  return {
    data: { success: true, samples },
    error: undefined,
  }
}

function mockResumesResponse(opts: { resumes?: unknown[]; summary?: unknown; sample?: { name: string } } = {}) {
  return {
    data: {
      success: true,
      data: opts.resumes ?? [],
      summary: opts.summary ?? null,
      sample: opts.sample,
    },
    error: undefined,
  }
}

describe('useResumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('auto-fetches resumes and samples on mount', async () => {
    // refresh may fire twice (initial + when selectedSample updates from samples load)
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse([{ name: 'dev-51job' }]))
      .mockResolvedValue(mockResumesResponse({ resumes: [{ id: 'r1' }] }))

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.samples).toEqual([{ name: 'dev-51job' }])
    })
    await waitFor(() => {
      expect(result.current.resumes.length).toBeGreaterThan(0)
    })

    expect(result.current.selectedSample).toBe('dev-51job')
    expect(result.current.resumes).toEqual([{ id: 'r1' }])
  })

  it('does not fetch resumes when autoFetch is false', async () => {
    mockApiClient.GET.mockResolvedValueOnce(mockSamplesResponse())

    const { result } = renderHook(() => useResumes({ autoFetch: false }))

    await waitFor(() => {
      expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
    })

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes/samples')
    expect(result.current.resumes).toEqual([])
  })

  it('does not load samples when loadSamples is false', async () => {
    mockApiClient.GET.mockResolvedValueOnce(mockResumesResponse())

    const { result } = renderHook(() => useResumes({ loadSamples: false }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApiClient.GET).toHaveBeenCalledTimes(1)
    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes', expect.anything())
    expect(result.current.samples).toEqual([])
    expect(result.current.selectedSample).toBe('')
  })

  it('reloadSamples sets error on API failure', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce({ data: undefined, error: { message: 'fail' } })
      .mockResolvedValue(mockResumesResponse())

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load resume samples')
    })
  })

  it('reloadSamples auto-selects first sample', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse([{ name: 'alpha' }, { name: 'beta' }]))
      .mockResolvedValue(mockResumesResponse())

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.selectedSample).toBe('alpha')
    })
  })

  it('refresh fetches resumes with correct query params', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse())
      .mockResolvedValue(mockResumesResponse({ resumes: [{ id: 'r1' }], summary: { total: 1 } }))

    const { result } = renderHook(() => useResumes({ limit: 50, sessionId: 's1', jobDescriptionId: 'jd1' }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApiClient.GET).toHaveBeenCalledWith('/api/resumes', {
      params: {
        query: expect.objectContaining({
          limit: 50,
          sessionId: 's1',
          jobDescriptionId: 'jd1',
        }),
      },
    })
  })

  it('refresh serializes array filters', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse())
      .mockResolvedValue(mockResumesResponse())

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    mockApiClient.GET.mockClear()
    mockApiClient.GET.mockResolvedValue(mockResumesResponse())

    act(() => {
      result.current.setFilters({
        education: ['bachelor', 'master'],
        skills: ['react', 'ts'],
        locations: ['shanghai'],
        recommendation: ['strong_yes'],
      })
    })

    await waitFor(() => {
      expect(mockApiClient.GET).toHaveBeenCalled()
    })

    const lastCall = mockApiClient.GET.mock.calls.at(-1)!
    expect(lastCall[0]).toBe('/api/resumes')
    const query = (lastCall[1] as { params: { query: Record<string, string> } }).params.query
    expect(query.education).toBe('bachelor,master')
    expect(query.skills).toBe('react,ts')
    expect(query.locations).toBe('shanghai')
    expect(query.recommendation).toBe('strong_yes')
  })

  it('refresh sets error on API failure', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse())
      .mockResolvedValueOnce({ data: undefined, error: { message: 'fail' } })
      .mockResolvedValue({ data: undefined, error: { message: 'fail' } })

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load resume data')
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.summary).toBeNull()
  })

  it('refresh updates selectedSample from API response', async () => {
    mockApiClient.GET
      .mockResolvedValueOnce(mockSamplesResponse([{ name: 'original' }]))
      .mockResolvedValue(mockResumesResponse({ sample: { name: 'from-api' } }))

    const { result } = renderHook(() => useResumes())

    await waitFor(() => {
      expect(result.current.selectedSample).toBe('from-api')
    })
  })

  it('reloadSamples clears samples when loadSamples is false', async () => {
    mockApiClient.GET.mockResolvedValue(mockResumesResponse())

    const { result } = renderHook(() => useResumes({ loadSamples: false }))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.reloadSamples()
    })

    expect(result.current.samples).toEqual([])
    expect(result.current.selectedSample).toBe('')
  })
})
