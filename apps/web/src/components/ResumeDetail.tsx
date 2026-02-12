import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ResumeItem } from '@/hooks/useResumes'

import type { MatchingResult } from '@/types/resume'

interface ResumeDetailProps {
  resume: ResumeItem | null
  matchResult?: MatchingResult
  open: boolean
  onOpenChange: (open: boolean) => void
}

function isSafeProfileUrl(value: string | undefined): value is string {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

export function ResumeDetail({ resume, matchResult, open, onOpenChange }: ResumeDetailProps) {
  const { t } = useTranslation()

  const workHistory = useMemo(() => {
    if (!resume?.workHistory?.length) return []
    return resume.workHistory.filter((item) => item.raw)
  }, [resume])
  const profileUrl = resume?.profileUrl?.trim()
  const hasProfileUrl = isSafeProfileUrl(profileUrl)

  if (!resume) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('resumes.detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('resumes.detail.description', 'Review resume details and AI analysis summary.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {matchResult && (
            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2">
                  AI Analysis
                  <Badge variant={matchResult.score >= 80 ? 'default' : matchResult.score >= 60 ? 'secondary' : 'outline'}>
                    {matchResult.score} 分
                  </Badge>
                </h3>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                  {matchResult.recommendation?.replace('_', ' ')}
                </span>
              </div>

              <p className="text-sm text-foreground mb-3">{matchResult.summary}</p>

              <div className="grid grid-cols-2 gap-4 mb-3">
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
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('resumes.columns.name')}</p>
              <p className="font-medium">{resume.name || '--'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('resumes.columns.age')}</p>
              <p className="font-medium">{resume.age || '--'}</p>
            </div>
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
          </div>

          <div>
            <p className="text-sm text-muted-foreground">{t('resumes.detail.workHistory')}</p>
            {workHistory.length === 0 ? (
              <p className="text-sm">--</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {workHistory.map((item, index) => (
                  <li key={`${resume.name}-${index}`} className="rounded-md border border-border p-3">
                    {item.raw}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
