import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSession } from './useSession'

vi.mock('../../../../packages/convex/convex/_generated/api', () => ({
  api: {
    sessions: {
      getActiveSession: 'get-active-session-query',
      listSearchHistory: 'list-history-query',
      saveSession: 'save-session-mutation',
      addReviewedItem: 'add-reviewed-item-mutation',
      saveSearchHistory: 'save-search-history-mutation',
      markSearchHistoryOpened: 'mark-search-history-opened-mutation',
    },
  },
}))

const {
  useQueryMock,
  useMutationMock,
  workspaceMock,
  rawApiPostMock,
  rawApiPatchMock,
  saveSessionMutationMock,
  addReviewedItemMutationMock,
  saveSearchHistoryMutationMock,
  markSearchHistoryOpenedMutationMock,
} = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  workspaceMock: {
    slug: 'dev',
  },
  rawApiPostMock: vi.fn(),
  rawApiPatchMock: vi.fn(),
  saveSessionMutationMock: vi.fn(),
  addReviewedItemMutationMock: vi.fn(),
  saveSearchHistoryMutationMock: vi.fn(async () => 'history-1'),
  markSearchHistoryOpenedMutationMock: vi.fn(async () => {}),
}))

const { toastInfoMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
}))

vi.mock('convex/react', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ slug: workspaceMock.slug }),
}))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: {
    POST: (...args: unknown[]) => rawApiPostMock(...args),
    PATCH: (...args: unknown[]) => rawApiPatchMock(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => toastInfoMock(...args),
  },
}))

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    workspaceMock.slug = 'dev'
    rawApiPostMock.mockResolvedValue({ data: { success: true, session: { id: 'api-session-1' } } })
    rawApiPatchMock.mockResolvedValue({ data: { success: true, session: { id: 'api-session-1' } } })

    useQueryMock.mockImplementation((query) => {
      if (query === 'list-history-query') {
        return []
      }

      return {
        config: {
          location: '广东,江苏',
          keywords: ['CNC', '销售'],
          jobDescriptionId: 'lathe-sales',
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
          filters: {
            minAge: 25,
            maxAge: 35,
          },
        },
        reviewedResumeIds: ['resume-1'],
      }
    })
    useMutationMock.mockImplementation((mutation) => {
      if (mutation === 'save-session-mutation') {
        return saveSessionMutationMock
      }
      if (mutation === 'add-reviewed-item-mutation') {
        return addReviewedItemMutationMock
      }
      if (mutation === 'save-search-history-mutation') {
        return saveSearchHistoryMutationMock
      }
      if (mutation === 'mark-search-history-opened-mutation') {
        return markSearchHistoryOpenedMutationMock
      }
      return vi.fn()
    })
  })

  it('does not auto-restore the previous screening session into live search state', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.location).toBe('')
    expect(result.current.keywords).toEqual([])
    expect(result.current.jobDescriptionId).toBeUndefined()
    expect(result.current.filters).toEqual({})
    expect(result.current.reviewedIdsSet.has('resume-1')).toBe(true)
    expect(toastInfoMock).not.toHaveBeenCalled()
  })

  it('loads and normalizes explicit search history records from Convex when requested', async () => {
    useQueryMock.mockImplementation((query) => {
      if (query === 'list-history-query') {
        return [
          {
            _id: 'history-1',
            sessionKey: 'session-1',
            title: '  东莞 · CNC  ',
            location: '东莞',
            keywords: ['CNC', '销售'],
            jobDescriptionId: 'lathe-sales',
            collectionSource: {
              type: 'seek',
              exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1',
            },
            filters: { minAge: 25 },
            selectedTags: ['STAR', 'STAR', ''],
            selectedCompanies: ['Acme', '  Acme  ', ''],
            selectedExperienceLevel: '  mid  ',
            collectionTaskId: '  task-1  ',
            analysisTaskId: '   ',
            notes: '  saved note  ',
            industryDbV2Stats: {
              size: 42,
              p80: 18,
              histogram50: Array.from({ length: 51 }, (_, index) => (index === 18 ? 42 : 0)),
            },
            createdAt: 1,
            lastOpenedAt: 2,
          },
        ]
      }

      return {
        config: {
          location: '广东,江苏',
          keywords: ['CNC', '销售'],
          jobDescriptionId: 'lathe-sales',
          filters: {},
        },
        reviewedResumeIds: [],
      }
    })

    const { result } = renderHook(() => useSession(true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.searchHistory).toEqual([
      expect.objectContaining({
        id: 'history-1',
        sessionKey: 'session-1',
        title: '  东莞 · CNC  ',
        location: '东莞',
        keywords: ['CNC', '销售'],
        collectionSource: { type: 'seek', exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=1' },
        selectedTags: ['STAR'],
        selectedCompanies: ['Acme'],
        selectedExperienceLevel: 'mid',
        collectionTaskId: 'task-1',
        analysisTaskId: undefined,
        notes: 'saved note',
        industryDbV2Stats: {
          size: 42,
          p80: 18,
          histogram50: Array.from({ length: 51 }, (_, index) => (index === 18 ? 42 : 0)),
        },
      }),
    ])
  })

  it('does not load explicit search history until requested', async () => {
    renderHook(() => useSession())

    expect(useQueryMock).toHaveBeenCalledWith('list-history-query', 'skip')
  })

  it('uses workspace-scoped session storage and mutation payloads for hr', async () => {
    workspaceMock.slug = 'hr'
    localStorage.setItem('trends.resume.sessionKey.hr', 'hr-session-key')
    localStorage.setItem('trends.resume.sessionKey.dev', 'dev-session-key')

    const { result } = renderHook(() => useSession(true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await result.current.trackReviewedResume('resume-2')
    await result.current.saveSearchHistory({
      title: 'HR saved search',
      location: '东莞',
      keywords: ['招聘', '简历'],
      collectionSource: { type: 'job5156' },
      resumeIds: ['resume-1', 'resume-2'],
    })
    await result.current.markSearchHistoryOpened('history-hr' as never)

    expect(localStorage.getItem('trends.resume.sessionKey.hr')).toBe('hr-session-key')
    expect(localStorage.getItem('trends.resume.sessionKey.dev')).toBe('dev-session-key')
    expect(addReviewedItemMutationMock).toHaveBeenCalledWith({
      sessionKey: 'hr-session-key',
      workspaceSlug: 'hr',
      resumeId: 'resume-2',
    })
    expect(saveSearchHistoryMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'hr-session-key',
        workspaceSlug: 'hr',
        title: 'HR saved search',
        location: '东莞',
        keywords: ['招聘', '简历'],
        collectionSource: { type: 'job5156' },
        resumeIds: ['resume-1', 'resume-2'],
      })
    )
    expect(markSearchHistoryOpenedMutationMock).toHaveBeenCalledWith({
      id: 'history-hr',
      workspaceSlug: 'hr',
    })
  })

  it('creates and persists an API search session id for the current local session', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setJobDescriptionId('lathe-sales')
      result.current.setFilters({ education: ['bachelor'] })
    })

    let ensuredSessionId: string | undefined
    await act(async () => {
      ensuredSessionId = await result.current.ensureApiSession()
    })

    const sessionKey = localStorage.getItem('trends.resume.sessionKey.dev')
    expect(ensuredSessionId).toBe('api-session-1')
    expect(rawApiPostMock).toHaveBeenCalledWith('/api/sessions', {
      body: {
        jobDescriptionId: 'lathe-sales',
        filters: { education: ['bachelor'] },
        shareTitle: undefined,
        searchState: undefined,
      },
    })
    expect(result.current.apiSessionId).toBe('api-session-1')
    expect(localStorage.getItem(`trends.resume.apiSessionId.dev.${sessionKey}`)).toBe('api-session-1')
  })

  it('persists share metadata when ensuring an API session for a durable share link', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.ensureApiSession({
        shareTitle: 'Kuala Lumpur · Sales Engineer',
        searchState: {
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer', 'CNC'],
          requiredKeywords: ['machine tools'],
          jobDescriptionId: 'lathe-sales',
          selectedTags: ['STAR'],
          selectedCompanies: ['Acme'],
          selectedExperienceLevel: 'mid',
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
          filters: {
            minAge: 28,
          },
          referenceNote: '  Priority shortlist for HR sync  ',
        },
      })
    })

    expect(rawApiPostMock).toHaveBeenCalledWith('/api/sessions', {
      body: {
        jobDescriptionId: undefined,
        filters: undefined,
        shareTitle: 'Kuala Lumpur · Sales Engineer',
        searchState: {
          location: 'Kuala Lumpur MY',
          keywords: ['Sales Engineer', 'CNC'],
          requiredKeywords: ['machine tools'],
          jobDescriptionId: 'lathe-sales',
          selectedTags: ['STAR'],
          selectedCompanies: ['Acme'],
          selectedExperienceLevel: 'mid',
          collectionSource: {
            type: 'seek',
            exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
          },
          filters: {
            minAge: 28,
          },
          referenceNote: 'Priority shortlist for HR sync',
        },
      },
    })
  })

  it('updates an existing persisted API session id before reusing it', async () => {
    localStorage.setItem('trends.resume.sessionKey.dev', 'existing-session-key')
    localStorage.setItem('trends.resume.apiSessionId.dev.existing-session-key', 'api-session-existing')
    rawApiPatchMock.mockResolvedValueOnce({
      data: {
        success: true,
        session: { id: 'api-session-existing' },
      },
    })

    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setFilters({ education: ['master'] })
    })

    let ensuredSessionId: string | undefined
    await act(async () => {
      ensuredSessionId = await result.current.ensureApiSession()
    })

    expect(ensuredSessionId).toBe('api-session-existing')
    expect(rawApiPatchMock).toHaveBeenCalledWith('/api/sessions/api-session-existing', {
      body: {
        jobDescriptionId: undefined,
        filters: { education: ['master'] },
        shareTitle: undefined,
        searchState: undefined,
      },
    })
    expect(rawApiPostMock).not.toHaveBeenCalled()
  })

  it('can adopt a shared API session id and reuse it for later updates', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.rememberApiSessionId('shared-session-id')
      result.current.setFilters({ education: ['phd'] })
    })

    expect(result.current.apiSessionId).toBe('shared-session-id')

    await act(async () => {
      await result.current.ensureApiSession()
    })

    expect(rawApiPatchMock).toHaveBeenCalledWith('/api/sessions/shared-session-id', {
      body: {
        jobDescriptionId: undefined,
        filters: { education: ['phd'] },
        shareTitle: undefined,
        searchState: undefined,
      },
    })
  })

  it('clears location when external state explicitly provides an empty location', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setLocation('广东')
    })

    expect(result.current.location).toBe('广东')

    act(() => {
      result.current.applyExternalState({
        location: '',
        keywords: ['CNC', '销售'],
      })
    })

    expect(result.current.location).toBe('')
    expect(result.current.keywords).toEqual(['CNC', '销售'])
  })

  it('can clear and replace the persisted collection source through external state', async () => {
    const { result } = renderHook(() => useSession())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    act(() => {
      result.current.setCollectionSource({ type: 'seek', exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1' })
    })

    expect(result.current.collectionSource).toEqual({
      type: 'seek',
      exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
    })

    act(() => {
      result.current.applyExternalState({
        collectionSource: null,
      })
    })

    expect(result.current.collectionSource).toBeUndefined()

    act(() => {
      result.current.applyExternalState({
        collectionSource: {
          type: 'seek',
          exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=2&pageNumber=1',
        },
      })
    })

    expect(result.current.collectionSource).toEqual({
      type: 'seek',
      exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=2&pageNumber=1',
    })
  })

  it('preserves seek collectionSource exactUrl from history records', async () => {
    useQueryMock.mockImplementation((query) => {
      if (query === 'list-history-query') {
        return [
          {
            _id: 'history-seek',
            sessionKey: 'session-seek',
            title: 'Seek history',
            location: 'Kuala Lumpur MY',
            keywords: ['Sales Engineer'],
            collectionSource: {
              type: 'seek',
              exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
            },
            filters: {},
            selectedTags: [],
            selectedCompanies: [],
            createdAt: 1,
          },
        ]
      }

      return {
        config: {
          location: '',
          keywords: [],
          filters: {},
        },
        reviewedResumeIds: [],
      }
    })

    const { result } = renderHook(() => useSession(true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.searchHistory[0]?.collectionSource).toEqual({
      type: 'seek',
      exactUrl: 'https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1',
    })
  })

  it('preserves 51job collectionSource from history records without exactUrl', async () => {
    useQueryMock.mockImplementation((query) => {
      if (query === 'list-history-query') {
        return [
          {
            _id: 'history-51job',
            sessionKey: 'session-51job',
            title: '东莞 · CNC 销售',
            location: '东莞',
            keywords: ['CNC', '销售'],
            collectionSource: {
              type: '51job',
            },
            filters: { minAge: 25, maxAge: 35 },
            selectedTags: [],
            selectedCompanies: [],
            createdAt: 1,
          },
        ]
      }

      return {
        config: {
          location: '',
          keywords: [],
          filters: {},
        },
        reviewedResumeIds: [],
      }
    })

    const { result } = renderHook(() => useSession(true))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.searchHistory[0]?.collectionSource).toEqual({
      type: '51job',
    })
  })
})
