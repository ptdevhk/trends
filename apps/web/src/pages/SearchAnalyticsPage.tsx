import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { rawApiClient } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/PageHeader'
import { reportUiError } from '@/lib/ui-error-reporting'
type SearchSummaryPayload = {
  totalSearches: number
  zeroResultSearches: number
  zeroResultRate: number
  topQueries: Array<{ query: string; count: number }>
  actionDistribution: Record<string, number>
  dailyTrend: Array<{
    date: string
    searches: number
    zeroResults: number
    shortlist: number
    reject: number
  }>
}

type SearchSummaryResponse = {
  success: boolean
  summary?: SearchSummaryPayload
}

type ZeroResultItem = {
  query: string
  count: number
  lastSeen: string
}

type ZeroResultResponse = {
  success: boolean
  items?: ZeroResultItem[]
}

type SynonymSuggestion = {
  query: string
  variant: string
  canonical: string
  confidence: number
  reason: string
}

type SynonymSuggestionsResponse = {
  success: boolean
  suggestions?: SynonymSuggestion[]
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export default function SearchAnalyticsPage() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [submittingQuery, setSubmittingQuery] = useState<string | null>(null)
  const [summary, setSummary] = useState<SearchSummaryPayload | null>(null)
  const [zeroResults, setZeroResults] = useState<ZeroResultItem[]>([])
  const [suggestions, setSuggestions] = useState<SynonymSuggestion[]>([])

  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryResponse, zeroResponse, suggestionResponse] = await Promise.all([
        rawApiClient.GET<SearchSummaryResponse>('/api/search-analytics/summary'),
        rawApiClient.GET<ZeroResultResponse>('/api/search-analytics/zero-results', {
          params: { query: { limit: 50 } },
        }),
        rawApiClient.GET<SynonymSuggestionsResponse>('/api/search-analytics/synonym-suggestions', {
          params: { query: { limit: 200 } },
        }),
      ])

      if (!summaryResponse.data?.success || !summaryResponse.data.summary) {
        throw new Error('Failed to load summary')
      }

      setSummary(summaryResponse.data.summary)
      setZeroResults(zeroResponse.data?.success ? (zeroResponse.data.items || []) : [])
      setSuggestions(suggestionResponse.data?.success ? (suggestionResponse.data.suggestions || []) : [])
    } catch (error) {
      reportUiError('Failed to load search analytics', error)
      toast.error(t('searchAnalytics.loadError', { defaultValue: 'Failed to load search analytics' }))
    } finally {
      setLoading(false)
    }
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadAnalytics()
  }, [loadAnalytics])

  const suggestionMap = useMemo(() => {
    const map = new Map<string, SynonymSuggestion>()
    suggestions.forEach((item) => {
      if (!map.has(item.query)) {
        map.set(item.query, item)
      }
    })
    return map
  }, [suggestions])

  const maxSearchVolume = useMemo(() => {
    return Math.max(1, ...(summary?.dailyTrend.map((item) => item.searches) || [1]))
  }, [summary])

  const handleSuggestSynonym = useCallback(async (query: string) => {
    const suggestion = suggestionMap.get(query)
    if (!suggestion) {
      return
    }

    setSubmittingQuery(query)
    try {
      const observation = `synonym_suggestion: ${suggestion.variant} -> ${suggestion.canonical}`
      const { data } = await rawApiClient.POST<{ success: boolean }>('/api/resumes/learning-feedback', {
        body: { observation },
      })

      if (!data?.success) {
        throw new Error('Failed to append suggestion')
      }

      toast.success(t('searchAnalytics.suggestionSaved', { defaultValue: 'Synonym suggestion saved' }))
      await loadAnalytics()
    } catch (error) {
      reportUiError('Failed to submit synonym suggestion', error)
      toast.error(t('searchAnalytics.suggestionError', { defaultValue: 'Failed to save suggestion' }))
    } finally {
      setSubmittingQuery(null)
    }
  }, [loadAnalytics, suggestionMap, t])

  if (loading && !summary) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t('searchAnalytics.loading', { defaultValue: 'Loading analytics...' })}
        </CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t('searchAnalytics.noData', { defaultValue: 'No analytics data available yet.' })}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('searchAnalytics.title', { defaultValue: 'Search Accuracy Dashboard' })}
        description={t('searchAnalytics.subtitle', { defaultValue: 'Track query quality and curate synonym improvements.' })}
        actions={
          <Button variant="outline" onClick={() => void loadAnalytics()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {t('searchAnalytics.refresh', { defaultValue: 'Refresh' })}
          </Button>
        }
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('searchAnalytics.metrics.totalSearches', { defaultValue: 'Total Searches' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.totalSearches}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('searchAnalytics.metrics.zeroRate', { defaultValue: 'Zero-result Rate' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{percentage(summary.zeroResultRate)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('searchAnalytics.metrics.shortlist', { defaultValue: 'Shortlist Actions' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.actionDistribution.shortlist || 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('searchAnalytics.metrics.reject', { defaultValue: 'Reject Actions' })}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary.actionDistribution.reject || 0}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('searchAnalytics.topQueries', { defaultValue: 'Top Queries' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {summary.topQueries.length === 0 ? (
              <div className="text-muted-foreground">{t('searchAnalytics.noTopQueries', { defaultValue: 'No query data yet.' })}</div>
            ) : summary.topQueries.map((item) => (
              <div key={item.query} className="flex items-center justify-between border-b border-dashed pb-1 last:border-b-0">
                <span className="truncate pr-4">{item.query}</span>
                <span className="font-medium">{item.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('searchAnalytics.dailyTrend', { defaultValue: 'Daily Trend' })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.dailyTrend.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('searchAnalytics.noTrend', { defaultValue: 'No trend data yet.' })}</div>
            ) : summary.dailyTrend.map((item) => {
              const widthRatio = Math.max(6, Math.round((item.searches / maxSearchVolume) * 100))
              return (
                <div key={item.date} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>{item.date}</span>
                    <span>
                      {item.searches} / {item.zeroResults}
                    </span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${widthRatio}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('searchAnalytics.zeroResults', { defaultValue: 'Zero-result Queries' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('searchAnalytics.table.query', { defaultValue: 'Query' })}</TableHead>
                <TableHead className="w-[100px]">{t('searchAnalytics.table.count', { defaultValue: 'Count' })}</TableHead>
                <TableHead className="w-[240px]">{t('searchAnalytics.table.suggestion', { defaultValue: 'Suggestion' })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zeroResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {t('searchAnalytics.noZeroResults', { defaultValue: 'No zero-result queries recorded.' })}
                  </TableCell>
                </TableRow>
              ) : zeroResults.map((item) => {
                const suggestion = suggestionMap.get(item.query)
                const isSubmitting = submittingQuery === item.query

                return (
                  <TableRow key={item.query}>
                    <TableCell className="max-w-[460px] truncate" title={item.query}>{item.query}</TableCell>
                    <TableCell>{item.count}</TableCell>
                    <TableCell>
                      {suggestion ? (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleSuggestSynonym(item.query)}
                            disabled={isSubmitting}
                          >
                            <Lightbulb className="h-3.5 w-3.5 mr-1" />
                            {isSubmitting
                              ? t('searchAnalytics.savingSuggestion', { defaultValue: 'Saving...' })
                              : t('searchAnalytics.suggestSynonym', { defaultValue: 'Suggest Synonym' })}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {suggestion.variant} → {suggestion.canonical}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('searchAnalytics.noSuggestion', { defaultValue: 'No suggestion available' })}</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
