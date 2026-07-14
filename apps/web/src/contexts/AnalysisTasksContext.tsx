import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { rawApiClient } from '@/lib/api-helpers'

type AnalysisTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

type AnalysisTaskConfig = {
  jobDescriptionId?: string
  jobDescriptionTitle?: string
  keywords?: string[]
  location?: string
  promptVersion?: number
  resumeCount?: number
}

type AnalysisTaskProgress = {
  current: number
  total: number
  skipped: number
}

type AnalysisTaskResults = {
  analyzed: number
  failed: number
  avgScore: number
  highScoreCount: number
}

export type AnalysisTaskSummary = {
  id: string
  createdAt: number
  status: AnalysisTaskStatus
  config: AnalysisTaskConfig
  progress: AnalysisTaskProgress
  results?: AnalysisTaskResults
  lastStatus?: string
  error?: string
}

export type AnalysisTaskDispatchInput = {
  jobDescriptionId?: string
  jobDescriptionTitle?: string
  jobDescriptionContent?: string
  keywords?: string[]
  location?: string
  promptVersion?: number
  sample?: string
  resumeIds: string[]
  relatedExpContext?: {
    roleFilterType?: string
    minRoleYears?: number
    market?: string
    locale?: string
  }
}

export type AnalysisTaskDispatchResult = {
  queued: true
  taskId: string
  dispatchedAt: number
  reused: boolean
}

type BffAnalysisTask = {
  _id: string
  _creationTime: number
  status: AnalysisTaskStatus
  config?: AnalysisTaskConfig
  progress?: Partial<AnalysisTaskProgress>
  results?: Partial<AnalysisTaskResults>
  lastStatus?: string
  error?: string
}

type BffAnalysisTasksResponse = {
  success: true
  tasks: BffAnalysisTask[]
}

type AnalysisTasksContextValue = {
  tasks: AnalysisTaskSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  dispatch?: (input: AnalysisTaskDispatchInput) => Promise<AnalysisTaskDispatchResult>
  cancel?: (taskId: string) => Promise<void>
  canManage: boolean
}

const AnalysisTasksContext = createContext<AnalysisTasksContextValue | null>(null)

const DEFAULT_POLL_INTERVAL_MS = 15_000
const MIN_POLL_INTERVAL_MS = 5_000

function normalizeTask(task: BffAnalysisTask): AnalysisTaskSummary {
  return {
    id: task._id,
    createdAt: task._creationTime,
    status: task.status,
    config: task.config ?? {},
    progress: {
      current: task.progress?.current ?? 0,
      total: task.progress?.total ?? 0,
      skipped: task.progress?.skipped ?? 0,
    },
    ...(task.results
      ? {
        results: {
          analyzed: task.results.analyzed ?? 0,
          failed: task.results.failed ?? 0,
          avgScore: task.results.avgScore ?? 0,
          highScoreCount: task.results.highScoreCount ?? 0,
        },
      }
      : {}),
    ...(task.lastStatus ? { lastStatus: task.lastStatus } : {}),
    ...(task.error ? { error: task.error } : {}),
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : ''
  return name === 'AbortError'
}

export function AnalysisTasksProvider({
  children,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  children: ReactNode
  pollIntervalMs?: number
}) {
  const { isAuthenticated, memberships } = useAuth()
  const { slug } = useWorkspace()
  const canManage = isAuthenticated && memberships.some((membership) => (
    membership.workspaceSlug === slug && membership.role === 'admin'
  ))
  const [tasks, setTasks] = useState<AnalysisTaskSummary[]>([])
  const [tasksWorkspaceSlug, setTasksWorkspaceSlug] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequenceRef = useRef(0)
  const listAbortRef = useRef<AbortController | null>(null)

  const abortInFlightList = useCallback(() => {
    if (listAbortRef.current) {
      listAbortRef.current.abort()
      listAbortRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!canManage) {
      return
    }

    const workspaceSlug = slug
    const requestSequence = requestSequenceRef.current + 1
    requestSequenceRef.current = requestSequence
    abortInFlightList()
    const controller = new AbortController()
    listAbortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const { data, error: requestError } = await rawApiClient.GET<BffAnalysisTasksResponse>(
        '/api/resumes/analysis-tasks',
        { signal: controller.signal },
      )
      if (requestSequence !== requestSequenceRef.current || controller.signal.aborted) {
        return
      }
      if (requestError || !data?.success) {
        throw new Error('Analysis task request failed')
      }
      setTasks(data.tasks.map(normalizeTask))
      setTasksWorkspaceSlug(workspaceSlug)
    } catch (caught) {
      if (
        requestSequence !== requestSequenceRef.current
        || controller.signal.aborted
        || isAbortError(caught)
      ) {
        return
      }
      setError('Unable to load analysis tasks')
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null
      }
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [abortInFlightList, canManage, slug])

  const dispatch = useCallback(async (input: AnalysisTaskDispatchInput) => {
    const { data, error: requestError } = await rawApiClient.POST<AnalysisTaskDispatchResult>(
      '/api/resumes/analysis-tasks/dispatch',
      { body: input },
    )
    if (requestError || !data?.queued) {
      throw new Error('Unable to dispatch analysis task')
    }
    void refresh()
    return data
  }, [refresh])

  const cancel = useCallback(async (taskId: string) => {
    const { data, error: requestError } = await rawApiClient.DELETE<{ success: true }>(
      `/api/resumes/analysis-tasks/${encodeURIComponent(taskId)}`,
    )
    if (requestError || !data?.success) {
      throw new Error('Unable to cancel analysis task')
    }
    void refresh()
  }, [refresh])

  useEffect(() => {
    requestSequenceRef.current += 1
    abortInFlightList()
    if (!canManage) {
      setTasks([])
      setTasksWorkspaceSlug(null)
      setLoading(false)
      setError(null)
      return () => {
        requestSequenceRef.current += 1
        abortInFlightList()
      }
    }

    void refresh()
    if (pollIntervalMs <= 0) {
      return () => {
        requestSequenceRef.current += 1
        abortInFlightList()
      }
    }
    const interval = window.setInterval(() => {
      void refresh()
    }, Math.max(pollIntervalMs, MIN_POLL_INTERVAL_MS))
    return () => {
      window.clearInterval(interval)
      requestSequenceRef.current += 1
      abortInFlightList()
    }
  }, [abortInFlightList, canManage, pollIntervalMs, refresh, slug])

  const value = useMemo<AnalysisTasksContextValue>(() => ({
    tasks: canManage && tasksWorkspaceSlug === slug ? tasks : [],
    loading: canManage ? loading : false,
    error: canManage ? error : null,
    refresh,
    dispatch: canManage ? dispatch : undefined,
    cancel: canManage ? cancel : undefined,
    canManage,
  }), [canManage, cancel, dispatch, error, loading, refresh, slug, tasks, tasksWorkspaceSlug])

  return (
    <AnalysisTasksContext.Provider value={value}>
      {children}
    </AnalysisTasksContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- canonical context pattern: provider + hook
export function useAnalysisTasks(): AnalysisTasksContextValue {
  const context = useContext(AnalysisTasksContext)
  if (!context) {
    throw new Error('useAnalysisTasks must be used within AnalysisTasksProvider')
  }
  return context
}
