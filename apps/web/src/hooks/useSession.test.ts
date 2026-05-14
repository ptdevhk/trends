import { renderHook, act } from '@testing-library/react'
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
    localStorage.clearItem('convex_session_id')
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
      sessionId: expect.any(String),
      searchData: {
        keywords: ['react'],
        location: 'Shanghai',
      },
    })
  })
})
