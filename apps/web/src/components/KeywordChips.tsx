import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  useIndustryKeywords,
} from '@/hooks/useIndustryKeywords'

interface KeywordChipsProps {
  value: string[]
  onChange: (keywords: string[]) => void
  activeLocations?: string[]
  onLocationToggle?: (location: string) => void
}

const SEED_LOCATION_CHIP_LIMIT = 4

function normalizeKeywords(values: string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    next.push(normalized)
  }
  return next
}

export function KeywordChips({
  value,
  onChange,
  activeLocations,
  onLocationToggle,
}: KeywordChipsProps) {
  const { t } = useTranslation()
  const { keywords, grouped, hotKeywords, loading, error } = useIndustryKeywords()
  const [expanded, setExpanded] = useState(false)

  // Derive selection directly from props
  const selected = useMemo(() => new Set(normalizeKeywords(value)), [value])

  const selectedValues = useMemo(() => Array.from(selected), [selected])
  const hotKeywordSet = useMemo(
    () => new Set(hotKeywords.map((keyword) => keyword.keyword)),
    [hotKeywords]
  )
  const knownKeywordSet = useMemo(
    () => new Set(keywords.map((keyword) => keyword.keyword)),
    [keywords]
  )
  const keywordCategoryMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of keywords) {
      const normalizedKeyword = item.keyword.trim()
      if (!normalizedKeyword || map.has(normalizedKeyword)) {
        continue
      }
      map.set(normalizedKeyword, item.category)
    }
    return map
  }, [keywords])
  const activeLocationSet = useMemo(
    () => new Set(activeLocations?.map((loc) => loc.trim()).filter(Boolean) || []),
    [activeLocations]
  )

  const additionalSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !hotKeywordSet.has(keyword))
  }, [hotKeywordSet, selectedValues])

  const customSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !knownKeywordSet.has(keyword))
  }, [knownKeywordSet, selectedValues])
  const displayHotKeywords = useMemo(() => {
    let locationChipCount = 0
    return hotKeywords.filter((item) => {
      if (item.category !== 'location') {
        return true
      }
      if (locationChipCount >= SEED_LOCATION_CHIP_LIMIT) {
        return false
      }
      locationChipCount += 1
      return true
    })
  }, [hotKeywords])

  const toggleKeyword = useCallback(
    (keyword: string) => {
      const normalized = keyword.trim()
      if (!normalized) return

      const matchedKeyword = keywords.find((item) => item.keyword === normalized)
      if (matchedKeyword?.category === 'location' && onLocationToggle) {
        onLocationToggle(normalized)
        return
      }

      const next = new Set(selected)
      if (next.has(normalized)) {
        next.delete(normalized)
      } else {
        next.add(normalized)
      }
      onChange(Array.from(next))
    },
    [keywords, onChange, onLocationToggle, selected]
  )

  const renderChip = useCallback(
    (keyword: string, category?: string) => {
      const normalizedKeyword = keyword.trim()
      const resolvedCategory = category ?? keywordCategoryMap.get(normalizedKeyword)
      const isLocationChip = resolvedCategory === 'location'
      const selectedKeyword = isLocationChip
        ? activeLocationSet.has(normalizedKeyword)
        : selected.has(normalizedKeyword)
      return (
        <Badge
          key={keyword}
          variant={isLocationChip ? 'outline' : selectedKeyword ? 'default' : 'outline'}
          onClick={() => toggleKeyword(keyword)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleKeyword(keyword)
            }
          }}
          role="button"
          tabIndex={0}
          className={cn(
            'cursor-pointer select-none rounded-full px-2.5 py-1 text-xs transition-colors',
            isLocationChip
              ? selectedKeyword
                ? 'border-green-700 bg-green-600 text-white hover:bg-green-600'
                : 'border-green-300 text-green-700 hover:bg-green-50'
              : selectedKeyword
                ? 'border-transparent'
                : 'hover:bg-muted'
          )}
        >
          {keyword}
        </Badge>
      )
    },
    [keywordCategoryMap, activeLocationSet, selected, toggleKeyword]
  )

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t('quickStart.hotKeywords', '热门关键词')}:
        </span>
        {loading ? (
          <span className="text-xs text-muted-foreground">{t('trends.loading')}</span>
        ) : (
          <>
            {displayHotKeywords.map((item) => renderChip(item.keyword, item.category))}
            {!expanded && additionalSelectedKeywords.map((keyword) =>
              renderChip(keyword, keywordCategoryMap.get(keyword.trim()))
            )}
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1 text-xs"
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded
            ? t('quickStart.collapseKeywords', '收起')
            : t('quickStart.expandKeywords', '展开全部')}
        </Button>
      </div>

      {expanded
        ? CATEGORY_ORDER.map((category) => {
          const categoryKeywords = category === 'location'
            ? grouped[category].slice(0, SEED_LOCATION_CHIP_LIMIT)
            : grouped[category]
          if (categoryKeywords.length === 0) return null
          return (
            <div key={category} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {CATEGORY_LABELS[category]}:
              </span>
              {categoryKeywords.map((item) => renderChip(item.keyword, item.category))}
            </div>
          )
        })
        : null}

      {customSelectedKeywords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('quickStart.customKeywords', '自定义')}:</span>
          {customSelectedKeywords.map((keyword) =>
            renderChip(keyword, keywordCategoryMap.get(keyword.trim()))
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
