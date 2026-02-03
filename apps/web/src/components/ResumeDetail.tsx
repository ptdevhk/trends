import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import type { ResumeItem } from '@/hooks/useResumes'

interface ResumeDetailProps {
  resume: ResumeItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ResumeDetail({ resume, open, onOpenChange }: ResumeDetailProps) {
  const { t } = useTranslation()

  const workHistory = useMemo(() => {
    if (!resume?.workHistory?.length) return []
    return resume.workHistory.filter((item) => item.raw)
  }, [resume])

  if (!resume) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('resumes.detail.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
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
          {resume.profileUrl ? (
            <a
              className={buttonVariants()}
              href={resume.profileUrl}
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
