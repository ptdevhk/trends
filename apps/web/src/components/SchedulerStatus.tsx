
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'

interface WorkerStatus {
    jobs_executed: number
    jobs_failed: number
    jobs_missed: number
    last_run: string | null
    last_success: string | null
    last_failure: string | null
    running: boolean
    jobs: Array<{
        id: string
        name: string
        next_run: string | null
    }>
}

interface SchedulerStatusProps {
    apiBaseUrl: string
}

export function SchedulerStatus({ apiBaseUrl }: SchedulerStatusProps) {
    const [status, setStatus] = useState<WorkerStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function fetchStatus() {
            try {
                const response = await fetch(`${apiBaseUrl}/worker/status`)
                if (!response.ok) throw new Error('Failed to fetch status')
                const data = await response.json()
                setStatus(data)
                setError(null)
            } catch (err) {
                console.error('Failed to fetch scheduler status', err)
                setError('Failed to load scheduler status')
            } finally {
                setLoading(false)
            }
        }

        fetchStatus()
        const interval = setInterval(fetchStatus, 30000) // Poll every 30s
        return () => clearInterval(interval)
    }, [apiBaseUrl])

    if (loading) {
        return (
            <Card className="bg-muted/30 border-dashed">
                <CardHeader className="py-4">
                    <CardTitle className="text-lg">Scheduler Status</CardTitle>
                    <CardDescription>Loading...</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    if (error || !status) {
        return (
            <Card className="bg-muted/30 border-dashed border-red-200">
                <CardHeader className="py-4">
                    <CardTitle className="text-lg text-red-600">Scheduler Offline</CardTitle>
                    <CardDescription>{error || 'Unknown error'}</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    const nextRun = status.jobs.find(j => j.id === 'crawl_analyze')?.next_run ||
        status.jobs.find(j => j.id.startsWith('crawl_profile_'))?.next_run

    return (
        <Card className="bg-muted/30 border-dashed">
            <CardHeader className="py-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                            Cron Scheduler
                            <Badge variant="outline" className={`font-mono text-[10px] ${status.running ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' : 'bg-red-500/5 text-red-600 border-red-500/20'}`}>
                                {status.running ? 'RUNNING' : 'STOPPED'}
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            Automated crawling and analysis tasks.
                        </CardDescription>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next Run</p>
                        <p className="text-sm font-bold text-primary">
                            {nextRun ? formatDistanceToNow(new Date(nextRun), { addSuffix: true }) : 'Not scheduled'}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pb-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1 border-l-2 border-primary/20 pl-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Executed</p>
                        <p className="text-xl font-bold">{status.jobs_executed}</p>
                    </div>
                    <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Last Success</p>
                        <p className="text-sm font-medium truncate" title={status.last_success || ''}>
                            {status.last_success ? formatDistanceToNow(new Date(status.last_success), { addSuffix: true }) : 'Never'}
                        </p>
                    </div>
                    <div className="space-y-1 border-l-2 border-destructive/20 pl-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Failed</p>
                        <p className="text-xl font-bold text-destructive">{status.jobs_failed}</p>
                    </div>
                    <div className="space-y-1 border-l-2 border-amber-500/20 pl-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Missed</p>
                        <p className="text-xl font-bold text-amber-600">{status.jobs_missed}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
