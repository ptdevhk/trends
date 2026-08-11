import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, IdCard, Layers, ListX, ShieldAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  batchAttestationMode,
  batchRequiresCncAcknowledgement,
  getBatchApproveEligibility,
  unionRiskFlags,
  type BatchApproveEligibility,
  type ReviewInboxItem,
} from './industry-review-inbox-model'

export type BatchApproveAction = {
  kind: 'approve'
  proposalId: string
  industryClass: string
}

export type BatchRejectAction = {
  kind: 'reject'
  proposalId: string
  reviewNote?: string
}

export type BatchAttestationInput = {
  schemaVersion: 'industry-review-attestation.v1'
  decisionMode: 'standard' | 'risk_override'
  acknowledgedRiskFlags: string[]
  cncEvidenceAcknowledged: boolean
  acknowledgementReason: string
}

export const BATCH_CLASS_OPTIONS = [
  'industrial',
  'automation',
  'cnc',
  'metrology',
  'non_industry',
] as const

export type BatchDialogKind = 'approve' | 'reject'

type IndustryBatchActionBarProps = {
  selectedCount: number
  disabled?: boolean
  onApprove: () => void
  onReject: () => void
  onResolveIdentity: () => void
  resolveIdentityDisabled?: boolean
  onClear: () => void
}

export function IndustryBatchActionBar({
  selectedCount,
  disabled = false,
  onApprove,
  onReject,
  onResolveIdentity,
  resolveIdentityDisabled = false,
  onClear,
}: IndustryBatchActionBarProps) {
  const { t } = useTranslation()
  if (selectedCount === 0) return null
  return (
    <div
      className="sticky top-0 z-10 rounded-lg border bg-muted/70 p-3 shadow-sm backdrop-blur"
      data-testid="industry-batch-action-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span data-testid="industry-batch-selected-count">
            {t('industryEvidence.batchSelected', { defaultValue: '{{count}} selected', count: selectedCount })}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={onApprove}
            data-testid="industry-batch-approve-button"
          >
            <CheckSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('industryEvidence.batchApprove', { defaultValue: 'Approve ({{count}})', count: selectedCount })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || resolveIdentityDisabled}
            onClick={onResolveIdentity}
            data-testid="industry-batch-resolve-identity-button"
          >
            <IdCard className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('industryEvidence.batchResolveIdentity', { defaultValue: 'Resolve identity ({{count}})', count: selectedCount })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={onReject}
            data-testid="industry-batch-reject-button"
          >
            <ListX className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('industryEvidence.batchReject', { defaultValue: 'Reject ({{count}})', count: selectedCount })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClear}
            data-testid="industry-batch-clear-button"
          >
            <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('industryEvidence.batchClear', { defaultValue: 'Clear' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

function companyLabel(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

type IndustryBatchApproveDialogProps = {
  open: boolean
  items: ReviewInboxItem[]
  submitting: boolean
  onSubmit: (actions: BatchApproveAction[], attestation: BatchAttestationInput) => void
  onOpenChange: (open: boolean) => void
}

export function IndustryBatchApproveDialog({
  open,
  items,
  submitting,
  onSubmit,
  onOpenChange,
}: IndustryBatchApproveDialogProps) {
  const { t } = useTranslation()
  const [classOverrides, setClassOverrides] = useState<Record<string, string>>({})
  const [acknowledgementReason, setAcknowledgementReason] = useState('')
  const [cncAcknowledged, setCncAcknowledged] = useState(false)

  useEffect(() => {
    if (!open) return
    setClassOverrides({})
    setAcknowledgementReason('')
    setCncAcknowledged(false)
  }, [open, items])

  const eligibleItems = useMemo(
    () => items.filter((item) => getBatchApproveEligibility(item).eligible),
    [items],
  )
  const excludedItems = useMemo(
    () => items.filter((item) => !getBatchApproveEligibility(item).eligible),
    [items],
  )
  const riskFlags = useMemo(() => unionRiskFlags(eligibleItems), [eligibleItems])
  const decisionMode = batchAttestationMode(riskFlags)
  const requiresReason = decisionMode === 'risk_override'
  const requiresCnc = batchRequiresCncAcknowledgement(eligibleItems, classOverrides)

  const missingClass = eligibleItems.some((item) => {
    const override = classOverrides[item.proposal.proposalId]
    if (override) return false
    return item.recommendation.recommendedIndustryClass === 'unknown'
  })
  const canSubmit =
    eligibleItems.length > 0
    && !missingClass
    && (!requiresReason || acknowledgementReason.trim().length > 0)
    && (!requiresCnc || cncAcknowledged)

  function effectiveClass(item: ReviewInboxItem): string {
    return (
      classOverrides[item.proposal.proposalId]
      ?? item.recommendation.recommendedIndustryClass
    )
  }

  function handleSubmit() {
    if (!canSubmit) return
    const actions: BatchApproveAction[] = eligibleItems.map((item) => ({
      kind: 'approve',
      proposalId: item.proposal.proposalId,
      industryClass: effectiveClass(item),
    }))
    const attestation: BatchAttestationInput = {
      schemaVersion: 'industry-review-attestation.v1',
      decisionMode,
      acknowledgedRiskFlags: riskFlags,
      cncEvidenceAcknowledged: cncAcknowledged,
      acknowledgementReason: acknowledgementReason.trim(),
    }
    onSubmit(actions, attestation)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('industryEvidence.batchApproveTitle', { defaultValue: 'Approve selected proposals' })}
          </DialogTitle>
          <DialogDescription>
            {t('industryEvidence.batchApproveDescription', {
              defaultValue: 'One attestation covers this batch. Every proposal still passes the same evidence and governance checks.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {excludedItems.length > 0 ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              data-testid="industry-batch-excluded"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {t('industryEvidence.batchExcludedTitle', { defaultValue: 'Excluded from approval' })}
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {excludedItems.map((item) => (
                    <li key={item.proposal.proposalId}>
                      {companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface)}
                      {' — '}
                      {excludedReasonLabel(getBatchApproveEligibility(item), t)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <ul className="space-y-2" data-testid="industry-batch-approve-items">
            {eligibleItems.map((item) => {
              const eligibility = getBatchApproveEligibility(item)
              const current = effectiveClass(item)
              return (
                <li key={item.proposal.proposalId} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('industryEvidence.batchSourcesCount', {
                          defaultValue: '{{count}} approval-safe sources',
                          count: eligibility.eligible ? eligibility.safeSourceIds.length : 0,
                        })}
                      </p>
                      {item.resumeImpact > 0 ? (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid={`industry-batch-impact-${item.proposal.proposalId}`}
                        >
                          {t('industryEvidence.approveImpactLinkedResumes', {
                            defaultValue: 'Links {{count}} resumes — recomputed under the new verdict after approval',
                            count: item.resumeImpact,
                          })}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.recommendation.riskFlags.map((flag) => (
                        <Badge key={flag} variant="outline" className="text-[10px]">
                          {flag}
                        </Badge>
                      ))}
                      <select
                        aria-label={t('industryEvidence.batchClassLabel', {
                          defaultValue: 'Industry classification',
                        })}
                        value={current === 'unknown' ? '' : current}
                        onChange={(event) => {
                          const value = event.target.value
                          setClassOverrides((currentOverrides) => {
                            const next = { ...currentOverrides }
                            if (value) next[item.proposal.proposalId] = value
                            else delete next[item.proposal.proposalId]
                            return next
                          })
                        }}
                        className={cn(
                          'h-8 rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                          current === 'unknown' ? 'border-amber-400 text-amber-800' : 'text-foreground',
                        )}
                        data-testid={`industry-batch-class-${item.proposal.proposalId}`}
                      >
                        {current === 'unknown' ? (
                          <option value="">
                            {t('industryEvidence.batchClassRequired', { defaultValue: 'Select classification…' })}
                          </option>
                        ) : null}
                        {BATCH_CLASS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {t(`industryEvidence.classOption.${option}`, { defaultValue: option })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {item.recommendation.recommendedAction === 'reject' && current === 'non_industry' ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t('industryEvidence.batchNonIndustryHint', {
                        defaultValue: 'Records a verified non_industry verdict instead of a rejection.',
                      })}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {eligibleItems.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('industryEvidence.batchNoEligible', {
                defaultValue: 'None of the selected proposals can be batch-approved.',
              })}
            </p>
          ) : null}

          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{t('industryEvidence.batchAttestationTitle', { defaultValue: 'Batch attestation' })}</span>
              <Badge variant="secondary" className="text-[10px]">
                {decisionMode}
              </Badge>
            </div>
            {riskFlags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {riskFlags.map((flag) => (
                  <Badge key={flag} variant="outline" className="text-[10px]">
                    {flag}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('industryEvidence.batchNoFlags', { defaultValue: 'No risk flags to acknowledge.' })}
              </p>
            )}
            {requiresReason ? (
              <div className="space-y-1.5">
                <Label htmlFor="industry-batch-reason" className="text-xs">
                  {t('industryEvidence.batchReasonLabel', { defaultValue: 'Acknowledgement reason' })}
                  {' *'}
                </Label>
                <Textarea
                  id="industry-batch-reason"
                  value={acknowledgementReason}
                  onChange={(event) => setAcknowledgementReason(event.target.value)}
                  placeholder={t('industryEvidence.batchReasonPlaceholder', {
                    defaultValue: 'Why these flagged proposals are safe to classify now (recorded on every approved revision).',
                  })}
                  rows={3}
                  data-testid="industry-batch-reason"
                />
              </div>
            ) : null}
            {requiresCnc ? (
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={cncAcknowledged}
                  onChange={(event) => setCncAcknowledged(event.target.checked)}
                  className="mt-0.5"
                  data-testid="industry-batch-cnc-ack"
                />
                <span>
                  {t('industryEvidence.batchCncAck', {
                    defaultValue: 'I confirm the CNC classification is backed by explicit industrial/product evidence.',
                  })}
                </span>
              </label>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            data-testid="industry-batch-approve-submit"
          >
            {submitting
              ? t('common.submitting', { defaultValue: 'Submitting…' })
              : t('industryEvidence.batchApproveSubmit', {
                  defaultValue: 'Approve {{count}}',
                  count: eligibleItems.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function excludedReasonLabel(
  eligibility: BatchApproveEligibility,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (eligibility.eligible) {
    return t('industryEvidence.batchExcludedReason.unknown', { defaultValue: 'not eligible' })
  }
  const copy: Record<Exclude<BatchApproveEligibility, { eligible: true }>['reason'], string> = {
    terminal: t('industryEvidence.batchExcludedReason.terminal', { defaultValue: 'already decided' }),
    status: t('industryEvidence.batchExcludedReason.status', { defaultValue: 'not ready for review' }),
    source: t('industryEvidence.batchExcludedReason.source', { defaultValue: 'no approval-safe source' }),
    hard_risk: t('industryEvidence.batchExcludedReason.hard_risk', { defaultValue: 'has a non-overridable risk flag' }),
  }
  return copy[eligibility.reason]
}

type IndustryBatchRejectDialogProps = {
  open: boolean
  items: ReviewInboxItem[]
  submitting: boolean
  onSubmit: (actions: BatchRejectAction[]) => void
  onOpenChange: (open: boolean) => void
}

export function IndustryBatchRejectDialog({
  open,
  items,
  submitting,
  onSubmit,
  onOpenChange,
}: IndustryBatchRejectDialogProps) {
  const { t } = useTranslation()
  const [reviewNote, setReviewNote] = useState('')

  useEffect(() => {
    if (open) setReviewNote('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t('industryEvidence.batchRejectTitle', { defaultValue: 'Reject selected proposals' })}
          </DialogTitle>
          <DialogDescription>
            {t('industryEvidence.batchRejectDescription', {
              defaultValue: 'Rejection marks these proposals as noise or garbage. Real companies that are not industrial should be approved with the non_industry classification instead.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <ul className="space-y-1.5" data-testid="industry-batch-reject-items">
            {items.map((item) => (
              <li key={item.proposal.proposalId} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="truncate font-medium">
                  {companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.proposal.status}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="industry-batch-reject-note" className="text-xs">
              {t('industryEvidence.batchRejectNoteLabel', { defaultValue: 'Rejection note (optional)' })}
            </Label>
            <Textarea
              id="industry-batch-reject-note"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder={t('industryEvidence.batchRejectNotePlaceholder', {
                defaultValue: 'Why these proposals are noise (recorded per proposal).',
              })}
              rows={3}
              data-testid="industry-batch-reject-note"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onSubmit(items.map((item) => ({
              kind: 'reject',
              proposalId: item.proposal.proposalId,
              ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
            })))}
            disabled={submitting || items.length === 0}
            data-testid="industry-batch-reject-submit"
          >
            {submitting
              ? t('common.submitting', { defaultValue: 'Submitting…' })
              : t('industryEvidence.batchRejectSubmit', { defaultValue: 'Reject {{count}}', count: items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
