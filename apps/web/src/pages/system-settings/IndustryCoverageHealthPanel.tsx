import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { reportUiError } from '@/lib/ui-error-reporting'
import {
  formatDate,
  formatRunLine,
  isCurrentMaintenanceFailure,
  parseCoverageSummary,
  PIPELINE_STATUS_LABELS,
  PIPELINE_STATUS_ORDER,
  PIPELINE_STATUS_TONES,
  type IndustryCoverageSummary,
} from './industry-verification-model'

/**
 * Operator health strip: proposal pipeline, empty-evidence bottleneck,
 * resume card coverage, and maintenance signal.
 */
export function IndustryCoverageHealthPanel({
  requestJson,
}: {
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<IndustryCoverageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await requestJson('/api/company-industry-coverage')
      const next = parseCoverageSummary(payload)
      if (!next) {
        setSummary(null)
        setError(
          t('industryEvidence.coverageParseFailed', {
            defaultValue: 'Coverage summary response was incomplete.',
          }),
        )
        return
      }
      setSummary(next)
    } catch (err) {
      reportUiError('Failed to load industry coverage summary', err)
      setSummary(null)
      setError(
        t('industryEvidence.coverageLoadFailed', {
          defaultValue: 'Failed to load coverage summary.',
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    void load()
  }, [load])

  const resumeRatio = summary
    ? summary.resumes.total > 0
      ? Math.round((summary.resumes.withVerifiedEvidence / summary.resumes.total) * 100)
      : 0
    : 0
  const evidenceRatio = summary
    ? summary.openTotal > 0
      ? Math.round((summary.openWithSources / summary.openTotal) * 100)
      : 0
    : 0

  return (
    <Card data-testid="industry-coverage-health">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>
            {t('industryEvidence.coverageTitle', {
              defaultValue: 'Coverage & research health',
            })}
          </CardTitle>
          <CardDescription>
            {t('industryEvidence.coverageDescription', {
              defaultValue:
                'Pipeline counts, open proposals with candidate sources, resume card coverage, and last maintenance signal. Empty ready-for-review does not mean research is done.',
            })}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          data-testid="industry-coverage-refresh"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive" data-testid="industry-coverage-error">
            {error}
          </p>
        ) : null}

        {summary?.emptyEvidenceBottleneck ? (
          <div
            className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            data-testid="industry-coverage-bottleneck-empty"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">
                {t('industryEvidence.coverageEmptyEvidenceTitle', {
                  defaultValue:
                    summary.openWithSources === 0
                      ? 'Bottleneck: open proposals have no candidate sources'
                      : 'Bottleneck: almost no open proposals have candidate sources',
                })}
              </p>
              <p className="text-amber-900/90">
                {t('industryEvidence.coverageEmptyEvidenceBody', {
                  defaultValue:
                    '{{withSources}} / {{openTotal}} open proposals have sources. Research is not filling evidence (check WEB_RESEARCH_ENABLED / WEB_RESEARCH_MARKET and Operations → Run maintenance).',
                  withSources: summary.openWithSources,
                  openTotal: summary.openTotal,
                })}
              </p>
            </div>
          </div>
        ) : null}

        {summary && !summary.emptyEvidenceBottleneck && summary.readyBacklogBottleneck ? (
          <div
            className="flex gap-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950"
            data-testid="industry-coverage-bottleneck-ready"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {t('industryEvidence.coverageReadyBacklogBody', {
                defaultValue:
                  'Ready-for-review is empty while backlog exists. Steward review is blocked until research produces durable sources.',
              })}
            </p>
          </div>
        ) : null}

        {summary &&
        isCurrentMaintenanceFailure(
          summary.maintenance.latest,
          summary.maintenance.lastFailed,
        ) ? (
          <div
            className="flex gap-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950"
            data-testid="industry-coverage-bottleneck-failed"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">
                {t('industryEvidence.coverageFailedTitle', {
                  defaultValue: 'Last maintenance failure',
                })}
              </p>
              <p className="font-mono text-xs">
                {formatRunLine(summary.maintenance.lastFailed)}
                {summary.maintenance.lastFailed?.failureMessage
                  ? ` — ${summary.maintenance.lastFailed.failureMessage}`
                  : ''}
              </p>
              {summary.maintenance.lastFailed?.operatorSummary ? (
                <p className="text-rose-900/90">{summary.maintenance.lastFailed.operatorSummary}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading && !summary ? (
          <p className="text-sm text-muted-foreground">
            {t('common.loading', { defaultValue: 'Loading…' })}
          </p>
        ) : summary ? (
          <>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('industryEvidence.coveragePipeline', { defaultValue: 'Review proposals' })}
              </p>
              <div
                className="flex flex-wrap gap-2"
                data-testid="industry-coverage-pipeline"
              >
                {PIPELINE_STATUS_ORDER.map((status) => {
                  const count = summary.proposalsByStatus[status] ?? 0
                  return (
                    <div
                      key={status}
                      className={`rounded-md border px-2.5 py-1.5 ${PIPELINE_STATUS_TONES[status]}`}
                      data-testid={`industry-coverage-status-${status}`}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">
                        {PIPELINE_STATUS_LABELS[status]}
                      </p>
                      <p className="text-lg font-semibold tabular-nums leading-tight">{count}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div
                className="rounded-lg border p-3"
                data-testid="industry-coverage-open-sources"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('industryEvidence.coverageOpenSources', {
                    defaultValue: 'Open proposals with sources',
                  })}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {summary.openWithSources}
                  <span className="text-base font-normal text-muted-foreground">
                    {' '}
                    / {summary.openTotal}
                  </span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      evidenceRatio === 0 && summary.openTotal > 0
                        ? 'bg-amber-500'
                        : 'bg-primary'
                    }`}
                    style={{ width: `${Math.min(100, evidenceRatio)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.openWithoutSources} without candidate sources ({evidenceRatio}% filled)
                </p>
              </div>

              <div
                className="rounded-lg border p-3"
                data-testid="industry-coverage-resumes"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('industryEvidence.coverageResumes', {
                    defaultValue: 'Resumes with verified evidence',
                  })}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {summary.resumes.withVerifiedEvidence}
                  <span className="text-base font-normal text-muted-foreground">
                    {' '}
                    / {summary.resumes.total}
                  </span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${Math.min(100, resumeRatio)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resumeRatio}% of digest cards show approved 行业验证
                </p>
              </div>

              <div
                className="rounded-lg border p-3"
                data-testid="industry-coverage-profiles"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('industryEvidence.coverageProfiles', {
                    defaultValue: 'Approved company truth',
                  })}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {summary.profiles.verified}
                  <span className="text-base font-normal text-muted-foreground">
                    {' '}
                    verified
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summary.profiles.rejected} rejected · {summary.profiles.total} profiles total
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2" data-testid="industry-coverage-maintenance">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('industryEvidence.coverageLastUseful', {
                    defaultValue: 'Last useful maintenance',
                  })}
                </p>
                <p className="mt-1 font-mono text-xs">
                  {formatRunLine(summary.maintenance.lastUseful)}
                </p>
                {summary.maintenance.lastUseful?.operatorSummary ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summary.maintenance.lastUseful.operatorSummary}
                  </p>
                ) : null}
                {summary.maintenance.lastUseful?.startedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(summary.maintenance.lastUseful.startedAt)}
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('industryEvidence.coverageLatestRun', {
                    defaultValue: 'Latest run',
                  })}
                </p>
                <p className="mt-1 font-mono text-xs">
                  {formatRunLine(summary.maintenance.latest)}
                </p>
                {summary.maintenance.latest?.partial ? <p className="mt-1 text-xs font-medium text-amber-800">Partial result — review failed/timeout targets before retrying.</p> : null}
                {summary.maintenance.latest?.operatorSummary ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summary.maintenance.latest.operatorSummary}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border p-3" data-testid="industry-coverage-research-queue">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Targeted research queue</p>
                <Badge variant={summary.researchQueue.needsIdentityReview > 0 ? 'secondary' : 'outline'}>
                  {summary.researchQueue.active} active
                </Badge>
              </div>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
                <span><strong>{summary.researchQueue.queued}</strong> queued</span>
                <span><strong>{summary.researchQueue.leased}</strong> researching</span>
                <span><strong>{summary.researchQueue.needsIdentityReview}</strong> identity review</span>
                <span><strong>{summary.researchQueue.failed}</strong> failed</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Priority lanes: {Object.entries(summary.researchQueue.byOrigin).map(([origin, count]) => `${origin.replace(/_/g, ' ')} ${count}`).join(' · ') || 'none'}.
              </p>
              {(summary.researchQueue.alerts.highRetryRate || summary.researchQueue.alerts.providerLimitedBacklog > 0 || summary.researchQueue.alerts.workerUnreachableRuns > 0) ? (
                <p className="mt-2 text-xs font-medium text-amber-800">
                  Queue alert: {summary.researchQueue.alerts.highRetryRate ? 'high retry rate · ' : ''}{summary.researchQueue.alerts.providerLimitedBacklog > 0 ? `${summary.researchQueue.alerts.providerLimitedBacklog} provider-limited · ` : ''}{summary.researchQueue.alerts.workerUnreachableRuns > 0 ? `${summary.researchQueue.alerts.workerUnreachableRuns} worker-unreachable run(s)` : ''}
                </p>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              {t('industryEvidence.coverageOpsHint', {
                defaultValue:
                  'To fill empty proposals: Operations → Industry evidence maintenance → Run maintenance now. Discovery needs WEB_RESEARCH_ENABLED=1 (and WEB_RESEARCH_MARKET=my for MY).',
              })}{' '}
              <Link
                to="../operations"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('industryEvidence.coverageOpsLink', { defaultValue: 'Open Operations' })}
              </Link>
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
