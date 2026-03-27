import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import type { ResumeSearchRecentItem, SearchSortValue } from '@/components/search/search-types'

type SearchHeaderProps = {
  activeQuery?: string
  activeResultCount: number
  jobDescriptionId?: string
  loading?: boolean
  location?: string
  queryInput: string
  recentSearches: ResumeSearchRecentItem[]
  sortValue: SearchSortValue
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
  onChangeQuery: (value: string) => void
  onClearQuery: () => void
  onSubmitQuery: (value?: string) => void
  onSortChange: (value: SearchSortValue) => void
}

export function SearchHeader({
  activeQuery,
  activeResultCount,
  jobDescriptionId,
  loading = false,
  location,
  queryInput,
  recentSearches,
  sortValue,
  onApplyRecentSearch,
  onChangeQuery,
  onClearQuery,
  onSubmitQuery,
  onSortChange,
}: SearchHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="mx-auto max-w-5xl">
        <GoogleSearchBar
          compact
          value={queryInput}
          loading={loading}
          recentSearches={recentSearches}
          onApplyRecentSearch={onApplyRecentSearch}
          onChange={onChangeQuery}
          onClear={onClearQuery}
          onSubmit={onSubmitQuery}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-[1.5rem] border bg-white/80 px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="text-sm font-medium text-slate-900">
            {activeResultCount.toLocaleString()} results{activeQuery ? ` for "${activeQuery}"` : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            {location ? <Badge variant="outline">{location}</Badge> : null}
            {jobDescriptionId ? <Badge variant="outline">JD {jobDescriptionId}</Badge> : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Sort
          </span>
          <Select
            className="min-w-40"
            options={[
              { value: 'relevance', label: 'Relevance' },
              { value: 'newest', label: 'Newest' },
              { value: 'experience', label: 'Experience' },
            ]}
            value={sortValue}
            onChange={(event) => onSortChange(event.target.value as SearchSortValue)}
          />
        </div>
      </div>
    </div>
  )
}
