import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { rawApiClient } from '@/lib/api-helpers'
import { companyResearchHref } from '@/components/CompanyPolicyBadges'
import { cn } from '@/lib/utils'

type SignalsMeta = {
  liveCount?: number
  showcaseCount?: number
}

type SignalsResponse = {
  success?: boolean
  items?: Array<{ title?: string; kind?: string }>
  meta?: SignalsMeta
}

export type CompanyResearchStripProps = {
  companyKey: string
  className?: string
}

/**
 * Thin DB-read strip: live signal count + link to research page.
 * Does not trigger ingest.
 */
export function CompanyResearchStrip({ companyKey, className }: CompanyResearchStripProps) {
  const { t } = useTranslation()
  const key = companyKey.trim()
  const [liveCount, setLiveCount] = useState<number | null>(null)
  const [firstTitle, setFirstTitle] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!key) {
      setReady(true)
      return
    }
    let cancelled = false
    void (async () => {
      const { data } = await rawApiClient.GET<SignalsResponse>(
        `/api/research/companies/${encodeURIComponent(key)}/signals`,
        { params: { query: { persona: 'hr', limit: 5 } } },
      )
      if (cancelled) return
      if (data?.success) {
        const count =
          typeof data.meta?.liveCount === 'number'
            ? data.meta.liveCount
            : Array.isArray(data.items)
              ? data.items.length
              : 0
        setLiveCount(count)
        const title = data.items?.[0]?.title
        setFirstTitle(typeof title === 'string' ? title : null)
      } else {
        setLiveCount(0)
        setFirstTitle(null)
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  if (!key || !ready) return null

  const href = companyResearchHref(key)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700',
        className,
      )}
      data-testid="company-research-strip"
      data-company-key={key}
    >
      <Link
        to={href}
        className="font-medium text-blue-600 hover:underline"
        data-testid="company-research-strip-link"
      >
        {t('research.stripLink', { defaultValue: '企业研究' })}
      </Link>
      <span data-testid="company-research-strip-count">
        {t('research.stripLiveCount', {
          defaultValue: `实时信号 ${liveCount ?? 0}`,
          count: liveCount ?? 0,
        })}
      </span>
      {firstTitle && (liveCount ?? 0) > 0 ? (
        <span className="truncate text-muted-foreground" data-testid="company-research-strip-title">
          {firstTitle}
        </span>
      ) : (
        <span className="text-muted-foreground" data-testid="company-research-strip-empty">
          {t('research.stripEmpty', { defaultValue: '暂无实时信号' })}
        </span>
      )}
    </div>
  )
}
