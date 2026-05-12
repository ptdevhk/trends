import { useTranslation } from 'react-i18next'
import { Link } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  onApplyExtractedKeywords: (keywords: string[]) => void
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
  onApplyExtractedKeywords,
  onChangeQuery,
  onClearQuery,
  onSubmitQuery,
  onSortChange,
}: SearchHeaderProps) {
  const { t } = useTranslation()
  const resultsLabel = activeQuery
    ? t('resumes.searchPage.header.resultsWithQuery', {
      count: activeResultCount.toLocaleString(),
      query: activeQuery,
      defaultValue: '为"{{query}}"找到 {{count}} 条结果',
    })
    : t('resumes.searchPage.header.results', {
      count: activeResultCount.toLocaleString(),
      defaultValue: '找到 {{count}} 条结果',
    })
  const sortLabel = t('resumes.searchPage.header.sort', {
    defaultValue: '排序',
  })
  const sortResultsLabel = t('resumes.searchPage.header.sortResults', {
    defaultValue: '结果排序',
  })
  const aiScoreLabel = t('resumes.searchPage.header.sortOptions.aiScore', {
    defaultValue: 'AI 评分',
  })
  const newestLabel = t('resumes.searchPage.header.sortOptions.newest', {
    defaultValue: '最新活跃',
  })
  const experienceLabel = t('resumes.searchPage.header.sortOptions.experience', {
    defaultValue: '工作经验',
  })
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
          <div className="text-sm font-medium text-slate-900">{resultsLabel}</div>
          <div role="status" aria-live="polite" className="sr-only">
            {loading ? t('resumes.searchPage.header.loading', { defaultValue: '正在加载...' }) : resultsLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            {location ? <Badge variant="outline">{location}</Badge> : null}
            {jobDescriptionId ? <Badge variant="outline">JD {jobDescriptionId}</Badge> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {sortLabel}
            </span>
            <Select
              aria-label={sortResultsLabel}
              className="min-w-40"
              options={[
                { value: 'score', label: aiScoreLabel },
                { value: 'newest', label: newestLabel },
                { value: 'experience', label: experienceLabel },
              ]}
              value={sortValue}
              onChange={(event) =>
                onSortChange(event.target.value as SearchSortValue)
              }
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                toast.success(t('resumes.searchPage.header.linkCopied', { defaultValue: '链接已复制' }))
              }).catch(() => {
                toast.error(t('resumes.searchPage.header.copyFailed', { defaultValue: '复制失败' }))
              })
            }}
            aria-label={t('resumes.searchPage.header.copyLink', { defaultValue: '复制搜索链接' })}
          >
            <Link className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {t('resumes.searchPage.header.copyLink', { defaultValue: '复制链接' })}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}
