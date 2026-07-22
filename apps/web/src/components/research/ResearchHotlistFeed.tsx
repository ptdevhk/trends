import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type ResearchHotlistFeedItem = {
  title: string
  platform: string
  url?: string
  capturedAt: number
  matchedKeywords?: string[]
  resolvedCompanies?: Array<{
    companyKey: string
    nameCn: string
    nameEn?: string
  }>
}

export type ResearchHotlistFeedProps = {
  items: ResearchHotlistFeedItem[]
  teamSlug: string
  loading?: boolean
  error?: string | null
  emptyMessage?: string
  /** When set, titles containing any of these substrings get a highlight class (visual only). */
  highlightTerms?: string[]
  className?: string
  listTestId?: string
  itemTestId?: string
}

function formatRelativeTime(capturedAt: number): string | null {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return null
  try {
    return formatDistanceToNow(new Date(capturedAt), { addSuffix: true })
  } catch {
    return null
  }
}

/** True when title contains any highlight term (case-insensitive for ASCII). */
export function titleMatchesHighlight(title: string, terms: string[] | undefined): boolean {
  if (!terms || terms.length === 0) return false
  const lower = title.toLowerCase()
  return terms.some((term) => {
    const t = term.trim()
    if (!t) return false
    return lower.includes(t.toLowerCase())
  })
}

export function ResearchHotlistFeed({
  items,
  teamSlug,
  loading = false,
  error = null,
  emptyMessage,
  highlightTerms,
  className,
  listTestId = 'research-hotlist-feed',
  itemTestId = 'research-hotlist-item',
}: ResearchHotlistFeedProps) {
  const { t } = useTranslation()

  if (error) {
    return (
      <p className="text-sm text-red-600" data-testid="research-hotlist-error">
        {error}
      </p>
    )
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="research-hotlist-loading">
        {t('research.hotlistLoading', { defaultValue: '加载中…' })}
      </p>
    )
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="research-hotlist-empty">
        {emptyMessage
          ?? t('research.hotlistEmpty', { defaultValue: '暂无近期热榜资讯。' })}
      </p>
    )
  }

  return (
    <ul className={cn('space-y-2 text-sm', className)} data-testid={listTestId}>
      {items.map((item, index) => {
        const relative = formatRelativeTime(item.capturedAt)
        const resolvedCompanies = item.resolvedCompanies ?? []
        const primaryCompany = resolvedCompanies[0]
        const researchHref = primaryCompany
          ? `/${teamSlug}/research/${encodeURIComponent(primaryCompany.companyKey)}?persona=hr`
          : null
        const highlighted = titleMatchesHighlight(item.title, highlightTerms)

        return (
          <li
            key={`${item.platform}-${item.title}-${index}`}
            data-testid={itemTestId}
            data-highlighted={highlighted ? 'true' : 'false'}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md px-1 py-0.5',
              highlighted && 'bg-amber-50 ring-1 ring-amber-200',
            )}
          >
            <Badge
              variant="outline"
              className="text-[10px] font-normal"
              data-testid="research-hotlist-platform"
            >
              {item.platform}
            </Badge>
            {relative ? (
              <span
                className="text-xs text-muted-foreground"
                data-testid="research-hotlist-time"
              >
                {relative}
              </span>
            ) : null}
            {researchHref ? (
              <Link
                to={researchHref}
                className="font-medium text-blue-600 hover:underline"
                data-testid="research-hotlist-title-link"
                data-company-key={primaryCompany!.companyKey}
              >
                {item.title}
              </Link>
            ) : item.url ? (
              <a
                href={item.url}
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noreferrer"
                data-testid="research-hotlist-title-external"
              >
                {item.title}
              </a>
            ) : (
              <span data-testid="research-hotlist-title-text">{item.title}</span>
            )}
            {researchHref && item.url ? (
              <a
                href={item.url}
                className="text-xs text-muted-foreground hover:underline"
                target="_blank"
                rel="noreferrer"
                data-testid="research-hotlist-source-link"
                aria-label={t('research.pulseSourceLink', { defaultValue: '查看原文' })}
              >
                {t('research.pulseSourceLink', { defaultValue: '原文' })}
              </a>
            ) : null}
            {(item.matchedKeywords ?? []).slice(0, 3).map((mk) => (
              <Badge
                key={mk}
                variant="secondary"
                className="text-[10px] font-normal"
                data-testid="research-hotlist-matched-kw"
              >
                {mk}
              </Badge>
            ))}
            {resolvedCompanies.slice(0, 2).map((company) => (
              <Link
                key={company.companyKey}
                to={`/${teamSlug}/research/${encodeURIComponent(company.companyKey)}?persona=hr`}
                className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
                data-testid="research-hotlist-company-link"
                data-company-key={company.companyKey}
              >
                {t('research.pulseResolvedCompany', {
                  defaultValue: `企业研究 · ${company.nameCn}`,
                  companyName: company.nameCn,
                })}
              </Link>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
