import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type PoolTag = '下游' | '商机' | '趋势' | '热闻'

export type MaterialPoolItem = {
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

const TAGS: PoolTag[] = ['下游', '商机', '趋势', '热闻']

function itemKey(item: MaterialPoolItem, index: number): string {
  return `${item.platform}::${item.url ?? item.title}::${index}`
}

function isWatchPlatform(platform: string): boolean {
  return platform.trim().toLowerCase().startsWith('rss:watch-')
}

function formatRelative(capturedAt: number, empty: string): string {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return empty
  const delta = Date.now() - capturedAt
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

type Props = {
  teamSlug: string
  items: MaterialPoolItem[]
  watchItems: MaterialPoolItem[]
  loading: boolean
  error: string | null
  matchedCount: number
  onPromoteToReport?: () => void
  /** Optional: render pulse chips / keyword helper above the list. */
  headerSlot?: React.ReactNode
  softEmptySlot?: React.ReactNode
}

/**
 * Pipeline node ② — 今日素材池.
 * Merges 综合热榜 + customer-watch `rss:watch-*` rows (from ingest spread).
 * Session tags are advisory for desk triage before rebuild → build-live.
 */
export function ResearchMaterialPool({
  teamSlug,
  items,
  watchItems,
  loading,
  error,
  matchedCount,
  onPromoteToReport,
  headerSlot,
  softEmptySlot,
}: Props) {
  const { t } = useTranslation()
  const [tags, setTags] = useState<Record<string, PoolTag>>({})

  const merged = useMemo(() => {
    const seen = new Set<string>()
    const out: MaterialPoolItem[] = []
    for (const item of [...watchItems, ...items]) {
      const k = `${item.platform}|${item.url ?? ''}|${item.title}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(item)
    }
    return out
  }, [items, watchItems])

  const cycleTag = (key: string) => {
    setTags((prev) => {
      const cur = prev[key]
      const idx = cur ? TAGS.indexOf(cur) : -1
      const next = TAGS[(idx + 1) % TAGS.length]
      return { ...prev, [key]: next }
    })
  }

  const taggedCount = Object.keys(tags).length

  return (
    <section
      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-3"
      data-testid="research-section-pulse"
      data-surface="hotlist"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800" data-testid="research-section-hotlist-title">
          {t('research.pipeline.poolTitleHotlist', {
            defaultValue: '今日素材池 · 综合热榜',
          })}
        </h2>
        <span className="text-[11px] text-muted-foreground" data-testid="research-pool-status">
          {t('research.pipeline.poolStatus', {
            defaultValue: 'Pulse 命中 {{count}} 条 · 打 tag 后可入日报',
            count: matchedCount,
          })}
          {watchItems.length > 0
            ? t('research.pipeline.watchPoolHint', {
                defaultValue: ' · 客户扩散 {{count}}',
                count: watchItems.length,
              })
            : null}
        </span>
      </div>

      {headerSlot}

      {softEmptySlot}

      {error ? (
        <p className="text-sm text-red-600" data-testid="research-pulse-error">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</p>
      ) : merged.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="research-pulse-empty">
          {t('research.pulseEmpty', { defaultValue: '暂无近期资讯。' })}
        </p>
      ) : (
        <ul className="space-y-2 text-sm" data-testid="research-material-pool-list">
          {merged.map((item, index) => {
            const key = itemKey(item, index)
            const tag = tags[key]
            const isWatch = isWatchPlatform(item.platform)
            const relative = formatRelative(item.capturedAt, '')
            const resolvedCompanies = item.resolvedCompanies ?? []
            const primaryCompany = resolvedCompanies[0]
            const researchHref = primaryCompany
              ? `/${teamSlug}/research/${encodeURIComponent(primaryCompany.companyKey)}?persona=hr`
              : null
            const isRss = String(item.platform ?? '').startsWith('rss:')
            const platformLabel = isWatch
              ? t('research.pipeline.sourceWatch', { defaultValue: '客户扩散' })
              : isRss
                ? t('research.pulseKeywords.sourceRss', { defaultValue: 'RSS' })
                : item.platform

            return (
              <li
                key={key}
                data-testid="research-pulse-item"
                data-source={isWatch ? 'watch' : isRss ? 'rss' : 'hotlist'}
                className="rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Badge
                    variant="outline"
                    className={
                      isWatch
                        ? 'border-emerald-300 bg-emerald-50 text-[10px] font-normal text-emerald-800'
                        : 'text-[10px] font-normal'
                    }
                    data-testid="research-pulse-platform"
                  >
                    {platformLabel}
                  </Badge>
                  {relative ? (
                    <span className="text-xs text-muted-foreground" data-testid="research-pulse-time">
                      {relative}
                    </span>
                  ) : null}
                  {researchHref ? (
                    <Link
                      to={researchHref}
                      className="font-medium text-blue-600 hover:underline"
                      data-testid="research-pulse-title-link"
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
                      data-testid="research-pulse-title-external"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span data-testid="research-pulse-title-text">{item.title}</span>
                  )}
                  {researchHref && item.url ? (
                    <a
                      href={item.url}
                      className="text-xs text-muted-foreground hover:underline"
                      target="_blank"
                      rel="noreferrer"
                      data-testid="research-pulse-source-link"
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
                      data-testid="research-pulse-matched-kw"
                    >
                      {mk}
                    </Badge>
                  ))}
                  {resolvedCompanies.slice(0, 2).map((company) => (
                    <Link
                      key={company.companyKey}
                      to={`/${teamSlug}/research/${encodeURIComponent(company.companyKey)}?persona=hr`}
                      className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
                      data-testid="research-pulse-company-link"
                      data-company-key={company.companyKey}
                    >
                      {t('research.pulseResolvedCompany', {
                        defaultValue: `企业研究 · ${company.nameCn}`,
                        companyName: company.nameCn,
                      })}
                    </Link>
                  ))}
                  <button
                    type="button"
                    className={
                      tag
                        ? 'rounded-full border border-blue-400 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700'
                        : 'rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 hover:border-blue-300'
                    }
                    data-testid="research-pool-tag"
                    data-tag={tag ?? ''}
                    onClick={() => cycleTag(key)}
                  >
                    {tag ?? t('research.pipeline.tagAction', { defaultValue: '打 tag' })}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={taggedCount === 0 && merged.length === 0}
          onClick={() => onPromoteToReport?.()}
          data-testid="research-pool-promote"
        >
          {t('research.pipeline.promoteTagged', {
            defaultValue: '入日报（重建）',
            count: taggedCount,
          })}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t('research.pipeline.promoteHint', {
            defaultValue: '标签为台面分拣；重建走 build-live → 定稿C',
          })}
        </span>
      </div>
    </section>
  )
}

export default ResearchMaterialPool
