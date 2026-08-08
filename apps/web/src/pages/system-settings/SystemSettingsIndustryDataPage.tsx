import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'

type EntryType = 'company' | 'keyword' | 'brand' | 'url'
type TabId = 'manage' | 'control' | 'audit'

type IndustryDataEntry = {
  entryType: EntryType
  entryId: string
  data: unknown
  sortOrder?: number
  updatedBy?: string
}

type AuditItem = {
  kind: 'data_edit' | 'maintenance'
  at: number
  companyKey?: string
  summary: string
  gitSha?: string | null
  runId?: string
  action?: string
  actor?: string
}

type MaintenanceRun = {
  runId: string
  triggerSource?: string
  status?: string
  operatorSummary?: string
  startedAt?: number
}

function formatTime(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function entryLabel(entry: IndustryDataEntry): string {
  const data = entry.data
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    if (typeof rec.nameCn === 'string') return rec.nameCn
    if (typeof rec.keyword === 'string') return rec.keyword
    if (typeof rec.url === 'string') return rec.url
  }
  if (typeof data === 'string') return data
  return entry.entryId
}

export function SystemSettingsIndustryDataPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [activeTab, setActiveTab] = useState<TabId>('manage')
  const [entryType, setEntryType] = useState<EntryType | 'all'>('brand')
  const [entries, setEntries] = useState<IndustryDataEntry[]>([])
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [schedulePaused, setSchedulePaused] = useState(false)
  const [companyKey, setCompanyKey] = useState('')
  const [auditCompanyKey, setAuditCompanyKey] = useState('')
  const [auditItems, setAuditItems] = useState<AuditItem[]>([])
  const [runs, setRuns] = useState<MaintenanceRun[]>([])
  const [importText, setImportText] = useState('')

  const loadEntries = useCallback(async () => {
    setLoadingEntries(true)
    try {
      const qs = entryType === 'all' ? '' : `?entryType=${entryType}`
      const result = (await requestJson(`/api/industry-data/entries${qs}`)) as {
        entries?: IndustryDataEntry[]
      }
      setEntries(result?.entries ?? [])
    } catch (error) {
      reportUiError('Failed to load industry data entries', error)
      toast.error(
        t('debugConfig.industryDataLoadFailed', {
          defaultValue: 'Failed to load industry data entries',
        }),
      )
    } finally {
      setLoadingEntries(false)
    }
  }, [entryType, requestJson, t])

  const loadSchedule = useCallback(async () => {
    try {
      const result = (await requestJson('/api/industry-data/schedule')) as {
        paused?: boolean
      }
      setSchedulePaused(Boolean(result?.paused))
    } catch (error) {
      reportUiError('Failed to load schedule pause flag', error)
    }
  }, [requestJson])

  const loadRuns = useCallback(async () => {
    try {
      const result = (await requestJson(
        '/api/company-industry-maintenance-runs?limit=10',
      )) as { items?: MaintenanceRun[] }
      setRuns(result?.items ?? [])
    } catch (error) {
      reportUiError('Failed to load maintenance runs', error)
    }
  }, [requestJson])

  const loadAudit = useCallback(async () => {
    try {
      const qs = auditCompanyKey.trim()
        ? `?companyKey=${encodeURIComponent(auditCompanyKey.trim())}&limit=50`
        : '?limit=50'
      const result = (await requestJson(`/api/industry-data/audit${qs}`)) as {
        items?: AuditItem[]
      }
      setAuditItems(result?.items ?? [])
    } catch (error) {
      reportUiError('Failed to load audit timeline', error)
      toast.error(
        t('debugConfig.industryDataAuditFailed', {
          defaultValue: 'Failed to load audit timeline',
        }),
      )
    }
  }, [auditCompanyKey, requestJson, t])

  useEffect(() => {
    if (activeTab === 'manage') void loadEntries()
    if (activeTab === 'control') {
      void loadSchedule()
      void loadRuns()
    }
    if (activeTab === 'audit') void loadAudit()
  }, [activeTab, loadEntries, loadSchedule, loadRuns, loadAudit])

  const handleDelete = async (entryId: string) => {
    try {
      const result = (await requestJson(`/api/industry-data/entries/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      })) as { gitSha?: string | null; warning?: string }
      if (result.warning || !result.gitSha) {
        toast.warning(
          result.warning ||
            t('debugConfig.industryDataGitWarning', {
              defaultValue: 'Saved, but git commit did not land',
            }),
        )
      } else {
        toast.success(
          t('debugConfig.industryDataDeleted', {
            defaultValue: `Deleted (${result.gitSha.slice(0, 7)})`,
            sha: result.gitSha.slice(0, 7),
          }),
        )
      }
      await loadEntries()
    } catch (error) {
      reportUiError('Failed to delete industry data entry', error)
      toast.error(
        t('debugConfig.industryDataDeleteFailed', {
          defaultValue: 'Failed to delete entry',
        }),
      )
    }
  }

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importText) as unknown
      const entriesPayload = Array.isArray(parsed)
        ? parsed
        : (parsed as { entries?: unknown[] })?.entries
      if (!Array.isArray(entriesPayload)) {
        toast.error(
          t('debugConfig.industryDataImportInvalid', {
            defaultValue: 'Import JSON must be an array or { entries: [] }',
          }),
        )
        return
      }
      const result = (await requestJson('/api/industry-data/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: entriesPayload }),
      })) as { imported?: number; gitSha?: string | null; warning?: string }
      if (result.warning || !result.gitSha) {
        toast.warning(
          result.warning ||
            t('debugConfig.industryDataGitWarning', {
              defaultValue: 'Saved, but git commit did not land',
            }),
        )
      } else {
        toast.success(
          t('debugConfig.industryDataImported', {
            defaultValue: `Imported ${result.imported ?? 0} entries`,
            count: result.imported ?? 0,
          }),
        )
      }
      setImportText('')
      await loadEntries()
    } catch (error) {
      reportUiError('Failed to import industry data', error)
      toast.error(
        t('debugConfig.industryDataImportFailed', {
          defaultValue: 'Import failed',
        }),
      )
    }
  }

  const handleExport = async () => {
    try {
      const qs = entryType === 'all' ? '' : `?entryType=${entryType}`
      const result = (await requestJson(`/api/industry-data/export${qs}`)) as {
        entries?: IndustryDataEntry[]
      }
      const blob = new Blob([JSON.stringify(result?.entries ?? [], null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `industry-data-${entryType}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      reportUiError('Failed to export industry data', error)
      toast.error(
        t('debugConfig.industryDataExportFailed', {
          defaultValue: 'Export failed',
        }),
      )
    }
  }

  const handleSeed = async () => {
    try {
      const result = (await requestJson('/api/industry-data/seed', {
        method: 'POST',
      })) as { imported?: number }
      toast.success(
        t('debugConfig.industryDataSeeded', {
          defaultValue: `Seeded ${result.imported ?? 0} entries from config/industry-data files`,
          count: result.imported ?? 0,
        }),
      )
      await loadEntries()
    } catch (error) {
      reportUiError('Failed to seed industry data from files', error)
      toast.error(
        t('debugConfig.industryDataSeedFailed', {
          defaultValue: 'Seed from files failed',
        }),
      )
    }
  }

  const handleTrigger = async () => {
    const key = companyKey.trim()
    if (!key) {
      toast.error(
        t('debugConfig.industryDataCompanyKeyRequired', {
          defaultValue: 'companyKey is required',
        }),
      )
      return
    }
    try {
      const result = (await requestJson('/api/industry-data/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyKey: key }),
      })) as { runId?: string | null; coalesced?: boolean }
      toast.success(
        t('debugConfig.industryDataTriggerOk', {
          defaultValue: `Triggered research for ${key} (run ${result.runId ?? '—'})`,
          companyKey: key,
          runId: result.runId ?? '—',
        }),
      )
      await loadRuns()
    } catch (error) {
      reportUiError('Failed to trigger scoped industry maintenance', error)
      toast.error(
        t('debugConfig.industryDataTriggerFailed', {
          defaultValue: 'Scoped trigger failed',
        }),
      )
    }
  }

  const handleRunNow = async () => {
    try {
      const result = (await requestJson('/api/worker/industry-maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })) as { runId?: string | null }
      toast.success(
        t('debugConfig.industryDataRunNowOk', {
          defaultValue: `Maintenance enqueued (${result.runId ?? '—'})`,
          runId: result.runId ?? '—',
        }),
      )
      await loadRuns()
    } catch (error) {
      reportUiError('Failed to run industry maintenance', error)
      toast.error(
        t('debugConfig.industryDataRunNowFailed', {
          defaultValue: 'Run-now failed',
        }),
      )
    }
  }

  const handleToggleSchedule = async () => {
    const next = !schedulePaused
    try {
      const result = (await requestJson('/api/industry-data/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: next }),
      })) as { paused?: boolean }
      setSchedulePaused(Boolean(result?.paused))
      toast.success(
        next
          ? t('debugConfig.industryDataSchedulePaused', {
              defaultValue: 'Schedule paused',
            })
          : t('debugConfig.industryDataScheduleResumed', {
              defaultValue: 'Schedule resumed',
            }),
      )
    } catch (error) {
      reportUiError('Failed to toggle schedule pause', error)
      toast.error(
        t('debugConfig.industryDataScheduleFailed', {
          defaultValue: 'Failed to update schedule pause flag',
        }),
      )
    }
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    {
      id: 'manage',
      label: t('debugConfig.industryDataTabManage', { defaultValue: 'Manage' }),
    },
    {
      id: 'control',
      label: t('debugConfig.industryDataTabControl', {
        defaultValue: 'Control center',
      }),
    },
    {
      id: 'audit',
      label: t('debugConfig.industryDataTabAudit', { defaultValue: 'Audit' }),
    },
  ]

  const entryTypes: Array<EntryType | 'all'> = [
    'all',
    'brand',
    'company',
    'keyword',
    'url',
  ]

  return (
    <div className="space-y-6" data-testid="industry-data-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('debugConfig.industryDataTitle', {
            defaultValue: 'Industry Data',
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.industryDataSubtitle', {
            defaultValue:
              'Central management of CN industry data, maintenance controls, and evidence audit.',
          })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Industry Data tabs">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`industry-data-tab-${tab.id}`}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === 'manage' && (
        <Card data-testid="industry-data-manage">
          <CardHeader>
            <CardTitle>
              {t('debugConfig.industryDataManageTitle', {
                defaultValue: 'Manage entries',
              })}
            </CardTitle>
            <CardDescription>
              {t('debugConfig.industryDataManageDesc', {
                defaultValue:
                  'Convex-canonical entries. Edits regenerate config/industry-data files.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {entryTypes.map((type) => (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={entryType === type ? 'default' : 'outline'}
                  data-testid={`industry-data-type-${type}`}
                  onClick={() => setEntryType(type)}
                >
                  {type}
                </Button>
              ))}
              <Button type="button" size="sm" variant="secondary" onClick={() => void loadEntries()}>
                {t('debugConfig.industryDataRefresh', { defaultValue: 'Refresh' })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="industry-data-seed"
                onClick={() => void handleSeed()}
              >
                {t('debugConfig.industryDataSeed', { defaultValue: 'Seed from files' })}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void handleExport()}>
                {t('debugConfig.industryDataExport', { defaultValue: 'Export' })}
              </Button>
            </div>

            {loadingEntries ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded-md border" data-testid="industry-data-entries-table">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-2">entryId</th>
                      <th className="p-2">type</th>
                      <th className="p-2">label</th>
                      <th className="p-2">actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.entryId} className="border-b" data-testid={`industry-data-row-${entry.entryId}`}>
                        <td className="p-2 font-mono text-xs">{entry.entryId}</td>
                        <td className="p-2">{entry.entryType}</td>
                        <td className="p-2">{entryLabel(entry)}</td>
                        <td className="p-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleDelete(entry.entryId)}
                          >
                            {t('debugConfig.industryDataDelete', { defaultValue: 'Delete' })}
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {entries.length === 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={4}>
                          {t('debugConfig.industryDataEmpty', {
                            defaultValue: 'No entries. Seed from files or import JSON.',
                          })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="industry-data-import">
                {t('debugConfig.industryDataImport', { defaultValue: 'Import JSON' })}
              </label>
              <textarea
                id="industry-data-import"
                data-testid="industry-data-import"
                className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='[{"entryType":"brand","entryId":"brand-1","data":{...}}]'
              />
              <Button type="button" size="sm" onClick={() => void handleImport()}>
                {t('debugConfig.industryDataImportSubmit', { defaultValue: 'Import' })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'control' && (
        <div className="grid gap-4 md:grid-cols-2" data-testid="industry-data-control">
          <Card>
            <CardHeader>
              <CardTitle>
                {t('debugConfig.industryDataControlTitle', {
                  defaultValue: 'Control center',
                })}
              </CardTitle>
              <CardDescription>
                {t('debugConfig.industryDataControlDesc', {
                  defaultValue: 'Run maintenance, pause the schedule, or research one employer.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  data-testid="industry-data-run-now"
                  onClick={() => void handleRunNow()}
                >
                  {t('debugConfig.industryDataRunNow', { defaultValue: 'Run now' })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="industry-data-schedule-toggle"
                  onClick={() => void handleToggleSchedule()}
                >
                  {schedulePaused
                    ? t('debugConfig.industryDataResume', { defaultValue: 'Resume schedule' })
                    : t('debugConfig.industryDataPause', { defaultValue: 'Pause schedule' })}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="industry-data-schedule-status">
                {schedulePaused
                  ? t('debugConfig.industryDataPausedState', {
                      defaultValue: 'Schedule is paused',
                    })
                  : t('debugConfig.industryDataActiveState', {
                      defaultValue: 'Schedule is active',
                    })}
              </p>

              <div className="space-y-2 border-t pt-3">
                <label className="text-sm font-medium" htmlFor="industry-data-company-key">
                  {t('debugConfig.industryDataScopedTrigger', {
                    defaultValue: 'Research this employer now',
                  })}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="industry-data-company-key"
                    data-testid="industry-data-company-key"
                    value={companyKey}
                    onChange={(e) => setCompanyKey(e.target.value)}
                    placeholder="lung-kee-metal"
                  />
                  <Button
                    type="button"
                    data-testid="industry-data-scoped-trigger"
                    onClick={() => void handleTrigger()}
                  >
                    {t('debugConfig.industryDataTrigger', { defaultValue: 'Research' })}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {t('debugConfig.industryDataRecentRuns', {
                  defaultValue: 'Recent maintenance runs',
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {runs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('debugConfig.industryDataNoRuns', { defaultValue: 'No runs yet' })}
                </p>
              )}
              {runs.map((run) => (
                <div
                  key={run.runId}
                  className="rounded-md border p-2 text-sm"
                  data-testid={`industry-data-run-${run.runId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{run.runId}</span>
                    <Badge variant="outline">{run.status ?? '—'}</Badge>
                  </div>
                  <p className="text-muted-foreground">{run.operatorSummary ?? run.triggerSource}</p>
                  <p className="text-xs text-muted-foreground">{formatTime(run.startedAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'audit' && (
        <Card data-testid="industry-data-audit">
          <CardHeader>
            <CardTitle>
              {t('debugConfig.industryDataAuditTitle', {
                defaultValue: 'Audit timeline',
              })}
            </CardTitle>
            <CardDescription>
              {t('debugConfig.industryDataAuditDesc', {
                defaultValue: 'Data edits and maintenance ledger, newest first.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                data-testid="industry-data-audit-company-key"
                value={auditCompanyKey}
                onChange={(e) => setAuditCompanyKey(e.target.value)}
                placeholder="Filter companyKey"
              />
              <Button type="button" onClick={() => void loadAudit()}>
                {t('debugConfig.industryDataFilter', { defaultValue: 'Filter' })}
              </Button>
            </div>
            <div className="space-y-2" data-testid="industry-data-audit-list">
              {auditItems.map((item, index) => (
                <div
                  key={`${item.kind}-${item.at}-${index}`}
                  className="rounded-md border p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.kind === 'data_edit' ? 'default' : 'secondary'}>
                      {item.kind}
                    </Badge>
                    {item.action && <Badge variant="outline">{item.action}</Badge>}
                    <span className="text-xs text-muted-foreground">{formatTime(item.at)}</span>
                  </div>
                  <p>{item.summary}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {item.companyKey && <span>companyKey={item.companyKey}</span>}
                    {item.actor && <span>actor={item.actor}</span>}
                    {item.runId && <span>runId={item.runId}</span>}
                    {item.gitSha && <span className="font-mono">git={item.gitSha.slice(0, 7)}</span>}
                  </div>
                </div>
              ))}
              {auditItems.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('debugConfig.industryDataAuditEmpty', {
                    defaultValue: 'No audit events',
                  })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
