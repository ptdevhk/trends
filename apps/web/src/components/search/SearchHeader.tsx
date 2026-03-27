import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import type { ResumeSearchRecentItem, SearchSortValue } from '@/components/search/search-types'
import type { ResumeExportFormat } from '@/types/resume'
import { cn } from '@/lib/utils'

type SearchHeaderProps = {
  activeQuery?: string
  activeResultCount: number
  exportFormat: ResumeExportFormat
  exportingResults?: boolean
  jobDescriptionId?: string
  loading?: boolean
  location?: string
  queryInput: string
  recentSearches: ResumeSearchRecentItem[]
  sortValue: SearchSortValue
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
  onApplyExtractedKeywords: (keywords: string[]) => void
  onChangeQuery: (value: string) => void
  onClearQuery: () => void
  onExportFormatChange: (format: ResumeExportFormat) => void
  onExportResults: () => void | Promise<void>
  onSubmitQuery: (value?: string) => void
  onSortChange: (value: SearchSortValue) => void
}

export function SearchHeader({
  activeQuery,
  activeResultCount,
  exportFormat,
  exportingResults = false,
  jobDescriptionId,
  loading = false,
  location,
  queryInput,
  recentSearches,
  sortValue,
  onApplyRecentSearch,
  onApplyExtractedKeywords,
  onChangeQuery,
  onClearQuery,
  onExportFormatChange,
  onExportResults,
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
          onApplyExtractedKeywords={onApplyExtractedKeywords}
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

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Sort
            </span>
            <Select
              aria-label="Sort results"
              className="min-w-40"
              options={[
                { value: 'score', label: 'AI score' },
                { value: 'newest', label: 'Newest' },
                { value: 'experience', label: 'Experience' },
              ]}
              value={sortValue}
              onChange={(event) =>
                onSortChange(event.target.value as SearchSortValue)
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Select
              aria-label="Export format"
              className="h-10 min-w-24 rounded-full border-0 bg-slate-100/90 pr-8 focus-visible:ring-0 focus-visible:ring-offset-0"
              options={[
                { value: 'csv', label: 'CSV' },
                { value: 'xlsx', label: 'XLSX' },
              ]}
              value={exportFormat}
              onChange={(event) =>
                onExportFormatChange(
                  event.target.value === 'xlsx' ? 'xlsx' : 'csv',
                )
              }
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 gap-2 rounded-full px-4"
              disabled={loading || exportingResults || activeResultCount === 0}
              onClick={() => {
                void onExportResults()
              }}
            >
              <Download
                className={cn('h-4 w-4', exportingResults && 'animate-spin')}
              />
              {exportingResults
                ? 'Exporting...'
                : `Export ${activeResultCount.toLocaleString()}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
