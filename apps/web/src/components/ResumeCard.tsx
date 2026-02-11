import { useTranslation } from 'react-i18next'
import { Star, User, XCircle, CheckCircle } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ResumeItem } from '@/hooks/useResumes'
import type { CandidateActionType, MatchingResult } from '@/types/resume'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface ResumeCardProps {
  resume: ResumeItem
  onViewDetails: () => void
  matchResult?: MatchingResult
  showAiScore?: boolean
  actionType?: CandidateActionType
  onAction?: (actionType: CandidateActionType) => void
  selected?: boolean
  onSelect?: () => void
}

export function ResumeCard({
  resume,
  onViewDetails,
  matchResult,
  showAiScore,
  actionType,
  onAction,
  selected,
  onSelect,
}: ResumeCardProps) {
  const { t } = useTranslation()
  const workHistory = resume.workHistory?.filter((item) => item.raw) ?? []
  const jobIntention = (resume.jobIntention || '').replace(/^[:：]\s*/, '') || '--'
  const selfIntro = resume.selfIntro || '--'

  const score = matchResult?.score
  const recommendation = matchResult?.recommendation
  const scoreSource = matchResult?.scoreSource
  const scoreLabel = recommendation ? t(`resumes.matching.recommendations.${recommendation}`) : ''

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

  const scoreSourceClassName =
    scoreSource === 'ai'
      ? 'bg-sky-600 text-white border-sky-700'
      : scoreSource === 'rule'
        ? 'bg-amber-500 text-white border-amber-600'
        : ''

  return (
    <div className="mb-3 overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">求职意向</span>
        <span className="font-medium">{jobIntention}</span>
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
        ) : null}
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
            {resume.profileUrl ? (
              <a
                className="font-medium text-foreground hover:underline"
                href={resume.profileUrl}
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
            </div>
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
    </div>
  )
}
