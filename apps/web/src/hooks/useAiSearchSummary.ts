import { useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'
import type { ResumeSearchResultItem } from '@/components/search/search-types'

type UseAiSearchSummaryArgs = {
  enabled?: boolean
  jobDescriptionId?: string
  location?: string
  query?: string
  results: ResumeSearchResultItem[]
  selectedCompanies: string[]
  selectedExperienceLevel?: string
  selectedTags: string[]
}

type SearchSummaryResponse = {
  success: boolean
  generatedAt?: number
  model?: string
  shouldRefresh?: boolean
  summary?: string
}

type SearchSummaryCandidate = {
  id: string
  keywords: string[]
  location?: string
  name: string
  score?: number
  snippet: string
  title?: string
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0).toString(16)
}

function buildSnippet(item: ResumeSearchResultItem): string {
  return item.resume.selfIntro?.trim()
    || item.resume.workHistory?.[0]?.raw?.trim()
    || item.resume.jobIntention?.trim()
    || ''
}

export function useAiSearchSummary({
  enabled = true,
  jobDescriptionId,
  location,
  query,
  results,
  selectedCompanies,
  selectedExperienceLevel,
  selectedTags,
}: UseAiSearchSummaryArgs) {
  const [summary, setSummary] = useState<string | undefined>(undefined)
  const [generatedAt, setGeneratedAt] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const payload = useMemo(() => {
    if (!enabled) {
      return null
    }

    const normalizedQuery = query?.trim()
    if (!normalizedQuery || results.length === 0) {
      return null
    }

    const candidates: SearchSummaryCandidate[] = results.slice(0, 20).map((item) => ({
      id: String(item.resume.resumeId),
      name: item.resume.name || 'Unnamed resume',
      title: item.resume.workHistory?.[0]?.jobTitle || item.resume.jobIntention,
      location: item.resume.location,
      score: item.score,
      keywords: item.resume.ingestData?.industryTags?.slice(0, 6) ?? [],
      snippet: buildSnippet(item),
    }))

    const payloadValue = {
      query: normalizedQuery,
      location,
      jobDescriptionId,
      facets: {
        selectedTags,
        selectedCompanies,
        selectedExperienceLevel,
      },
      resultCount: results.length,
      resultSetHash: hashString(candidates.map((item) => item.id).join('|')),
      urlHash: hashString(JSON.stringify({
        query: normalizedQuery,
        location,
        jobDescriptionId,
        selectedTags,
        selectedCompanies,
        selectedExperienceLevel,
      })),
      results: candidates,
    }

    return payloadValue
  }, [enabled, jobDescriptionId, location, query, results, selectedCompanies, selectedExperienceLevel, selectedTags])

  useEffect(() => {
    let active = true

    if (!payload) {
      setLoading(false)
      setSummary(undefined)
      setGeneratedAt(undefined)
      return () => {
        active = false
      }
    }

    const requestSummary = async (forceRefresh: boolean) => {
      const { data, error } = await rawApiClient.POST<SearchSummaryResponse>('/api/resumes/search-summary', {
        body: {
          ...payload,
          forceRefresh,
        },
      })

      if (!active || error || !data?.success) {
        if (active && forceRefresh === false) {
          setLoading(false)
        }
        return
      }

      setSummary(data.summary)
      setGeneratedAt(data.generatedAt)
      setLoading(false)

      if (data.shouldRefresh && !forceRefresh) {
        void requestSummary(true)
      }
    }

    const timer = window.setTimeout(() => {
      setLoading(true)
      void requestSummary(false)
    }, 2000)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [payload])

  return {
    generatedAt,
    loading,
    summary,
  }
}
