import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { rawApiClient } from '@/lib/api-helpers'
import { CHANNELS_BRIEFING_GOLDEN_URLS } from './channels-briefing.fixture'

export type ChannelsBriefingPost = {
  shareId: string
  url: string
  author: string
  caption: string
  createtime?: number
  likes?: number
  comments?: number
  forwards?: number
  favs?: number
  coverUrl?: string | null
}

export type ChannelsBriefingOpportunity = {
  who: string
  sell: string
  why: string
}

export type ChannelsBriefing = {
  oneLiner: string
  generatedAt?: string
  posts: ChannelsBriefingPost[]
  coreTrends: string[]
  weakSignals: string[]
  opportunities: ChannelsBriefingOpportunity[]
  sources: string[]
}

export type ChannelsBriefingResponse = {
  success: boolean
  briefing?: ChannelsBriefing
}

const SAMPLE_CARDS = [
  {
    id: 'primary' as const,
    urls: CHANNELS_BRIEFING_GOLDEN_URLS,
    categoryKey: 'research.channelsBriefing.samplePrimaryCategory',
    categoryDefault: '明日简报',
    titleKey: 'research.channelsBriefing.samplePrimaryTitle',
    titleDefault: '机床业务',
  },
  {
    id: 'expansion' as const,
    urls: [CHANNELS_BRIEFING_GOLDEN_URLS[0]],
    categoryKey: 'research.channelsBriefing.sampleExpansionCategory',
    categoryDefault: '液冷',
    titleKey: 'research.channelsBriefing.sampleExpansionTitle',
    titleDefault: '扩产',
  },
  {
    id: 'connector' as const,
    urls: [CHANNELS_BRIEFING_GOLDEN_URLS[1]],
    categoryKey: 'research.channelsBriefing.sampleConnectorCategory',
    categoryDefault: '液冷',
    titleKey: 'research.channelsBriefing.sampleConnectorTitle',
    titleDefault: '接头',
  },
  {
    id: 'die-cast' as const,
    urls: [CHANNELS_BRIEFING_GOLDEN_URLS[2]],
    categoryKey: 'research.channelsBriefing.sampleDieCastCategory',
    categoryDefault: '压铸',
    titleKey: 'research.channelsBriefing.sampleDieCastTitle',
    titleDefault: '第二曲线',
  },
]

function parsePastedUrls(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function statusFromResult(result: { error?: unknown; response?: { status?: number } }): number | undefined {
  const responseStatus = result.response?.status
  if (typeof responseStatus === 'number' && responseStatus > 0) {
    return responseStatus
  }
  return undefined
}

function formatCreatetime(createtime: number | undefined): string {
  if (typeof createtime !== 'number' || !Number.isFinite(createtime) || createtime <= 0) {
    return ''
  }
  const ms = createtime > 1e12 ? createtime : createtime * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  try {
    return date.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

function formatGeneratedAtHm(iso: string | undefined): string {
  if (typeof iso !== 'string' || iso.trim().length === 0) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function compactHandoffTerm(value: string): string {
  const trimmed = value.trim()
  const subject = trimmed.match(/^(.{2,12}?)(?:从|是|已|正|正在|进入|成为)/)?.[1]?.trim()
  if (subject) {
    return subject
  }
  const firstClause = trimmed.split(/[。；，、/]/, 1)[0]?.trim() ?? ''
  return firstClause || trimmed
}

function compactCompanyTerm(value: string): string {
  const match = value.trim().match(/^(.+?[（(][^)）]+[)）])/) 
  return match?.[1] ?? compactHandoffTerm(value)
}

function resolvedCoverUrl(coverUrl: string | null | undefined): string | null {
  if (typeof coverUrl !== 'string') {
    return null
  }
  const trimmed = coverUrl.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function ChannelsBriefingPanel() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const teamSlug = slug || 'hr'
  const [paste, setPaste] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorKind, setErrorKind] = useState<'400' | '502' | 'generic' | null>(null)
  const [briefing, setBriefing] = useState<ChannelsBriefing | null>(null)

  const urls = useMemo(() => parsePastedUrls(paste), [paste])
  const canGenerate = urls.length > 0 && !loading

  const errorMessage = useMemo(() => {
    if (errorKind === '400') {
      return t('research.channelsBriefing.error400', {
        defaultValue: '这些链接不能用。请用微信视频号的分享链接（以 weixin.qq.com/sph/ 开头）。',
      })
    }
    if (errorKind === '502') {
      return t('research.channelsBriefing.error502', {
        defaultValue: '暂时读不到这些内容。请稍后重试。',
      })
    }
    if (errorKind === 'generic') {
      return t('research.channelsBriefing.errorGeneric', {
        defaultValue: '简报生成失败。请重试。',
      })
    }
    return null
  }, [errorKind, t])

  const requestBriefing = useCallback(
    async (explicitUrls?: readonly string[]) => {
      const submitted = explicitUrls ? [...explicitUrls] : parsePastedUrls(paste)
      if (submitted.length === 0) {
        return
      }
      setLoading(true)
      setErrorKind(null)
      let data: ChannelsBriefingResponse | undefined
      let apiError: unknown
      let response: Response | undefined
      try {
        const result = await rawApiClient.POST<ChannelsBriefingResponse>(
          '/api/research/channels-briefing',
          { body: { urls: submitted } },
        )
        data = result.data
        apiError = result.error
        response = result.response
      } catch {
        // openapi-fetch rethrows transport-level failures (network down, proxy
        // 500, fetch rejection) instead of returning them as {error}; surface
        // them as a generic error rather than leaving loading stuck forever.
        setLoading(false)
        setBriefing(null)
        setErrorKind('generic')
        return
      }
      setLoading(false)
      const status = statusFromResult({ error: apiError, response })
      if (apiError || !data?.success || !data.briefing) {
        setBriefing(null)
        if (status === 400) {
          setErrorKind('400')
        } else if (status === 502) {
          setErrorKind('502')
        } else {
          setErrorKind('generic')
        }
        return
      }
      setBriefing(data.briefing)
    },
    [paste, t],
  )

  const runSample = useCallback(
    (urls: readonly string[]) => {
      setPaste(urls.join('\n'))
      void requestBriefing(urls)
    },
    [requestBriefing],
  )

  const controlsContent = (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">
          {t('research.channelsBriefing.howToTitle', { defaultValue: '怎么用' })}
        </p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li>{t('research.channelsBriefing.howTo1', { defaultValue: '在微信视频号点「分享」，再选「复制链接」。' })}</li>
          <li>{t('research.channelsBriefing.howTo2', { defaultValue: '把链接贴到下面，每行一条。' })}</li>
          <li>{t('research.channelsBriefing.howTo3', { defaultValue: '点「生成简报」。' })}</li>
        </ol>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted-foreground">
          {t('research.channelsBriefing.samplesTitle', { defaultValue: '试用示例' })}
        </p>
        <div
          className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden pb-1 [overscroll-behavior-inline:contain]"
          data-testid="research-channels-briefing-samples"
        >
          {SAMPLE_CARDS.map((sample) => {
            const category = t(sample.categoryKey, { defaultValue: sample.categoryDefault })
            const title = t(sample.titleKey, { defaultValue: sample.titleDefault })
            return (
              <button
                key={sample.id}
                type="button"
                disabled={loading}
                onClick={() => runSample(sample.urls)}
                aria-label={`${category} ${title}`}
                data-testid={`research-channels-briefing-sample-card-${sample.id}`}
                data-sample-id={sample.id}
                className="flex min-h-[132px] min-w-[44px] shrink-0 basis-[calc((100%-0.75rem)/2)] snap-start flex-col rounded-xl border border-slate-200 bg-white px-3 py-4 text-left transition hover:border-blue-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 sm:basis-[calc((100%-1.5rem)/3)] md:basis-[calc((100%-2.25rem)/4)]"
              >
                <span className="text-xs text-muted-foreground">{category}</span>
                <span className="mt-auto text-sm font-semibold leading-snug">{title}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="research-channels-briefing-urls">
          {t('research.channelsBriefing.pasteLabel', { defaultValue: '分享链接' })}
        </Label>
        <Textarea
          id="research-channels-briefing-urls"
          data-testid="research-channels-briefing-textarea"
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={4}
          placeholder={t('research.channelsBriefing.pastePlaceholder', {
            defaultValue: 'https://weixin.qq.com/sph/…',
          })}
          className="min-h-[96px] font-mono text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11 w-full sm:h-10 sm:w-auto"
          disabled={!canGenerate}
          onClick={() => void requestBriefing()}
          data-testid="research-channels-briefing-generate"
        >
          {loading
            ? t('research.channelsBriefing.generating', { defaultValue: '正在生成简报…' })
            : t('research.channelsBriefing.generate', { defaultValue: '生成简报' })}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground" data-testid="research-channels-briefing-loading">
          {t('research.channelsBriefing.generating', { defaultValue: '正在生成简报…' })}
        </p>
      ) : null}

      {errorMessage ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          data-testid="research-channels-briefing-error"
          role="alert"
        >
          <p>{errorMessage}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void requestBriefing()}
            data-testid="research-channels-briefing-retry"
          >
            {t('research.channelsBriefing.retry', { defaultValue: '重试' })}
          </Button>
        </div>
      ) : null}

      {!loading && !errorKind && !briefing ? (
        <p className="text-sm text-muted-foreground" data-testid="research-channels-briefing-empty">
          {t('research.channelsBriefing.empty', {
            defaultValue: '还没有简报。先粘贴链接，或点上方示例。',
          })}
        </p>
      ) : null}
    </div>
  )

  const resultSection = briefing ? (
    <div className="space-y-4" data-testid="research-channels-briefing-result">
      <div
        className="flex flex-wrap gap-2"
        data-testid="research-channels-briefing-header-chips"
      >
        <span
          className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
          data-testid="research-channels-briefing-post-count"
        >
          {t('research.channelsBriefing.postCount', {
            defaultValue: '{{count}} 条内容',
            count: briefing.posts.length,
          })}
        </span>
        {formatGeneratedAtHm(briefing.generatedAt) ? (
          <span
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
            data-testid="research-channels-briefing-generated-at"
          >
            {t('research.channelsBriefing.generatedAt', {
              defaultValue: '生成于 {{time}}',
              time: formatGeneratedAtHm(briefing.generatedAt),
            })}
          </span>
        ) : null}
      </div>

      <div
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
        data-testid="research-channels-briefing-one-liner"
      >
        <p className="text-xs font-semibold text-slate-600">
          {t('research.channelsBriefing.oneLiner', { defaultValue: '今日要点' })}
        </p>
        <p className="mt-1">{briefing.oneLiner}</p>
      </div>

      {briefing.posts.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            {t('research.channelsBriefing.postsTitle', { defaultValue: '相关内容' })}
          </h3>
          <ol className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {briefing.posts.map((post, index) => {
              const when = formatCreatetime(post.createtime)
              const coverUrl = resolvedCoverUrl(post.coverUrl)
              return (
                <li key={post.shareId || post.url}>
                  <article
                    className="flex items-start gap-3 p-3"
                    data-testid="research-channels-briefing-post"
                  >
                    <span
                      className="w-6 shrink-0 text-lg font-semibold tabular-nums text-muted-foreground"
                      data-testid="research-channels-briefing-rank"
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">
                        {post.caption}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('research.channelsBriefing.postMeta', {
                          defaultValue:
                            '{{author}} · {{date}} · 转发 {{forwards}} / 赞 {{likes}}',
                          author: post.author,
                          date: when,
                          forwards: post.forwards ?? 0,
                          likes: post.likes ?? 0,
                        })}
                      </p>
                    </div>
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={t('research.channelsBriefing.coverAlt', {
                          defaultValue: '{{author}} 封面',
                          author: post.author,
                        })}
                        className="aspect-[3/4] w-16 shrink-0 rounded-md object-cover sm:w-21"
                        data-testid="research-channels-briefing-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </article>
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}

      {briefing.coreTrends.length > 0 || briefing.weakSignals.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {briefing.coreTrends.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {t('research.channelsBriefing.coreTrends', { defaultValue: '核心热点' })}
              </h3>
              <ul
                className="space-y-1.5 text-sm"
                data-testid="research-channels-briefing-core-trends"
              >
                {briefing.coreTrends.map((item) => (
                  <li key={item} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{item}</span>
                    <Link
                      to={`/${teamSlug}/research?pulse=${encodeURIComponent(compactHandoffTerm(item))}`}
                      className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                      data-testid="research-channels-briefing-trend-handoff"
                    >
                      {t('research.channelsBriefing.researchTopic', { defaultValue: '研究此热点' })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {briefing.weakSignals.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                {t('research.channelsBriefing.weakSignals', { defaultValue: '需留意' })}
              </h3>
              <ul
                className="list-disc space-y-1 pl-5 text-sm"
                data-testid="research-channels-briefing-weak-signals"
              >
                {briefing.weakSignals.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {briefing.opportunities.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            {t('research.channelsBriefing.opportunities', {
              defaultValue: '可跟进的机会',
            })}
          </h3>
          <div
            className="overflow-x-auto"
            data-testid="research-channels-briefing-opportunities"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('research.channelsBriefing.colWho', { defaultValue: '谁' })}</TableHead>
                  <TableHead>{t('research.channelsBriefing.colSell', { defaultValue: '可提供' })}</TableHead>
                  <TableHead>
                    {t('research.channelsBriefing.colWhy', { defaultValue: '为什么' })}
                  </TableHead>
                  <TableHead className="w-24 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {briefing.opportunities.map((row) => {
                  const resumeHref = `/${teamSlug}/resumes?q=${encodeURIComponent(compactHandoffTerm(row.sell))}&co=${encodeURIComponent(compactCompanyTerm(row.who))}`
                  return (
                    <TableRow key={`${row.who}-${row.sell}`}>
                      <TableCell>{row.who}</TableCell>
                      <TableCell>{row.sell}</TableCell>
                      <TableCell>{row.why}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={resumeHref}
                          className="inline-block whitespace-nowrap text-xs font-medium text-blue-600 hover:underline"
                          data-testid="research-channels-briefing-opportunity-handoff"
                        >
                          {t('research.channelsBriefing.findCandidates', { defaultValue: '查找候选人' })}
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {briefing.posts.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            {t('research.channelsBriefing.sources', { defaultValue: '来源' })}
          </h3>
          <ul className="space-y-1 text-sm">
            {briefing.posts.map((post) => {
              const when = formatCreatetime(post.createtime)
              return (
                <li key={post.shareId || post.url}>
                  <a
                    href={post.url}
                    className="text-blue-600 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    data-testid="research-channels-briefing-source"
                  >
                    {t('research.channelsBriefing.sourceLabel', {
                      defaultValue: '{{author}} · {{date}}',
                      author: post.author,
                      date: when,
                    })}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <section data-testid="research-channels-briefing">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t('research.channelsBriefing.title', { defaultValue: '视频号简报' })}
          </CardTitle>
          <CardDescription>
            {t('research.channelsBriefing.description', {
              defaultValue: '粘贴视频号分享链接，生成明日要点。不看视频、不下载。',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {briefing ? (
            <>
              {resultSection}
              <details
                className="group rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                data-testid="research-channels-briefing-controls-disclosure"
              >
                <summary
                  className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900"
                  data-testid="research-channels-briefing-controls-summary"
                >
                  {t('research.channelsBriefing.updateBriefing', { defaultValue: '更新简报' })}
                </summary>
                <div className="mt-3 pt-3 border-t border-slate-200">
                  {controlsContent}
                </div>
              </details>
            </>
          ) : (
            controlsContent
          )}
        </CardContent>
      </Card>
    </section>
  )
}
