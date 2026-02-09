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

import { TaskMonitor } from './TaskMonitor'
import { useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'

export function ResumeList() {
  const { t } = useTranslation()
  const { session, updateSession } = useSession()
  const [mode, setMode] = useState<'ai' | 'original'>('ai')
  const [jobDescriptionId, setJobDescriptionId] = useState('')

  const dispatch = useMutation(api.resume_tasks.dispatch);

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
  const { results: matchResults, stats: matchStats, loading: matchLoading, error: matchError, matchAll, fetchMatches } = useAiMatching()
  const { actions, saveAction } = useCandidateActions(session?.id)

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

  const handleMatchAll = useCallback(async () => {
    if (!jobDescriptionId) return
    await matchAll({
      sessionId: session?.id,
      jobDescriptionId,
      sample: selectedSample || undefined,
      limit: 200,
    })
  }, [jobDescriptionId, matchAll, selectedSample, session?.id])

  const handleFiltersChange = useCallback(
    (nextFilters: typeof filters) => {
      setFilters(nextFilters)
      updateSession({ filters: nextFilters })
    },
    [setFilters, updateSession]
  )

  const aiStats = useMemo(() => {
    if (matchStats) return matchStats
    if (!matchResults.length) return null
    const processed = matchResults.length
    const matched = matchResults.filter((item) => item.score >= 50).length
    const avgScore = Number((matchResults.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    return { processed, matched, avgScore }
  }, [matchResults, matchStats])

  const matchMap = useMemo(() => {
    return new Map(matchResults.map((item) => [item.resumeId, item]))
  }, [matchResults])

  const enrichedResumes = useMemo(() => {
    return resumes.map((resume, index) => {
      const resumeKey = resume.resumeId || resume.perUserId || (resume.profileUrl && resume.profileUrl !== 'javascript:;' ? resume.profileUrl : `${resume.name}-${resume.extractedAt || index}`)
      return {
        resume,
        key: resumeKey,
        match: matchMap.get(resumeKey),
        action: actions[resumeKey],
      }
    })
  }, [actions, matchMap, resumes])

  const displayedResumes = useMemo(() => {
    if (mode !== 'ai') return enrichedResumes
    return [...enrichedResumes].sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1))
  }, [enrichedResumes, mode])

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
            setFilters({ ...filters, ...config.filters } as typeof filters)
            updateSession({ filters: { ...filters, ...config.filters } as typeof filters })
          }
        }}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('resumes.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('resumes.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('resumes.refresh')}
          </Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <SearchBar
              onSearch={handleSearch}
              onClear={handleClearSearch}
              loading={loading}
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                if (!query && !filters.locations?.length) {
                  alert("Please enter a keyword or location to start collection");
                  return;
                }
                dispatch({
                  keyword: query || "销售", // Fallback
                  location: filters.locations?.[0] || "",
                  limit: 200,
                  maxPages: 10
                });
              }}
            >
              Start Agent Collection
            </Button>
            <Button onClick={handleMatchAll} disabled={!jobDescriptionId || matchLoading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', matchLoading && 'animate-spin')} />
              {matchLoading ? t('resumes.matching.running') : t('resumes.matching.matchAll')}
            </Button>
          </div>
        </div>

        <TaskMonitor />

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <ModeToggle mode={mode} onModeChange={setMode} aiStats={aiStats ?? undefined} />
          {summary && !error ? (
            <div className="text-sm text-muted-foreground">
              {t('resumes.summary', {
                returned: summary.returned ?? resumes.length,
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
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.loading')}
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-sm text-destructive">{t('resumes.error')}</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          ) : resumes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('resumes.empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Bulk Action Bar - shown in AI mode */}
              {mode === 'ai' && displayedResumes.length > 0 && (
                <BulkActionBar
                  totalCount={displayedResumes.length}
                  selectedCount={0}
                  highScoreCount={highScoreCount}
                  onSelectHighScore={() => {
                    // TODO: Implement selection state
                    console.log('Select high score candidates')
                  }}
                  onBulkAction={(action) => {
                    console.log('Bulk action:', action)
                  }}
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
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ResumeDetail
        resume={detailResume}
        open={Boolean(detailResume)}
        onOpenChange={(open) => {
          if (!open) setDetailResume(null)
        }}
      />
    </div>
  )
}
