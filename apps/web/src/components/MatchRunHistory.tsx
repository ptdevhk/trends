import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, XCircle } from 'lucide-react'
import { useMatchRunHistory, type MatchRunItem } from '@/hooks/useMatchRunHistory'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type MatchRunHistoryProps = {
  sessionId?: string
  jobDescriptionId?: string
}

function runStatusClass(status: MatchRunItem['status']): string {
  if (status === 'completed') {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  }
  if (status === 'failed') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  }
  if (status === 'processing') {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
}

function runStatusLabel(status: MatchRunItem['status']): string {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'processing') return 'Processing'
  return 'Pending'
}

function runModeLabel(mode: MatchRunItem['mode']): string {
  if (mode === 'rules_only') return 'Rules'
  if (mode === 'ai_only') return 'AI'
  return 'Hybrid'
}

function RunItem({ run }: { run: MatchRunItem }) {
  const { t } = useTranslation()
  const total = Math.max(run.totalCount, 1)
  const current = Math.min(Math.max(run.processedCount, 0), total)
  const progress = Math.min(100, Math.max(0, Math.round((current / total) * 100)))

  return (
    <div className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {run.status === 'processing' ? (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          ) : run.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-destructive" />
          )}
          <span className="font-medium">{run.jobDescriptionId}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${runStatusClass(run.status)}`}
          >
            {runStatusLabel(run.status)}
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {runModeLabel(run.mode)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(run.startedAt).toLocaleTimeString()}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {t('aiTasks.monitor.progress')}: {current} / {total}
          </span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {run.status === 'completed' ? (
        <div className="text-xs text-muted-foreground">
          {t('aiTasks.monitor.analyzed')}: {run.processedCount} | {t('aiTasks.monitor.avgScore')}: {run.avgScore ?? 0}
          {typeof run.matchedCount === 'number' ? ` | ${t('aiTasks.monitor.highScore')}: ${run.matchedCount}` : ''}
        </div>
      ) : null}

      {run.status === 'failed' ? (
        <div className="text-xs text-destructive">
          {t('aiTasks.monitor.failed')}
          {run.error ? `: ${run.error}` : ''}
        </div>
      ) : null}
    </div>
  )
}

export function MatchRunHistory({ sessionId, jobDescriptionId }: MatchRunHistoryProps) {
  const { t } = useTranslation()
  const { runs, loading, error } = useMatchRunHistory({
    sessionId,
    jobDescriptionId,
    enabled: true,
    limit: 20,
  })
  const [showHistory, setShowHistory] = useState(false)

  const { activeRuns, finishedRuns } = useMemo(() => {
    return {
      activeRuns: runs.filter((run) => run.status === 'processing'),
      finishedRuns: runs.filter((run) => run.status === 'completed' || run.status === 'failed'),
    }
  }, [runs])

  if (loading && runs.length === 0) {
    return null
  }
  if (error && runs.length === 0) {
    return null
  }
  if (runs.length === 0) {
    return null
  }

  const hasActive = activeRuns.length > 0
  const latestFinishedRun = finishedRuns[0]
  const latestFinishedFailed = latestFinishedRun?.status === 'failed'

  if (!hasActive && !showHistory && finishedRuns.length > 0) {
    if (latestFinishedFailed) {
      return (
        <Card className="mb-6 bg-muted/20">
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              <span>
                {t('aiTasks.monitor.failed')}
                {latestFinishedRun?.error ? `: ${latestFinishedRun.error}` : ''}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)} className="h-8 text-xs">
              {t('aiTasks.monitor.showHistory')}
            </Button>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card className="mb-6 bg-muted/20">
        <CardContent className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{t('aiTasks.monitor.allCompleted')}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowHistory(true)} className="h-8 text-xs">
            {t('aiTasks.monitor.showHistory')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mb-6">
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {hasActive ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <Clock className="h-5 w-5 text-muted-foreground" />
            )}
            {hasActive ? t('aiTasks.monitor.activeTitle') : t('aiTasks.monitor.historyTitle')}
          </CardTitle>
          {finishedRuns.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((prev) => !prev)}
              className="h-8 text-xs"
            >
              {showHistory ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
              {showHistory ? t('aiTasks.monitor.hideHistory') : t('aiTasks.monitor.showHistory')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {activeRuns.map((run) => (
          <RunItem key={run.id} run={run} />
        ))}
        {showHistory ? finishedRuns.map((run) => <RunItem key={run.id} run={run} />) : null}
      </CardContent>
    </Card>
  )
}
