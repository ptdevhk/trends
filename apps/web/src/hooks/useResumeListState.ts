import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import { useConvexResumes, type ConvexResumeItem } from '@/hooks/useConvexResumes'
import { useSession } from '@/hooks/useSession'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { rawApiClient } from '@/lib/api-helpers'
import { expandKeyword, DEFAULT_CONFIG, calculateResumeScore } from '@/lib/trendradar/parser'
import type { CandidateActionType, MatchingResult, ResumeFilters } from '@/types/resume'
import {
  buildLearningObservation,
  buildResumeKey,
  buildRuleScoringText,
  getAnalysisForJob,
  getPrecomputedRuleScore,
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
  } = useSession()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkExportFormat, setBulkExportFormat] = useState<ResumeExportFormat>('csv')
  const [mode] = useState<'ai'>('ai')
  const hydratedSessionIdRef = useRef<string | null>(null)
  const session = useMemo(() => ({ id: 'convex', jobDescriptionId, filters }), [jobDescriptionId, filters])

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
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastDispatchTime, setLastDispatchTime] = useState<number>(0)
  const DISPATCH_COOLDOWN_MS = 2000
  const apiBaseUrl = useMemo(() => {
    const rawBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'
    return rawBaseUrl.replace(/\/api\/?$/, '')
  }, [])

  const activeLoading = mode === 'ai' ? convexLoading : loading

  const filteredConvexResumes = useMemo(() => {
    let result: ScoredConvexResume[] = convexResumes
      .filter((resume: ConvexResumeItem) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        return !isAutoFilteredAnalysis(analysis)
      })
      .map((resume: ConvexResumeItem) => {
        const precomputedScore = getPrecomputedRuleScore(resume, jobDescriptionId)
        if (precomputedScore !== null) {
          return {
            ...resume,
            _ruleScore: precomputedScore,
          }
        }

        const fallbackScore = calculateResumeScore(buildRuleScoringText(resume), DEFAULT_CONFIG).score
        return {
          ...resume,
          _ruleScore: fallbackScore,
        }
      })

    result = [...result].sort((a: ScoredConvexResume, b: ScoredConvexResume) => b._ruleScore - a._ruleScore)

    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume: ScoredConvexResume) => locations.some((location) => resume.location?.includes(location)))
    }

    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume: ScoredConvexResume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId, sessionKeywords)
        return (analysis?.score ?? 0) >= minMatchScore
      })
    }

    return result
  }, [convexResumes, filters, jobDescriptionId, sessionKeywords])

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
    return [...enrichedResumes].sort((a, b) => {
      const scoreA = a.match?.score ?? a.ruleScore ?? 0
      const scoreB = b.match?.score ?? b.ruleScore ?? 0
      return scoreB - scoreA
    })
  }, [enrichedResumes])

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
          anchor.click()
          URL.revokeObjectURL(url)
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
  const disableAnalyzeButton = (filteredConvexResumes.length === 0 || analyzing || !hasInput)

  const handleQuickStartApply = useCallback(
    (config: {
      location: string
      keywords: string[]
      jobDescriptionId?: string
      filters?: Partial<ResumeFilters>
    }) => {
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
        if (!config.jobDescriptionId && jobDescriptionId) {
          setJobDescriptionId('')
        }
      }

      if (config.filters) {
        setFilters({
          ...filters,
          ...config.filters,
        })
      }
    },
    [filters, jobDescriptionId, setFilters, setJobDescriptionId, setSessionKeywords, setSessionLocation]
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
    disableAnalyzeButton,
    selectedIds,
    highScoreCount,
    bulkExportFormat,
    displayedResumes,
    setBulkExportFormat,
    handleAnalyzeAll,
    handleRefresh,
    handleQuickStartApply,
    handleJobChange,
    handleFiltersChange,
    handleSelectAll,
    handleSelectHighScore,
    handleClearSelection,
    handleToggleSelect,
    handleBulkAction,
    handleCardAction,
  }
}
