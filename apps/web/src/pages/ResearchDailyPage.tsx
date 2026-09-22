import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { parseDailyReportPack, renderDailyReportHtml, type DailyReportPack } from '@trends/shared'
import { useWorkspace } from '@/contexts/WorkspaceContext'

/**
 * Thin in-app twin of the public static daily report.
 * `/:workspace/research/daily/:date` loads the SAME pack the worker/renderer uses and
 * renders the identical M3 HTML into an iframe, so the public share and the
 * in-app view are byte-for-byte consistent.
 *
 * No route-scoped auth gate beyond the workspace shell this lives under (the
 * public static file itself is unauthenticated by design).
 */

const STATIC_DAILY_BASE = '/daily'

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return (await res.json()) as T
}

async function fetchPack(date: string): Promise<DailyReportPack> {
  try {
    return parseDailyReportPack(await fetchJson(`${STATIC_DAILY_BASE}/${date}.json`))
  } catch (e) {
    // Unknown date → fall back to the latest available day (index.json).
    try {
      const list = (await fetchJson<string[]>(`${STATIC_DAILY_BASE}/index.json`)) || []
      if (!list.length) throw e
      const latest = list[list.length - 1]
      return parseDailyReportPack(await fetchJson(`${STATIC_DAILY_BASE}/${latest}.json`))
    } catch {
      throw e
    }
  }
}

export default function ResearchDailyPage() {
  const { date } = useParams<{ date: string }>()
  const { slug } = useWorkspace()
  const { t } = useTranslation()
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [titleDate, setTitleDate] = useState<string | null>(null)
  const hubHref = `/${slug || 'hr'}/research`
  const shanghaiToday = useMemo(() => shanghaiTodayYmd(), [])

  useEffect(() => {
    let cancelled = false
    const target = date ?? ''
    fetchPack(target || shanghaiToday)
      .then((pack) => {
        if (cancelled) return
        setHtml(renderDailyReportHtml(pack))
        setTitleDate(pack.date)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [date, shanghaiToday, t])

  return (
    <div className="py-2" data-testid="research-daily-page">
      <div className="mb-3 text-sm text-muted-foreground">
        <Link to={hubHref} className="underline" data-testid="research-daily-back">
          {t('research.daily.back', { defaultValue: '← 返回市场动态' })}
        </Link>
      </div>
      <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading daily report…</div>}>
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : html ? (
          <IframeShell title={titleDate ?? date ?? shanghaiToday}>{html}</IframeShell>
        ) : (
          <div className="py-6 text-sm text-muted-foreground">Loading daily report…</div>
        )}
      </Suspense>
    </div>
  )
}

function IframeShell({ title, children }: { title: string; children: string }) {
  return <DailyReportIframe title={title} html={children} />
}

function DailyReportIframe({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      title={`daily-report-${title}`}
      srcDoc={html}
      style={{
        width: '100%',
        height: '880px',
        border: '1px solid #eef0f3',
        borderRadius: '12px',
        background: '#f4f6f8',
      }}
    />
  )
}

/** Asia/Shanghai calendar YYYY-MM-DD (matches worker daily pack). */
function shanghaiTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
