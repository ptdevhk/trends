import { useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useResumes, type ResumeItem } from '@/hooks/useResumes'
import { ResumeCard } from '@/components/ResumeCard'
import { ResumeDetail } from '@/components/ResumeDetail'
import { SearchBar } from '@/components/SearchBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ModeToggle } from '@/components/ModeToggle'
import { JobDescriptionSelect } from '@/components/JobDescriptionSelect'
import { useSession } from '@/hooks/useSession'
import { useAiMatching } from '@/hooks/useAiMatching'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { FilterPanel } from '@/components/FilterPanel'
import { QuickStartPanel } from '@/components/QuickStartPanel'
import { BulkActionBar } from '@/components/BulkActionBar'
import type { ResumeFilters } from '@/types/resume'

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

function normalizeEducationFilter(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null

  const lower = normalized.toLowerCase()
  if (['high_school', 'associate', 'bachelor', 'master', 'phd'].includes(lower)) {
    return lower
  }

  if (/博士/.test(normalized)) return 'phd'
  if (/硕士|研究生/.test(normalized)) return 'master'
  if (/本科/.test(normalized)) return 'bachelor'
  if (/大专|专科/.test(normalized)) return 'associate'
  if (/中专|高中|中技/.test(normalized)) return 'high_school'
  return null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function ResumeList() {
  const { t } = useTranslation()
  const { session, updateSession } = useSession()
  const [mode, setMode] = useState<'ai' | 'original'>('ai')
  const [jobDescriptionId, setJobDescriptionId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())


  const {
    resumes,
    samples,
    summary,
    filters,
    loading,
    error,
    selectedSample,
    setSelectedSample,
    query, // Added query
    setQuery,
    setFilters,
    refresh,
    reloadSamples,
  } = useResumes({ limit: 200, sessionId: session?.id, jobDescriptionId })

  const [detailResume, setDetailResume] = useState<ResumeItem | null>(null)
  const {
    results: matchResults,
    stats: matchStats,
    loading: matchLoading,
    streaming: matchStreaming,
    progress: matchProgress,
    error: matchError,
    matchAll,
    streamMatches,
    resultsMap,
  } = useAiMatching()
  const { actions, saveAction } = useCandidateActions(session?.id)

  const activeLoading = loading

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
    setSelectedIds(new Set())
  }, [mode, jobDescriptionId, query])

  const sampleOptions = useMemo(
    () =>
      samples.map((sample) => ({
        value: sample.name,
        label: sample.name,
      })),
    [samples]
  )

  const handleSearch = useCallback(
    (keyword: string) => {
      setQuery(keyword)
    },
    [setQuery]
  )

  const handleClearSearch = useCallback(() => {
    setQuery('')
  }, [setQuery])

  const handleRefresh = useCallback(async () => {
    await reloadSamples()
    await refresh()
  }, [reloadSamples, refresh])

  const handleSampleChange = useCallback(
    (value: string) => {
      setSelectedSample(value)
      updateSession({ sampleName: value })
    },
    [setSelectedSample, updateSession]
  )

  const handleJobChange = useCallback(
    (value: string) => {
      setJobDescriptionId(value)
      updateSession({ jobDescriptionId: value })
    },
    [updateSession]
  )

  const runRuleScoring = useCallback(async () => {
    if (!jobDescriptionId) return null
    return await matchAll({
      sessionId: session?.id,
      jobDescriptionId,
      sample: selectedSample || undefined,
      limit: 200,
      mode: 'rules_only',
    })
  }, [jobDescriptionId, matchAll, selectedSample, session?.id])

  useEffect(() => {
    if (mode !== 'ai') return
    if (!jobDescriptionId) return
    void runRuleScoring()
  }, [jobDescriptionId, mode, runRuleScoring])

  const handleDeepAnalyze = useCallback(async () => {
    if (!jobDescriptionId) return
    await streamMatches({
      sessionId: session?.id,
      jobDescriptionId,
      sample: selectedSample || undefined,
      limit: 200,
    })
  }, [jobDescriptionId, selectedSample, session?.id, streamMatches])

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      setFilters(nextFilters)
      updateSession({ filters: nextFilters })
    },
    [setFilters, updateSession]
  )

  const aiStats = useMemo(() => {
    if (mode !== 'ai') return null
    if (matchStats) return matchStats
    if (!matchResults.length) return null
    const processed = matchResults.length
    const matched = matchResults.filter((item) => item.score >= 50).length
    const avgScore = Number((matchResults.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    return { processed, matched, avgScore }
  }, [matchResults, matchStats, mode])

  const enrichedResumes = useMemo(() => {
    return resumes.map((resume, index) => {
      const resumeKey = buildResumeKey(resume, index)
      return {
        resume,
        key: resumeKey,
        match: resultsMap.get(resumeKey),
        action: actions[resumeKey],
      }
    })
  }, [actions, resumes, resultsMap])

  const displayedResumes = useMemo(() => {
    if (mode !== 'ai') return enrichedResumes
    return [...enrichedResumes].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1))
  }, [enrichedResumes, mode])

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

  return (
    <div className="flex flex-col gap-6">
      {/* Quick Start Panel - Minimal Input */}
      <QuickStartPanel
        onApplyConfig={(config) => {
          if (config.jobDescriptionId) {
            setJobDescriptionId(config.jobDescriptionId)
            updateSession({ jobDescriptionId: config.jobDescriptionId })
          }
          if (config.filters) {
            const nextFilters: ResumeFilters = { ...filters }
            if (typeof config.filters.minExperience === 'number') {
              nextFilters.minExperience = config.filters.minExperience
            }
            if (typeof config.filters.maxExperience === 'number') {
              nextFilters.maxExperience = config.filters.maxExperience
            }
            if (Array.isArray(config.filters.education)) {
              nextFilters.education = config.filters.education
                .filter(isString)
                .map(normalizeEducationFilter)
                .filter((value): value is string => Boolean(value))
            }
            if (config.filters.salaryRange) {
              if (typeof config.filters.salaryRange.min === 'number') nextFilters.minSalary = config.filters.salaryRange.min
              if (typeof config.filters.salaryRange.max === 'number') nextFilters.maxSalary = config.filters.salaryRange.max
            }

            setFilters(nextFilters)
            updateSession({ filters: nextFilters })
          }
        }}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('resumes.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('resumes.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              {t('resumes.refresh')}
            </Button>
            {mode === 'ai' ? (
              <Button
                onClick={handleDeepAnalyze}
                disabled={!jobDescriptionId || matchLoading || matchStreaming}
                title={!jobDescriptionId ? t('resumes.selectJobDescriptionFirst') : undefined}
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', (matchLoading || matchStreaming) && 'animate-spin')} />
                {matchStreaming ? t('resumes.matching.running') : 'Deep Analyze (AI)'}
                {matchProgress ? ` (${matchProgress.done}/${matchProgress.total})` : ''}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <SearchBar
              onSearch={handleSearch}
              onClear={handleClearSearch}
              loading={activeLoading}
              placeholder={t('resumes.searchPlaceholder')}
              buttonLabel={t('resumes.searchButton')}
            />
          </div>
          <div className="lg:w-60">
            <Select
              options={sampleOptions}
              value={selectedSample}
              onChange={(event) => handleSampleChange(event.target.value)}
              disabled={sampleOptions.length === 0}
            />
          </div>
          <div className="lg:w-64">
            <JobDescriptionSelect value={jobDescriptionId} onChange={handleJobChange} />
          </div>
        </div>


        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <ModeToggle mode={mode} onModeChange={setMode} aiStats={aiStats ?? undefined} />
          {summary && !error ? (
            <div className="text-sm text-muted-foreground">
              {t('resumes.summary', {
                returned: summary.returned ?? displayedResumes.length,
                total: summary.total ?? resumes.length,
                sample: selectedSample || '--',
              })}
            </div>
          ) : null}
        </div>

        <FilterPanel filters={filters} onChange={handleFiltersChange} mode={mode} />

        {matchError ? (
          <div className="text-xs text-destructive">{matchError}</div>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {t('resumes.tableTitle')}
            {mode === 'ai' ? (
              <span className="text-xs font-normal text-muted-foreground">
                {t('resumes.matching.sortedByScore')}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.loading')}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">{t('resumes.error')}</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          ) : displayedResumes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Bulk Action Bar - shown in AI mode */}
              {mode === 'ai' && displayedResumes.length > 0 && (
                <BulkActionBar
                  totalCount={displayedResumes.length}
                  selectedCount={selectedIds.size}
                  highScoreCount={highScoreCount}
                  onSelectAll={handleSelectAll}
                  onSelectHighScore={handleSelectHighScore}
                  onClearSelection={handleClearSelection}
                  onBulkAction={handleBulkAction}
                />
              )}
              {displayedResumes.map((entry, index) => (
                <ResumeCard
                  key={entry.key || `${index}-${entry.resume.name}`}
                  resume={entry.resume}
                  matchResult={entry.match}
                  showAiScore={mode === 'ai'}
                  actionType={entry.action}
                  onAction={(actionType) => saveAction({ resumeId: entry.key, actionType })}
                  onViewDetails={() => setDetailResume(entry.resume)}
                  selected={selectedIds.has(entry.key)}
                  onSelect={() => handleToggleSelect(entry.key)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
