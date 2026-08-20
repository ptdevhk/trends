import { Clock3, FileText, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { JdPastePopover } from '@/components/search/JdPastePopover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSearchPreload } from '@/hooks/useSearchPrefetch'
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
  prefetchSearch?: boolean
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
  prefetchSearch = true,
}: GoogleSearchBarProps) {
  const { t } = useTranslation()
  const [focused, setFocused] = useState(false)
  const [jdPopoverOpen, setJdPopoverOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedValue = value.trim()
  const isMacLike = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform ?? '')
  useSearchPreload(trimmedValue, prefetchSearch)
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
  const isListboxOpen = focused && !jdPopoverOpen && filteredRecentSearches.length > 0
  const listboxId = 'recent-searches-listbox'
  const activeOptionId = activeIndex >= 0 ? `recent-search-option-${activeIndex}` : undefined

  // Reset active index when list changes
  useEffect(() => {
    setActiveIndex(-1)
  }, [filteredRecentSearches.length, trimmedValue])

  // Global Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

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
          ref={inputRef}
          aria-label={placeholderLabel}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isListboxOpen}
          aria-haspopup="listbox"
          role="combobox"
          data-testid="resume-search-input"
          value={value}
          className={cn(
            'border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            compact ? 'h-14 text-base' : 'h-16 text-lg'
          )}
          placeholder={placeholderLabel}
          onBlur={() => {
            window.setTimeout(() => {
              setFocused(false)
              setActiveIndex(-1)
            }, 120)
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setActiveIndex(-1)
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (!isListboxOpen) {
              if (event.key === 'Escape') {
                event.preventDefault()
                if (jdPopoverOpen) {
                  setJdPopoverOpen(false)
                  return
                }
                onClear()
              }
              return
            }

            switch (event.key) {
              case 'ArrowDown': {
                event.preventDefault()
                setActiveIndex((prev) =>
                  prev < filteredRecentSearches.length - 1 ? prev + 1 : 0
                )
                break
              }
              case 'ArrowUp': {
                event.preventDefault()
                setActiveIndex((prev) =>
                  prev > 0 ? prev - 1 : filteredRecentSearches.length - 1
                )
                break
              }
              case 'Enter': {
                if (activeIndex >= 0 && activeIndex < filteredRecentSearches.length) {
                  event.preventDefault()
                  setFocused(false)
                  setActiveIndex(-1)
                  void onApplyRecentSearch(filteredRecentSearches[activeIndex])
                }
                break
              }
              case 'Escape': {
                event.preventDefault()
                setActiveIndex(-1)
                if (jdPopoverOpen) {
                  setJdPopoverOpen(false)
                } else {
                  onClear()
                }
                break
              }
            }
          }}
        />
        {!trimmedValue ? (
          <kbd
            aria-hidden="true"
            className={cn(
              'pointer-events-none mr-1 hidden select-none items-center rounded-md border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex',
              compact ? 'h-5' : 'h-6'
            )}
          >
            {isMacLike ? '⌘K' : 'Ctrl K'}
          </kbd>
        ) : null}
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

      <div role="status" aria-live="polite" className="sr-only">
        {isListboxOpen ? t('resumes.searchPage.searchBar.recentSearchCount', {
          defaultValue: '{{count}} recent searches available',
          count: filteredRecentSearches.length,
        }) : null}
      </div>

      {jdPopoverOpen && onApplyExtractedKeywords ? (
        <JdPastePopover
          compact={compact}
          onApplyKeywords={onApplyExtractedKeywords}
          onClose={() => setJdPopoverOpen(false)}
        />
      ) : null}

      {isListboxOpen ? (
        <div id={listboxId} className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-30 overflow-hidden rounded-3xl border bg-background shadow-xl" role="listbox" aria-label={recentSearchesLabel}>
          <div className="border-b px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {recentSearchesLabel}
          </div>
          <div className="p-2">
            {filteredRecentSearches.map((item, index) => (
              <button
                key={item.id}
                id={`recent-search-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
                  index === activeIndex ? 'bg-muted' : 'hover:bg-muted'
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  setFocused(false)
                  setActiveIndex(-1)
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
