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
  /** Compact chips in header row vs one-line notice under header */
  variant?: 'badges' | 'banner'
}

function shortCompanyLabel(hit: CompanyPolicyMatchHit): string {
  const parts = hit.displayName.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    return hit.displayName
  }
  return parts.reduce((shortest, part) => (part.length < shortest.length ? part : shortest), parts[0]!)
}

/** Workspace-relative policies settings path (no WorkspaceProvider required). */
function companyPoliciesHref(): string {
  if (typeof window !== 'undefined') {
    const seg = window.location.pathname.split('/').filter(Boolean)[0]
    if (seg && !['login', 'api', 's', 'explanation'].includes(seg)) {
      return `/${seg}/settings/policies?tab=companies`
    }
  }
  return '/hr/settings/policies?tab=companies'
}

/** Workspace-relative research page for a company (HR persona default). */
function companyResearchHref(companyKey: string): string {
  if (typeof window !== 'undefined') {
    const seg = window.location.pathname.split('/').filter(Boolean)[0]
    if (seg && !['login', 'api', 's', 'explanation'].includes(seg)) {
      return `/${seg}/research/${encodeURIComponent(companyKey)}?persona=hr`
    }
  }
  return `/hr/research/${encodeURIComponent(companyKey)}?persona=hr`
}

function badgeClass(preset: CompanyPolicyMatchHit['preset']): string {
  if (preset === 'no_hire') {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  if (preset === 'known_good') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function noticeClass(preset: CompanyPolicyMatchHit['preset']): string {
  if (preset === 'no_hire') {
    return 'border-red-200 bg-red-50 text-red-800'
  }
  if (preset === 'known_good') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  }
  return 'border-slate-200 bg-slate-50 text-slate-800'
}

export function CompanyPolicyBadges({
  hits,
  className,
  variant = 'badges',
}: CompanyPolicyBadgesProps) {
  const { t } = useTranslation()
  const policiesHref = companyPoliciesHref()

  const visible = useMemo(
    () => hits.filter((hit) => hit.preset === 'no_hire' || hit.preset === 'known_good'),
    [hits],
  )

  if (visible.length === 0) {
    return null
  }

  if (variant === 'banner') {
    return (
      <div className={cn('space-y-1', className)} data-testid="company-policy-banner">
        {visible.map((hit) => {
          const shortName = shortCompanyLabel(hit)
          const kindLabel =
            hit.preset === 'no_hire'
              ? t('settings.policies.runtime.noHireShort', { defaultValue: 'No-hire' })
              : t('settings.policies.runtime.knownGoodShort', { defaultValue: 'Known-good' })
          return (
            <div
              key={`${hit.preset}-${hit.companyKey}`}
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-1.5 text-xs',
                noticeClass(hit.preset),
              )}
              data-testid={
                hit.preset === 'no_hire' ? 'company-policy-warning' : 'company-policy-known-good'
              }
              data-company-key={hit.companyKey}
            >
              <span className="font-semibold">
                {kindLabel}
                {': '}
                {shortName}
              </span>
              {hit.matchedEmployer && hit.matchedEmployer !== shortName ? (
                <span className="opacity-80 truncate max-w-[14rem]" title={hit.matchedEmployer}>
                  ({hit.matchedEmployer})
                </span>
              ) : null}
              <a
                href={companyResearchHref(hit.companyKey)}
                className="shrink-0 font-medium underline-offset-2 hover:underline"
                data-testid="company-policy-research-link"
              >
                {t('settings.policies.runtime.researchLink', { defaultValue: 'Research' })}
              </a>
              <a
                href={policiesHref}
                className="ml-auto shrink-0 font-medium underline-offset-2 hover:underline"
                data-testid="company-policy-manage-link"
              >
                {t('settings.policies.runtime.manageLink', { defaultValue: 'Manage' })}
              </a>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className={cn('flex flex-wrap gap-1', className)} data-testid="company-policy-badges">
        {visible.map((hit) => {
          const shortName = shortCompanyLabel(hit)
          const chipLabel =
            hit.preset === 'no_hire'
              ? t('settings.policies.runtime.noHireShort', { defaultValue: 'No-hire' })
              : t('settings.policies.runtime.knownGoodShort', { defaultValue: 'Known-good' })
          return (
            <Tooltip key={hit.companyKey}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn('max-w-[9rem] truncate text-[10px] cursor-help', badgeClass(hit.preset))}
                  data-testid={
                    hit.preset === 'no_hire'
                      ? 'company-policy-badge-no-hire'
                      : 'company-policy-badge-known-good'
                  }
                  data-company-key={hit.companyKey}
                  title={`${chipLabel}: ${shortName}`}
                >
                  {chipLabel}
                  {shortName ? ` · ${shortName}` : ''}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1 text-xs">
                <p className="font-medium">
                  {chipLabel}: {shortName}
                </p>
                {hit.matchedEmployer ? (
                  <p className="opacity-80">{hit.matchedEmployer}</p>
                ) : null}
                <a
                  href={policiesHref}
                  className="inline-block font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('settings.policies.runtime.manageLink', { defaultValue: 'Manage' })}
                </a>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
