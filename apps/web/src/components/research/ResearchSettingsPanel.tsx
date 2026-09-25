import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'
import { zhCN } from 'date-fns/locale/zh-CN'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PulseKeywordsDialogState } from './PulseKeywordsDialog'
import type { HotlistPlatformsDialogState } from './HotlistPlatformsDialog'
import type { NewsSourcesDialogState } from './NewsSourcesDialog'

type RealtimeNewsItem = {
  title: string
  platform: string
  url?: string
  capturedAt: number
  matchedKeywords?: string[]
}

/** 下游需求 (CNC root → downstream) is the default filter for 实时新闻 / 日报. */
const DOWNSTREAM_GROUP_ID = 'downstream-demand'

/** Collapsed groups shown by default under the CNC root (▸), per approved design. */
const COLLAPSED_GROUP_FALLBACKS: Record<string, string> = {
  process: '工艺',
  'cnc-components': '部件',
  brands: '品牌',
}

function formatAge(capturedAt: number): string {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return ''
  const date = new Date(capturedAt)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
  } catch {
    return ''
  }
}

export type ResearchSettingsPanelProps = {
  /** Default filter — the downstream keywords that gate 实时新闻 / 日报. */
  realtimeItems: RealtimeNewsItem[]
  realtimeLoading: boolean
  keywords: PulseKeywordsDialogState | null
  platforms: HotlistPlatformsDialogState | null
  newsSources: NewsSourcesDialogState | null
  onSaveKeywords: (body: {
    enabled: string[]
    excluded: string[]
    custom: string[]
  }) => void | Promise<void>
  onSavePlatforms: (body: { enabled: string[]; excluded: string[] }) => void | Promise<void>
  onSaveNewsSources: (body: {
    masterEnabled?: boolean
    excludedGroups: string[]
    excludedFeeds: string[]
    enabledFeeds: string[]
  }) => void | Promise<void>
  onRestoreDefaults: () => void
}

/**
 * 行业研究 / 监控设置 — single-page settings UI for /hr/research.
 *
 * Layout (approved visual companion): 实时新闻 (single output, default 下游 filter) on
 * top, then 关键词 CNC 根树 (下游 default-on + collapsed 工艺/部件/品牌), then 数据源 +
 * 热榜平台 two-column, then 保存配置/恢复默认. All persisted through the same per-workspace
 * workspace_config endpoints the keyword/platform/source dialogs already use.
 *
 * This panel is NON-fetching by design: it renders parent-provided data so it never adds a
 * competing /api/research/pulse call that would perturb existing hub state/tests.
 */
export function ResearchSettingsPanel({
  realtimeItems,
  realtimeLoading,
  keywords,
  platforms,
  newsSources,
  onSaveKeywords,
  onSavePlatforms,
  onSaveNewsSources,
  onRestoreDefaults,
}: ResearchSettingsPanelProps) {
  const { t } = useTranslation()

  const seed = keywords?.seed ?? null
  const groups = seed?.groups ?? []
  const downstreamGroup = groups.find((g) => g.id === DOWNSTREAM_GROUP_ID)
  const defaultKeywords = seed?.defaultKeywords ?? []
  const workspaceCustom = keywords?.workspace.custom ?? []

  const downstreamKeywords = useMemo(
    () => downstreamGroup?.keywords ?? [],
    [downstreamGroup],
  )

  // effectiveKeywords reflects the current workspace state (past saves), so the
  // tree opens reflecting reality while downstream is always the highlighted default.
  const effectiveSet = useMemo(
    () => new Set((keywords?.effective ?? []).map((k) => k.trim().normalize('NFKC'))),
    [keywords?.effective],
  )

  const [activeKeywords, setActiveKeywords] = useState<Set<string>>(() => new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([DOWNSTREAM_GROUP_ID]))

  // Re-seed local edits whenever the underlying store identity changes (same
  // convention as the keyword dialog: re-init on data arrival, not per render).
  useEffect(() => {
    const next = new Set<string>()
    for (const g of groups) {
      for (const kw of g.keywords) {
        if (effectiveSet.has(kw.trim().normalize('NFKC'))) next.add(kw)
      }
    }
    setActiveKeywords(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  /** Realtime list gated to the currently-checked downstream keywords (默认 only). */
  const filteredRealtime = useMemo(() => {
    if (downstreamKeywords.length === 0) return []
    const active = new Set(
      downstreamKeywords.filter((kw) => activeKeywords.has(kw)).map((kw) => kw.trim().normalize('NFKC')),
    )
    if (active.size === 0) return []
    return realtimeItems.filter((item) => {
      const matched = (item.matchedKeywords ?? []).map((m) => m.trim().normalize('NFKC'))
      if (matched.some((m) => active.has(m))) return true
      const hay = `${item.title}`.normalize('NFKC')
      return [...active].some((needle) => hay.includes(needle))
    })
  }, [realtimeItems, downstreamKeywords, activeKeywords])

  const toggleKeyword = (kw: string, next: boolean) => {
    setActiveKeywords((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(kw)
      else copy.delete(kw)
      return copy
    })
  }

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => {
      const copy = new Set(prev)
      if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })
  }

  const handleSaveKeywords = () => {
    const normActive = new Set([...activeKeywords].map((k) => k.trim().normalize('NFKC')))
    const defaultSet = new Set(defaultKeywords.map((k) => k.trim().normalize('NFKC')))
    const allKnown = new Set(
      groups.flatMap((g) => g.keywords.map((k) => k.trim().normalize('NFKC'))),
    )
    const excluded = defaultKeywords.filter((k) => !normActive.has(k.trim().normalize('NFKC')))
    const enabled = [...activeKeywords].filter((k) => {
      const n = k.trim().normalize('NFKC')
      return !defaultSet.has(n) && allKnown.has(n)
    })
    void onSaveKeywords({ enabled, excluded, custom: workspaceCustom })
  }

  // ---- 数据源 (type rows derived from feed ids) ----
  const sourceTypeStats = useMemo(() => {
    const gnewsIds: string[] = []
    const bingIds: string[] = []
    const brandIds: string[] = []
    const seen = new Set<string>()
    const brandSet = new Set<string>()
    for (const g of newsSources?.seed.groups ?? []) {
      if (g.id === 'brands') for (const f of g.feeds) brandSet.add(f)
    }
    for (const g of newsSources?.seed.groups ?? []) {
      for (const f of g.feeds) {
        if (seen.has(f)) continue
        seen.add(f)
        if (brandSet.has(f)) brandIds.push(f)
        else if (f.startsWith('bing-')) bingIds.push(f)
        else if (f.startsWith('gnews-')) gnewsIds.push(f)
        else brandIds.push(f) // non gnews/bing catalog rows still count as feeds
      }
    }
    const effective = new Set(newsSources?.effective ?? [])
    return {
      rows: [
        { id: 'gnews', label: 'GNews 中文', total: gnewsIds.length, on: gnewsIds.filter((f) => effective.has(f)).length, feeds: gnewsIds },
        { id: 'bing', label: 'Bing 工业 / 热榜', total: bingIds.length, on: bingIds.filter((f) => effective.has(f)).length, feeds: bingIds },
        { id: 'brand', label: '品牌 Feed', total: brandIds.length, on: brandIds.filter((f) => effective.has(f)).length, feeds: brandIds },
      ],
      masterOn: newsSources?.workspace.masterEnabled !== false,
    }
  }, [newsSources])
  // 数据源 draft: type rows are opt-out via excludedFeeds (the existing workspace
  // model). masterEnabled controls the global on/off; a type row toggled OFF adds
  // every feed of that type to excludedFeeds, toggled ON removes them.
  const [sourceMasterDraft, setSourceMasterDraft] = useState<boolean>(true)
  const [excludedTypeFeeds, setExcludedTypeFeeds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setSourceMasterDraft(newsSources?.workspace.masterEnabled !== false)
    setExcludedTypeFeeds(new Set(newsSources?.workspace.excludedFeeds ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsSources?.seed])

  const typeFeedSet = useMemo(
    () => new Map(sourceTypeStats.rows.map((r) => [r.id, new Set(r.feeds)])),
    [sourceTypeStats],
  )

  const toggleSourceType = (rowId: string, next: boolean) => {
    setExcludedTypeFeeds((prev) => {
      const copy = new Set(prev)
      const feeds = typeFeedSet.get(rowId)
      if (!feeds) return copy
      for (const f of feeds) {
        if (next) copy.delete(f)
        else copy.add(f)
      }
      return copy
    })
  }

  const handleSaveNewsSources = () => {
    void onSaveNewsSources({
      masterEnabled: sourceMasterDraft,
      excludedGroups: newsSources?.workspace.excludedGroups ?? [],
      excludedFeeds: [...excludedTypeFeeds],
      enabledFeeds: newsSources?.workspace.enabledFeeds ?? [],
    })
  }

  // ---- 热榜平台 ----
  const platformCatalog = platforms?.seed.catalogIds ?? []
  const platformEffectiveSet = useMemo(
    () => new Set(platforms?.effective ?? []),
    [platforms?.effective],
  )
  const [checkedPlatforms, setCheckedPlatforms] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setCheckedPlatforms(new Set(platformEffectiveSet))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms?.seed])
  const togglePlatform = (id: string) => {
    setCheckedPlatforms((prev) => {
      const copy = new Set(prev)
      if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })
  }
  const handleSavePlatforms = () => {
    const enabled = platformCatalog.filter((id) => checkedPlatforms.has(id))
    void onSavePlatforms({ enabled, excluded: [] })
  }

  const handleSaveAll = () => {
    handleSaveKeywords()
    handleSavePlatforms()
    handleSaveNewsSources()
  }

  const hasSaving = false // parent controls global buttons; keep visual parity

  return (
    <section data-testid="research-settings-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t('research.settings.title', { defaultValue: '行业研究 / 监控设置' })}
          </CardTitle>
          <CardDescription>
            {t('research.settings.description', {
              defaultValue: '精密机械 · 数控机床 · HR 简历台',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ===== 实时新闻 (single output, default 下游 filter) ===== */}
          <div
            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            data-testid="research-realtime"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-900">
                {t('research.settings.realtimeTitle', { defaultValue: '实时新闻' })}
              </span>
              <Badge
                className="border-[#c45c26]/40 text-[#c45c26]"
                variant="outline"
                data-testid="research-realtime-default-badge"
              >
                {t('research.settings.realtimeDefault', { defaultValue: '下游 默认' })}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('research.settings.realtimeHint', {
                defaultValue: '仅列当前关键词过滤命中的新闻 · 单条输出',
              })}
            </p>
            {realtimeLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('resumes.loading', { defaultValue: 'Loading...' })}
              </p>
            ) : filteredRealtime.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="research-realtime-empty">
                {t('research.settings.realtimeEmpty', {
                  defaultValue: '暂无当前下游关键词命中的新闻。',
                })}
              </p>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="research-realtime-list">
                {filteredRealtime.map((item, index) => {
                  const matched = (item.matchedKeywords ?? []).find((m) =>
                    downstreamKeywords
                      .filter((kw) => activeKeywords.has(kw))
                      .some((kw) => kw.trim().normalize('NFKC') === m.trim().normalize('NFKC')),
                  )
                  const age = formatAge(item.capturedAt)
                  const content = (
                    <span className="flex-1 text-sm text-slate-800">{item.title}</span>
                  )
                  return (
                    <li
                      key={`${item.title}-${index}`}
                      data-testid="research-realtime-item"
                      className="flex items-center gap-2"
                    >
                      {matched ? (
                        <Badge
                          className="shrink-0 border-[#c45c26]/40 bg-[#fdf3ec] text-[#c45c26]"
                          variant="outline"
                          data-testid="research-realtime-chip"
                        >
                          {matched}
                        </Badge>
                      ) : null}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-sm text-slate-800 hover:text-blue-600 hover:underline"
                        >
                          {item.title}
                        </a>
                      ) : (
                        content
                      )}
                      {age ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{age}</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ===== 关键词 (component A · CNC 根树，下游默认) ===== */}
          <div data-testid="research-keyword-tree">
            <div className="mb-1">
              <span className="text-sm font-extrabold text-slate-900">CNC </span>
              <span className="text-xs text-muted-foreground">
                {t('research.settings.cncRoot', { defaultValue: '（领域根 · 非可选项）' })}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t('research.settings.cncRootHint', {
                defaultValue: '全部关键词隶属于 CNC；下游组 = 实时新闻/日报 的默认过滤',
              })}
            </p>
            {groups.map((group) => {
              const isDownstream = group.id === DOWNSTREAM_GROUP_ID
              const isExpanded = expandedGroups.has(group.id)
              const fallback = COLLAPSED_GROUP_FALLBACKS[group.id]
              const displayLabel = isDownstream ? '下游需求' : fallback ?? group.label
              const activeCount = group.keywords.filter((k) => activeKeywords.has(k)).length
              return (
                <div key={group.id} className="mb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleGroupExpand(group.id)}
                      aria-expanded={isExpanded}
                      data-testid={`research-tree-group-${group.id}`}
                      className={`flex items-center gap-1 text-sm font-bold ${isDownstream ? 'text-[#c45c26]' : 'text-[#2f6fed]'}`}
                    >
                      <span>{isExpanded ? '▾' : '▸'}</span>
                      <span>{displayLabel}</span>
                      <span className="font-mono text-[10px] font-normal text-muted-foreground">
                        {activeCount}/{group.keywords.length}
                      </span>
                    </button>
                    {isDownstream ? (
                      <Badge
                        className="bg-[#c45c26] text-white"
                        data-testid="research-tree-downstream-default"
                      >
                        {t('research.settings.defaultEnabled', { defaultValue: '默认启用' })}
                      </Badge>
                    ) : null}
                  </div>
                  {isExpanded ? (
                    <div
                      className="ml-4 mt-2 flex flex-wrap gap-1.5"
                      data-testid={`research-tree-group-chips-${group.id}`}
                    >
                      {group.keywords.map((kw) => {
                        const checked = activeKeywords.has(kw)
                        return (
                          <button
                            key={kw}
                            type="button"
                            aria-pressed={checked}
                            onClick={() => toggleKeyword(kw, !checked)}
                            data-testid="research-tree-kw-chip"
                            data-keyword={kw}
                            data-group={group.id}
                            className={
                              checked
                                ? 'rounded-md border border-[#c45c26]/40 bg-[#fdf3ec] px-2 py-0.5 text-xs text-[#c45c26]'
                                : 'rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-blue-300'
                            }
                          >
                            {checked ? '✓ ' : ''}
                            {kw}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* ===== 数据源 + 热榜平台 (two-column) ===== */}
          <div className="grid gap-4 md:grid-cols-2" data-testid="research-settings-cards">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-[#2f6fed]">
                  {t('research.settings.newsSources', {
                    defaultValue: `数据源 (${sourceTypeStats.rows.reduce((a, r) => a + r.total, 0)})`,
                  })}
                </CardTitle>
                <CardDescription>
                  {t('research.settings.newsSourcesHint', { defaultValue: 'CNC/机床新闻源' })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5" data-testid="research-settings-news-sources">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border border-primary"
                    checked={sourceMasterDraft}
                    onChange={(e) => setSourceMasterDraft(e.target.checked)}
                    data-testid="research-settings-source-master"
                  />
                  <span>
                    {t('research.settings.enableSources', { defaultValue: '启用 CNC/机床新闻数据源' })}
                  </span>
                </label>
                {sourceTypeStats.rows.map((row) => {
                  const draftOn =
                    sourceMasterDraft &&
                    (row.feeds.length === 0 ||
                      row.feeds.some((f) => !excludedTypeFeeds.has(f)))
                  const noneFeeds = row.feeds.length === 0
                  return (
                    <label
                      key={row.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-primary"
                        checked={draftOn}
                        onChange={() => toggleSourceType(row.id, !draftOn)}
                        data-testid={`research-settings-source-${row.id}`}
                      />
                      <span className="flex-1">{row.label}</span>
                      <span className={`text-xs ${draftOn ? 'text-[#1a8f5a]' : 'text-muted-foreground'}`}>
                        ({noneFeeds ? 0 : row.on}/{row.total})
                      </span>
                    </label>
                  )
                })}
                <label className="flex cursor-not-allowed items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" disabled className="h-4 w-4 rounded border" />
                  <span>
                    hacker news <span className="text-xs">({t('research.settings.enOff', { defaultValue: 'EN 默认关' })})</span>
                  </span>
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-[#2f6fed]">
                  {t('research.settings.platforms', {
                    defaultValue: `热榜平台 (${platformCatalog.length})`,
                  })}
                </CardTitle>
                <CardDescription>
                  {t('research.settings.platformsHint', { defaultValue: 'NewsNow 平台' })}
                </CardDescription>
              </CardHeader>
              <CardContent data-testid="research-settings-platforms">
                <div className="flex flex-wrap gap-1.5">
                  {platformCatalog.map((id) => {
                    const checked = checkedPlatforms.has(id)
                    const name = (platforms?.seed.groups
                      .flatMap((g) => g.platforms)
                      .find((p) => p.id === id)?.name) ?? id
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => togglePlatform(id)}
                        data-testid="research-settings-platform-chip"
                        data-platform-id={id}
                        className={
                          checked
                            ? 'rounded-full border border-blue-500 bg-blue-50 px-2 py-0.5 text-xs text-blue-700'
                            : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 hover:border-blue-300'
                        }
                      >
                        {name}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===== 保存配置 / 恢复默认 ===== */}
          <div className="flex flex-wrap gap-2" data-testid="research-settings-actions">
            <Button type="button" size="sm" onClick={() => void handleSaveAll()} data-testid="research-settings-save">
              {t('research.settings.save', { defaultValue: '保存配置' })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasSaving}
              onClick={onRestoreDefaults}
              data-testid="research-settings-restore"
            >
              {t('research.settings.restore', { defaultValue: '恢复默认' })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export default ResearchSettingsPanel
