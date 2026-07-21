import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { rawApiClient } from '@/lib/api-helpers'
import {
  loadResearchRecentCompanies,
  upsertResearchRecentCompany,
} from '@/lib/research-recent-companies'
import { cn } from '@/lib/utils'

export type PredictCompanyHit = {
  companyKey: string
  nameCn: string
  nameEn?: string
  displayName?: string
  type?: string
  source: 'recent' | 'resolve' | 'industry' | 'showcase'
}

type IndustryEntity = {
  companyKey: string
  nameCn: string
  nameEn?: string
  displayName?: string
  type?: string
}

type Props = {
  teamSlug: string
  /** Optional golden chips when recent empty */
  showcaseSuggestions?: Array<{ companyKey: string; nameCn: string; nameEn?: string }>
  debounceMs?: number
  onNavigate?: (href: string) => void
}

const LISTBOX_ID = 'research-predict-listbox'

function toHit(
  row: { companyKey: string; nameCn: string; nameEn?: string; displayName?: string; type?: string },
  source: PredictCompanyHit['source'],
): PredictCompanyHit {
  return {
    companyKey: row.companyKey,
    nameCn: row.nameCn,
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.type ? { type: row.type } : {}),
    source,
  }
}

function primaryLabel(hit: PredictCompanyHit): string {
  return hit.nameCn || hit.displayName || hit.companyKey
}

export function ResearchCompanyPredictInput({
  teamSlug,
  showcaseSuggestions = [],
  debounceMs = 250,
  onNavigate,
}: Props) {
  const { t } = useTranslation()
  const routerNavigate = useNavigate()
  const navigate = onNavigate ?? ((href: string) => {
    routerNavigate(href)
  })

  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [matchItems, setMatchItems] = useState<PredictCompanyHit[]>([])
  const [recent, setRecent] = useState<PredictCompanyHit[]>(() =>
    loadResearchRecentCompanies().map((r) => toHit(r, 'recent')),
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const baseId = useId()

  const trimmed = q.trim()

  const predictLoadError = t('research.predictLoadError', {
    defaultValue: '企业预测加载失败',
  })

  // Debounced industry + resolve fetch
  useEffect(() => {
    if (!trimmed) {
      // Avoid setState that forces a re-render when already clear.
      setMatchItems((prev) => (prev.length === 0 ? prev : []))
      setLoading((prev) => (prev ? false : prev))
      setError((prev) => (prev == null ? prev : null))
      return undefined
    }

    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [industryResult, resolveResult] = await Promise.all([
            rawApiClient.GET<{ success: boolean; items?: IndustryEntity[] }>(
              '/api/research/industry',
              { params: { query: { limit: 24, q: trimmed } } },
            ),
            rawApiClient.GET<{ success: boolean; hit?: IndustryEntity | null }>(
              '/api/research/industry/resolve',
              { params: { query: { q: trimmed } } },
            ),
          ])

          if (requestId !== requestIdRef.current) return

          if (industryResult.error && !industryResult.data?.success) {
            setError(predictLoadError)
            setMatchItems([])
            setLoading(false)
            return
          }

          const industryItems = Array.isArray(industryResult.data?.items)
            ? industryResult.data!.items!
            : []
          const resolveHit =
            resolveResult.data?.success && resolveResult.data.hit
              ? resolveResult.data.hit
              : null

          const pinned: PredictCompanyHit[] = []
          const seen = new Set<string>()

          if (resolveHit?.companyKey) {
            pinned.push(toHit(resolveHit, 'resolve'))
            seen.add(resolveHit.companyKey)
          }

          for (const row of industryItems) {
            if (!row?.companyKey || seen.has(row.companyKey)) continue
            seen.add(row.companyKey)
            pinned.push(toHit(row, 'industry'))
          }

          setMatchItems(pinned)
          setLoading(false)
        } catch {
          if (requestId !== requestIdRef.current) return
          setError(predictLoadError)
          setLoading(false)
        }
      })()
    }, debounceMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [trimmed, debounceMs, predictLoadError])

  // Click outside closes
  useEffect(() => {
    if (!focused) return undefined
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFocused(false)
        setActiveIndex(-1)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [focused])

  const showcaseHits = useMemo(
    () => showcaseSuggestions.map((s) => toHit(s, 'showcase')),
    [showcaseSuggestions],
  )

  const emptyQueryMode = !trimmed

  const flatOptions = useMemo((): PredictCompanyHit[] => {
    if (emptyQueryMode) {
      if (recent.length > 0) return recent
      return showcaseHits
    }
    return matchItems
  }, [emptyQueryMode, recent, showcaseHits, matchItems])

  const showRecentGroup = emptyQueryMode && recent.length > 0
  const showShowcaseGroup = emptyQueryMode && recent.length === 0 && showcaseHits.length > 0
  const showMatchGroup = !emptyQueryMode && (matchItems.length > 0 || loading || !!error)

  const isOpen =
    focused
    && (
      flatOptions.length > 0
      || loading
      || !!error
      || (emptyQueryMode && (recent.length > 0 || showcaseHits.length > 0))
      || (!emptyQueryMode && trimmed.length > 0)
    )

  useEffect(() => {
    setActiveIndex(-1)
  }, [flatOptions.length, trimmed])

  const selectHit = useCallback(
    (hit: PredictCompanyHit) => {
      upsertResearchRecentCompany({
        companyKey: hit.companyKey,
        nameCn: hit.nameCn || hit.displayName || hit.companyKey,
        ...(hit.nameEn ? { nameEn: hit.nameEn } : {}),
      })
      setRecent(loadResearchRecentCompanies().map((r) => toHit(r, 'recent')))
      setFocused(false)
      setActiveIndex(-1)
      const href = `/${teamSlug}/research/${encodeURIComponent(hit.companyKey)}?persona=hr`
      navigate(href)
    },
    [navigate, teamSlug],
  )

  const activeOptionId =
    activeIndex >= 0 && activeIndex < flatOptions.length
      ? `${baseId}-option-${activeIndex}`
      : undefined

  const placeholder = t('research.predictPlaceholder', {
    defaultValue: '搜索企业（如 发那科 / FANUC）',
  })

  return (
    <div ref={containerRef} className="relative" data-testid="research-predict-root">
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-haspopup="listbox"
        aria-label={placeholder}
        data-testid="research-company-search"
        value={q}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setFocused(true)
          setRecent(loadResearchRecentCompanies().map((r) => toHit(r, 'recent')))
        }}
        onChange={(event) => {
          setQ(event.target.value)
          setActiveIndex(-1)
        }}
        onKeyDown={(event) => {
          if (!isOpen) {
            if (event.key === 'Escape') {
              event.preventDefault()
              setQ('')
              setActiveIndex(-1)
            }
            return
          }

          switch (event.key) {
            case 'ArrowDown': {
              event.preventDefault()
              if (flatOptions.length === 0) return
              setActiveIndex((prev) =>
                prev < flatOptions.length - 1 ? prev + 1 : 0,
              )
              break
            }
            case 'ArrowUp': {
              event.preventDefault()
              if (flatOptions.length === 0) return
              setActiveIndex((prev) =>
                prev > 0 ? prev - 1 : flatOptions.length - 1,
              )
              break
            }
            case 'Enter': {
              if (activeIndex >= 0 && activeIndex < flatOptions.length) {
                event.preventDefault()
                selectHit(flatOptions[activeIndex]!)
              }
              break
            }
            case 'Escape': {
              event.preventDefault()
              setActiveIndex(-1)
              setFocused(false)
              break
            }
          }
        }}
      />

      {error && focused ? (
        <p className="mt-1 text-xs text-destructive" data-testid="research-predict-error">
          {error}
        </p>
      ) : null}

      {isOpen ? (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          data-testid="research-predict-listbox"
          className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-30 max-h-72 overflow-auto rounded-lg border bg-background shadow-lg"
          aria-label={t('research.predictListLabel', { defaultValue: '企业预测' })}
        >
          {loading && matchItems.length === 0 && !emptyQueryMode ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              {t('research.predictLoading', { defaultValue: '加载中…' })}
            </li>
          ) : null}

          {!loading && !emptyQueryMode && matchItems.length === 0 && !error ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              {t('research.predictEmpty', {
                defaultValue: '无匹配企业。可试 发那科 / 宝力机械，或加载展示数据。',
              })}
            </li>
          ) : null}

          {showRecentGroup ? (
            <li role="presentation">
              <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('research.predictRecent', { defaultValue: '最近打开' })}
              </div>
              <ul role="group" className="p-1">
                {recent.map((hit, index) => (
                  <OptionRow
                    key={`recent-${hit.companyKey}`}
                    hit={hit}
                    id={`${baseId}-option-${index}`}
                    index={index}
                    activeIndex={activeIndex}
                    onSelect={selectHit}
                    onHover={setActiveIndex}
                  />
                ))}
              </ul>
            </li>
          ) : null}

          {showShowcaseGroup ? (
            <li role="presentation">
              <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('research.predictShowcase', { defaultValue: '展示推荐' })}
              </div>
              <ul role="group" className="p-1">
                {showcaseHits.map((hit, index) => (
                  <OptionRow
                    key={`showcase-${hit.companyKey}`}
                    hit={hit}
                    id={`${baseId}-option-${index}`}
                    index={index}
                    activeIndex={activeIndex}
                    onSelect={selectHit}
                    onHover={setActiveIndex}
                  />
                ))}
              </ul>
            </li>
          ) : null}

          {showMatchGroup && matchItems.length > 0 ? (
            <li role="presentation">
              <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('research.predictMatches', { defaultValue: '匹配' })}
              </div>
              <ul role="group" className="p-1">
                {matchItems.map((hit, index) => (
                  <OptionRow
                    key={`match-${hit.companyKey}`}
                    hit={hit}
                    id={`${baseId}-option-${index}`}
                    index={index}
                    activeIndex={activeIndex}
                    onSelect={selectHit}
                    onHover={setActiveIndex}
                  />
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

function OptionRow({
  hit,
  id,
  index,
  activeIndex,
  onSelect,
  onHover,
}: {
  hit: PredictCompanyHit
  id: string
  index: number
  activeIndex: number
  onSelect: (hit: PredictCompanyHit) => void
  onHover: (index: number) => void
}) {
  const label = primaryLabel(hit)
  const secondary = [hit.nameEn, hit.type].filter(Boolean).join(' · ')

  return (
    <li
      id={id}
      role="option"
      aria-selected={index === activeIndex}
      data-company-key={hit.companyKey}
      data-source={hit.source}
      className={cn(
        'cursor-pointer rounded-md px-3 py-2 text-left transition-colors',
        index === activeIndex ? 'bg-muted' : 'hover:bg-muted/70',
      )}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onHover(index)}
      onClick={() => onSelect(hit)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{label}</div>
          {secondary ? (
            <div className="truncate text-xs text-muted-foreground">{secondary}</div>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {hit.companyKey}
        </span>
      </div>
    </li>
  )
}

export default ResearchCompanyPredictInput
