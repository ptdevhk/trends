import { CheckCircle2, IdCard, Loader2, TriangleAlert } from 'lucide-react'
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
  targeted?: boolean
  pendingAction?: ReviewRowAction
  error?: ReviewRowError
  undoDisabled?: boolean
  /** Batch selection affordance (bulk approve/reject). */
  batchSelected?: boolean
  batchDisabled?: boolean
  onToggleBatchSelect?: () => void
  onSelect: () => void
  onApprove: () => void
  onUndo: () => void
  onRetry: () => void
  /** Identity-resolution lane: shown for rows blocked by canonical_mapping_missing. */
  onResolveIdentity?: () => void
  resolveIdentityPending?: boolean
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
  targeted = false,
  pendingAction,
  error,
  undoDisabled = false,
  batchSelected = false,
  batchDisabled = false,
  onToggleBatchSelect,
  onSelect,
  onApprove,
  onUndo,
  onRetry,
  onResolveIdentity,
  resolveIdentityPending = false,
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
      className={`${targeted ? 'scroll-mt-px' : 'scroll-mt-16'} group rounded-lg border bg-card px-3 py-3 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'border-primary bg-primary/[0.03]' : 'border-border hover:border-primary/40'
      }`}
      data-testid={`industry-review-row-${proposal.proposalId}`}
      data-industry-review-target={targeted ? 'true' : undefined}
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
      <div className="flex items-start gap-2.5">
        {onToggleBatchSelect ? (
          <input
            type="checkbox"
            aria-label={t('industryEvidence.batchSelectRow', {
              defaultValue: 'Select for bulk action',
            })}
            checked={batchSelected}
            disabled={batchDisabled}
            onChange={onToggleBatchSelect}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className="mt-1.5 shrink-0"
            data-testid={`industry-batch-check-${proposal.proposalId}`}
          />
        ) : null}
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isApproved
              ? 'bg-emerald-100 text-emerald-700'
              : eligibility.eligible
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-amber-50 text-amber-700'
          }`}
          aria-hidden="true"
        >
          {isApproved ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">{name}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {proposal.materialChangeSummary ?? proposal.triggerReasons.join(' · ')}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 px-2 py-0.5 text-[11px] tabular-nums">
              P{proposal.priority}
            </Badge>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <Badge variant={isApproved ? 'default' : 'outline'} className="px-1.5 py-0">
              {isApproved
                ? t('industryEvidence.approved', { defaultValue: 'Approved' })
                : proposal.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline" className="px-1.5 py-0">{recommendation.recommendedIndustryClass}</Badge>
            <Badge variant="secondary" className="px-1.5 py-0">
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
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-950">
              <p className="font-medium">
                {t('industryEvidence.sessionApproved', {
                  defaultValue: 'Approved in this session',
                })}
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-emerald-900/80" title={approval.approvedRevisionId}>
                {approval.approvedRevisionId}
                {approval.recomputeRunId ? ` · ${approval.recomputeRunId}` : ''}
              </p>
            </div>
          ) : reasonLabel(eligibility, t) ? (
            <p className="mt-2 text-xs text-amber-800">{reasonLabel(eligibility, t)}</p>
          ) : null}

          {error ? (
            <div
              className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs ${
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
              className="h-8 rounded-full px-3 text-xs"
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
              className="h-8 w-8 rounded-full text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
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
            <div className="flex flex-wrap items-center gap-1.5">
              {onResolveIdentity ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isActionPending}
                  onClick={onResolveIdentity}
                  aria-label={t('industryEvidence.resolveIdentityRowLabel', {
                    defaultValue: 'Resolve identity for {{company}}',
                    company: name,
                  })}
                  data-testid={`industry-review-resolve-identity-${proposal.proposalId}`}
                >
                  {resolveIdentityPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <IdCard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {t('industryEvidence.resolveIdentity', { defaultValue: 'Resolve identity' })}
                </Button>
              ) : null}
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
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
