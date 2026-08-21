import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { FacetValueCount } from '@/components/search/search-types'

type FacetGroupProps = {
  emptyLabel?: string
  filterable?: boolean
  items: FacetValueCount[]
  maxVisible?: number
  selectedValues: string[]
  title: string
  onToggle: (value: string) => void
}

export function FacetGroup({
  emptyLabel,
  filterable = false,
  items,
  maxVisible = 8,
  selectedValues,
  title,
  onToggle,
}: FacetGroupProps) {
  const { t } = useTranslation()
  const defaultEmptyLabel = emptyLabel || t('resumes.searchPage.facets.emptyLabel')
  const [expanded, setExpanded] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const normalizedSelectedValues = useMemo(
    () => new Set(selectedValues.map((value) => value.toLowerCase())),
    [selectedValues]
  )
  const filteredItems = useMemo(() => {
    const query = filterQuery.trim().toLowerCase()
    if (!query) {
      return items
    }
    return items.filter(
      (item) =>
        item.value.toLowerCase().includes(query) ||
        (item.label ?? '').toLowerCase().includes(query)
    )
  }, [filterQuery, items])
  const hasActiveFilter = filterQuery.trim().length > 0
  const visibleItems = hasActiveFilter || expanded ? filteredItems : items.slice(0, maxVisible)
  const showFilterInput = filterable && items.length > maxVisible

  const titleId = `facet-group-${title.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className="space-y-3" role="group" aria-labelledby={titleId}>
      <div className="flex items-center justify-between">
        <div id={titleId} className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </div>
        {selectedValues.length > 0 ? (
          <Badge variant="outline">{selectedValues.length}</Badge>
        ) : null}
      </div>

      {showFilterInput ? (
        <div className="relative">
          <Input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t('resumes.searchPage.facets.filterPlaceholder', { defaultValue: 'Filter options…' })}
            className="h-8 pr-7 text-sm"
            aria-label={t('resumes.searchPage.facets.filterPlaceholder', { defaultValue: 'Filter options…' })}
          />
          {hasActiveFilter && (
            <button
              type="button"
              aria-label={t('common.clear', { defaultValue: 'Clear' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setFilterQuery('')}
            >
              ×
            </button>
          )}
        </div>
      ) : null}

      {hasActiveFilter && filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
          {t('resumes.searchPage.facets.noFilterMatches', { defaultValue: 'No matching options' })}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
          {defaultEmptyLabel}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleItems.map((item) => {
            const active = normalizedSelectedValues.has(item.value.toLowerCase())
            return (
              <button
                key={`${title}-${item.value}`}
                type="button"
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                )}
                onClick={() => onToggle(item.value)}
              >
                {item.label ?? item.value}
                <span className={cn('ml-2 text-xs', active ? 'text-slate-200' : 'text-muted-foreground')}>
                  {item.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {items.length > maxVisible && !hasActiveFilter ? (
        <Button type="button" variant="ghost" className="h-auto px-0 text-sm" onClick={() => setExpanded((value) => !value)}>
          {expanded
            ? t('resumes.searchPage.facets.showLess', { defaultValue: 'Show less' })
            : t('resumes.searchPage.facets.showMore', { count: items.length - maxVisible, defaultValue: 'Show {{count}} more' })}
        </Button>
      ) : null}
    </div>
  )
}
