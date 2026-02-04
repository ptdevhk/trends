import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResumeCard } from '@/components/ResumeCard'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ResumeItem } from '@/hooks/useResumes'

interface ResumeCardListProps {
  items: ResumeItem[]
  loading?: boolean
  onViewDetails: (resume: ResumeItem) => void
}

function getRowId(item: ResumeItem, index: number): string {
  return item.resumeId || item.perUserId || `${index}-${item.name}`
}

function ResumeCardSkeleton() {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-4 pt-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t border-border/60 px-4 py-3">
        <div className="flex w-full justify-end">
          <Skeleton className="h-8 w-20" />
        </div>
      </CardFooter>
    </Card>
  )
}

export function ResumeCardList({ items, loading = false, onViewDetails }: ResumeCardListProps) {
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isIndeterminate ? 'indeterminate' : allSelected}
            onCheckedChange={(value) => toggleAll(Boolean(value))}
            aria-label={t('resumes.columns.select')}
            disabled={rowIds.length === 0}
          />
          <span className="text-sm text-muted-foreground">
            {t('resumes.card.selectAll')}
          </span>
        </div>
        {selectedCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t('resumes.card.selectedCount', { count: selectedCount })}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && items.length === 0
          ? Array.from({ length: 6 }).map((_, index) => (
              <ResumeCardSkeleton key={`resume-skeleton-${index}`} />
            ))
          : items.map((item, index) => {
              const rowId = getRowId(item, index)
              return (
                <ResumeCard
                  key={rowId}
                  item={item}
                  selected={Boolean(selected[rowId])}
                  onSelect={(checked) => toggleRow(rowId, checked)}
                  onViewDetails={onViewDetails}
                />
              )
            })}
      </div>
    </div>
  )
}
