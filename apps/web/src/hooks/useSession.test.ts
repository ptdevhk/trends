import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSession } from './useSession'

// Mock Convex
const mockSaveSession = vi.hoisted(() => vi.fn(async () => {}))
const mockSaveSearchHistory = vi.hoisted(() => vi.fn(async () => 'hist-1'))
const mockMarkSearchHistoryOpened = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: (name: string) => {
    if (name === 'sessions:saveSession') return mockSaveSession
    if (name === 'sessions:addReviewedItem') return vi.fn()
    if (name === 'sessions:saveSearchHistory') return mockSaveSearchHistory
    if (name === 'sessions:markSearchHistoryOpened') return mockMarkSearchHistoryOpened
    return vi.fn()
  },
}))

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sessions: {
      getActiveSession: 'sessions:getActiveSession',
      listSearchHistory: 'sessions:listSearchHistory',
      saveSession: 'sessions:saveSession',
      addReviewedItem: 'sessions:addReviewedItem',
      saveSearchHistory: 'sessions:saveSearchHistory',
      markSearchHistoryOpened: 'sessions:markSearchHistoryOpened',
    },
  },
}))

// Mock API client
type SessionApiResponse = {
  data?: { session: { id: string } } & Record<string, unknown>
  error?: { message: string } | undefined
}

const mockPatch = vi.hoisted(() => vi.fn(async (): Promise<SessionApiResponse> => ({
  data: { success: true, session: { id: 'patched-session' } },
  error: undefined,
})))

const mockPost = vi.hoisted(() => vi.fn(async (): Promise<SessionApiResponse> => ({
  data: { success: true, session: { id: 'new-session' } },
  error: undefined,
})))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { PATCH: mockPatch, POST: mockPost },
}))

// Mock workspace context
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'test-workspace' }),
}))

// Mock search-profile-sources
vi.mock('@/lib/search-profile-sources', () => ({
  normalizeCollectionSource: (v: unknown) => v ?? undefined,
}))

// Mock resume-scoring
vi.mock('@/lib/resume-scoring', () => ({
  toIndustryDbV2Stats: (v: unknown) => v ?? undefined,
}))

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem('convex_session_id')
  })

  it('applyExternalState sets location and keywords', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.applyExternalState({
        location: 'Shanghai',
        keywords: ['react', 'typescript'],
      })
    })

    expect(result.current.location).toBe('Shanghai')
    expect(result.current.keywords).toEqual(['react', 'typescript'])
  })

  it('applyExternalState normalizes keywords (trim, filter empty)', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.applyExternalState({
        keywords: ['  react  ', '', '  ', 'typescript'],
      })
    })

    expect(result.current.keywords).toEqual(['react', 'typescript'])
  })

  it('applyExternalState sets jobDescriptionId', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.applyExternalState({
        jobDescriptionId: 'jd-1',
      })
    })

    expect(result.current.jobDescriptionId).toBe('jd-1')
  })

  it('saveSearchHistory calls mutation', async () => {
    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.saveSearchHistory({
        keywords: ['react'],
        location: 'Shanghai',
      })
    })

    expect(mockSaveSearchHistory).toHaveBeenCalledWith({
      sessionKey: expect.any(String),
      workspaceSlug: 'test-workspace',
      keywords: ['react'],
      location: 'Shanghai',
      filters: {},
      resumeIds: [],
      selectedCompanies: [],
      selectedTags: [],
      title: undefined,
      notes: undefined,
      collectionSource: undefined,
      collectionTaskId: undefined,
      analysisTaskId: undefined,
      jobDescriptionId: undefined,
      selectedExperienceLevel: undefined,
    })
  })

  it('applyExternalState sets filters', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.applyExternalState({
        filters: { minExperience: 3, education: ['bachelor'] },
      })
    })

    expect(result.current.filters).toEqual({ minExperience: 3, education: ['bachelor'] })
  })

  it('applyExternalState clears jobDescriptionId when empty string', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.applyExternalState({ jobDescriptionId: 'jd-1' })
    })
    expect(result.current.jobDescriptionId).toBe('jd-1')

    act(() => {
      result.current.applyExternalState({ jobDescriptionId: '' })
    })

    expect(result.current.jobDescriptionId).toBeUndefined()
  })

  it('setLocation updates location', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.setLocation('Beijing')
    })

    expect(result.current.location).toBe('Beijing')
  })

  it('setKeywords updates keywords', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.setKeywords(['vue', 'angular'])
    })

    expect(result.current.keywords).toEqual(['vue', 'angular'])
  })

  it('setFilters updates filters', () => {
    const { result } = renderHook(() => useSession())

    act(() => {
      result.current.setFilters({ minSalary: 10000 })
    })

    expect(result.current.filters).toEqual({ minSalary: 10000 })
  })

  it('ensureApiSession POSTs when no apiSessionId', async () => {
    const { result } = renderHook(() => useSession())

    let sessionId: string | undefined
    await act(async () => {
      sessionId = await result.current.ensureApiSession({ shareTitle: 'Test' })
    })

    expect(mockPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({
      body: expect.objectContaining({ shareTitle: 'Test' }),
    }))
    expect(sessionId).toBe('new-session')
  })

  it('ensureApiSession returns undefined on error', async () => {
    mockPatch.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'patch-fail' },
    })
    mockPost.mockResolvedValueOnce({
      data: undefined,
      error: { message: 'fail' },
    })

    const { result } = renderHook(() => useSession())

    let sessionId: string | undefined
    await act(async () => {
      sessionId = await result.current.ensureApiSession()
    })

    expect(sessionId).toBeUndefined()
  })

  it('loading becomes false after hydration', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('reviewedIdsSet is empty Set initially', () => {
    const { result } = renderHook(() => useSession())

    expect(result.current.reviewedIdsSet).toEqual(new Set())
  })

  it('searchHistory is empty array initially', () => {
    const { result } = renderHook(() => useSession())

    expect(result.current.searchHistory).toEqual([])
  })
})
