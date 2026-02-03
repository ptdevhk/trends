import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import type { components } from '@/lib/api-types'

export type ResumeItem = components['schemas']['ResumeItem']
export type ResumeSample = components['schemas']['ResumeSample']
export type ResumesSummary = components['schemas']['ResumesResponse']['summary']

interface UseResumesOptions {
  limit?: number
  autoFetch?: boolean
}

interface UseResumesReturn {
  resumes: ResumeItem[]
  samples: ResumeSample[]
  summary: ResumesSummary | null
  loading: boolean
  error: string | null
  selectedSample: string
  query: string
  setSelectedSample: (value: string) => void
  setQuery: (value: string) => void
  refresh: () => Promise<void>
  reloadSamples: () => Promise<void>
}

export function useResumes(options: UseResumesOptions = {}): UseResumesReturn {
  const { limit = 200, autoFetch = true } = options

  const [resumes, setResumes] = useState<ResumeItem[]>([])
  const [samples, setSamples] = useState<ResumeSample[]>([])
  const [summary, setSummary] = useState<ResumesSummary | null>(null)
  const [selectedSample, setSelectedSample] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadSamples = useCallback(async () => {
    setError(null)
    const { data, error: apiError } = await apiClient.GET('/api/resumes/samples')
    if (apiError || !data?.success) {
      setError('Failed to load resume samples')
      return
    }

    setSamples(data.samples ?? [])
    if (data.samples?.length) {
      setSelectedSample((current) => current || data.samples[0].name)
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: apiError } = await apiClient.GET('/api/resumes', {
      params: {
        query: {
          sample: selectedSample || undefined,
          q: query || undefined,
          limit,
        },
      },
    })

    if (apiError || !data?.success) {
      setLoading(false)
      setError('Failed to load resume data')
      setSummary(null)
      return
    }

    setResumes(data.data ?? [])
    setSummary(data.summary ?? null)
    if (data.sample?.name && data.sample.name !== selectedSample) {
      setSelectedSample(data.sample.name)
    }

    setLoading(false)
  }, [limit, query, selectedSample])

  useEffect(() => {
    reloadSamples()
  }, [reloadSamples])

  useEffect(() => {
    if (autoFetch) {
      refresh()
    }
  }, [autoFetch, refresh])

  return {
    resumes,
    samples,
    summary,
    loading,
    error,
    selectedSample,
    query,
    setSelectedSample,
    setQuery,
    refresh,
    reloadSamples,
  }
}
