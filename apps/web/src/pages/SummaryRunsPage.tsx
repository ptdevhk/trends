import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, RotateCcw, Send, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { rawApiClient } from '@/lib/api-helpers'
import type { paths } from '@/lib/api-types'

type SummaryRunListResponse = paths['/api/summaries/runs']['get']['responses'][200]['content']['application/json']
type SummaryRunDetailResponse = paths['/api/summaries/runs/{runId}']['get']['responses'][200]['content']['application/json']
type SummaryRunRequest = NonNullable<paths['/api/summaries/run']['post']['requestBody']>['content']['application/json']
type SummaryRunResponse = paths['/api/summaries/run']['post']['responses'][200]['content']['application/json']
type SummaryRunItem = SummaryRunListResponse['items'][number]
type SummaryRunDetailItem = SummaryRunDetailResponse['item']
type SummaryDelivery = NonNullable<SummaryRunDetailItem['delivery']>
type SummaryDeliveryAccount = NonNullable<SummaryDelivery['accounts']>[number]
type SummaryPeriod = NonNullable<SummaryRunRequest['period']>
type SummaryChannel = NonNullable<SummaryRunRequest['channel']>
type SummaryRunFormState = {
  period: SummaryPeriod
  channel: SummaryChannel
  templateId: string
  endAt: string
  to: string
  subject: string
  webhookUrl: string
  botToken: string
  chatId: string
}

const SUMMARY_RUN_LIST_LIMIT = 20
const DEFAULT_SUMMARY_RUN_FORM: SummaryRunFormState = {
  period: 'daily',
  channel: 'telegram',
  templateId: '',
  endAt: '',
  to: '',
  subject: '',
  webhookUrl: '',
  botToken: '',
  chatId: '',
}

const SUMMARY_PERIOD_OPTIONS: Array<{ value: SummaryPeriod; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const SUMMARY_CHANNEL_OPTIONS: Array<{ value: SummaryChannel; label: string }> = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'wechat_work', label: 'WeChat Work' },
  { value: 'feishu', label: 'Feishu' },
  { value: 'email', label: 'Email' },
]

function isSummaryPeriod(value: string): value is SummaryPeriod {
  return value === 'daily' || value === 'weekly'
}

function isSummaryChannel(value: string): value is SummaryChannel {
  return value === 'telegram' || value === 'wechat_work' || value === 'feishu' || value === 'email'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function extractApiErrorMessage(error: unknown): string | null {
  const direct = readString(error)
  if (direct) {
    return direct
  }

  if (!isRecord(error)) {
    return null
  }

  const detail = readString(error.detail)
  if (detail) {
    return detail
  }

  const message = readString(error.message)
  if (message) {
    return message
  }

  return readString(error.error)
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function formatPeriodLabel(period: SummaryRunItem['period'] | SummaryRunDetailItem['period'] | undefined): string {
  if (period === 'weekly') {
    return 'Weekly'
  }
  return 'Daily'
}

function formatDelta(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0'
  }
  return value > 0 ? `+${value}` : String(value)
}

function formatComparisonLabel(period: SummaryRunDetailItem['period'] | undefined): string {
  return period === 'weekly' ? 'Compared with previous week' : 'Compared with previous day'
}

function formatDeliverySummary(delivery: SummaryRunItem['delivery']): string {
  if (!delivery) {
    return '—'
  }

  if (delivery.messageId) {
    return `message ${delivery.messageId}`
  }

  if (
    typeof delivery.accountsSent === 'number'
    || typeof delivery.accountsAttempted === 'number'
    || typeof delivery.accountsSelected === 'number'
  ) {
    const denominator = delivery.accountsAttempted || delivery.accountsSelected || delivery.accountsConfigured || 0
    const sent = delivery.accountsSent || 0
    const parts = [`${sent}/${denominator} sent`]

    if (typeof delivery.totalBatches === 'number' && delivery.totalBatches > 0) {
      parts.push(`${delivery.totalBatches} batches`)
    }

    if (delivery.usedOverrideBotToken || delivery.usedOverrideChatId) {
      parts.push('override')
    }

    return parts.join(' • ')
  }

  if (delivery.channel) {
    return delivery.channel
  }

  if (delivery.ok) {
    return 'ok'
  }

  return 'available'
}

function formatAccountStatus(account: SummaryDeliveryAccount): string {
  if (account.sent) {
    return 'sent'
  }
  if (account.attempted) {
    return 'failed'
  }
  return 'skipped'
}

function formatComparisonSummary(item: SummaryRunDetailItem | null): string {
  const comparison = item?.report.comparison
  if (!comparison) {
    return '—'
  }

  const shared = comparison.totalsDelta.sharedIngest
  const workspace = comparison.totalsDelta.workspaceActivity
  return [
    `${formatComparisonLabel(item?.report.period)}`,
    `shared ingest ${formatDelta(shared.newResumes)} resumes`,
    `workspace ${formatDelta(workspace.candidateStatusUpdates)} status`,
  ].join(' • ')
}

function getRunStatusVariant(status: SummaryRunItem['status']) {
  if (status === 'failed') {
    return 'destructive' as const
  }
  if (status === 'sent') {
    return 'default' as const
  }
  if (status === 'dry_run') {
    return 'secondary' as const
  }
  return 'outline' as const
}

function mergeRunIntoList(runs: SummaryRunItem[], run: SummaryRunDetailItem): SummaryRunItem[] {
  return [run, ...runs.filter((item) => item.id !== run.id)].slice(0, SUMMARY_RUN_LIST_LIMIT)
}

export function SummaryRunsPage() {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<SummaryRunItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<SummaryRunDetailItem | null>(null)
  const [runForm, setRunForm] = useState<SummaryRunFormState>(DEFAULT_SUMMARY_RUN_FORM)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [submittingMode, setSubmittingMode] = useState<'preview' | 'send' | null>(null)

  const loadRunDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<SummaryRunDetailResponse>(`/api/summaries/runs/${encodeURIComponent(runId)}`)
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to load summary run detail')
      }
      setSelectedRun(data.item)
    } catch (error) {
      console.error(`Failed to load summary run detail ${runId}`, error)
      toast.error(error instanceof Error ? error.message : 'Failed to load summary run detail')
      setSelectedRun(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const loadRuns = useCallback(async (preferredRunId?: string) => {
    setLoading(true)
    try {
      const { data, error } = await rawApiClient.GET<SummaryRunListResponse>('/api/summaries/runs', {
        params: {
          query: {
            limit: SUMMARY_RUN_LIST_LIMIT,
          },
        },
      })
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? 'Failed to load summary runs')
      }

      const items = data.items || []
      setRuns(items)

      const nextSelectedRunId = preferredRunId
        && items.some((item) => item.id === preferredRunId)
        ? preferredRunId
        : items[0]?.id ?? null

      setSelectedRunId(nextSelectedRunId)

      if (nextSelectedRunId) {
        await loadRunDetail(nextSelectedRunId)
      } else {
        setSelectedRun(null)
      }
    } catch (error) {
      console.error('Failed to load summary runs', error)
      toast.error(error instanceof Error ? error.message : 'Failed to load summary runs')
      setRuns([])
      setSelectedRunId(null)
      setSelectedRun(null)
    } finally {
      setLoading(false)
    }
  }, [loadRunDetail])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const selectedRunSummary = formatDeliverySummary(selectedRun?.delivery)
  const selectedRunComparisonSummary = formatComparisonSummary(selectedRun)
  const submittingPreview = submittingMode === 'preview'
  const submittingSend = submittingMode === 'send'
  const submitting = submittingMode !== null

  function updateRunForm<Key extends keyof SummaryRunFormState>(key: Key, value: SummaryRunFormState[Key]) {
    setRunForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function buildRunRequest(dryRun: boolean): SummaryRunRequest {
    const request: SummaryRunRequest = {
      period: runForm.period,
      channel: runForm.channel,
      dryRun,
    }

    const templateId = normalizeOptionalString(runForm.templateId)
    if (templateId) {
      request.templateId = templateId
    }

    const endAt = normalizeOptionalString(runForm.endAt)
    if (endAt) {
      request.endAt = endAt
    }

    if (runForm.channel === 'email') {
      const to = normalizeOptionalString(runForm.to)
      if (to) {
        request.to = to
      }

      const subject = normalizeOptionalString(runForm.subject)
      if (subject) {
        request.subject = subject
      }
    }

    if (runForm.channel === 'wechat_work' || runForm.channel === 'feishu') {
      const webhookUrl = normalizeOptionalString(runForm.webhookUrl)
      if (webhookUrl) {
        request.webhookUrl = webhookUrl
      }
    }

    if (runForm.channel === 'telegram') {
      const botToken = normalizeOptionalString(runForm.botToken)
      if (botToken) {
        request.botToken = botToken
      }

      const chatId = normalizeOptionalString(runForm.chatId)
      if (chatId) {
        request.chatId = chatId
      }
    }

    return request
  }

  async function handleRunAction(mode: 'preview' | 'send') {
    setSubmittingMode(mode)
    try {
      const { data, error } = await rawApiClient.POST<SummaryRunResponse>('/api/summaries/run', {
        body: buildRunRequest(mode === 'preview'),
      })
      if (error || !data?.success) {
        throw new Error(extractApiErrorMessage(error) ?? `Failed to ${mode} summary`)
      }

      setRuns((current) => mergeRunIntoList(current, data.run))
      setSelectedRunId(data.run.id)
      setSelectedRun(data.run)
      toast.success(
        mode === 'preview'
          ? t('summaries.previewSuccess', { defaultValue: 'Summary preview generated' })
          : t('summaries.sendSuccess', { defaultValue: 'Summary sent' }),
      )
    } catch (error) {
      console.error(`Failed to ${mode} summary`, error)
      toast.error(
        error instanceof Error
          ? error.message
          : mode === 'preview'
            ? t('summaries.previewError', { defaultValue: 'Failed to preview summary' })
            : t('summaries.sendError', { defaultValue: 'Failed to send summary' }),
      )
    } finally {
      setSubmittingMode(null)
    }
  }

  function handleUseSelectedRun() {
    if (!selectedRun) {
      return
    }

    setRunForm({
      period: selectedRun.period,
      channel: selectedRun.channel ?? DEFAULT_SUMMARY_RUN_FORM.channel,
      templateId: selectedRun.templateId ?? '',
      endAt: selectedRun.windowEnd,
      to: '',
      subject: '',
      webhookUrl: '',
      botToken: '',
      chatId: '',
    })
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await loadRuns(selectedRunId ?? undefined)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSelectRun(runId: string) {
    if (runId === selectedRunId) {
      return
    }
    setSelectedRunId(runId)
    await loadRunDetail(runId)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('summaries.pageTitle', { defaultValue: 'Summary Runs' })}
        description={t('summaries.pageDescription', {
          defaultValue: 'Inspect recent workspace summary runs, delivery outcomes, and the rendered content that was stored for operator history.',
        })}
        actions={(
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing
              ? t('summaries.refreshing', { defaultValue: 'Refreshing…' })
              : t('summaries.refresh', { defaultValue: 'Refresh' })}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t('summaries.historyTitle', { defaultValue: 'Recent runs' })}</CardTitle>
            <CardDescription>
              {t('summaries.historyDescription', {
                defaultValue: 'The latest persisted summary runs for the active workspace, including dry-runs, previews, sends, and failures.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">{t('summaries.loading', { defaultValue: 'Loading summary runs…' })}</div>
            ) : runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('summaries.empty', { defaultValue: 'No summary runs found yet.' })}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('summaries.columnRun', { defaultValue: 'Run' })}</TableHead>
                    <TableHead>{t('summaries.columnPeriod', { defaultValue: 'Period' })}</TableHead>
                    <TableHead>{t('summaries.columnStatus', { defaultValue: 'Status' })}</TableHead>
                    <TableHead>{t('summaries.columnStarted', { defaultValue: 'Started' })}</TableHead>
                    <TableHead>{t('summaries.columnDelivery', { defaultValue: 'Delivery' })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const isSelected = run.id === selectedRunId
                    return (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer"
                        data-state={isSelected ? 'selected' : undefined}
                        onClick={() => void handleSelectRun(run.id)}
                      >
                        <TableCell>
                          <div className="font-medium">{run.id}</div>
                          <div className="text-xs text-muted-foreground">
                            {run.triggerSource} • {run.channel || 'preview'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{formatPeriodLabel(run.period)}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRunStatusVariant(run.status)}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatTimestamp(run.startedAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDeliverySummary(run.delivery)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 min-w-0">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{t('summaries.runTitle', { defaultValue: 'Run summary' })}</CardTitle>
                  <CardDescription>
                    {t('summaries.runDescription', {
                      defaultValue: 'Preview the outbound summary content as a dry-run, then send it through the selected channel using the existing summary ledger.',
                    })}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUseSelectedRun}
                  disabled={!selectedRun || submitting}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('summaries.useSelectedRun', { defaultValue: 'Use selected run' })}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="summary-period">
                    {t('summaries.formPeriod', { defaultValue: 'Period' })}
                  </Label>
                  <Select
                    id="summary-period"
                    value={runForm.period}
                    onChange={(event) => {
                      if (isSummaryPeriod(event.target.value)) {
                        updateRunForm('period', event.target.value)
                      }
                    }}
                    options={SUMMARY_PERIOD_OPTIONS}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-channel">
                    {t('summaries.formChannel', { defaultValue: 'Channel' })}
                  </Label>
                  <Select
                    id="summary-channel"
                    value={runForm.channel}
                    onChange={(event) => {
                      if (isSummaryChannel(event.target.value)) {
                        updateRunForm('channel', event.target.value)
                      }
                    }}
                    options={SUMMARY_CHANNEL_OPTIONS}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-template-id">
                    {t('summaries.formTemplateId', { defaultValue: 'Template ID' })}
                  </Label>
                  <Input
                    id="summary-template-id"
                    value={runForm.templateId}
                    onChange={(event) => updateRunForm('templateId', event.target.value)}
                    placeholder="summary-daily"
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="summary-end-at">
                    {t('summaries.formEndAt', { defaultValue: 'Window end (ISO8601)' })}
                  </Label>
                  <Input
                    id="summary-end-at"
                    value={runForm.endAt}
                    onChange={(event) => updateRunForm('endAt', event.target.value)}
                    placeholder="2026-03-26T00:00:00Z"
                    disabled={submitting}
                  />
                </div>
              </div>

              {runForm.channel === 'email' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="summary-to">
                      {t('summaries.formEmailTo', { defaultValue: 'Email recipient' })}
                    </Label>
                    <Input
                      id="summary-to"
                      value={runForm.to}
                      onChange={(event) => updateRunForm('to', event.target.value)}
                      placeholder="ops@example.com"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary-subject">
                      {t('summaries.formSubject', { defaultValue: 'Subject override' })}
                    </Label>
                    <Input
                      id="summary-subject"
                      value={runForm.subject}
                      onChange={(event) => updateRunForm('subject', event.target.value)}
                      placeholder="Weekly Ops Summary dev"
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}

              {(runForm.channel === 'wechat_work' || runForm.channel === 'feishu') ? (
                <div className="space-y-2">
                  <Label htmlFor="summary-webhook-url">
                    {t('summaries.formWebhookUrl', { defaultValue: 'Webhook URL override' })}
                  </Label>
                  <Input
                    id="summary-webhook-url"
                    value={runForm.webhookUrl}
                    onChange={(event) => updateRunForm('webhookUrl', event.target.value)}
                    placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***"
                    disabled={submitting}
                  />
                </div>
              ) : null}

              {runForm.channel === 'telegram' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="summary-bot-token">
                      {t('summaries.formBotToken', { defaultValue: 'Telegram bot token override' })}
                    </Label>
                    <Input
                      id="summary-bot-token"
                      value={runForm.botToken}
                      onChange={(event) => updateRunForm('botToken', event.target.value)}
                      placeholder="123456:ABCDEF"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary-chat-id">
                      {t('summaries.formChatId', { defaultValue: 'Telegram chat ID override' })}
                    </Label>
                    <Input
                      id="summary-chat-id"
                      value={runForm.chatId}
                      onChange={(event) => updateRunForm('chatId', event.target.value)}
                      placeholder="-1001234567890"
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleRunAction('preview')
                  }}
                  disabled={submitting}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {submittingPreview
                    ? t('summaries.previewSubmitting', { defaultValue: 'Previewing…' })
                    : t('summaries.previewAction', { defaultValue: 'Preview summary' })}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleRunAction('send')
                  }}
                  disabled={submitting}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {submittingSend
                    ? t('summaries.sendSubmitting', { defaultValue: 'Sending…' })
                    : t('summaries.sendAction', { defaultValue: 'Send summary' })}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('summaries.detailTitle', { defaultValue: 'Run detail' })}</CardTitle>
              <CardDescription>
                {t('summaries.detailDescription', {
                  defaultValue: 'Review the stored report window, delivery audit, and notes for the selected summary run.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailLoading ? (
                <div className="text-sm text-muted-foreground">{t('summaries.detailLoading', { defaultValue: 'Loading run detail…' })}</div>
              ) : !selectedRun ? (
                <div className="text-sm text-muted-foreground">{t('summaries.detailEmpty', { defaultValue: 'Select a run to inspect its detail.' })}</div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailStatus', { defaultValue: 'Status' })}</div>
                      <div className="mt-1"><Badge variant={getRunStatusVariant(selectedRun.status)}>{selectedRun.status}</Badge></div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailPeriod', { defaultValue: 'Period' })}</div>
                      <div className="mt-1 text-sm">{formatPeriodLabel(selectedRun.period)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailWindow', { defaultValue: 'Window' })}</div>
                      <div className="mt-1 text-sm">{selectedRun.windowStart} → {selectedRun.windowEnd}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailStarted', { defaultValue: 'Started' })}</div>
                      <div className="mt-1 text-sm">{formatTimestamp(selectedRun.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailFinished', { defaultValue: 'Finished' })}</div>
                      <div className="mt-1 text-sm">{formatTimestamp(selectedRun.finishedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailTrigger', { defaultValue: 'Trigger' })}</div>
                      <div className="mt-1 text-sm">{selectedRun.triggerSource}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailDelivery', { defaultValue: 'Delivery' })}</div>
                      <div className="mt-1 text-sm">{selectedRunSummary}</div>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparison', { defaultValue: 'Comparison' })}</div>
                      <div className="mt-1 text-sm">{selectedRunComparisonSummary}</div>
                    </div>
                  </div>

                  {selectedRun.report.comparison ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonWindow', { defaultValue: 'Previous period window' })}</div>
                      <div className="text-sm text-muted-foreground">
                        {selectedRun.report.comparison.previousWindow.startAt} → {selectedRun.report.comparison.previousWindow.endAt}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonShared', { defaultValue: 'Shared ingest deltas' })}</div>
                          <div className="mt-2 space-y-1 text-sm">
                            <div>{t('summaries.detailComparisonResumes', { defaultValue: 'New resumes' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.newResumes)}</div>
                            <div>{t('summaries.detailComparisonCompleted', { defaultValue: 'Completed tasks' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.collectionTasksCompleted)}</div>
                            <div>{t('summaries.detailComparisonFailed', { defaultValue: 'Failed tasks' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.sharedIngest.collectionTasksFailed)}</div>
                          </div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailComparisonWorkspace', { defaultValue: 'Workspace activity deltas' })}</div>
                          <div className="mt-2 space-y-1 text-sm">
                            <div>{t('summaries.detailComparisonStatus', { defaultValue: 'Candidate status updates' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.candidateStatusUpdates)}</div>
                            <div>{t('summaries.detailComparisonShortlist', { defaultValue: 'Shortlist actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.shortlistActions)}</div>
                            <div>{t('summaries.detailComparisonReject', { defaultValue: 'Reject actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.rejectActions)}</div>
                            <div>{t('summaries.detailComparisonContact', { defaultValue: 'Contact actions' })}: {formatDelta(selectedRun.report.comparison.totalsDelta.workspaceActivity.contactActions)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedRun.delivery?.accounts && selectedRun.delivery.accounts.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailAccounts', { defaultValue: 'Telegram accounts' })}</div>
                      <div className="space-y-2">
                        {selectedRun.delivery.accounts.map((account) => (
                          <div key={`${account.index}-${account.chatIdHint}`} className="rounded-md border p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{account.chatIdHint}</div>
                              <Badge variant={account.sent ? 'default' : account.attempted ? 'destructive' : 'outline'}>
                                {formatAccountStatus(account)}
                              </Badge>
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {t('summaries.detailBatches', { defaultValue: 'Planned batches' })}: {account.batchesPlanned}
                            </div>
                            {account.skippedReason ? (
                              <div className="mt-1 text-sm text-muted-foreground">
                                {t('summaries.detailSkipReason', { defaultValue: 'Skip reason' })}: {account.skippedReason}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedRun.report.notes.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailNotes', { defaultValue: 'Notes' })}</div>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {selectedRun.report.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {selectedRun.content ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('summaries.detailContent', { defaultValue: 'Rendered content' })}</div>
                      <pre className="max-h-[320px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{selectedRun.content}</pre>
                    </div>
                  ) : null}

                  {selectedRun.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      {selectedRun.error}
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
