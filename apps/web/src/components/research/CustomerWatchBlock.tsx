import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { rawApiClient } from '@/lib/api-helpers'

export const WATCH_BRANCHES = ['压铸', '模具', '五金', '冲压', '机加工', '钣金', '其他'] as const

export type WatchEntry = {
  id: string
  companyKey: string
  name: string
  aliases?: string[]
  downstreamBranch: string
  sourceKind: 'videoChannel' | 'mp' | 'manual'
  sourceUrls?: string[]
  sourceAuthor?: string
  caption?: string
  status: 'active' | 'needsTopic'
  createdAt: number
  updatedAt: number
}

export type IdentifyResult = {
  kind: 'videoChannel' | 'mp' | 'manual'
  name: string | null
  author?: string
  caption?: string
  url: string
  needsTopic: boolean
  shareId?: string
  articleId?: string
}

type WatchlistResponse = { success: boolean; entries: WatchEntry[] }
type IdentifyResponse = { success: boolean; result: IdentifyResult }

export function CustomerWatchBlock() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<WatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [paste, setPaste] = useState('')
  const [identifying, setIdentifying] = useState(false)
  const [identified, setIdentified] = useState<IdentifyResult | null>(null)
  const [confirmed, setConfirmed] = useState('')
  const [branches, setBranches] = useState<Set<string>>(new Set())
  const [addedName, setAddedName] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await rawApiClient.GET<WatchlistResponse>('/api/research/watchlist')
    if (!error && data?.success && Array.isArray(data.entries)) {
      setEntries(data.entries)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const parsePastedUrls = useMemo(() => {
    return paste
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }, [paste])

  const handleIdentify = useCallback(async () => {
    if (parsePastedUrls.length === 0) return
    setIdentifying(true)
    setIdentified(null)
    setConfirmed('')
    setBranches(new Set())
    setAddedName(null)
    const first = parsePastedUrls[0]
    const { data, error } = await rawApiClient.POST<IdentifyResponse>(
      '/api/research/watchlist/identify',
      { body: { url: first } },
    )
    setIdentifying(false)
    if (!error && data?.success) {
      setIdentified(data.result)
      setConfirmed(data.result.name ?? '')
    }
  }, [parsePastedUrls])

  const toggleBranch = (b: string) => {
    setBranches((prev) => {
      const next = new Set(prev)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  const handleAdd = useCallback(async () => {
    if (!identified) return
    const name = identified.name || confirmed.trim()
    if (!name) return
    const branch = branches.size > 0 ? [...branches][0] : '其他'
    const { data, error } = await rawApiClient.POST<WatchlistResponse>('/api/research/watchlist', {
      body: {
        name,
        ...(branch ? { downstreamBranch: branch } : {}),
        sourceKind: identified.kind,
        sourceUrls: [identified.url],
        ...(identified.author ? { sourceAuthor: identified.author } : {}),
        ...(identified.caption ? { caption: identified.caption } : {}),
        ...(identified.needsTopic ? { status: 'needsTopic' } : {}),
      },
    })
    if (!error && data?.success && Array.isArray(data.entries)) {
      setEntries(data.entries)
      setIdentified(null)
      setConfirmed('')
      setBranches(new Set())
      setAddedName(name)
      setPaste('')
    }
  }, [identified, confirmed, branches])

  const handleRemove = useCallback(
    async (id: string) => {
      const { data, error } = await rawApiClient.POST<WatchlistResponse>('/api/research/watchlist/remove', {
        body: { id },
      })
      if (!error && data?.success && Array.isArray(data.entries)) {
        setEntries(data.entries)
      }
    },
    [],
  )

  return (
    <section data-testid="research-customer-watch" className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t('research.watch.title', { defaultValue: '客户监控' })}
          </CardTitle>
          <CardDescription>
            {t('research.watch.desc', {
              defaultValue: '粘贴 boss 发来的微信链接 → 自动识别企业 → 加进今日关键词 & 跟踪相关新闻',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t('research.watch.pastePlaceholder', {
                defaultValue: '粘贴 视频号 sph / 公众号 mp 链接（每行一条）',
              })}
              className="min-w-[16rem] flex-1"
              data-testid="research-watch-paste"
            />
            <Button
              type="button"
              size="sm"
              disabled={identifying || parsePastedUrls.length === 0}
              onClick={() => void handleIdentify()}
              data-testid="research-watch-identify"
            >
              {identifying
                ? t('resumes.loading', { defaultValue: 'Loading...' })
                : t('research.watch.identify', { defaultValue: '识别企业' })}
            </Button>
          </div>

          {identified ? (
            <div
              className="rounded-lg border border-blue-200 bg-blue-50/50 p-3"
              data-testid="research-watch-identified"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {identified.kind === 'videoChannel' ? '视频号' : identified.kind === 'mp' ? '公众号' : '手动'}
                </span>
                <Badge className="border-[#c45c26]/40 text-[#c45c26]" variant="outline">
                  {t('research.watch.downstream', { defaultValue: '下游' })}
                </Badge>
              </div>
              {identified.name ? (
                <div className="mt-2 text-xl font-extrabold">{identified.name}</div>
              ) : (
                <Input
                  value={confirmed}
                  onChange={(e) => setConfirmed(e.target.value)}
                  placeholder={t('research.watch.confirmPlaceholder', {
                    defaultValue: '公众号无法自动识别，手动输入企业/主题',
                  })}
                  className="mt-2 max-w-xs"
                  data-testid="research-watch-confirm-input"
                />
              )}
              {identified.caption ? (
                <p className="mt-1 text-xs text-muted-foreground">{identified.caption}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5" data-testid="research-watch-branches">
                {WATCH_BRANCHES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={branches.has(b)}
                    onClick={() => toggleBranch(b)}
                    data-testid={`research-watch-branch-${b}`}
                    className={
                      branches.has(b)
                        ? 'rounded-full border border-[#c45c26]/40 bg-[#fdf3ec] px-2 py-0.5 text-xs text-[#c45c26]'
                        : 'rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-blue-300'
                    }
                  >
                    {b}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={!(identified.name || confirmed.trim())}
                onClick={() => void handleAdd()}
                data-testid="research-watch-add"
              >
                {t('research.watch.add', { defaultValue: '＋ 加入客户监控清单' })}
              </Button>
            </div>
          ) : null}

          {addedName ? (
            <p className="text-sm text-green-700" data-testid="research-watch-added">
              {t('research.watch.added', { defaultValue: '已加入客户监控：{{name}}', name: addedName })}
            </p>
          ) : null}

          <div data-testid="research-watch-list">
            <h3 className="mb-2 text-sm font-semibold">
              {t('research.watch.listTitle', { defaultValue: '客户监控清单' })}
              <span className="ml-2 text-xs text-muted-foreground">
                {t('research.watch.listCount', { count: entries.length, defaultValue: '{{count}} 位' })}
              </span>
            </h3>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t('resumes.loading', { defaultValue: 'Loading...' })}</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="research-watch-empty">
                {t('research.watch.empty', { defaultValue: '还没有监控客户。粘贴链接识别后加入。' })}
              </p>
            ) : (
              <ul className="space-y-2" data-testid="research-watch-list-ul">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                    data-testid="research-watch-entry"
                    data-company-key={e.companyKey}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                      {e.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{e.name}</div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {e.downstreamBranch ? (
                          <Badge className="border-[#c45c26]/40 text-[#c45c26]" variant="outline">
                            {t('research.watch.downstream', { defaultValue: '下游' })} · {e.downstreamBranch}
                          </Badge>
                        ) : null}
                        <span>
                          {e.sourceKind === 'videoChannel'
                            ? t('research.watch.srcVideo', { defaultValue: '视频号' })
                            : e.sourceKind === 'mp'
                              ? t('research.watch.srcMp', { defaultValue: '公众号' })
                              : t('research.watch.srcManual', { defaultValue: '手动' })}
                        </span>
                        {e.status === 'needsTopic' ? (
                          <span className="text-amber-600">{t('research.watch.needsTopic', { defaultValue: '待补主题' })}</span>
                        ) : (
                          <span className="text-green-700">{t('research.watch.active', { defaultValue: '已监控 ✓' })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemove(e.id)}
                        data-testid={`research-watch-remove-${e.companyKey}`}
                      >
                        {t('research.watch.remove', { defaultValue: '移除' })}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export default CustomerWatchBlock
