import { useMemo, useState } from 'react'
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
import { PageHeader } from '@/components/PageHeader'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'
import { SourceFacetSelect } from '@/components/SourceFacetSelect'

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
      console.error('Failed to restore resumes', error)
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
        <Button
          variant="outline"
          onClick={() => void unarchiveResumes([...selectedResumeIds])}
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
                  {t('archivedResumes.noResults', { defaultValue: 'No archived resumes found' })}
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="hover:text-emerald-600 hover:bg-emerald-50"
                        onClick={() => void unarchiveResumes([resumeId])}
                        disabled={unarchiving}
                      >
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                        {t('archivedResumes.restore', { defaultValue: 'Restore' })}
                      </Button>
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
