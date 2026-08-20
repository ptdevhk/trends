import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw } from 'lucide-react'
import { api } from '../../../../../packages/convex/convex/_generated/api'
import { SchedulerStatus } from '@/components/SchedulerStatus'
import { TaskMonitor } from '@/components/TaskMonitor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { SystemSummary } from '@/pages/system-settings/SystemSummary'
import { reportUiError } from '@/lib/ui-error-reporting'
import { fetchExtensionMetaJson } from '@/lib/external-fetch'

const EXTENSION_ZIP_URL = '/extension/trends-resume-collector-latest.zip'

type ExtensionMeta = { version: string }

function isExtensionMeta(value: unknown): value is ExtensionMeta {
  if (typeof value !== 'object' || value === null || !('version' in value)) return false
  return typeof (value as ExtensionMeta).version === 'string' && (value as ExtensionMeta).version.trim().length > 0
}

function useExtensionVersion() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const payload: unknown = await fetchExtensionMetaJson()
        if (!cancelled && isExtensionMeta(payload)) {
          setVersion(payload.version)
        }
      } catch (error) {
        reportUiError('Failed to load extension metadata', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return version
}

function IndustryMaintenanceCard({ requestJson }: { requestJson: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [lastRun, setLastRun] = useState<{ status: string; operatorSummary?: string; triggerSource?: string; startedAt?: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadLastRun = useCallback(async () => {
    try {
      const result = await requestJson('/api/company-industry-maintenance-runs?limit=1') as { items?: Array<{ status: string; operatorSummary?: string; triggerSource?: string; startedAt?: number }> }
      setLastRun(result?.items?.[0] ?? null)
    } catch (error) {
      reportUiError('Failed to load industry maintenance last run', error)
    }
  }, [requestJson])

  useEffect(() => {
    void loadLastRun()
  }, [loadLastRun])

  const handleRunNow = async () => {
    setBusy(true)
    try {
      const result = await requestJson('/api/worker/industry-maintenance', {
        method: 'POST',
        body: JSON.stringify({}),
      }) as { runId?: string | null; coalesced?: boolean }
      const runId = result?.runId ?? 'unknown'
      toast.success(t('operations.industryMaintenanceTriggered', { defaultValue: `Maintenance run ${runId} enqueued`, runId }))
      // Refresh last run after a short delay so the new run appears.
      setTimeout(() => { void loadLastRun() }, 2000)
    } catch (error) {
      reportUiError('Failed to trigger industry maintenance', error)
      toast.error(t('operations.industryMaintenanceTriggerFailed', { defaultValue: 'Failed to trigger maintenance' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="ops-industry-maintenance-card">
      <CardHeader>
        <CardTitle>{t('operations.industryMaintenanceTitle', { defaultValue: 'Industry evidence maintenance' })}</CardTitle>
        <CardDescription>
          {t('operations.industryMaintenanceDescription', {
            defaultValue: 'Research open proposals and refresh due approved sources.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Reserve the taller loaded info block so the no-history→loaded swap
            does not push the run button down (CLS). */}
        <div data-testid="ops-maintenance-info-reserve" className="min-h-16 space-y-1">
          {lastRun ? (
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">{t('operations.industryMaintenanceLastRun', { defaultValue: 'Last run' })}:</span>{' '}
                <span className="font-mono text-xs">{lastRun.status}</span>
                {lastRun.triggerSource ? ` · ${lastRun.triggerSource}` : ''}
              </p>
              {lastRun.operatorSummary ? <p className="text-muted-foreground">{lastRun.operatorSummary}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('operations.industryMaintenanceNoHistory', { defaultValue: 'No maintenance runs yet.' })}
            </p>
          )}
        </div>
        <Button
          data-testid="ops-run-industry-maintenance"
          onClick={() => { handleRunNow().catch((error) => reportUiError('Unexpected handleRunNow failure', error)) }}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {busy
            ? t('operations.industryMaintenanceRunning', { defaultValue: 'Running…' })
            : t('operations.industryMaintenanceRunNow', { defaultValue: 'Run maintenance now' })}
        </Button>
      </CardContent>
    </Card>
  )
}

function IndustryResearchQueueCard({ requestJson }: { requestJson: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<{ active: number; queued: number; leased: number; needsIdentityReview: number; failed: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const pending = requestJson('/api/company-industry-coverage')
    if (!pending || typeof (pending as Promise<unknown>).then !== 'function') {
      setLoading(false)
      return () => { cancelled = true }
    }
    void pending
      .then((payload) => {
        if (cancelled) return
        const value = payload as { item?: { researchQueue?: typeof queue } }
        const next = value?.item?.researchQueue
        if (next) setQueue(next)
      })
      .catch((error) => reportUiError('Failed to load targeted industry research queue', error))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [requestJson])

  return (
    <Card data-testid="ops-industry-research-queue-card">
      <CardHeader>
        <CardTitle>{t('industryEvidence.coverageTargetedQueue', { defaultValue: 'Targeted research queue' })}</CardTitle>
        <CardDescription>{t('industryEvidence.opsQueueDescription', { defaultValue: 'Exact user requests are leased and retried independently from broad maintenance sweeps.' })}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          // Same 5-column stats grid as the loaded state so the loading→loaded
          // swap never changes the card height (CLS).
          <div data-testid="ops-research-queue-loading" className="grid gap-2 text-sm sm:grid-cols-5">
            <span><strong>–</strong> {t('industryEvidence.queueActive', { defaultValue: 'active' })}</span>
            <span><strong>–</strong> {t('industryEvidence.queueQueued', { defaultValue: 'queued' })}</span>
            <span><strong>–</strong> {t('industryEvidence.queueLeased', { defaultValue: 'leased' })}</span>
            <span><strong>–</strong> {t('industryEvidence.queueIdentityReview', { defaultValue: 'identity review' })}</span>
            <span><strong>–</strong> {t('industryEvidence.queueFailed', { defaultValue: 'failed' })}</span>
          </div>
        ) : queue ? (
          <div className="grid gap-2 text-sm sm:grid-cols-5">
            <span><strong>{queue.active}</strong> {t('industryEvidence.queueActive', { defaultValue: 'active' })}</span>
            <span><strong>{queue.queued}</strong> {t('industryEvidence.queueQueued', { defaultValue: 'queued' })}</span>
            <span><strong>{queue.leased}</strong> {t('industryEvidence.queueLeased', { defaultValue: 'leased' })}</span>
            <span><strong>{queue.needsIdentityReview}</strong> {t('industryEvidence.queueIdentityReview', { defaultValue: 'identity review' })}</span>
            <span><strong>{queue.failed}</strong> {t('industryEvidence.queueFailed', { defaultValue: 'failed' })}</span>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t('industryEvidence.queueHealthUnavailable', { defaultValue: 'Queue health is unavailable.' })}</p>}
      </CardContent>
    </Card>
  )
}

export function SystemSettingsOperationsPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const dispatchCollection = useMutation(api.resume_tasks.dispatch)
  const extensionVersion = useExtensionVersion()

  const [collectionKeyword, setCollectionKeyword] = useState('')
  const [collectionLocation, setCollectionLocation] = useState('广东')
  const [collectionLimit, setCollectionLimit] = useState('200')
  const [collectionMaxPages, setCollectionMaxPages] = useState('10')

  async function handleStartCollection() {
    if (!collectionKeyword.trim()) {
      toast.error(t('debugConfig.collectionKeywordRequired', { defaultValue: 'Please enter a keyword' }))
      return
    }

    try {
      const limit = parseInt(collectionLimit, 10) || 200
      const maxPages = parseInt(collectionMaxPages, 10) || 10

      await dispatchCollection({
        keyword: collectionKeyword.trim(),
        location: collectionLocation.trim(),
        limit,
        maxPages,
      })
      toast.success(t('debugConfig.collectionTaskDispatched', { defaultValue: 'Collection task dispatched' }))
      setCollectionKeyword('')
    } catch (error) {
      reportUiError('Failed to dispatch collection', error)
      toast.error(t('debugConfig.collectionTaskFailed', { defaultValue: 'Failed to start collection' }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('debugConfig.settingsNavOperations', { defaultValue: 'Operations' })}</h2>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.operationsPageDescription', {
            defaultValue: 'Live diagnostics and manual collection controls.',
          })}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SystemSummary />
        <SchedulerStatus />
      </div>

      <div data-testid="extension-card-reserve" className="min-h-20">
        {extensionVersion && (
          <Card className="border-dashed">
            <CardContent className="flex items-center gap-3 py-4">
              <Download className="h-4 w-4 text-muted-foreground" />
              <a
                href={EXTENSION_ZIP_URL}
                className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
              >
                {t('quickStart.downloadExtension', { version: extensionVersion })}
              </a>
            </CardContent>
          </Card>
        )}
      </div>

      <IndustryMaintenanceCard requestJson={requestJson} />
      <IndustryResearchQueueCard requestJson={requestJson} />

      <Card>
        <CardHeader>
          <CardTitle>{t('debugConfig.resumeDataCollection')}</CardTitle>
          <CardDescription>{t('debugConfig.resumeDataCollectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="col-keyword" className="text-sm font-medium">{t('debugConfig.keyword')}</label>
              <Input
                id="col-keyword"
                data-testid="ops-collection-keyword"
                placeholder={t('debugConfig.keywordPlaceholder')}
                value={collectionKeyword}
                onChange={(event) => setCollectionKeyword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-location" className="text-sm font-medium">{t('debugConfig.location')}</label>
              <Input
                id="col-location"
                data-testid="ops-collection-location"
                placeholder={t('debugConfig.locationPlaceholder')}
                value={collectionLocation}
                onChange={(event) => setCollectionLocation(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-limit" className="text-sm font-medium">{t('debugConfig.limitResumes')}</label>
              <Input
                id="col-limit"
                data-testid="ops-collection-limit"
                type="number"
                placeholder="200"
                value={collectionLimit}
                onChange={(event) => setCollectionLimit(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="col-max-pages" className="text-sm font-medium">{t('debugConfig.maxPages')}</label>
              <Input
                id="col-max-pages"
                data-testid="ops-collection-max-pages"
                type="number"
                placeholder="10"
                value={collectionMaxPages}
                onChange={(event) => setCollectionMaxPages(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </div>
          </div>
          <Button
            data-testid="ops-start-collection"
            onClick={() => {
              handleStartCollection().catch((error) => {
                reportUiError('Unexpected handleStartCollection failure', error)
              })
            }}
            className="w-full sm:w-auto"
          >
            {t('debugConfig.startCollection')}
          </Button>

          {/* Reserve the "All tasks completed" card height so the TaskMonitor
              null→card flip never pushes content below it (CLS). */}
          <div data-testid="task-monitor-reserve" className="mt-6 min-h-14">
            <TaskMonitor />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
