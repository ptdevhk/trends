import { buildWorkHistoryEntryText, selectLatestWorkHistory } from '@trends/shared'
import {
  ChevronDown,
  ChevronUp,
  Star,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import { SnippetCardExpanded } from '@/components/search/SnippetCardExpanded'
import { StarRating } from '@/components/StarRating'
import { getResumeContentLocale, getResumeSourceLabel, getExperienceBadge, isSafeProfileUrl, summarizeBrandHits } from '@/lib/resume-scoring'
import { useBrandDisplayMap } from '@/hooks/useBrandDisplayMap'
import { cn } from '@/lib/utils'
import type { CandidateActionType, CandidateStatus, AiFeedbackSentiment, AiFeedbackTarget } from '@/types/resume'

type SnippetCardProps = {
  expanded: boolean
  item: ResumeSearchResultItem
  showAiScore?: boolean
  onToggleExpanded: () => void
  onViewDetails?: () => void
  // Candidate management props
  selected?: boolean
  onSelect?: () => void
  actionType?: CandidateActionType
  onAction?: (resumeId: string, actionType: CandidateActionType) => void
  userRating?: number
  onRating?: (resumeId: string, rating: number) => void
  onCandidateStatusChange?: (identityKey: string, status: CandidateStatus, notes?: string) => void
  onToggleBlock?: (identityKey: string, blocked: boolean, reason?: string) => void
  aiScoreFeedback?: AiFeedbackSentiment
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
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

function getPrimaryHeadline(item: ResumeSearchResultItem, fallbackLabel: string): string {
  const latestWorkEntry = item.resume.workHistory?.[0]
  if (latestWorkEntry?.jobTitle) {
    return latestWorkEntry.jobTitle
  }

  return item.resume.jobIntention || fallbackLabel
}

export function SnippetCard({
  expanded,
  item,
  showAiScore = false,
  onToggleExpanded,
  onViewDetails,
  selected,
  onSelect,
  actionType,
  onAction,
  userRating,
  onRating,
  onCandidateStatusChange,
  onToggleBlock,
}: SnippetCardProps) {
  const { t } = useTranslation()
  const contentLocale = getResumeContentLocale(item.resume)
  const resumeSourceLabel = getResumeSourceLabel(item.resume)
  const analysis = item.analysis ?? item.resume.analysis
  const visibleKeywords = (
    item.resume.ingestData?.industryTags
    ?? item.resume._provenance?.map((entry) => entry.term)
    ?? []
  ).slice(0, 4)
  const companyHits = (item.resume.ingestData?.companyHits ?? []).slice(0, 3)
  const { resolve: resolveBrand } = useBrandDisplayMap()
  const brandSummary = summarizeBrandHits(item.resume.ingestData?.brandHits)
  const score = item.score
  const hasAiScore = showAiScore && item.scoreSource === 'ai' && typeof score === 'number'
  const hasRuleScore = !showAiScore && typeof score === 'number'
  const pendingAiScore = showAiScore && !hasAiScore
  const scoreClassName =
    typeof score === 'number'
      ? score >= 90
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : score >= 70
          ? 'bg-sky-100 text-sky-700 border-sky-200'
          : score >= 50
            ? 'bg-amber-100 text-amber-700 border-amber-200'
            : 'bg-zinc-100 text-zinc-600 border-zinc-200'
      : ''
  const scoreSourceLabel = item.scoreSource === 'ai'
    ? t('resumes.searchPage.card.ai', { defaultValue: 'AI' })
    : t('resumes.searchPage.card.rule', { defaultValue: '规则' })
  const scoreSourceClassName =
    item.scoreSource === 'ai'
      ? 'bg-sky-600 text-white border-sky-700'
      : 'bg-amber-500 text-white border-amber-600'

  // Status
  const candidateStatus = item.status || 'new'
  const statusOption = STATUS_OPTIONS.find((s) => s.value === candidateStatus) ?? STATUS_OPTIONS[0]
  const statusLabel = t(statusOption.labelKey)
  const statusNotes = item.statusMeta?.notes?.trim() || ''

  // Work history
  const workHistory = useMemo(() =>
    selectLatestWorkHistory(item.resume.workHistory)
      .map((entry) => ({
        entry,
        text: buildWorkHistoryEntryText(entry),
      }))
      .filter(({ text }) => text.length > 0),
    [item.resume.workHistory],
  )

  // Profile link
  const profileUrl = item.resume.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)

  // Dialog state for status note prompt and block/comment
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)
  const [blockNoteInput, setBlockNoteInput] = useState('')
  const [commentDialogOpen, setCommentDialogOpen] = useState(false)
  const [commentNoteInput, setCommentNoteInput] = useState('')

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
  const primaryHeadline = getPrimaryHeadline(item, profileOverviewLabel)

  return (
    <Card className="overflow-hidden rounded-[1.5rem] border-slate-200 bg-white shadow-[0_18px_50px_-40px_rgba(15,23,42,0.7)]" lang={contentLocale}>
      {/* Header metadata bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">{t('resumes.columns.intention')}</span>
        <span className="font-medium">{item.resume.jobIntention || '--'}</span>
        {item.blocked ? (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 text-[10px]">
            {t('resumes.card.blocked', { defaultValue: '已屏蔽' })}
          </Badge>
        ) : null}
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
                    {analysis?.breakdown ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {Object.entries(analysis.breakdown).map(([key, value]) => (
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
      </div>

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
            <Star className="h-5 w-5 text-muted-foreground" />
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
              >
                {item.resume.name || unnamedResumeLabel}
              </a>
            ) : (
              <span className="font-semibold text-slate-900">{item.resume.name || unnamedResumeLabel}</span>
            )}
            {item.resume.activityStatus ? (
              <Badge variant="secondary">{item.resume.activityStatus}</Badge>
            ) : null}
            <Badge variant="outline" className={cn('text-[10px]', STATUS_BADGE_CLASS[candidateStatus])}>
              {statusLabel}
            </Badge>

            {/* Action buttons - pushed to the right */}
            <div className="ml-auto flex items-center gap-1">
              <StarRating value={userRating} onChange={onRating ? (rating) => onRating(item.resume.resumeId, rating) : undefined} size={14} />
              {onAction ? (
                <Button
                  variant={actionType === 'star' ? 'default' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => { e.stopPropagation(); onAction(item.resume.resumeId, 'star') }}
                  aria-label={t('resumes.actions.star', { defaultValue: '收藏' })}
                >
                  <Star className="h-4 w-4" />
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="h-8" onClick={onViewDetails}>
                {t('resumes.actions.view', { defaultValue: '查看详情' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="shrink-0 rounded-full whitespace-nowrap h-8"
                onClick={onToggleExpanded}
              >
                {expanded ? collapseLabel : expandLabel}
                {expanded ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Demographics row */}
          <div className="text-sm text-muted-foreground">
            {item.resume.age || '--'} | {item.resume.experience || '--'} | {item.resume.education || '--'} | {item.resume.location || '--'}
          </div>

          {/* Headline / self-intro snippet */}
          <div className="truncate text-sm text-slate-600">{primaryHeadline}</div>

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
            {workHistory.map(({ entry, text }, index) => (
              <div key={`${item.key}-wh-${index}`} className="flex gap-2">
                <span className="text-muted-foreground">●</span>
                <span className="truncate" title={entry.raw || text}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {expanded ? (
        <SnippetCardExpanded
          item={item}
          showAiScore={showAiScore}
          onViewDetails={onViewDetails}
          actionType={actionType}
          onAction={onAction}
          candidateStatus={candidateStatus}
          onCandidateStatusChange={(identityKey, nextStatus) => {
            if (nextStatus === 'interviewed_reject' || nextStatus === 'withdrawn') {
              setPendingStatus(nextStatus)
              setNoteInput(statusNotes)
              setPromptDialogOpen(true)
              return
            }
            onCandidateStatusChange?.(identityKey, nextStatus)
          }}
          statusOptions={STATUS_OPTIONS}
          onBlockTrigger={() => {
            if (item.blocked) {
              onToggleBlock?.(item.identityKey, true)
            } else {
              setBlockNoteInput('')
              setBlockDialogOpen(true)
            }
          }}
          onNoteTrigger={() => {
            setCommentNoteInput(statusNotes)
            setCommentDialogOpen(true)
          }}
        />
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

      {/* Notes/comment dialog */}
      <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resumes.card.notesTitle', { defaultValue: '备注' })}</DialogTitle>
            <DialogDescription>
              {t('resumes.card.notesDescription', {
                name: item.resume.name || '--',
                defaultValue: '为 {{name}} 添加备注。',
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={commentNoteInput}
            onChange={(e) => setCommentNoteInput(e.target.value)}
            placeholder={t('resumes.card.notePlaceholderInput', { defaultValue: '输入备注...' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const notes = commentNoteInput.trim()
                onCandidateStatusChange?.(item.identityKey, candidateStatus || 'new', notes.length > 0 ? notes : undefined)
                setCommentDialogOpen(false)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={() => {
                const notes = commentNoteInput.trim()
                onCandidateStatusChange?.(item.identityKey, candidateStatus || 'new', notes.length > 0 ? notes : undefined)
                setCommentDialogOpen(false)
              }}
            >
              {t('common.confirm', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
