import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'
import type { AuditItem, EntryType, IndustryDataEntry, MaintenanceRun, TabId } from './industry-data-model'
import { IndustryDataAuditPanel } from './IndustryDataAuditPanel'
import { IndustryDataControlPanel } from './IndustryDataControlPanel'
import { IndustryDataManagePanel } from './IndustryDataManagePanel'

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

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('common.industryDataTabsAria', { defaultValue: 'Industry Data tabs' })}>
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
        <IndustryDataManagePanel
          entries={entries}
          loading={loadingEntries}
          entryType={entryType}
          entryTypes={entryTypes}
          onEntryTypeChange={setEntryType}
          onRefresh={() => void loadEntries()}
          onSeed={() => void handleSeed()}
          onExport={() => void handleExport()}
          onDelete={(entryId) => void handleDelete(entryId)}
          importText={importText}
          onImportTextChange={setImportText}
          onImport={() => void handleImport()}
        />
      )}

      {activeTab === 'control' && (
        <IndustryDataControlPanel
          schedulePaused={schedulePaused}
          onToggleSchedule={() => void handleToggleSchedule()}
          onRunNow={() => void handleRunNow()}
          companyKey={companyKey}
          onCompanyKeyChange={setCompanyKey}
          onTrigger={() => void handleTrigger()}
          runs={runs}
        />
      )}

      {activeTab === 'audit' && (
        <IndustryDataAuditPanel
          auditItems={auditItems}
          auditCompanyKey={auditCompanyKey}
          onAuditCompanyKeyChange={setAuditCompanyKey}
          onFilter={() => void loadAudit()}
        />
      )}
    </div>
  )
}
