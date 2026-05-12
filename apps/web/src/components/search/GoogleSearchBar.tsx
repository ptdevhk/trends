import { Clock3, FileText, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { JdPastePopover } from '@/components/search/JdPastePopover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

type GoogleSearchBarProps = {
  compact?: boolean
  loading?: boolean
  recentSearches: ResumeSearchRecentItem[]
  value: string
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
  onApplyExtractedKeywords?: (keywords: string[]) => void
  onChange: (value: string) => void
  onClear: () => void
  onSubmit: (value?: string) => void
  placeholder?: string
}

function getRecentSearchLabel(item: ResumeSearchRecentItem): string {
  return item.keywords.join(' ') || item.title
}

export function GoogleSearchBar({
  compact = false,
  loading = false,
  recentSearches,
  value,
  onApplyRecentSearch,
  onApplyExtractedKeywords,
  onChange,
  onClear,
  onSubmit,
  placeholder,
}: GoogleSearchBarProps) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const [jdPopoverOpen, setJdPopoverOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const trimmedValue = value.trim()
  const placeholderLabel = placeholder ?? t('resumes.searchPage.searchBar.placeholder', {
    defaultValue: 'Search resumes by keywords, brands, roles, or locations',
  })
  const searchButtonLabel = loading
    ? t('resumes.searchPage.searchBar.searching', {
      defaultValue: 'Searching...',
    })
    : t('resumes.searchPage.searchBar.search', {
      defaultValue: 'Search',
    })
  const pasteJobDescriptionLabel = t('resumes.searchPage.searchBar.pasteJobDescription', {
    defaultValue: 'Paste job description',
  })
  const clearSearchLabel = t('resumes.searchPage.searchBar.clearSearch', {
    defaultValue: 'Clear search',
  })
  const recentSearchesLabel = t('resumes.searchPage.searchBar.recentSearches', {
    defaultValue: 'Recent searches',
  })
  const filteredRecentSearches = useMemo(() => {
    if (!trimmedValue) {
      return recentSearches.slice(0, 6)
    }

    const normalizedQuery = trimmedValue.toLowerCase()
    return recentSearches.filter((item) =>
      item.title.toLowerCase().includes(normalizedQuery)
      || item.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery))
      || item.location.toLowerCase().includes(normalizedQuery)
    ).slice(0, 6)
  }, [recentSearches, trimmedValue])

  useEffect(() => {
    if (!jdPopoverOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setJdPopoverOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [jdPopoverOpen])

  return (
    <div ref={containerRef} className="relative">
      <form
        className={cn(
          'relative flex items-center overflow-hidden rounded-full border bg-background/95 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.85)] transition-shadow focus-within:shadow-[0_20px_60px_-30px_rgba(15,23,42,0.55)]',
          compact ? 'min-h-14' : 'min-h-16'
        )}
        onSubmit={(event) => {
          event.preventDefault()
          setJdPopoverOpen(false)
          onSubmit(trimmedValue)
        }}
      >
        <div className="pl-5 text-muted-foreground">
          <Search className={cn(compact ? 'h-4 w-4' : 'h-5 w-5')} />
        </div>
        <Input
          aria-label={placeholderLabel}
          data-testid="resume-search-input"
          value={value}
          className={cn(
            'border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            compact ? 'h-14 text-base' : 'h-16 text-lg'
          )}
          placeholder={placeholderLabel}
          onBlur={() => {
            window.setTimeout(() => setFocused(false), 120)
          }}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              if (jdPopoverOpen) {
                setJdPopoverOpen(false)
                return
              }

              onClear()
            }
          }}
        />
        {onApplyExtractedKeywords ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 rounded-full text-muted-foreground"
            onClick={() => {
              setFocused(false)
              setJdPopoverOpen((current) => !current)
            }}
          >
            <FileText className="h-4 w-4" />
            <span className="sr-only">{pasteJobDescriptionLabel}</span>
          </Button>
        ) : null}
        {trimmedValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 rounded-full text-muted-foreground"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{clearSearchLabel}</span>
          </Button>
        ) : null}
        <div className="pr-2">
          <Button type="submit" className="rounded-full px-5" disabled={loading} data-testid="resume-search-submit">
            {searchButtonLabel}
          </Button>
        </div>
      </form>

      {jdPopoverOpen && onApplyExtractedKeywords ? (
        <JdPastePopover
          compact={compact}
          onApplyKeywords={onApplyExtractedKeywords}
          onClose={() => setJdPopoverOpen(false)}
        />
      ) : null}

      {focused && !jdPopoverOpen && filteredRecentSearches.length > 0 ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-30 overflow-hidden rounded-3xl border bg-background shadow-xl" role="listbox" aria-label={recentSearchesLabel}>
          <div className="border-b px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {recentSearchesLabel}
          </div>
          <div className="p-2">
            {filteredRecentSearches.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setFocused(false)
                  void onApplyRecentSearch(item)
                }}
              >
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{getRecentSearchLabel(item)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[item.location, item.jobDescriptionId].filter(Boolean).join(' · ') || item.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
