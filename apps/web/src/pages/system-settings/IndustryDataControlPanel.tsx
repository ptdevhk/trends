import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatTime, type MaintenanceRun } from './industry-data-model'

export function IndustryDataControlPanel({
  schedulePaused,
  onToggleSchedule,
  onRunNow,
  companyKey,
  onCompanyKeyChange,
  onTrigger,
  runs,
}: {
  schedulePaused: boolean
  onToggleSchedule: () => void
  onRunNow: () => void
  companyKey: string
  onCompanyKeyChange: (value: string) => void
  onTrigger: () => void
  runs: MaintenanceRun[]
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="industry-data-control">
      <Card>
        <CardHeader>
          <CardTitle>
            {t('debugConfig.industryDataControlTitle', {
              defaultValue: 'Control center',
            })}
          </CardTitle>
          <CardDescription>
            {t('debugConfig.industryDataControlDesc', {
              defaultValue: 'Run maintenance, pause the schedule, or research one employer.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="industry-data-run-now"
              onClick={onRunNow}
            >
              {t('debugConfig.industryDataRunNow', { defaultValue: 'Run now' })}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="industry-data-schedule-toggle"
              onClick={onToggleSchedule}
            >
              {schedulePaused
                ? t('debugConfig.industryDataResume', { defaultValue: 'Resume schedule' })
                : t('debugConfig.industryDataPause', { defaultValue: 'Pause schedule' })}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="industry-data-schedule-status">
            {schedulePaused
              ? t('debugConfig.industryDataPausedState', {
                  defaultValue: 'Schedule is paused',
                })
              : t('debugConfig.industryDataActiveState', {
                  defaultValue: 'Schedule is active',
                })}
          </p>

          <div className="space-y-2 border-t pt-3">
            <label className="text-sm font-medium" htmlFor="industry-data-company-key">
              {t('debugConfig.industryDataScopedTrigger', {
                defaultValue: 'Research this employer now',
              })}
            </label>
            <div className="flex gap-2">
              <Input
                id="industry-data-company-key"
                data-testid="industry-data-company-key"
                value={companyKey}
                onChange={(e) => onCompanyKeyChange(e.target.value)}
                placeholder="lung-kee-metal"
              />
              <Button
                type="button"
                data-testid="industry-data-scoped-trigger"
                onClick={onTrigger}
              >
                {t('debugConfig.industryDataTrigger', { defaultValue: 'Research' })}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('debugConfig.industryDataRecentRuns', {
              defaultValue: 'Recent maintenance runs',
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('debugConfig.industryDataNoRuns', { defaultValue: 'No runs yet' })}
            </p>
          )}
          {runs.map((run) => (
            <div
              key={run.runId}
              className="rounded-md border p-2 text-sm"
              data-testid={`industry-data-run-${run.runId}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{run.runId}</span>
                <Badge variant="outline">{run.status ?? '—'}</Badge>
              </div>
              <p className="text-muted-foreground">{run.operatorSummary ?? run.triggerSource}</p>
              <p className="text-xs text-muted-foreground">{formatTime(run.startedAt)}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
