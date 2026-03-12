import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { buildWorkHistoryDateRange, normalizeWorkHistoryEntry } from '@trends/shared'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AiFeedbackButtons } from '@/components/AiFeedbackButtons'
import type { ResumeItem } from '@/hooks/useResumes'

import type { AiFeedbackSentiment, AiFeedbackTarget, MatchingResult } from '@/types/resume'

interface ResumeDetailProps {
  resume: ResumeItem | null
  matchResult?: MatchingResult
  open: boolean
  onOpenChange: (open: boolean) => void
  aiScoreFeedback?: AiFeedbackSentiment
  aiSummaryFeedback?: AiFeedbackSentiment
  onAiFeedback?: (target: AiFeedbackTarget, sentiment: AiFeedbackSentiment) => void
}

function isSafeProfileUrl(value: string | undefined): value is string {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

export function ResumeDetail({ resume, matchResult, open, onOpenChange, aiScoreFeedback, aiSummaryFeedback, onAiFeedback }: ResumeDetailProps) {
  const { t } = useTranslation()
  const [isInfoExpanded, setIsInfoExpanded] = useState(false)

  const workHistory = useMemo(() => {
    if (!resume?.workHistory?.length) return []
    return resume.workHistory.filter((item) => normalizeWorkHistoryEntry(item) !== null)
  }, [resume])
  const profileUrl = resume?.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)
  const scoreLabel = matchResult
    ? t(`resumes.matching.recommendations.${matchResult.recommendation}`, {
        defaultValue: matchResult.recommendation.replace(/_/g, ' '),
      })
    : ''

  if (!resume) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('resumes.detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('resumes.detail.description', 'Review resume details and AI analysis summary.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="text-sm relative">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.name')}</p>
                <p className="font-medium">{resume.name || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.age')}</p>
                <p className="font-medium">{resume.age || '--'}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 text-muted-foreground hover:text-foreground h-8 px-2"
              onClick={() => setIsInfoExpanded(!isInfoExpanded)}
            >
              {isInfoExpanded ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}
              {isInfoExpanded ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
            </Button>
          </div>

          {isInfoExpanded && (
            <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t">
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.experience')}</p>
                <p className="font-medium">{resume.experience || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.education')}</p>
                <p className="font-medium">{resume.education || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.location')}</p>
                <p className="font-medium">{resume.location || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.salary')}</p>
                <p className="font-medium">{resume.expectedSalary || '--'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground">{t('resumes.columns.intention')}</p>
                <p className="font-medium">{resume.jobIntention || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('resumes.columns.activity')}</p>
                <p className="font-medium">{resume.activityStatus || '--'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ID</p>
                <p className="font-medium">
                  {[resume.resumeId, resume.perUserId].filter(Boolean).join(' / ') || '--'}
                </p>
              </div>
              {resume.extractedAt && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('resumes.detail.extractedAt')}</p>
                  <p className="font-medium">
                    {new Date(resume.extractedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {resume.selfIntro && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('resumes.detail.selfIntro')}</p>
                  <div className="mt-1 whitespace-pre-wrap">
                    {resume.selfIntro}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-sm text-muted-foreground mb-2">{t('resumes.detail.workHistory')}</p>
            {workHistory.length === 0 ? (
              <p className="text-sm">--</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {workHistory.map((item, index) => {
                  const dateRange = buildWorkHistoryDateRange(item.startDate, item.endDate)
                  const heading = [item.companyName, item.jobTitle].filter(Boolean).join(' · ')
                  return (
                    <li key={`${resume.name}-${index}`} className="rounded-md border border-border p-3 space-y-1">
                      {heading ? <div className="font-medium">{heading}</div> : null}
                      {dateRange ? <div className="text-xs text-muted-foreground">{dateRange}</div> : null}
                      {item.description ? <div className="whitespace-pre-wrap">{item.description}</div> : null}
                      {!heading && !dateRange && !item.description ? <div>{item.raw}</div> : null}
                      {item.raw && (heading || dateRange || item.description) ? (
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">{item.raw}</div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {matchResult && (
            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  AI Analysis
                  <Badge variant={matchResult.score >= 80 ? 'default' : matchResult.score >= 60 ? 'secondary' : 'outline'}>
                    {matchResult.score} 分
                  </Badge>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                    {scoreLabel}
                  </span>
                  {onAiFeedback ? (
                    <AiFeedbackButtons
                      feedback={aiScoreFeedback}
                      label="AI score"
                      testId="detail-ai-score-feedback"
                      onSelect={(sentiment) => onAiFeedback('ai_score', sentiment)}
                    />
                  ) : null}
                </h3>
              </div>

              <div className="mb-3">
                <p className="text-sm text-foreground">{matchResult.summary}</p>
              </div>

              <div className={`grid gap-4 mb-3 ${matchResult.highlights?.length && matchResult.concerns?.length ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {matchResult.highlights && matchResult.highlights.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-green-600 mb-1">Highlights</h4>
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {matchResult.highlights.map((h, i) => <li key={i}>{h}</li>)}
                    </ul>
                  </div>
                )}
                {matchResult.concerns && matchResult.concerns.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-red-600 mb-1">Concerns</h4>
                    <ul className="list-disc list-inside text-xs text-muted-foreground">
                      {matchResult.concerns.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {matchResult.breakdown && (
                <div className="bg-background rounded p-2 border">
                  <h4 className="text-xs font-semibold mb-2">Detailed Breakdown</h4>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {Object.entries(matchResult.breakdown).map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <span className="text-[10px] text-muted-foreground uppercase truncate" title={k}>{k.replace('_', ' ')}</span>
                        <span className="text-sm font-mono font-bold">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {onAiFeedback ? (
                <div className="mt-3 flex items-center justify-end border-t border-slate-200 dark:border-slate-800 pt-3">
                  <span className="text-xs text-muted-foreground mr-3">Summary Feedback</span>
                  <AiFeedbackButtons
                    feedback={aiSummaryFeedback}
                    label="AI summary"
                    testId="detail-ai-summary-feedback"
                    onSelect={(sentiment) => onAiFeedback('ai_summary', sentiment)}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {hasProfileUrl ? (
            <a
              className={buttonVariants()}
              href={profileUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('resumes.detail.profileLink')}
            </a>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('resumes.detail.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
