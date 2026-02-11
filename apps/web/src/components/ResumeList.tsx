import { useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeAnalysis, ConvexResumeItem } from '@/hooks/useConvexResumes'
import { ResumeCard } from '@/components/ResumeCard'
import { ResumeDetail } from '@/components/ResumeDetail'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ModeToggle } from '@/components/ModeToggle'
import { useSession } from '@/hooks/useSession'
import { useAiMatching } from '@/hooks/useAiMatching'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { FilterPanel } from '@/components/FilterPanel'
import { QuickStartPanel } from '@/components/QuickStartPanel'
import { BulkActionBar } from '@/components/BulkActionBar'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import { MatchRunHistory } from '@/components/MatchRunHistory'
import type { MatchBreakdown, MatchingResult, Recommendation } from '@/types/resume'

import { useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useConvexResumes } from '@/hooks/useConvexResumes'
import { rawApiClient } from '@/lib/api-helpers'

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
  }
  content?: string
}

type JobDescriptionDetailResponse = {
  success: boolean
  item?: {
    _id: string
    title: string
  }
  content?: string
}

const VALID_RECOMMENDATIONS: Recommendation[] = ['strong_match', 'match', 'potential', 'no_match']

function isRecommendation(value: string): value is Recommendation {
  return VALID_RECOMMENDATIONS.some((item) => item === value)
}

function toRecommendation(value: string): Recommendation {
  return isRecommendation(value) ? value : 'potential'
}

function toMatchBreakdown(value: Record<string, number> | undefined): MatchBreakdown | undefined {
  if (!value) return undefined
  const {
    skillMatch,
    experienceMatch,
    educationMatch,
    locationMatch,
    industryMatch,
  } = value
  if (
    typeof skillMatch !== 'number'
    || typeof experienceMatch !== 'number'
    || typeof educationMatch !== 'number'
    || typeof locationMatch !== 'number'
    || typeof industryMatch !== 'number'
  ) {
    return undefined
  }

  return {
    skillMatch,
    experienceMatch,
    educationMatch,
    locationMatch,
    industryMatch,
  }
}

function getAnalysisForJob(resume: ConvexResumeItem, selectedJobId: string): ConvexResumeAnalysis | undefined {
  if (selectedJobId && resume.analyses?.[selectedJobId]) {
    return resume.analyses[selectedJobId]
  }
  return resume.analysis
}

function isAutoFilteredAnalysis(analysis: ConvexResumeAnalysis | undefined): boolean {
  if (!analysis) return false
  const summary = analysis.summary || ''
  const keywordMatch = analysis.breakdown?.keyword_match
  return (
    summary.startsWith('Auto-filtered: Low keyword match with JD.')
    && analysis.recommendation === 'no_match'
    && keywordMatch === 10
  )
}

function buildResumeKey(resume: ResumeItem, index: number): string {
  if (resume.resumeId) {
    return resume.resumeId
  }
  if (resume.perUserId) {
    return resume.perUserId
  }
  if (resume.profileUrl && resume.profileUrl !== 'javascript:;') {
    return resume.profileUrl
  }
  return `${resume.name}-${resume.extractedAt || index}`
}

export function ResumeList() {
  const { t } = useTranslation()
  const { session, updateSession } = useSession()
  const [mode, setMode] = useState<'ai' | 'original'>('ai')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [quickStartKeywords, setQuickStartKeywords] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())


  const {
    resumes,
    summary,
    filters,
    loading,
    error,
    selectedSample,
    setSelectedSample,
    query,
    setFilters,
    refresh,
    reloadSamples,
  } = useResumes({ limit: 200, sessionId: session?.id, jobDescriptionId })

  const [detailResume, setDetailResume] = useState<ResumeItem | null>(null)
  const {
    results: matchResults,
    stats: matchStats,
    loading: matchLoading,
    error: matchError,
    progress: matchProgress,
    matchAll,
    fetchMatches,
  } = useAiMatching()
  const { actions, saveAction } = useCandidateActions(session?.id)

  // Convex Integration
  const { resumes: convexResumes, loading: convexLoading } = useConvexResumes()
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisDispatchMessage, setAnalysisDispatchMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const activeLoading = mode === 'ai' ? convexLoading : loading

  const filteredConvexResumes = useMemo(() => {
    let result = convexResumes

    // Hide resumes that were auto-skipped by the keyword pre-filter.
    result = result.filter((resume) => {
      const analysis = getAnalysisForJob(resume, jobDescriptionId)
      return !isAutoFilteredAnalysis(analysis)
    })

    // 1. Keyword filter (query)
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(r =>
        (r.name?.toLowerCase().includes(q)) ||
        (r.jobIntention?.toLowerCase().includes(q)) ||
        (r.education?.toLowerCase().includes(q)) ||
        (r.location?.toLowerCase().includes(q))
      )
    }

    // 2. Filter panel (filters)
    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume) => locations.some((location) => resume.location?.includes(location)))
    }
    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId)
        return (analysis?.score ?? 0) >= minMatchScore
      })
    }
    // Add other filters as data structure permits

    return result
  }, [convexResumes, filters, jobDescriptionId, query])

  useEffect(() => {
    if (session?.jobDescriptionId && !jobDescriptionId) {
      setJobDescriptionId(session.jobDescriptionId)
    }
    if (session?.sampleName && session.sampleName !== selectedSample) {
      setSelectedSample(session.sampleName)
    }
    if (session?.filters) {
      setFilters(session.filters)
    }
  }, [
    jobDescriptionId,
    selectedSample,
    session?.filters,
    session?.jobDescriptionId,
    session?.sampleName,
    setFilters,
    setSelectedSample,
  ])

  useEffect(() => {
    if (session?.id && jobDescriptionId) {
      fetchMatches(session.id, jobDescriptionId)
    }
  }, [fetchMatches, jobDescriptionId, session?.id])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [mode, jobDescriptionId, query])

  useEffect(() => {
    if (!analysisDispatchMessage) return
    const timer = window.setTimeout(() => setAnalysisDispatchMessage(null), 4000)
    return () => window.clearTimeout(timer)
  }, [analysisDispatchMessage])

  // Fetch selected job description details
  const [selectedJob, setSelectedJob] = useState<{ id: string; title: string; requirements?: string } | null>(null)

  useEffect(() => {
    async function loadJob() {
      if (!jobDescriptionId) {
        setSelectedJob(null)
        return
      }
      try {
        const { data } = await rawApiClient.GET<JobDescriptionDetailResponse>(
          `/api/job-descriptions/${jobDescriptionId}`
        )

        if (data?.success) {
          setSelectedJob({
            id: jobDescriptionId,
            title: data.item?.title || 'Unknown Position',
            requirements: data.content || ''
          })
        }
      } catch (err) {
        console.error('Failed to load job details', err)
      }
    }
    loadJob()
  }, [jobDescriptionId])

  const handleRefresh = useCallback(async () => {
    await reloadSamples()
    await refresh()
  }, [reloadSamples, refresh])

  const handleJobChange = useCallback(
    (value: string) => {
      setJobDescriptionId(value)
      updateSession({ jobDescriptionId: value })
    },
    [updateSession]
  )

  const handleMatchAll = useCallback(async () => {
    if (jobDescriptionId) {
      await matchAll({
        sessionId: session?.id,
        jobDescriptionId,
        sample: selectedSample || undefined,
        limit: 200,
        topN: 20,
        mode: 'hybrid',
      })
      return
    }

    if (quickStartKeywords.length === 0) return
    await matchAll({
      sessionId: session?.id,
      keywords: quickStartKeywords,
      location: filters.locations?.[0],
      sample: selectedSample || undefined,
      limit: 200,
      topN: 20,
      mode: 'rules_only',
    })
  }, [filters.locations, jobDescriptionId, matchAll, quickStartKeywords, selectedSample, session?.id])

  const handleAnalyzeAll = async () => {
    if (!convexResumes.length) return
    if (!jobDescriptionId && quickStartKeywords.length === 0) return
    setAnalyzing(true)
    try {
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
        } catch (err) {
          console.error('Failed to fetch JD', err)
        }

        await dispatchAnalysis({
          jobDescriptionId,
          jobDescriptionTitle: jdTitle || undefined,
          jobDescriptionContent: jdContent || undefined,
          sample: selectedSample || undefined,
          resumeIds: convexResumes.map((resume) => resume.resumeId),
        })
      } else if (quickStartKeywords.length > 0) {
        await dispatchAnalysis({
          keywords: quickStartKeywords,
          sample: selectedSample || undefined,
          resumeIds: convexResumes.map((resume) => resume.resumeId),
        })
      }
      setAnalysisDispatchMessage({ type: 'success', text: t('aiTasks.dispatched') })
    } catch (e) {
      console.error('Failed to dispatch analysis task', e)
      setAnalysisDispatchMessage({ type: 'error', text: t('aiTasks.dispatchFailed') })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      setFilters(nextFilters)
      updateSession({ filters: nextFilters })
    },
    [setFilters, updateSession]
  )

  const aiStats = useMemo(() => {
    // If using Convex data, stats are computed from analysis fields
    if (mode === 'ai') {
      const validResumes = convexResumes.filter((resume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId)
        return Boolean(
          analysis
          && !isAutoFilteredAnalysis(analysis)
          && (!jobDescriptionId || analysis.jobDescriptionId === jobDescriptionId)
        )
      })

      const processed = validResumes.length
      const matched = validResumes.filter((resume) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId)
        return (analysis?.score ?? 0) >= 60
      }).length

      const avgScore = processed
        ? Number(
          (
            validResumes.reduce((sum, resume) => {
              const analysis = getAnalysisForJob(resume, jobDescriptionId)
              return sum + (analysis?.score ?? 0)
            }, 0) / processed
          ).toFixed(2)
        )
        : 0

      return { processed, matched, avgScore }
    }
    if (matchStats) return matchStats
    if (!matchResults.length) return null
    const processed = matchResults.length
    const matched = matchResults.filter((item) => item.score >= 50).length
    const avgScore = Number((matchResults.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    return { processed, matched, avgScore }
  }, [matchResults, matchStats, mode, convexResumes, jobDescriptionId])

  const matchMap = useMemo(() => {
    return new Map(matchResults.map((item) => [item.resumeId, item]))
  }, [matchResults])

  const enrichedResumes = useMemo(() => {
    if (mode === 'ai') {
      return filteredConvexResumes.map((resume, index) => {
        const resumeKey = buildResumeKey(resume, index)
        const analysis = getAnalysisForJob(resume, jobDescriptionId)
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
          action: actions[resumeKey],
        }
      })
    }

    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
      return {
        resume,
        key: resumeKey,
        match: matchMap.get(resumeKey),
        action: actions[resumeKey],
      }
    })
  }, [actions, filteredConvexResumes, jobDescriptionId, matchMap, mode, resumes])

  const displayedResumes = useMemo(() => {
    return [...enrichedResumes].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1))
  }, [enrichedResumes])

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
    async (action: 'shortlist' | 'reject' | 'star' | 'export') => {
      if (selectedIds.size === 0) return

      if (action === 'export') {
        const selectedEntries = displayedResumes
          .filter((entry) => selectedIds.has(entry.key))
          .map(({ key, resume, match, action: currentAction }) => ({
            key,
            resume,
            match,
            action: currentAction,
          }))
        const blob = new Blob([JSON.stringify(selectedEntries, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `selected-resumes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        anchor.click()
        URL.revokeObjectURL(url)
        return
      }

      await Promise.all(
        Array.from(selectedIds).map((resumeId) =>
          saveAction({ resumeId, actionType: action })
        )
      )
    },
    [displayedResumes, saveAction, selectedIds]
  )

  // High score count for bulk actions
  const highScoreCount = useMemo(() => {
    return displayedResumes.filter((e) => (e.match?.score ?? 0) >= 80).length
  }, [displayedResumes])

  const hasInput = Boolean(jobDescriptionId) || quickStartKeywords.length > 0
  const disableAnalyzeButton = mode === 'ai'
    ? (!convexResumes.length || analyzing || !hasInput)
    : (matchLoading || !hasInput)

  const handleQuickStartApply = useCallback(
    (config: {
      location: string
      keywords: string[]
      jobDescriptionId?: string
    }) => {
      setQuickStartKeywords(config.keywords)
      if (config.jobDescriptionId) {
        setJobDescriptionId(config.jobDescriptionId)
        updateSession({ jobDescriptionId: config.jobDescriptionId })
      }

      const nextFilters = { ...filters }
      if (config.location.trim()) {
        nextFilters.locations = [config.location.trim()]
      }
      if (config.keywords.length > 0) {
        nextFilters.skills = config.keywords
      }
      setFilters(nextFilters)
      updateSession({ filters: nextFilters })
    },
    [filters, updateSession, setFilters]
  )

  return (
    <div className="flex flex-col gap-4">
      <QuickStartPanel
        onApplyConfig={handleQuickStartApply}
        jobDescriptionId={jobDescriptionId}
        onJobChange={handleJobChange}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeToggle mode={mode} onModeChange={setMode} aiStats={aiStats ?? undefined} />
        <div className="flex flex-wrap items-center gap-2">
          {summary && !error ? (
            <span className="text-sm text-muted-foreground">
              {t('resumes.summary', {
                returned: mode === 'ai' ? displayedResumes.length : (summary.returned ?? resumes.length),
                total: mode === 'ai' ? convexResumes.length : (summary.total ?? resumes.length),
                sample: selectedSample || '--',
              })}
            </span>
          ) : null}
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={activeLoading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', activeLoading && 'animate-spin')} />
            {t('resumes.refresh')}
          </Button>
          <Button
            size="sm"
            onClick={mode === 'ai' ? handleAnalyzeAll : handleMatchAll}
            disabled={disableAnalyzeButton}
            title={!hasInput ? t('resumes.selectKeywordsOrJobDescription', '请选择关键词或职位描述') : undefined}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', (analyzing || matchLoading) && 'animate-spin')} />
            {mode === 'ai'
              ? (analyzing ? 'Analyzing...' : 'Analyze All (AI)')
              : (matchLoading ? t('resumes.matching.running') : t('resumes.matching.matchAll'))}
          </Button>
        </div>
      </div>

      {analysisDispatchMessage ? (
        <div
          className={cn(
            'w-fit rounded-md px-2.5 py-1.5 text-xs',
            analysisDispatchMessage.type === 'success'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-destructive/10 text-destructive'
          )}
          role="status"
        >
          {analysisDispatchMessage.text}
        </div>
      ) : null}

      <FilterPanel filters={filters} onChange={handleFiltersChange} mode={mode} />

      {matchError ? (
        <div className="text-xs text-destructive">{matchError}</div>
      ) : null}
      {mode !== 'ai' && matchProgress ? (
        <div className="text-xs text-muted-foreground">
          AI progress: {matchProgress.done}/{matchProgress.total}
        </div>
      ) : null}

      {mode === 'ai' ? (
        <AnalysisTaskMonitor />
      ) : (
        <MatchRunHistory sessionId={session?.id} jobDescriptionId={jobDescriptionId || undefined} />
      )}

      <div className="space-y-3">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t('resumes.tableTitle')}
          {mode === 'ai' ? (
            <span className="text-xs font-normal text-muted-foreground">
              {t('resumes.matching.sortedByScore')}
            </span>
          ) : null}
        </h2>

        {activeLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('resumes.loading')}
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-destructive">{t('resumes.error')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          </div>
        ) : displayedResumes.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {t('resumes.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {mode === 'ai' && displayedResumes.length > 0 ? (
              <BulkActionBar
                totalCount={displayedResumes.length}
                selectedCount={selectedIds.size}
                highScoreCount={highScoreCount}
                onSelectAll={handleSelectAll}
                onSelectHighScore={handleSelectHighScore}
                onClearSelection={handleClearSelection}
                onBulkAction={handleBulkAction}
              />
            ) : null}
            {displayedResumes.map((entry, index) => (
              <ResumeCard
                key={entry.key || `${index}-${entry.resume.name}`}
                resume={entry.resume}
                matchResult={entry.match}
                showAiScore={Boolean(entry.match)}
                actionType={entry.action}
                onAction={(actionType) => saveAction({ resumeId: entry.key, actionType })}
                onViewDetails={() => setDetailResume(entry.resume)}
                selected={selectedIds.has(entry.key)}
                onSelect={() => handleToggleSelect(entry.key)}
                jobDescriptionId={jobDescriptionId}
                jobDescription={selectedJob || undefined}
              />
            ))}
          </div>
        )}
      </div>

      <ResumeDetail
        resume={detailResume}
        matchResult={displayedResumes.find(r => r.resume.resumeId === detailResume?.resumeId)?.match}
        open={Boolean(detailResume)}
        onOpenChange={(open) => {
          if (!open) setDetailResume(null)
        }}
      />
    </div>
  )
}
