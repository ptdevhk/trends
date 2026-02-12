import { useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, FileText, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeAnalysis, ConvexResumeItem } from '@/hooks/useConvexResumes'
import { ResumeCard } from '@/components/ResumeCard'
import type { CandidateActionType } from '@/types/resume'
import { ResumeDetail } from '@/components/ResumeDetail'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSession } from '@/hooks/useSession'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { FilterPanel } from '@/components/FilterPanel'
import { QuickStartPanel } from '@/components/QuickStartPanel'
import { BulkActionBar } from '@/components/BulkActionBar'
import { AnalysisTaskMonitor } from '@/components/AnalysisTaskMonitor'
import type { MatchBreakdown, MatchingResult, Recommendation } from '@/types/resume'

import { useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useConvexResumes } from '@/hooks/useConvexResumes'
import { rawApiClient } from '@/lib/api-helpers'
import { expandKeyword, DEFAULT_CONFIG, calculateResumeScore } from '@/lib/trendradar/parser'

type JobDescriptionApiResponse = {
  success: boolean
  item?: {
    title?: string
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

function ResumeCardSkeleton() {
  return (
    <div className="p-4 border rounded-lg space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  )
}

export function ResumeList() {
  const { t } = useTranslation()
  const { session, updateSession } = useSession()
  const [mode] = useState<'ai'>('ai')
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
  } = useResumes({
    limit: 200,
    autoFetch: mode !== 'ai',
    loadSamples: mode !== 'ai',
    sessionId: session?.id,
    jobDescriptionId,
  })

  const [detailResume, setDetailResume] = useState<ResumeItem | null>(null)

  const { actions, saveAction } = useCandidateActions(session?.id)

  // Convex Integration
  const expandedQuery = useMemo(() => {
    if (!query) return undefined
    return expandKeyword(query, DEFAULT_CONFIG)
  }, [query])

  const { resumes: convexResumes, loading: convexLoading } = useConvexResumes(200, expandedQuery)
  const dispatchAnalysis = useMutation(api.analysis_tasks.dispatch)
  const [analyzing, setAnalyzing] = useState(false)
  // Removed analysisDispatchMessage state

  const activeLoading = mode === 'ai' ? convexLoading : loading

  const filteredConvexResumes = useMemo(() => {
    let result = convexResumes

    // Hide resumes that were auto-skipped by the keyword pre-filter.
    result = result.filter((resume: ConvexResumeItem) => {
      const analysis = getAnalysisForJob(resume, jobDescriptionId)

      // Rule-Based Pre-Scoring
      // Concatenate fields for scoring
      const contentText = [
        resume.name,
        resume.jobIntention,
        resume.education,
        resume.experience,
        resume.location,
        resume.selfIntro,
        ...(resume.workHistory || []).map((w: { raw: string }) => w.raw), // Temporary any until workHistory type is fixed or we use a better type
        resume.tags?.join(' ')
      ].filter((item): item is string => !!item).join(' ')

      const ruleResult = calculateResumeScore(contentText, DEFAULT_CONFIG)

      // Auto-filter based on Analysis (AI Memory)
      if (isAutoFilteredAnalysis(analysis)) return false;

      // Attach rule score for sorting/filtering
      (resume as ConvexResumeItem & { _ruleScore?: number })._ruleScore = ruleResult.score;

      return true
    })

    // Sort by Rule Score descending (Pre-scoring)
    result.sort((a: ConvexResumeItem, b: ConvexResumeItem) => {
      const scoreA = (a as ConvexResumeItem & { _ruleScore?: number })._ruleScore || 0
      const scoreB = (b as ConvexResumeItem & { _ruleScore?: number })._ruleScore || 0
      return scoreB - scoreA
    })

    // 1. Keyword filter (query) - Handled by backend search now via useConvexResumes(expandedQuery)
    // We only keep client side highlighting or fallback if needed, but for filtering we rely on backend.

    // 2. Filter panel (filters)
    if (filters.locations?.length) {
      const locations = filters.locations
      result = result.filter((resume: ConvexResumeItem) => locations.some((location) => resume.location?.includes(location)))
    }
    const minMatchScore = filters.minMatchScore
    if (typeof minMatchScore === 'number') {
      result = result.filter((resume: ConvexResumeItem) => {
        const analysis = getAnalysisForJob(resume, jobDescriptionId)
        return (analysis?.score ?? 0) >= minMatchScore
      })
    }
    // Add other filters as data structure permits

    return result
  }, [convexResumes, filters, jobDescriptionId])

  useEffect(() => {
    if (session?.jobDescriptionId && !jobDescriptionId) {
      setJobDescriptionId(session.jobDescriptionId)
    }
    if (session?.sampleName && !selectedSample) {
      setSelectedSample(session.sampleName)
    }
    if (session?.filters && filters.minMatchScore === undefined && !filters.skills?.length) {
      setFilters(session.filters)
    }
  }, [
    filters.minMatchScore,
    filters.skills?.length,
    jobDescriptionId,
    selectedSample,
    session?.filters,
    session?.jobDescriptionId,
    session?.sampleName,
    setFilters,
    setSelectedSample,
  ])



  useEffect(() => {
    setSelectedIds(new Set())
  }, [mode, jobDescriptionId, query])

  // Removed analysisDispatchMessage useEffect



  const handleRefresh = useCallback(async () => {
    if (mode === 'ai') {
      return
    }
    await reloadSamples()
    await refresh()
  }, [mode, reloadSamples, refresh])

  const handleJobChange = useCallback(
    (value: string) => {
      setJobDescriptionId(value)
      updateSession({ jobDescriptionId: value })
    },
    [updateSession]
  )

  /*
  const handleMatchAll = useCallback(async () => {
    let result;
    // Path B: Job Description
    if (jobDescriptionId) {
      result = await matchAll({
        sessionId: session?.id,
        jobDescriptionId,
        sample: selectedSample || undefined,
        limit: 200,
        topN: 20,
        mode: 'hybrid',
      })
    }
    // Path A: Keywords
    else if (quickStartKeywords.length > 0) {
      result = await matchAll({
        sessionId: session?.id,
        keywords: quickStartKeywords,
        location: filters.locations?.[0],
        sample: selectedSample || undefined,
        limit: 200,
        topN: 20,
        mode: 'rules_only',
      })
    }
  }, [filters.locations, jobDescriptionId, matchAll, quickStartKeywords, selectedSample, session?.id, t])
  */

  const handleAnalyzeAll = async () => {
    if (!convexResumes.length) return
    if (!jobDescriptionId && quickStartKeywords.length === 0) return
    setAnalyzing(true)
    try {
      // Priority Selection: Top 10 Rule-Scored candidates not yet analyzed
      const candidatesToAnalyze = filteredConvexResumes
        .filter((r: ConvexResumeItem) => !getAnalysisForJob(r, jobDescriptionId))
        .slice(0, 10)

      if (candidatesToAnalyze.length === 0) {
        toast.info(t('aiTasks.noNewCandidates', 'No new candidates to analyze among top matches.'))
        setAnalyzing(false)
        return
      }

      const resumeIds = candidatesToAnalyze.map((r: ConvexResumeItem) => r.resumeId)

      if (jobDescriptionId) {
        // Path B: Job Description
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
          resumeIds,
        })
      } else if (quickStartKeywords.length > 0) {
        // Path A: Keywords
        await dispatchAnalysis({
          keywords: quickStartKeywords,
          sample: selectedSample || undefined,
          resumeIds,
        })
      }
      toast.success(t('aiTasks.dispatchedTop', { count: resumeIds.length, defaultValue: `Analyzing top ${resumeIds.length} candidates...` }));
    } catch (e) {
      console.error(e)
      toast.error(t('aiTasks.error'))
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

  type EnrichedResume = {
    resume: ConvexResumeItem | ResumeItem
    key: string
    match?: MatchingResult
    ruleScore?: number
    action?: CandidateActionType | undefined
  }

  const enrichedResumes = useMemo<EnrichedResume[]>(() => {
    if (mode === 'ai') {
      return filteredConvexResumes.map((resume: ConvexResumeItem, index: number) => {
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

        const ruleScore = (resume as ConvexResumeItem & { _ruleScore?: number })._ruleScore || 0

        return {
          resume,
          key: resumeKey,
          match,
          ruleScore, // Pass it down
          action: actions[resumeKey],
        }
      })
    }

    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
      return {
        resume,
        key: resumeKey,
        match: undefined, // No AI match in non-AI mode? Or map it if needed. 
        // Original code had matchMap.get(resumeKey) but we removed matchMap logic for 'ai' mode.
        // For strictness, if this path is dead or legacy, we might just return basic structure.
        ruleScore: 0,
        action: actions[resumeKey],
      }
    })
  }, [actions, filteredConvexResumes, jobDescriptionId, mode, resumes])

  const displayedResumes = useMemo(() => {
    // Sort by AI Score if available, otherwise by Rule Score
    return [...enrichedResumes].sort((a, b) => {
      const scoreA = a.match?.score ?? a.ruleScore ?? 0
      const scoreB = b.match?.score ?? b.ruleScore ?? 0
      return scoreB - scoreA
    })
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
        toast.success(t('bulk.exported', { count: selectedEntries.length, defaultValue: `Exported ${selectedEntries.length} resumes` }))
        return
      }

      try {
        await Promise.all(
          Array.from(selectedIds).map((resumeId) =>
            saveAction({ resumeId, actionType: action })
          )
        )
        const actionLabels: Record<string, string> = { shortlist: 'shortlisted', reject: 'rejected', star: 'starred' }
        toast.success(t('bulk.actionDone', { count: selectedIds.size, action: actionLabels[action] || action, defaultValue: `${selectedIds.size} resumes ${actionLabels[action] || action}` }))
      } catch (e) {
        console.error('Bulk action failed', e)
        toast.error(t('bulk.actionFailed', { defaultValue: 'Bulk action failed. Please try again.' }))
      }
    },
    [displayedResumes, saveAction, selectedIds, t]
  )

  // High score count for bulk actions
  const highScoreCount = useMemo(() => {
    return displayedResumes.filter((e) => (e.match?.score ?? 0) >= 80).length
  }, [displayedResumes])

  /*
  const hasInput = Boolean(jobDescriptionId) || quickStartKeywords.length > 0
  const disableAnalyzeButton = (!convexResumes.length || analyzing || !hasInput)
  */
  // Re-enabling for usage in Analyze All button
  const hasInput = Boolean(jobDescriptionId) || quickStartKeywords.length > 0
  const disableAnalyzeButton = (filteredConvexResumes.length === 0 || analyzing || !hasInput)

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
      } else {
        // If no JD, ensure we search by keywords
        // (already handled by quickStartKeywords state)
        if (!config.jobDescriptionId && jobDescriptionId) {
          setJobDescriptionId('');
          updateSession({ jobDescriptionId: undefined });
        }
      }

      // User requested that QuickStart keywords do NOT affect the "Filter" panel (frontend filters).
      // So we DO NOT update `filters.skills` here.
      // We only update location if explicit? User said "default nothing".
      // Maybe location should also not be auto-set in filters?
      // "frontend filter only, default nothing, not afect by keyword from user enter"
      // This implies the Filter Panel should be completely independent.
      // So I will comment out the filter updates.
      /*
      const nextFilters: typeof filters = { ...filters, minMatchScore: undefined }
      if (config.location.trim()) {
        nextFilters.locations = [config.location.trim()]
      }
      if (config.keywords.length > 0) {
        nextFilters.skills = config.keywords
      }
      setFilters(nextFilters)
      updateSession({ filters: nextFilters })
      */
    },
    [updateSession, jobDescriptionId]
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Removed analysisDispatchMessage JSX */}
      <QuickStartPanel
        onApplyConfig={handleQuickStartApply}
        jobDescriptionId={jobDescriptionId}
        onJobChange={handleJobChange}
        extraActions={
          <div className="flex items-center gap-2">
            {!selectedIds.size && (
              <Button
                onClick={handleAnalyzeAll}
                disabled={disableAnalyzeButton}
                size="sm"
                className="gap-2"
              >
                {analyzing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {t('aiTasks.analyzing')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    {t('resumes.analyzeAll')}
                  </>
                )}
              </Button>
            )}
            <AnalysisTaskMonitor />
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/*
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
            {t('common.refresh')}
          </Button>
        </div>
        */}
      </div>

      <FilterPanel
        filters={filters}
        onFiltersChange={handleFiltersChange}
        className=""
        defaultCollapsed={true}
        headerAction={
          <div className="flex items-center gap-4">
            {summary && !error && (
              <span className="text-xs text-muted-foreground">
                {t('resumes.summary', {
                  returned: mode === 'ai' ? displayedResumes.length : (summary.returned ?? resumes.length),
                  total: mode === 'ai' ? convexResumes.length : (summary.total ?? resumes.length),
                  sample: selectedSample || '--',
                })}
              </span>
            )}
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleRefresh} disabled={activeLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', activeLoading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      {/* 4. Task Monitor & Bulk Actions */}
      <div className="space-y-4">
        {/* Analysis monitor was moved to QuickStartPanel */}

        <div className="flex items-center justify-between py-2">
          <BulkActionBar
            totalCount={displayedResumes.length}
            selectedCount={selectedIds.size}
            highScoreCount={highScoreCount}
            onSelectAll={handleSelectAll}
            onSelectHighScore={handleSelectHighScore}
            onClearSelection={handleClearSelection}
            onBulkAction={handleBulkAction}
          />
          {/* Right side actions if any */}

        </div>
      </div>

      <div className="grid gap-4">
        {error ? (
          <EmptyState
            icon={AlertTriangle}
            title={t('resumes.loadError', 'Failed to load resumes')}
            description={t('resumes.loadErrorDesc', 'There was a problem connecting to the server. Please try again.')}
            action={
              <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        ) : activeLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <ResumeCardSkeleton key={i} />
          ))
        ) : displayedResumes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={t('resumes.noResumes', 'No resumes found')}
            description={t('resumes.noResumesDesc', 'Try adjusting your filters or search keywords.')}
          />
        ) : (
          displayedResumes.map((entry) => (
            <ResumeCard
              key={entry.key}
              resume={entry.resume}
              matchResult={entry.match}
              ruleScore={entry.ruleScore}
              actionType={entry.action}
              onAction={(action) => saveAction({ resumeId: entry.key, actionType: action })}
              onViewDetails={() => setDetailResume(entry.resume)}
              selected={selectedIds.has(entry.key)}
              onSelect={() => handleToggleSelect(entry.key)}
            />
          ))
        )}
      </div>
      <ResumeDetail
        resume={detailResume}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        matchResult={detailResume ? (displayedResumes.find(r => r.key === buildResumeKey(detailResume, 0)) as any)?.match : undefined}
        open={!!detailResume}
        onOpenChange={(open) => !open && setDetailResume(null)}
      />
    </div>
  )
}
