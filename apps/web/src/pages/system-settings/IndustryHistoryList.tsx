import { History, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { paths } from '@/lib/api-types'
import { displayCompany } from './industry-verification-model'

type ProposalListResponse = paths['/api/company-industry-proposals']['get']['responses'][200]['content']['application/json']
export type IndustryHistoryItem = ProposalListResponse['items'][number]

type IndustryHistoryListProps = {
  items: IndustryHistoryItem[]
  targetItem?: IndustryHistoryItem
  loading: boolean
  loaded: boolean
  error?: string
  partial?: boolean
  selectedProposalId?: string
  onRetry: () => void
  onSelect: (item: IndustryHistoryItem) => void
}

export function IndustryHistoryList({
  items,
  targetItem,
  loading,
  loaded,
  error,
  partial = false,
  selectedProposalId,
  onRetry,
  onSelect,
}: IndustryHistoryListProps) {
  const { t } = useTranslation()
  const visibleItems = targetItem
    ? [targetItem, ...items.filter((item) => item.proposalId !== targetItem.proposalId)]
    : items

  if (loading && !loaded) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('industryEvidence.historyLoading', { defaultValue: 'Loading history…' })}
      </div>
    )
  }

  if (error && !loaded) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-950" role="alert" data-testid="industry-history-error">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('industryEvidence.historyRetry', { defaultValue: 'Retry history' })}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (visibleItems.length === 0) {
    if (error) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" role="status" data-testid="industry-history-partial-error">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-2">
              <p>{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('industryEvidence.historyRetry', { defaultValue: 'Retry history' })}
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground" data-testid="industry-history-empty">
        <History className="mx-auto mb-3 h-5 w-5" aria-hidden="true" />
        {t('industryEvidence.historyEmpty', { defaultValue: 'No terminal review history yet.' })}
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="industry-history-list">
      {error ? (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${
            partial
              ? 'border border-amber-300 bg-amber-50 text-amber-950'
              : 'border border-rose-300 bg-rose-50 text-rose-950'
          }`}
          role="status"
          data-testid={partial ? 'industry-history-partial-error' : 'industry-history-retained-error'}
        >
          <span>{error}</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-current" onClick={onRetry}>
            {t('industryEvidence.historyRetry', { defaultValue: 'Retry history' })}
          </Button>
        </div>
      ) : null}
      {visibleItems.map((item) => {
        const company = displayCompany(item.companyKey ?? item.normalizedEmployerSurface)
        const selected = item.proposalId === selectedProposalId
        const targeted = targetItem?.proposalId === item.proposalId
        return (
          <article
            key={item.proposalId}
            className={`${targeted ? 'scroll-mt-px' : 'scroll-mt-16'} rounded-xl border bg-card p-4 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected ? 'border-primary bg-primary/[0.03]' : 'border-border hover:border-primary/40'
            }`}
            data-testid={`industry-history-row-${item.proposalId}`}
            data-industry-review-target={targeted ? 'true' : undefined}
            tabIndex={0}
            role="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(item)
              }
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold tracking-tight">{company}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.materialChangeSummary ?? item.reviewNote ?? item.triggerReasons.join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{item.status}</Badge>
                <Badge variant="secondary">P{item.priority}</Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>{item.suggestedIndustryClass ?? 'unknown'}</span>
              <span>·</span>
              <span>{t('industryEvidence.historyReadOnly', { defaultValue: 'Read-only record' })}</span>
              {item.reviewedAt ? (
                <>
                  <span>·</span>
                  <time dateTime={new Date(item.reviewedAt).toISOString()}>
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.reviewedAt))}
                  </time>
                </>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
