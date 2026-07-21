import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'
import { PageHeader } from '@/components/PageHeader'
import {
  PulseKeywordsDialog,
  type PulseKeywordsDialogState,
} from '@/components/research/PulseKeywordsDialog'
import { ResearchCompanyPredictInput } from '@/components/research/ResearchCompanyPredictInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from '@/contexts/WorkspaceContext'

const PULSE_CHIP_VISIBLE = 8

type CompanyHit = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
}

type ShowcaseCompanyCard = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
  kindCounts: Record<string, number>
  signalCount: number
  showcase: boolean
  href: string
}

type ShowcaseResponse = {
  success: boolean
  golden?: ShowcaseCompanyCard[]
  fromResumeDesk?: ShowcaseCompanyCard[]
  pulse?: Array<{ title: string; platform: string; url?: string; capturedAt: number }>
  meta?: {
    lastIngest?: { status?: string; newsInserted?: number; signalsInserted?: number } | null
    showcaseSeedVersion?: string
    seedIngestRunId?: string
  }
}

type SearchResponse = {
  success: boolean
  items?: CompanyHit[]
}

type IndustryBrowseItem = {
  companyKey: string
  nameCn: string
  nameEn?: string
  displayName: string
  entityId: string
  kind: string
  origin?: string
  type?: string
  aliases: string[]
  cnc: boolean
}

type IndustryBrowseResponse = {
  success: boolean
  items?: IndustryBrowseItem[]
}

type PulseNewsItem = {
  title: string
  platform: string
  url?: string
  capturedAt: number
  matchedKeywords?: string[]
}

type PulseResponse = {
  success: boolean
  items?: PulseNewsItem[]
  meta?: {
    filtered: boolean
    effectiveKeywords: string[]
    rawCount: number
    matchedCount: number
  }
}

type PulseKeywordsResponse = PulseKeywordsDialogState & {
  success: boolean
}

const KIND_LABEL_ZH: Record<string, string> = {
  company_mention: '提及',
  hiring_signal: '招聘',
  market_move: '市场',
  sales_trigger: '销售',
}

function kindLabel(kind: string): string {
  return KIND_LABEL_ZH[kind] ?? kind
}

function primaryLabel(nameCn?: string, displayName?: string, nameEn?: string): string {
  if (nameCn && nameCn.trim()) {
    return nameCn.trim()
  }
  if (displayName && displayName.trim()) {
    return displayName.trim()
  }
  return nameEn?.trim() || ''
}

function formatPulseRelativeTime(capturedAt: number): string {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) {
    return ''
  }
  const date = new Date(capturedAt)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  try {
    return formatDistanceToNow(date, { addSuffix: true })
  } catch {
    return ''
  }
}

function CompanyCardGrid({
  cards,
  emptyLabel,
}: {
  cards: ShowcaseCompanyCard[]
  emptyLabel: string
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const title = primaryLabel(card.nameCn, card.displayName, card.nameEn)
        return (
          <Link
            key={card.companyKey}
            to={card.href}
            data-testid="showcase-company-card"
            data-company-key={card.companyKey}
            className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-slate-50"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{title}</span>
              {card.nameEn && card.nameCn ? (
                <span className="text-xs text-muted-foreground">{card.nameEn}</span>
              ) : null}
              {card.showcase ? (
                <Badge variant="secondary" data-testid="showcase-data-badge">
                  展示数据
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 font-mono text-xs text-muted-foreground">{card.companyKey}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{card.signalCount} 条信号</Badge>
              {Object.entries(card.kindCounts).map(([kind, count]) => (
                <Badge key={kind} variant="outline" className="text-[10px]">
                  {kindLabel(kind)}:{count}
                </Badge>
              ))}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export function ResearchIndexPage() {
  const { t } = useTranslation()
  const { workspaceSlug } = useWorkspace()
  const teamSlug = workspaceSlug || 'hr'
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CompanyHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const [showcase, setShowcase] = useState<ShowcaseResponse | null>(null)
  const [showcaseLoading, setShowcaseLoading] = useState(true)
  const [showcaseError, setShowcaseError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [ingesting, setIngesting] = useState(false)

  const [industry, setIndustry] = useState<IndustryBrowseItem[]>([])
  const [industryLoading, setIndustryLoading] = useState(true)
  const [industryError, setIndustryError] = useState<string | null>(null)

  const [pulseItems, setPulseItems] = useState<PulseNewsItem[]>([])
  const [pulseMeta, setPulseMeta] = useState<PulseResponse['meta'] | null>(null)
  const [pulseLoading, setPulseLoading] = useState(true)
  const [pulseError, setPulseError] = useState<string | null>(null)
  const [pulseShowAll, setPulseShowAll] = useState(false)
  const [pulseFocusKeyword, setPulseFocusKeyword] = useState<string | null>(null)

  const [keywordsState, setKeywordsState] = useState<PulseKeywordsDialogState | null>(null)
  const [keywordsDialogOpen, setKeywordsDialogOpen] = useState(false)
  const [keywordsSaving, setKeywordsSaving] = useState(false)

  const loadShowcase = useCallback(async () => {
    setShowcaseLoading(true)
    setShowcaseError(null)
    const { data, error: apiError } = await rawApiClient.GET<ShowcaseResponse>(
      '/api/research/showcase',
    )
    setShowcaseLoading(false)
    if (apiError || !data?.success) {
      setShowcaseError(
        t('research.showcaseLoadError', { defaultValue: '展示数据加载失败' }),
      )
      setShowcase(null)
      return
    }
    setShowcase(data)
    // t is i18n; intentionally omit from deps to avoid remount loops when t identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadIndustry = useCallback(async () => {
    setIndustryLoading(true)
    setIndustryError(null)
    const { data, error: apiError } = await rawApiClient.GET<IndustryBrowseResponse>(
      '/api/research/industry',
      { params: { query: { limit: 48 } } },
    )
    setIndustryLoading(false)
    if (apiError || !data?.success) {
      setIndustryError(
        t('research.industryLoadError', { defaultValue: '行业品牌目录加载失败' }),
      )
      setIndustry([])
      return
    }
    setIndustry(Array.isArray(data.items) ? data.items : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPulse = useCallback(async (opts?: { all?: boolean }) => {
    const all = opts?.all === true
    setPulseLoading(true)
    setPulseError(null)
    const { data, error: apiError } = await rawApiClient.GET<PulseResponse>(
      '/api/research/pulse',
      {
        params: {
          query: {
            limit: 12,
            ...(all ? { all: 1 } : {}),
          },
        },
      },
    )
    setPulseLoading(false)
    if (apiError || !data?.success) {
      setPulseError(t('research.pulseLoadError', { defaultValue: '市场动态加载失败' }))
      setPulseItems([])
      setPulseMeta(null)
      return
    }
    setPulseItems(Array.isArray(data.items) ? data.items : [])
    setPulseMeta(data.meta ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadKeywords = useCallback(async () => {
    const { data, error: apiError } = await rawApiClient.GET<PulseKeywordsResponse>(
      '/api/research/pulse/keywords',
    )
    if (apiError || !data?.success) {
      setKeywordsState(null)
      return
    }
    setKeywordsState({
      seed: data.seed,
      workspace: data.workspace,
      effective: data.effective,
    })
  }, [])

  useEffect(() => {
    void loadShowcase()
    void loadIndustry()
    void loadPulse()
    void loadKeywords()
  }, [loadShowcase, loadIndustry, loadPulse, loadKeywords])

  const seedShowcase = useCallback(async () => {
    setSeeding(true)
    try {
      await rawApiClient.POST('/api/research/showcase/seed', { body: {} })
      await loadShowcase()
    } finally {
      setSeeding(false)
    }
  }, [loadShowcase])

  const runIngest = useCallback(async () => {
    setIngesting(true)
    try {
      await rawApiClient.POST('/api/research/ingest/run', { body: {} })
      await Promise.all([loadShowcase(), loadPulse()])
    } finally {
      setIngesting(false)
    }
  }, [loadShowcase, loadPulse])

  const handleShowAllPulse = useCallback(() => {
    setPulseShowAll(true)
    setPulseFocusKeyword(null)
    void loadPulse({ all: true })
  }, [loadPulse])

  const handlePulseChipClick = useCallback((kw: string) => {
    setPulseFocusKeyword((prev) => (prev === kw ? null : kw))
  }, [])

  const handleSaveKeywords = useCallback(
    async (body: { enabled: string[]; excluded: string[]; custom: string[] }) => {
      setKeywordsSaving(true)
      try {
        const { data, error: apiError } = await rawApiClient.PUT<PulseKeywordsResponse>(
          '/api/research/pulse/keywords',
          { body },
        )
        if (apiError || !data?.success) {
          return
        }
        setKeywordsState({
          seed: data.seed,
          workspace: data.workspace,
          effective: data.effective,
        })
        setKeywordsDialogOpen(false)
        setPulseShowAll(false)
        setPulseFocusKeyword(null)
        await loadPulse({ all: false })
      } finally {
        setKeywordsSaving(false)
      }
    },
    [loadPulse],
  )

  const search = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)
    const { data, error: apiError } = await rawApiClient.GET<SearchResponse>(
      '/api/research/companies/search',
      { params: { query: { q: q.trim() } } },
    )
    setLoading(false)
    if (apiError || !data?.success) {
      setError(t('research.searchError', { defaultValue: '企业搜索失败' }))
      setItems([])
      return
    }
    setItems(Array.isArray(data.items) ? data.items : [])
  }, [q, t])

  const golden = showcase?.golden ?? []
  const fromDesk = showcase?.fromResumeDesk ?? []
  const needsSeed =
    !showcaseLoading &&
    golden.every((c) => c.signalCount === 0) &&
    fromDesk.every((c) => c.signalCount === 0)

  const effectiveKeywords =
    keywordsState?.effective ?? pulseMeta?.effectiveKeywords ?? []

  const visibleChips = effectiveKeywords.slice(0, PULSE_CHIP_VISIBLE)
  const moreChipCount = Math.max(0, effectiveKeywords.length - PULSE_CHIP_VISIBLE)

  const displayPulseItems = useMemo(() => {
    if (!pulseFocusKeyword) return pulseItems
    const focus = pulseFocusKeyword
    return pulseItems.filter((item) => {
      const matched = item.matchedKeywords ?? []
      if (matched.some((m) => m === focus)) return true
      // Fallback: substring match on title when matchedKeywords empty (e.g. all=1)
      const hay = `${item.title}`.normalize('NFKC')
      const needle = focus.normalize('NFKC')
      return hay.includes(needle)
    })
  }, [pulseItems, pulseFocusKeyword])

  const softEmpty =
    !pulseLoading &&
    !pulseShowAll &&
    pulseMeta != null &&
    pulseMeta.matchedCount === 0 &&
    pulseMeta.rawCount > 0

  const showcaseSuggestions = useMemo(
    () =>
      golden
        .filter((c) => c.companyKey)
        .slice(0, 4)
        .map((c) => ({
          companyKey: c.companyKey,
          nameCn: primaryLabel(c.nameCn, c.displayName, c.nameEn) || c.companyKey,
          ...(c.nameEn ? { nameEn: c.nameEn } : {}),
        })),
    [golden],
  )

  return (
    <div className="space-y-6 p-4" data-testid="research-index-page">
      <PageHeader
        title={t('research.indexTitle', { defaultValue: '行业研究' })}
        description={t('research.indexDescription', {
          defaultValue: '精密机械 / 数控机床企业信号 — 面向 HR 简历台（简体中文优先）。',
        })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={seeding}
          onClick={() => void seedShowcase()}
          data-testid="research-seed-showcase"
        >
          {seeding
            ? t('research.seedingShowcase', { defaultValue: '正在加载展示数据…' })
            : t('research.seedShowcase', { defaultValue: '加载展示数据' })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={ingesting}
          onClick={() => void runIngest()}
          data-testid="research-run-ingest"
        >
          {ingesting
            ? t('research.ingesting', { defaultValue: '正在抓取…' })
            : t('research.runIngest', { defaultValue: '运行实时抓取' })}
        </Button>
        {showcase?.meta?.seedIngestRunId ? (
          <span className="text-xs text-muted-foreground" data-testid="research-seed-meta">
            种子 id: {showcase.meta.seedIngestRunId}
          </span>
        ) : null}
      </div>

      {showcaseError ? (
        <p className="text-sm text-red-600" data-testid="research-showcase-error">
          {showcaseError}
        </p>
      ) : null}

      {needsSeed ? (
        <Card data-testid="research-showcase-empty-cta">
          <CardHeader>
            <CardTitle className="text-base">
              {t('research.showcaseEmptyTitle', { defaultValue: '尚无展示密度' })}
            </CardTitle>
            <CardDescription>
              {t('research.showcaseEmptyBody', {
                defaultValue:
                  '实时热榜很少命中机床别名。请加载数控/精密机械展示企业与多类型信号，用于 HR 演示路径。',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" disabled={seeding} onClick={() => void seedShowcase()}>
              {t('research.seedShowcase', { defaultValue: '加载展示数据' })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section data-testid="research-section-golden">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionGolden', { defaultValue: '从这里开始（展示）' })}
        </h2>
        {showcaseLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <CompanyCardGrid
            cards={golden}
            emptyLabel={t('research.goldenEmpty', { defaultValue: '暂无金色展示企业。' })}
          />
        )}
      </section>

      <section data-testid="research-section-resume-desk">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionResumeDesk', { defaultValue: '数控品牌台（展示）' })}
        </h2>
        {showcaseLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <CompanyCardGrid
            cards={fromDesk}
            emptyLabel={t('research.resumeDeskEmpty', {
              defaultValue: '暂无品牌展示企业。',
            })}
          />
        )}
      </section>

      <section data-testid="research-section-industry">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionIndustry', { defaultValue: '行业品牌目录（industry-data）' })}
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('research.sectionIndustryHint', {
            defaultValue: '来自 config/industry-data，简体名称优先；点击进入企业研究页。',
          })}
        </p>
        {industryError ? (
          <p className="text-sm text-red-600" data-testid="research-industry-error">
            {industryError}
          </p>
        ) : null}
        {industryLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : industry.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="research-industry-empty">
            {t('research.industryEmpty', { defaultValue: '暂无行业目录项。' })}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="research-industry-grid">
            {industry.map((item) => (
              <Link
                key={item.companyKey}
                to={`/${teamSlug}/research/${encodeURIComponent(item.companyKey)}?persona=hr`}
                data-testid="industry-browse-card"
                data-company-key={item.companyKey}
                className="block rounded-lg border border-slate-200 p-2 text-sm transition-colors hover:border-blue-300 hover:bg-slate-50"
              >
                <div className="font-medium">{item.nameCn || item.displayName}</div>
                {item.nameEn ? (
                  <div className="text-xs text-muted-foreground">{item.nameEn}</div>
                ) : null}
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {item.companyKey}
                  {item.type ? ` · ${item.type}` : ''}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section data-testid="research-section-pulse">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {t('research.sectionPulse', { defaultValue: '市场动态' })}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setKeywordsDialogOpen(true)}
            data-testid="research-manage-keywords"
          >
            {t('research.pulseKeywords.manage', { defaultValue: '管理关键词' })}
          </Button>
        </div>

        {effectiveKeywords.length > 0 ? (
          <div
            className="mb-2 flex flex-wrap items-center gap-1.5"
            data-testid="research-pulse-chips"
          >
            {visibleChips.map((kw) => {
              const active = pulseFocusKeyword === kw
              return (
                <button
                  key={kw}
                  type="button"
                  data-testid="research-pulse-chip"
                  data-keyword={kw}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => handlePulseChipClick(kw)}
                  className={
                    active
                      ? 'rounded-full border border-blue-500 bg-blue-50 px-2 py-0.5 text-xs text-blue-700'
                      : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-blue-300'
                  }
                >
                  {kw}
                </button>
              )
            })}
            {moreChipCount > 0 ? (
              <span
                className="text-xs text-muted-foreground"
                data-testid="research-pulse-chips-more"
              >
                +{moreChipCount}
              </span>
            ) : null}
            {pulseFocusKeyword ? (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                data-testid="research-pulse-clear-focus"
                onClick={() => setPulseFocusKeyword(null)}
              >
                {t('research.pulseKeywords.clearFocus', { defaultValue: '清除筛选' })}
              </button>
            ) : null}
          </div>
        ) : null}

        {pulseError ? (
          <p className="text-sm text-red-600" data-testid="research-pulse-error">
            {pulseError}
          </p>
        ) : null}

        {softEmpty ? (
          <div
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
            data-testid="research-pulse-soft-empty"
          >
            <p className="text-amber-900">
              {t('research.pulseKeywords.softEmpty', {
                defaultValue: '当前关键词未命中近期资讯，可显示全部或调整关键词。',
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={handleShowAllPulse}
              data-testid="research-pulse-show-all"
            >
              {t('research.pulseKeywords.showAll', { defaultValue: '显示全部' })}
            </Button>
          </div>
        ) : null}

        {pulseLoading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : displayPulseItems.length === 0 && !softEmpty ? (
          <p className="text-sm text-muted-foreground" data-testid="research-pulse-empty">
            {t('research.pulseEmpty', { defaultValue: '暂无近期资讯。' })}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {displayPulseItems.map((item, index) => {
              const relative = formatPulseRelativeTime(item.capturedAt)
              return (
                <li
                  key={`${item.title}-${index}`}
                  data-testid="research-pulse-item"
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal"
                    data-testid="research-pulse-platform"
                  >
                    {item.platform}
                  </Badge>
                  {relative ? (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="research-pulse-time"
                    >
                      {relative}
                    </span>
                  ) : null}
                  {item.url ? (
                    <a
                      href={item.url}
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span>{item.title}</span>
                  )}
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
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <PulseKeywordsDialog
        open={keywordsDialogOpen}
        onOpenChange={setKeywordsDialogOpen}
        initial={keywordsState}
        saving={keywordsSaving}
        onSave={handleSaveKeywords}
      />

      <section data-testid="research-section-search">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionSearch', { defaultValue: '搜索企业' })}
        </h2>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <div className="min-w-[16rem] flex-1 max-w-md">
            <ResearchCompanyPredictInput
              teamSlug={teamSlug}
              value={q}
              onValueChange={setQ}
              showcaseSuggestions={showcaseSuggestions}
            />
          </div>
          <Button type="submit" disabled={loading} data-testid="research-company-search-submit">
            {loading
              ? t('research.searching', { defaultValue: '搜索中…' })
              : t('research.search', { defaultValue: '搜索' })}
          </Button>
        </form>
        {error ? (
          <p className="mt-2 text-sm text-red-600" data-testid="research-search-error">
            {error}
          </p>
        ) : null}
        {!loading && searched && items.length === 0 && !error ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="research-search-empty">
            {t('research.searchEmpty', {
              defaultValue: '无匹配企业。可先加载展示数据或换关键词。',
            })}
          </p>
        ) : null}
        <ul className="mt-2 space-y-2" data-testid="research-search-results">
          {items.map((item) => (
            <li key={item.companyKey}>
              <Link
                to={`/${teamSlug}/research/${encodeURIComponent(item.companyKey)}?persona=hr`}
                className="text-blue-600 hover:underline"
                data-testid="research-search-result"
              >
                {primaryLabel(item.nameCn, item.displayName, item.nameEn)}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {item.companyKey}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default ResearchIndexPage
