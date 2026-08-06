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

function formatDate(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null
  }
  return new Intl.DateTimeFormat('en', {
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

function sourceAccessibleName(source: IndustryEvidenceSourcePreview): string {
  return `${sourceTypeLabels[source.sourceType]} source from ${source.sourceDomain}`
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
  const title = source.title ?? `${sourceTypeLabels[source.sourceType]} evidence`

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={sourceAccessibleName(source)}
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
        {sourceTypeLabels[source.sourceType]}
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
                  {source.sourceDomain} · {sourceTypeLabels[source.sourceType]}
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
                Reviewed source; no excerpt is available.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {trustLabels[source.trustTier]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-800">
                <Check className="h-3 w-3" aria-hidden="true" />
                Human approved
              </span>
            </div>
            {(formatDate(source.reviewedAt) || formatDate(source.fetchedAt)) ? (
              <div className="mt-3 text-[11px] leading-5 text-slate-500">
                {formatDate(source.reviewedAt) ? `Reviewed ${formatDate(source.reviewedAt)}` : null}
                {formatDate(source.reviewedAt) && formatDate(source.fetchedAt) ? ' · ' : null}
                {formatDate(source.fetchedAt) ? `Fetched ${formatDate(source.fetchedAt)}` : null}
              </div>
            ) : null}
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Open source
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>,
          document.body,
        )
        : null}
    </>
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
  const { t } = useTranslation()
  const indLabel = industryLabel(summary.industryClass)
  const badgeLabel = t('resumes.card.industryVerifiedBadge', {
    industry: indLabel,
    defaultValue: `${indLabel} Verified`,
  })
  const reviewedDate = formatDate(summary.reviewedAt)
  const verificationPathExplanation = summary.reviewedBy
    ? `Human-verified by ${summary.reviewedBy}${reviewedDate ? ` on ${reviewedDate}` : ''} based on ${summary.sourceCount} approved evidence source(s).`
    : `Auto-verified ${indLabel} industry employer based on ${summary.sourceCount} corroborating evidence source(s).`

  return (
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
          {onCompanyClick ? (
            <div className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1">
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Click to filter candidate search by this company
            </div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const { t } = useTranslation()
  const selection = selectPrimaryIndustryEvidence(summaries, {
    preferredRoleTypes,
  })
  if (!selection) {
    return null
  }

  const { primary, additionalVerifiedEmployerCount } = selection
  const reviewedDate = formatDate(primary.reviewedAt)
  const employerSuffix = additionalVerifiedEmployerCount === 1
    ? 'verified employer'
    : 'verified employers'
  const indLabel = industryLabel(primary.industryClass)
  const badgeLabel = t('resumes.card.industryVerifiedBadge', {
    industry: indLabel,
    defaultValue: `${indLabel} Verified`,
  })
  const verificationPathExplanation = primary.reviewedBy
    ? `Human-verified by ${primary.reviewedBy}${reviewedDate ? ` on ${reviewedDate}` : ''} based on ${primary.sourceCount} approved evidence source(s).`
    : `Auto-verified ${indLabel} industry employer based on ${primary.sourceCount} corroborating evidence source(s).`

  return (
    <section
      aria-label={`Approved industry evidence for ${primary.companyName}`}
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
                {indLabel} Industry Verification Status
              </div>
              <p>{verificationPathExplanation}</p>
              <p className="text-[11px] text-slate-300 italic">
                Confirms registered manufacturing & enterprise capabilities for candidate search filtering.
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
                  <span className="text-slate-400">Industry:</span>{' '}
                  <span className="font-medium text-slate-200">{indLabel}</span>
                </div>
                <div>
                  <span className="text-slate-400">Approved Sources:</span>{' '}
                  <span className="font-medium text-slate-200">{primary.sourceCount}</span>
                </div>
                {primary.roleTypes && primary.roleTypes.length > 0 ? (
                  <div className="col-span-2">
                    <span className="text-slate-400">Relevant Roles:</span>{' '}
                    <span className="font-medium text-slate-200 capitalize">{primary.roleTypes.join(', ')}</span>
                  </div>
                ) : null}
              </div>
              {onCompanyClick ? (
                <div className="pt-1 text-[11px] font-medium text-emerald-300 flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  Click to filter candidate search by this company
                </div>
              ) : null}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {typeof primary.verifiedYears === 'number' && primary.verifiedYears > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help text-xs font-medium text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  {primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1)} verified years
                </span>
              </TooltipTrigger>
              <TooltipContent className="p-2.5 text-xs bg-slate-900 text-white max-w-xs">
                <p className="font-semibold text-emerald-400 mb-0.5">Verified Experience Duration</p>
                <p>
                  Calculated from {primary.verifiedYears.toFixed(primary.verifiedYears % 1 === 0 ? 0 : 1)} years of candidate work history at this confirmed {indLabel} industry employer.
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
            +{primary.additionalSourceCount} sources
          </span>
        ) : null}
        <span className="text-[11px] text-slate-500">
          {primary.sourceCount} approved {primary.sourceCount === 1 ? 'source' : 'sources'}
          {reviewedDate ? ` · reviewed ${reviewedDate}` : ''}
        </span>
        {additionalVerifiedEmployerCount > 0 ? (
          <span className="ml-auto text-[11px] font-semibold text-emerald-800">
            +{additionalVerifiedEmployerCount} {employerSuffix}
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
          Approved industry evidence
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">
          Human-reviewed evidence materialized with this resume. No live web research runs on this page.
        </p>
      </div>
      {approvedSummaries.map((summary) => {
        const refreshStatus = refreshStatuses[summary.verdictRevisionId] ?? 'idle'
        const reviewDate = formatDate(summary.reviewedAt)
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
                    {industryLabel(summary.industryClass)} 行业验证
                  </Badge>
                  <span className="font-semibold text-slate-950">{summary.companyName}</span>
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
                aria-label={`Request refresh for ${summary.companyName}`}
                onClick={() => void requestRefresh(summary)}
              >
                <RefreshCw
                  className={cn('mr-1.5 h-3.5 w-3.5', refreshStatus === 'requesting' && 'animate-spin')}
                  aria-hidden="true"
                />
                {refreshStatus === 'requesting'
                  ? 'Requesting…'
                  : refreshStatus === 'requested'
                    ? 'Requested'
                    : 'Request refresh'}
              </Button>
            </div>

            {refreshStatus === 'requested' ? (
              <p className="mt-2 text-xs font-medium text-emerald-700">
                Refresh requested
              </p>
            ) : null}
            {refreshStatus === 'error' ? (
              <p role="alert" className="mt-2 text-xs font-medium text-red-700">
                Refresh request could not be submitted. The approved verdict remains unchanged.
              </p>
            ) : null}

            <dl className="mt-3 grid gap-2 rounded-xl border border-emerald-100 bg-white/80 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Verdict</dt>
                <dd className="font-medium text-slate-900">Approved revision</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reviewed</dt>
                <dd className="font-medium text-slate-900">{reviewDate ?? '--'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reviewer</dt>
                <dd className="font-medium text-slate-900">{summary.reviewedBy ?? 'Human approved'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Freshness</dt>
                <dd className="font-medium capitalize text-slate-900">
                  {summary.freshnessState?.replace(/_/g, ' ') ?? 'Current approved evidence'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Canonical company</dt>
                <dd className="break-all font-mono text-[11px] text-slate-900">{summary.companyKey}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Revision ID</dt>
                <dd className="break-all font-mono text-[11px] text-slate-900">{summary.verdictRevisionId}</dd>
              </div>
            </dl>

            <div className="mt-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Approved sources
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
                  Source previews are not available in this materialized projection.
                </p>
              )}
              {summary.additionalSourceCount > 0 ? (
                <p className="text-xs text-slate-500">
                  {summary.additionalSourceCount} additional approved {summary.additionalSourceCount === 1 ? 'source' : 'sources'}
                </p>
              ) : null}
            </div>
          </article>
        )
      })}
    </section>
  )
}
