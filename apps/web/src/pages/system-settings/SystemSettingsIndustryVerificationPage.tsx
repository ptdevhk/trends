import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  const [proposals, setProposals] = useState<IndustryProposal[]>([])
  const [selectedProposalId, setSelectedProposalId] = useState<string>()
  const [sources, setSources] = useState<EvidenceSource[]>([])
  const [bundle, setBundle] = useState<IndustryBundle>({ profile: null, revisions: [], sources: [] })
  const [recomputeRuns, setRecomputeRuns] = useState<IndustryRecomputeRun[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [industryClass, setIndustryClass] = useState<IndustryClass>('unknown')
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('verified')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [taxonomyVersion, setTaxonomyVersion] = useState('industry-v1')
  const [reviewNote, setReviewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const selectedProposal = useMemo(
    () => proposals.find((proposal) => proposal.proposalId === selectedProposalId),
    [proposals, selectedProposalId],
  )

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await requestJson('/api/company-industry-proposals?status=ready_for_review')
      const next = parseItems<IndustryProposal>(payload)
      setProposals(next)
      setSelectedProposalId((current) => (
        current && next.some((proposal) => proposal.proposalId === current)
          ? current
          : next[0]?.proposalId
      ))
    } catch (error) {
      reportUiError('Failed to load industry evidence proposal queue', error)
      toast.error(t('industryEvidence.queueLoadFailed', { defaultValue: 'Failed to load industry evidence queue' }))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (!selectedProposal) {
      setSources([])
      setBundle({ profile: null, revisions: [], sources: [] })
      setRecomputeRuns([])
      setSelectedSourceIds([])
      return
    }
    let cancelled = false
    const loadDetail = async () => {
      try {
        const [sourcePayload, bundlePayload, recomputePayload] = await Promise.all([
          requestJson(`/api/company-industry-evidence-sources?proposalId=${encodeURIComponent(selectedProposal.proposalId)}`),
          selectedProposal.companyKey
            ? requestJson(`/api/company-industry-bundles/${encodeURIComponent(selectedProposal.companyKey)}`)
            : Promise.resolve({ profile: null, revisions: [], sources: [] }),
          selectedProposal.companyKey
            ? requestJson(`/api/company-industry-recompute-runs?companyKey=${encodeURIComponent(selectedProposal.companyKey)}&limit=10`)
            : Promise.resolve({ items: [] }),
        ])
        if (cancelled) return
        const nextSources = parseItems<EvidenceSource>(sourcePayload)
        const nextBundle = parseBundle(bundlePayload)
        setSources(nextSources)
        setBundle(nextBundle)
        setRecomputeRuns(parseItems<IndustryRecomputeRun>(recomputePayload))
        setSelectedSourceIds(
          nextSources
            .filter((source) => source.sourceType !== 'search_result' && source.trustTier !== 'discovery')
            .map((source) => source.sourceId),
        )
        setIndustryClass(selectedProposal.suggestedIndustryClass ?? nextBundle.profile?.industryClass ?? 'unknown')
        setVerificationLevel(
          selectedProposal.suggestedVerificationLevel === 'rejected' ? 'rejected' : 'verified',
        )
        setEvidenceSummary(
          selectedProposal.materialChangeSummary
          ?? nextBundle.revisions[0]?.evidenceSummary
          ?? '',
        )
        setDecisionReason('')
        setReviewNote('')
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

  async function approveRevision() {
    if (!selectedProposal?.companyKey) {
      toast.error(t('industryEvidence.companyRequired', { defaultValue: 'Map this proposal to a canonical company first' }))
      return
    }
    if (selectedSourceIds.length === 0 || !evidenceSummary.trim() || !decisionReason.trim()) {
      toast.error(t('industryEvidence.reviewFieldsRequired', { defaultValue: 'Select evidence and complete the review summary and reason' }))
      return
    }
    setSaving(true)
    try {
      const response = await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(selectedProposal.proposalId)}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            revisionId: createRevisionId(selectedProposal.companyKey),
            expectedCurrentRevisionId: bundle.profile?.currentRevisionId,
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
      await loadQueue()
    } catch (error) {
      reportUiError('Failed to approve industry verdict revision', error)
      toast.error(t('industryEvidence.approvalFailed', { defaultValue: 'Failed to approve industry verdict revision' }))
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
      toast.error(t('industryEvidence.resolveFailed', { defaultValue: 'Failed to update proposal' }))
    } finally {
      setSaving(false)
    }
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

      <div className="grid gap-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('industryEvidence.proposalQueue', { defaultValue: 'Proposal queue' })}</CardTitle>
            <CardDescription>
              {t('industryEvidence.proposalQueueDescription', {
                defaultValue: 'Only attended approval can change current truth.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {loading
                  ? t('common.loading', { defaultValue: 'Loading…' })
                  : t('industryEvidence.queueEmpty', { defaultValue: 'No proposals ready for review.' })}
              </p>
            ) : proposals.map((proposal) => (
              <button
                key={proposal.proposalId}
                type="button"
                onClick={() => setSelectedProposalId(proposal.proposalId)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  proposal.proposalId === selectedProposalId
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{displayCompany(proposal.companyKey ?? proposal.normalizedEmployerSurface)}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {proposal.materialChangeSummary ?? proposal.triggerReasons.join(', ')}
                    </p>
                  </div>
                  <Badge variant="secondary">P{proposal.priority}</Badge>
                </div>
              </button>
            ))}
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
                    <Badge>{selectedProposal.status}</Badge>
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
                    const approvable = source.sourceType !== 'search_result' && source.trustTier !== 'discovery'
                    const checked = selectedSourceIds.includes(source.sourceId)
                    return (
                      <label key={source.sourceId} className="flex gap-3 rounded-lg border p-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          disabled={!approvable}
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
                          </span>
                          {source.evidenceExcerpt && (
                            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{source.evidenceExcerpt}</span>
                          )}
                          <span className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>Fetched {formatDate(source.fetchedAt)}</span>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {source.sourceDomain}
                              <ExternalLink className="h-3 w-3" />
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
                      Verdict
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={verificationLevel}
                        onChange={(event) => setVerificationLevel(event.target.value as VerificationLevel)}
                      >
                        <option value="verified">verified</option>
                        <option value="rejected">rejected</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      Industry class
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
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
                    Evidence summary
                    <Input
                      aria-label="Evidence summary"
                      value={evidenceSummary}
                      onChange={(event) => setEvidenceSummary(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Decision reason
                    <Input
                      aria-label="Decision reason"
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Taxonomy version
                    <Input
                      aria-label="Taxonomy version"
                      value={taxonomyVersion}
                      onChange={(event) => setTaxonomyVersion(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2 text-sm font-medium">
                    Review note (for reject / more evidence)
                    <Input
                      aria-label="Review note"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void approveRevision()} disabled={saving}>
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
