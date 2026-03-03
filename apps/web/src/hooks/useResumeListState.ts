import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import { useConvexResumes, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useSession } from '@/hooks/useSession'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useUrlSearchState, type ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import { rawApiClient } from '@/lib/api-helpers'
import { expandKeyword, DEFAULT_CONFIG } from '@/lib/trendradar/parser'
import type { CandidateActionType, MatchingResult, ResumeFilters } from '@/types/resume'
import {
  buildLearningObservation,
  buildResumeKey,
  getAnalysisForJob,
  hasIngestData,
  isAutoFilteredAnalysis,
  toMatchBreakdown,
  toRecommendation,
} from '@/lib/resume-scoring'

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
  }
  content?: string
}

type ResumeExportFormat = 'csv' | 'xlsx'

type ScoredConvexResume = ConvexResumeItem & {
  _ruleScore: number
}

type EnrichedResume = {
  resume: ConvexResumeItem | ResumeItem
  key: string
  match?: MatchingResult
  ruleScore?: number
  action?: CandidateActionType | undefined
}

type AnalysisTaskDoc = Doc<'analysis_tasks'>

const DEFAULT_LOCATION = '广东'

function normalizeKeywordFingerprint(keywords: string[]): string {
  return [...keywords]
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length > 0)
    .sort()
    .join('|')
}

function taskMatchesCurrentSearch(
  task: AnalysisTaskDoc,
  jobDescriptionId: string | undefined,
  sessionKeywords: string[]
): boolean {
  if (task.status !== 'pending' && task.status !== 'processing') {
    return false
  }

  const normalizedJobDescriptionId = (jobDescriptionId ?? '').trim()
  if (normalizedJobDescriptionId && task.config.jobDescriptionId === normalizedJobDescriptionId) {
    return true
  }

  if (sessionKeywords.length > 0 && task.config.keywords?.length) {
    const normalizedSessionKeywords = normalizeKeywordFingerprint(sessionKeywords)
    const normalizedTaskKeywords = normalizeKeywordFingerprint(task.config.keywords)
    return normalizedSessionKeywords.length > 0 && normalizedSessionKeywords === normalizedTaskKeywords
  }

  return false
}

function getExportErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  if (!('error' in value)) {
    return undefined
  }
  const error = value.error
  if (typeof error !== 'string' || error.trim().length === 0) {
    return undefined
  }
  return error
}

function normalizeFilterToken(value: string): string {
  return value.trim().toLowerCase()
}

function toggleFilterValue(currentValues: string[], value: string): string[] {
  const normalizedValue = value.trim()
  if (normalizedValue.length === 0) {
    return currentValues
  }

  const normalizedKey = normalizeFilterToken(normalizedValue)
  if (currentValues.some((item) => normalizeFilterToken(item) === normalizedKey)) {
    return currentValues.filter((item) => normalizeFilterToken(item) !== normalizedKey)
  }

  return [...currentValues, normalizedValue]
}

function toExperienceLevel(value: string | undefined): ExperienceLevelFilter | undefined {
  if (!value) {
    return undefined
  }

  const normalized = normalizeFilterToken(value)
  if (normalized === 'senior') return 'senior'
  if (normalized === 'mid') return 'mid'
  if (normalized === 'junior') return 'junior'
  return undefined
}

function parseExperienceYears(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const matched = value.match(/\d+(?:\.\d+)?/)
  if (!matched) {
    return 0
  }

  const parsed = Number(matched[0])
  return Number.isFinite(parsed) ? parsed : 0
}

function parseExtractedAt(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

const EDUCATION_KEYWORDS: Record<string, string[]> = {
  high_school: ['高中', '中专', '技校', 'high school'],
  associate: ['大专', '专科', 'associate'],
  bachelor: ['本科', '学士', 'bachelor'],
  master: ['硕士', '研究生', 'master'],
  phd: ['博士', 'phd', 'doctor'],
}

function matchesEducationFilter(educationValue: string | undefined, selectedEducation: string[]): boolean {
  if (selectedEducation.length === 0) {
    return true
  }

  const normalizedEducation = normalizeFilterToken(educationValue ?? '')
  if (!normalizedEducation) {
    return false
  }

  return selectedEducation.some((level) => {
    const keywords = EDUCATION_KEYWORDS[level]
    if (!keywords || keywords.length === 0) {
      return false
    }

    return keywords.some((keyword) => normalizedEducation.includes(normalizeFilterToken(keyword)))
  })
}

export function useResumeListState() {
  const { t } = useTranslation()
  const {
    location: sessionLocation,
    setLocation: setSessionLocation,
    keywords: sessionKeywords,
    setKeywords: setSessionKeywords,
    jobDescriptionId,
    setJobDescriptionId,
    filters,
    setFilters,
    reviewedIdsSet,
    trackReviewedResume,
    applyExternalState,
  } = useSession()

  const {
    parsedState: parsedUrlState,
    hasUrlParams,
    hasKeywordParam,
    hasJobDescriptionParam,
    syncToUrl,
  } = useUrlSearchState()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkExportFormat, setBulkExportFormat] = useState<ResumeExportFormat>('csv')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [selectedExperienceLevel, setSelectedExperienceLevel] = useState<ExperienceLevelFilter | undefined>(undefined)
  const [mode] = useState<'ai'>('ai')
  const hydratedSessionIdRef = useRef<string | null>(null)
  const hasInitializedUrlSyncRef = useRef(false)
  const lastAppliedUrlStateRef = useRef<string | null>(null)
  const skipNextUrlSyncRef = useRef(false)
  const session = useMemo(() => ({ id: 'convex', jobDescriptionId, filters }), [jobDescriptionId, filters])
  const urlStateSignature = useMemo(
    () => JSON.stringify({
      hasKeywordParam,
      hasJobDescriptionParam,
      hasUrlParams,
      location: parsedUrlState.location ?? '',
      keywords: parsedUrlState.keywords,
      jobDescriptionId: parsedUrlState.jobDescriptionId ?? '',
      selectedTags: parsedUrlState.selectedTags,
      selectedCompanies: parsedUrlState.selectedCompanies,
      selectedExperienceLevel: parsedUrlState.selectedExperienceLevel ?? '',
      filters: parsedUrlState.filters,
    }),
    [hasKeywordParam, hasJobDescriptionParam, hasUrlParams, parsedUrlState]
  )

  const {
    resumes,
    summary,
    loading,
    error,
    selectedSample,
    refresh,
    reloadSamples,
  } = useResumes({
    limit: 200,
    autoFetch: false,
    loadSamples: false,
    sessionId: undefined,
    jobDescriptionId,
  })

  const { actions, saveAction } = useCandidateActions(undefined)

  const expandedQuery = useMemo(() => {
    if (jobDescriptionId) return undefined
    const kw = sessionKeywords.join(' ').trim()
    if (!kw) return undefined
    return expandKeyword(kw, DEFAULT_CONFIG)
  }, [jobDescriptionId, sessionKeywords])

  const { resumes: convexResumes, loading: convexLoading } = useConvexResumes(200, expandedQuery, jobDescriptionId)
  const analysisTasks = useQuery(api.analysis_tasks.list)
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastDispatchTime, setLastDispatchTime] = useState<number>(0)
  const DISPATCH_COOLDOWN_MS = 2000
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || '/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const activeLoading = mode === 'ai' ? convexLoading : loading
  const hasActiveTask = useMemo(() => {
    if (!analysisTasks || analysisTasks.length === 0) {
      return false
    }
    return analysisTasks.some((task) => taskMatchesCurrentSearch(task, jobDescriptionId, sessionKeywords))
  }, [analysisTasks, jobDescriptionId, sessionKeywords])

  useEffect(() => {
    if (!hasUrlParams) {
      return
    }

    if (lastAppliedUrlStateRef.current === urlStateSignature) {
      return
    }

    lastAppliedUrlStateRef.current = urlStateSignature
    const jobDescriptionIdForExternalState =
      hasJobDescriptionParam
        ? (parsedUrlState.jobDescriptionId ?? '')
        : hasKeywordParam
          ? ''
          : parsedUrlState.jobDescriptionId

    console.debug('[url-hydrate]', {
      search: window.location.search,
      keywords: parsedUrlState.keywords,
      location: parsedUrlState.location,
      jobDescriptionIdForExternalState,
    })
    skipNextUrlSyncRef.current = true
    applyExternalState({
      location: parsedUrlState.location,
      keywords: parsedUrlState.keywords,
      jobDescriptionId: jobDescriptionIdForExternalState,
      filters: parsedUrlState.filters,
    })
    setSelectedTags(parsedUrlState.selectedTags)
    setSelectedCompanies(parsedUrlState.selectedCompanies)
    setSelectedExperienceLevel(parsedUrlState.selectedExperienceLevel)
  }, [
    applyExternalState,
    hasJobDescriptionParam,
    hasKeywordParam,
    hasUrlParams,
    parsedUrlState,
    urlStateSignature,
  ])

  useEffect(() => {
    if (!hasUrlParams) {
      lastAppliedUrlStateRef.current = null
    }
  }, [hasUrlParams])

  useEffect(() => {
    if (!hasInitializedUrlSyncRef.current) {
      hasInitializedUrlSyncRef.current = true
      return
    }

    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false
      return
    }

    const timer = window.setTimeout(() => {
      const normalizedLocation = sessionLocation.trim()
      const locationForUrl =
        normalizedLocation.length > 0 && normalizedLocation !== DEFAULT_LOCATION
          ? normalizedLocation
          : undefined

      console.debug('[url-sync]', {
        currentSearch: window.location.search,
        locationForUrl,
        keywords: sessionKeywords,
        jobDescriptionId,
      })
      syncToUrl({
        location: locationForUrl,
        keywords: sessionKeywords,
        jobDescriptionId,
        selectedTags,
        selectedCompanies,
        selectedExperienceLevel,
        filters,
      })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [
    filters,
    jobDescriptionId,
    selectedCompanies,
    selectedExperienceLevel,
    selectedTags,
    sessionKeywords,
    sessionLocation,
    syncToUrl,
  ])

  const filteredConvexResumes = useMemo(() => {
    let result: ScoredConvexResume[] = convexResumes
      .filter((resume: ConvexResumeItem) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        return !isAutoFilteredAnalysis(analysis)
      })
      .map((resume: ConvexResumeItem) => {
        // Pre-computed scores are hidden by default until explicit review.
        return {
          ...resume,
          _ruleScore: 0,
        }
      })

    result = [...result].sort((a: ScoredConvexResume, b: ScoredConvexResume) => b._ruleScore - a._ruleScore)

    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume: ScoredConvexResume) => locations.some((location) => resume.location?.includes(location)))
    }

    const minExperience = filters.minExperience
    if (typeof minExperience === 'number') {
      result = result.filter((resume: ScoredConvexResume) => parseExperienceYears(resume.experience) >= minExperience)
    }

    const maxExperience = filters.maxExperience
    if (typeof maxExperience === 'number') {
      result = result.filter((resume: ScoredConvexResume) => parseExperienceYears(resume.experience) <= maxExperience)
    }

    if (filters.education?.length) {
      result = result.filter((resume: ScoredConvexResume) =>
        matchesEducationFilter(resume.education, filters.education ?? [])
      )
    }

    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        return (analysis?.score ?? 0) >= minMatchScore
      })
    }

    if (selectedTags.length > 0) {
      const activeTagSet = new Set(selectedTags.map(normalizeFilterToken))
      result = result.filter((resume: ScoredConvexResume) =>
        (resume.ingestData?.industryTags ?? []).some((tag) => activeTagSet.has(normalizeFilterToken(tag)))
      )
    }

    if (selectedCompanies.length > 0) {
      const activeCompanySet = new Set(selectedCompanies.map(normalizeFilterToken))
      result = result.filter((resume: ScoredConvexResume) =>
        (resume.ingestData?.companyHits ?? []).some((company) => activeCompanySet.has(normalizeFilterToken(company)))
      )
    }

    if (selectedExperienceLevel) {
      result = result.filter((resume: ScoredConvexResume) =>
        normalizeFilterToken(resume.ingestData?.experienceLevel ?? '') === selectedExperienceLevel
      )
    }

    return result
  }, [convexResumes, filters, jobDescriptionId, selectedCompanies, selectedExperienceLevel, selectedTags, sessionKeywords])

  useEffect(() => {
    if (!session?.id) return
    if (hydratedSessionIdRef.current === session.id) return
    hydratedSessionIdRef.current = session.id
  }, [filters.minMatchScore, filters.skills?.length, session])

  useEffect(() => {
    if (!jobDescriptionId || sessionKeywords.length === 0) return
    setSessionKeywords([])
  }, [jobDescriptionId, sessionKeywords, setSessionKeywords])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [mode, jobDescriptionId, expandedQuery])

  const handleRefresh = useCallback(async () => {
    if (mode === 'ai') {
      return
    }
    await reloadSamples()
    await refresh()
  }, [mode, reloadSamples, refresh])

  const handleJobChange = useCallback(
    (value: string) => {
      if (value) {
        setSessionKeywords([])
      }
      setJobDescriptionId(value)
    },
    [setJobDescriptionId, setSessionKeywords]
  )

  const handleAnalyzeAll = useCallback(async () => {
    if (!convexResumes.length) return
    if (!jobDescriptionId && sessionKeywords.length === 0) return
    if (hasActiveTask) {
      toast.info(t('aiTasks.waitForCompletion', 'Please wait for current analysis to complete.'))
      return
    }

    const now = Date.now()
    if (now - lastDispatchTime < DISPATCH_COOLDOWN_MS) {
      toast.info(t('aiTasks.waitForCompletion', 'Please wait for current analysis to complete.'))
      return
    }

    setAnalyzing(true)
    try {
      const candidatesToAnalyze = filteredConvexResumes
        .filter((resume: ConvexResumeItem) => !getAnalysisForJob(resume, jobDescriptionId, sessionKeywords))
        .slice(0, 10)

      if (candidatesToAnalyze.length === 0) {
        toast.info(t('aiTasks.noNewCandidates', 'No new candidates to analyze among top matches.'))
        setAnalyzing(false)
        return
      }

      const resumeIds = candidatesToAnalyze.map((resume: ConvexResumeItem) => resume.resumeId)
      const normalizedKeywords = sessionKeywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0)

      if (!jobDescriptionId && normalizedKeywords.length > 0) {
        const matchCount = candidatesToAnalyze.filter((resume) => {
          const text = JSON.stringify(resume).toLowerCase()
          return normalizedKeywords.some((keyword) => text.includes(keyword))
        }).length

        if (matchCount === 0) {
          toast.warning(
            t(
              'aiTasks.lowKeywordMatch',
              'Keywords may not match displayed resumes. Consider collecting new resumes first.'
            )
          )
        }
      }

      if (jobDescriptionId) {
        let jdContent = ''
        let jdTitle = ''
        try {
          const { data } = await rawApiClient.GET<JobDescriptionApiResponse>(
            `/api/job-descriptions/${jobDescriptionId}`
          )
          if (data?.success && data.content) {
            jdTitle = data.item?.title || jobDescriptionId
            jdContent = data.content
          }
        } catch (error) {
          console.error('Failed to fetch JD', error)
        }

        await dispatchAnalysis({
          jobDescriptionId,
          jobDescriptionTitle: jdTitle || undefined,
          jobDescriptionContent: jdContent || undefined,
          sample: selectedSample || undefined,
          resumeIds,
        })
      } else if (sessionKeywords.length > 0) {
        await dispatchAnalysis({
          keywords: sessionKeywords,
          sample: selectedSample || undefined,
          resumeIds,
        })
      }

      setLastDispatchTime(Date.now())
      toast.success(t('aiTasks.dispatchedTop', { count: resumeIds.length, defaultValue: `Analyzing top ${resumeIds.length} candidates...` }))
    } catch (error) {
      console.error(error)
      toast.error(t('aiTasks.error'))
    } finally {
      setAnalyzing(false)
    }
  }, [
    convexResumes.length,
    dispatchAnalysis,
    filteredConvexResumes,
    hasActiveTask,
    jobDescriptionId,
    lastDispatchTime,
    selectedSample,
    sessionKeywords,
    t,
  ])

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      setFilters(nextFilters)
    },
    [setFilters]
  )

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((current) => toggleFilterValue(current, tag))
  }, [])

  const handleToggleCompany = useCallback((company: string) => {
    setSelectedCompanies((current) => toggleFilterValue(current, company))
  }, [])

  const handleToggleExperienceLevel = useCallback((level: string | undefined) => {
    const normalizedLevel = toExperienceLevel(level)
    if (!normalizedLevel) {
      return
    }

    setSelectedExperienceLevel((current) => (current === normalizedLevel ? undefined : normalizedLevel))
  }, [])

  const handleClearTagFilters = useCallback(() => {
    setSelectedTags([])
    setSelectedCompanies([])
    setSelectedExperienceLevel(undefined)
  }, [])

  const activeTagFilters = useMemo(
    () => new Set(selectedTags.map(normalizeFilterToken)),
    [selectedTags]
  )

  const activeCompanyFilters = useMemo(
    () => new Set(selectedCompanies.map(normalizeFilterToken)),
    [selectedCompanies]
  )

  const enrichedResumes = useMemo<EnrichedResume[]>(() => {
    if (mode === 'ai') {
      return filteredConvexResumes.map((resume: ScoredConvexResume, index: number) => {
        const resumeKey = buildResumeKey(resume, index)
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        const isAnalysisValid = !jobDescriptionId || analysis?.jobDescriptionId === jobDescriptionId

        const match: MatchingResult | undefined = analysis && isAnalysisValid
          ? {
            resumeId: resumeKey,
            score: analysis.score,
            summary: analysis.summary,
            highlights: analysis.highlights,
            recommendation: toRecommendation(analysis.recommendation),
            concerns: analysis.concerns ?? [],
            breakdown: toMatchBreakdown(analysis.breakdown),
            scoreSource: 'ai',
            matchedAt: new Date().toISOString(),
            jobDescriptionId: analysis.jobDescriptionId,
          }
          : undefined

        return {
          resume,
          key: resumeKey,
          match,
          ruleScore: resume._ruleScore || 0,
          action: actions[resumeKey],
        }
      })
    }

    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
      return {
        resume,
        key: resumeKey,
        match: undefined,
        ruleScore: 0,
        action: actions[resumeKey],
      }
    })
  }, [actions, filteredConvexResumes, jobDescriptionId, mode, resumes, sessionKeywords])

  const displayedResumes = useMemo(() => {
    const sortBy = filters.sortBy ?? 'score'
    const sortOrder = filters.sortOrder ?? 'desc'
    const direction = sortOrder === 'asc' ? 1 : -1

    return [...enrichedResumes].sort((a, b) => {
      if (sortBy === 'name') {
        return a.resume.name.localeCompare(b.resume.name, 'zh-Hans-CN') * direction
      }

      if (sortBy === 'experience') {
        return (parseExperienceYears(a.resume.experience) - parseExperienceYears(b.resume.experience)) * direction
      }

      if (sortBy === 'extractedAt') {
        return (parseExtractedAt(a.resume.extractedAt) - parseExtractedAt(b.resume.extractedAt)) * direction
      }

      const scoreA = a.match?.score ?? a.ruleScore ?? 0
      const scoreB = b.match?.score ?? b.ruleScore ?? 0
      return (scoreA - scoreB) * direction
    })
  }, [enrichedResumes, filters.sortBy, filters.sortOrder])

  const displayedResumeMap = useMemo(
    () => new Map(displayedResumes.map((entry) => [entry.key, entry.resume])),
    [displayedResumes]
  )

  const feedbackQuery = useMemo(() => {
    const parts = [...sessionKeywords]
    const normalizedLocation = sessionLocation.trim()
    if (normalizedLocation) {
      parts.push(normalizedLocation)
    }
    const query = parts.join(' ').trim()
    return query.length > 0 ? query : undefined
  }, [sessionKeywords, sessionLocation])

  const sendLearningFeedback = useCallback(
    (action: 'shortlist' | 'reject', resumeId: string, resume: ConvexResumeItem | ResumeItem | undefined) => {
      if (!resume || !hasIngestData(resume)) {
        return
      }

      const observation = buildLearningObservation(action, resume)
      void rawApiClient
        .POST<{ success: boolean; entry?: string }>('/api/resumes/learning-feedback', {
          body: {
            observation,
            action,
            resumeId,
            query: feedbackQuery,
          },
        })
        .catch((error: unknown) => {
          console.error('Failed to send learning feedback', error)
        })
    },
    [feedbackQuery]
  )

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(displayedResumes.map((entry) => entry.key)))
  }, [displayedResumes])

  const handleSelectHighScore = useCallback(() => {
    setSelectedIds(
      new Set(
        displayedResumes
          .filter((entry) => (entry.match?.score ?? 0) >= 80)
          .map((entry) => entry.key)
      )
    )
  }, [displayedResumes])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleToggleSelect = useCallback((resumeId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(resumeId)) {
        next.delete(resumeId)
      } else {
        next.add(resumeId)
      }
      return next
    })
  }, [])

  const handleBulkAction = useCallback(
    async (action: 'shortlist' | 'reject' | 'star' | 'export', format?: ResumeExportFormat) => {
      if (selectedIds.size === 0) return

      const selectedEntries = displayedResumes.filter((entry) => selectedIds.has(entry.key))

      if (action === 'export') {
        const exportEntries = selectedEntries.map(({ key, resume, match, action: currentAction, ruleScore }) => ({
          key,
          resume,
          match,
          action: currentAction,
          ruleScore: typeof match?.score === 'number' ? undefined : ruleScore,
        }))
        const exportFormat = format ?? bulkExportFormat

        try {
          const response = await fetch(`${apiBaseUrl}/api/resumes/export`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              format: exportFormat,
              entries: exportEntries,
            }),
          })

          if (!response.ok) {
            let message = `Export failed with status ${response.status}`
            try {
              const errorPayload = await response.json()
              const parsedErrorMessage = getExportErrorMessage(errorPayload)
              if (parsedErrorMessage) {
                message = parsedErrorMessage
              }
            } catch (error) {
              console.error('Failed to parse export error payload', error)
            }
            throw new Error(message)
          }

          const contentDisposition = response.headers.get('content-disposition')
          const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?$/)
          const filename = filenameMatch?.[1] || `selected-resumes-${new Date().toISOString().replace(/[:.]/g, '-')}.${exportFormat}`

          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = filename
          anchor.style.display = 'none'
          document.body.appendChild(anchor)
          try {
            anchor.click()
          } finally {
            anchor.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 1000)
          }
          toast.success(t('bulk.exported', { count: exportEntries.length, defaultValue: `Exported ${exportEntries.length} resumes` }))
          return
        } catch (error) {
          console.error('Export failed', error)
          toast.error(t('bulk.exportFailed', { defaultValue: 'Export failed. Please try again.' }))
          return
        }
      }

      try {
        if (action === 'shortlist' || action === 'reject') {
          selectedEntries.forEach((entry) => {
            sendLearningFeedback(action, entry.key, entry.resume)
          })
        }

        await Promise.all(
          selectedEntries.map((entry) =>
            saveAction({ resumeId: entry.key, actionType: action })
          )
        )
        const actionLabels: Record<string, string> = { shortlist: 'shortlisted', reject: 'rejected', star: 'starred' }
        toast.success(t('bulk.actionDone', { count: selectedEntries.length, action: actionLabels[action] || action, defaultValue: `${selectedEntries.length} resumes ${actionLabels[action] || action}` }))
      } catch (error) {
        console.error('Bulk action failed', error)
        toast.error(t('bulk.actionFailed', { defaultValue: 'Bulk action failed. Please try again.' }))
      }
    },
    [apiBaseUrl, bulkExportFormat, displayedResumes, saveAction, selectedIds, sendLearningFeedback, t]
  )

  const actionFeedbackLabels = useMemo<Partial<Record<CandidateActionType, string>>>(
    () => ({
      shortlist: t('resumes.actions.shortlist', '入围'),
      reject: t('resumes.actions.reject', '拒绝'),
      star: t('resumes.actions.star', '标星'),
      contact: '联系',
    }),
    [t]
  )

  const handleCardAction = useCallback(
    (resumeId: string, action: CandidateActionType) => {
      const actionLabel = actionFeedbackLabels[action] ?? action
      if (action === 'shortlist' || action === 'reject') {
        sendLearningFeedback(action, resumeId, displayedResumeMap.get(resumeId))
      }

      void saveAction({ resumeId, actionType: action })
        .then((result) => {
          if (result) {
            toast.success(`${actionLabel} 已保存`)
            return
          }

          toast.error('Action failed. Please try again.')
        })
        .catch((error: unknown) => {
          console.error('Individual action failed', error)
          toast.error('Action failed. Please try again.')
        })
    },
    [actionFeedbackLabels, displayedResumeMap, saveAction, sendLearningFeedback]
  )

  const highScoreCount = useMemo(() => {
    return displayedResumes.filter((entry) => (entry.match?.score ?? 0) >= 80).length
  }, [displayedResumes])

  const hasInput = Boolean(jobDescriptionId) || sessionKeywords.length > 0
  const disableAnalyzeButton = (filteredConvexResumes.length === 0 || analyzing || !hasInput || hasActiveTask)

  const handleQuickStartApply = useCallback(
    (config: {
      location: string
      keywords: string[]
      jobDescriptionId?: string
      filters?: Partial<ResumeFilters>
    }) => {
      console.debug('[quickStart-applyConfig]', config)
      const normalizedKeywords = config.keywords
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
      const normalizedLocation = config.location.trim()
      if (normalizedLocation) {
        setSessionLocation(normalizedLocation)
      }

      if (config.jobDescriptionId) {
        setSessionKeywords([])
        setJobDescriptionId(config.jobDescriptionId)
      } else {
        setSessionKeywords(normalizedKeywords)
        setJobDescriptionId((current) => (current ? '' : current))
      }

      if (config.filters) {
        setFilters((current) => ({
          ...current,
          ...config.filters,
        }))
      }
    },
    [setFilters, setJobDescriptionId, setSessionKeywords, setSessionLocation]
  )

  return {
    sessionLocation,
    sessionKeywords,
    jobDescriptionId,
    filters,
    reviewedIdsSet,
    trackReviewedResume,
    summary,
    resumes,
    convexResumes,
    selectedSample,
    error,
    activeLoading,
    analyzing,
    hasActiveTask,
    disableAnalyzeButton,
    selectedIds,
    selectedTags,
    selectedCompanies,
    selectedExperienceLevel,
    activeTagFilters,
    activeCompanyFilters,
    highScoreCount,
    bulkExportFormat,
    displayedResumes,
    setBulkExportFormat,
    handleAnalyzeAll,
    handleRefresh,
    handleQuickStartApply,
    handleJobChange,
    handleFiltersChange,
    handleToggleTag,
    handleToggleCompany,
    handleToggleExperienceLevel,
    handleClearTagFilters,
    handleSelectAll,
    handleSelectHighScore,
    handleClearSelection,
    handleToggleSelect,
    handleBulkAction,
    handleCardAction,
  }
}
