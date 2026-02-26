
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDistanceToNow } from 'date-fns'

interface WorkerStatus {
    jobs_executed: number
    jobs_failed: number
    jobs_missed: number
    last_run: string | null
    last_success: string | null
    last_failure: string | null
    schedule_type: string | null
    schedule_value: string | null
    running: boolean
    jobs: Array<{
        id: string
        name: string
        next_run: string | null
        trigger: string | null
    }>
}

interface SchedulerStatusProps {
    apiBaseUrl: string
}

function parseIsoDate(value: string | null): Date | null {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date
}

function formatRelativeTime(value: string | null, fallback: string): string {
    const date = parseIsoDate(value)
    if (!date) return fallback
    return formatDistanceToNow(date, { addSuffix: true })
}

function formatAbsoluteTime(value: string | null): string {
    const date = parseIsoDate(value)
    if (!date) return ''
    return date.toLocaleString()
}

function formatScheduleConfig(status: WorkerStatus): string {
    if (status.schedule_type === 'interval' && status.schedule_value) {
        return `Every ${status.schedule_value}`
    }
    if (status.schedule_type === 'cron' && status.schedule_value) {
        return `Cron: ${status.schedule_value}`
    }
    if (status.schedule_value) {
        return status.schedule_value
    }
    return 'Not configured'
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
        status.jobs.find(j => j.id.startsWith('crawl_profile_'))?.next_run || null
    const scheduleConfig = formatScheduleConfig(status)

    return (
        <Card className="bg-muted/30 border-dashed">
            <CardHeader className="py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                    <div className="space-y-1 lg:text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Schedule</p>
                        <p className="text-sm font-bold text-primary" title={status.schedule_value || ''}>
                            {scheduleConfig}
                        </p>
                    </div>
                    <div className="text-left lg:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next Run</p>
                        <p className="text-sm font-bold text-primary">
                            {formatRelativeTime(nextRun, 'Not scheduled')}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pb-6">
                <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1 border-l-2 border-primary/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Executed</p>
                            <p className="text-xl font-bold">{status.jobs_executed}</p>
                        </div>
                        <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Last Success</p>
                            <p className="text-sm font-medium truncate" title={status.last_success || ''}>
                                {formatRelativeTime(status.last_success, 'Never')}
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

                    <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Scheduled Jobs
                        </p>
                        {status.jobs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No scheduled jobs</p>
                        ) : (
                            <div className="rounded-md border bg-background/70">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="h-9">Job</TableHead>
                                            <TableHead className="h-9">Trigger</TableHead>
                                            <TableHead className="h-9">Next Run</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {status.jobs.map(job => (
                                            <TableRow key={job.id}>
                                                <TableCell className="py-2">
                                                    <div className="font-medium">{job.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{job.id}</div>
                                                </TableCell>
                                                <TableCell className="py-2">
                                                    <span className="text-xs font-mono">{job.trigger || 'unknown'}</span>
                                                </TableCell>
                                                <TableCell className="py-2" title={formatAbsoluteTime(job.next_run)}>
                                                    {formatRelativeTime(job.next_run, 'Not scheduled')}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
