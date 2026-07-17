import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CompanyPolicyMatchHit } from '@trends/shared'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type CompanyPolicyBadgesProps = {
  hits: CompanyPolicyMatchHit[]
  className?: string
  /** Show compact badges only (list cards) vs full warning strip */
  variant?: 'badges' | 'banner'
}

function badgeClass(preset: CompanyPolicyMatchHit['preset']): string {
  if (preset === 'no_hire') {
    return 'border-red-300 bg-red-50 text-red-700'
  }
  if (preset === 'known_good') {
    return 'border-emerald-300 bg-emerald-50 text-emerald-800'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function CompanyPolicyBadges({
  hits,
  className,
  variant = 'badges',
}: CompanyPolicyBadgesProps) {
  const { t } = useTranslation()
  const visible = useMemo(
    () => hits.filter((hit) => hit.preset === 'no_hire' || hit.preset === 'known_good'),
    [hits],
  )

  if (visible.length === 0) {
    return null
  }

  if (variant === 'banner') {
    const noHire = visible.filter((hit) => hit.preset === 'no_hire')
    const knownGood = visible.filter((hit) => hit.preset === 'known_good')
    return (
      <div className={cn('space-y-1', className)} data-testid="company-policy-banner">
        {noHire.map((hit) => (
          <div
            key={`no-hire-${hit.companyKey}`}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            data-testid="company-policy-warning"
            data-company-key={hit.companyKey}
          >
            <span className="font-semibold">
              {t('settings.policies.runtime.noHireWarning', {
                defaultValue: 'No-hire employer',
              })}
              {': '}
            </span>
            {hit.displayName}
            <span className="text-red-700/80">
              {' '}
              (
              {t('settings.policies.runtime.matchedAs', {
                defaultValue: 'matched',
              })}
              : {hit.matchedEmployer})
            </span>
            <div className="mt-0.5 text-[11px] text-red-700/80">
              {t('settings.policies.runtime.scoreUnchanged', {
                defaultValue: 'Operational policy only — AI score is unchanged.',
              })}
            </div>
          </div>
        ))}
        {knownGood.map((hit) => (
          <div
            key={`good-${hit.companyKey}`}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
            data-testid="company-policy-known-good"
            data-company-key={hit.companyKey}
          >
            <span className="font-semibold">
              {t('settings.policies.runtime.knownGoodSignal', {
                defaultValue: 'Known-good employer',
              })}
              {': '}
            </span>
            {hit.displayName}
            <span className="text-emerald-800/80">
              {' '}
              (
              {t('settings.policies.runtime.matchedAs', {
                defaultValue: 'matched',
              })}
              : {hit.matchedEmployer})
            </span>
            <div className="mt-0.5 text-[11px] text-emerald-800/80">
              {t('settings.policies.runtime.scoreUnchanged', {
                defaultValue: 'Operational policy only — AI score is unchanged.',
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className={cn('flex flex-wrap gap-1', className)} data-testid="company-policy-badges">
        {visible.map((hit) => {
          const label =
            hit.preset === 'no_hire'
              ? t('settings.policies.runtime.noHireBadge', { defaultValue: 'No-hire co.' })
              : t('settings.policies.runtime.knownGoodBadge', { defaultValue: 'Known-good co.' })
          return (
            <Tooltip key={hit.companyKey}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn('text-[10px] cursor-help', badgeClass(hit.preset))}
                  data-testid={
                    hit.preset === 'no_hire'
                      ? 'company-policy-badge-no-hire'
                      : 'company-policy-badge-known-good'
                  }
                  data-company-key={hit.companyKey}
                >
                  {label}: {hit.displayName}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p className="font-medium">{hit.displayName}</p>
                <p>
                  {t('settings.policies.runtime.matchedAs', { defaultValue: 'matched' })}:{' '}
                  {hit.matchedEmployer}
                </p>
                <p className="opacity-80">
                  {t('settings.policies.runtime.scoreUnchanged', {
                    defaultValue: 'Operational policy only — AI score is unchanged.',
                  })}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
