import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, XCircle } from 'lucide-react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export function AnalysisTaskMonitor() {
  const { t } = useTranslation()
  const tasks = useQuery(api.analysis_tasks.list)
  const cancelTask = useMutation(api.analysis_tasks.cancel)
  const [showHistory, setShowHistory] = useState(false)

  if (!tasks || tasks.length === 0) {
    return null
  }

  const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'processing')
  const finishedTasks = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
  )

  const hasActive = activeTasks.length > 0

  if (!hasActive && !showHistory && finishedTasks.length > 0) {
    return (
      <Card className="bg-muted/20">
        <CardContent className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{t('aiTasks.monitor.allCompleted')}</span>
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowHistory(true)}>
            {t('aiTasks.monitor.showHistory')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {hasActive ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Clock className="h-5 w-5" />}
            {hasActive ? t('aiTasks.monitor.activeTitle') : t('aiTasks.monitor.historyTitle')}
          </CardTitle>
          {finishedTasks.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowHistory((prev) => !prev)}>
              {showHistory ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
              {showHistory ? t('aiTasks.monitor.hideHistory') : t('aiTasks.monitor.showHistory')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {activeTasks.map((task) => (
          <AnalysisTaskItem key={task._id} task={task} onCancel={cancelTask} />
        ))}

        {showHistory
          ? finishedTasks.map((task) => <AnalysisTaskItem key={task._id} task={task} onCancel={cancelTask} />)
          : null}
      </CardContent>
    </Card>
  )
}

function AnalysisTaskItem({
  task,
  onCancel,
}: {
  task: Doc<'analysis_tasks'>
  onCancel: (args: { taskId: Doc<'analysis_tasks'>['_id'] }) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const isActive = task.status === 'pending' || task.status === 'processing'
  const progress = task.progress.total > 0 ? (task.progress.current / task.progress.total) * 100 : 0

  return (
    <div className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <StatusIcon status={task.status} />
          <span className="font-medium">{task.config.jobDescriptionTitle || task.config.jobDescriptionId}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass(task.status)}`}>
            {task.status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">{new Date(task._creationTime).toLocaleTimeString()}</div>
          {isActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={async (event) => {
                const button = event.currentTarget
                button.disabled = true
                button.innerText = t('aiTasks.monitor.cancelling')
                await onCancel({ taskId: task._id })
              }}
            >
              {t('aiTasks.monitor.cancel')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {t('aiTasks.monitor.progress')}: {task.progress.current} / {task.progress.total} ({t('aiTasks.monitor.skipped')}: {task.progress.skipped})
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />

        {task.lastStatus ? <p className="mt-1 text-[10px] font-medium text-primary">{task.lastStatus}</p> : null}

        {task.status === 'completed' && task.results ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('aiTasks.monitor.analyzed')}: {task.results.analyzed} | {t('aiTasks.monitor.avgScore')}: {task.results.avgScore} | {t('aiTasks.monitor.highScore')}: {task.results.highScoreCount}
          </p>
        ) : null}

        {task.status === 'failed' && task.error ? (
          <p className="mt-1 text-xs text-destructive">
            {t('aiTasks.monitor.failed')}: {task.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: Doc<'analysis_tasks'>['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />
    case 'cancelled':
      return <XCircle className="h-4 w-4 text-orange-500" />
    case 'processing':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

function statusClass(status: Doc<'analysis_tasks'>['status']) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    case 'cancelled':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    case 'processing':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
  }
}
