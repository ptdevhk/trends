import { renderHook, waitFor } from '@testing-library/react'
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

    useQueryMock.mockImplementation((query) => {
      if (query === 'list-history-query') {
        return []
      }

      return {
        config: {
          location: '广东,江苏',
          keywords: ['CNC', '销售'],
          jobDescriptionId: 'lathe-sales',
          filters: {
            minExperience: 1,
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
            filters: { minAge: 25 },
            selectedTags: ['STAR', 'STAR', ''],
            selectedCompanies: ['Acme', '  Acme  ', ''],
            selectedExperienceLevel: '  mid  ',
            collectionTaskId: '  task-1  ',
            analysisTaskId: '   ',
            notes: '  saved note  ',
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
        selectedTags: ['STAR'],
        selectedCompanies: ['Acme'],
        selectedExperienceLevel: 'mid',
        collectionTaskId: 'task-1',
        analysisTaskId: undefined,
        notes: 'saved note',
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
      })
    )
    expect(markSearchHistoryOpenedMutationMock).toHaveBeenCalledWith({
      id: 'history-hr',
      workspaceSlug: 'hr',
    })
  })
})
