import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { resolveResumeFieldUsagePolicy, type ResumeFieldUsagePolicy } from '@trends/shared'
import { apiClient } from '@/lib/api-client'
import { useWorkspace } from './WorkspaceContext'

type ResumeFieldUsagePolicyResponse = {
  success?: boolean
  config?: unknown
}

const DEFAULT_RESUME_FIELD_USAGE_POLICY = resolveResumeFieldUsagePolicy()

const ResumeFieldUsagePolicyContext = createContext<ResumeFieldUsagePolicy>(DEFAULT_RESUME_FIELD_USAGE_POLICY)

export function ResumeFieldUsagePolicyProvider({ children }: { children: ReactNode }) {
  const { slug } = useWorkspace()
  const [policy, setPolicy] = useState<ResumeFieldUsagePolicy>(DEFAULT_RESUME_FIELD_USAGE_POLICY)

  useEffect(() => {
    let active = true
    setPolicy(DEFAULT_RESUME_FIELD_USAGE_POLICY)

    void apiClient
      .GET('/api/config/resume-field-usage-policy')
      .then(({ data, response }) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return data as ResumeFieldUsagePolicyResponse
      })
      .then((payload) => {
        if (!active || payload.success !== true) {
          return
        }
        setPolicy(resolveResumeFieldUsagePolicy(payload.config))
      })
      .catch((error: unknown) => {
        console.error('Failed to load resume field usage policy', error)
      })

    return () => {
      active = false
    }
  }, [slug])

  return (
    <ResumeFieldUsagePolicyContext.Provider value={policy}>
      {children}
    </ResumeFieldUsagePolicyContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- canonical context pattern: provider + hook
export function useResumeFieldUsagePolicy(): ResumeFieldUsagePolicy {
  return useContext(ResumeFieldUsagePolicyContext)
}
