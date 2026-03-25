import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { rawApiClient } from '@/lib/api-helpers'
import type { paths } from '@/lib/api-types'

type SummaryRunListResponse = paths['/api/summaries/runs']['get']['responses'][200]['content']['application/json']
type SummaryRunDetailResponse = paths['/api/summaries/runs/{runId}']['get']['responses'][200]['content']['application/json']
type SummaryRunItem = SummaryRunListResponse['items'][number]
type SummaryRunDetailItem = SummaryRunDetailResponse['item']
type SummaryDelivery = NonNullable<SummaryRunDetailItem['delivery']>
type SummaryDeliveryAccount = NonNullable<SummaryDelivery['accounts']>[number]

const SUMMARY_RUN_LIST_LIMIT = 20

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

export function SummaryRunsPage() {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<SummaryRunItem[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<SummaryRunDetailItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

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
                  </div>

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
