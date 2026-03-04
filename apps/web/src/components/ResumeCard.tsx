import { useTranslation } from 'react-i18next'
import { Star, User, XCircle, CheckCircle, Ban, Phone } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ResumeItem } from '@/hooks/useResumes'
import type { CandidateActionType, CandidateStatus, MatchingResult } from '@/types/resume'
import type { ExperienceLevelFilter } from '@/hooks/useUrlSearchState'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useState } from 'react'
import { OutreachModal } from './OutreachModal'
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
}

function isSafeProfileUrl(value: string | undefined): value is string {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

const STATUS_OPTIONS: Array<{ value: CandidateStatus; labelKey: string }> = [
  { value: 'new', labelKey: 'resumes.status.options.new' },
  { value: 'contacted', labelKey: 'resumes.status.options.contacted' },
  { value: 'interviewing', labelKey: 'resumes.status.options.interviewing' },
  { value: 'interviewed_pass', labelKey: 'resumes.status.options.interviewed_pass' },
  { value: 'interviewed_reject', labelKey: 'resumes.status.options.interviewed_reject' },
  { value: 'offer', labelKey: 'resumes.status.options.offer' },
  { value: 'hired', labelKey: 'resumes.status.options.hired' },
  { value: 'withdrawn', labelKey: 'resumes.status.options.withdrawn' },
]

const STATUS_BADGE_CLASS: Record<CandidateStatus, string> = {
  new: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  contacted: 'border-blue-200 bg-blue-50 text-blue-700',
  interviewing: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  interviewed_pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  interviewed_reject: 'border-red-200 bg-red-50 text-red-700',
  offer: 'border-purple-200 bg-purple-50 text-purple-700',
  hired: 'border-green-200 bg-green-50 text-green-700',
  withdrawn: 'border-amber-200 bg-amber-50 text-amber-700',
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


export function ResumeCard({
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
  industryTags,
  companyHits,
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
  const [showOutreach, setShowOutreach] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [blockNoteInput, setBlockNoteInput] = useState('')
  const workHistory = resume.workHistory?.filter((item) => item.raw) ?? []
  const jobIntention = (resume.jobIntention || '').replace(/^[:：]\s*/, '') || '--'
  const selfIntro = resume.selfIntro || '--'
  const profileUrl = resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)

  const score = matchResult?.score
  const recommendation = matchResult?.recommendation
  const scoreSource = matchResult?.scoreSource
  const scoreLabel = recommendation ? t(`resumes.matching.recommendations.${recommendation}`) : ''
  const statusOption = STATUS_OPTIONS.find((item) => item.value === candidateStatus) ?? STATUS_OPTIONS[0]
  const statusLabel = t(statusOption.labelKey)
  const statusNotes = candidateStatusMeta?.notes?.trim() || ''
  const statusUpdatedAtLabel = candidateStatusMeta?.updatedAt
    ? t('resumes.status.updatedAt', { date: new Date(candidateStatusMeta.updatedAt).toLocaleString() })
    : ''

  // Use Rule Score if AI Score is missing
  const effectiveScore = typeof score === 'number' ? score : ruleScore
  const isRuleScore = typeof score !== 'number' && typeof ruleScore === 'number'

  const scoreClassName =
    typeof effectiveScore === 'number'
      ? effectiveScore >= 90
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : effectiveScore >= 70
          ? 'bg-sky-100 text-sky-700 border-sky-200'
          : effectiveScore >= 50
            ? 'bg-amber-100 text-amber-700 border-amber-200'
            : 'bg-zinc-100 text-zinc-600 border-zinc-200'
      : ''

  const scoreSourceClassName =
    scoreSource === 'ai'
      ? 'bg-sky-600 text-white border-sky-700'
      : scoreSource === 'rule'
        ? 'bg-amber-500 text-white border-amber-600'
        : ''
  const visibleIndustryTags = (industryTags ?? [])
    .filter((tag) => tag.trim().length > 0)
    .slice(0, 4)
  const visibleCompanyHits = (companyHits ?? [])
    .filter((company) => company.trim().length > 0)
    .slice(0, 3)
  const normalizedExperienceLevel = experienceLevel?.trim().toLowerCase()
  const experienceLevelForClick: ExperienceLevelFilter | undefined =
    normalizedExperienceLevel === 'senior'
      ? 'senior'
      : normalizedExperienceLevel === 'mid'
        ? 'mid'
        : normalizedExperienceLevel === 'junior'
          ? 'junior'
          : undefined
  const isExperienceLevelActive =
    Boolean(activeExperienceLevelFilter)
    && normalizedExperienceLevel === activeExperienceLevelFilter
  const experienceBadge =
    normalizedExperienceLevel === 'senior'
      ? {
        label: '资深',
        className: isExperienceLevelActive
          ? 'border-orange-700 bg-orange-600 text-white'
          : 'border-orange-200 bg-orange-50 text-orange-700',
      }
      : normalizedExperienceLevel === 'mid'
        ? {
          label: '中级',
          className: isExperienceLevelActive
            ? 'border-teal-700 bg-teal-600 text-white'
            : 'border-teal-200 bg-teal-50 text-teal-700',
        }
        : normalizedExperienceLevel === 'junior'
          ? {
            label: '初级',
            className: isExperienceLevelActive
              ? 'border-zinc-700 bg-zinc-600 text-white'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600',
          }
          : null

  return (
    <div
      className="mb-3 overflow-hidden rounded-lg border bg-card"
      data-testid="resume-card"
      data-role-types={(roleTypes ?? []).join(',')}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">求职意向</span>
        <span className="font-medium">{jobIntention}</span>
        {isReviewed && (
          <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-[10px]">
            {t('resumes.status.reviewed', '已查阅')}
          </Badge>
        )}
        {blocked ? (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[10px]">
            已屏蔽
          </Badge>
        ) : null}
        {resume.expectedSalary ? (
          <span className="text-muted-foreground">{resume.expectedSalary}</span>
        ) : null}
        {showAiScore && typeof score === 'number' ? (
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
                  <p className="font-semibold mb-2 text-sm border-b pb-1 border-white/20">Analysis Breakdown</p>
                  {matchResult?.breakdown ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(matchResult.breakdown).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="capitalize opacity-80">{key.replace('_', ' ')}:</span>
                          <span className="font-mono font-bold">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="opacity-70 italic">No detailed breakdown available</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {scoreSource ? (
              <Badge className={cn('border text-[10px] uppercase tracking-wide', scoreSourceClassName)}>
                {scoreSource === 'ai' ? 'AI' : 'Rule'}
              </Badge>
            ) : null}
          </div>
        ) : isRuleScore && effectiveScore && effectiveScore > 0 ? (
          <div className="flex items-center gap-2">
            <Badge className={cn('border', scoreClassName)}>
              Rule Score: {effectiveScore}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-amber-200 text-amber-600">
              Pre-Score
            </Badge>
          </div>
        ) : null}
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
              {company.toUpperCase()}
            </Badge>
          )
        })}
      </div>

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
              <div className="flex items-center gap-1">
                <Button
                  variant={actionType === 'star' ? 'default' : 'ghost'}
                  size="icon"
                  onClick={() => onAction?.('star')}
                  aria-label={t('resumes.actions.star')}
                >
                  <Star className="h-4 w-4" />
                </Button>
                <Button
                  variant={actionType === 'shortlist' ? 'default' : 'ghost'}
                  size="icon"
                  onClick={() => onAction?.('shortlist')}
                  aria-label={t('resumes.actions.shortlist')}
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
                {blocked ? '取消屏蔽' : '屏蔽'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOutreach(true)}
                className="gap-2"
                disabled={!matchResult}
              >
                <Phone className="h-3.5 w-3.5" />
                Contact
              </Button>
            </div>

            <OutreachModal
              isOpen={showOutreach}
              onClose={() => setShowOutreach(false)}
              resume={resume}
              jobDescription={jobDescription ? {
                ...jobDescription,
                requirements: jobDescription.requirements || ''
              } : {
                id: jobDescriptionId || 'default',
                title: 'Current Position',
                requirements: ''
              }}
              analysis={matchResult}
              onSuccess={() => onAction?.('contact')}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {resume.age || '--'} | {resume.experience || '--'} | {resume.education || '--'} |{' '}
            {resume.location || '--'}
          </div>
          <div className="text-sm text-muted-foreground line-clamp-2">{selfIntro}</div>
        </div>

        {workHistory.length > 0 ? (
          <div className="min-w-0 space-y-1 text-sm lg:w-[420px]">
            {workHistory.slice(0, 3).map((item, index) => (
              <div key={`${resume.name}-${index}`} className="flex gap-2">
                <span className="text-muted-foreground">●</span>
                <span className="truncate" title={item.raw}>
                  {item.raw}
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
            <DialogTitle>屏蔽候选人</DialogTitle>
            <DialogDescription>
              为“屏蔽候选人”添加备注（选填）
            </DialogDescription>
          </DialogHeader>
          <Input
            value={blockNoteInput}
            onChange={(e) => setBlockNoteInput(e.target.value)}
            placeholder="备注"
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
    </div>
  )
}
