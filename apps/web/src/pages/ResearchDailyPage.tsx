import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { parseDailyReportPack, type DailyReportPack } from '@trends/shared'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button } from '@/components/ui/button'

/**
 * Thin in-app twin of the public static daily report.
 * `/:workspace/research/daily/:date` loads the pack for day-nav metadata and
 * the BFF-rendered HTML (`/daily/{date}.html`) into an iframe. The BFF wraps
 * remote publisher covers into real-photo SVG data-URIs at serve time, so the
 * iframe and "下载完整 HTML" are one offline file with real covers.
 *
 * No route-scoped auth gate beyond the workspace shell this lives under (the
 * public static file itself is unauthenticated by design).
 */

const STATIC_DAILY_BASE = '/daily'
const WINDOW_DAYS = 7

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return (await res.json()) as T
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return await res.text()
}

async function fetchPack(date: string): Promise<DailyReportPack> {
  try {
    return parseDailyReportPack(await fetchJson(`${STATIC_DAILY_BASE}/${date}.json`))
  } catch (e) {
    // Unknown date → fall back to the latest available day (index.json).
    // BFF returns { dates: string[] }; legacy static file servers may return string[].
    try {
      const data = await fetchJson<{ dates?: string[] } | string[]>(`${STATIC_DAILY_BASE}/index.json`)
      const list = Array.isArray(data) ? data : (data?.dates ?? [])
      if (!list.length) throw e
      // Order differs by source: BFF (Convex listDates) is desc, legacy static file is asc.
      const latest = [...list].sort().reverse()[0]
      return parseDailyReportPack(await fetchJson(`${STATIC_DAILY_BASE}/${latest}.json`))
    } catch {
      throw e
    }
  }
}

/** Trigger a browser download of the self-contained daily HTML blob. */
export function downloadDailyReportBundle(html: string, date: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `销售日报-${date}.html`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function ResearchDailyPage() {
  const { date } = useParams<{ date: string }>()
  const { slug } = useWorkspace()
  const { t } = useTranslation()
  const [pack, setPack] = useState<DailyReportPack | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [titleDate, setTitleDate] = useState<string | null>(null)
  const hubHref = `/${slug || 'hr'}/research`
  const shanghaiToday = useMemo(() => shanghaiTodayYmd(), [])

  useEffect(() => {
    let cancelled = false
    const target = date ?? ''
    ;(async () => {
      try {
        const fetched = await fetchPack(target || shanghaiToday)
        if (cancelled) return
        setPack(fetched)
        setTitleDate(fetched.date)
        // BFF embeds real covers as SVG at HTML serve time (packJson keeps remotes).
        const shareable = await fetchText(`${STATIC_DAILY_BASE}/${fetched.date}.html`)
        if (cancelled) return
        setHtml(shareable)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [date, shanghaiToday, t])

  const dayDates = useMemo<string[]>(() => {
    if (pack?.hero?.dayDates && pack.hero.dayDates.length > 0) {
      return pack.hero.dayDates
    }
    const end = date || shanghaiToday
    return buildShanghaiWindow(end, WINDOW_DAYS)
  }, [pack, date, shanghaiToday])

  const onDownload = useCallback(() => {
    if (!html || !titleDate) return
    downloadDailyReportBundle(html, titleDate)
  }, [html, titleDate])

  return (
    <div className="py-2" data-testid="research-daily-page">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <Link to={hubHref} className="underline" data-testid="research-daily-back">
          {t('research.daily.back', { defaultValue: '← 返回市场动态' })}
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!html}
          onClick={onDownload}
          data-testid="research-daily-download"
          title={t('research.daily.downloadBundleHint', {
            defaultValue: '单文件可转发（真实封面已嵌进 SVG）',
          })}
        >
          {t('research.daily.downloadBundle', { defaultValue: '下载完整 HTML' })}
        </Button>
      </div>
      <DayNav
        dates={dayDates}
        currentDate={pack?.date || date || shanghaiToday}
        slug={slug || 'hr'}
      />
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

function DayNav({
  dates,
  currentDate,
  slug,
}: {
  dates: string[]
  currentDate: string
  slug: string
}) {
  const { t } = useTranslation()
  if (dates.length === 0) return null

  return (
    <nav
      className="mb-4 flex flex-wrap items-center gap-2"
      aria-label={t('research.daily.dayNav', { defaultValue: '报告日' })}
      data-testid="daily-day-nav"
    >
      {dates.map((ymd) => {
        const isCurrent = ymd === currentDate
        const isToday = ymd === shanghaiTodayYmd()
        const label = isToday
          ? t('research.daily.todayLabel', { defaultValue: '今日' })
          : shortDateLabel(ymd)
        return (
          <Button
            key={ymd}
            asChild
            variant={isCurrent ? 'default' : 'outline'}
            size="sm"
            data-testid={`daily-day-link-${ymd}`}
            aria-current={isCurrent ? 'page' : undefined}
          >
            <Link to={`/${slug}/research/daily/${ymd}`}>{label}</Link>
          </Button>
        )
      })}
    </nav>
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

/** Build the last `count` calendar dates ending at `endYmd` in Asia/Shanghai order. */
function buildShanghaiWindow(endYmd: string, count: number): string[] {
  const end = parseYmd(endYmd)
  if (!end) return []
  const dates: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(formatYmd(d))
  }
  return dates
}

function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shortDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[2]}-${m[3]}` : ymd
}
