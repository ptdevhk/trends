import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { useAuditLogs, useBiasReport } from '@/hooks/useAuditLogs'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type OutcomeValue = 'accepted' | 'overridden' | 'appealed'

const DECISION_TYPE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'score', label: 'score' },
  { value: 'tag', label: 'tag' },
  { value: 'rank', label: 'rank' },
  { value: 'filter', label: 'filter' },
  { value: 'confirm', label: 'confirm' },
]

const OUTCOME_FILTER_OPTIONS = [
  { value: 'all', label: 'All Outcomes' },
  { value: 'pending', label: 'pending' },
  { value: 'accepted', label: 'accepted' },
  { value: 'overridden', label: 'overridden' },
  { value: 'appealed', label: 'appealed' },
]

const OUTCOME_OVERRIDE_OPTIONS: { value: OutcomeValue; label: string }[] = [
  { value: 'accepted', label: 'accepted' },
  { value: 'overridden', label: 'overridden' },
  { value: 'appealed', label: 'appealed' },
]

const outcomeVariant = (outcome?: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (outcome) {
    case 'accepted':
      return 'default'
    case 'overridden':
      return 'destructive'
    case 'appealed':
      return 'secondary'
    case 'pending':
      return 'outline'
    default:
      return 'outline'
  }
}

function OutcomeDialog({
  open,
  onClose,
  onConfirm,
  entry,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (outcome: OutcomeValue) => void
  entry: { _id: string; decisionType: string; output: { score?: number; recommendation?: string } } | null
  loading: boolean
}) {
  const { t } = useTranslation()
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeValue>('overridden')

  if (!entry) return null

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('auditCompliance.setOutcome.title', { defaultValue: 'Set Audit Outcome' })}
          </DialogTitle>
          <DialogDescription>
            {t('auditCompliance.setOutcome.description', {
              defaultValue:
                'Set the human oversight outcome for this automated decision (EU AI Act Art. 14).',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-sm">
            <span className="text-muted-foreground">
              {t('auditCompliance.setOutcome.decisionType', { defaultValue: 'Decision Type' })}:
            </span>{' '}
            <Badge variant="outline">{entry.decisionType}</Badge>
          </div>
          {entry.output.score != null && (
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t('auditCompliance.setOutcome.score', { defaultValue: 'Score' })}:
              </span>{' '}
              {entry.output.score}
            </div>
          )}
          {entry.output.recommendation && (
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t('auditCompliance.setOutcome.recommendation', { defaultValue: 'Recommendation' })}:
              </span>{' '}
              {entry.output.recommendation}
            </div>
          )}
          <Select
            value={selectedOutcome}
            onChange={(e) => setSelectedOutcome(e.target.value as OutcomeValue)}
            options={OUTCOME_OVERRIDE_OPTIONS}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button disabled={loading} onClick={() => onConfirm(selectedOutcome)}>
            {t('auditCompliance.setOutcome.confirm', { defaultValue: 'Set Outcome' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AuditCompliancePage() {
  const { t } = useTranslation()
  const { slug, isAdmin } = useWorkspace()
  const { logs, loading, error, filters, setFilters, setOutcome } = useAuditLogs(slug, isAdmin)
  const { report, anomalyAlerts, loading: reportLoading, error: reportError } = useBiasReport(slug, isAdmin)

  const [outcomeDialogEntry, setOutcomeDialogEntry] = useState<
    (typeof logs)[number] | null
  >(null)
  const [settingOutcome, setSettingOutcome] = useState(false)

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => b.decidedAt - a.decidedAt),
    [logs],
  )

  const pendingCount = useMemo(
    () => logs.filter((l) => l.outcome === 'pending' || !l.outcome).length,
    [logs],
  )

  const anomalyCount = useMemo(
    () => logs.filter((l) => l.anomalyFlags && Object.values(l.anomalyFlags).some(Boolean)).length,
    [logs],
  )

  const handleSetOutcome = useCallback(
    async (outcome: OutcomeValue) => {
      if (!outcomeDialogEntry) return
      setSettingOutcome(true)
      const ok = await setOutcome(outcomeDialogEntry._id, outcome, 'human_reviewer')
      setSettingOutcome(false)
      if (ok) {
        toast.success(
          t('auditCompliance.toasts.outcomeSet', { defaultValue: 'Audit outcome updated' }),
        )
        setOutcomeDialogEntry(null)
      } else {
        toast.error(
          t('auditCompliance.toasts.outcomeFailed', {
            defaultValue: 'Failed to update audit outcome',
          }),
        )
      }
    },
    [outcomeDialogEntry, setOutcome, t],
  )

  const biasReportSummary = useMemo(() => {
    if (!report || typeof report !== 'object') return null
    const r = report as Record<string, unknown>
    return {
      generatedAt:
        typeof r.generatedAt === 'number' ? new Date(r.generatedAt).toLocaleString() : undefined,
      workspaceSlug: typeof r.workspaceSlug === 'string' ? r.workspaceSlug : undefined,
      anomalyDetected: typeof r.anomalyDetected === 'boolean' ? r.anomalyDetected : undefined,
    }
  }, [report])

  return (
    <div className="space-y-6" data-testid="audit-compliance-page">
      <PageHeader
        title={t('auditCompliance.title', { defaultValue: 'Audit & Compliance' })}
        description={t('auditCompliance.description', {
          defaultValue:
            'EU AI Act compliance dashboard — audit trail, human oversight, and bias monitoring.',
        })}
        actions={
          <div className="flex gap-2">
            {pendingCount > 0 && (
              <Badge variant="outline" data-testid="pending-count-badge">
                {t('auditCompliance.pendingBadge', {
                  defaultValue: '{{count}} pending review',
                  count: pendingCount,
                })}
              </Badge>
            )}
            {anomalyCount > 0 && (
              <Badge variant="destructive" data-testid="anomaly-count-badge">
                {t('auditCompliance.anomalyBadge', {
                  defaultValue: '{{count}} anomaly flags',
                  count: anomalyCount,
                })}
              </Badge>
            )}
          </div>
        }
      />

      {/* Bias Audit Report Summary */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t('auditCompliance.biasReport.title', { defaultValue: 'Bias Audit Report' })}
          </CardTitle>
          <CardDescription>
            {t('auditCompliance.biasReport.description', {
              defaultValue:
                'Latest bias metrics report (EU AI Act Art. 12 — monitoring and documentation).',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="text-sm text-muted-foreground">
              {t('resumes.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : reportError ? (
            <div className="text-sm text-destructive">{reportError}</div>
          ) : biasReportSummary ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {t('auditCompliance.biasReport.workspace', { defaultValue: 'Workspace' })}:
                  </span>{' '}
                  {biasReportSummary.workspaceSlug ?? '-'}
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('auditCompliance.biasReport.generatedAt', {
                      defaultValue: 'Generated At',
                    })}
                    :
                  </span>{' '}
                  {biasReportSummary.generatedAt ?? '-'}
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('auditCompliance.biasReport.anomalyDetected', {
                      defaultValue: 'Anomaly Detected',
                    })}
                    :
                  </span>{' '}
                  {biasReportSummary.anomalyDetected != null ? (
                    <Badge variant={biasReportSummary.anomalyDetected ? 'destructive' : 'default'}>
                      {biasReportSummary.anomalyDetected ? 'Yes' : 'No'}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </div>
              </div>
              {anomalyAlerts && anomalyAlerts.flags.length > 0 && (
                <div className="border rounded-md p-3 bg-destructive/5 border-destructive/20" data-testid="anomaly-alert-banner">
                  <div className="text-sm font-medium text-destructive mb-1">
                    {t('auditCompliance.biasReport.activeAlerts', { defaultValue: 'Active Anomaly Alerts' })}:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {anomalyAlerts.flags.map((flag) => (
                      <Badge key={flag} variant="destructive">{flag}</Badge>
                    ))}
                  </div>
                  {anomalyAlerts.psiValue != null && (
                    <div className="text-xs text-muted-foreground mt-1">
                      PSI: {anomalyAlerts.psiValue.toFixed(4)}
                    </div>
                  )}
                  {anomalyAlerts.disparityRatio != null && (
                    <div className="text-xs text-muted-foreground">
                      Disparity Ratio: {anomalyAlerts.disparityRatio.toFixed(4)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('auditCompliance.biasReport.noReport', {
                defaultValue: 'No bias audit report available yet.',
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Log Table */}
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>
                {t('auditCompliance.auditLog.title', { defaultValue: 'Decision Audit Log' })}
              </CardTitle>
              <CardDescription>
                {t('auditCompliance.auditLog.description', {
                  defaultValue:
                    'All automated decisions with human oversight tracking (EU AI Act Art. 14).',
                })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Select
                value={filters.decisionType ?? 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, decisionType: e.target.value === 'all' ? undefined : e.target.value }))}
                options={DECISION_TYPE_FILTER_OPTIONS}
                className="w-[140px]"
                data-testid="filter-decision-type"
              />
              <Select
                value={filters.outcome ?? 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value === 'all' ? undefined : e.target.value }))}
                options={OUTCOME_FILTER_OPTIONS}
                className="w-[140px]"
                data-testid="filter-outcome"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {t('resumes.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : error ? (
            <div className="text-sm text-destructive">{error}</div>
          ) : sortedLogs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t('auditCompliance.auditLog.empty', {
                defaultValue: 'No audit log entries found.',
              })}
            </div>
          ) : (
            <Table data-testid="audit-log-table">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('auditCompliance.columns.time', { defaultValue: 'Time' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.type', { defaultValue: 'Type' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.action', { defaultValue: 'Action' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.model', { defaultValue: 'Model' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.output', { defaultValue: 'Output' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.outcome', { defaultValue: 'Outcome' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.actor', { defaultValue: 'Actor' })}
                  </TableHead>
                  <TableHead>
                    {t('auditCompliance.columns.anomaly', { defaultValue: 'Anomaly' })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('auditCompliance.columns.actions', { defaultValue: 'Actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLogs.map((entry) => {
                  const hasAnomaly =
                    entry.anomalyFlags &&
                    Object.entries(entry.anomalyFlags).some(
                      ([k, v]) => k !== 'psiValue' && k !== 'flagReason' && v === true,
                    )
                  return (
                    <TableRow key={entry._id} data-testid="audit-log-row">
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(entry.decidedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.decisionType}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono max-w-[200px] truncate">
                        {entry.actionRef}
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.modelMeta.model}
                        <br />
                        <span className="text-muted-foreground">{entry.modelMeta.provider}</span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.output.score != null && (
                          <>
                            Score: {entry.output.score}
                            <br />
                          </>
                        )}
                        {entry.output.recommendation && (
                          <span>{entry.output.recommendation}</span>
                        )}
                        {entry.output.tags && entry.output.tags.length > 0 && (
                          <span>{entry.output.tags.join(', ')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={outcomeVariant(entry.outcome)}>
                          {entry.outcome ?? 'pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.actorRole ?? '-'}
                        {entry.outcomeSetBy && (
                          <>
                            <br />
                            <span className="text-muted-foreground">{entry.outcomeSetBy}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasAnomaly ? (
                          <Badge variant="destructive" data-testid="anomaly-flag">
                            {entry.anomalyFlags?.flagReason ?? 'Yes'}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {(!entry.outcome || entry.outcome === 'pending') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOutcomeDialogEntry(entry)}
                            data-testid="set-outcome-btn"
                          >
                            {t('auditCompliance.actions.review', { defaultValue: 'Review' })}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <OutcomeDialog
        open={outcomeDialogEntry !== null}
        onClose={() => setOutcomeDialogEntry(null)}
        onConfirm={handleSetOutcome}
        entry={outcomeDialogEntry}
        loading={settingOutcome}
      />
    </div>
  )
}
