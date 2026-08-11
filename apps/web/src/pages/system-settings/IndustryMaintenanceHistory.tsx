import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { reportUiError } from '@/lib/ui-error-reporting'
import {
  formatDate,
  LEDGER_ACTION_TONES,
  type MaintenanceLedgerRow,
  type MaintenanceRun,
} from './industry-verification-model'

export function IndustryMaintenanceHistory({ requestJson }: { requestJson: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<MaintenanceRun[]>([])
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<MaintenanceLedgerRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await requestJson('/api/company-industry-maintenance-runs?limit=20') as { items?: MaintenanceRun[] }
        if (!cancelled) setRuns(result?.items ?? [])
      } catch (error) {
        reportUiError('Failed to load industry maintenance history', error)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [requestJson])

  const toggleRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null)
      return
    }
    setExpandedRunId(runId)
    setLedger([])
    try {
      const result = await requestJson(`/api/company-industry-maintenance-runs/${encodeURIComponent(runId)}/ledger`) as { items?: MaintenanceLedgerRow[] }
      setLedger(result?.items ?? [])
    } catch (error) {
      reportUiError('Failed to load maintenance ledger', error)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('industryEvidence.runHistory', { defaultValue: 'Maintenance run history' })}</CardTitle>
        <CardDescription>
          {t('industryEvidence.runHistoryDescription', {
            defaultValue: 'Recent industry-evidence maintenance runs. Expand a row to see why each employer did or did not surface.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('industryEvidence.runHistoryEmpty', { defaultValue: 'No maintenance runs recorded yet.' })}
          </p>
        ) : runs.map((run) => (
          <div key={run.runId} className="rounded-lg border">
            <button
              type="button"
              onClick={() => void toggleRun(run.runId)}
              className="flex w-full items-center justify-between gap-3 p-3 text-left"
            >
              <div>
                <p className="font-medium">
                  <span className="font-mono text-xs">{run.status ?? '-'}</span>
                  {run.triggerSource ? ` · ${run.triggerSource}` : ''}
                </p>
                {run.operatorSummary ? <p className="text-xs text-muted-foreground">{run.operatorSummary}</p> : null}
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
            </button>
            {expandedRunId === run.runId && (
              <div className="border-t p-3 space-y-1">
                {ledger.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ledger rows.</p>
                ) : ledger.map((row, idx) => (
                  <div key={`${row.proposalId}-${idx}`} className="flex items-start gap-2 text-xs">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-mono ${LEDGER_ACTION_TONES[row.action] ?? 'bg-gray-100 text-gray-800'}`}>
                      {row.action}
                    </span>
                    <span className="text-muted-foreground">{row.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
