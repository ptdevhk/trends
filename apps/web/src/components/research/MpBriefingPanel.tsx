import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { rawApiClient } from '@/lib/api-helpers'
import type { MpBriefing, MpBriefingResponse } from './ChannelsBriefingPanel'

function parsePastedMpUrls(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function isAllowedMpArticleUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443')
  ) {
    return false
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname !== 'mp.weixin.qq.com') {
    return false
  }
  const pathname = parsed.pathname || '/'
  if (/^\/s\/[A-Za-z0-9_-]+\/?$/.test(pathname)) {
    return true
  }
  return (
    (pathname === '/s' || pathname === '/s/') &&
    parsed.searchParams.has('__biz')
  )
}

/**
 * Boss-paste lane for public WeChat official-account (mp) articles.
 *
 * This is a SEPARATE lane from ChannelsBriefingPanel: it accepts only
 * mp.weixin.qq.com article links and POSTs to /api/research/mp-briefing. It
 * never routes an mp link to the Channels probe and never accepts sph here.
 * Cards are metadata-free (url + 公众号 badge) — enrichment is left to the
 * WeRSS sidecar (Plan Phase B), not an in-BFF WeChat scrape.
 */
export function MpBriefingPanel() {
  const { t } = useTranslation()
  const [paste, setPaste] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [briefing, setBriefing] = useState<MpBriefing | null>(null)

  const urls = useMemo(() => parsePastedMpUrls(paste), [paste])
  const urlsAreValid =
    urls.length >= 1 && urls.length <= 8 && urls.every(isAllowedMpArticleUrl)
  const hasValidationError = urls.length > 0 && !urlsAreValid
  const canGenerate = urlsAreValid && !loading

  const requestBriefing = useCallback(async () => {
    const submitted = parsePastedMpUrls(paste)
    if (submitted.length < 1 || submitted.length > 8 || !submitted.every(isAllowedMpArticleUrl)) {
      return
    }
    setLoading(true)
    setError(null)
    let data: MpBriefingResponse | undefined
    let apiError: unknown
    try {
      const result = await rawApiClient.POST<MpBriefingResponse>(
        '/api/research/mp-briefing',
        { body: { urls: submitted } },
      )
      data = result.data
      apiError = result.error
    } catch {
      setLoading(false)
      setBriefing(null)
      setError(
        t('research.channelsBriefing.mpErrorGeneric', {
          defaultValue: '文章整理失败。请重试。',
        }),
      )
      return
    }
    setLoading(false)
    if (apiError || !data?.success || !data.briefing) {
      setBriefing(null)
      setError(
        t('research.channelsBriefing.mpErrorGeneric', {
          defaultValue: '文章整理失败。请重试。',
        }),
      )
      return
    }
    setBriefing(data.briefing)
  }, [paste, t])

  return (
    <section data-testid="research-mp-briefing">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t('research.channelsBriefing.mpTitle', { defaultValue: '公众号文章' })}
          </CardTitle>
          <CardDescription>
            {t('research.channelsBriefing.mpDescription', {
              defaultValue:
                '粘贴公众号（mp.weixin.qq.com）文章链接，先整理成卡片。不做站内抓取。',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="research-mp-briefing-urls">
              {t('research.channelsBriefing.pasteLabel', { defaultValue: '分享链接' })}
            </Label>
            <Textarea
              id="research-mp-briefing-urls"
              data-testid="research-mp-briefing-textarea"
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              rows={4}
              placeholder={t('research.channelsBriefing.mpPastePlaceholder', {
                defaultValue: 'https://mp.weixin.qq.com/s/…',
              })}
              aria-invalid={hasValidationError || undefined}
              aria-describedby={hasValidationError ? 'research-mp-briefing-validation' : undefined}
              className="min-h-[96px] font-mono text-xs"
            />
            {hasValidationError ? (
              <p
                id="research-mp-briefing-validation"
                className="text-xs text-red-600"
                data-testid="research-mp-briefing-validation"
                role="alert"
              >
                {t('research.channelsBriefing.mpValidation', {
                  defaultValue: '请粘贴 1 至 8 条有效的公众号文章链接。',
                })}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11 w-full sm:h-10 sm:w-auto"
              disabled={!canGenerate}
              onClick={() => void requestBriefing()}
              data-testid="research-mp-briefing-generate"
            >
              {loading
                ? t('research.channelsBriefing.mpGenerating', {
                    defaultValue: '正在整理文章…',
                  })
                : t('research.channelsBriefing.mpGenerate', {
                    defaultValue: '整理文章',
                  })}
            </Button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground" data-testid="research-mp-briefing-loading">
              {t('research.channelsBriefing.mpGenerating', { defaultValue: '正在整理文章…' })}
            </p>
          ) : null}

          {error ? (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              data-testid="research-mp-briefing-error"
              role="alert"
            >
              <p>{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void requestBriefing()}
                data-testid="research-mp-briefing-retry"
              >
                {t('research.channelsBriefing.retry', { defaultValue: '重试' })}
              </Button>
            </div>
          ) : null}

          {!loading && !error && !briefing ? (
            <p className="text-sm text-muted-foreground" data-testid="research-mp-briefing-empty">
              {t('research.channelsBriefing.mpEmpty', {
                defaultValue: '还没有文章卡片。粘贴公众号链接即可整理。',
              })}
            </p>
          ) : null}

          {briefing && briefing.cards.length > 0 ? (
            <div className="space-y-2" data-testid="research-mp-briefing-result">
              {briefing.cards.map((card, index) => (
                <a
                  key={card.url}
                  href={card.url}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-blue-600 hover:bg-slate-50 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="research-mp-briefing-card"
                >
                  <span className="w-6 shrink-0 text-lg font-semibold tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-all text-sm">
                    {card.url}
                  </span>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                    {t('research.channelsBriefing.mpSourceLabel', { defaultValue: '公众号' })}
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
