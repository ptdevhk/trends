import { CircleAlert, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { SYSTEM_ROUTE_PREFIX } from '@/lib/workspace-access'

export type IndustryEvidenceReviewTarget = {
  employerLabel: string
  proposalId: string
}

type LegacyIndustryEvidenceNoticeProps = {
  compact?: boolean
  showReviewAction?: boolean
  reviewTarget?: IndustryEvidenceReviewTarget
  /** Base of the review surface for the current viewer; defaults to the canonical dev system base. */
  reviewBasePath?: string
}

/**
 * Neutral guidance for a legacy rules signal. Callers must decide whether the
 * current user may review industry evidence (dev system admin or
 * active-workspace admin/reviewer) before mounting this component.
 */
export function LegacyIndustryEvidenceNotice({
  compact = false,
  showReviewAction = false,
  reviewTarget,
  reviewBasePath = `${SYSTEM_ROUTE_PREFIX}/settings/industry-verification`,
}: LegacyIndustryEvidenceNoticeProps) {
  const { t } = useTranslation()
  const reviewHref = reviewTarget
    ? `${reviewBasePath}/proposals/${encodeURIComponent(reviewTarget.proposalId)}`
    : `${reviewBasePath}?status=ready_for_review`

  if (compact) {
    return (
      <Badge
        data-testid="legacy-industry-evidence-badge"
        variant="outline"
        className="border-slate-300 bg-slate-50 text-slate-700 text-[10px]"
      >
        <CircleAlert className="mr-1 h-3 w-3" aria-hidden="true" />
        {t('industryEvidence.legacySignalBadge', {
          defaultValue: 'Legacy rules signal',
        })}
      </Badge>
    )
  }

  return (
    <section
      data-testid="legacy-industry-evidence-notice"
      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-slate-900">
            {t('industryEvidence.legacySignalTitle', {
              defaultValue: 'Industry evidence needs human review',
            })}
          </p>
          <p>
            {t('industryEvidence.legacySignalDescription', {
              defaultValue: 'This is a legacy rules signal, not human-reviewed industry evidence. Approving evidence for an employer updates every linked resume with trusted evidence.',
            })}
          </p>
          {showReviewAction ? (
            <a
              className="inline-flex items-center gap-1 font-medium text-slate-900 underline underline-offset-4 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
              href={reviewHref}
            >
              {reviewTarget
                ? t('industryEvidence.legacySignalReviewTargetAction', {
                    defaultValue: 'Review {{company}}',
                    company: reviewTarget.employerLabel,
                  })
                : t('industryEvidence.legacySignalReviewAction', {
                    defaultValue: 'Review industry evidence',
                  })}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}
