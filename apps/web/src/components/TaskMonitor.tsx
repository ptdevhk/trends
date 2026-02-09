import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import { Progress } from './ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'

export function TaskMonitor() {
    const tasks = useQuery(api.resume_tasks.list)

    if (!tasks || tasks.length === 0) {
        return null
    }

    return (
        <Card className="mb-6">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    Active Collections
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {tasks.map((task: Doc<"collection_tasks">) => (
                    <div key={task._id} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                                <StatusIcon status={task.status} />
                                <span className="font-medium">{task.config.keyword}</span>
                                <span className="text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded-full">
                                    {task.status}
                                </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {new Date(task._creationTime).toLocaleTimeString()}
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Progress: {task.progress.current} / {task.config.limit}</span>
                                <span>{Math.round((task.progress.current / task.config.limit) * 100)}%</span>
                            </div>
                            <Progress value={(task.progress.current / task.config.limit) * 100} className="h-2" />
                        </div>

                        {task.error && (
                            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2 rounded-md">
                                <XCircle className="h-3.5 w-3.5" />
                                {task.error}
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}

function StatusIcon({ status }: { status: string }) {
    switch (status) {
        case "completed": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
        case "processing": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
        default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
}
