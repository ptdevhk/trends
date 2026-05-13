import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import { useAiSearchSummary } from './useAiSearchSummary'

const mockPost = vi.hoisted(() => vi.fn(async () => ({
  data: { success: true, summary: 'AI summary', generatedAt: 1000 },
  error: undefined,
})))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { POST: mockPost },
}))

function makeResult(overrides: Partial<ResumeSearchResultItem> = {}): ResumeSearchResultItem {
  return {
    key: 'k1',
    identityKey: 'ik1',
    blocked: false,
    status: 'new',
    score: 0.9,
    resume: {
      resumeId: 'r1',
      name: 'Alice',
      location: 'Shanghai',
      selfIntro: 'Senior engineer',
      workHistory: [{ jobTitle: 'Dev', raw: 'Worked on stuff' }],
      jobIntention: 'Looking for role',
      ingestData: { industryTags: ['tech', 'ai'] },
    } as unknown as ResumeSearchResultItem['resume'],
    ...overrides,
  }
}

const baseArgs = {
  enabled: true,
  query: 'react developer',
  results: [makeResult()],
  selectedCompanies: [],
  selectedTags: [],
}

describe('useAiSearchSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not fetch when disabled', async () => {
    renderHook(() => useAiSearchSummary({ ...baseArgs, enabled: false }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockPost).not.toHaveBeenCalled()
  })

  it('does not fetch when query is empty', async () => {
    renderHook(() => useAiSearchSummary({ ...baseArgs, query: '  ' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockPost).not.toHaveBeenCalled()
  })

  it('does not fetch when results are empty', async () => {
    renderHook(() => useAiSearchSummary({ ...baseArgs, results: [] }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mockPost).not.toHaveBeenCalled()
  })

  it('debounces 2 seconds before fetching', async () => {
    renderHook(() => useAiSearchSummary(baseArgs))

    // before debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(mockPost).not.toHaveBeenCalled()

    // after debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('POSTs correct payload shape', async () => {
    renderHook(() => useAiSearchSummary({
      ...baseArgs,
      jobDescriptionId: 'jd-1',
      location: 'Shanghai',
      selectedCompanies: ['Google'],
      selectedTags: ['senior'],
      selectedExperienceLevel: 'senior',
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(mockPost).toHaveBeenCalledWith('/api/resumes/search-summary', {
      body: expect.objectContaining({
        query: 'react developer',
        location: 'Shanghai',
        jobDescriptionId: 'jd-1',
        facets: {
          selectedTags: ['senior'],
          selectedCompanies: ['Google'],
          selectedExperienceLevel: 'senior',
        },
        resultCount: 1,
        forceRefresh: false,
        results: expect.arrayContaining([
          expect.objectContaining({
            id: 'r1',
            name: 'Alice',
            keywords: ['tech', 'ai'],
            snippet: 'Senior engineer',
          }),
        ]),
      }),
    })
  })

  it('sets summary and generatedAt on success', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, summary: 'Great candidates', generatedAt: 42 },
      error: undefined,
    })

    const { result } = renderHook(() => useAiSearchSummary(baseArgs))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(result.current.summary).toBe('Great candidates')
    expect(result.current.generatedAt).toBe(42)
    expect(result.current.loading).toBe(false)
  })

  it('handles error response', async () => {
    mockPost.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'fail' },
    })

    const { result } = renderHook(() => useAiSearchSummary(baseArgs))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    expect(result.current.summary).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it('shouldRefresh triggers re-request with forceRefresh=true', async () => {
    mockPost
      .mockResolvedValueOnce({
        data: { success: true, summary: 'partial', shouldRefresh: true },
        error: undefined,
      })
      .mockResolvedValueOnce({
        data: { success: true, summary: 'full', generatedAt: 99 },
        error: undefined,
      })

    const { result } = renderHook(() => useAiSearchSummary(baseArgs))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    // both calls happen — first forceRefresh=false, then forceRefresh=true
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[0][1].body.forceRefresh).toBe(false)
    expect(mockPost.mock.calls[1][1].body.forceRefresh).toBe(true)
    expect(result.current.summary).toBe('full')
    expect(result.current.generatedAt).toBe(99)
  })

  it('cleanup cancels in-flight request on unmount', async () => {
    const { unmount } = renderHook(() => useAiSearchSummary(baseArgs))

    // start debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    unmount()

    // advance past debounce — request should NOT fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(mockPost).not.toHaveBeenCalled()
  })

  it('buildSnippet prefers selfIntro over workHistory', async () => {
    renderHook(() => useAiSearchSummary({
      ...baseArgs,
      results: [makeResult({
        resume: {
          resumeId: 'r2',
          name: 'Bob',
          selfIntro: '',
          workHistory: [{ jobTitle: 'Engineer', raw: 'Backend work' }],
          jobIntention: 'Seeking role',
          ingestData: { industryTags: [] },
        } as unknown as ResumeSearchResultItem['resume'],
      })],
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })

    const body = mockPost.mock.calls[0][1].body as { results: Array<{ snippet: string }> }
    expect(body.results[0].snippet).toBe('Backend work')
  })
})
