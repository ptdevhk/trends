import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_RESUME_WORK_HISTORY_LIMIT,
  normalizeResumeWorkHistoryLimit,
} from '@trends/shared'
import { apiClient } from '@/lib/api-client'

type ResumeWorkHistoryLimitContextValue = {
  limit: number
  setLimit: (limit: number) => void
}

type ResumeWorkHistoryLimitResponse = {
  success?: boolean
  limit?: unknown
}

const ResumeWorkHistoryLimitContext = createContext<ResumeWorkHistoryLimitContextValue>({
  limit: DEFAULT_RESUME_WORK_HISTORY_LIMIT,
  setLimit: () => {},
})

export function ResumeWorkHistoryLimitProvider({ children }: { children: ReactNode }) {
  const [limit, setLimitState] = useState(DEFAULT_RESUME_WORK_HISTORY_LIMIT)

  useEffect(() => {
    let active = true

    void apiClient
      .GET('/api/system/resume-work-history-limit')
      .then(({ data, response }) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return data as ResumeWorkHistoryLimitResponse
      })
      .then((payload) => {
        if (active && payload.success === true) {
          setLimitState(normalizeResumeWorkHistoryLimit(payload.limit))
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load resume work-history limit', error)
      })

    return () => {
      active = false
    }
  }, [])

  const setLimit = useCallback((nextLimit: number) => {
    setLimitState(normalizeResumeWorkHistoryLimit(nextLimit))
  }, [])

  return (
    <ResumeWorkHistoryLimitContext.Provider value={{ limit, setLimit }}>
      {children}
    </ResumeWorkHistoryLimitContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- canonical context pattern: provider + hook
export function useResumeWorkHistoryLimit(): ResumeWorkHistoryLimitContextValue {
  return useContext(ResumeWorkHistoryLimitContext)
}
