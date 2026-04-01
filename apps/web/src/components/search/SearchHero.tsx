import { Clock3, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ModeToggle } from '@/components/ModeToggle'
import { GoogleSearchBar } from '@/components/search/GoogleSearchBar'
import { Card, CardContent } from '@/components/ui/card'
import type { ResumeSearchRecentItem } from '@/components/search/search-types'

type SearchHeroQuickStart = {
  id: string
  label: string
  location: string
  keywords: string[]
  description?: string
}

type SearchHeroHotKeyword = {
  id: string | number
  keyword: string
  english?: string
}

type SearchHeroProps = {
  loading?: boolean
  queryInput: string
  aiModeEnabled: boolean
  aiModeStats?: { avgScore: number; matched: number; processed?: number }
  recentSearches: ResumeSearchRecentItem[]
  recentSearchesLoading?: boolean
  quickStarts?: SearchHeroQuickStart[]
  hotKeywords?: SearchHeroHotKeyword[]
  onApplyRecentSearch: (item: ResumeSearchRecentItem) => void | Promise<void>
  onApplyExtractedKeywords: (keywords: string[]) => void
  onApplyQuickStart?: (seed: { keywords: string[]; location: string }) => void
  onToggleHotKeyword?: (keyword: string) => void
  onAiModeChange: (enabled: boolean) => void
  onChangeQuery: (value: string) => void
  onClearQuery: () => void
  onSubmitQuery: (value?: string) => void
}

const INTERACTIVE_CARD_CLASS_NAME =
  'rounded-[1.5rem] border bg-slate-50 px-4 py-4 text-left transition-transform transition-colors hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white'

function deduplicateHotKeywords(
  items: SearchHeroHotKeyword[],
): SearchHeroHotKeyword[] {
  const seen = new Set<string>()
  const deduplicated: SearchHeroHotKeyword[] = []

  items.forEach((item) => {
    const keyword = item.keyword.trim()
    const fingerprint = keyword.toLowerCase()
    if (!keyword || seen.has(fingerprint)) {
      return
    }

    seen.add(fingerprint)
    deduplicated.push({
      ...item,
      keyword,
    })
  })

  return deduplicated
}

export function SearchHero({
  loading = false,
  queryInput,
  aiModeEnabled,
  aiModeStats,
  recentSearches,
  recentSearchesLoading = false,
  quickStarts = [],
  hotKeywords = [],
  onApplyRecentSearch,
  onApplyExtractedKeywords,
  onApplyQuickStart,
  onToggleHotKeyword,
  onAiModeChange,
  onChangeQuery,
  onClearQuery,
  onSubmitQuery,
}: SearchHeroProps) {
  const { t } = useTranslation()
  const uniqueHotKeywords = deduplicateHotKeywords(hotKeywords)

  return (
    <section className="rounded-[2rem] border bg-white px-6 py-8 shadow-[0_28px_80px_-60px_rgba(15,23,42,0.5)] sm:px-10 sm:py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="min-w-0 flex-1">
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

          <div className="self-end lg:self-center">
            <ModeToggle
              mode={aiModeEnabled ? 'ai' : 'original'}
              onModeChange={(mode) => onAiModeChange(mode === 'ai')}
              aiStats={aiModeStats}
            />
          </div>
        </div>

        {quickStarts.length > 0 ? (
          <div className="mx-auto w-full max-w-3xl text-left">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              {t('resumes.searchPage.hero.quickStart', {
                defaultValue: 'Quick Start',
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {quickStarts.map((seed) => (
                <button
                  key={seed.id}
                  type="button"
                  className={INTERACTIVE_CARD_CLASS_NAME}
                  onClick={() =>
                    void onApplyQuickStart?.({
                      keywords: seed.keywords,
                      location: seed.location,
                    })
                  }
                >
                  <div className="truncate text-sm font-medium text-slate-900">
                    {seed.label}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {`${seed.keywords.join(', ')} · ${seed.location}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {uniqueHotKeywords.length > 0 ? (
          <div className="mx-auto w-full max-w-3xl text-left">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {t('resumes.searchPage.hero.hotTags', {
                defaultValue: 'Hot Tags',
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {uniqueHotKeywords.map((keyword) => (
                <button
                  key={keyword.id}
                  type="button"
                  className="rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white"
                  onClick={() => void onToggleHotKeyword?.(keyword.keyword)}
                >
                  {keyword.keyword}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mx-auto w-full max-w-3xl text-left">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {t('resumes.searchPage.hero.recentSearches', {
              defaultValue: 'Recent searches',
            })}
          </div>
          {recentSearchesLoading ? (
            <Card className="rounded-[1.5rem] border-dashed">
              <CardContent className="p-6 text-sm text-muted-foreground">
                {t('resumes.searchPage.hero.loadingRecentSearches', {
                  defaultValue: 'Loading recent searches...',
                })}
              </CardContent>
            </Card>
          ) : recentSearches.length === 0 ? (
            <Card className="rounded-[1.5rem] border-dashed">
              <CardContent className="p-6 text-sm text-muted-foreground">
                {t('resumes.searchPage.hero.noSavedSearches', {
                  defaultValue: 'No saved searches yet. Recent searches will appear here after you start exploring.',
                })}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {recentSearches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={INTERACTIVE_CARD_CLASS_NAME}
                  onClick={() => void onApplyRecentSearch(item)}
                >
                  <div className="truncate text-sm font-medium text-slate-900">
                    {item.keywords.join(' ') || item.title}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {[item.location, item.jobDescriptionId]
                      .filter(Boolean)
                      .join(' · ') || item.title}
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
