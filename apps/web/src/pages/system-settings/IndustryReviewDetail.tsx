import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isExplicitCncEvidenceSource, type IndustryReviewWarning } from '@trends/shared'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  displayCompany,
  formatDate,
  REVIEW_RISK_FLAG_LABELS,
  type EvidenceSource,
  type IndustryProposal,
  type IndustryRecomputeRun,
  type IndustryRevision,
  type ReviewPacket,
} from './industry-verification-model'

export type ProposalHeaderProfile = {
  verificationLevel?: string
  currentRevisionId?: string
  freshnessState?: string
}

/**
 * Structural view of a review recommendation that both the shared
 * `IndustryReviewRecommendation` and the raw review-packet API schema
 * satisfy, so these cards only depend on the fields they render.
 */
export type ReviewRecommendationView = {
  recommendedAction: string
  confidenceBand: string
  reasons: string[]
  riskFlags: string[]
  recommendedIndustryClass: string
  recommendedSourceIds: string[]
  sourceDecisions: Array<{
    sourceId: string
    approvalSafe: boolean
    recommended: boolean
    reasonCodes: string[]
  }>
  excludedSourceReasons: Record<string, string>
  riskDecision?: {
    nonOverridableRiskFlags: string[]
  }
}

export function IndustryProposalHeaderCard({
  proposal,
  profile,
  saving,
  canMove,
  onPrevious,
  onNext,
}: {
  proposal: IndustryProposal
  profile?: ProposalHeaderProfile | null
  saving: boolean
  canMove: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{displayCompany(proposal.companyKey ?? proposal.normalizedEmployerSurface)}</CardTitle>
            <CardDescription className="mt-1">
              {proposal.triggerReasons.join(' · ')}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onPrevious} disabled={!canMove || saving}>
              Previous
            </Button>
            <Button size="sm" variant="outline" onClick={onNext} disabled={!canMove || saving}>
              Next
            </Button>
            <Badge>{proposal.status}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current verdict</p>
          <p className="mt-1 font-medium">{profile?.verificationLevel ?? 'No approved revision'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Current revision</p>
          <p className="mt-1 break-all font-mono text-xs">{profile?.currentRevisionId ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Freshness</p>
          <p className="mt-1 font-medium">{profile?.freshnessState ?? 'Not recorded'}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function IndustryReviewRecommendationCard({
  recommendation,
  warnings,
  dataset,
}: {
  recommendation: ReviewRecommendationView | null
  warnings: IndustryReviewWarning[]
  dataset: ReviewPacket['dataset'] | null
}) {
  if (!recommendation) return null
  return (
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
        {warnings.map((warning) => (
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
            <p className="mt-1 break-all font-mono text-xs">{dataset?.inputFingerprint.slice(0, 16) ?? '—'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function IndustryRiskAttestationCard({
  recommendation,
  sources,
  cncMode,
  acknowledgedRiskFlags,
  onToggleRiskFlag,
  cncEvidenceAcknowledged,
  onCncEvidenceAcknowledgedChange,
  acknowledgementReason,
  onAcknowledgementReasonChange,
}: {
  recommendation: ReviewRecommendationView
  sources: EvidenceSource[]
  cncMode: boolean
  acknowledgedRiskFlags: string[]
  onToggleRiskFlag: (flag: string, checked: boolean) => void
  cncEvidenceAcknowledged: boolean
  onCncEvidenceAcknowledgedChange: (checked: boolean) => void
  acknowledgementReason: string
  onAcknowledgementReasonChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
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
                  onChange={(event) => onToggleRiskFlag(flag, event.target.checked)}
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
        {cncMode && (
          <label className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
              checked={cncEvidenceAcknowledged}
              onChange={(event) => onCncEvidenceAcknowledgedChange(event.target.checked)}
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
              onChange={(event) => onAcknowledgementReasonChange(event.target.value)}
              placeholder={t('industryEvidence.riskAcknowledgementPlaceholder', { defaultValue: 'Explain why the selected evidence is sufficient for this attended decision.' })}
            />
          </label>
        )}
      </CardContent>
    </Card>
  )
}

export function IndustryRecomputeCard({
  runs,
  saving,
  onAdvance,
  onRetry,
}: {
  runs: IndustryRecomputeRun[]
  saving: boolean
  onAdvance: (run: IndustryRecomputeRun) => void
  onRetry: (run: IndustryRecomputeRun) => void
}) {
  const { t } = useTranslation()
  return (
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
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No targeted recompute run yet.</p>
        ) : runs.map((run) => (
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
                    onClick={() => onAdvance(run)}
                  >
                    Advance
                  </Button>
                )}
                {['partial_failed', 'failed'].includes(run.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => onRetry(run)}
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
  )
}

export function IndustryEvidenceReviewCard({
  sources,
  recommendation,
  selectedSourceIds,
  onToggleSource,
  readOnly,
}: {
  sources: EvidenceSource[]
  recommendation: ReviewRecommendationView | null
  selectedSourceIds: string[]
  onToggleSource: (sourceId: string, checked: boolean) => void
  readOnly: boolean
}) {
  const { t } = useTranslation()
  return (
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
                disabled={readOnly || !usable}
                aria-label={`Select evidence source ${source.title ?? source.sourceDomain}`}
                onChange={(event) => onToggleSource(source.sourceId, event.target.checked)}
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
  )
}

export function IndustryRevisionHistoryCard({ revisions }: { revisions: IndustryRevision[] }) {
  const { t } = useTranslation()
  return (
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
        {revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No immutable revisions yet.</p>
        ) : revisions.map((revision) => (
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
  )
}
