import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { ResumeFilters } from '@/types/resume'

export type SearchSession = {
  id: string
  userId?: string
  jobDescriptionId?: string
  sampleName?: string
  filters?: ResumeFilters
  status: 'active' | 'completed' | 'archived'
  createdAt: string
  updatedAt: string
  expiresAt?: string
}

const STORAGE_KEY = 'trends.resume.sessionId'

export function useSession() {
  const [session, setSession] = useState<SearchSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const createSession = useCallback(async (payload?: Partial<SearchSession>) => {
    const { data, error: apiError } = await (apiClient as any).POST('/api/sessions', {
      body: {
        userId: payload?.userId,
        jobDescriptionId: payload?.jobDescriptionId,
        sampleName: payload?.sampleName,
        filters: payload?.filters,
      },
    })

    if (apiError || !data?.success) {
      setError('Failed to create session')
      return null
    }

    setSession(data.session)
    localStorage.setItem(STORAGE_KEY, data.session.id)
    setError(null)
    return data.session as SearchSession
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const { data, error: apiError } = await (apiClient as any).GET(`/api/sessions/${sessionId}`)
    if (apiError || !data?.success) {
      return null
    }
    setSession(data.session)
    return data.session as SearchSession
  }, [])

  const updateSession = useCallback(
    async (updates: Partial<SearchSession>) => {
      if (!session?.id) {
        return createSession(updates)
      }

      const { data, error: apiError } = await (apiClient as any).PATCH(
        `/api/sessions/${session.id}`,
        {
          body: {
            userId: updates.userId,
            jobDescriptionId: updates.jobDescriptionId,
            sampleName: updates.sampleName,
            filters: updates.filters,
            status: updates.status,
            expiresAt: updates.expiresAt,
          },
        }
      )

      if (apiError || !data?.success) {
        setError('Failed to update session')
        return null
      }

      setSession(data.session)
      setError(null)
      return data.session as SearchSession
    },
    [createSession, session?.id]
  )

  useEffect(() => {
    let mounted = true

    const init = async () => {
      setLoading(true)
      const storedId = localStorage.getItem(STORAGE_KEY)
      if (storedId) {
        const loaded = await loadSession(storedId)
        if (mounted && !loaded) {
          localStorage.removeItem(STORAGE_KEY)
          await createSession()
        }
      } else {
        await createSession()
      }
      if (mounted) setLoading(false)
    }

    init()

    return () => {
      mounted = false
    }
  }, [createSession, loadSession])

  return {
    session,
    loading,
    error,
    createSession,
    updateSession,
    setSession,
  }
}
