import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
  isExplicitCncEvidenceSource,
  type IndustryReviewAttestation,
  type IndustryReviewRecommendation,
  type IndustryReviewWarning,
} from '@trends/shared'
import type { paths } from '@/lib/api-types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'

type ProposalListResponse = paths['/api/company-industry-proposals']['get']['responses'][200]['content']['application/json']
type IndustryProposal = ProposalListResponse['items'][number]
type EvidenceSourceListResponse = paths['/api/company-industry-evidence-sources']['get']['responses'][200]['content']['application/json']
type EvidenceSource = EvidenceSourceListResponse['items'][number]
type IndustryBundleResponse = paths['/api/company-industry-bundles/:companyKey']['get']['responses'][200]['content']['application/json']
type IndustryBundle = Pick<IndustryBundleResponse, 'profile' | 'revisions' | 'sources'>
type IndustryRevision = IndustryBundle['revisions'][number]
type IndustryRecomputeListResponse = paths['/api/company-industry-recompute-runs']['get']['responses'][200]['content']['application/json']
type IndustryRecomputeRun = IndustryRecomputeListResponse['items'][number]
type IndustryClass = NonNullable<IndustryProposal['suggestedIndustryClass']>
type VerificationLevel = Extract<NonNullable<IndustryProposal['suggestedVerificationLevel']>, 'verified' | 'rejected'>
type ReviewQueueStatus = IndustryProposal['status']

type ReviewQueueResponse = paths['/api/company-industry-proposals/review-queue']['get']['responses'][200]['content']['application/json']
type ReviewQueueItem = ReviewQueueResponse['items'][number]
type ReviewPacketResponse = paths['/api/company-industry-proposals/:proposalId/review-packet']['get']['responses'][200]['content']['application/json']
type ReviewContext = Pick<ReviewPacketResponse['reviewContext'], 'profile' | 'revisions'>
type ReviewPacket = Pick<ReviewPacketResponse, 'proposal' | 'recommendation' | 'warnings' | 'dataset' | 'sources' | 'reviewContext' | 'recomputeRuns'>
type DetailBundle = ReviewContext

const REVIEW_RISK_FLAG_LABELS: Record<string, string> = {
  canonical_mapping_missing: 'canonical company mapping is missing',
  only_discovery_sources: 'only discovery sources are attached',
  source_conflict: 'sources conflict on the industry class',
  weak_industry_signal: 'the industry signal is weak',
  cnc_claim_inferred: 'the CNC claim is inferred from keywords',
  stale_or_failed_source: 'a source is stale, unavailable, or failed',
  low_source_diversity: 'source diversity is low',
  worker_unreachable: 'the evidence worker was unreachable',
  recompute_pending: 'a targeted recompute is pending',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItems<T>(value: unknown): T[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items as T[]
}

function parseBundle(value: unknown): IndustryBundle {
  if (!isRecord(value)) return { profile: null, revisions: [], sources: [] }
  return {
    profile: isRecord(value.profile) ? value.profile as IndustryBundle['profile'] : null,
    revisions: Array.isArray(value.revisions) ? value.revisions as IndustryRevision[] : [],
    sources: Array.isArray(value.sources) ? value.sources as EvidenceSource[] : [],
  }
}

function parseReviewContext(value: unknown): DetailBundle {
  if (!isRecord(value)) return { profile: null, revisions: [] }
  return {
    profile: isRecord(value.profile) ? value.profile as DetailBundle['profile'] : null,
    revisions: Array.isArray(value.revisions) ? value.revisions as DetailBundle['revisions'] : [],
  }
}

function parseReviewQueue(value: unknown): ReviewQueueItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.filter((item): item is ReviewQueueItem => {
    if (!isRecord(item) || !isRecord(item.proposal) || !isRecord(item.recommendation)) return false
    return typeof item.proposal.proposalId === 'string'
      && typeof item.recommendation.proposalId === 'string'
  }) as ReviewQueueItem[]
}

function parseReviewPacket(value: unknown): ReviewPacket | null {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.recommendation)) return null
  if (!isRecord(value.dataset) || typeof value.dataset.inputFingerprint !== 'string') return null
  return {
    proposal: value.proposal as IndustryProposal,
    recommendation: value.recommendation as unknown as IndustryReviewRecommendation,
    warnings: Array.isArray(value.warnings) ? value.warnings as IndustryReviewWarning[] : [],
    dataset: {
      revision: typeof value.dataset.revision === 'string' ? value.dataset.revision : '',
      inputFingerprint: value.dataset.inputFingerprint,
      generatedAt: typeof value.dataset.generatedAt === 'number' ? value.dataset.generatedAt : 0,
      proposalUpdatedAt: typeof value.dataset.proposalUpdatedAt === 'number' ? value.dataset.proposalUpdatedAt : 0,
      sourceVersions: Array.isArray(value.dataset.sourceVersions)
        ? value.dataset.sourceVersions.filter((item): item is { sourceId: string; updatedAt: number } => (
          isRecord(item) && typeof item.sourceId === 'string' && typeof item.updatedAt === 'number'
        ))
        : [],
    },
    sources: parseItems<EvidenceSource>({ items: value.sources }),
    reviewContext: parseReviewContext(value.reviewContext ?? value.bundle),
    recomputeRuns: parseItems<IndustryRecomputeRun>({ items: value.recomputeRuns }),
  }
}

function displayCompany(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

function formatDate(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function createRevisionId(companyKey: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `industry-${companyKey}-${suffix}`
}

type MaintenanceRun = {
  runId: string
  triggerSource?: string
  status?: string
  operatorSummary?: string
  startedAt?: number
}

type MaintenanceLedgerRow = {
  proposalId: string
  action: string
  reason: string
  companyKey?: string
}

const LEDGER_ACTION_TONES: Record<string, string> = {
  ready: 'bg-green-100 text-green-800',
  demoted: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  needs_more_evidence: 'bg-amber-100 text-amber-800',
}

type ReviewedProfileSummary = {
  companyKey: string
  companyName?: string
  verificationLevel?: string
  industryClass?: string
}

type CoverageMaintenanceRun = {
  runId: string
  status?: string
  triggerSource?: string
  triggerContext?: string
  operatorSummary?: string
  failureMessage?: string
  startedAt?: number
  finishedAt?: number
  counts: {
    proposalsResearched: number
    readyCreated: number
    sourcesDemoted: number
    freshnessChecked: number
    freshnessRefreshed: number
    errors: number
  }
}

type IndustryCoverageSummary = {
  generatedAt: number
  workspaceSlug: string
  proposalsByStatus: Record<string, number>
  openTotal: number
  openWithSources: number
  openWithoutSources: number
  emptyEvidenceBottleneck: boolean
  readyBacklogBottleneck: boolean
  resumes: {
    total: number
    withVerifiedEvidence: number
  }
  profiles: {
    total: number
    verified: number
    rejected: number
  }
  maintenance: {
    latest: CoverageMaintenanceRun | null
    lastUseful: CoverageMaintenanceRun | null
    lastFailed: CoverageMaintenanceRun | null
  }
}

const PIPELINE_STATUS_ORDER = [
  'new',
  'researching',
  'ready_for_review',
  'needs_more_evidence',
  'approved',
  'rejected',
] as const

const PIPELINE_STATUS_LABELS: Record<(typeof PIPELINE_STATUS_ORDER)[number], string> = {
  new: 'new',
  researching: 'researching',
  ready_for_review: 'ready',
  needs_more_evidence: 'needs evidence',
  approved: 'approved',
  rejected: 'rejected',
}

const PIPELINE_STATUS_TONES: Record<(typeof PIPELINE_STATUS_ORDER)[number], string> = {
  new: 'border-slate-300 bg-slate-50 text-slate-800',
  researching: 'border-sky-300 bg-sky-50 text-sky-900',
  ready_for_review: 'border-green-300 bg-green-50 text-green-900',
  needs_more_evidence: 'border-amber-300 bg-amber-50 text-amber-900',
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  rejected: 'border-rose-300 bg-rose-50 text-rose-900',
}

function parseCoverageSummary(value: unknown): IndustryCoverageSummary | null {
  if (!isRecord(value)) return null
  const item = isRecord(value.item) ? value.item : value
  if (!isRecord(item)) return null
  if (typeof item.generatedAt !== 'number' || typeof item.openTotal !== 'number') return null
  if (!isRecord(item.resumes) || !isRecord(item.profiles) || !isRecord(item.maintenance)) return null
  return item as unknown as IndustryCoverageSummary
}

function formatRunLine(run: CoverageMaintenanceRun | null | undefined): string {
  if (!run) return '—'
  const parts = [
    run.status ?? 'unknown',
    run.triggerSource ? `· ${run.triggerSource}` : null,
    run.counts
      ? `· researched ${run.counts.proposalsResearched}, ready ${run.counts.readyCreated}`
      : null,
  ].filter(Boolean)
  return parts.join(' ')
}

function isCurrentMaintenanceFailure(
  latest: CoverageMaintenanceRun | null,
  lastFailed: CoverageMaintenanceRun | null,
): boolean {
  if (!lastFailed) return false
  // `lastFailed` is historical by design. Only surface the red alert when
  // that failed run is still the latest run; a newer completed run means the
  // failure has been superseded and remains available in run history.
  return latest === null || latest.runId === lastFailed.runId
}

/**
 * Operator health strip: proposal pipeline, empty-evidence bottleneck,
 * resume card coverage, and maintenance signal.
 */
function CoverageHealthPanel({
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
                {summary.maintenance.latest?.operatorSummary ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {summary.maintenance.latest.operatorSummary}
                  </p>
                ) : null}
              </div>
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

/**
 * Read-only lookup for already-approved (or rejected) company truth.
 * Uses the same company-industry-bundles path the proposal detail pane uses.
 * Does not open the attended approval controls.
 */
function ApprovedProfileLookup({
  requestJson,
}: {
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookedUpKey, setLookedUpKey] = useState<string | null>(null)
  const [bundle, setBundle] = useState<IndustryBundle>({ profile: null, revisions: [], sources: [] })
  const [approvedList, setApprovedList] = useState<ReviewedProfileSummary[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // Prefer verified profiles for the quick picker; fall back to full list.
        const payload = await requestJson('/api/company-industry-profiles?verificationLevel=verified')
        const items = parseItems<ReviewedProfileSummary>(payload)
        if (!cancelled) setApprovedList(items)
      } catch (err) {
        reportUiError('Failed to load approved industry profiles', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [requestJson])

  const runLookup = useCallback(
    async (rawKey: string) => {
      const companyKey = rawKey.trim()
      if (!companyKey) {
        toast.error(
          t('industryEvidence.lookupKeyRequired', {
            defaultValue: 'Enter a companyKey (e.g. eonmetall-group)',
          }),
        )
        return
      }
      setLoading(true)
      setError(null)
      try {
        const payload = await requestJson(
          `/api/company-industry-bundles/${encodeURIComponent(companyKey)}`,
        )
        const next = parseBundle(payload)
        if (!next.profile && next.revisions.length === 0 && next.sources.length === 0) {
          setBundle({ profile: null, revisions: [], sources: [] })
          setLookedUpKey(companyKey)
          setError(
            t('industryEvidence.lookupEmpty', {
              defaultValue: `No profile, revisions, or sources for “${companyKey}”.`,
              companyKey,
            }),
          )
          return
        }
        setBundle(next)
        setLookedUpKey(companyKey)
      } catch (err) {
        reportUiError('Failed to look up industry profile bundle', err)
        setError(
          t('industryEvidence.lookupFailed', {
            defaultValue: 'Lookup failed — check companyKey and try again.',
          }),
        )
        setBundle({ profile: null, revisions: [], sources: [] })
        setLookedUpKey(companyKey)
      } finally {
        setLoading(false)
      }
    },
    [requestJson, t],
  )

  const approvedSources = useMemo(
    () =>
      bundle.sources.filter(
        (s) => s.reviewStatus === 'approved' || s.sourceState === 'active',
      ),
    [bundle.sources],
  )

  return (
    <Card data-testid="industry-approved-profile-lookup">
      <CardHeader>
        <CardTitle>
          {t('industryEvidence.approvedLookupTitle', {
            defaultValue: 'Approved profiles / companyKey lookup',
          })}
        </CardTitle>
        <CardDescription>
          {t('industryEvidence.approvedLookupDescription', {
            defaultValue:
              'Inspect current truth for an employer that is not in the ready-for-review queue (e.g. MY bootstrap). Same bundle API as proposal detail — read-only.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            // Prefer the live DOM value so browser automation / paste still works
            // even when controlled-state onChange is skipped.
            const form = event.currentTarget
            const raw =
              new FormData(form).get('companyKey')?.toString()
              ?? query
            setQuery(raw)
            void runLookup(raw)
          }}
        >
          <Input
            name="companyKey"
            data-testid="industry-lookup-company-key"
            aria-label="companyKey"
            placeholder="eonmetall-group"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-[16rem] flex-1 font-mono text-sm"
          />
          <Button
            type="submit"
            data-testid="industry-lookup-submit"
            disabled={loading}
          >
            {loading
              ? t('common.loading', { defaultValue: 'Loading…' })
              : t('industryEvidence.lookup', { defaultValue: 'Lookup' })}
          </Button>
        </form>

        {approvedList.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('industryEvidence.verifiedQuickPick', {
                defaultValue: 'Verified profiles',
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {approvedList.slice(0, 24).map((profile) => (
                <Button
                  key={profile.companyKey}
                  type="button"
                  size="sm"
                  variant={lookedUpKey === profile.companyKey ? 'default' : 'outline'}
                  data-testid={`industry-lookup-chip-${profile.companyKey}`}
                  className="font-mono text-xs"
                  onClick={() => {
                    setQuery(profile.companyKey)
                    void runLookup(profile.companyKey)
                  }}
                >
                  {profile.companyKey}
                  {profile.industryClass ? (
                    <Badge variant="secondary" className="ml-2">
                      {profile.industryClass}
                    </Badge>
                  ) : null}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="industry-lookup-error">
            {error}
          </p>
        )}

        {lookedUpKey && !error && (
          <div className="space-y-4" data-testid="industry-lookup-result">
            <div className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">companyKey</p>
                <p className="mt-1 break-all font-mono text-xs">{lookedUpKey}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current verdict</p>
                <p className="mt-1 font-medium">
                  {bundle.profile?.verificationLevel ?? 'No approved revision'}
                  {bundle.profile?.industryClass
                    ? ` · ${bundle.profile.industryClass}`
                    : ''}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current revision</p>
                <p className="mt-1 break-all font-mono text-xs">
                  {bundle.profile?.currentRevisionId ?? '—'}
                </p>
              </div>
            </div>

            {(() => {
              const profileAny = bundle.profile as { summary?: string; evidenceSummary?: string } | null
              const summary =
                bundle.revisions[0]?.evidenceSummary
                ?? profileAny?.evidenceSummary
                ?? profileAny?.summary
              return summary ? (
                <p className="text-sm leading-6 text-muted-foreground" data-testid="industry-lookup-summary">
                  {summary}
                </p>
              ) : null
            })()}

            <div>
              <p className="mb-2 text-sm font-medium">
                {t('industryEvidence.lookupSources', {
                  defaultValue: 'Evidence sources',
                })}{' '}
                <span className="font-normal text-muted-foreground">
                  ({approvedSources.length || bundle.sources.length})
                </span>
              </p>
              {(approvedSources.length ? approvedSources : bundle.sources).length === 0 ? (
                <p className="text-sm text-muted-foreground">No sources on this profile.</p>
              ) : (
                <div className="space-y-2">
                  {(approvedSources.length ? approvedSources : bundle.sources).map((source) => (
                    <div
                      key={source.sourceId}
                      className="rounded-lg border p-3 text-sm"
                      data-testid={`industry-lookup-source-${source.sourceId}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{source.title ?? source.sourceDomain}</span>
                        <Badge variant="outline">{source.sourceType}</Badge>
                        <Badge variant="secondary">{source.trustTier}</Badge>
                        {source.reviewStatus && (
                          <Badge variant="outline">{source.reviewStatus}</Badge>
                        )}
                      </div>
                      {source.evidenceExcerpt && (
                        <p className="mt-1 text-muted-foreground">{source.evidenceExcerpt}</p>
                      )}
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {source.url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {bundle.revisions.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  {t('industryEvidence.revisionHistory', {
                    defaultValue: 'Revision history',
                  })}
                </p>
                <div className="space-y-2">
                  {bundle.revisions.map((revision) => (
                    <div key={revision.revisionId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <Badge>{revision.verificationLevel}</Badge>
                        <Badge variant="outline">{revision.industryClass}</Badge>
                        <span className="break-all font-mono text-xs">{revision.revisionId}</span>
                      </div>
                      <p className="mt-2 text-sm">{revision.evidenceSummary}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {revision.reviewedBy} · {formatDate(revision.reviewedAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function IndustryMaintenanceHistory({ requestJson }: { requestJson: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<MaintenanceRun[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<MaintenanceLedgerRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await requestJson('/api/company-industry-maintenance-runs?limit=20') as { items?: MaintenanceRun[] }
        if (!cancelled) setRuns(result?.items ?? [])
      } catch (error) {
        reportUiError('Failed to load industry maintenance history', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [requestJson])

  const toggleRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
      return
    }
    setExpandedRunId(runId)
    setLedger([])
    try {
      const result = await requestJson(`/api/company-industry-maintenance-runs/${encodeURIComponent(runId)}/ledger`) as { items?: MaintenanceLedgerRow[] }
      setLedger(result?.items ?? [])
    } catch (error) {
      reportUiError('Failed to load maintenance ledger', error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('industryEvidence.runHistory', { defaultValue: 'Maintenance run history' })}</CardTitle>
        <CardDescription>
          {t('industryEvidence.runHistoryDescription', {
            defaultValue: 'Recent industry-evidence maintenance runs. Expand a row to see why each employer did or did not surface.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('industryEvidence.runHistoryEmpty', { defaultValue: 'No maintenance runs recorded yet.' })}
          </p>
        ) : runs.map((run) => (
          <div key={run.runId} className="rounded-lg border">
            <button
              type="button"
              onClick={() => void toggleRun(run.runId)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left"
            >
              <div>
                <p className="font-medium">
                  <span className="font-mono text-xs">{run.status ?? '-'}</span>
                  {run.triggerSource ? ` · ${run.triggerSource}` : ''}
                </p>
                {run.operatorSummary ? <p className="text-xs text-muted-foreground">{run.operatorSummary}</p> : null}
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
            </button>
            {expandedRunId === run.runId && (
              <div className="border-t p-3 space-y-1">
                {ledger.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ledger rows.</p>
                ) : ledger.map((row, idx) => (
                  <div key={`${row.proposalId}-${idx}`} className="flex items-start gap-2 text-xs">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-mono ${LEDGER_ACTION_TONES[row.action] ?? 'bg-gray-100 text-gray-800'}`}>
                      {row.action}
                    </span>
                    <span className="text-muted-foreground">{row.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function SystemSettingsIndustryVerificationPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [searchParams, setSearchParams] = useSearchParams()
  const [requestedProposalId] = useState(() => searchParams.get('proposalId')?.trim() || undefined)
  const [queueStatus, setQueueStatus] = useState<ReviewQueueStatus>(() => {
    const value = searchParams.get('status')
    return value === 'new' || value === 'researching' || value === 'ready_for_review' || value === 'needs_more_evidence'
      ? value
      : 'ready_for_review'
  })
  const [riskFilter, setRiskFilter] = useState<string>('')
  const [confidenceFilter, setConfidenceFilter] = useState<string>('')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [nextQueueCursor, setNextQueueCursor] = useState<string>()
  const [proposals, setProposals] = useState<IndustryProposal[]>([])
  const [queueRecommendations, setQueueRecommendations] = useState<Record<string, IndustryReviewRecommendation>>({})
  const [selectedProposalId, setSelectedProposalId] = useState<string>()
  const [sources, setSources] = useState<EvidenceSource[]>([])
  const [bundle, setBundle] = useState<DetailBundle>({ profile: null, revisions: [] })
  const [recomputeRuns, setRecomputeRuns] = useState<IndustryRecomputeRun[]>([])
  const [recommendation, setRecommendation] = useState<IndustryReviewRecommendation | null>(null)
  const [reviewWarnings, setReviewWarnings] = useState<IndustryReviewWarning[]>([])
  const [reviewDataset, setReviewDataset] = useState<ReviewPacket['dataset'] | null>(null)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [industryClass, setIndustryClass] = useState<IndustryClass>('unknown')
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('verified')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [taxonomyVersion, setTaxonomyVersion] = useState('industry-v1')
  const [reviewNote, setReviewNote] = useState('')
  const [acknowledgedRiskFlags, setAcknowledgedRiskFlags] = useState<string[]>([])
  const [cncEvidenceAcknowledged, setCncEvidenceAcknowledged] = useState(false)
  const [acknowledgementReason, setAcknowledgementReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [approvalConfirmOpen, setApprovalConfirmOpen] = useState(false)

  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.proposalId === selectedProposalId),
    [proposals, selectedProposalId],
  )

  const recommendationSummary = useMemo(() => {
    return Object.values(queueRecommendations).reduce(
      (summary, item) => {
        if (item.recommendedAction === 'approve') summary.approve += 1
        if (item.recommendedAction === 'needs_more_evidence') summary.needsEvidence += 1
        if (item.recommendedAction === 'inspect') summary.inspect += 1
        return summary
      },
      { approve: 0, needsEvidence: 0, inspect: 0 },
    )
  }, [queueRecommendations])

  const loadQueue = useCallback(async (cursor?: string, append = false) => {
    setLoading(true)
    try {
      const query = new URLSearchParams({ status: queueStatus, limit: '100' })
      if (cursor) query.set('cursor', cursor)
      if (riskFilter) query.set('riskFlag', riskFilter)
      if (confidenceFilter) query.set('confidenceBand', confidenceFilter)
      if (actionFilter) query.set('recommendedAction', actionFilter)
      const payload = await requestJson(`/api/company-industry-proposals/review-queue?${query.toString()}`)
      const queue = parseReviewQueue(payload)
      const next = queue.map((item) => item.proposal)
      const nextRecommendations = Object.fromEntries(
        queue.map((item) => [item.proposal.proposalId, item.recommendation]),
      )
      setQueueRecommendations((current) => append ? { ...current, ...nextRecommendations } : nextRecommendations)
      setProposals((current) => append
        ? [...current, ...next.filter((proposal) => !current.some((item) => item.proposalId === proposal.proposalId))]
        : next)
      setNextQueueCursor(isRecord(payload) && typeof payload.nextCursor === 'string' ? payload.nextCursor : undefined)
      const nextSelection = requestedProposalId && next.some((proposal) => proposal.proposalId === requestedProposalId)
        ? requestedProposalId
        : undefined
      setSelectedProposalId((current) => (
        nextSelection
          ?? (append && current
            ? current
            : current && next.some((proposal) => proposal.proposalId === current)
            ? current
            : next[0]?.proposalId)
      ))
    } catch (error) {
      reportUiError('Failed to load industry evidence proposal queue', error)
      toast.error(t('industryEvidence.queueLoadFailed', { defaultValue: 'Failed to load industry evidence queue' }))
    } finally {
      setLoading(false)
    }
  }, [actionFilter, confidenceFilter, queueStatus, requestJson, requestedProposalId, riskFilter, t])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (!selectedProposal) {
      setSources([])
      setBundle({ profile: null, revisions: [] })
      setRecomputeRuns([])
      setRecommendation(null)
      setReviewWarnings([])
      setReviewDataset(null)
      setSelectedSourceIds([])
      setApprovalConfirmOpen(false)
      return
    }
    let cancelled = false
    const loadDetail = async () => {
      try {
        const packetPayload = await requestJson(
          `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/review-packet`,
        )
        const packet = parseReviewPacket(packetPayload)
        if (!packet) throw new Error('Invalid industry review packet')
        if (cancelled) return
        const nextSources = packet.sources
        const nextBundle = packet.reviewContext ?? { profile: null, revisions: [] }
        setSources(nextSources)
        setBundle(nextBundle)
        setRecomputeRuns(packet.recomputeRuns)
        setRecommendation(packet.recommendation)
        setReviewWarnings(packet.warnings)
        setReviewDataset(packet.dataset)
        const approvalSafeSourceIds = new Set(
          packet.recommendation.sourceDecisions
            .filter((decision) => decision.approvalSafe)
            .map((decision) => decision.sourceId),
        )
        setSelectedSourceIds(
          packet.recommendation.recommendedSourceIds.length > 0
            ? packet.recommendation.recommendedSourceIds
            : nextSources
              .filter((source) => approvalSafeSourceIds.has(source.sourceId))
              .map((source) => source.sourceId),
        )
        setIndustryClass(packet.recommendation.recommendedIndustryClass ?? selectedProposal.suggestedIndustryClass ?? nextBundle.profile?.industryClass ?? 'unknown')
        setVerificationLevel(
          packet.recommendation.recommendedVerificationLevel === 'rejected' ? 'rejected' : 'verified',
        )
        setEvidenceSummary(
          packet.recommendation.evidenceSummaryDraft
          || selectedProposal.materialChangeSummary
          || nextBundle.revisions[0]?.evidenceSummary
          || '',
        )
        setDecisionReason(packet.recommendation.decisionReasonDraft)
        setReviewNote('')
        setAcknowledgedRiskFlags([])
        setCncEvidenceAcknowledged(false)
        setAcknowledgementReason('')
        setApprovalConfirmOpen(false)
      } catch (error) {
        reportUiError('Failed to load industry evidence proposal detail', error)
        toast.error(t('industryEvidence.detailLoadFailed', { defaultValue: 'Failed to load proposal evidence' }))
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [requestJson, selectedProposal, t])

  function validateApprovalInputs(): boolean {
    if (!selectedProposal?.companyKey) {
      toast.error(t('industryEvidence.companyRequired', { defaultValue: 'Map this proposal to a canonical company first' }))
      return false
    }
    if (selectedSourceIds.length === 0 || !evidenceSummary.trim() || !decisionReason.trim()) {
      toast.error(t('industryEvidence.reviewFieldsRequired', { defaultValue: 'Select evidence and complete the review summary and reason' }))
      return false
    }
    const visibleRiskFlags = recommendation?.riskFlags ?? []
    const nonOverridableRiskFlags = recommendation?.riskDecision?.nonOverridableRiskFlags ?? []
    if (nonOverridableRiskFlags.length > 0) {
      toast.error(
        t('industryEvidence.hardRiskBlocksApproval', {
          defaultValue: 'This recommendation has a hard evidence block; request evidence or resolve the source issue first.',
        }),
      )
      return false
    }
    const allRisksAcknowledged = visibleRiskFlags.every((flag) => acknowledgedRiskFlags.includes(flag))
    if (visibleRiskFlags.length > 0 && (!allRisksAcknowledged || !acknowledgementReason.trim())) {
      toast.error(
        t('industryEvidence.riskAcknowledgementRequired', {
          defaultValue: 'Acknowledge every visible risk flag and provide a detailed reason before approving.',
        }),
      )
      return false
    }
    if (industryClass === 'cnc') {
      const explicitCncEvidence = sources.some((source) => isExplicitCncEvidenceSource(source))
      if (!explicitCncEvidence) {
        toast.error(
          t('industryEvidence.cncEvidenceRequired', {
            defaultValue: 'CNC approval requires explicit industrial evidence; keyword or discovery matches are not enough.',
          }),
        )
        return false
      }
      if (!cncEvidenceAcknowledged) {
        toast.error(
          t('industryEvidence.cncAcknowledgementRequired', {
            defaultValue: 'Confirm that you reviewed the explicit CNC evidence before approving.',
          }),
        )
        return false
      }
    }
    return true
  }

  async function approveRevision() {
    if (!validateApprovalInputs() || !selectedProposal?.companyKey) return
    setSaving(true)
    try {
      const visibleRiskFlags = recommendation?.riskFlags ?? []
      const requiresAttestation = visibleRiskFlags.length > 0 || industryClass === 'cnc'
      const reviewAttestation: IndustryReviewAttestation | undefined = requiresAttestation
        ? {
            schemaVersion: INDUSTRY_REVIEW_ATTESTATION_SCHEMA_VERSION,
            inputFingerprint: reviewDataset?.inputFingerprint ?? '',
            decisionMode: visibleRiskFlags.length > 0 ? 'risk_override' : 'standard',
            acknowledgedRiskFlags: acknowledgedRiskFlags as IndustryReviewAttestation['acknowledgedRiskFlags'],
            cncEvidenceAcknowledged,
            acknowledgementReason: acknowledgementReason.trim(),
          }
        : undefined
      const response = await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            revisionId: createRevisionId(selectedProposal.companyKey),
            expectedCurrentRevisionId: bundle.profile?.currentRevisionId,
            expectedProposalUpdatedAt: reviewDataset?.proposalUpdatedAt ?? selectedProposal.updatedAt,
            expectedInputFingerprint: reviewDataset?.inputFingerprint,
            expectedSourceVersions: reviewDataset?.sourceVersions,
            ...(reviewAttestation ? { reviewAttestation } : {}),
            verificationLevel,
            industryClass,
            approvedSourceIds: selectedSourceIds,
            evidenceSummary: evidenceSummary.trim(),
            decisionReason: decisionReason.trim(),
            taxonomyVersion: taxonomyVersion.trim(),
          }),
        },
      )
      if (isRecord(response) && isRecord(response.recompute)) {
        const recompute = response.recompute as unknown as IndustryRecomputeRun
        setRecomputeRuns((current) => [
          recompute,
          ...current.filter((run) => run.runId !== recompute.runId),
        ])
      }
      toast.success(t('industryEvidence.approved', { defaultValue: 'Industry verdict revision approved' }))
      setApprovalConfirmOpen(false)
      await loadQueue()
    } catch (error) {
      reportUiError('Failed to approve industry verdict revision', error)
      toast.error(
        error instanceof Error && error.message.includes('409')
          ? 'Review packet is stale. Refresh before approving.'
          : t('industryEvidence.approvalFailed', { defaultValue: 'Failed to approve industry verdict revision' }),
      )
    } finally {
      setSaving(false)
    }
  }

  async function resolveProposal(resolution: 'rejected' | 'needs_more_evidence') {
    if (!selectedProposal) return
    setSaving(true)
    try {
      await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            resolution,
            expectedProposalUpdatedAt: reviewDataset?.proposalUpdatedAt ?? selectedProposal.updatedAt,
            reviewNote: reviewNote.trim() || (
              resolution === 'needs_more_evidence'
                ? 'Reviewer requested additional evidence.'
                : 'Reviewer rejected the proposed change.'
            ),
          }),
        },
      )
      toast.success(
        resolution === 'needs_more_evidence'
          ? t('industryEvidence.moreEvidenceRequested', { defaultValue: 'Additional evidence requested; current truth is unchanged' })
          : t('industryEvidence.proposalRejected', { defaultValue: 'Proposal rejected; current truth is unchanged' }),
      )
      await loadQueue()
    } catch (error) {
      reportUiError('Failed to resolve industry evidence proposal', error)
      toast.error(
        error instanceof Error && error.message.includes('409')
          ? 'Review packet is stale. Refresh before resolving.'
          : t('industryEvidence.resolveFailed', { defaultValue: 'Failed to update proposal' }),
      )
    } finally {
      setSaving(false)
    }
  }

  function prepareApproval() {
    if (!validateApprovalInputs()) return
    setApprovalConfirmOpen(true)
  }

  function selectProposal(proposalId: string | undefined) {
    setSelectedProposalId(proposalId)
    const nextParams = new URLSearchParams(searchParams)
    if (proposalId) nextParams.set('proposalId', proposalId)
    else nextParams.delete('proposalId')
    setSearchParams(nextParams, { replace: true })
  }

  function changeQueueStatus(status: ReviewQueueStatus) {
    setQueueStatus(status)
    setNextQueueCursor(undefined)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('status', status)
    nextParams.delete('proposalId')
    setSearchParams(nextParams, { replace: true })
  }

  function moveSelection(direction: -1 | 1) {
    if (proposals.length === 0) return
    const currentIndex = proposals.findIndex((proposal) => proposal.proposalId === selectedProposalId)
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + proposals.length) % proposals.length
    selectProposal(proposals[nextIndex]?.proposalId)
  }

  async function updateRecompute(run: IndustryRecomputeRun, action: 'advance' | 'retry') {
    setSaving(true)
    try {
      const response = await requestJson(
        `/api/company-industry-recompute-runs/${encodeURIComponent(run.runId)}/${action}`,
        { method: 'POST' },
      )
      if (isRecord(response) && isRecord(response.item)) {
        const updated = response.item as unknown as IndustryRecomputeRun
        setRecomputeRuns((current) => current.map((item) => item.runId === updated.runId ? updated : item))
      }
    } catch (error) {
      reportUiError(`Failed to ${action} industry recompute`, error)
      toast.error(t('industryEvidence.recomputeFailed', { defaultValue: 'Failed to update targeted recompute' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('industryEvidence.settingsTitle', { defaultValue: 'Industry verification' })}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t('industryEvidence.settingsDescription', {
              defaultValue: 'Review external evidence proposals, approve immutable verdict revisions, and monitor the evidence used by 行业验证.',
            })}
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadQueue()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <CoverageHealthPanel requestJson={requestJson} />

      <ApprovedProfileLookup requestJson={requestJson} />

      <div className="grid gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('industryEvidence.proposalQueue', { defaultValue: 'Proposal queue' })}</CardTitle>
            <CardDescription>
              {t('industryEvidence.proposalQueueDescription', {
                defaultValue: 'Recommendations prepare the review; only attended approval can change current truth.',
              })}
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-2 text-xs" data-testid="industry-review-recommendation-summary">
              <Badge variant="outline">{recommendationSummary.approve} approve candidates</Badge>
              <Badge variant="outline">{recommendationSummary.needsEvidence} need evidence</Badge>
              <Badge variant="outline">{recommendationSummary.inspect} inspect</Badge>
            </div>
            <label className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
              <span>Queue status</span>
              <select
                name="queueStatus"
                aria-label="Queue status"
                value={queueStatus}
                onChange={(event) => changeQueueStatus(event.target.value as ReviewQueueStatus)}
                className="h-8 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <option value="ready_for_review">Ready for review</option>
                <option value="new">New</option>
                <option value="researching">Researching</option>
                <option value="needs_more_evidence">Needs more evidence</option>
              </select>
            </label>
            <div className="grid gap-2 pt-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('industryEvidence.riskFilter', { defaultValue: 'Risk' })}</span>
                <select
                  aria-label={t('industryEvidence.riskFilter', { defaultValue: 'Risk' })}
                  value={riskFilter}
                  onChange={(event) => {
                    setRiskFilter(event.target.value)
                    setNextQueueCursor(undefined)
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allRisks', { defaultValue: 'All risks' })}</option>
                  {Object.keys(REVIEW_RISK_FLAG_LABELS).map((flag) => <option key={flag} value={flag}>{REVIEW_RISK_FLAG_LABELS[flag]}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('industryEvidence.confidenceFilter', { defaultValue: 'Confidence' })}</span>
                <select
                  aria-label={t('industryEvidence.confidenceFilter', { defaultValue: 'Confidence' })}
                  value={confidenceFilter}
                  onChange={(event) => {
                    setConfidenceFilter(event.target.value)
                    setNextQueueCursor(undefined)
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allConfidence', { defaultValue: 'All confidence' })}</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('industryEvidence.actionFilter', { defaultValue: 'Action' })}</span>
                <select
                  aria-label={t('industryEvidence.actionFilter', { defaultValue: 'Action' })}
                  value={actionFilter}
                  onChange={(event) => {
                    setActionFilter(event.target.value)
                    setNextQueueCursor(undefined)
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allActions', { defaultValue: 'All actions' })}</option>
                  <option value="approve">approve</option>
                  <option value="needs_more_evidence">needs evidence</option>
                  <option value="inspect">inspect</option>
                  <option value="reject">reject</option>
                </select>
              </label>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading
                  ? t('common.loading', { defaultValue: 'Loading…' })
                  : t('industryEvidence.queueEmpty', { defaultValue: 'No proposals ready for review.' })}
              </p>
            ) : proposals.map((proposal) => (
              (() => {
                const item = queueRecommendations[proposal.proposalId]
                return (
                  <button
                    key={proposal.proposalId}
                    type="button"
                    onClick={() => selectProposal(proposal.proposalId)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring ${
                      proposal.proposalId === selectedProposalId
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{displayCompany(proposal.companyKey ?? proposal.normalizedEmployerSurface)}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {proposal.materialChangeSummary ?? proposal.triggerReasons.join(', ')}
                        </p>
                        {item && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge variant="outline">{item.recommendedAction.replace(/_/g, ' ')}</Badge>
                            <Badge variant="secondary">{item.confidenceBand} confidence</Badge>
                            {item.riskFlags.length > 0 && (
                              <Badge variant="destructive">{item.riskFlags.length} risk</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary">P{proposal.priority}</Badge>
                    </div>
                  </button>
                )
              })()
            ))}
            {nextQueueCursor && (
              <Button
                type="button"
                variant="outline"
                className="mt-2 w-full"
                disabled={loading}
                onClick={() => void loadQueue(nextQueueCursor, true)}
              >
                {t('industryEvidence.loadMore', { defaultValue: 'Load next review page' })}
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {!selectedProposal ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t('industryEvidence.selectProposal', { defaultValue: 'Select a proposal to review its evidence.' })}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{displayCompany(selectedProposal.companyKey ?? selectedProposal.normalizedEmployerSurface)}</CardTitle>
                      <CardDescription className="mt-1">
                        {selectedProposal.triggerReasons.join(' · ')}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => moveSelection(-1)} disabled={proposals.length < 2 || saving}>
                        Previous
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => moveSelection(1)} disabled={proposals.length < 2 || saving}>
                        Next
                      </Button>
                      <Badge>{selectedProposal.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Current verdict</p>
                    <p className="mt-1 font-medium">{bundle.profile?.verificationLevel ?? 'No approved revision'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Current revision</p>
                    <p className="mt-1 break-all font-mono text-xs">{bundle.profile?.currentRevisionId ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Freshness</p>
                    <p className="mt-1 font-medium">{bundle.profile?.freshnessState ?? 'Not recorded'}</p>
                  </div>
                </CardContent>
              </Card>

              {recommendation && (
                <Card data-testid="industry-review-recommendation">
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>Review recommendation</CardTitle>
                        <CardDescription>
                          Advisory only. A human must confirm the exact evidence and verdict.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{recommendation.recommendedAction.replace(/_/g, ' ')}</Badge>
                        <Badge variant="secondary">{recommendation.confidenceBand} confidence</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>{recommendation.reasons[0] ?? 'Inspect the attached evidence before deciding.'}</p>
                    {recommendation.riskFlags.length > 0 && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                        <p className="font-medium">Review flags</p>
                        <ul className="mt-1 list-disc pl-5">
                          {recommendation.riskFlags.map((flag) => <li key={flag}>{flag.replace(/_/g, ' ')}</li>)}
                        </ul>
                      </div>
                    )}
                    {reviewWarnings.map((warning) => (
                      <div key={warning.code} className="flex gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-950">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="font-medium">{warning.message}</p>
                          {warning.action && <p className="mt-1 text-xs">{warning.action}</p>}
                        </div>
                      </div>
                    ))}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggested class</p>
                        <p className="mt-1 font-medium">{recommendation.recommendedIndustryClass}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggested sources</p>
                        <p className="mt-1 font-medium">{recommendation.recommendedSourceIds.length}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Packet fingerprint</p>
                        <p className="mt-1 break-all font-mono text-xs">{reviewDataset?.inputFingerprint.slice(0, 16) ?? '—'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {recommendation && (recommendation.riskDecision?.requiresAcknowledgement || industryClass === 'cnc') && (
                <Card data-testid="industry-review-risk-attestation" className="border-amber-300">
                  <CardHeader>
                    <CardTitle>{t('industryEvidence.riskAttestationTitle', { defaultValue: 'Evidence-risk acknowledgement' })}</CardTitle>
                    <CardDescription>
                      {t('industryEvidence.riskAttestationDescription', {
                        defaultValue: 'Approval remains a human decision. Acknowledge the visible evidence risks and record why the selected revision is still justified.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {recommendation.riskFlags.length > 0 ? (
                      <fieldset className="space-y-2">
                        <legend className="font-medium">
                          {t('industryEvidence.visibleRiskFlags', { defaultValue: 'Visible risk flags' })}
                        </legend>
                        {recommendation.riskFlags.map((flag) => (
                          <label key={flag} className="flex items-start gap-2 rounded-md border p-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                              checked={acknowledgedRiskFlags.includes(flag)}
                              onChange={(event) => setAcknowledgedRiskFlags((current) => event.target.checked
                                ? [...new Set([...current, flag])]
                                : current.filter((item) => item !== flag))}
                              aria-label={`Acknowledge ${flag}`}
                            />
                            <span>
                              <span className="font-medium">{REVIEW_RISK_FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')}</span>
                              {recommendation.riskDecision?.nonOverridableRiskFlags.includes(flag) && (
                                <span className="ml-2 text-xs font-semibold text-destructive">
                                  {t('industryEvidence.hardBlock', { defaultValue: 'hard block' })}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                    {industryClass === 'cnc' && (
                      <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                          checked={cncEvidenceAcknowledged}
                          onChange={(event) => setCncEvidenceAcknowledged(event.target.checked)}
                          aria-label={t('industryEvidence.cncEvidenceCheckbox', { defaultValue: 'I reviewed the explicit CNC evidence' })}
                          disabled={!sources.some((source) => isExplicitCncEvidenceSource(source))}
                        />
                        <span>
                          <span className="font-medium">{t('industryEvidence.cncEvidenceCheckbox', { defaultValue: 'I reviewed the explicit CNC evidence' })}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {sources.filter((source) => isExplicitCncEvidenceSource(source)).length > 0
                              ? t('industryEvidence.cncEvidenceAvailable', { defaultValue: 'At least one fetched, active industrial source contains a CNC signal.' })
                              : t('industryEvidence.cncEvidenceUnavailable', { defaultValue: 'No fetched, active industrial source contains explicit CNC evidence.' })}
                          </span>
                        </span>
                      </label>
                    )}
                    {recommendation.riskFlags.length > 0 && (
                      <label className="block space-y-2 font-medium">
                        {t('industryEvidence.riskAcknowledgementReason', { defaultValue: 'Detailed acknowledgement reason' })}
                        <Input
                          aria-label={t('industryEvidence.riskAcknowledgementReason', { defaultValue: 'Detailed acknowledgement reason' })}
                          value={acknowledgementReason}
                          onChange={(event) => setAcknowledgementReason(event.target.value)}
                          placeholder={t('industryEvidence.riskAcknowledgementPlaceholder', { defaultValue: 'Explain why the selected evidence is sufficient for this attended decision.' })}
                        />
                      </label>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>{t('industryEvidence.recomputeStatus', { defaultValue: 'Targeted recompute' })}</CardTitle>
                  <CardDescription>
                    {t('industryEvidence.recomputeStatusDescription', {
                      defaultValue: 'Only resumes linked to this canonical company are recomputed through the supported exact-ingest path.',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recomputeRuns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No targeted recompute run yet.</p>
                  ) : recomputeRuns.map((run) => (
                    <div key={run.runId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{run.status}</Badge>
                          <span className="font-mono text-xs">{run.runId}</span>
                        </div>
                        <div className="flex gap-2">
                          {!['completed', 'superseded'].includes(run.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={saving}
                              onClick={() => void updateRecompute(run, 'advance')}
                            >
                              Advance
                            </Button>
                          )}
                          {['partial_failed', 'failed'].includes(run.status) && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={saving}
                              onClick={() => void updateRecompute(run, 'retry')}
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {run.operatorSummary}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('industryEvidence.evidenceReview', { defaultValue: 'Evidence review' })}</CardTitle>
                  <CardDescription>
                    {t('industryEvidence.evidenceReviewDescription', {
                      defaultValue: 'Select only durable reviewed sources. Search-result discovery URLs cannot be approved.',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No evidence sources attached.</p>
                  ) : sources.map((source) => {
                    const sourceDecision = recommendation?.sourceDecisions.find((item) => item.sourceId === source.sourceId)
                    const approvable = sourceDecision?.approvalSafe === true
                    const usable = approvable
                    const disabledReason = !approvable
                      ? recommendation?.excludedSourceReasons?.[source.sourceId]
                        ?? sourceDecision?.reasonCodes.map((code) => code.replace(/_/g, ' ')).join(', ')
                        ?? t('industryEvidence.sourceNotApprovalSafe', { defaultValue: 'not approval-safe' })
                      : undefined
                    const checked = selectedSourceIds.includes(source.sourceId)
                    return (
                      <label key={source.sourceId} className={`flex gap-3 rounded-lg border p-3 ${!usable ? 'bg-muted/40' : ''}`}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                          checked={checked}
                          disabled={!usable}
                          aria-label={`Select evidence source ${source.title ?? source.sourceDomain}`}
                          onChange={(event) => {
                            setSelectedSourceIds((current) => event.target.checked
                              ? [...new Set([...current, source.sourceId])]
                              : current.filter((id) => id !== source.sourceId))
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{source.title ?? source.sourceDomain}</span>
                            <Badge variant="outline">{source.sourceType}</Badge>
                            <Badge variant="secondary">{source.trustTier}</Badge>
                            {sourceDecision?.recommended && <Badge>Recommended</Badge>}
                            {!approvable && <Badge variant="destructive">{t('industryEvidence.sourceDisabled', { defaultValue: 'Not approval-safe' })}</Badge>}
                          </span>
                          {source.evidenceExcerpt && (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{source.evidenceExcerpt}</span>
                          )}
                          <span className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>Fetched {formatDate(source.fetchedAt)}</span>
                            {disabledReason && <span>{t('industryEvidence.sourceDisabledReason', { defaultValue: 'Reason: ' })}{disabledReason}</span>}
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {source.sourceDomain}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('industryEvidence.reviewDecision', { defaultValue: 'Review decision' })}</CardTitle>
                  <CardDescription>
                    {t('industryEvidence.reviewDecisionDescription', {
                      defaultValue: 'Approval creates a new immutable revision and advances the current profile atomically.',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium">
                      Verdict {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                      <select
                        name="verificationLevel"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        value={verificationLevel}
                        onChange={(event) => setVerificationLevel(event.target.value as VerificationLevel)}
                      >
                        <option value="verified">verified</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      Industry class {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                      <select
                        name="industryClass"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                        value={industryClass}
                        onChange={(event) => setIndustryClass(event.target.value as IndustryClass)}
                      >
                        {['cnc', 'automation', 'metrology', 'industrial', 'non_industry', 'unknown'].map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-2 text-sm font-medium">
                    Evidence summary {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                    <Input
                      name="evidenceSummary"
                      autoComplete="off"
                      aria-label="Evidence summary"
                      value={evidenceSummary}
                      onChange={(event) => setEvidenceSummary(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Decision reason {recommendation && <span className="text-xs font-normal text-muted-foreground">(Suggested)</span>}
                    <Input
                      name="decisionReason"
                      autoComplete="off"
                      aria-label="Decision reason"
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                    />
                  </label>
                  {approvalConfirmOpen && (
                    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm" data-testid="industry-review-approval-confirmation">
                      <p className="font-medium">Confirm this immutable revision</p>
                      <p>
                        You are approving <strong>{industryClass}</strong> as <strong>{verificationLevel}</strong> for{' '}
                        <strong>{displayCompany(selectedProposal.companyKey ?? selectedProposal.normalizedEmployerSurface)}</strong>.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sources: {selectedSourceIds.join(', ')} · this will create a new revision and start targeted recompute.
                      </p>
                      {recommendation && recommendation.riskFlags.length > 0 && (
                        <p className="text-xs font-medium text-amber-900">
                          Review flags remain: {recommendation.riskFlags.join(', ')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button onClick={() => void approveRevision()} disabled={saving}>
                          Confirm approve revision
                        </Button>
                        <Button variant="outline" onClick={() => setApprovalConfirmOpen(false)} disabled={saving}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  <label className="block space-y-2 text-sm font-medium">
                    Taxonomy version
                    <Input
                      name="taxonomyVersion"
                      autoComplete="off"
                      aria-label="Taxonomy version"
                      value={taxonomyVersion}
                      onChange={(event) => setTaxonomyVersion(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Review note (for reject / more evidence)
                    <Input
                      name="reviewNote"
                      autoComplete="off"
                      aria-label="Review note"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={prepareApproval}
                      disabled={saving || approvalConfirmOpen || (recommendation?.riskDecision?.nonOverridableRiskFlags.length ?? 0) > 0}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Approve revision
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void resolveProposal('needs_more_evidence')}
                      disabled={saving}
                    >
                      Request more evidence
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void resolveProposal('rejected')}
                      disabled={saving}
                    >
                      Reject proposal
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('industryEvidence.revisionHistory', { defaultValue: 'Revision history' })}</CardTitle>
                  <CardDescription>
                    {t('industryEvidence.revisionHistoryDescription', {
                      defaultValue: 'Immutable attended decisions for this canonical company.',
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {bundle.revisions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No immutable revisions yet.</p>
                  ) : bundle.revisions.map((revision) => (
                    <div key={revision.revisionId} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <Badge>{revision.verificationLevel}</Badge>
                        <Badge variant="outline">{revision.industryClass}</Badge>
                        <span className="break-all font-mono text-xs">{revision.revisionId}</span>
                      </div>
                      <p className="mt-2 text-sm">{revision.evidenceSummary}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {revision.reviewedBy} · {formatDate(revision.reviewedAt)}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <IndustryMaintenanceHistory requestJson={requestJson} />
    </div>
  )
}
