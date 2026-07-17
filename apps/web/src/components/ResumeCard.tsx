import { buildWorkHistoryEntryText, sanitizeResumeRecordForSurface, selectLatestWorkHistory } from '@trends/shared'
import { useTranslation } from 'react-i18next'
import { User, CheckCircle, XCircle, Phone, Ban, MessageSquare } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AiFeedbackButtons } from '@/components/AiFeedbackButtons'
import { ConfirmedScoreBadge } from '@/components/ConfirmedScoreBadge'
import { toast } from 'sonner'
import { isAdvancingCandidateStatus } from '@trends/shared'
import { CompanyPolicyBadges } from '@/components/CompanyPolicyBadges'
import { useCompanyPolicyIndex } from '@/hooks/useCompanyPolicyIndex'
import { getResumeCompanyPolicyState, toastCompanyPolicyWorkflowBlocked } from '@/lib/company-policy-runtime'
import { StarRating } from '@/components/StarRating'
import { CandidateNotesDialog } from '@/components/CandidateNotesDialog'
import type { ResumeItem } from '@/hooks/useResumes'
import type { AiFeedbackSentiment, AiFeedbackTarget, CandidateActionType, CandidateStatus, MatchingResult } from '@/types/resume'
import type { ExperienceLevelFilter } from '@/lib/resume-scoring'
import { getScoreClassName } from '@/lib/score-classes'
import { cn } from '@/lib/utils'
import {
  formatRoleYears,
  getResumeContentLocale,
  getResumeSourceLabel,
  getRoleLabel,
  getRoleRelevantYears,
  getRoleVerifiedYears,
  isSafeProfileUrl,
  type ResumeRoleSignalLike,
  type BrandHitLike,
  summarizeBrandHits,
  getExperienceBadge,
  normalizeExperienceLevel,
  toDisplayMatchBreakdown,
} from '@/lib/resume-scoring'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Suspense, lazy, memo, useMemo, useState } from 'react'
import { useResumeFieldUsagePolicy } from '@/contexts/ResumeFieldUsagePolicyContext'

const OutreachModal = lazy(() => import('./OutreachModal').then((m) => ({ default: m.OutreachModal })))
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface ResumeCardProps {
  resume: ResumeItem
  onViewDetails: () => void
  matchResult?: MatchingResult
  ruleScore?: number
  industryTags?: string[]
  companyHits?: string[]
  brandHits?: BrandHitLike[]
  roleSignals?: ResumeRoleSignalLike[]
  brandDisplayResolve?: (brandId: string) => string
  roleTypes?: string[]
  experienceLevel?: string
  onTagClick?: (tag: string) => void
  onCompanyClick?: (company: string) => void
  onExperienceLevelClick?: (experienceLevel: ExperienceLevelFilter | undefined) => void
  activeTagFilters?: Set<string>
  activeCompanyFilters?: Set<string>
  activeExperienceLevelFilter?: ExperienceLevelFilter
  showAiScore?: boolean
  actionType?: CandidateActionType
  onAction?: (actionType: CandidateActionType) => void
  selected?: boolean
  onSelect?: () => void
  blocked?: boolean
  candidateStatus?: CandidateStatus
  onToggleBlock?: (reason?: string) => void
  candidateStatusMeta?: {
    notes?: string
    updatedAt: number
  }
  onCandidateStatusChange?: (status: CandidateStatus, notes?: string) => void
  jobDescriptionId?: string
  jobDescription?: {
    id: string
    title: string
    requirements?: string
  }
  isReviewed?: boolean
  aiScoreFeedback?: AiFeedbackSentiment
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
  userRating?: number
  initialComment?: string
  onRating?: (rating: number) => void
  onRatingComment?: (comment: string) => void
  confirmedScore?: number
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

function selectPrimaryRoleSignal(roleSignals: ResumeRoleSignalLike[] | undefined): ResumeRoleSignalLike | undefined {
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return undefined
  }

  return [...roleSignals].sort((left, right) => {
    const leftVerified = getRoleVerifiedYears(left)
    const rightVerified = getRoleVerifiedYears(right)
    if (leftVerified !== rightVerified) {
      return rightVerified - leftVerified
    }

    const leftRelevant = getRoleRelevantYears(left)
    const rightRelevant = getRoleRelevantYears(right)
    return rightRelevant - leftRelevant
  })[0]
}

export function ResumeCardSkeleton() {
  return (
    <div className="p-4 border rounded-lg space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  )
}


export const ResumeCard = memo(function ResumeCard({
  resume,
  onViewDetails,
  matchResult,
  ruleScore,
  showAiScore,
  actionType,
  onAction,
  selected,
  onSelect,
  blocked = false,
  candidateStatus = 'new',
  candidateStatusMeta,
  onToggleBlock,
  onCandidateStatusChange,
  jobDescriptionId,
  jobDescription,
  isReviewed,
  aiScoreFeedback,
  onAiFeedback,
  userRating,
  initialComment,
  onRating,
  onRatingComment,
  confirmedScore,
  industryTags,
  companyHits,
  brandHits,
  roleSignals,
  brandDisplayResolve,
  roleTypes,
  experienceLevel,
  onTagClick,
  onCompanyClick,
  onExperienceLevelClick,
  activeTagFilters,
  activeCompanyFilters,
  activeExperienceLevelFilter,
}: ResumeCardProps) {
  const { t } = useTranslation()
  const fieldUsagePolicy = useResumeFieldUsagePolicy()
  const [showOutreach, setShowOutreach] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [blockNoteInput, setBlockNoteInput] = useState('')
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const workHistory = selectLatestWorkHistory(resume.workHistory)
    .map((item) => ({
      item,
      text: buildWorkHistoryEntryText(item),
    }))
    .filter(({ text }) => text.length > 0)
  const { matchResume } = useCompanyPolicyIndex(true)
  const companyPolicyState = useMemo(
    () =>
      getResumeCompanyPolicyState(
        {
          workHistory: resume.workHistory,
          companyHits,
        },
        matchResume,
      ),
    [companyHits, matchResume, resume.workHistory],
  )
  const companyPolicyHits = companyPolicyState.hits
  const guardWorkflowAdvance = (fn: () => void) => {
    if (!companyPolicyState.workflowBlocked) {
      fn()
      return
    }
    toast.error(toastCompanyPolicyWorkflowBlocked(t, companyPolicyState.primary?.displayName))
  }
  const presentationResume = useMemo(
    () => sanitizeResumeRecordForSurface(resume, 'presentation', fieldUsagePolicy),
    [fieldUsagePolicy, resume],
  )
  const jobIntention = (presentationResume.jobIntention || '').replace(/^[:：]\s*/, '') || '--'
  const selfIntro = presentationResume.selfIntro || '--'
  const profileUrl = resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)
  const sourceLabel = getResumeSourceLabel(resume)
  const contentLocale = getResumeContentLocale(resume)
  const industryVerifiedSuffix = t('resumes.card.industryVerifiedSuffix', {
    defaultValue: ' (Industry verified)',
  })

  const score = matchResult?.score
  const recommendation = matchResult?.recommendation
  const scoreSource = matchResult?.scoreSource
  const displayBreakdown = toDisplayMatchBreakdown(matchResult?.breakdown)
  const scoreLabel = recommendation ? t(`resumes.matching.recommendations.${recommendation}`) : ''
  const statusOption = STATUS_OPTIONS.find((item) => item.value === candidateStatus) ?? STATUS_OPTIONS[0]
  const statusLabel = t(statusOption.labelKey)
  const statusNotes = candidateStatusMeta?.notes?.trim() || ''
  const statusUpdatedAtLabel = candidateStatusMeta?.updatedAt
    ? t('resumes.status.updatedAt', { date: new Date(candidateStatusMeta.updatedAt).toLocaleString() })
    : ''

  const hasAiScore = scoreSource === 'ai' && typeof score === 'number' && score > 0
  const pendingAiScore = showAiScore && !hasAiScore
  const effectiveScore = hasAiScore
    ? score
    : !showAiScore && typeof ruleScore === 'number' && ruleScore > 0
      ? ruleScore
      : undefined
  const isRuleScore = !showAiScore && typeof ruleScore === 'number' && ruleScore > 0

  const scoreClassName = typeof effectiveScore === 'number' ? getScoreClassName(effectiveScore) : ''

  const scoreSourceClassName =
    scoreSource === 'ai'
      ? 'bg-sky-600 text-white border-sky-700'
      : scoreSource === 'rule'
        ? 'bg-amber-500 text-white border-amber-600'
        : ''
  const aiScoreNode = hasAiScore ? (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <Badge className={cn('border', scoreClassName)}>
                {t('resumes.matching.scoreLabel', { score })}
                {scoreLabel ? ` · ${scoreLabel}` : ''}
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent className="p-3 text-xs w-64 bg-slate-900 text-white">
            <p className="font-semibold mb-2 text-sm border-b pb-1 border-white/20">
              {t('resumes.searchPage.card.analysisBreakdown', {
                defaultValue: 'Analysis Breakdown',
              })}
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
                {t('resumes.searchPage.card.noDetailedBreakdown', {
                  defaultValue: 'No detailed breakdown available',
                })}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {scoreSource ? (
        <Badge className={cn('border text-[10px] uppercase tracking-wide', scoreSourceClassName)}>
          {t('resumes.searchPage.card.ai', { defaultValue: 'AI' })}
        </Badge>
      ) : null}
      {typeof confirmedScore === 'number' ? (
        <ConfirmedScoreBadge />
      ) : null}
      {onAiFeedback && scoreSource === 'ai' ? (
        <AiFeedbackButtons
          feedback={aiScoreFeedback}
          label={t('resumes.searchPage.card.aiScoreLabel', {
            defaultValue: 'AI score',
          })}
          testId="ai-score-feedback"
          stopPropagation
          onSelect={(sentiment) => onAiFeedback('ai_score', sentiment)}
        />
      ) : null}
    </div>
  ) : null
  const ruleScoreNode = isRuleScore && effectiveScore && effectiveScore > 0 ? (
    <div className="flex items-center gap-2">
      <Badge className={cn('border', scoreClassName)}>
        {t('resumes.matching.scoreLabel', { score: effectiveScore })}
      </Badge>
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-amber-200 text-amber-600">
        {t('resumes.searchPage.card.rule', { defaultValue: 'Rule' })}
      </Badge>
    </div>
  ) : null
  const pendingAiScoreNode = pendingAiScore ? (
    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
      {t('resumes.searchPage.card.aiPending', {
        defaultValue: 'AI pending',
      })}
    </Badge>
  ) : null
  const scoreNode = showAiScore
    ? aiScoreNode ?? pendingAiScoreNode
    : ruleScoreNode ?? aiScoreNode
  const visibleIndustryTags = (industryTags ?? [])
    .filter((tag) => tag.trim().length > 0 && tag.trim().toLowerCase() !== 'unknown')
    .slice(0, 4)
  const visibleCompanyHits = (companyHits ?? [])
    .filter((company) => company.trim().length > 0)
    .slice(0, 3)
  const resolveBrand = brandDisplayResolve ?? ((brandId: string) => brandId.toUpperCase())
  const brandSummary = useMemo(() => summarizeBrandHits(brandHits), [brandHits])
  const primaryRoleSignal = selectPrimaryRoleSignal(roleSignals)
  const verifiedRoleYears = primaryRoleSignal ? getRoleVerifiedYears(primaryRoleSignal) : 0
  const roleRelevantYears = primaryRoleSignal ? getRoleRelevantYears(primaryRoleSignal) : 0
  const displayRoleYears = verifiedRoleYears > 0 ? verifiedRoleYears : roleRelevantYears
  const roleTypeLabel = primaryRoleSignal
    ? t(`resumes.roleLabels.${primaryRoleSignal.type}`, {
        defaultValue: getRoleLabel(primaryRoleSignal.type),
      })
    : ''
  const roleEvidenceLabel = primaryRoleSignal
    ? `${roleTypeLabel}${formatRoleYears(displayRoleYears, contentLocale)}${verifiedRoleYears > 0 ? industryVerifiedSuffix : ''}`
    : null
  const normalizedExperienceLevel = normalizeExperienceLevel(experienceLevel)
  const experienceLevelForClick: ExperienceLevelFilter | undefined =
    normalizedExperienceLevel ?? undefined
  const isExperienceLevelActive =
    Boolean(activeExperienceLevelFilter)
    && normalizedExperienceLevel === activeExperienceLevelFilter
  const inactiveBadge = getExperienceBadge(experienceLevel, t)
  const activeClassMap: Record<string, string> = {
    senior: 'border-orange-700 bg-orange-600 text-white',
    mid: 'border-teal-700 bg-teal-600 text-white',
    junior: 'border-zinc-700 bg-zinc-600 text-white',
  }
  const experienceBadge = inactiveBadge
    ? {
      label: inactiveBadge.label,
      className: isExperienceLevelActive
        ? activeClassMap[normalizedExperienceLevel!] ?? inactiveBadge.className
        : inactiveBadge.className,
    }
    : null

  return (
    <div
      className="mb-3 overflow-hidden rounded-lg border bg-card"
      lang={contentLocale}
      data-testid="resume-card"
      data-role-types={(roleTypes ?? []).join(',')}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">{t('resumes.columns.intention')}</span>
        <span className="font-medium">{jobIntention}</span>
        {isReviewed && (
          <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-[10px]">
            {t('resumes.status.reviewed', { defaultValue: 'Reviewed' })}
          </Badge>
        )}
        {blocked ? (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[10px]">
            {t('resumes.card.blocked', { defaultValue: 'Blocked' })}
          </Badge>
        ) : null}
        {sourceLabel ? (
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 text-[10px]">
            {sourceLabel}
          </Badge>
        ) : null}
        {contentLocale ? (
          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500 text-[10px]">
            {contentLocale.startsWith('zh') ? 'ZH' : contentLocale.toUpperCase()}
          </Badge>
        ) : null}
        {resume.expectedSalary ? (
          <span className="text-muted-foreground">{resume.expectedSalary}</span>
        ) : null}
        {scoreNode}
        <CompanyPolicyBadges hits={companyPolicyHits} />
        {experienceBadge ? (
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              onExperienceLevelClick && 'cursor-pointer',
              experienceBadge.className
            )}
            onClick={(event) => {
              event.stopPropagation()
              onExperienceLevelClick?.(experienceLevelForClick)
            }}
          >
            {experienceBadge.label}
          </Badge>
        ) : null}
        {primaryRoleSignal && roleEvidenceLabel ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={cn(
                    'cursor-help text-[10px]',
                    verifiedRoleYears > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700'
                  )}
                >
                  {roleEvidenceLabel}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[320px] text-xs">
                <div className="space-y-1">
                  <p className="font-semibold">{roleTypeLabel}</p>
                  <p>{t('resumes.card.relatedYears', { years: formatRoleYears(roleRelevantYears, contentLocale), defaultValue: 'Related years: {{years}}' })}</p>
                  {verifiedRoleYears > 0 ? (
                    <p>{t('resumes.card.industryVerified', { years: formatRoleYears(verifiedRoleYears, contentLocale), defaultValue: 'Industry verified: {{years}}' })}</p>
                  ) : null}
                  <p>{t('resumes.card.matchedSignals', { signals: primaryRoleSignal.matchedSignals.slice(0, 6).join(' / ') || '--', defaultValue: 'Matched signals: {{signals}}' })}</p>
                  {primaryRoleSignal.matchedWorkEntries && primaryRoleSignal.matchedWorkEntries.length > 0 ? (
                    <p>{t('resumes.card.matchedExperience', {
                      experience: primaryRoleSignal.matchedWorkEntries
                        .slice(0, 2)
                        .map((entry) =>
                          [entry.companyName, entry.jobTitle, formatRoleYears(entry.years, contentLocale)].filter(Boolean).join(' · ')
                        )
                        .join('；'),
                      defaultValue: 'Matched experience: {{experience}}',
                    })}</p>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        {visibleIndustryTags.map((tag, index) => {
          const isActive = activeTagFilters?.has(tag.trim().toLowerCase()) ?? false
          return (
            <Badge
              key={`${tag}-${index}`}
              variant="outline"
              className={cn(
                'text-[10px] border-violet-200 bg-violet-50 text-violet-700',
                onTagClick && 'cursor-pointer',
                isActive && 'border-violet-700 bg-violet-600 text-white'
              )}
              onClick={(event) => {
                event.stopPropagation()
                onTagClick?.(tag)
              }}
            >
              {tag}
            </Badge>
          )
        })}
        {visibleCompanyHits.map((company, index) => {
          const isActive = activeCompanyFilters?.has(company.trim().toLowerCase()) ?? false
          return (
            <Badge
              key={`co-${company}-${index}`}
              variant="outline"
              className={cn(
                'text-[10px] border-blue-200 bg-blue-50 text-blue-700',
                onCompanyClick && 'cursor-pointer',
                isActive && 'border-blue-700 bg-blue-600 text-white'
              )}
              onClick={(event) => {
                event.stopPropagation()
                onCompanyClick?.(company)
              }}
            >
              {resolveBrand(company)}
            </Badge>
          )
        })}
        {brandSummary.map((brand) => (
          <Badge
            key={`brand-${brand}`}
            variant="outline"
            className="text-[10px] border-amber-200 bg-amber-50 text-amber-700"
          >
            {resolveBrand(brand)}
          </Badge>
        ))}
      </div>

      {companyPolicyHits.length > 0 ? (
        <div className="border-b px-4 py-2">
          <CompanyPolicyBadges hits={companyPolicyHits} variant="banner" />
        </div>
      ) : null}

      <div className="flex flex-col gap-4 p-4 lg:flex-row">
        <div className="flex items-start gap-3">
          <Checkbox
            aria-label={t('resumes.columns.select')}
            checked={selected}
            onCheckedChange={() => onSelect?.()}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {hasProfileUrl ? (
              <a
                className="font-medium text-foreground hover:underline"
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
              >
                {resume.name || '--'}
              </a>
            ) : (
              <span className="font-medium">{resume.name || '--'}</span>
            )}
            {resume.activityStatus ? (
              <Badge variant="secondary">{resume.activityStatus}</Badge>
            ) : null}
            <Badge variant="outline" className={cn('text-[10px]', STATUS_BADGE_CLASS[candidateStatus])}>
              {statusLabel}
            </Badge>
            {statusUpdatedAtLabel ? (
              <span className="text-[10px] text-muted-foreground">{statusUpdatedAtLabel}</span>
            ) : null}
            {statusNotes ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] cursor-help">
                      {t('resumes.status.notes')}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] text-xs">
                    <p>{statusNotes}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <StarRating value={userRating} initialComment={initialComment} onChange={onRating} onRatingComment={onRatingComment} size={14} />
              <div className="flex items-center gap-1">
                {/* Star action button disabled — replaced by StarRating (5-star rating) */}
                {/* <Button
                  variant={actionType === 'star' ? 'default' : 'ghost'}
                  size="icon"
                  onClick={() => onAction?.('star')}
                  aria-label={t('resumes.actions.star')}
                >
                  <Star className="h-4 w-4" />
                </Button> */}
                <Button
                  variant={actionType === 'shortlist' ? 'default' : 'ghost'}
                  size="icon"
                  disabled={companyPolicyState.workflowBlocked}
                  title={
                    companyPolicyState.workflowBlocked
                      ? t('settings.policies.runtime.workflowBlockedTitle', {
                          defaultValue: 'Blocked by company policy',
                        })
                      : undefined
                  }
                  onClick={() => guardWorkflowAdvance(() => onAction?.('shortlist'))}
                  aria-label={t('resumes.actions.shortlist')}
                  data-testid="resume-card-shortlist"
                >
                  <CheckCircle className="h-4 w-4" />
                </Button>
                <Button
                  variant={actionType === 'reject' ? 'destructive' : 'ghost'}
                  size="icon"
                  onClick={() => onAction?.('reject')}
                  aria-label={t('resumes.actions.reject')}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={onViewDetails}>
                {t('resumes.actions.view')}
              </Button>
              <div className="w-36">
                <Select
                  value={candidateStatus}
                  onChange={(event) => {
                    const nextStatus = STATUS_OPTIONS.find((item) => item.value === event.target.value)
                    if (!nextStatus || nextStatus.value === candidateStatus) {
                      return
                    }

                    if (isAdvancingCandidateStatus(nextStatus.value)) {
                      guardWorkflowAdvance(() => {
                        if (nextStatus.value === 'interviewed_reject' || nextStatus.value === 'withdrawn') {
                          setPendingStatus(nextStatus.value)
                          setNoteInput(statusNotes)
                          setPromptDialogOpen(true)
                          return
                        }
                        onCandidateStatusChange?.(nextStatus.value)
                      })
                      return
                    }

                    if (nextStatus.value === 'interviewed_reject' || nextStatus.value === 'withdrawn') {
                      setPendingStatus(nextStatus.value)
                      setNoteInput(statusNotes)
                      setPromptDialogOpen(true)
                      return
                    }

                    onCandidateStatusChange?.(nextStatus.value)
                  }}
                  options={STATUS_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                variant={blocked ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => {
                  if (blocked) {
                    onToggleBlock?.()
                  } else {
                    setBlockNoteInput('')
                    setBlockDialogOpen(true)
                  }
                }}
                className="gap-2"
              >
                <Ban className="h-3.5 w-3.5" />
                {blocked ? t('resumes.card.unblock', { defaultValue: 'Unblock' }) : t('resumes.card.block', { defaultValue: 'Block' })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCommentDialogOpen(true)}
                className="gap-2"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                {t('resumes.status.notes')}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowOutreach(true)}
                aria-label={t('resumes.actions.contact', 'Contact')}
                disabled={!matchResult}
              >
                <Phone className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Suspense fallback={null}>
              <OutreachModal
                isOpen={showOutreach}
                onClose={() => setShowOutreach(false)}
                resume={resume}
                jobDescription={jobDescription ? {
                  ...jobDescription,
                  requirements: jobDescription.requirements || ''
                } : {
                  id: jobDescriptionId || 'default',
                  title: t('resumes.card.currentPosition', { defaultValue: 'Current Position' }),
                  requirements: ''
                }}
                analysis={matchResult}
                onSuccess={() => onAction?.('contact')}
              />
            </Suspense>
          </div>
          <div className="text-sm text-muted-foreground">
            {resume.age || '--'} | {resume.experience || '--'} | {resume.education || '--'} |{' '}
            {resume.location || '--'}
          </div>
          <div className="text-sm text-muted-foreground line-clamp-2">{selfIntro}</div>
        </div>

        {workHistory.length > 0 ? (
          <div className="min-w-0 space-y-1 text-sm lg:w-[420px]">
            {workHistory.map(({ item, text }, index) => (
              <div key={`${resume.name}-${index}`} className="flex gap-2">
                <span className="text-muted-foreground">●</span>
                <span className="truncate" title={item.raw || text}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingStatus ? t(STATUS_OPTIONS.find((item) => item.value === pendingStatus)?.labelKey ?? '') : ''}
            </DialogTitle>
            <DialogDescription>
              {pendingStatus ? t('resumes.status.notePrompt', { status: t(STATUS_OPTIONS.find((item) => item.value === pendingStatus)?.labelKey ?? '') }) : ''}
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
                  onCandidateStatusChange?.(pendingStatus, notes.length > 0 ? notes : undefined)
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
                  onCandidateStatusChange?.(pendingStatus, notes.length > 0 ? notes : undefined)
                  setPromptDialogOpen(false)
                }
              }}
            >
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resumes.card.blockCandidate', { defaultValue: 'Block candidate' })}</DialogTitle>
            <DialogDescription>
              {t('resumes.card.blockCandidateDescription', { defaultValue: 'Add an optional note before blocking this candidate.' })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={blockNoteInput}
            onChange={(e) => setBlockNoteInput(e.target.value)}
            placeholder={t('resumes.card.notePlaceholder', { defaultValue: 'Note' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onToggleBlock?.(blockNoteInput.trim() || undefined)
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
                onToggleBlock?.(blockNoteInput.trim() || undefined)
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
        candidateName={resume.name || '--'}
        notes={statusNotes}
        onSave={(notes) => {
          onCandidateStatusChange?.(candidateStatus || 'new', notes)
        }}
      />
    </div>
  )
})
