import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  OneClickEligibility,
  ReviewInboxRow as ReviewRow,
} from './industry-review-inbox-model'

export type ReviewRowAction = 'approve' | 'undo'

export type ReviewRowError = {
  kind: 'conflict' | 'policy' | 'network'
  message: string
}

type IndustryReviewRowProps = {
  row: ReviewRow
  selected: boolean
  pendingAction?: ReviewRowAction
  error?: ReviewRowError
  undoDisabled?: boolean
  onSelect: () => void
  onApprove: () => void
  onUndo: () => void
  onRetry: () => void
}

function companyLabel(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

function reasonLabel(
  eligibility: OneClickEligibility,
  t: ReturnType<typeof useTranslation>['t'],
): string | undefined {
  if (eligibility.eligible) return undefined
  const copy: Record<Exclude<OneClickEligibility, { eligible: true }>['reason'], string> = {
    canonical_company: t('industryEvidence.rowCanonicalMissing', {
      defaultValue: 'Canonical company mapping is missing',
    }),
    status: t('industryEvidence.rowStatusNotReady', {
      defaultValue: 'This proposal is still in an open workflow state',
    }),
    recommendation: t('industryEvidence.rowRecommendationInspect', {
      defaultValue: 'Recommendation needs an attended review',
    }),
    source: t('industryEvidence.rowNoSafeSource', {
      defaultValue: 'No approval-safe source is available',
    }),
    risk: t('industryEvidence.rowRiskFlag', {
      defaultValue: 'Evidence risk requires review',
    }),
    attestation: t('industryEvidence.rowAttestationRequired', {
      defaultValue: 'Explicit acknowledgement is required',
    }),
    cnc: t('industryEvidence.rowCncReview', {
      defaultValue: 'CNC evidence requires attended confirmation',
    }),
  }
  return copy[eligibility.reason]
}

export function IndustryReviewRow({
  row,
  selected,
  pendingAction,
  error,
  undoDisabled = false,
  onSelect,
  onApprove,
  onUndo,
  onRetry,
}: IndustryReviewRowProps) {
  const { t } = useTranslation()
  const { item, eligibility, sessionApproval } = row
  const proposal = item.proposal
  const recommendation = item.recommendation
  const name = companyLabel(proposal.companyKey ?? proposal.normalizedEmployerSurface)
  const approval = sessionApproval
  const isApproved = approval !== undefined
  const isApproving = pendingAction === 'approve'
  const isUndoing = pendingAction === 'undo'
  const isActionPending = Boolean(pendingAction)
  const detailLabel = t('industryEvidence.viewRow', { defaultValue: 'View' })

  return (
    <article
      className={`group rounded-xl border bg-card p-4 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'border-primary bg-primary/[0.03]' : 'border-border hover:border-primary/40'
      }`}
      data-testid={`industry-review-row-${proposal.proposalId}`}
      aria-current={selected ? 'true' : undefined}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isApproved
              ? 'bg-emerald-100 text-emerald-700'
              : eligibility.eligible
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-amber-50 text-amber-700'
          }`}
          aria-hidden="true"
        >
          {isApproved ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold tracking-tight">{name}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {proposal.materialChangeSummary ?? proposal.triggerReasons.join(' · ')}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              P{proposal.priority}
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant={isApproved ? 'default' : 'outline'}>
              {isApproved
                ? t('industryEvidence.approved', { defaultValue: 'Approved' })
                : proposal.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline">{recommendation.recommendedIndustryClass}</Badge>
            <Badge variant="secondary">
              {recommendation.recommendedVerificationLevel}
            </Badge>
            <span className="text-muted-foreground">
              {t('industryEvidence.rowSources', {
                defaultValue: '{{count}} source(s)',
                count: item.sourceCount,
              })}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {t('industryEvidence.rowConfidence', {
                defaultValue: '{{confidence}} confidence',
                confidence: recommendation.confidenceBand,
              })}
            </span>
          </div>

          {isApproved ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
              <p className="font-medium">
                {t('industryEvidence.sessionApproved', {
                  defaultValue: 'Approved in this session',
                })}
              </p>
              <p className="mt-1 font-mono text-[11px] text-emerald-900/80">
                {approval.approvedRevisionId}
                {approval.recomputeRunId ? ` · ${approval.recomputeRunId}` : ''}
              </p>
            </div>
          ) : reasonLabel(eligibility, t) ? (
            <p className="mt-3 text-xs text-amber-800">{reasonLabel(eligibility, t)}</p>
          ) : null}

          {error ? (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                error.kind === 'policy'
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-rose-300 bg-rose-50 text-rose-950'
              }`}
              role="alert"
              data-testid={`industry-review-row-error-${proposal.proposalId}`}
            >
              <p>{error.message}</p>
              {error.kind !== 'conflict' || !isApproved ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0 text-current"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRetry()
                  }}
                >
                  {t('industryEvidence.retryRow', { defaultValue: 'Retry' })}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-2" onClick={(event) => event.stopPropagation()}>
          {isApproved ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isActionPending || undoDisabled}
              onClick={onUndo}
              aria-label={t('industryEvidence.undoRowLabel', {
                defaultValue: 'Undo approval for {{company}}',
                company: name,
              })}
              data-testid={`industry-review-undo-${proposal.proposalId}`}
            >
              {isUndoing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('industryEvidence.undo', { defaultValue: 'Undo' })}
            </Button>
          ) : eligibility.eligible ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
              disabled={isActionPending}
              onClick={onApprove}
              aria-label={t('industryEvidence.approveRowLabel', {
                defaultValue: 'Approve {{company}}',
                company: name,
              })}
              data-testid={`industry-review-approve-${proposal.proposalId}`}
            >
              {isApproving ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isActionPending}
              onClick={onSelect}
              aria-label={`${detailLabel}: ${name}`}
            >
              {detailLabel}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
