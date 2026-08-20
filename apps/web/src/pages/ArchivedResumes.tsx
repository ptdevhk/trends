import { useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeResumeRecordForSurface } from '@trends/shared'
import { useMutation, usePaginatedQuery } from 'convex/react'
import { useSourceFacets } from '@/hooks/useSourceFacets'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { useTranslation } from 'react-i18next'
import { Archive, ArchiveRestore } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/PageHeader'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { SourceFacetSelect } from '@/components/SourceFacetSelect'
import { reportUiError } from '@/lib/ui-error-reporting'

type ArchivedResume = {
  resumeId: string
  externalId: string
  source: string
  sourceKey: string
  name: string
  jobIntention: string
  location: string
  isArchived?: boolean
  archivedAt?: number
}

function getSearchTarget(resume: ArchivedResume): string {
  return [resume.externalId, resume.source, resume.sourceKey, resume.name, resume.jobIntention, resume.location]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function formatTimestamp(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--'
  }
  return new Date(value).toLocaleString()
}

const PAGE_SIZE = 100
const MAX_AUTO_LOAD_PAGES = 5

export default function ArchivedResumes() {
  const { t } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[]>([])
  const { facets: sourceFacets } = useSourceFacets(true)

  const {
    results: paginatedResumes,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.resumes_diagnostics.listArchivedDiagnostics,
    selectedSourceKeys.length > 0 ? { sourceKeys: selectedSourceKeys } : {},
    { initialNumItems: PAGE_SIZE }
  )

  const unarchiveResumesMutation = useMutation(api.resumes_mutations.unarchiveResumes)

  const [search, setSearch] = useState('')
  const [selectedResumeIds, setSelectedResumeIds] = useState<Set<string>>(new Set())
  const [unarchiving, setUnarchiving] = useState(false)
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const autoLoadPagesRef = useRef(0)

  // While a search is active, keep loading pages so the client-side filter
  // sees the whole archive, not just the first page (bounded to avoid an
  // unbounded fetch loop on very large archives).
  useEffect(() => {
    const searching = search.trim() !== ''
    if (searching && status === 'CanLoadMore' && autoLoadPagesRef.current < MAX_AUTO_LOAD_PAGES) {
      autoLoadPagesRef.current += 1
      loadMore(PAGE_SIZE)
    } else if (!searching) {
      autoLoadPagesRef.current = 0
    }
  }, [search, status, loadMore])

  const resumes = useMemo(
    () => paginatedResumes.map((resume) => sanitizeResumeRecordForSurface(resume, 'debug', fieldUsagePolicy)),
    [fieldUsagePolicy, paginatedResumes],
  )

  const filteredResumes = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return resumes as ArchivedResume[]
    return (resumes as ArchivedResume[]).filter((resume) => getSearchTarget(resume).includes(query))
  }, [resumes, search])

  const visibleResumeIds = useMemo(() => filteredResumes.map((r) => String(r.resumeId)), [filteredResumes])
  const allVisibleSelected = visibleResumeIds.length > 0 && visibleResumeIds.every((id) => selectedResumeIds.has(id))
  const someVisibleSelected = visibleResumeIds.some((id) => selectedResumeIds.has(id))

  const toggleSelectResume = (resumeId: string, selected: boolean) => {
    setSelectedResumeIds((previous) => {
      const next = new Set(previous)
      if (selected) {
        next.add(resumeId)
      } else {
        next.delete(resumeId)
      }
      return next
    })
  }

  const toggleSelectAllVisible = (selected: boolean) => {
    setSelectedResumeIds((previous) => {
      const next = new Set(previous)
      if (selected) {
        visibleResumeIds.forEach((id) => next.add(id))
      } else {
        visibleResumeIds.forEach((id) => next.delete(id))
      }
      return next
    })
  }

  const unarchiveResumes = async (resumeIds: string[]) => {
    if (resumeIds.length === 0 || unarchiving) {
      return
    }
    setUnarchiving(true)
    try {
      const result = await unarchiveResumesMutation({ resumeIds })
      const unarchivedIdSet = new Set(resumeIds)
      setSelectedResumeIds((previous) => {
        const next = new Set([...previous].filter((id) => !unarchivedIdSet.has(id)))
        return next.size === previous.size ? previous : next
      })
      if (result.unarchived > 0) {
        toast.success(t('archivedResumes.restoreSuccess', { count: result.unarchived, defaultValue: `Restored ${result.unarchived} resume(s)` }))
      } else {
        toast.info(t('archivedResumes.restoreNothing', { defaultValue: 'No resumes to restore' }))
      }
    } catch (error) {
      reportUiError('Failed to restore resumes', error)
      toast.error(t('archivedResumes.restoreFailed', { defaultValue: 'Failed to restore resumes' }))
    } finally {
      setUnarchiving(false)
    }
  }

  const loading = status === 'LoadingFirstPage'
  const canLoadMore = status === 'CanLoadMore'

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            <Archive className="h-6 w-6 text-primary" />
            {t('archivedResumes.title', { defaultValue: 'Archived Resumes' })}
          </>
        }
        description={t('archivedResumes.subtitle', { defaultValue: 'View and restore archived resumes.' })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('archivedResumes.searchPlaceholder', { defaultValue: 'Search by name / intention / location...' })}
          className="max-w-xl"
        />
        <SourceFacetSelect
          id="archived-resume-source-filter"
          facets={sourceFacets}
          value={selectedSourceKeys}
          onChange={setSelectedSourceKeys}
        />
        <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('archivedResumes.restoreSelectedConfirmTitle', { defaultValue: 'Restore selected resumes?' })}
              </DialogTitle>
              <DialogDescription>
                {t('archivedResumes.restoreSelectedConfirmBody', {
                  count: selectedResumeIds.size,
                  defaultValue: `Restore ${selectedResumeIds.size} archived resume(s)? They will re-enter the active pool.`,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRestoreDialogOpen(false)} disabled={unarchiving}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                variant="destructive"
                disabled={unarchiving}
                onClick={() => {
                  setRestoreDialogOpen(false)
                  void unarchiveResumes([...selectedResumeIds])
                }}
              >
                <ArchiveRestore className="mr-2 h-4 w-4" />
                {t('archivedResumes.restoreConfirmYes', { defaultValue: 'Yes, restore' })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          variant="outline"
          onClick={() => setRestoreDialogOpen(true)}
          disabled={selectedResumeIds.size === 0 || unarchiving}
        >
          <ArchiveRestore className={`mr-2 h-4 w-4 ${unarchiving ? 'animate-spin' : ''}`} />
          {t('archivedResumes.restoreSelected', {
            count: selectedResumeIds.size,
            defaultValue: `Restore Selected (${selectedResumeIds.size})`,
          })}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px]">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked: boolean | 'indeterminate') => toggleSelectAllVisible(checked === true)}
                  aria-label={t('bulkActions.selectAll', { defaultValue: 'Select all' })}
                  disabled={visibleResumeIds.length === 0 || unarchiving}
                />
              </TableHead>
              <TableHead>{t('resumes.columns.name', { defaultValue: 'Name' })}</TableHead>
              <TableHead>{t('resumes.columns.intention', { defaultValue: 'Intention' })}</TableHead>
              <TableHead>{t('resumes.columns.location', { defaultValue: 'Location' })}</TableHead>
              <TableHead>{t('resumes.columns.source', { defaultValue: 'Source' })}</TableHead>
              <TableHead>{t('archivedResumes.archivedAt', { defaultValue: 'Archived At' })}</TableHead>
              <TableHead>{t('debugIngest.status', { defaultValue: 'Status' })}</TableHead>
              <TableHead className="text-right">{t('resumes.columns.actions', { defaultValue: 'Actions' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {t('resumes.loading', { defaultValue: 'Loading...' })}
                </TableCell>
              </TableRow>
            ) : filteredResumes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {search.trim() !== '' || selectedSourceKeys.length > 0 ? (
                    <div className="flex flex-col items-center gap-2">
                      <span>
                        {t('archivedResumes.noResultsForSearch', {
                          defaultValue: 'No archived resumes match your search',
                        })}
                      </span>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setSearch('')
                          setSelectedSourceKeys([])
                        }}
                      >
                        {t('archivedResumes.clearSearch', { defaultValue: 'Clear search' })}
                      </Button>
                    </div>
                  ) : (
                    t('archivedResumes.noResults', { defaultValue: 'No archived resumes found' })
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredResumes.map((resume) => {
                const resumeId = String(resume.resumeId)
                const isSelected = selectedResumeIds.has(resumeId)

                return (
                  <TableRow key={resumeId} data-state={isSelected ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked: boolean | 'indeterminate') => toggleSelectResume(resumeId, checked === true)}
                        aria-label={resumeId}
                        disabled={unarchiving}
                      />
                    </TableCell>
                    <TableCell>{resume.name || '--'}</TableCell>
                    <TableCell>{resume.jobIntention || '--'}</TableCell>
                    <TableCell>{resume.location || '--'}</TableCell>
                    <TableCell>{resume.sourceKey || resume.source || '--'}</TableCell>
                    <TableCell>{formatTimestamp(resume.archivedAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                        {t('archivedResumes.archivedBadge', { defaultValue: 'Archived' })}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {pendingRestoreId === resumeId ? (
                        <div
                          className="flex items-center justify-end gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1"
                          data-testid={`restore-confirm-row-${resumeId}`}
                        >
                          <span className="text-sm text-destructive">
                            {t('archivedResumes.restoreConfirm', { defaultValue: 'Restore this resume?' })}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="restore-confirm-no"
                            onClick={() => setPendingRestoreId(null)}
                            disabled={unarchiving}
                          >
                            {t('common.cancel', { defaultValue: 'Cancel' })}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            data-testid="restore-confirm-yes"
                            onClick={() => {
                              setPendingRestoreId(null)
                              void unarchiveResumes([resumeId])
                            }}
                            disabled={unarchiving}
                          >
                            {t('archivedResumes.restoreConfirmYes', { defaultValue: 'Yes, restore' })}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="hover:text-emerald-600 hover:bg-emerald-50"
                          onClick={() => setPendingRestoreId(resumeId)}
                          disabled={unarchiving}
                        >
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                          {t('archivedResumes.restore', { defaultValue: 'Restore' })}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => loadMore(PAGE_SIZE)} disabled={!canLoadMore}>
          {status === 'LoadingMore'
            ? t('resumes.loading', { defaultValue: 'Loading...' })
            : t('debugIngest.loadMore', { defaultValue: 'Load More' })}
        </Button>
      </div>
    </div>
  )
}
