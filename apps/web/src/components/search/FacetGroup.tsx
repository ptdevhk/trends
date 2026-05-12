import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FacetValueCount } from '@/components/search/search-types'

type FacetGroupProps = {
  emptyLabel?: string
  items: FacetValueCount[]
  maxVisible?: number
  selectedValues: string[]
  title: string
  onToggle: (value: string) => void
}

export function FacetGroup({
  emptyLabel,
  items,
  maxVisible = 8,
  selectedValues,
  title,
  onToggle,
}: FacetGroupProps) {
  const { t } = useTranslation()
  const defaultEmptyLabel = emptyLabel || t('resumes.searchPage.facets.emptyLabel')
  const [expanded, setExpanded] = useState(false)
  const normalizedSelectedValues = useMemo(
    () => new Set(selectedValues.map((value) => value.toLowerCase())),
    [selectedValues]
  )
  const visibleItems = expanded ? items : items.slice(0, maxVisible)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </div>
        {selectedValues.length > 0 ? (
          <Badge variant="outline">{selectedValues.length}</Badge>
        ) : null}
      </div>

      {items.length === 0 ? (
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

      {items.length > maxVisible ? (
        <Button type="button" variant="ghost" className="h-auto px-0 text-sm" onClick={() => setExpanded((value) => !value)}>
          {expanded
            ? t('resumes.searchPage.facets.showLess', { defaultValue: '收起' })
            : t('resumes.searchPage.facets.showMore', { count: items.length - maxVisible, defaultValue: '展开剩余 {{count}} 项' })}
        </Button>
      ) : null}
    </div>
  )
}
