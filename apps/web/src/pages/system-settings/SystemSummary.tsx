import { useQuery } from 'convex/react'
import { useTranslation } from 'react-i18next'
import { api } from '../../../../../packages/convex/convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SystemSummary() {
  const summary = useQuery(api.resume_tasks.getSummary)
  const { t } = useTranslation()

  if (!summary) {
    return null
  }

  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {t('debugConfig.systemDiagnostics')}
              <Badge
                variant="outline"
                className="border-emerald-500/20 bg-emerald-500/5 font-mono text-[10px] text-emerald-600"
              >
                {t('debugConfig.live')}
              </Badge>
            </CardTitle>
            <CardDescription>{t('debugConfig.systemDiagnosticsDescription')}</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('debugConfig.activeWorkers')}
            </p>
            <p className="text-2xl font-bold text-primary">{summary.activeWorkers}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <div className="space-y-1 border-l-2 border-primary/20 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.total')}</p>
            <p className="text-xl font-bold">{summary.total}</p>
          </div>
          <div className="space-y-1 border-l-2 border-blue-500/20 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.processing')}</p>
            <p className="text-xl font-bold text-blue-600">{summary.processing}</p>
          </div>
          <div className="space-y-1 border-l-2 border-amber-500/20 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.pending')}</p>
            <p className="text-xl font-bold text-amber-600">{summary.pending}</p>
          </div>
          <div className="space-y-1 border-l-2 border-emerald-500/20 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.done')}</p>
            <p className="text-xl font-bold text-emerald-600">{summary.completed}</p>
          </div>
          <div className="space-y-1 border-l-2 border-destructive/20 pl-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{t('debugConfig.failed')}</p>
            <p className="text-xl font-bold text-destructive">{summary.failed + summary.cancelled}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
