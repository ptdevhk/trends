import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { ResumeItem } from '@/hooks/useResumes'

interface ResumeTableProps {
  items: ResumeItem[]
  onViewDetails: (resume: ResumeItem) => void
}

function getRowId(item: ResumeItem, index: number): string {
  return item.resumeId || item.perUserId || `${index}-${item.name}`
}

export function ResumeTable({ items, onViewDetails }: ResumeTableProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setSelected({})
  }, [items])

  const rowIds = useMemo(() => items.map(getRowId), [items])
  const selectedCount = rowIds.filter((id) => selected[id]).length
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length
  const isIndeterminate = selectedCount > 0 && !allSelected

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected({})
      return
    }

    const next: Record<string, boolean> = {}
    rowIds.forEach((id) => {
      next[id] = true
    })
    setSelected(next)
  }

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [id]: checked,
    }))
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={isIndeterminate ? 'indeterminate' : allSelected}
              onCheckedChange={(value) => toggleAll(Boolean(value))}
              aria-label={t('resumes.columns.select')}
            />
          </TableHead>
          <TableHead>{t('resumes.columns.name')}</TableHead>
          <TableHead className="w-16">{t('resumes.columns.age')}</TableHead>
          <TableHead className="w-20">{t('resumes.columns.experience')}</TableHead>
          <TableHead className="w-24">{t('resumes.columns.education')}</TableHead>
          <TableHead className="w-28">{t('resumes.columns.location')}</TableHead>
          <TableHead className="w-28">{t('resumes.columns.salary')}</TableHead>
          <TableHead>{t('resumes.columns.intention')}</TableHead>
          <TableHead className="w-28">{t('resumes.columns.activity')}</TableHead>
          <TableHead className="w-28">{t('resumes.columns.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, index) => {
          const rowId = getRowId(item, index)
          return (
            <TableRow key={rowId} data-state={selected[rowId] ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  checked={Boolean(selected[rowId])}
                  onCheckedChange={(value) => toggleRow(rowId, Boolean(value))}
                  aria-label={t('resumes.columns.select')}
                />
              </TableCell>
              <TableCell className="font-medium">
                <div className="flex flex-col gap-1">
                  <span>{item.name || '--'}</span>
                  {item.profileUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      href={item.profileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('resumes.detail.profileLink')}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>{item.age || '--'}</TableCell>
              <TableCell>{item.experience || '--'}</TableCell>
              <TableCell>{item.education || '--'}</TableCell>
              <TableCell>{item.location || '--'}</TableCell>
              <TableCell>{item.expectedSalary || '--'}</TableCell>
              <TableCell className="max-w-[240px]">
                <span className="block truncate" title={item.jobIntention || ''}>
                  {item.jobIntention || '--'}
                </span>
              </TableCell>
              <TableCell>{item.activityStatus || '--'}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => onViewDetails(item)}>
                  {t('resumes.actions.view')}
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
