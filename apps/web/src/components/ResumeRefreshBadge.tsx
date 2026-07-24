import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { ResumeRefreshState } from '@/lib/resume-freshness'

type ResumeRefreshBadgeProps = {
  refreshState?: ResumeRefreshState | null
  mode?: 'generic' | 'admin'
}

const ACTION_BADGE_CLASS: Record<'reingest' | 'rerun_analysis', string> = {
  reingest: 'border-amber-200 bg-amber-50 text-amber-700',
  rerun_analysis: 'border-orange-200 bg-orange-50 text-orange-700',
}

export function ResumeRefreshBadge({
  refreshState,
  mode = 'generic',
}: ResumeRefreshBadgeProps) {
  const { t } = useTranslation()

  if (!refreshState?.isStale) {
    return null
  }

  if (mode === 'generic') {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-[10px]">
        {t('resumes.refresh.needsRefresh', { defaultValue: 'Needs refresh' })}
      </Badge>
    )
  }

  return (
    <>
      {refreshState.actions.map((action) => (
        <Fragment key={action}>
          <Badge variant="outline" className={ACTION_BADGE_CLASS[action]}>
            {action === 'reingest'
              ? t('resumes.refresh.reingest', { defaultValue: 'Re-ingest' })
              : t('resumes.refresh.rerunAnalysis', { defaultValue: 'Re-run analysis' })}
          </Badge>
        </Fragment>
      ))}
    </>
  )
}
