import { buildWorkHistoryDisplayDateLine, buildWorkHistoryEntryText, hasActiveOverride, selectLatestWorkHistory, type CandidatePolicyOverride } from '@trends/shared'
import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Link2,
  User,
  XCircle,
} from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ResumeRefreshBadge } from '@/components/ResumeRefreshBadge'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'
import { StarRating } from '@/components/StarRating'
import { CandidateNotesDialog } from '@/components/CandidateNotesDialog'
import { getResumeContentLocale, getResumeSourceLabel, getExperienceBadge, isSafeProfileUrl, summarizeBrandHits, toDisplayMatchBreakdown } from '@/lib/resume-scoring'
import { getResumeCompanyPolicyState, toastCompanyPolicyWorkflowBlocked } from '@/lib/company-policy-runtime'
import { toast } from 'sonner'
import { highlightTerms } from '@/lib/highlight'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'
import { getScoreClassName } from '@/lib/score-classes'
import { cn } from '@/lib/utils'
import type { CandidateActionType, CandidateStatus, AiFeedbackSentiment, AiFeedbackTarget } from '@/types/resume'
import { ConfirmedScoreBadge } from '@/components/ConfirmedScoreBadge'
import { CompanyPolicyBadges } from '@/components/CompanyPolicyBadges'
import { useCompanyPolicyIndex } from '@/hooks/useCompanyPolicyIndex'
import { useResumeWorkHistoryLimit } from '@/contexts/ResumeWorkHistoryLimitContext'
import { IndustryEvidenceSummary, VerifiedCompanyBadge } from '@/components/industry-evidence/IndustryEvidenceSummary'
import { findVerifiedIndustrySummaryForCompany, getVerifiedIndustryEvidenceSummaries } from '@/components/industry-evidence/industry-evidence'

type SnippetCardProps = {
  expanded: boolean
  item: ResumeSearchResultItem
  itemKey: string
  showAiScore?: boolean
  /** When true (deep link target), the card renders with a highlight ring. */
  highlighted?: boolean
  onToggleExpanded: (key: string) => void
  onViewDetails?: (item: ResumeSearchResultItem) => void
  // Candidate management props
  selected?: boolean
  onSelect?: () => void
  actionType?: CandidateActionType
  onAction?: (resumeId: string, actionType: CandidateActionType) => void
  userRating?: number
  initialComment?: string
  onRating?: (resumeId: string, rating: number) => void
  onRatingComment?: (resumeId: string, comment: string) => void
  onCandidateStatusChange?: (identityKey: string, status: CandidateStatus, notes?: string) => void
  onToggleBlock?: (identityKey: string, blocked: boolean, reason?: string) => void
  aiScoreFeedback?: AiFeedbackSentiment
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
  /** Raw search query text for highlighting matches in the card */
  searchQuery?: string
  policyOverrides?: CandidatePolicyOverride[]
  resumeIdentity?: string
}

const STATUS_OPTIONS: Array<{ value: CandidateStatus; labelKey: string }> = [
  { value: 'new', labelKey: 'resumes.status.options.new' },
  { value: 'shortlisted', labelKey: 'resumes.status.options.shortlisted' },
  { value: 'rejected', labelKey: 'resumes.status.options.rejected' },
  { value: 'contacted', labelKey: 'resumes.status.options.contacted' },
  { value: 'interviewing', labelKey: 'resumes.status.options.interviewing' },
  { value: 'interviewed_pass', labelKey: 'resumes.status.options.interviewed_pass' },
  { value: 'interviewed_reject', labelKey: 'resumes.status.options.interviewed_reject' },
  { value: 'appeal_submitted', labelKey: 'resumes.status.options.appeal_submitted' },
  { value: 'human_review', labelKey: 'resumes.status.options.human_review' },
  { value: 'upheld', labelKey: 'resumes.status.options.upheld' },
  { value: 'reversed', labelKey: 'resumes.status.options.reversed' },
  { value: 'offer', labelKey: 'resumes.status.options.offer' },
  { value: 'hired', labelKey: 'resumes.status.options.hired' },
  { value: 'withdrawn', labelKey: 'resumes.status.options.withdrawn' },
]

const STATUS_BADGE_CLASS: Record<CandidateStatus, string> = {
  new: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  shortlisted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-red-200 bg-red-50 text-red-700',
  contacted: 'border-blue-200 bg-blue-50 text-blue-700',
  interviewing: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  interviewed_pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  interviewed_reject: 'border-red-200 bg-red-50 text-red-700',
  appeal_submitted: 'border-orange-200 bg-orange-50 text-orange-700',
  human_review: 'border-yellow-200 bg-yellow-50 text-yellow-700',
  upheld: 'border-rose-200 bg-rose-50 text-rose-700',
  reversed: 'border-teal-200 bg-teal-50 text-teal-700',
  offer: 'border-purple-200 bg-purple-50 text-purple-700',
  hired: 'border-green-200 bg-green-50 text-green-700',
  withdrawn: 'border-amber-200 bg-amber-50 text-amber-700',
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Clipboard API may reject (e.g. permission denied); fall through to the legacy path.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

function getPrimaryHeadline(
  item: ResumeSearchResultItem,
  fallbackLabel: string,
  workHistoryLimit: number,
): string {
  const latestWorkEntry = selectLatestWorkHistory(item.resume.workHistory, {
    limit: workHistoryLimit,
  })[0]
  if (latestWorkEntry?.jobTitle) {
    return latestWorkEntry.jobTitle
  }

  return item.resume.jobIntention || fallbackLabel
}

export const SnippetCard = memo(function SnippetCard({
  expanded,
  item,
  itemKey,
  showAiScore = false,
  highlighted = false,
  onToggleExpanded,
  onViewDetails,
  selected,
  onSelect,
  actionType,
  onAction,
  userRating,
  initialComment,
  onRating,
  onRatingComment,
  onCandidateStatusChange,
  onToggleBlock,
  searchQuery,
  policyOverrides,
  resumeIdentity,
}: SnippetCardProps) {
  const { t } = useTranslation()
  const { limit: workHistoryLimit } = useResumeWorkHistoryLimit()
  const contentLocale = getResumeContentLocale(item.resume)
  const resumeSourceLabel = getResumeSourceLabel(item.resume)
  const analysis = item.analysis ?? item.resume.analysis
  const displayBreakdown = toDisplayMatchBreakdown(analysis?.breakdown)
  const searchTerms = useMemo(
    () => (searchQuery ? searchQuery.split(/\s+/).filter(Boolean) : []),
    [searchQuery],
  )
  const visibleKeywords = (
    item.resume.ingestData?.industryTags
    ?? item.resume._provenance?.map((entry) => entry.term)
    ?? []
  ).slice(0, 4)
  const companyHits = (item.resume.ingestData?.companyHits ?? []).slice(0, 3)
  const { resolve: resolveBrand } = useBrandDisplayMap()
  const brandSummary = summarizeBrandHits(item.resume.ingestData?.brandHits)
  const verifiedIndustryEvidenceSummaries = useMemo(
    () => getVerifiedIndustryEvidenceSummaries(item.resume),
    [item.resume],
  )
  const { matchResume } = useCompanyPolicyIndex(true)
  const companyPolicyHits = useMemo(
    () =>
      matchResume({
        workHistory: item.resume.workHistory,
        companyHits: item.resume.ingestData?.companyHits,
      }),
    [item.resume.ingestData?.companyHits, item.resume.workHistory, matchResume],
  )
  const overriddenCompanyKeys = useMemo(() => {
    if (!policyOverrides || policyOverrides.length === 0) {
      return []
    }
    const identity = (resumeIdentity ?? item.identityKey).trim()
    if (!identity) {
      return []
    }
    return companyPolicyHits
      .filter((hit) => hit.effects.workflow === 'blocked')
      .filter((hit) => hasActiveOverride(policyOverrides, identity, hit.companyKey))
      .map((hit) => hit.companyKey)
  }, [companyPolicyHits, item.identityKey, policyOverrides, resumeIdentity])
  const companyPolicyState = useMemo(
    () =>
      getResumeCompanyPolicyState(
        {
          workHistory: item.resume.workHistory,
          companyHits: item.resume.ingestData?.companyHits,
        },
        matchResume,
        policyOverrides,
        resumeIdentity ?? item.identityKey,
      ),
    [item.identityKey, item.resume.ingestData?.companyHits, item.resume.workHistory, matchResume, policyOverrides, resumeIdentity],
  )
  const workflowBlocked = companyPolicyState.workflowBlocked
  const guardWorkflowAdvance = (fn: () => void) => {
    if (!workflowBlocked) {
      fn()
      return
    }
    toast.error(toastCompanyPolicyWorkflowBlocked(t, companyPolicyState.primary?.displayName))
  }
  const score = item.score
  const hasAiScore = showAiScore && item.scoreSource === 'ai' && typeof score === 'number'
  const hasRuleScore = !showAiScore && typeof score === 'number'
  const pendingAiScore = showAiScore && !hasAiScore
  const scoreClassName = typeof score === 'number' ? getScoreClassName(score) : ''
  const scoreSourceLabel = item.scoreSource === 'ai'
    ? t('resumes.searchPage.card.ai', { defaultValue: 'AI' })
    : t('resumes.searchPage.card.rule', { defaultValue: '规则' })
  const scoreSourceClassName =
    item.scoreSource === 'ai'
      ? 'bg-sky-700 text-white border-sky-800'
      : 'bg-amber-500 text-white border-amber-600'

  // Status
  const candidateStatus = item.status || 'new'
  const statusOption = STATUS_OPTIONS.find((s) => s.value === candidateStatus) ?? STATUS_OPTIONS[0]
  const statusLabel = t(statusOption.labelKey)
  const statusNotes = item.statusMeta?.notes?.trim() || ''

  // Work history
  const workHistory = useMemo(() =>
    selectLatestWorkHistory(item.resume.workHistory, { limit: workHistoryLimit })
      .map((entry) => ({
        entry,
        text: buildWorkHistoryEntryText(entry),
      }))
      .filter(({ text }) => text.length > 0),
    [item.resume.workHistory, workHistoryLimit],
  )

  // Profile link
  const profileUrl = item.resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)
  const isSeekUuidUrl = typeof profileUrl === 'string' && /\.employer\.seek\.com\/candidates\/[0-9a-f]{8}-/i.test(profileUrl)

  // Dialog state for status note prompt and block/comment
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [blockNoteInput, setBlockNoteInput] = useState('')
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const linkCopiedResetTimer = useRef<number | null>(null)

  // Deep-link anchor: each card exposes a shareable `#resume-<id>` hash.
  const cardAnchorId = item.resume.resumeId != null ? `resume-${item.resume.resumeId}` : undefined
  const copyLinkLabel = t('resumes.searchPage.card.copyLink', { defaultValue: '复制链接' })
  const linkCopiedLabel = t('resumes.searchPage.card.linkCopied', { defaultValue: '已复制' })

  useEffect(() => () => {
    if (linkCopiedResetTimer.current !== null) {
      window.clearTimeout(linkCopiedResetTimer.current)
    }
  }, [])

  const handleCopyLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!cardAnchorId) {
      return
    }
    const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#${cardAnchorId}`
    window.history.replaceState(null, '', `#${cardAnchorId}`)
    document.getElementById(cardAnchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    void copyTextToClipboard(shareUrl)
    setLinkCopied(true)
    if (linkCopiedResetTimer.current !== null) {
      window.clearTimeout(linkCopiedResetTimer.current)
    }
    linkCopiedResetTimer.current = window.setTimeout(() => setLinkCopied(false), 2000)
  }

  const profileOverviewLabel = t('resumes.searchPage.card.profileOverview', {
    defaultValue: '摘要总览',
  })
  const unnamedResumeLabel = t('resumes.searchPage.card.unnamedResume', {
    defaultValue: '未命名简历',
  })
  const aiSummaryPrefix = t('resumes.searchPage.card.aiSummaryPrefix', {
    defaultValue: 'AI 摘要',
  })
  const aiPendingLabel = t('resumes.searchPage.card.aiPending', {
    defaultValue: 'AI 测算中',
  })
  const expandLabel = t('resumes.searchPage.card.expand', {
    defaultValue: '展开',
  })
  const collapseLabel = t('resumes.searchPage.card.collapse', {
    defaultValue: '收起',
  })
  const primaryHeadline = getPrimaryHeadline(item, profileOverviewLabel, workHistoryLimit)

  return (
    <Card
      id={cardAnchorId}
      className={cn(
        'overflow-hidden rounded-[1.5rem] border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.7)] scroll-mt-24',
        highlighted && 'ring-2 ring-primary/50',
      )}
      lang={contentLocale}
    >
      {/* Header metadata bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">{t('resumes.columns.intention')}</span>
        <span className="font-medium">{item.resume.jobIntention || '--'}</span>
        {item.blocked ? (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[10px]">
            {t('resumes.card.blocked', { defaultValue: '已屏蔽' })}
          </Badge>
        ) : null}
        <ResumeRefreshBadge refreshState={item.refreshState} />
        {resumeSourceLabel ? (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 text-[10px]">
            {resumeSourceLabel}
          </Badge>
        ) : null}
        {item.resume.expectedSalary ? (
          <span className="text-muted-foreground">{item.resume.expectedSalary}</span>
        ) : null}
        {/* Score */}
        {showAiScore ? (
          hasAiScore ? (
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="cursor-help">
                      <Badge className={cn('border', scoreClassName)}>
                        {t('resumes.matching.scoreLabel', { score })}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="p-3 text-xs w-64 bg-slate-900 text-white">
                    <p className="font-semibold mb-2 text-sm border-b pb-1 border-white/20">
                      {t('resumes.searchPage.card.analysisBreakdown', { defaultValue: '分析细节' })}
                    </p>
                    {displayBreakdown ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(displayBreakdown).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="capitalize opacity-80">{key.replace('_', ' ')}:</span>
                            <span className="font-mono font-bold">{value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="opacity-70 italic">
                        {t('resumes.searchPage.card.noDetailedBreakdown', { defaultValue: '暂无详细分数拆解' })}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Badge className={cn('border text-[10px] uppercase tracking-wide', scoreSourceClassName)}>
                {scoreSourceLabel}
              </Badge>
              {typeof item.resume.confirmedScore === 'number' ? (
                <ConfirmedScoreBadge />
              ) : null}
            </div>
          ) : pendingAiScore ? (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
              {aiPendingLabel}
            </Badge>
          ) : null
        ) : hasRuleScore ? (
          <div className="flex items-center gap-2">
            <Badge className={cn('border', scoreClassName)}>
              {t('resumes.matching.scoreLabel', { score })}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-amber-200 text-amber-600">
              {scoreSourceLabel}
            </Badge>
          </div>
        ) : null}
        {/* Experience level */}
        {getExperienceBadge(item.resume.ingestData?.experienceLevel, t) ? (
          <Badge variant="outline" className={cn('text-[10px]', getExperienceBadge(item.resume.ingestData?.experienceLevel, t)!.className)}>{getExperienceBadge(item.resume.ingestData?.experienceLevel, t)!.label}</Badge>
        ) : null}
        {/* Industry tags */}
        {visibleKeywords.map((keyword, index) => (
          <Badge key={`${item.key}-tag-${index}`} variant="outline" className="text-[10px] border-violet-200 bg-violet-50 text-violet-700">
            {keyword}
          </Badge>
        ))}
        {/* Company hits */}
        {companyHits.map((company, index) => (
          <Badge key={`co-${company}-${index}`} variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-700">
            {company}
          </Badge>
        ))}
        {/* Brand hits */}
        {brandSummary.map((brand, index) => (
          <Badge key={`brand-${brand}-${index}`} variant="outline" className="text-[10px] border-amber-200 bg-amber-50 text-amber-700">
            {resolveBrand(brand)}
          </Badge>
        ))}
        <CompanyPolicyBadges hits={companyPolicyHits} />
        {overriddenCompanyKeys.length > 0 ? (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">
            {t('settings.policies.runtime.overrideBadge', { defaultValue: 'Override' })}
          </Badge>
        ) : null}
        {cardAnchorId ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={`#${cardAnchorId}`}
                  aria-label={linkCopied ? linkCopiedLabel : copyLinkLabel}
                  data-testid="resume-card-anchor"
                  onClick={handleCopyLink}
                  className="ml-auto inline-flex items-center rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-slate-200/70 hover:text-slate-900"
                >
                  {linkCopied
                    ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                </a>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {linkCopied ? linkCopiedLabel : copyLinkLabel}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>

      {companyPolicyHits.length > 0 ? (
        <div className="border-b px-4 py-2">
          <CompanyPolicyBadges hits={companyPolicyHits} variant="banner" />
        </div>
      ) : null}

      {verifiedIndustryEvidenceSummaries.length > 0 ? (
        <div className="border-b px-4 py-3">
          <IndustryEvidenceSummary
            summaries={verifiedIndustryEvidenceSummaries}
          />
        </div>
      ) : null}

      {/* Main card body */}
      <div className="flex flex-col gap-4 p-4 lg:flex-row">
        {/* Checkbox + Avatar */}
        <div className="flex items-start gap-3">
          {onSelect ? (
            <Checkbox
              aria-label={t('resumes.columns.select')}
              checked={selected}
              onCheckedChange={() => onSelect()}
            />
          ) : null}
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted shrink-0">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>

        {/* Content area */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* Name + Status + Actions row */}
          <div className="flex flex-wrap items-center gap-2">
            {hasProfileUrl ? (
              <a
                className="font-semibold text-slate-900 hover:underline"
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                title={isSeekUuidUrl ? 'Requires active Seek session' : undefined}
              >
                {highlightTerms(item.resume.name || unnamedResumeLabel, searchTerms)}
              </a>
            ) : (
              <span className="font-semibold text-slate-900">{highlightTerms(item.resume.name || unnamedResumeLabel, searchTerms)}</span>
            )}
            {item.resume.activityStatus ? (
              <Badge variant="secondary">{item.resume.activityStatus}</Badge>
            ) : null}
            <Badge variant="outline" className={cn('text-[10px]', STATUS_BADGE_CLASS[candidateStatus])}>
              {statusLabel}
            </Badge>

            {/* Action buttons - pushed to the right */}
            <div className="ml-auto flex items-center gap-1">
              <StarRating value={userRating} initialComment={initialComment} onChange={onRating ? (rating) => onRating(item.resume.resumeId, rating) : undefined} onRatingComment={onRatingComment ? (comment) => onRatingComment(item.resume.resumeId, comment) : undefined} size={14} />
              {onAction ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant={actionType === 'shortlist' ? 'default' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    disabled={workflowBlocked}
                    title={workflowBlocked ? t('settings.policies.runtime.workflowBlockedTitle', { defaultValue: 'Blocked by company policy' }) : undefined}
                    onClick={(e) => { e.stopPropagation(); guardWorkflowAdvance(() => onAction(item.resume.resumeId, 'shortlist')) }}
                    aria-label={t('resumes.actions.shortlist')}
                    data-testid="snippet-card-shortlist"
                  >
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={actionType === 'reject' ? 'destructive' : 'ghost'}
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => { e.stopPropagation(); onAction(item.resume.resumeId, 'reject') }}
                    aria-label={t('resumes.actions.reject')}
                    data-testid="snippet-card-reject"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              <Button variant="ghost" size="sm" className="h-8" onClick={() => onViewDetails?.(item)}>
                {t('resumes.actions.view', { defaultValue: '查看详情' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 rounded-full whitespace-nowrap h-8"
                aria-expanded={expanded}
                aria-controls={`snippet-details-${itemKey}`}
                onClick={() => onToggleExpanded(itemKey)}
              >
                {expanded ? collapseLabel : expandLabel}
                {expanded ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Demographics row */}
          <div className="text-sm text-muted-foreground">
            {item.resume.age || '--'} | {item.resume.experience || '--'} | {highlightTerms(item.resume.education || '--', searchTerms)} | {highlightTerms(item.resume.location || '--', searchTerms)}
          </div>

          {/* Headline / self-intro snippet */}
          <div className="truncate text-sm text-slate-600">{highlightTerms(primaryHeadline, searchTerms)}</div>

          {item.scoreSource === 'ai' && analysis?.summary ? (
            <p className="line-clamp-2 text-xs leading-5 text-slate-500">
              {aiSummaryPrefix}: {analysis.summary}
            </p>
          ) : null}

          {/* Status notes tooltip */}
          {statusNotes ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="w-fit text-[10px] cursor-help">
                    {t('resumes.status.notes')}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-[320px] text-xs">
                  <p>{statusNotes}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>

        {/* Work history column */}
        {workHistory.length > 0 ? (
          <div className="min-w-0 space-y-1 text-sm lg:w-[420px]">
            {workHistory.map(({ entry, text }, index) => {
              const verifiedSummary = findVerifiedIndustrySummaryForCompany(
                entry.companyName,
                verifiedIndustryEvidenceSummaries,
                { roleSignals: item.resume.ingestData?.roleSignals, jobTitle: entry.jobTitle, rawText: text },
              )
              const dateLine = buildWorkHistoryDisplayDateLine(entry)
              const hasStructuredParts = Boolean(entry.companyName || entry.jobTitle || dateLine)
              return (
                <div key={`${item.key}-wh-${index}`} className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted-foreground shrink-0">●</span>
                  <span className="truncate" title={entry.raw || text}>
                    {hasStructuredParts ? (
                      <>
                        {entry.companyName ? (
                          <span className="font-medium text-slate-900">{entry.companyName}</span>
                        ) : null}
                        {entry.companyName && (entry.jobTitle || dateLine) ? (
                          <span className="mx-1 text-slate-400">·</span>
                        ) : null}
                        {entry.jobTitle ? (
                          <span className="text-slate-600">{entry.jobTitle}</span>
                        ) : null}
                        {entry.jobTitle && dateLine ? (
                          <span className="mx-1 text-slate-400">·</span>
                        ) : null}
                        {dateLine ? (
                          <span className="text-muted-foreground">{dateLine}</span>
                        ) : null}
                      </>
                    ) : (
                      text
                    )}
                  </span>
                  {verifiedSummary ? (
                    <VerifiedCompanyBadge
                      summary={verifiedSummary}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div id={`snippet-details-${itemKey}`}>
        <SnippetCardExpanded
          item={item}
          showAiScore={showAiScore}
          onViewDetails={onViewDetails ? () => onViewDetails(item) : undefined}
          candidateStatus={candidateStatus}
          policyOverrides={policyOverrides}
          resumeIdentity={resumeIdentity ?? item.identityKey}
          onCandidateStatusChange={onCandidateStatusChange
            ? (identityKey, nextStatus) => {
              if (nextStatus === 'interviewed_reject' || nextStatus === 'withdrawn') {
                setPendingStatus(nextStatus)
                setNoteInput(statusNotes)
                setPromptDialogOpen(true)
                return
              }
              onCandidateStatusChange(identityKey, nextStatus)
            }
            : undefined}
          statusOptions={STATUS_OPTIONS}
          userRating={userRating}
          showIndustryEvidence={false}
          onBlockTrigger={onToggleBlock
            ? () => {
              if (item.blocked) {
                onToggleBlock(item.identityKey, true)
              } else {
                setBlockNoteInput('')
                setBlockDialogOpen(true)
              }
            }
            : undefined}
          onNoteTrigger={onCandidateStatusChange
            ? () => setCommentDialogOpen(true)
            : undefined}
        />
        </div>
      ) : null}

      {/* Status note prompt dialog (for reject/withdraw) */}
      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingStatus ? t(STATUS_OPTIONS.find((s) => s.value === pendingStatus)?.labelKey ?? '') : ''}
            </DialogTitle>
            <DialogDescription>
              {pendingStatus ? t('resumes.status.notePrompt', { status: t(STATUS_OPTIONS.find((s) => s.value === pendingStatus)?.labelKey ?? '') }) : ''}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={t('resumes.status.notes')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (pendingStatus) {
                  const notes = noteInput.trim()
                  onCandidateStatusChange?.(item.identityKey, pendingStatus, notes.length > 0 ? notes : undefined)
                  setPromptDialogOpen(false)
                }
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromptDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => {
                if (pendingStatus) {
                  const notes = noteInput.trim()
                  onCandidateStatusChange?.(item.identityKey, pendingStatus, notes.length > 0 ? notes : undefined)
                  setPromptDialogOpen(false)
                }
              }}
            >
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block confirmation dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resumes.card.blockCandidate', { defaultValue: '屏蔽候选人' })}</DialogTitle>
            <DialogDescription>
              {t('resumes.card.blockCandidateDescription', { defaultValue: '在屏蔽候选人前添加可选备注。' })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={blockNoteInput}
            onChange={(e) => setBlockNoteInput(e.target.value)}
            placeholder={t('resumes.card.notePlaceholder', { defaultValue: '备注' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onToggleBlock?.(item.identityKey, false, blockNoteInput.trim() || undefined)
                setBlockDialogOpen(false)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => {
                onToggleBlock?.(item.identityKey, false, blockNoteInput.trim() || undefined)
                setBlockDialogOpen(false)
              }}
            >
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CandidateNotesDialog
        open={commentDialogOpen}
        onOpenChange={setCommentDialogOpen}
        candidateName={item.resume.name || '--'}
        notes={statusNotes}
        onSave={(notes) => {
          onCandidateStatusChange?.(item.identityKey, candidateStatus || 'new', notes)
        }}
      />
    </Card>
  )
})
