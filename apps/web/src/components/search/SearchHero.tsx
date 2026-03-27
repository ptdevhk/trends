import { Clock3, Sparkles } from 'lucide-react'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import { Card, CardContent } from '@/components/ui/card'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

type SearchHeroProps = {
  loading?: boolean
  queryInput: string
  recentSearches: ResumeSearchRecentItem[]
  recentSearchesLoading?: boolean
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
  onApplyExtractedKeywords: (keywords: string[]) => void
  onChangeQuery: (value: string) => void
  onClearQuery: () => void
  onSubmitQuery: (value?: string) => void
}

export function SearchHero({
  loading = false,
  queryInput,
  recentSearches,
  recentSearchesLoading = false,
  onApplyRecentSearch,
  onApplyExtractedKeywords,
  onChangeQuery,
  onClearQuery,
  onSubmitQuery,
}: SearchHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border bg-gradient-to-br from-white via-slate-50 to-amber-50 px-6 py-12 shadow-[0_28px_80px_-52px_rgba(15,23,42,0.55)] sm:px-10 sm:py-16">
      <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-amber-200/30 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-40 w-40 rounded-full bg-sky-200/30 blur-3xl" />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-8 text-center">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            Search-first resume review
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Search resumes like a conversation, not a control panel.
            </h1>
            <p className="mx-auto max-w-2xl text-sm text-slate-600 sm:text-base">
              Start with keywords. Refine with facets. Review the strongest snippets before you open the full profile.
            </p>
          </div>
        </div>

        <div className="w-full max-w-3xl">
          <GoogleSearchBar
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

        <div className="w-full max-w-3xl text-left">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            Recent searches
          </div>
          {recentSearchesLoading ? (
            <Card className="rounded-[1.5rem] border-dashed">
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading recent searches...
              </CardContent>
            </Card>
          ) : recentSearches.length === 0 ? (
            <Card className="rounded-[1.5rem] border-dashed">
              <CardContent className="p-6 text-sm text-muted-foreground">
                No saved searches yet. Recent searches will appear here after you start exploring.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {recentSearches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="rounded-[1.5rem] border bg-white/80 px-4 py-4 text-left transition-transform transition-colors hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
                  onClick={() => void onApplyRecentSearch(item)}
                >
                  <div className="truncate text-sm font-medium text-slate-900">
                    {item.keywords.join(' ') || item.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {[item.location, item.jobDescriptionId].filter(Boolean).join(' · ') || item.title}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
