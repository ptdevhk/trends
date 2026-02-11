import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Progress } from './ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { formatInAppTimezone } from '@/lib/timezone'

export function TaskMonitor() {
    const tasks = useQuery(api.resume_tasks.list)
    const [showHistory, setShowHistory] = useState(false)
    const cancelTask = useMutation(api.resume_tasks.cancel)

    if (!tasks || tasks.length === 0) {
        return null
    }

    const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'processing')
    const finishedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')

    const hasActive = activeTasks.length > 0
    // If only finished tasks exist and history is hidden, don't render anything (or just a small summary?)
    // User complaint was "blocking". Maybe better to just hide completely if no active tasks?
    // But we want to show "Completed" status at least once.
    // Let's render active tasks always. If no active tasks, render finished tasks but collapsed by default?

    if (!hasActive && !showHistory && finishedTasks.length > 0) {
        // Show a small dismissal or summary
        return (
            <Card className="mb-6 bg-muted/20">
                <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span>All tasks completed ({finishedTasks.length})</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)} className="h-8 text-xs">
                        {showHistory ? "Hide History" : "Show History"}
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
                        {hasActive ? "Active Collections" : "Collection History"}
                    </CardTitle>
                    {finishedTasks.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowHistory(!showHistory)}
                            className="text-xs h-8"
                        >
                            {showHistory ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                            {showHistory ? "Hide History" : "View History"}
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
                {activeTasks.map((task) => (
                    <TaskItem key={task._id} task={task} onCancel={cancelTask} />
                ))}

                {showHistory && finishedTasks.map((task) => (
                    <TaskItem key={task._id} task={task} onCancel={cancelTask} />
                ))}

                {!hasActive && !showHistory && (
                    <p className="text-sm text-muted-foreground text-center py-2">No active tasks.</p>
                )}
            </CardContent>
        </Card>
    )
}

function TaskItem({ task, onCancel }: { task: Doc<"collection_tasks">, onCancel?: (args: { taskId: any }) => Promise<any> }) {
    const isActive = task.status === 'pending' || task.status === 'processing'

    return (
        <div className="space-y-2 border-b last:border-0 last:pb-0 pb-4">
            <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                    <StatusIcon status={task.status} />
                    <span className="font-medium">{task.config.keyword}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${task.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        task.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            task.status === 'cancelled' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                task.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                        {task.status === 'processing' ? 'Processing' :
                            task.status === 'completed' ? 'Completed' :
                                task.status === 'failed' ? 'Failed' :
                                    task.status === 'cancelled' ? 'Cancelled' : 'Pending'}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-xs text-muted-foreground">
                        {formatInAppTimezone(task._creationTime)}
                    </div>
                    {isActive && onCancel && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                            onClick={async (e) => {
                                const btn = e.currentTarget;
                                btn.disabled = true;
                                btn.innerText = 'Cancelling...';
                                await onCancel({ taskId: task._id });
                            }}
                        >
                            Cancel
                        </Button>
                    )}
                </div>
            </div>

            <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <span>Progress: {task.progress.current} / {task.config.limit}</span>
                        {task.status === 'processing' && task.progress.page > 0 && (
                            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">Page {task.progress.page}</span>
                        )}
                    </div>
                    <span>{Math.round((task.progress.current / task.config.limit) * 100)}%</span>
                </div>
                <Progress value={(task.progress.current / task.config.limit) * 100} className="h-2" />

                {task.status === 'processing' && task.lastStatus && (
                    <p className="text-[10px] text-primary font-medium animate-pulse mt-1">
                        {task.lastStatus}
                    </p>
                )}

                {task.workerId && (
                    <p className="text-[9px] text-muted-foreground/60 mt-1">
                        Worker: <span className="font-mono">{task.workerId.split('-').pop()}</span>
                    </p>
                )}
            </div>

            {task.error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
                    <XCircle className="h-3.5 w-3.5" />
                    {task.error}
                </div>
            )}
        </div>
    )
}

function StatusIcon({ status }: { status: string }) {
    switch (status) {
        case "completed": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
        case "cancelled": return <XCircle className="h-4 w-4 text-orange-500" />;
        case "processing": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
        default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
}
