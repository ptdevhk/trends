import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { useAuditLogs, useBiasReport } from '@/hooks/useAuditLogs'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { hasWorkspaceAdminAccess } from '@/lib/workspace-access'
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

type BiasMetricsReport = {
  status: 'ok'
  workspaceSlug: string
  decisionType: string
  scoreThreshold: number
  totalAuditRecords: number
  groupCount: number
  demographicParity: {
    disparityRatio: number
    maxDifference: number
    passing: boolean
    groupRates: Array<{ groupKey: string; rate: number }>
  }
  disparateImpact: Array<{ groupKey: string; ratio: number; referenceGroupKey: string }>
  overrideRate: {
    tprDifference: number
    fprDifference: number
    passing: boolean
  }
  scoreDrift: {
    psi: number
    driftDetected: boolean
  }
  anomalyFlags: {
    statisticalParityViolation: boolean
    disparateImpactViolation: boolean
    scoreDriftDetected: boolean
  }
  computedAt: number
}

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

function RelativeTime({ epoch }: { epoch: number }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const diffMs = now - epoch
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return <span>{t('auditCompliance.time.justNow', { defaultValue: 'just now' })}</span>
  if (minutes < 60) return <span>{t('auditCompliance.time.minutesAgo', { defaultValue: '{{count}}m ago', count: minutes })}</span>
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return <span>{t('auditCompliance.time.hoursAgo', { defaultValue: '{{count}}h ago', count: hours })}</span>
  const days = Math.floor(hours / 24)
  return <span>{t('auditCompliance.time.daysAgo', { defaultValue: '{{count}}d ago', count: days })}</span>
}

function KpiCard({ label, value, passing }: { label: string; value: string; passing: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="border rounded-md p-3 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      <Badge variant={passing ? 'default' : 'destructive'} data-testid={passing ? 'kpi-pass' : 'kpi-fail'}>
        {passing ? t('auditCompliance.status.pass', { defaultValue: 'PASS' }) : t('auditCompliance.status.fail', { defaultValue: 'FAIL' })}
      </Badge>
    </div>
  )
}

function AnomalyFlag({ label, active }: { label: string; active: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="text-xs flex items-center gap-1.5">
      <Badge variant={active ? 'destructive' : 'outline'} data-testid={active ? 'anomaly-active' : 'anomaly-inactive'}>
        {active ? t('auditCompliance.anomaly.true', { defaultValue: 'TRUE' }) : t('auditCompliance.anomaly.false', { defaultValue: 'FALSE' })}
      </Badge>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

function MetricRow({ label, value, threshold, passing }: { label: string; value: string; threshold: string; passing: boolean }) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell className="font-medium text-xs">{label}</TableCell>
      <TableCell className="text-xs font-mono">{value}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{threshold}</TableCell>
      <TableCell>
        <Badge variant={passing ? 'default' : 'destructive'}>
          {passing ? t('auditCompliance.status.pass', { defaultValue: 'PASS' }) : t('auditCompliance.status.fail', { defaultValue: 'FAIL' })}
        </Badge>
      </TableCell>
    </TableRow>
  )
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
  const outcomeOverrideOptions = useMemo(
    () => OUTCOME_OVERRIDE_OPTIONS.map((o) => ({ value: o.value, label: t(`auditCompliance.outcome.${o.value}`, { defaultValue: o.label }) })),
    [t],
  )

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
            options={outcomeOverrideOptions}
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
  const decisionTypeFilterOptions = useMemo(
    () =>
      DECISION_TYPE_FILTER_OPTIONS.map((o) => ({
        value: o.value,
        label:
          o.value === 'all'
            ? t('auditCompliance.filters.allTypes', { defaultValue: o.label })
            : t(`auditCompliance.decisionType.${o.value}`, { defaultValue: o.label }),
      })),
    [t],
  )
  const outcomeFilterOptions = useMemo(
    () =>
      OUTCOME_FILTER_OPTIONS.map((o) => ({
        value: o.value,
        label:
          o.value === 'all'
            ? t('auditCompliance.filters.allOutcomes', { defaultValue: o.label })
            : t(`auditCompliance.outcome.${o.value}`, { defaultValue: o.label }),
      })),
    [t],
  )
  const { slug } = useWorkspace()
  // WorkspaceContext hardcodes `isAdmin: false`; derive admin from memberships
  // so the audit dashboard matches the API's requireAdmin (admin of this slug).
  const { memberships } = useAuth()
  const isAdmin = hasWorkspaceAdminAccess(memberships, slug)
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

  const biasMetrics = useMemo((): BiasMetricsReport | null => {
    if (!report || typeof report !== 'object') return null
    const r = report as Record<string, unknown>
    if (r.status !== 'ok') return null
    return report as unknown as BiasMetricsReport
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
          ) : biasMetrics ? (
            <div className="space-y-4">
              {/* KPI Cards Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="bias-kpi-cards">
                <KpiCard
                  label={t('auditCompliance.kpi.dir', { defaultValue: 'DIR Ratio' })}
                  value={biasMetrics.demographicParity.disparityRatio.toFixed(2)}
                  passing={biasMetrics.demographicParity.passing}
                />
                <KpiCard
                  label={t('auditCompliance.kpi.parity', { defaultValue: 'Parity Diff' })}
                  value={biasMetrics.demographicParity.maxDifference.toFixed(2)}
                  passing={biasMetrics.demographicParity.passing}
                />
                <KpiCard
                  label={t('auditCompliance.kpi.psi', { defaultValue: 'PSI Drift' })}
                  value={biasMetrics.scoreDrift.psi.toFixed(3)}
                  passing={!biasMetrics.scoreDrift.driftDetected}
                />
                <KpiCard
                  label={t('auditCompliance.kpi.anomalies', { defaultValue: 'Anomalies' })}
                  value={String(
                    Object.values(biasMetrics.anomalyFlags).filter(Boolean).length,
                  )}
                  passing={Object.values(biasMetrics.anomalyFlags).every((v) => !v)}
                />
              </div>

              {/* Anomaly Flags */}
              <div className="border rounded-md p-3 space-y-2" data-testid="anomaly-flags-section">
                <div className="text-sm font-medium">
                  {t('auditCompliance.biasReport.anomalyFlags', { defaultValue: 'Anomaly Flags' })}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <AnomalyFlag
                    label={t('auditCompliance.flag.parity', { defaultValue: 'Parity Violation' })}
                    active={biasMetrics.anomalyFlags.statisticalParityViolation}
                  />
                  <AnomalyFlag
                    label={t('auditCompliance.flag.impact', { defaultValue: 'Impact Violation' })}
                    active={biasMetrics.anomalyFlags.disparateImpactViolation}
                  />
                  <AnomalyFlag
                    label={t('auditCompliance.flag.drift', { defaultValue: 'Score Drift' })}
                    active={biasMetrics.anomalyFlags.scoreDriftDetected}
                  />
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="text-muted-foreground">
                      {t('auditCompliance.flag.reportAge', { defaultValue: 'Report Age' })}:
                    </span>{' '}
                    <RelativeTime epoch={biasMetrics.computedAt} />
                  </div>
                </div>
              </div>

              {/* Anomaly alert banner (from alerts endpoint) */}
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
                      {t('auditCompliance.alert.psi', { defaultValue: 'PSI: {{value}}', value: anomalyAlerts.psiValue.toFixed(4) })}
                    </div>
                  )}
                  {anomalyAlerts.disparityRatio != null && (
                    <div className="text-xs text-muted-foreground">
                      {t('auditCompliance.alert.disparityRatio', { defaultValue: 'Disparity Ratio: {{value}}', value: anomalyAlerts.disparityRatio.toFixed(4) })}
                    </div>
                  )}
                </div>
              )}

              {/* Metric Breakdown Table */}
              <div data-testid="metric-breakdown-table">
                <div className="text-sm font-medium mb-2">
                  {t('auditCompliance.metricBreakdown.title', { defaultValue: 'Metric Breakdown' })}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('auditCompliance.metricBreakdown.metric', { defaultValue: 'Metric' })}</TableHead>
                      <TableHead>{t('auditCompliance.metricBreakdown.value', { defaultValue: 'Value' })}</TableHead>
                      <TableHead>{t('auditCompliance.metricBreakdown.threshold', { defaultValue: 'Threshold' })}</TableHead>
                      <TableHead>{t('auditCompliance.metricBreakdown.status', { defaultValue: 'Status' })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <MetricRow
                      label="DIR"
                      value={biasMetrics.demographicParity.disparityRatio.toFixed(2)}
                      threshold=">= 0.80"
                      passing={biasMetrics.demographicParity.passing}
                    />
                    <MetricRow
                      label={t('auditCompliance.metric.parity', { defaultValue: 'Parity' })}
                      value={biasMetrics.demographicParity.maxDifference.toFixed(2)}
                      threshold="< 0.10"
                      passing={biasMetrics.demographicParity.passing}
                    />
                    <MetricRow
                      label="PSI"
                      value={biasMetrics.scoreDrift.psi.toFixed(3)}
                      threshold="< 0.25"
                      passing={!biasMetrics.scoreDrift.driftDetected}
                    />
                    <MetricRow
                      label={t('auditCompliance.metric.override', { defaultValue: 'Override' })}
                      value={`${(biasMetrics.overrideRate.tprDifference * 100).toFixed(0)}%/${(biasMetrics.overrideRate.fprDifference * 100).toFixed(0)}%`}
                      threshold="< 10%"
                      passing={biasMetrics.overrideRate.passing}
                    />
                  </TableBody>
                </Table>
              </div>

              {/* Group Rates Table */}
              {biasMetrics.demographicParity.groupRates.length > 0 && (
                <div data-testid="group-rates-table">
                  <div className="text-sm font-medium mb-2">
                    {t('auditCompliance.groupRates.title', { defaultValue: 'Group Rates' })}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('auditCompliance.groupRates.group', { defaultValue: 'Group' })}</TableHead>
                        <TableHead>{t('auditCompliance.groupRates.selectionRate', { defaultValue: 'Selection Rate' })}</TableHead>
                        <TableHead>{t('auditCompliance.groupRates.dirVsRef', { defaultValue: 'DIR vs Ref' })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {biasMetrics.demographicParity.groupRates.map((g) => {
                        const diEntry = biasMetrics.disparateImpact.find(
                          (di) => di.groupKey === g.groupKey,
                        )
                        const isRef = !diEntry
                        return (
                          <TableRow key={g.groupKey}>
                            <TableCell className="font-mono text-xs">{g.groupKey}</TableCell>
                            <TableCell className="text-xs">{(g.rate * 100).toFixed(1)}%</TableCell>
                            <TableCell className="text-xs">
                              {isRef ? (
                                <Badge variant="outline">{t('auditCompliance.groupRates.reference', { defaultValue: 'reference' })}</Badge>
                              ) : (
                                <Badge variant={diEntry!.ratio >= 0.8 ? 'default' : 'destructive'}>
                                  {diEntry!.ratio.toFixed(2)}
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Report metadata footer */}
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  {t('auditCompliance.biasReport.computedAt', { defaultValue: 'Last computed' })}:{' '}
                  {new Date(biasMetrics.computedAt).toLocaleString()}
                </span>
                <span>
                  {t('auditCompliance.biasReport.totalRecords', { defaultValue: 'Records' })}:{' '}
                  {biasMetrics.totalAuditRecords}
                </span>
                <span>
                  {t('auditCompliance.biasReport.scoreThreshold', { defaultValue: 'Threshold' })}:{' '}
                  {biasMetrics.scoreThreshold}
                </span>
                <span>
                  {t('auditCompliance.biasReport.groupCount', { defaultValue: 'Groups' })}:{' '}
                  {biasMetrics.groupCount}
                </span>
              </div>
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
                options={decisionTypeFilterOptions}
                className="w-[140px]"
                data-testid="filter-decision-type"
              />
              <Select
                value={filters.outcome ?? 'all'}
                onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value === 'all' ? undefined : e.target.value }))}
                options={outcomeFilterOptions}
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
                            {t('auditCompliance.output.score', { defaultValue: 'Score: {{value}}', value: entry.output.score })}
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
                          {t(`auditCompliance.outcome.${entry.outcome ?? 'pending'}`, { defaultValue: entry.outcome ?? 'pending' })}
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
                            {entry.anomalyFlags?.flagReason ?? t('auditCompliance.anomaly.yes', { defaultValue: 'Yes' })}
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
