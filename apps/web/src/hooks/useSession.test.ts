import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useSession } from './useSession'

// Mock Convex
const mockSaveSession = vi.hoisted(() => vi.fn(async () => {}))
const mockAddReviewedItem = vi.hoisted(() => vi.fn(async () => {}))
const mockSaveSearchHistory = vi.hoisted(() => vi.fn(async () => 'hist-1'))
const mockMarkSearchHistoryOpened = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: (name: string) => {
    if (name === 'sessions:saveSession') return mockSaveSession
    if (name === 'sessions:addReviewedItem') return mockAddReviewedItem
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

// Mock workspace context
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: 'test-workspace' }),
}))

// Mock API client
const mockPatch = vi.hoisted(() => vi.fn(async () => ({
  data: { success: true, session: { id: 'patched-session' } },
  error: undefined,
})))

const mockPost = vi.hoisted(() => vi.fn(async () => ({
  data: { success: true, session: { id: 'new-session' } },
  error: undefined,
})))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: { PATCH: mockPatch, POST: mockPost },
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
    localStorage.clear()
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
        jobDescriptionId: 'jd-123',
      })
    })

    expect(result.current.jobDescriptionId).toBe('jd-123')
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
      result.current.applyExternalState({ jobDescriptionId: '  ' })
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

    await act(async () => {
      await result.current.ensureApiSession({ shareTitle: 'Test' })
    })

    expect(mockPost).toHaveBeenCalledWith('/api/sessions', {
      body: expect.objectContaining({
        shareTitle: 'Test',
      }),
    })
  })

  it('ensureApiSession PATCHes when apiSessionId exists', async () => {
    // Pre-populate localStorage with an API session ID
    const sessionKey = 'test-key'
    localStorage.setItem('trends.resume.sessionKey.test-workspace', sessionKey)
    localStorage.setItem(`trends.resume.apiSessionId.test-workspace.${sessionKey}`, 'existing-id')

    const { result } = renderHook(() => useSession())

    await act(async () => {
      await result.current.ensureApiSession()
    })

    expect(mockPatch).toHaveBeenCalledWith('/api/sessions/existing-id', {
      body: expect.anything(),
    })
  })

  it('ensureApiSession returns undefined on error', async () => {
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

  it('saveSearchHistory forwards parameters', async () => {
    const { result } = renderHook(() => useSession())

    // set some state first
    act(() => {
      result.current.applyExternalState({
        location: 'Shanghai',
        keywords: ['react'],
      })
    })

    await act(async () => {
      await result.current.saveSearchHistory({
        title: 'My Search',
        notes: 'test notes',
        selectedTags: ['senior'],
        selectedCompanies: ['Google'],
      })
    })

    expect(mockSaveSearchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My Search',
        notes: 'test notes',
        location: 'Shanghai',
        keywords: ['react'],
        selectedTags: ['senior'],
        selectedCompanies: ['Google'],
      })
    )
  })

  it('loading is true initially then false after hydration', async () => {
    const { result } = renderHook(() => useSession())

    // After first render + effects, hasHydratedInitialState should be true
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('reviewedIdsSet is empty when no activeSession', () => {
    const { result } = renderHook(() => useSession())

    expect(result.current.reviewedIdsSet).toEqual(new Set())
  })

  it('searchHistory is empty when not loading history', () => {
    const { result } = renderHook(() => useSession())

    expect(result.current.searchHistory).toEqual([])
  })
})
