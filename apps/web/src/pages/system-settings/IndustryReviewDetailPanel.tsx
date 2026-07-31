import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type DetailProposal = {
  proposalId: string
  companyKey?: string
  normalizedEmployerSurface?: string
  triggerReasons: string[]
  status: string
  priority: number
}

type DetailProfile = {
  verificationLevel?: string
  currentRevisionId?: string
  freshnessState?: string
}

type IndustryReviewDetailPanelProps = {
  proposal?: DetailProposal
  profile?: DetailProfile | null
  saving: boolean
  readOnly?: boolean
  canMove?: boolean
  onPrevious?: () => void
  onNext?: () => void
  children: ReactNode
}

function companyLabel(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

export function IndustryReviewDetailPanel({
  proposal,
  profile,
  saving,
  readOnly = false,
  canMove = false,
  onPrevious,
  onNext,
  children,
}: IndustryReviewDetailPanelProps) {
  const { t } = useTranslation()

  if (!proposal) {
    return (
      <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground" data-testid="industry-review-detail-empty">
        {t('industryEvidence.selectProposal', { defaultValue: 'Select a proposal to review its evidence.' })}
      </div>
    )
  }

  return (
    <div className="space-y-5" data-testid="industry-review-detail-panel">
      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {companyLabel(proposal.companyKey ?? proposal.normalizedEmployerSurface)}
              </h3>
              {readOnly ? (
                <Badge variant="outline">
                  {t('industryEvidence.historyReadOnly', { defaultValue: 'Read-only record' })}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {proposal.triggerReasons.join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canMove ? (
              <>
                <Button type="button" size="sm" variant="outline" onClick={onPrevious} disabled={saving} aria-label={t('industryEvidence.previousProposal', { defaultValue: 'Previous proposal' })}>
                  <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                  {t('industryEvidence.previous', { defaultValue: 'Previous' })}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onNext} disabled={saving} aria-label={t('industryEvidence.nextProposal', { defaultValue: 'Next proposal' })}>
                  {t('industryEvidence.next', { defaultValue: 'Next' })}
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
              </>
            ) : null}
            <Badge variant="secondary">P{proposal.priority}</Badge>
            <Badge>{proposal.status}</Badge>
          </div>
        </div>
        <div className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
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
        </div>
      </div>
      {children}
    </div>
  )
}
