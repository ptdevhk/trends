import { normalizeKeywordPhrases } from '@trends/shared'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type IndustryKeyword,
  type KeywordMarket,
  useIndustryKeywords,
} from '@/hooks/useIndustryKeywords'

interface KeywordChipsProps {
  value: string[]
  onChange: (keywords: string[]) => void
  activeLocations?: string[]
  onLocationToggle?: (location: string) => void
  market?: KeywordMarket
}

const SEED_LOCATION_CHIP_LIMIT = 4
const SYNTHETIC_LOCATION_ID_PREFIX = '__active_location__'

function getKeywordFingerprint(value: string): string {
  return value.trim().toLowerCase()
}

function createSyntheticLocationKeyword(keyword: string): IndustryKeyword {
  return {
    id: `${SYNTHETIC_LOCATION_ID_PREFIX}:${keyword}`,
    keyword,
    category: 'location',
  }
}

function matchesMarket(item: IndustryKeyword, market: KeywordMarket | undefined): boolean {
  if (item.visible === false) {
    return false
  }
  if (!market) {
    return true
  }
  if (!Array.isArray(item.markets) || item.markets.length === 0) {
    return true
  }
  return item.markets.includes(market)
}

export function KeywordChips({
  value,
  onChange,
  activeLocations,
  onLocationToggle,
  market,
}: KeywordChipsProps) {
  const { t } = useTranslation()
  const { keywords, grouped, hotKeywords, loading, error } = useIndustryKeywords()
  const [expanded, setExpanded] = useState(false)

  const selectedValues = useMemo(() => normalizeKeywordPhrases(value), [value])
  const selectedKeywordSet = useMemo(
    () => new Set(selectedValues.map((keyword) => getKeywordFingerprint(keyword))),
    [selectedValues]
  )
  const filteredHotKeywords = useMemo(
    () => hotKeywords.filter((item) => matchesMarket(item, market)),
    [hotKeywords, market]
  )
  const hotKeywordSet = useMemo(
    () => new Set(filteredHotKeywords.map((keyword) => getKeywordFingerprint(keyword.keyword))),
    [filteredHotKeywords]
  )
  const knownKeywordSet = useMemo(
    () => new Set(keywords.map((keyword) => getKeywordFingerprint(keyword.keyword))),
    [keywords]
  )
  const customSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !knownKeywordSet.has(getKeywordFingerprint(keyword)))
  }, [knownKeywordSet, selectedValues])
  const keywordCategoryMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of keywords) {
      const normalizedKeyword = item.keyword.trim()
      const fingerprint = getKeywordFingerprint(normalizedKeyword)
      if (!normalizedKeyword || map.has(fingerprint)) {
        continue
      }
      map.set(fingerprint, item.category)
    }
    return map
  }, [keywords])
  const normalizedActiveLocations = useMemo(
    () => normalizeKeywordPhrases(activeLocations ?? []),
    [activeLocations]
  )
  const activeLocationSet = useMemo(
    () => new Set(normalizedActiveLocations.map((location) => getKeywordFingerprint(location))),
    [normalizedActiveLocations]
  )

  const additionalSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !hotKeywordSet.has(getKeywordFingerprint(keyword)))
  }, [hotKeywordSet, selectedValues])
  const displayHotKeywords = useMemo(() => {
    const result: IndustryKeyword[] = []
    const seen = new Set<string>()
    let locationChipCount = 0

    const pushUnique = (item: IndustryKeyword) => {
      const keyword = item.keyword.trim()
      const fingerprint = getKeywordFingerprint(keyword)
      if (!keyword || seen.has(fingerprint)) {
        return
      }
      seen.add(fingerprint)
      result.push({
        ...item,
        keyword,
      })
    }

    filteredHotKeywords.forEach((item) => {
      if (item.category !== 'location') {
        pushUnique(item)
        return
      }

      if (locationChipCount >= SEED_LOCATION_CHIP_LIMIT) {
        return
      }
      locationChipCount += 1
      pushUnique(item)
    })

    normalizedActiveLocations.forEach((location) => {
      pushUnique(createSyntheticLocationKeyword(location))
    })

    return result
  }, [filteredHotKeywords, normalizedActiveLocations])

  const locationCategoryKeywords = useMemo(() => {
    const result: IndustryKeyword[] = []
    const seen = new Set<string>()

    const pushUnique = (item: IndustryKeyword) => {
      const keyword = item.keyword.trim()
      const fingerprint = getKeywordFingerprint(keyword)
      if (!keyword || seen.has(fingerprint)) {
        return
      }
      seen.add(fingerprint)
      result.push({
        ...item,
        keyword,
      })
    }

    grouped.location.filter((item) => matchesMarket(item, market)).forEach((item) => {
      pushUnique(item)
    })
    normalizedActiveLocations.forEach((location) => {
      pushUnique(createSyntheticLocationKeyword(location))
    })

    return result
  }, [grouped.location, market, normalizedActiveLocations])

  const toggleKeyword = useCallback(
    (keyword: string) => {
      const normalized = keyword.trim()
      if (!normalized) return

      const fingerprint = getKeywordFingerprint(normalized)
      const matchedKeyword = keywords.find(
        (item) => getKeywordFingerprint(item.keyword) === fingerprint
      )
      if (matchedKeyword?.category === 'location' && onLocationToggle) {
        onLocationToggle(normalized)
        return
      }

      const nextSelectedValues = selectedValues.filter(
        (selectedKeyword) => getKeywordFingerprint(selectedKeyword) !== fingerprint
      )
      if (selectedKeywordSet.has(fingerprint)) {
        onChange(nextSelectedValues)
        return
      }

      onChange(normalizeKeywordPhrases([...nextSelectedValues, normalized]))
    },
    [keywords, onChange, onLocationToggle, selectedKeywordSet, selectedValues]
  )

  const renderChip = useCallback(
    (keyword: string, category?: string) => {
      const normalizedKeyword = keyword.trim()
      const fingerprint = getKeywordFingerprint(normalizedKeyword)
      const resolvedCategory = category ?? keywordCategoryMap.get(fingerprint)
      const isLocationChip = resolvedCategory === 'location'
      const selectedKeyword = isLocationChip
        ? activeLocationSet.has(fingerprint)
        : selectedKeywordSet.has(fingerprint)
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
    [keywordCategoryMap, activeLocationSet, selectedKeywordSet, toggleKeyword]
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
              renderChip(keyword, keywordCategoryMap.get(getKeywordFingerprint(keyword)))
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
            ? locationCategoryKeywords
            : grouped[category].filter((item) => matchesMarket(item, market))
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
            renderChip(keyword, keywordCategoryMap.get(getKeywordFingerprint(keyword)))
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
