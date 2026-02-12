import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  useIndustryKeywords,
} from '@/hooks/useIndustryKeywords'

interface KeywordChipsProps {
  value: string[]
  onChange: (keywords: string[]) => void
}

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

export function KeywordChips({ value, onChange }: KeywordChipsProps) {
  const { t } = useTranslation()
  const { keywords, grouped, hotKeywords, loading, error } = useIndustryKeywords()
  const [expanded, setExpanded] = useState(false)
  const [customKeyword, setCustomKeyword] = useState('')

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

  const additionalSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !hotKeywordSet.has(keyword))
  }, [hotKeywordSet, selectedValues])

  const customSelectedKeywords = useMemo(() => {
    return selectedValues.filter((keyword) => !knownKeywordSet.has(keyword))
  }, [knownKeywordSet, selectedValues])

  const toggleKeyword = useCallback(
    (keyword: string) => {
      const normalized = keyword.trim()
      if (!normalized) return

      const next = new Set(selected)
      if (next.has(normalized)) {
        next.delete(normalized)
      } else {
        next.add(normalized)
      }
      onChange(Array.from(next))
    },
    [onChange, selected]
  )

  const addCustomKeyword = useCallback(() => {
    const normalized = customKeyword.trim()
    if (!normalized) return

    const next = new Set(selected)
    next.add(normalized)
    onChange(Array.from(next))
    setCustomKeyword('')
  }, [customKeyword, onChange, selected])

  const handleCustomKeywordKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        addCustomKeyword()
      }
    },
    [addCustomKeyword]
  )

  const renderChip = useCallback(
    (keyword: string) => {
      const selectedKeyword = selected.has(keyword)
      return (
        <Badge
          key={keyword}
          variant={selectedKeyword ? 'default' : 'outline'}
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
            selectedKeyword ? 'border-transparent' : 'hover:bg-muted'
          )}
        >
          {keyword}
        </Badge>
      )
    },
    [selected, toggleKeyword]
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
            {hotKeywords.map((item) => renderChip(item.keyword))}
            {!expanded && additionalSelectedKeywords.map((keyword) => renderChip(keyword))}
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
          if (grouped[category].length === 0) return null
          return (
            <div key={category} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {CATEGORY_LABELS[category]}:
              </span>
              {grouped[category].map((item) => renderChip(item.keyword))}
            </div>
          )
        })
        : null}

      {customSelectedKeywords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('quickStart.customKeywords', '自定义')}:</span>
          {customSelectedKeywords.map((keyword) => renderChip(keyword))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={customKeyword}
          onChange={(event) => setCustomKeyword(event.target.value)}
          onKeyDown={handleCustomKeywordKeyDown}
          placeholder={t('quickStart.customKeywordPlaceholder', '自定义关键词...')}
          className="h-8 max-w-xs text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-3 text-xs"
          onClick={addCustomKeyword}
          disabled={!customKeyword.trim()}
        >
          +
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
