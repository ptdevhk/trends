import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalysisTasksProvider, useAnalysisTasks } from '@/contexts/AnalysisTasksContext'

const apiClientMock = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
}))

const authState = vi.hoisted(() => ({
  isAuthenticated: true,
  workspaceRole: 'admin' as 'admin' | 'user' | null,
  memberships: [{ workspaceSlug: 'dev', role: 'admin' as const }] as Array<{
    workspaceSlug: string
    role: 'admin' | 'user'
  }>,
  isLoading: false,
}))

const workspaceState = vi.hoisted(() => ({ slug: 'dev' }))

vi.mock('@/lib/api-helpers', () => ({
  rawApiClient: apiClientMock,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => workspaceState,
}))

function wrapper({ children }: { children: ReactNode }) {
  return <AnalysisTasksProvider pollIntervalMs={0}>{children}</AnalysisTasksProvider>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('AnalysisTasksContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isAuthenticated = true
    authState.workspaceRole = 'admin'
    authState.memberships = [{ workspaceSlug: 'dev', role: 'admin' }]
    authState.isLoading = false
    workspaceState.slug = 'dev'
    apiClientMock.GET.mockResolvedValue({ data: { success: true, tasks: [] } })
    apiClientMock.POST.mockResolvedValue({
      data: { queued: true, taskId: 'task-dispatched', dispatchedAt: 1, reused: false },
    })
    apiClientMock.DELETE.mockResolvedValue({ data: { success: true } })
  })

  it.each([
    { isAuthenticated: false, workspaceRole: null },
    { isAuthenticated: true, workspaceRole: 'user' as const },
  ])('does not expose task data or mutations to an unprivileged session', (session) => {
    authState.isAuthenticated = session.isAuthenticated
    authState.workspaceRole = session.workspaceRole
    authState.memberships = session.workspaceRole === 'user'
      ? [{ workspaceSlug: 'dev', role: 'user' }]
      : []

    const { result } = renderHook(() => useAnalysisTasks(), { wrapper })

    expect(result.current.canManage).toBe(false)
    expect(result.current.tasks).toEqual([])
    expect(result.current.dispatch).toBeUndefined()
    expect(result.current.cancel).toBeUndefined()
    expect(apiClientMock.GET).not.toHaveBeenCalled()
    expect(apiClientMock.POST).not.toHaveBeenCalled()
    expect(apiClientMock.DELETE).not.toHaveBeenCalled()
  })

  it('uses only BFF task operations without workspace or secret browser inputs', async () => {
    apiClientMock.GET.mockResolvedValueOnce({
      data: {
        success: true,
        tasks: [{
          _id: 'task-1',
          _creationTime: 100,
          status: 'pending',
        }],
      },
    })

    const { result } = renderHook(() => useAnalysisTasks(), { wrapper })

    await waitFor(() => expect(result.current.tasks).toHaveLength(1))
    expect(result.current.tasks[0]).toMatchObject({
      id: 'task-1',
      createdAt: 100,
      config: {},
      progress: { current: 0, total: 0, skipped: 0 },
    })
    expect(apiClientMock.GET).toHaveBeenCalledWith(
      '/api/resumes/analysis-tasks',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    await act(async () => {
      await result.current.dispatch?.({
        keywords: ['sales'],
        resumeIds: ['resume-1'],
      })
    })
    await act(async () => {
      await result.current.cancel?.('task-1')
    })

    expect(apiClientMock.POST).toHaveBeenCalledWith('/api/resumes/analysis-tasks/dispatch', {
      body: { keywords: ['sales'], resumeIds: ['resume-1'] },
    })
    expect(apiClientMock.DELETE).toHaveBeenCalledWith('/api/resumes/analysis-tasks/task-1')
    for (const [, options] of apiClientMock.POST.mock.calls) {
      expect(options?.body).not.toHaveProperty('workspaceSlug')
      expect(options?.body).not.toHaveProperty('writeSecret')
    }
  })

  it('does not let a stale refresh overwrite newer task data', async () => {
    const first = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    const second = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    apiClientMock.GET
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { result } = renderHook(() => useAnalysisTasks(), { wrapper })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(1))

    act(() => {
      void result.current.refresh()
    })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(2))

    await act(async () => {
      second.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'newer-task', _creationTime: 2, status: 'completed' }],
        },
      })
      await second.promise
    })
    await waitFor(() => expect(result.current.tasks.map((task) => task.id)).toEqual(['newer-task']))

    await act(async () => {
      first.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'stale-task', _creationTime: 1, status: 'pending' }],
        },
      })
      await first.promise
    })

    expect(result.current.tasks.map((task) => task.id)).toEqual(['newer-task'])
  })

  it('aborts the previous in-flight list GET when a newer refresh starts', async () => {
    const first = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    const second = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    const firstSignalRef: { current?: AbortSignal } = {}
    apiClientMock.GET.mockImplementation((_path: string, options?: { signal?: AbortSignal }) => {
      if (!firstSignalRef.current) {
        firstSignalRef.current = options?.signal
        return first.promise
      }
      return second.promise
    })

    const { result } = renderHook(() => useAnalysisTasks(), { wrapper })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(1))
    expect(firstSignalRef.current).toBeInstanceOf(AbortSignal)
    expect(firstSignalRef.current?.aborted).toBe(false)

    act(() => {
      void result.current.refresh()
    })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(2))

    expect(firstSignalRef.current?.aborted).toBe(true)
    expect(apiClientMock.GET.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(apiClientMock.GET.mock.calls[1]?.[1]?.signal?.aborted).toBe(false)

    await act(async () => {
      second.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'latest-task', _creationTime: 3, status: 'completed' }],
        },
      })
      await second.promise
    })
    await waitFor(() => expect(result.current.tasks.map((task) => task.id)).toEqual(['latest-task']))
  })

  it('aborts an in-flight list GET on unmount so it cannot retain provider state', async () => {
    const pending = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    let requestSignal: AbortSignal | undefined
    apiClientMock.GET.mockImplementation((_path: string, options?: { signal?: AbortSignal }) => {
      requestSignal = options?.signal
      return pending.promise
    })

    const { unmount } = renderHook(() => useAnalysisTasks(), { wrapper })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(1))
    expect(requestSignal?.aborted).toBe(false)

    unmount()
    expect(requestSignal?.aborted).toBe(true)

    await act(async () => {
      pending.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'after-unmount', _creationTime: 9, status: 'pending' }],
        },
      })
      await pending.promise
    })
  })

  it('refreshes for an active workspace change and ignores the prior workspace response', async () => {
    const devResponse = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    const hrResponse = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    authState.memberships = [
      { workspaceSlug: 'dev', role: 'admin' },
      { workspaceSlug: 'hr', role: 'admin' },
    ]
    apiClientMock.GET
      .mockReturnValueOnce(devResponse.promise)
      .mockReturnValueOnce(hrResponse.promise)

    const { result, rerender } = renderHook(() => useAnalysisTasks(), { wrapper })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(1))

    await act(async () => {
      devResponse.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'dev-task', _creationTime: 1, status: 'pending' }],
        },
      })
      await devResponse.promise
    })
    await waitFor(() => expect(result.current.tasks.map((task) => task.id)).toEqual(['dev-task']))

    workspaceState.slug = 'hr'
    rerender()
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(2))
    expect(result.current.tasks).toEqual([])

    await act(async () => {
      hrResponse.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'hr-task', _creationTime: 2, status: 'completed' }],
        },
      })
      await hrResponse.promise
    })
    await waitFor(() => expect(result.current.tasks.map((task) => task.id)).toEqual(['hr-task']))

    expect(result.current.tasks.map((task) => task.id)).toEqual(['hr-task'])
  })

  it('hides task controls when the active workspace membership is not admin', async () => {
    const first = deferred<{ data: { success: true; tasks: Array<Record<string, unknown>> } }>()
    authState.memberships = [
      { workspaceSlug: 'dev', role: 'admin' },
      { workspaceSlug: 'hr', role: 'user' },
    ]
    apiClientMock.GET.mockReturnValueOnce(first.promise)

    const { result, rerender } = renderHook(() => useAnalysisTasks(), { wrapper })
    await waitFor(() => expect(apiClientMock.GET).toHaveBeenCalledTimes(1))

    workspaceState.slug = 'hr'
    rerender()

    expect(result.current.canManage).toBe(false)
    expect(result.current.tasks).toEqual([])
    expect(result.current.dispatch).toBeUndefined()
    expect(result.current.cancel).toBeUndefined()

    await act(async () => {
      first.resolve({
        data: {
          success: true,
          tasks: [{ _id: 'dev-task', _creationTime: 1, status: 'pending' }],
        },
      })
      await first.promise
    })

    expect(result.current.tasks).toEqual([])
  })
})
