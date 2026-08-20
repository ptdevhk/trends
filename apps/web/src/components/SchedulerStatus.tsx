
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'
import { useTranslation } from 'react-i18next'
import { apiClient } from '@/lib/api-client'
import { reportUiError } from '@/lib/ui-error-reporting'

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

function formatScheduleConfig(status: WorkerStatus, t: ReturnType<typeof useTranslation>['t']): string {
    if (status.schedule_type === 'interval' && status.schedule_value) {
        return t('debugConfig.scheduleEvery', { defaultValue: 'Every {{value}}', value: status.schedule_value })
    }
    if (status.schedule_type === 'cron' && status.schedule_value) {
        return t('debugConfig.scheduleCron', { defaultValue: 'Cron: {{value}}', value: status.schedule_value })
    }
    if (status.schedule_value) {
        return status.schedule_value
    }
    return t('debugConfig.notConfigured')
}

export function SchedulerStatus() {
    const { t } = useTranslation()
    const [status, setStatus] = useState<WorkerStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function fetchStatus() {
            try {
                const { data, response } = await apiClient.GET('/api/worker/status')
                if (!response.ok) throw new Error('Failed to fetch status')
                setStatus(data as WorkerStatus)
                setError(null)
            } catch (err) {
                reportUiError('Failed to fetch scheduler status', err)
                setError(t('debugConfig.schedulerLoadFailed', { defaultValue: 'Failed to load scheduler status' }))
            } finally {
                setLoading(false)
            }
        }

        fetchStatus()
        const interval = setInterval(fetchStatus, 30000) // Poll every 30s
        return () => clearInterval(interval)
    }, [])

    if (loading) {
        // Reserve the loaded card height (measured ~232px with an empty job
        // table) so the loading→loaded swap never shifts the grid row (CLS).
        return (
            <Card data-testid="scheduler-status-loading" className="bg-muted/30 border-dashed min-h-[232px]">
                <CardHeader className="py-4">
                    <CardTitle className="text-lg">{t('debugConfig.schedulerStatus', { defaultValue: 'Scheduler Status' })}</CardTitle>
                    <CardDescription>{t('common.loading', { defaultValue: 'Loading...' })}</CardDescription>
                </CardHeader>
                <CardContent className="pb-6">
                    <div className="space-y-5" aria-hidden="true">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="space-y-1 border-l-2 border-primary/20 pl-3">
                                    <Skeleton className="h-3 w-14" />
                                    <Skeleton className="h-6 w-10" />
                                </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-3 w-28" />
                            <Skeleton className="h-4 w-40" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (error || !status) {
        return (
            <Card className="bg-muted/30 border-dashed border-red-200 min-h-[232px]">
                <CardHeader className="py-4">
                    <CardTitle className="text-lg text-red-600">{t('debugConfig.schedulerOffline', { defaultValue: 'Scheduler Offline' })}</CardTitle>
                    <CardDescription>{error || t('debugConfig.unknownError', { defaultValue: 'Unknown error' })}</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    const nextRun = status.jobs.find(j => j.id === 'crawl_analyze')?.next_run ||
        status.jobs.find(j => j.id.startsWith('crawl_profile_'))?.next_run || null
    const scheduleConfig = formatScheduleConfig(status, t)

    return (
        <Card className="bg-muted/30 border-dashed">
            <CardHeader className="py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                            {t('debugConfig.cronScheduler')}
                            <Badge variant="outline" className={`font-mono text-[10px] ${status.running ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20' : 'bg-red-500/5 text-red-600 border-red-500/20'}`}>
                                {status.running ? t('debugConfig.running') : t('debugConfig.stopped')}
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            {t('debugConfig.cronSchedulerDescription')}
                        </CardDescription>
                    </div>
                    <div className="space-y-1 lg:text-center">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.schedule')}</p>
                        <p className="text-sm font-bold text-primary" title={status.schedule_value || ''}>
                            {scheduleConfig}
                        </p>
                    </div>
                    <div className="text-left lg:text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.nextRun')}</p>
                        <p className="text-sm font-bold text-primary">
                            {formatRelativeTime(nextRun, t('debugConfig.notScheduled'))}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pb-6">
                <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1 border-l-2 border-primary/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.executed')}</p>
                            <p className="text-xl font-bold">{status.jobs_executed}</p>
                        </div>
                        <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.lastSuccess')}</p>
                            <p className="text-sm font-medium truncate" title={status.last_success || ''}>
                                {formatRelativeTime(status.last_success, t('debugConfig.never'))}
                            </p>
                        </div>
                        <div className="space-y-1 border-l-2 border-destructive/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.failed')}</p>
                            <p className="text-xl font-bold text-destructive">{status.jobs_failed}</p>
                        </div>
                        <div className="space-y-1 border-l-2 border-amber-500/20 pl-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{t('debugConfig.missed')}</p>
                            <p className="text-xl font-bold text-amber-600">{status.jobs_missed}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {t('debugConfig.scheduledJobs')}
                        </p>
                        {status.jobs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t('debugConfig.noScheduledJobs')}</p>
                        ) : (
                            <div className="rounded-md border bg-background/70">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="h-9">{t('debugConfig.job')}</TableHead>
                                            <TableHead className="h-9">{t('debugConfig.trigger')}</TableHead>
                                            <TableHead className="h-9">{t('debugConfig.nextRun')}</TableHead>
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
                                                    {formatRelativeTime(job.next_run, t('debugConfig.notScheduled'))}
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
