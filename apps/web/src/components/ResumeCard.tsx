import { useTranslation } from 'react-i18next'
import { User } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ResumeItem } from '@/hooks/useResumes'

interface ResumeCardProps {
  resume: ResumeItem
  onViewDetails: () => void
}

export function ResumeCard({ resume, onViewDetails }: ResumeCardProps) {
  const { t } = useTranslation()
  const workHistory = resume.workHistory?.filter((item) => item.raw) ?? []

  return (
    <div className="mb-3 overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/50 px-4 py-2 text-sm">
        <span className="text-muted-foreground">求职意向</span>
        <span className="font-medium">{resume.jobIntention || '：--'}</span>
        {resume.expectedSalary ? (
          <span className="text-muted-foreground">{resume.expectedSalary}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 p-4 lg:flex-row">
        <div className="flex items-start gap-3">
          <Checkbox aria-label={t('resumes.columns.select')} />
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
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={onViewDetails}
            >
              {t('resumes.actions.view')}
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            {resume.age || '--'} | {resume.experience || '--'} | {resume.education || '--'} |{' '}
            {resume.location || '--'}
          </div>
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
