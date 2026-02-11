import { useMutation, useQuery } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { Progress } from './ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from './ui/button'

type AnalysisTaskDoc = Doc<'analysis_tasks'>

function getStatusLabel(status: AnalysisTaskDoc['status']): string {
  switch (status) {
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Pending'
  }
}

function getStatusBadgeClass(status: AnalysisTaskDoc['status']): string {
  if (status === 'completed') {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  }
  if (status === 'failed') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  }
  if (status === 'cancelled') {
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
  }
  if (status === 'processing') {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
}

function StatusIcon({ status }: { status: AnalysisTaskDoc['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />
  }
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-destructive" />
  }
  if (status === 'cancelled') {
    return <XCircle className="h-4 w-4 text-orange-500" />
  }
  if (status === 'processing') {
    return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
  }
  return <Clock className="h-4 w-4 text-muted-foreground" />
}

function TaskItem({
  task,
  onCancel,
}: {
  task: AnalysisTaskDoc
  onCancel: (args: { taskId: AnalysisTaskDoc['_id'] }) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [cancelling, setCancelling] = useState(false)
  const isActive = task.status === 'pending' || task.status === 'processing'
  const total = task.progress.total || task.config.resumeCount || 1
  const progress = Math.min(100, Math.max(0, Math.round((task.progress.current / total) * 100)))
  const taskTitle = task.config.jobDescriptionTitle || task.config.jobDescriptionId

  return (
    <div className="space-y-2 border-b last:border-0 last:pb-0 pb-4">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <StatusIcon status={task.status} />
          <span className="font-medium">{taskTitle}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getStatusBadgeClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {new Date(task._creationTime).toLocaleTimeString()}
          </div>
          {isActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
              disabled={cancelling}
              onClick={async () => {
                setCancelling(true)
                await onCancel({ taskId: task._id })
              }}
            >
              {cancelling ? t('aiTasks.monitor.cancelling') : t('aiTasks.monitor.cancel')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {t('aiTasks.monitor.progress')}: {task.progress.current} / {total} ({t('aiTasks.monitor.skipped')}: {task.progress.skipped})
          </span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
        {task.lastStatus ? (
          <p className="text-[10px] text-primary font-medium mt-1">{task.lastStatus}</p>
        ) : null}
      </div>

      {task.status === 'completed' && task.results ? (
        <div className="text-xs text-muted-foreground">
          {t('aiTasks.monitor.analyzed')}: {task.results.analyzed} | {t('aiTasks.monitor.avgScore')}: {task.results.avgScore} | {t('aiTasks.monitor.highScore')}: {task.results.highScoreCount}
        </div>
      ) : null}

      {task.status === 'failed' ? (
        <div className="text-xs text-destructive">
          {t('aiTasks.monitor.failed')}
          {task.error ? `: ${task.error}` : ''}
        </div>
      ) : null}
    </div>
  )
}

export function AnalysisTaskMonitor() {
  const { t } = useTranslation()
  const tasks = useQuery(api.analysis_tasks.list)
  const cancelTask = useMutation(api.analysis_tasks.cancel)
  const [showHistory, setShowHistory] = useState(false)

  if (!tasks || tasks.length === 0) {
    return null
  }

  const activeTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'processing')
  const finishedTasks = tasks.filter((task) => task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
  const hasActive = activeTasks.length > 0

  if (!hasActive && !showHistory && finishedTasks.length > 0) {
    return (
      <Card className="mb-6 bg-muted/20">
        <CardContent className="py-3 flex items-center justify-between">
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
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {hasActive ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <Clock className="h-5 w-5 text-muted-foreground" />
            )}
            {hasActive ? t('aiTasks.monitor.activeTitle') : t('aiTasks.monitor.historyTitle')}
          </CardTitle>
          {finishedTasks.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHistory((prev) => !prev)}
              className="text-xs h-8"
            >
              {showHistory ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {showHistory ? t('aiTasks.monitor.hideHistory') : t('aiTasks.monitor.showHistory')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {activeTasks.map((task) => (
          <TaskItem key={task._id} task={task} onCancel={cancelTask} />
        ))}

        {showHistory ? (
          finishedTasks.map((task) => (
            <TaskItem key={task._id} task={task} onCancel={cancelTask} />
          ))
        ) : null}
      </CardContent>
    </Card>
  )
}
