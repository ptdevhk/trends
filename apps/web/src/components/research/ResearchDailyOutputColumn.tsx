import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { parseDailyReportPack, type DailyReportPack } from '@trends/shared'

const REBUILD_TIMEOUT_MS = 6 * 60 * 1000

type Props = {
  teamSlug: string
  shanghaiToday: string
  dailyHref: string
  /** Optional: bump to refetch after ingest/rebuild. */
  refreshKey?: number
}

/**
 * Pipeline node ③ — 今日日报输出.
 * Reads the shared live-pack seam (`/daily/{date}.json` from build-live) and
 * surfaces 定稿C headline + TODAY counts; rebuild hits the same worker path
 * ResearchDailyPage uses.
 */
export function ResearchDailyOutputColumn({
  teamSlug,
  shanghaiToday,
  dailyHref,
  refreshKey = 0,
}: Props) {
  const { t } = useTranslation()
  const [pack, setPack] = useState<DailyReportPack | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/daily/${shanghaiToday}.json`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = await res.json()
      setPack(parseDailyReportPack(raw))
    } catch {
      setPack(null)
      setError(t('research.pipeline.outputMissing', { defaultValue: '今日日报尚未生成' }))
    } finally {
      setLoading(false)
    }
  }, [shanghaiToday, t])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const rebuild = useCallback(async () => {
    setRebuilding(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REBUILD_TIMEOUT_MS)
    try {
      const res = await fetch('/daily/rebuild', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: shanghaiToday, force: true }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
    } catch {
      setError(t('research.pipeline.rebuildFailed', { defaultValue: '重建失败，请稍后重试' }))
    } finally {
      clearTimeout(timer)
      setRebuilding(false)
    }
  }, [shanghaiToday, load, t])

  const headline = useMemo(() => {
    if (!pack) return null
    if (pack.headline?.title) return pack.headline.title
    const firstOpp = pack.opportunities?.[0]?.label
    if (firstOpp) return firstOpp
    const firstStory = pack.stories?.[0]?.title
    return firstStory ?? pack.hero?.headline ?? null
  }, [pack])

  const downstreamCount = pack?.downstream?.length ?? 0
  const opportunityCount = pack?.opportunities?.length ?? 0
  const storyCount = pack?.stories?.length ?? 0

  return (
    <section
      className="flex h-full flex-col rounded-xl border border-blue-200 bg-gradient-to-b from-blue-50/80 to-white p-3"
      data-testid="research-daily-report-hero"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700">
          {t('research.pipeline.outputTitle', { defaultValue: '今日日报 · 输出' })}
        </h2>
        <Badge variant="secondary" className="text-[10px] font-normal">
          定稿C
        </Badge>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</p>
      ) : (
        <>
          <div
            className="rounded-lg border border-blue-200 bg-white p-3"
            data-testid="research-pipeline-output-headline"
          >
            <div className="text-[10px] font-semibold text-blue-700">
              {t('research.pipeline.headlineLabel', { defaultValue: '头条' })}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {headline ?? error ?? t('research.pipeline.outputMissing', { defaultValue: '今日日报尚未生成' })}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{shanghaiToday}</p>
          </div>

          <div
            className="mt-2 flex flex-wrap gap-1.5 text-[11px]"
            data-testid="research-pipeline-output-counts"
          >
            <Badge variant="outline" className="font-normal">
              {t('research.pipeline.countDownstream', {
                defaultValue: '下游 {{count}}',
                count: downstreamCount,
              })}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {t('research.pipeline.countOpportunity', {
                defaultValue: '商机 {{count}}',
                count: opportunityCount,
              })}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {t('research.pipeline.countStory', {
                defaultValue: '热闻 {{count}}',
                count: storyCount,
              })}
            </Badge>
          </div>

          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
            <Button
              type="button"
              size="sm"
              disabled={rebuilding}
              onClick={() => void rebuild()}
              data-testid="research-pipeline-rebuild"
            >
              {rebuilding
                ? t('research.pipeline.rebuilding', { defaultValue: '重建中…' })
                : t('research.pipeline.buildToday', { defaultValue: '生成 / 重建今日日报' })}
            </Button>
            <Button asChild type="button" size="sm" variant="outline">
              <Link to={dailyHref} data-testid="research-daily-report-link">
                {t('research.dailyReportOpenToday', {
                  defaultValue: '打开今日日报 · {{date}}',
                  date: shanghaiToday,
                })}
              </Link>
            </Button>
            <Button asChild type="button" size="sm" variant="ghost">
              <a href={`/daily/${shanghaiToday}.html`} target="_blank" rel="noreferrer">
                {t('research.dailyReportPublicLink', { defaultValue: '公开分享页' })}
              </a>
            </Button>
            <Button asChild type="button" size="sm" variant="ghost">
              <Link to={`/${teamSlug}/settings/research`} data-testid="research-pipeline-tab-settings">
                {t('research.pipeline.config', { defaultValue: '⚙ 配置' })}
              </Link>
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

export default ResearchDailyOutputColumn
