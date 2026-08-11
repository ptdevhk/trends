import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  getLabelDescriptor,
  INGEST_BRAND_CONTEXT_LABELS,
  INGEST_BRAND_ROLE_LABELS,
  INGEST_BRAND_SOURCE_LABELS,
  sanitizeResumeRecordForSurface,
} from '@trends/shared'
import { useAction, useMutation, usePaginatedQuery } from 'convex/react'
import { useSourceFacets } from '@/hooks/useSourceFacets'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Database, ChevronDown, ChevronRight, Trash2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/PageHeader'
import { ResumeRefreshBadge } from '@/components/ResumeRefreshBadge'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { SourceFacetSelect } from '@/components/SourceFacetSelect'
import { CURRENT_RESUME_SKILLS_VERSION, resolveResumeRefreshState } from '@/lib/resume-freshness'
import { apiClient } from '@/lib/api-client'
import { reportUiError } from '@/lib/ui-error-reporting'

type IngestDiagnosticsResume = {
  resumeId: string
  externalId: string
  source: string
  sourceKey: string
  name: string
  jobIntention: string
  location: string
  isArchived?: boolean
  archivedAt?: number
  ingestData?: {
    industryTags: string[]
    companyHits: string[]
    brandHits: Array<{
      brand: string
      role: string
      source: string
      context: string
    }>
    experienceLevel: string
    ruleScoreCount: number
    computedAt: number
    skillsVersion: number
    ingestComputeEpoch?: number
    taggingEntries: Array<{
      tag: string
      source: string
      confidence: number
      provenance: {
        stage: string
        evidence: string[]
      }
    }>
  }
}

type DeleteResumesResult = {
  requested: number
  deleted: number
  missingResumeIds: string[]
  deletedAiTaggingResults: number
  patchedScreeningSessions: number
}

const INGEST_DIAGNOSTICS_PAGE_SIZE = 100

function getSearchTarget(resume: IngestDiagnosticsResume): string {
  return [
    resume.externalId,
    resume.source,
    resume.sourceKey,
    resume.name,
    resume.jobIntention,
    resume.location,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function getResumeLabel(resume: IngestDiagnosticsResume): string {
  const name = resume.name.trim()
  if (name) {
    return name
  }
  const externalId = resume.externalId.trim()
  if (externalId) {
    return externalId
  }
  return resume.resumeId
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return new Date(value).toLocaleString()
}

type CurrentIngestVersionState = {
  version: number
  ingestComputeEpoch: number
}

function parseSkillsVersionPayload(value: unknown): CurrentIngestVersionState | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const payload = value as Record<string, unknown>
  if (payload.success !== true) {
    return null
  }
  if (typeof payload.version !== 'number') {
    return null
  }

  return {
    version: payload.version,
    ingestComputeEpoch:
      typeof payload.ingestComputeEpoch === 'number'
        ? payload.ingestComputeEpoch
        : CURRENT_INGEST_COMPUTE_EPOCH,
  }
}

function formatBrandHitLabel(
  brand: string,
  source: string,
  context: string,
  role: string,
  translate: (key: string, options?: { defaultValue?: string }) => string,
): string {
  const sourceDescriptor = getLabelDescriptor(source, INGEST_BRAND_SOURCE_LABELS)
  const contextDescriptor = getLabelDescriptor(context, INGEST_BRAND_CONTEXT_LABELS)
  const roleDescriptor = getLabelDescriptor(role, INGEST_BRAND_ROLE_LABELS)

  const sourceLabel = translate(sourceDescriptor?.labelKey ?? source, { defaultValue: sourceDescriptor?.defaultLabel ?? source })
  const contextLabel = translate(contextDescriptor?.labelKey ?? context, { defaultValue: contextDescriptor?.defaultLabel ?? context })
  const roleLabel = translate(roleDescriptor?.labelKey ?? role, { defaultValue: roleDescriptor?.defaultLabel ?? role })

  return `${brand.toUpperCase()} (${sourceLabel} / ${contextLabel} / ${roleLabel})`
}

function formatTaggingEntry(entry: {
  tag: string
  source: string
  confidence: number
  provenance: {
    stage: string
    evidence: string[]
  }
}): string {
  const evidence = entry.provenance.evidence.slice(0, 2).join(' | ')
  const evidenceSuffix = evidence ? `; ${evidence}` : ''
  return `${entry.tag} (${entry.source}, ${entry.confidence}, ${entry.provenance.stage}${evidenceSuffix})`
}

export default function DebugIngest() {
  const { t } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[]>([])
  const { facets: sourceFacets } = useSourceFacets(false)
  const {
    results: paginatedResumes,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.resumes_diagnostics.listIngestDiagnostics,
    selectedSourceKeys.length > 0 ? { sourceKeys: selectedSourceKeys } : {},
    { initialNumItems: INGEST_DIAGNOSTICS_PAGE_SIZE }
  )
  const backfillIngestData = useAction(api.migrations.backfillIngestData)
  const reIngestStaleSkillsVersion = useAction(api.migrations.reIngestStaleSkillsVersion)
  const reIngestAllResumes = useAction(api.migrations.reIngestAllResumes)
  const clearAnalysesMutation = useMutation(api.resumes_mutations.clearAnalyses)
  const hardResetIngestDataMutation = useMutation(api.resumes_mutations.hardResetIngestData)
  const resetDatabaseMutation = useMutation(api.resume_tasks.resetDatabase)
  const deleteResumesMutation = useMutation(api.resumes_mutations.deleteResumes)
  const archiveResumesMutation = useMutation(api.resumes_mutations.archiveResumes)

  const [search, setSearch] = useState('')
  const [skillsVersionState, setSkillsVersionState] = useState<CurrentIngestVersionState | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedResumeIds, setSelectedResumeIds] = useState<Set<string>>(new Set())
  const [resumePendingDelete, setResumePendingDelete] = useState<IngestDiagnosticsResume | null>(null)
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false)
  const [archivingResumes, setArchivingResumes] = useState(false)
  const [reingesting, setReingesting] = useState(false)
  const [clearingAnalyses, setClearingAnalyses] = useState(false)
  const [hardResetting, setHardResetting] = useState(false)
  const [resettingDatabase, setResettingDatabase] = useState(false)
  const [deletingResumes, setDeletingResumes] = useState(false)
  const [hardResetDialogOpen, setHardResetDialogOpen] = useState(false)
  const [clearAnalysesDialogOpen, setClearAnalysesDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)

  const loadSkillsVersion = useCallback(async () => {
    setVersionLoading(true)
    try {
      const { data, response } = await apiClient.GET('/api/resumes/skills-version')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const version = parseSkillsVersionPayload(data)
      if (version === null) {
        throw new Error('Invalid skills version response')
      }
      setSkillsVersionState(version)
    } catch (error) {
      reportUiError('Failed to fetch skills version', error)
      toast.error(t('debugIngest.skillsVersionFailed', { defaultValue: 'Failed to load skills version' }))
    } finally {
      setVersionLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadSkillsVersion()
  }, [loadSkillsVersion])
  const resumes = useMemo(
    () => paginatedResumes.map((resume) => sanitizeResumeRecordForSurface(resume, 'debug', fieldUsagePolicy)),
    [fieldUsagePolicy, paginatedResumes],
  )
  const loading = status === 'LoadingFirstPage'
  const canLoadMore = status === 'CanLoadMore'
  const hasMoreAvailable = status === 'CanLoadMore' || status === 'LoadingMore'

  useEffect(() => {
    const loadedResumeIds = new Set(resumes.map((resume) => String(resume.resumeId)))

    setSelectedResumeIds((previous) => {
      const next = new Set([...previous].filter((resumeId) => loadedResumeIds.has(resumeId)))
      return next.size === previous.size ? previous : next
    })

    setExpandedIds((previous) => {
      const nextIds = [...previous].filter((resumeId) => loadedResumeIds.has(resumeId))
      return nextIds.length === previous.size ? previous : new Set(nextIds)
    })

    setResumePendingDelete((previous) => {
      if (!previous) {
        return previous
      }
      return loadedResumeIds.has(String(previous.resumeId)) ? previous : null
    })
  }, [resumes])

  useEffect(() => {
    if (!deletingResumes && bulkDeleteDialogOpen && selectedResumeIds.size === 0) {
      setBulkDeleteDialogOpen(false)
    }
  }, [bulkDeleteDialogOpen, deletingResumes, selectedResumeIds])

  // When a source-key filter is active, the Convex query does an overfetch-and-filter
  // in a single .paginate() call. Auto-advance loadMore until we have a full page of
  // matches, the server reports Exhausted, or a safety round cap is reached. This lets
  // users see results without manually clicking "Load More" through empty batches.
  const autoLoadRoundsRef = useRef(0)
  useEffect(() => {
    autoLoadRoundsRef.current = 0
  }, [selectedSourceKeys])
  useEffect(() => {
    const LAZY_LOAD_TARGET = INGEST_DIAGNOSTICS_PAGE_SIZE
    const MAX_AUTO_ROUNDS = 20
    if (
      selectedSourceKeys.length > 0 &&
      paginatedResumes.length < LAZY_LOAD_TARGET &&
      status === 'CanLoadMore' &&
      autoLoadRoundsRef.current < MAX_AUTO_ROUNDS
    ) {
      autoLoadRoundsRef.current += 1
      loadMore(INGEST_DIAGNOSTICS_PAGE_SIZE)
    }
  }, [selectedSourceKeys, paginatedResumes.length, status, loadMore])

  const filteredResumes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return resumes
    }
    return resumes.filter((resume) => getSearchTarget(resume).includes(query))
  }, [resumes, search])

  const visibleResumeIds = useMemo(
    () => filteredResumes.map((resume) => String(resume.resumeId)),
    [filteredResumes],
  )
  const selectedVisibleCount = useMemo(
    () => visibleResumeIds.filter((resumeId) => selectedResumeIds.has(resumeId)).length,
    [selectedResumeIds, visibleResumeIds],
  )
  const allVisibleSelected = visibleResumeIds.length > 0 && selectedVisibleCount === visibleResumeIds.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  const withIngestCount = useMemo(
    () => resumes.filter((resume) => resume.ingestData !== undefined).length,
    [resumes],
  )
  const currentSkillsVersion = skillsVersionState?.version ?? CURRENT_RESUME_SKILLS_VERSION
  const currentIngestComputeEpoch = skillsVersionState?.ingestComputeEpoch ?? CURRENT_INGEST_COMPUTE_EPOCH

  const staleCount = useMemo(() => {
    return resumes.filter((resume) =>
      resolveResumeRefreshState({
        resume,
        currentSkillsVersion,
        currentIngestComputeEpoch,
      }).ingestStale
    ).length
  }, [currentIngestComputeEpoch, currentSkillsVersion, resumes])

  const toggleExpanded = useCallback((resumeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(resumeId)) {
        next.delete(resumeId)
      } else {
        next.add(resumeId)
      }
      return next
    })
  }, [])

  const toggleSelectAllVisible = useCallback((checked: boolean) => {
    setSelectedResumeIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        for (const id of visibleResumeIds) next.add(id)
      } else {
        for (const id of visibleResumeIds) next.delete(id)
      }
      return next
    })
  }, [visibleResumeIds])

  const toggleSelectResume = useCallback((resumeId: string, checked: boolean) => {
    setSelectedResumeIds((previous) => {
      const next = new Set(previous)
      if (checked) next.add(resumeId)
      else next.delete(resumeId)
      return next
    })
  }, [])

  const createDeleteSummaryMessage = useCallback((result: DeleteResumesResult) => {
    if (result.deleted === 0) {
      return t('debugIngest.deleteNoop', {
        missing: result.missingResumeIds.length,
        defaultValue: `No resumes were deleted; ${result.missingResumeIds.length} requested ID(s) were missing.`,
      })
    }

    if (result.missingResumeIds.length > 0) {
      return t('debugIngest.deleteSuccessWithMissing', {
        deleted: result.deleted,
        tagging: result.deletedAiTaggingResults,
        sessions: result.patchedScreeningSessions,
        missing: result.missingResumeIds.length,
        defaultValue: `Deleted ${result.deleted} resume(s), removed ${result.deletedAiTaggingResults} AI tagging result(s), patched ${result.patchedScreeningSessions} screening session(s), and skipped ${result.missingResumeIds.length} missing ID(s).`,
      })
    }

    return t('debugIngest.deleteSuccess', {
      deleted: result.deleted,
      tagging: result.deletedAiTaggingResults,
      sessions: result.patchedScreeningSessions,
      defaultValue: `Deleted ${result.deleted} resume(s), removed ${result.deletedAiTaggingResults} AI tagging result(s), and patched ${result.patchedScreeningSessions} screening session(s).`,
    })
  }, [t])

  const triggerReIngest = useCallback(async () => {
    setReingesting(true)
    try {
      const [backfillResult, staleResult] = await Promise.all([
        backfillIngestData({ limit: 200 }),
        reIngestStaleSkillsVersion({ limit: 200 }),
      ])
      toast.success(
        t('debugIngest.reingestSuccess', {
          scheduled: backfillResult.scheduled + staleResult.scheduled,
          defaultValue: `Scheduled ${backfillResult.scheduled + staleResult.scheduled} resumes for ingest`,
        }),
      )
      await loadSkillsVersion()
    } catch (error) {
      reportUiError('Failed to trigger re-ingest', error)
      toast.error(t('debugIngest.reingestFailed', { defaultValue: 'Failed to trigger re-ingest' }))
    } finally {
      setReingesting(false)
    }
  }, [backfillIngestData, loadSkillsVersion, reIngestStaleSkillsVersion, t])

  const clearAnalyses = useCallback(async () => {
    setClearingAnalyses(true)
    try {
      let totalCleared = 0
      let cursor: string | undefined
      do {
        const result = await clearAnalysesMutation({ cursor })
        totalCleared += result.cleared
        cursor = result.hasMore ? (result.cursor ?? undefined) : undefined
      } while (cursor)
      setClearAnalysesDialogOpen(false)
      toast.success(
        t('debugIngest.clearAnalysesSuccess', {
          cleared: totalCleared,
          defaultValue: `Cleared analyses for ${totalCleared} resumes. You can now re-run AI analysis.`,
        }),
      )
    } catch (error) {
      reportUiError('Failed to clear analyses', error)
      toast.error(t('debugIngest.clearAnalysesFailed', { defaultValue: 'Failed to clear analyses' }))
    } finally {
      setClearingAnalyses(false)
    }
  }, [clearAnalysesMutation, t])

  const hardResetAndReIngest = useCallback(async () => {
    setHardResetting(true)
    try {
      let totalCleared = 0
      let cursor: string | undefined
      do {
        const result = await hardResetIngestDataMutation({ cursor })
        totalCleared += result.cleared
        cursor = result.hasMore ? (result.cursor ?? undefined) : undefined
      } while (cursor)
      const reingestResult = await reIngestAllResumes({})
      setHardResetDialogOpen(false)
      toast.success(
        t('debugIngest.hardResetSuccess', {
          cleared: totalCleared,
          scheduled: reingestResult.scheduled,
          defaultValue: `Cleared computed data for ${totalCleared} resumes and scheduled ${reingestResult.scheduled} resumes for full re-ingest.`,
        }),
      )
      await loadSkillsVersion()
    } catch (error) {
      reportUiError('Failed to hard reset ingest data', error)
      toast.error(
        t('debugIngest.hardResetFailed', {
          defaultValue: 'Failed to hard reset resumes and schedule re-ingest',
        }),
      )
    } finally {
      setHardResetting(false)
    }
  }, [hardResetIngestDataMutation, loadSkillsVersion, reIngestAllResumes, t])

  const resetDatabase = useCallback(async () => {
    setResettingDatabase(true)
    try {
      const result = await resetDatabaseMutation({})
      setSearch('')
      setExpandedIds(new Set())
      setSelectedResumeIds(new Set())
      setResumePendingDelete(null)
      setBulkDeleteDialogOpen(false)
      setResetDialogOpen(false)
      toast.success(
        t('debugIngest.resetDatabaseSuccess', {
          count: result.count,
          defaultValue: `Deleted ${result.count} records from the resume database.`,
        }),
      )
      await loadSkillsVersion()
    } catch (error) {
      reportUiError('Failed to reset resume database', error)
      toast.error(
        t('debugIngest.resetDatabaseFailed', {
          defaultValue: 'Failed to clear resume database',
        }),
      )
    } finally {
      setResettingDatabase(false)
    }
  }, [loadSkillsVersion, resetDatabaseMutation, t])

  const deleteResumes = useCallback(async (resumeIds: string[]) => {
    if (resumeIds.length === 0 || deletingResumes) {
      return
    }

    setDeletingResumes(true)
    try {
      const result = await deleteResumesMutation({ resumeIds })
      const deletedIdSet = new Set(resumeIds)

      setSelectedResumeIds((previous) => {
        const next = new Set([...previous].filter((resumeId) => !deletedIdSet.has(resumeId)))
        return next.size === previous.size ? previous : next
      })
      setExpandedIds((previous) => {
        const nextIds = [...previous].filter((resumeId) => !deletedIdSet.has(resumeId))
        return nextIds.length === previous.size ? previous : new Set(nextIds)
      })
      setResumePendingDelete(null)
      setBulkDeleteDialogOpen(false)

      const summaryMessage = createDeleteSummaryMessage(result)
      if (result.deleted > 0) {
        toast.success(summaryMessage)
      } else {
        toast.error(summaryMessage)
      }
    } catch (error) {
      reportUiError('Failed to delete resumes', error)
      toast.error(t('debugIngest.deleteFailed', { defaultValue: 'Failed to delete resumes' }))
    } finally {
      setDeletingResumes(false)
    }
  }, [createDeleteSummaryMessage, deleteResumesMutation, deletingResumes, t])

  const archiveResumes = useCallback(async (resumeIds: string[]) => {
    if (resumeIds.length === 0 || archivingResumes) {
      return
    }

    setArchivingResumes(true)
    try {
      const result = await archiveResumesMutation({ resumeIds })
      const archivedIdSet = new Set(resumeIds)

      setSelectedResumeIds((previous) => {
        const next = new Set([...previous].filter((resumeId) => !archivedIdSet.has(resumeId)))
        return next.size === previous.size ? previous : next
      })
      setExpandedIds((previous) => {
        const nextIds = [...previous].filter((resumeId) => !archivedIdSet.has(resumeId))
        return nextIds.length === previous.size ? previous : new Set(nextIds)
      })

      if (result.archived > 0) {
        toast.success(t('debugIngest.archiveSuccess', { count: result.archived, defaultValue: `Archived ${result.archived} resume(s)` }))
      } else {
        toast.info(t('debugIngest.archiveAlreadyDone', { defaultValue: 'Resumes already archived' }))
      }
    } catch (error) {
      reportUiError('Failed to archive resumes', error)
      toast.error(t('debugIngest.archiveFailed', { defaultValue: 'Failed to archive resumes' }))
    } finally {
      setArchivingResumes(false)
    }
  }, [archiveResumesMutation, archivingResumes, t])

  const confirmSingleDelete = useCallback(() => {
    if (!resumePendingDelete) {
      return
    }
    void deleteResumes([String(resumePendingDelete.resumeId)])
  }, [deleteResumes, resumePendingDelete])

  const confirmBulkDelete = useCallback(() => {
    if (selectedResumeIds.size === 0) {
      return
    }
    void deleteResumes([...selectedResumeIds])
  }, [deleteResumes, selectedResumeIds])

  const archiveSelected = useCallback(() => {
    if (selectedResumeIds.size === 0 || archivingResumes) {
      return
    }
    void archiveResumes([...selectedResumeIds])
  }, [archiveResumes, archivingResumes, selectedResumeIds])

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            <Database className="h-6 w-6 text-primary" />
            {t('debugIngest.title', { defaultValue: 'Ingest Diagnostics' })}
          </>
        }
        description={t('debugIngest.subtitle', { defaultValue: 'Inspect ingestData, staleness, and trigger re-ingest tasks.' })}
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.loadedTotal', { defaultValue: 'Loaded Resumes' })}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-semibold">{resumes.length}</span>
            {hasMoreAvailable && (
              <span className="ml-2 text-sm text-muted-foreground">
                ({t('debugIngest.moreAvailable', { defaultValue: 'more available' })})
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.loadedWithIngest', { defaultValue: 'Loaded With Ingest Data' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{withIngestCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.loadedStale', { defaultValue: 'Loaded Stale / Missing' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{staleCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('debugIngest.skillsVersion', { defaultValue: 'Skills Version' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {versionLoading ? '...' : skillsVersionState?.version ?? '--'}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('debugIngest.searchPlaceholder', { defaultValue: 'Search by name / intention / location...' })}
          className="max-w-xl"
        />
        <SourceFacetSelect
          id="debug-ingest-source-filter"
          facets={sourceFacets}
          value={selectedSourceKeys}
          onChange={setSelectedSourceKeys}
        />
        <Button variant="outline" onClick={() => void loadSkillsVersion()} disabled={versionLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${versionLoading ? 'animate-spin' : ''}`} />
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
        <Button onClick={() => void triggerReIngest()} disabled={reingesting}>
          <RefreshCw className={`mr-2 h-4 w-4 ${reingesting ? 'animate-spin' : ''}`} />
          {t('debugIngest.reingest', { defaultValue: 'Trigger Re-ingest' })}
        </Button>
        <Button
          variant="outline"
          onClick={archiveSelected}
          disabled={selectedResumeIds.size === 0 || archivingResumes}
        >
          <Archive className={`mr-2 h-4 w-4 ${archivingResumes ? 'animate-spin' : ''}`} />
          {t('debugIngest.archiveSelected', {
            count: selectedResumeIds.size,
            defaultValue: `Archive Selected (${selectedResumeIds.size})`,
          })}
        </Button>
        <Button variant="destructive" onClick={() => setClearAnalysesDialogOpen(true)} disabled={clearingAnalyses}>
          <Trash2 className={`mr-2 h-4 w-4 ${clearingAnalyses ? 'animate-spin' : ''}`} />
          {t('debugIngest.clearAnalyses', { defaultValue: 'Reset AI Analyses' })}
        </Button>
        <Button variant="destructive" onClick={() => setHardResetDialogOpen(true)} disabled={hardResetting}>
          <Trash2 className={`mr-2 h-4 w-4 ${hardResetting ? 'animate-spin' : ''}`} />
          {t('debugIngest.hardReset', { defaultValue: 'Hard Reset & Re-ingest' })}
        </Button>
        <Button variant="destructive" onClick={() => setResetDialogOpen(true)} disabled={resettingDatabase}>
          <Trash2 className={`mr-2 h-4 w-4 ${resettingDatabase ? 'animate-spin' : ''}`} />
          {t('debugIngest.resetDatabase', { defaultValue: 'Clear Resume Database' })}
        </Button>
      </div>

      <Dialog
        open={clearAnalysesDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!clearingAnalyses) {
            setClearAnalysesDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (clearingAnalyses) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
            if (clearingAnalyses) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugIngest.clearAnalyses', { defaultValue: 'Reset AI Analyses' })}</DialogTitle>
            <DialogDescription>
              {t('debugIngest.clearAnalysesConfirm', {
                defaultValue:
                  'Clear AI analysis and confirm scores only so scoring can be re-run. HR candidate status, notes, and shortlist/reject decisions are preserved. This cannot be undone for AI scores.',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearAnalysesDialogOpen(false)}
              disabled={clearingAnalyses}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void clearAnalyses()}
              disabled={clearingAnalyses}
            >
              <Trash2 className={`mr-2 h-4 w-4 ${clearingAnalyses ? 'animate-spin' : ''}`} />
              {t('debugIngest.clearAnalyses', { defaultValue: 'Reset AI Analyses' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={hardResetDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!hardResetting) {
            setHardResetDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (hardResetting) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
            if (hardResetting) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugIngest.hardReset', { defaultValue: 'Hard Reset & Re-ingest' })}</DialogTitle>
            <DialogDescription>
              {t('debugIngest.hardResetConfirm', {
                defaultValue: 'Clear all computed ingest and AI analysis data, then schedule a full background re-ingest for all resumes. This cannot be undone.',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHardResetDialogOpen(false)}
              disabled={hardResetting}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void hardResetAndReIngest()}
              disabled={hardResetting}
            >
              <Trash2 className={`mr-2 h-4 w-4 ${hardResetting ? 'animate-spin' : ''}`} />
              {t('debugIngest.hardReset', { defaultValue: 'Hard Reset & Re-ingest' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!resettingDatabase) {
            setResetDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
            if (resettingDatabase) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugIngest.resetDatabase', { defaultValue: 'Clear Resume Database' })}</DialogTitle>
            <DialogDescription>
              {t('debugIngest.resetDatabaseConfirm', {
                defaultValue: 'Delete all resume data and task records? This cannot be undone.',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
              disabled={resettingDatabase}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void resetDatabase()}
              disabled={resettingDatabase}
            >
              <Trash2 className={`mr-2 h-4 w-4 ${resettingDatabase ? 'animate-spin' : ''}`} />
              {t('debugIngest.resetDatabase', { defaultValue: 'Clear Resume Database' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resumePendingDelete !== null}
        onOpenChange={(open: boolean) => {
          if (!deletingResumes && !open) {
            setResumePendingDelete(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (deletingResumes) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
            if (deletingResumes) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugIngest.deleteResume', { defaultValue: 'Delete Resume' })}</DialogTitle>
            <DialogDescription>
              {resumePendingDelete
                ? t('debugIngest.deleteResumeConfirm', {
                    name: getResumeLabel(resumePendingDelete),
                    defaultValue: `Delete ${getResumeLabel(resumePendingDelete)} and its related AI tagging results, then remove stale reviewed-session references? Candidate workflow state will be preserved. This cannot be undone.`,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResumePendingDelete(null)}
              disabled={deletingResumes}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmSingleDelete}
              disabled={deletingResumes || resumePendingDelete === null}
            >
              <Trash2 className={`mr-2 h-4 w-4 ${deletingResumes ? 'animate-spin' : ''}`} />
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkDeleteDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!deletingResumes) {
            setBulkDeleteDialogOpen(open)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (deletingResumes) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
            if (deletingResumes) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugIngest.deleteResume', { defaultValue: 'Delete Resume' })}</DialogTitle>
            <DialogDescription>
              {t('debugIngest.deleteSelectedConfirm', {
                count: selectedResumeIds.size,
                defaultValue: `Delete ${selectedResumeIds.size} selected resume(s) and their related AI tagging results, then remove stale reviewed-session references? Candidate workflow state will be preserved. This cannot be undone.`,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBulkDeleteDialogOpen(false)}
              disabled={deletingResumes}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              disabled={deletingResumes || selectedResumeIds.size === 0}
            >
              <Trash2 className={`mr-2 h-4 w-4 ${deletingResumes ? 'animate-spin' : ''}`} />
              {t('debugIngest.deleteSelected', {
                count: selectedResumeIds.size,
                defaultValue: `Delete Selected (${selectedResumeIds.size})`,
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px]">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked: boolean | 'indeterminate') => toggleSelectAllVisible(checked === true)}
                  aria-label={t('bulkActions.selectAll', { defaultValue: 'Select all' })}
                  disabled={visibleResumeIds.length === 0 || deletingResumes}
                />
              </TableHead>
              <TableHead className="w-[48px]" />
              <TableHead>{t('resumes.columns.name', { defaultValue: 'Name' })}</TableHead>
              <TableHead>{t('resumes.columns.intention', { defaultValue: 'Intention' })}</TableHead>
              <TableHead>{t('resumes.columns.location', { defaultValue: 'Location' })}</TableHead>
              <TableHead>{t('resumes.columns.source', { defaultValue: 'Source' })}</TableHead>
              <TableHead>{t('debugIngest.skillsVersion', { defaultValue: 'Skills Version' })}</TableHead>
              <TableHead>{t('debugIngest.computedAt', { defaultValue: 'Computed At' })}</TableHead>
              <TableHead>{t('debugIngest.status', { defaultValue: 'Status' })}</TableHead>
              <TableHead className="text-right">{t('resumes.columns.actions', { defaultValue: 'Actions' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  {t('resumes.loading', { defaultValue: 'Loading...' })}
                </TableCell>
              </TableRow>
            ) : filteredResumes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  {t('debugIngest.noResults', { defaultValue: 'No resumes found' })}
                </TableCell>
              </TableRow>
            ) : (
              filteredResumes.map((resume) => {
                const resumeId = String(resume.resumeId)
                const isExpanded = expandedIds.has(resumeId)
                const isSelected = selectedResumeIds.has(resumeId)
                const ingestData = resume.ingestData
                const refreshState = resolveResumeRefreshState({
                  resume,
                  currentSkillsVersion,
                  currentIngestComputeEpoch,
                })

                return (
                  <Fragment key={resumeId}>
                    <TableRow data-state={isSelected ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked: boolean | 'indeterminate') => toggleSelectResume(resumeId, checked === true)}
                          aria-label={resumeId}
                          disabled={deletingResumes}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(resumeId)}
                          className="rounded p-1 hover:bg-muted"
                          aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TableCell>
                      <TableCell>{resume.name || '--'}</TableCell>
                      <TableCell>{resume.jobIntention || '--'}</TableCell>
                      <TableCell>{resume.location || '--'}</TableCell>
                      <TableCell>{resume.sourceKey || resume.source || '--'}</TableCell>
                      <TableCell>{ingestData?.skillsVersion ?? '--'}</TableCell>
                      <TableCell>{formatTimestamp(ingestData?.computedAt)}</TableCell>
                      <TableCell>
                        {refreshState.isStale ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <ResumeRefreshBadge refreshState={refreshState} mode="admin" />
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            {t('debugIngest.fresh', { defaultValue: 'Fresh' })}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="hover:text-primary hover:bg-primary/10"
                          onClick={() => archiveResumes([resumeId])}
                          disabled={archivingResumes}
                        >
                          <Archive className="mr-2 h-4 w-4" />
                          {t('common.archive', { defaultValue: 'Archive' })}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded ? (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/20">
                          {ingestData ? (
                            <div className="grid gap-2 text-sm md:grid-cols-2">
                              <div>
                                <span className="font-medium">{t('debugIngest.industryTags', { defaultValue: 'Industry Tags' })}:</span>{' '}
                                {ingestData.industryTags.length > 0 ? ingestData.industryTags.join(', ') : '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.companyHits', { defaultValue: 'Company Hits' })}:</span>{' '}
                                {ingestData.companyHits.length > 0 ? ingestData.companyHits.join(', ') : '--'}
                              </div>
                              <div className="md:col-span-2">
                                <span className="font-medium">{t('debugIngest.brandHits', { defaultValue: 'Brand Hits' })}:</span>{' '}
                                {ingestData.brandHits.length > 0
                                  ? ingestData.brandHits
                                    .map((hit) => formatBrandHitLabel(hit.brand, hit.source, hit.context, hit.role, t))
                                    .join('; ')
                                  : '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.experienceLevel', { defaultValue: 'Experience Level' })}:</span>{' '}
                                {ingestData.experienceLevel || '--'}
                              </div>
                              <div>
                                <span className="font-medium">{t('debugIngest.ruleScoreCount', { defaultValue: 'Rule Scores' })}:</span>{' '}
                                {ingestData.ruleScoreCount}
                              </div>
                              <div className="md:col-span-2">
                                <span className="font-medium">{t('debugIngest.taggingEnvelope', { defaultValue: 'Tagging Envelope' })}:</span>{' '}
                                {ingestData.taggingEntries.length
                                  ? ingestData.taggingEntries
                                    .map((entry) => formatTaggingEntry(entry))
                                    .join('; ')
                                  : '--'}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {t('debugIngest.noIngestData', { defaultValue: 'No ingest data yet for this resume.' })}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => loadMore(INGEST_DIAGNOSTICS_PAGE_SIZE)} disabled={!canLoadMore}>
          {status === 'LoadingMore'
            ? t('resumes.loading', { defaultValue: 'Loading...' })
            : t('debugIngest.loadMore', { defaultValue: 'Load More' })}
        </Button>
      </div>
    </div>
  )
}
