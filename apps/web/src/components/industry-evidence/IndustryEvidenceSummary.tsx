import {
  Building2,
  Check,
  ExternalLink,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  IndustryEvidenceSourcePreview,
  IndustryEvidenceSourceType,
  IndustryEvidenceTrustTier,
  VerifiedIndustryEvidenceSummary,
} from '@trends/shared'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { rawApiClient } from '@/lib/api-helpers'
import type { paths } from '@/lib/api-types'
import { cn } from '@/lib/utils'
import {
  selectPrimaryIndustryEvidence,
  getOfficialSiteUrl,
} from '@/components/industry-evidence/industry-evidence'

const sourceTypeLabels: Record<
  Exclude<IndustryEvidenceSourceType, 'search_result'>,
  string
> = {
  official_site: 'Official',
  registry: 'SSM / MSIC',
  taxonomy: 'Taxonomy',
  oem_partner: 'OEM',
  trade_body: 'Trade body',
  directory: 'Directory',
  reporting: 'Reporting',
  other: 'Reviewed',
}

const trustLabels: Record<
  Exclude<IndustryEvidenceTrustTier, 'discovery'>,
  string
> = {
  primary: 'Trusted primary source',
  authoritative: 'Trusted authoritative source',
  corroborating: 'Reviewed corroborating source',
}

function formatDate(value: number | undefined, locale?: string): string | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null
  }
  return new Intl.DateTimeFormat(locale ?? 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function industryLabel(industryClass: string): string {
  return industryClass === 'cnc'
    ? 'CNC'
    : industryClass.replace(/_/g, ' ').toUpperCase()
}

function sourceAccessibleName(
  source: IndustryEvidenceSourcePreview,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  return t('industryEvidence.sourceAccessibleName', {
    label: t(`industryEvidence.sourceType.${source.sourceType}`, {
      defaultValue: sourceTypeLabels[source.sourceType],
    }),
    domain: source.sourceDomain,
    defaultValue: `${sourceTypeLabels[source.sourceType]} source from ${source.sourceDomain}`,
  })
}

function stopCardInteraction(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation()
}

type PreviewPosition = {
  left: number
  top: number
  width: number
}

function getPreviewPosition(trigger: HTMLElement): PreviewPosition {
  const rect = trigger.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const width = Math.min(360, Math.max(280, viewportWidth - 24))
  const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
  const estimatedHeight = 280
  const placeAbove = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight
  return {
    left,
    top: placeAbove
      ? Math.max(12, rect.top - estimatedHeight - 8)
      : rect.bottom + 8,
    width,
  }
}

function IndustryEvidenceSourceChip({
  source,
  compact = true,
}: {
  source: IndustryEvidenceSourcePreview
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const previewId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedByHoverRef = useRef(false)
  const openedByFocusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PreviewPosition | null>(null)

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  const openPreview = () => {
    cancelScheduledClose()
    setOpen(true)
  }
  const scheduleClose = () => {
    cancelScheduledClose()
    closeTimerRef.current = setTimeout(() => {
      openedByHoverRef.current = false
      setOpen(false)
    }, 120)
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return
    }
    setPosition(getPreviewPosition(triggerRef.current))
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        openedByHoverRef.current = false
        setOpen(false)
      }
    }
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !previewRef.current?.contains(target)
      ) {
        openedByHoverRef.current = false
        setOpen(false)
      }
    }
    const reposition = () => {
      if (triggerRef.current) {
        setPosition(getPreviewPosition(triggerRef.current))
      }
    }

    document.addEventListener('keydown', dismissOnEscape)
    document.addEventListener('pointerdown', dismissOutside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('keydown', dismissOnEscape)
      document.removeEventListener('pointerdown', dismissOutside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => () => cancelScheduledClose(), [])

  const previewStyle: CSSProperties | undefined = position
    ? {
      left: position.left,
      top: position.top,
      width: position.width,
    }
    : undefined
  const title = source.title ?? t('industryEvidence.sourceTitleFallback', {
    label: t(`industryEvidence.sourceType.${source.sourceType}`, {
      defaultValue: sourceTypeLabels[source.sourceType],
    }),
    defaultValue: `${sourceTypeLabels[source.sourceType]} evidence`,
  })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={sourceAccessibleName(source, t)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? previewId : undefined}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white font-medium text-emerald-800 shadow-sm transition-colors',
          'hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
          compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
        )}
        onClick={(event) => {
          stopCardInteraction(event)
          if ((openedByHoverRef.current || openedByFocusRef.current) && open) {
            openedByHoverRef.current = false
            openedByFocusRef.current = false
            return
          }
          setOpen((current) => !current)
        }}
        onMouseEnter={() => {
          openedByHoverRef.current = true
          openPreview()
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          openedByFocusRef.current = true
          openPreview()
        }}
        onBlur={(event) => {
          openedByFocusRef.current = false
          const nextTarget = event.relatedTarget
          if (!(nextTarget instanceof Node) || !previewRef.current?.contains(nextTarget)) {
            scheduleClose()
          }
        }}
      >
        <FileCheck2 className="h-3 w-3" aria-hidden="true" />
        {t(`industryEvidence.sourceType.${source.sourceType}`, {
          defaultValue: sourceTypeLabels[source.sourceType],
        })}
      </button>
      {open && position && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={previewRef}
            id={previewId}
            role="dialog"
            aria-label={title}
            className="fixed z-[100] rounded-2xl border border-slate-200 bg-white p-4 text-left text-slate-700 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.45)]"
            style={previewStyle}
            onClick={stopCardInteraction}
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={scheduleClose}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget
              if (
                !(nextTarget instanceof Node) ||
                (
                  !triggerRef.current?.contains(nextTarget) &&
                  !previewRef.current?.contains(nextTarget)
                )
              ) {
                setOpen(false)
              }
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-sm font-semibold uppercase text-emerald-700">
                {source.sourceDomain.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-500">
                  {source.sourceDomain} · {t(`industryEvidence.sourceType.${source.sourceType}`, {
                    defaultValue: sourceTypeLabels[source.sourceType],
                  })}
                </div>
                <div className="mt-0.5 text-sm font-semibold leading-5 text-slate-950">
                  {title}
                </div>
              </div>
            </div>
            {source.evidenceExcerpt ? (
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {source.evidenceExcerpt}
              </p>
            ) : (
              <p className="mt-3 text-sm italic text-slate-500">
                {t('industryEvidence.noExcerpt', { defaultValue: 'Reviewed source; no excerpt is available.' })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {t(`industryEvidence.trustTier.${source.trustTier}`, {
                  defaultValue: trustLabels[source.trustTier],
                })}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-800">
                <Check className="h-3 w-3" aria-hidden="true" />
                {t('industryEvidence.humanApproved', { defaultValue: 'Human approved' })}
              </span>
            </div>
            {(formatDate(source.reviewedAt, i18n.language) || formatDate(source.fetchedAt, i18n.language)) ? (
              <div className="mt-3 text-[11px] leading-5 text-slate-500">
                {formatDate(source.reviewedAt, i18n.language)
                  ? t('industryEvidence.reviewedOn', {
                    date: formatDate(source.reviewedAt, i18n.language),
                    defaultValue: `Reviewed ${formatDate(source.reviewedAt)}`,
                  })
                  : null}
                {formatDate(source.reviewedAt, i18n.language) && formatDate(source.fetchedAt, i18n.language) ? ' · ' : null}
                {formatDate(source.fetchedAt, i18n.language)
                  ? t('industryEvidence.fetchedOn', {
                    date: formatDate(source.fetchedAt, i18n.language),
                    defaultValue: `Fetched ${formatDate(source.fetchedAt)}`,
                  })
                  : null}
              </div>
            ) : null}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {t('industryEvidence.openSource', { defaultValue: 'Open source' })}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>,
          document.body,
        )
        : null}
    </>
  )
}

/**
 * Small clickable external-link anchor that opens the company's official
 * homepage in a new tab. Rendered alongside the verified badge in work
 * history lists so recruiters can jump directly to the company site.
 */
export function OfficialSiteLink({
  url,
  companyName,
  className,
}: {
  url: string
  companyName: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('industryEvidence.openOfficialWebsite', {
        companyName,
        defaultValue: `Open official website for ${companyName}`,
      })}
      title={url}
      onClick={stopCardInteraction}
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-sm transition-colors',
        'hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1',
        'h-5 w-5 shrink-0',
        className,
      )}
    >
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  )
}

export function VerifiedCompanyBadge({
  summary,
  onCompanyClick,
  className,
}: {
  summary: VerifiedIndustryEvidenceSummary
  onCompanyClick?: (companyName: string) => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const indLabel = industryLabel(summary.industryClass)
  const badgeLabel = t('resumes.card.industryVerifiedBadge', {
    industry: indLabel,
    defaultValue: `${indLabel} Verified`,
  })
  const reviewedDate = formatDate(summary.reviewedAt, i18n.language)
  const verificationPathExplanation = summary.reviewedBy
    ? reviewedDate
      ? t('industryEvidence.verifiedPathHumanWithDate', {
        reviewer: summary.reviewedBy,
        count: summary.sourceCount,
        date: reviewedDate,
        defaultValue: `Human-verified by ${summary.reviewedBy} based on ${summary.sourceCount} approved evidence source(s) on ${reviewedDate}.`,
      })
      : t('industryEvidence.verifiedPathHuman', {
        reviewer: summary.reviewedBy,
        count: summary.sourceCount,
        defaultValue: `Human-verified by ${summary.reviewedBy} based on ${summary.sourceCount} approved evidence source(s).`,
      })
    : t('industryEvidence.verifiedPathAuto', {
      industry: indLabel,
      count: summary.sourceCount,
      defaultValue: `Auto-verified ${indLabel} industry employer based on ${summary.sourceCount} corroborating evidence source(s).`,
    })
  const officialSiteUrl = getOfficialSiteUrl(summary)

  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={cn(
                'inline-flex items-center gap-0.5 border border-emerald-700 bg-emerald-700 text-white text-[10px] py-0 px-1.5 font-medium transition-colors shrink-0',
                onCompanyClick ? 'cursor-pointer hover:bg-emerald-800' : 'cursor-help hover:bg-emerald-800',
                className,
              )}
              onClick={(e) => {
                if (onCompanyClick) {
                  e.stopPropagation()
                  onCompanyClick(summary.companyName)
                }
              }}
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {badgeLabel}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs p-3 text-xs bg-slate-900 text-white space-y-1.5 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/20 pb-1 gap-2">
              <span className="font-semibold text-emerald-400">{summary.companyName}</span>
              <Badge variant="outline" className="border-emerald-500/50 bg-emerald-950/60 text-emerald-300 font-mono text-[10px]">
                {badgeLabel}
              </Badge>
            </div>
            <p>{verificationPathExplanation}</p>
            {summary.evidenceSummary ? (
              <p className="text-[11px] text-slate-300 line-clamp-2">
                {summary.evidenceSummary}
              </p>
            ) : null}
            {officialSiteUrl ? (
              <a
                href={officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {officialSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            ) : null}
            {onCompanyClick ? (
              <div className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1">
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {t('industryEvidence.filterByCompany', { defaultValue: 'Click to filter candidate search by this company' })}
              </div>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {officialSiteUrl ? (
        <OfficialSiteLink url={officialSiteUrl} companyName={summary.companyName} />
      ) : null}
    </div>
  )
}

export function IndustryEvidenceSummary({
  summaries,
  preferredRoleTypes,
  onCompanyClick,
  className,
}: {
  summaries: readonly unknown[]
  preferredRoleTypes?: readonly string[]
  onCompanyClick?: (companyName: string) => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const selection = selectPrimaryIndustryEvidence(summaries, {
    preferredRoleTypes,
  })
  if (!selection) {
    return null
  }

  const { primary, additionalVerifiedEmployerCount } = selection
  const reviewedDate = formatDate(primary.reviewedAt, i18n.language)
  const employerSuffix = additionalVerifiedEmployerCount === 1
    ? t('industryEvidence.verifiedEmployerOne', { defaultValue: 'verified employer' })
    : t('industryEvidence.verifiedEmployerOther', { defaultValue: 'verified employers' })
  const indLabel = industryLabel(primary.industryClass)
  const badgeLabel = t('resumes.card.industryVerifiedBadge', {
    industry: indLabel,
    defaultValue: `${indLabel} Verified`,
  })
  const verificationPathExplanation = primary.reviewedBy
    ? reviewedDate
      ? t('industryEvidence.verifiedPathHumanWithDate', {
        reviewer: primary.reviewedBy,
        count: primary.sourceCount,
        date: reviewedDate,
        defaultValue: `Human-verified by ${primary.reviewedBy} based on ${primary.sourceCount} approved evidence source(s) on ${reviewedDate}.`,
      })
      : t('industryEvidence.verifiedPathHuman', {
        reviewer: primary.reviewedBy,
        count: primary.sourceCount,
        defaultValue: `Human-verified by ${primary.reviewedBy} based on ${primary.sourceCount} approved evidence source(s).`,
      })
    : t('industryEvidence.verifiedPathAuto', {
      industry: indLabel,
      count: primary.sourceCount,
      defaultValue: `Auto-verified ${indLabel} industry employer based on ${primary.sourceCount} corroborating evidence source(s).`,
    })
  const primaryOfficialSiteUrl = getOfficialSiteUrl(primary)

  return (
    <section
      aria-label={t('industryEvidence.approvedEvidenceFor', {
        companyName: primary.companyName,
        defaultValue: `Approved industry evidence for ${primary.companyName}`,
      })}
      className={cn(
        'rounded-2xl border border-emerald-200/90 bg-gradient-to-r from-emerald-50/90 via-emerald-50/40 to-white px-3.5 py-2.5 shadow-sm transition-all',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="cursor-help border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800 transition-colors">
                <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {badgeLabel}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs p-3 text-xs bg-slate-900 text-white space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400 border-b border-white/20 pb-1 mb-1">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {t('industryEvidence.industryVerifiedStatus', {
                  industry: indLabel,
                  defaultValue: `${indLabel} Industry Verification Status`,
                })}
              </div>
              <p>{verificationPathExplanation}</p>
              <p className="text-[11px] text-slate-300 italic">
                {t('industryEvidence.verificationStatusDescription', {
                  defaultValue: 'Confirms registered manufacturing & enterprise capabilities for candidate search filtering.',
                })}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role={onCompanyClick ? 'button' : undefined}
                className={cn(
                  'text-sm font-semibold text-slate-950 flex items-center gap-1 rounded px-1 -mx-1 transition-colors',
                  onCompanyClick ? 'cursor-pointer hover:text-emerald-800 hover:bg-emerald-100/60' : 'cursor-help hover:bg-emerald-100/50',
                )}
                onClick={(e) => {
                  if (onCompanyClick) {
                    e.stopPropagation()
                    onCompanyClick(primary.companyName)
                  }
                }}
              >
                <Building2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                {primary.companyName}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm p-3 text-xs bg-slate-900 text-white space-y-1.5 shadow-xl">
              <div className="flex items-center justify-between border-b border-white/20 pb-1.5 gap-2">
                <span className="font-semibold text-emerald-400 text-sm">{primary.companyName}</span>
                <Badge variant="outline" className="border-emerald-500/50 bg-emerald-950/60 text-emerald-300 font-mono text-[10px]">
                  {primary.companyKey}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div>
                  <span className="text-slate-400">{t('industryEvidence.industryField', { defaultValue: 'Industry:' })}</span>{' '}
                  <span className="font-medium text-slate-200">{indLabel}</span>
                </div>
                <div>
                  <span className="text-slate-400">{t('industryEvidence.approvedSourcesLabel', { defaultValue: 'Approved sources:' })}</span>{' '}
                  <span className="font-medium text-slate-200">{primary.sourceCount}</span>
                </div>
                {primary.roleTypes && primary.roleTypes.length > 0 ? (
                  <div className="col-span-2">
                    <span className="text-slate-400">{t('industryEvidence.relevantRoles', { defaultValue: 'Relevant roles:' })}</span>{' '}
                    <span className="font-medium text-slate-200 capitalize">{primary.roleTypes.join(', ')}</span>
                  </div>
                ) : null}
              </div>
              {primaryOfficialSiteUrl ? (
                <a
                  href={primaryOfficialSiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {primaryOfficialSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              ) : null}
              {onCompanyClick ? (
                <div className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  {t('industryEvidence.filterByCompany', { defaultValue: 'Click to filter candidate search by this company' })}
                </div>
              ) : null}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {primaryOfficialSiteUrl ? (
          <OfficialSiteLink url={primaryOfficialSiteUrl} companyName={primary.companyName} />
        ) : null}

        {typeof primary.verifiedYears === 'number' && primary.verifiedYears > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help text-xs font-medium text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  {t('industryEvidence.verifiedYears', {
                    count: primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1),
                    defaultValue: `${primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1)} verified years`,
                  })}
                </span>
              </TooltipTrigger>
              <TooltipContent className="p-2.5 text-xs bg-slate-900 text-white max-w-xs">
                <p className="font-semibold text-emerald-400 mb-0.5">{t('industryEvidence.verifiedYearsTitle', { defaultValue: 'Verified Experience Duration' })}</p>
                <p>
                  {t('industryEvidence.verifiedYearsDescription', {
                    years: primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1),
                    industry: indLabel,
                    defaultValue: `Calculated from ${primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1)} years of candidate work history at this confirmed ${indLabel} industry employer.`,
                  })}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600">
        {primary.evidenceSummary}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {primary.sourcePreviews.map((source) => (
          <IndustryEvidenceSourceChip key={source.sourceId} source={source} />
        ))}
        {primary.additionalSourceCount > 0 ? (
          <span className="text-[11px] font-medium text-slate-500">
            {t('industryEvidence.additionalSources', {
              count: primary.additionalSourceCount,
              defaultValue: `+${primary.additionalSourceCount} sources`,
            })}
          </span>
        ) : null}
        <span className="text-[11px] text-slate-500">
          {t('industryEvidence.sourceCountLabel', {
            count: primary.sourceCount,
            sources: primary.sourceCount === 1 ? 'source' : 'sources',
            defaultValue: `${primary.sourceCount} approved ${primary.sourceCount === 1 ? 'source' : 'sources'}`,
          })}
          {reviewedDate ? t('industryEvidence.reviewedDateSuffix', {
            date: reviewedDate,
            defaultValue: ` · reviewed ${reviewedDate}`,
          }) : ''}
        </span>
        {additionalVerifiedEmployerCount > 0 ? (
          <span className="ml-auto text-[11px] font-semibold text-emerald-800">
            {t('industryEvidence.additionalEmployers', {
              count: additionalVerifiedEmployerCount,
              employers: employerSuffix,
              defaultValue: `+${additionalVerifiedEmployerCount} ${employerSuffix}`,
            })}
          </span>
        ) : null}
      </div>
    </section>
  )
}

type RefreshRequestResponse = paths['/api/company-industry-refresh-requests']['post']['responses'][200]['content']['application/json']

type RefreshStatus = 'idle' | 'requesting' | 'requested' | 'error'

export function IndustryEvidenceDetail({
  summaries,
  resumeId,
  className,
}: {
  summaries: readonly unknown[]
  resumeId?: string
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const approvedSummaries = summaries
    .map((summary) => selectPrimaryIndustryEvidence([summary])?.primary)
    .filter((summary): summary is VerifiedIndustryEvidenceSummary => Boolean(summary))
    .sort((left, right) =>
      right.reviewedAt - left.reviewedAt ||
      left.companyName.localeCompare(right.companyName),
    )
  const [refreshStatuses, setRefreshStatuses] = useState<Record<string, RefreshStatus>>({})

  if (approvedSummaries.length === 0) {
    return null
  }

  const requestRefresh = async (summary: VerifiedIndustryEvidenceSummary) => {
    setRefreshStatuses((current) => ({
      ...current,
      [summary.verdictRevisionId]: 'requesting',
    }))
    const { data, error } = await rawApiClient.POST<RefreshRequestResponse>(
      '/api/company-industry-refresh-requests',
      {
        body: {
          companyKey: summary.companyKey,
          verdictRevisionId: summary.verdictRevisionId,
          ...(resumeId ? { resumeId } : {}),
        },
      },
    )
    setRefreshStatuses((current) => ({
      ...current,
      [summary.verdictRevisionId]:
        !error && data?.success ? 'requested' : 'error',
    }))
  }

  return (
    <section className={cn('space-y-3', className)} aria-labelledby="industry-evidence-detail-heading">
      <div>
        <h3 id="industry-evidence-detail-heading" className="text-sm font-semibold text-slate-950">
          {t('industryEvidence.detailHeading', { defaultValue: 'Approved industry evidence' })}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          {t('industryEvidence.detailDescription', {
            defaultValue: 'Human-reviewed evidence materialized with this resume. No live web research runs on this page.',
          })}
        </p>
      </div>
      {approvedSummaries.map((summary) => {
        const refreshStatus = refreshStatuses[summary.verdictRevisionId] ?? 'idle'
        const reviewDate = formatDate(summary.reviewedAt, i18n.language)
        const detailOfficialSiteUrl = getOfficialSiteUrl(summary)
        return (
          <article
            key={summary.verdictRevisionId}
            className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-700">
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {t('industryEvidence.verifiedBadge', {
                      industry: industryLabel(summary.industryClass),
                      defaultValue: `${industryLabel(summary.industryClass)} Industry Verification`,
                    })}
                  </Badge>
                  <span className="font-semibold text-slate-950">{summary.companyName}</span>
                  {detailOfficialSiteUrl ? (
                    <a
                      href={detailOfficialSiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      {detailOfficialSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {summary.evidenceSummary}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={refreshStatus === 'requesting' || refreshStatus === 'requested'}
                aria-label={t('industryEvidence.requestRefreshFor', {
                  companyName: summary.companyName,
                  defaultValue: `Request refresh for ${summary.companyName}`,
                })}
                onClick={() => void requestRefresh(summary)}
              >
                <RefreshCw
                  className={cn('mr-1.5 h-3.5 w-3.5', refreshStatus === 'requesting' && 'animate-spin')}
                  aria-hidden="true"
                />
                {refreshStatus === 'requesting'
                  ? t('industryEvidence.requesting', { defaultValue: 'Requesting…' })
                  : refreshStatus === 'requested'
                    ? t('industryEvidence.requested', { defaultValue: 'Requested' })
                    : t('industryEvidence.requestRefresh', { defaultValue: 'Request refresh' })}
              </Button>
            </div>

            {refreshStatus === 'requested' ? (
              <p className="mt-2 text-xs font-medium text-emerald-700">
                {t('industryEvidence.refreshRequested', { defaultValue: 'Refresh requested' })}
              </p>
            ) : null}
            {refreshStatus === 'error' ? (
              <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                {t('industryEvidence.refreshError', {
                  defaultValue: 'Refresh request could not be submitted. The approved verdict remains unchanged.',
                })}
              </p>
            ) : null}

            <dl className="mt-3 grid gap-2 rounded-xl border border-emerald-100 bg-white/80 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">{t('industryEvidence.verdict', { defaultValue: 'Verdict' })}</dt>
                <dd className="font-medium text-slate-900">{t('industryEvidence.detailApprovedRevision', { defaultValue: 'Approved revision' })}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('industryEvidence.detailReviewed', { defaultValue: 'Reviewed' })}</dt>
                <dd className="font-medium text-slate-900">{reviewDate ?? '--'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('industryEvidence.detailReviewer', { defaultValue: 'Reviewer' })}</dt>
                <dd className="font-medium text-slate-900">{summary.reviewedBy ?? t('industryEvidence.humanApproved', { defaultValue: 'Human approved' })}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t('industryEvidence.detailFreshness', { defaultValue: 'Freshness' })}</dt>
                <dd className="font-medium capitalize text-slate-900">
                  {summary.freshnessState?.replace(/_/g, ' ') ?? t('industryEvidence.detailCurrentApproved', { defaultValue: 'Current approved evidence' })}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t('industryEvidence.detailCanonicalCompany', { defaultValue: 'Canonical company' })}</dt>
                <dd className="break-all font-mono text-[11px] text-slate-900">{summary.companyKey}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t('industryEvidence.detailRevisionId', { defaultValue: 'Revision ID' })}</dt>
                <dd className="break-all font-mono text-[11px] text-slate-900">{summary.verdictRevisionId}</dd>
              </div>
            </dl>

            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {t('industryEvidence.approvedSourcesTitle', { defaultValue: 'Approved sources' })}
              </div>
              {summary.sourcePreviews.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {summary.sourcePreviews.map((source) => (
                    <IndustryEvidenceSourceChip
                      key={source.sourceId}
                      source={source}
                      compact={false}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-slate-500">
                  {t('industryEvidence.sourcePreviewsUnavailable', {
                    defaultValue: 'Source previews are not available in this materialized projection.',
                  })}
                </p>
              )}
              {summary.additionalSourceCount > 0 ? (
                <p className="text-xs text-slate-500">
                  {t('industryEvidence.additionalApprovedSources', {
                    count: summary.additionalSourceCount,
                    sources: summary.additionalSourceCount === 1 ? 'source' : 'sources',
                    defaultValue: `${summary.additionalSourceCount} additional approved ${summary.additionalSourceCount === 1 ? 'source' : 'sources'}`,
                  })}
                </p>
              ) : null}
            </div>
          </article>
        )
      })}
    </section>
  )
}
