import { Clock3, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

type GoogleSearchBarProps = {
  compact?: boolean
  loading?: boolean
  recentSearches: ResumeSearchRecentItem[]
  value: string
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
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
  onChange,
  onClear,
  onSubmit,
  placeholder = 'Search resumes by keywords, brands, roles, or locations',
}: GoogleSearchBarProps) {
  const [focused, setFocused] = useState(false)
  const trimmedValue = value.trim()
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

  return (
    <div className="relative">
      <form
        className={cn(
          'relative flex items-center overflow-hidden rounded-full border bg-background/95 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.85)] transition-shadow focus-within:shadow-[0_20px_60px_-30px_rgba(15,23,42,0.55)]',
          compact ? 'min-h-14' : 'min-h-16'
        )}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(trimmedValue)
        }}
      >
        <div className="pl-5 text-muted-foreground">
          <Search className={cn(compact ? 'h-4 w-4' : 'h-5 w-5')} />
        </div>
        <Input
          value={value}
          className={cn(
            'border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            compact ? 'h-14 text-base' : 'h-16 text-lg'
          )}
          placeholder={placeholder}
          onBlur={() => {
            window.setTimeout(() => setFocused(false), 120)
          }}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClear()
            }
          }}
        />
        {trimmedValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 rounded-full text-muted-foreground"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Clear search</span>
          </Button>
        ) : null}
        <div className="pr-2">
          <Button type="submit" className="rounded-full px-5" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </form>

      {focused && filteredRecentSearches.length > 0 ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-30 overflow-hidden rounded-3xl border bg-background shadow-xl">
          <div className="border-b px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Recent searches
          </div>
          <div className="p-2">
            {filteredRecentSearches.map((item) => (
              <button
                key={item.id}
                type="button"
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
