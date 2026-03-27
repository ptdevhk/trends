import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiSearchSummary } from '@/hooks/useAiSearchSummary'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { ConvexResumeItem } from '@/hooks/useConvexResumes'

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => postMock(...args),
  },
}))

function createResume(index: number, overrides: Partial<ConvexResumeItem> = {}): ConvexResumeItem {
  return {
    resumeId: `resume-${index}` as ConvexResumeItem['resumeId'],
    externalId: `resume-${index}`,
    name: `Candidate ${index}`,
    profileUrl: '',
    activityStatus: '',
    age: '',
    ageNumber: 30,
    experience: '5 years',
    education: 'Bachelor',
    location: 'Malaysia',
    extractedAt: new Date('2026-03-27T10:00:00.000Z').toISOString(),
    expectedSalary: '',
    jobIntention: `Job intention ${index}`,
    selfIntro: `Self intro ${index}`,
    skills: [],
    workHistory: [
      {
        companyName: `Company ${index}`,
        jobTitle: `Sales title ${index}`,
        raw: `Work history raw ${index}`,
      },
    ],
    source: 'seek',
    crawledAt: Date.now(),
    tags: [],
    ingestData: {
      industryTags: ['Machine Tools', 'CNC', 'Automation'],
      synonymHits: [],
      brandHits: [],
      companyHits: [`Company ${index}`],
      ruleScores: {},
      experienceLevel: 'senior',
      computedAt: Date.now(),
      skillsVersion: 1,
    },
    ...overrides,
  }
}

function createResult(index: number, overrides: Partial<ResumeSearchResultItem> = {}): ResumeSearchResultItem {
  return {
    key: overrides.key ?? `resume-${index}`,
    identityKey: overrides.identityKey ?? `identity-${index}`,
    blocked: overrides.blocked ?? false,
    score: overrides.score ?? 80 + index,
    status: overrides.status ?? 'new',
    statusMeta: overrides.statusMeta,
    resume: overrides.resume ?? createResume(index),
  }
}

async function advanceDebounceWindow(milliseconds = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

describe('useAiSearchSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not request a summary when the query is blank or there are no results', async () => {
    const { rerender, result } = renderHook(
      (props: Parameters<typeof useAiSearchSummary>[0]) => useAiSearchSummary(props),
      {
        initialProps: {
          query: '   ',
          results: [createResult(1)],
          selectedCompanies: [],
          selectedTags: [],
        },
      }
    )

    await advanceDebounceWindow(2500)

    expect(postMock).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.summary).toBeUndefined()
    expect(result.current.generatedAt).toBeUndefined()

    rerender({
      query: 'machine tools',
      results: [],
      selectedCompanies: [],
      selectedTags: [],
    })

    await advanceDebounceWindow(2500)

    expect(postMock).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('debounces for 2 seconds and posts the canonical summary payload for the top 20 results', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        success: true,
        summary: 'Strong machine-tools sales bench across Malaysia.',
        generatedAt: 1710000000000,
      },
    })

    const results = Array.from({ length: 22 }, (_, index) => createResult(index + 1))
    results[0] = createResult(1, {
      score: 96,
      resume: createResume(1, {
        name: 'Ada Tan',
        location: 'Kuala Lumpur',
        jobIntention: 'Regional sales leader',
        selfIntro: 'Led CNC and machine tools sales across Malaysia.',
        workHistory: [
          {
            companyName: 'FANUC',
            jobTitle: 'Regional Sales Manager',
            raw: 'Closed multimillion machine tools deals.',
          },
        ],
        ingestData: {
          industryTags: ['Machine Tools', 'CNC', 'FANUC', 'Automation', 'Sales', 'Robotics', 'Service'],
          synonymHits: [],
          brandHits: [],
          companyHits: ['FANUC'],
          ruleScores: {},
          experienceLevel: 'senior',
          computedAt: Date.now(),
          skillsVersion: 1,
        },
      }),
    })
    results[1] = createResult(2, {
      score: 91,
      resume: createResume(2, {
        name: 'Ben Lee',
        selfIntro: '',
        jobIntention: 'Account management',
        workHistory: [
          {
            companyName: 'DMG MORI',
            jobTitle: 'Sales Engineer',
            raw: 'Built CNC sales pipeline across Johor.',
          },
        ],
      }),
    })
    results[2] = createResult(3, {
      score: 88,
      resume: createResume(3, {
        name: 'Cara Ong',
        selfIntro: '',
        jobIntention: 'Regional sales coverage',
        workHistory: [],
      }),
    })

    const { result } = renderHook(() => useAiSearchSummary({
      query: '   machine tools sales   ',
      location: 'Malaysia',
      jobDescriptionId: 'jd-machine-tools',
      results,
      selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
      selectedCompanies: ['FANUC', 'DMG MORI'],
      selectedExperienceLevel: 'senior',
    }))

    await advanceDebounceWindow(1999)
    expect(postMock).not.toHaveBeenCalled()

    await advanceDebounceWindow(1)

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith('/api/resumes/search-summary', {
      body: expect.objectContaining({
        query: 'machine tools sales',
        location: 'Malaysia',
        jobDescriptionId: 'jd-machine-tools',
        resultCount: 22,
        facets: {
          selectedTags: ['cluster:manufacturing-systems', 'Machine Tools'],
          selectedCompanies: ['FANUC', 'DMG MORI'],
          selectedExperienceLevel: 'senior',
        },
        forceRefresh: false,
      }),
    })

    const requestBody = postMock.mock.calls[0]?.[1]?.body as {
      resultSetHash: string
      results: Array<{
        id: string
        keywords: string[]
        location?: string
        name: string
        score?: number
        snippet: string
        title?: string
      }>
      urlHash: string
    }

    expect(requestBody.results).toHaveLength(20)
    expect(requestBody.results.map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `resume-${index + 1}`)
    )
    expect(requestBody.results[0]).toEqual({
      id: 'resume-1',
      name: 'Ada Tan',
      title: 'Regional Sales Manager',
      location: 'Kuala Lumpur',
      score: 96,
      keywords: ['Machine Tools', 'CNC', 'FANUC', 'Automation', 'Sales', 'Robotics'],
      snippet: 'Led CNC and machine tools sales across Malaysia.',
    })
    expect(requestBody.results[1]?.snippet).toBe('Built CNC sales pipeline across Johor.')
    expect(requestBody.results[2]?.snippet).toBe('Regional sales coverage')
    expect(requestBody.urlHash).toMatch(/^[0-9a-f]+$/)
    expect(requestBody.resultSetHash).toMatch(/^[0-9a-f]+$/)
    expect(result.current.summary).toBe('Strong machine-tools sales bench across Malaysia.')
    expect(result.current.generatedAt).toBe(1710000000000)
    expect(result.current.loading).toBe(false)
  })

  it('fires a background force refresh when the cached summary response is marked stale', async () => {
    postMock
      .mockResolvedValueOnce({
        data: {
          success: true,
          summary: 'Cached summary',
          generatedAt: 1710000000000,
          shouldRefresh: true,
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          summary: 'Fresh summary',
          generatedAt: 1710000300000,
        },
      })

    const { result } = renderHook(() => useAiSearchSummary({
      query: 'machine tools',
      results: [createResult(1)],
      selectedCompanies: ['FANUC'],
      selectedTags: ['Machine Tools'],
    }))

    await advanceDebounceWindow()

    expect(postMock).toHaveBeenCalledTimes(2)
    expect(postMock.mock.calls[0]?.[1]).toEqual({
      body: expect.objectContaining({
        forceRefresh: false,
      }),
    })
    expect(postMock.mock.calls[1]?.[1]).toEqual({
      body: expect.objectContaining({
        forceRefresh: true,
      }),
    })
    expect(result.current.summary).toBe('Fresh summary')
    expect(result.current.generatedAt).toBe(1710000300000)
    expect(result.current.loading).toBe(false)
  })

  it('clears loading if the first summary request fails', async () => {
    postMock.mockResolvedValueOnce({
      error: new Error('network failed'),
    })

    const { result } = renderHook(() => useAiSearchSummary({
      query: 'machine tools',
      results: [createResult(1)],
      selectedCompanies: [],
      selectedTags: [],
    }))

    await advanceDebounceWindow()

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.summary).toBeUndefined()
    expect(result.current.generatedAt).toBeUndefined()
  })
})
