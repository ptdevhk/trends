import { useCallback, useEffect, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { components } from '@/lib/api-types'
import type { ResumeFilters } from '@/types/resume'

export type ResumeItem = components['schemas']['ResumeItem']
export type ResumeSample = components['schemas']['ResumeSample']
export type ResumesSummary = components['schemas']['ResumesResponse']['summary']

interface UseResumesOptions {
  limit?: number
  autoFetch?: boolean
  loadSamples?: boolean
  sessionId?: string
  jobDescriptionId?: string
}

interface UseResumesReturn {
  resumes: ResumeItem[]
  samples: ResumeSample[]
  summary: ResumesSummary | null
  filters: ResumeFilters
  loading: boolean
  error: string | null
  selectedSample: string
  query: string
  setSelectedSample: (value: string) => void
  setQuery: (value: string) => void
  setFilters: (value: ResumeFilters) => void
  refresh: () => Promise<void>
  reloadSamples: () => Promise<void>
}

export function useResumes(options: UseResumesOptions = {}): UseResumesReturn {
  const { limit = 200, autoFetch = true, loadSamples = true, sessionId, jobDescriptionId } = options

  const [resumes, setResumes] = useState<ResumeItem[]>([])
  const [samples, setSamples] = useState<ResumeSample[]>([])
  const [summary, setSummary] = useState<ResumesSummary | null>(null)
  const [selectedSample, setSelectedSample] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ResumeFilters>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reloadSamples = useCallback(async () => {
    if (!loadSamples) {
      setSamples([])
      setSelectedSample('')
      return
    }

    setError(null)
    const { data, error: apiError } = await rawApiClient.GET<{
      success: boolean
      samples?: ResumeSample[]
    }>('/api/resumes/samples')
    if (apiError || !data?.success) {
      setError('Failed to load resume samples')
      return
    }

    const nextSamples = data.samples ?? []
    setSamples(nextSamples)
    if (nextSamples.length) {
      setSelectedSample((current) => current || nextSamples[0].name)
    }
  }, [loadSamples])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    const queryParams: Record<string, string | number | undefined> = {
      sample: selectedSample || undefined,
      q: query || undefined,
      limit,
      sessionId,
      jobDescriptionId,
      minExperience: filters.minExperience,
      maxExperience: filters.maxExperience,
      minSalary: filters.minSalary,
      maxSalary: filters.maxSalary,
      minMatchScore: filters.minMatchScore,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    }

    if (filters.education?.length) queryParams.education = filters.education.join(',')
    if (filters.skills?.length) queryParams.skills = filters.skills.join(',')
    if (filters.locations?.length) queryParams.locations = filters.locations.join(',')
    if (filters.recommendation?.length) queryParams.recommendation = filters.recommendation.join(',')

    const { data, error: apiError } = await rawApiClient.GET<{
      success: boolean
      data?: ResumeItem[]
      summary?: ResumesSummary
      sample?: ResumeSample
    }>('/api/resumes', {
      params: {
        query: {
          ...queryParams,
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
  }, [filters, jobDescriptionId, limit, query, selectedSample, sessionId])

  useEffect(() => {
    if (!loadSamples) {
      return
    }
    void reloadSamples()
  }, [loadSamples, reloadSamples])

  useEffect(() => {
    if (autoFetch) {
      refresh()
    }
  }, [autoFetch, refresh])

  return {
    resumes,
    samples,
    summary,
    filters,
    loading,
    error,
    selectedSample,
    query,
    setSelectedSample,
    setQuery,
    setFilters,
    refresh,
    reloadSamples,
  }
}
