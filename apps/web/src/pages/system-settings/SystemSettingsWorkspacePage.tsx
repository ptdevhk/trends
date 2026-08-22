import { useState, type ChangeEvent } from 'react'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SettingsRequestError, useSettingsRequestJson } from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'

// Envelope contract mirrors apps/api/src/routes/workspace-snapshots.ts and
// packages/cli (workspace backup/restore): schemaVersion 1, profile hr-ops |
// full, tables with candidateStatus/candidateBlocks (+ searchProfiles/
// workspaceConfig for full). Files produced here are CLI-restorable and vice
// versa, so the field names and shapes must stay in lockstep with both.
export const SNAPSHOT_SCHEMA_VERSION = 1 as const

export type WorkspaceSnapshotProfile = 'hr-ops' | 'full'
export type WorkspaceSnapshotMode = 'replace' | 'merge'
export type WorkspaceSnapshotTableKey =
  | 'candidateStatus'
  | 'candidateBlocks'
  | 'searchProfiles'
  | 'workspaceConfig'

export const WORKSPACE_SNAPSHOT_TABLE_KEYS: WorkspaceSnapshotTableKey[] = [
  'candidateStatus',
  'candidateBlocks',
  'searchProfiles',
  'workspaceConfig',
]

export interface WorkspaceSnapshotTables {
  candidateStatus: Record<string, unknown>[]
  candidateBlocks: Record<string, unknown>[]
  searchProfiles: Record<string, unknown>[]
  workspaceConfig: Record<string, unknown>[]
}

export interface WorkspaceSnapshotEnvelope {
  success: true
  schemaVersion: number
  profile: WorkspaceSnapshotProfile
  workspaceSlug: string
  exportedAt: number
  tables: WorkspaceSnapshotTables
}

export interface WorkspaceSnapshotImportResult {
  success: true
  schemaVersion: number
  profile: WorkspaceSnapshotProfile
  workspaceSlug: string
  mode: WorkspaceSnapshotMode
  applied: Record<WorkspaceSnapshotTableKey, number>
  deleted: Record<WorkspaceSnapshotTableKey, number>
}

export function isWorkspaceSnapshotProfile(value: unknown): value is WorkspaceSnapshotProfile {
  return value === 'hr-ops' || value === 'full'
}

export function isWorkspaceSnapshotMode(value: unknown): value is WorkspaceSnapshotMode {
  return value === 'replace' || value === 'merge'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((row) => isRecord(row))
}

/** Validates a parsed JSON document against the snapshot envelope contract. */
export function parseWorkspaceSnapshotEnvelope(value: unknown): WorkspaceSnapshotEnvelope | null {
  if (!isRecord(value) || value.success !== true) {
    return null
  }
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !isWorkspaceSnapshotProfile(value.profile)) {
    return null
  }
  if (typeof value.workspaceSlug !== 'string' || typeof value.exportedAt !== 'number') {
    return null
  }
  const tables = value.tables
  if (!isRecord(tables)) {
    return null
  }
  for (const key of WORKSPACE_SNAPSHOT_TABLE_KEYS) {
    if (!isRowArray(tables[key])) {
      return null
    }
  }
  return {
    success: true,
    schemaVersion: value.schemaVersion,
    profile: value.profile,
    workspaceSlug: value.workspaceSlug,
    exportedAt: value.exportedAt,
    tables: tables as unknown as WorkspaceSnapshotTables,
  }
}

function snapshotErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SettingsRequestError) {
    const body = error.body
    if (isRecord(body) && typeof body.error === 'string') {
      return body.error
    }
  }
  return fallback
}

const tableKeyLabelKey: Record<WorkspaceSnapshotTableKey, string> = {
  candidateStatus: 'debugConfig.workspaceTableCandidateStatus',
  candidateBlocks: 'debugConfig.workspaceTableCandidateBlocks',
  searchProfiles: 'debugConfig.workspaceTableSearchProfiles',
  workspaceConfig: 'debugConfig.workspaceTableWorkspaceConfig',
}

const tableKeyDefaultLabel: Record<WorkspaceSnapshotTableKey, string> = {
  candidateStatus: 'Candidate status',
  candidateBlocks: 'Candidate blocks',
  searchProfiles: 'Search profiles',
  workspaceConfig: 'Workspace config',
}

function SnapshotCountsTable({
  counts,
  t,
}: {
  counts: Record<WorkspaceSnapshotTableKey, number>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Table</TableHead>
          <TableHead className="text-right">Rows</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {WORKSPACE_SNAPSHOT_TABLE_KEYS.map((key) => (
          <TableRow key={key}>
            <TableCell>
              {t(tableKeyLabelKey[key], { defaultValue: tableKeyDefaultLabel[key] })}
            </TableCell>
            <TableCell className="text-right">
              {t('debugConfig.workspaceRows', { count: counts[key], defaultValue: '{{count}} rows' })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function SystemSettingsWorkspacePage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()

  const [exportProfile, setExportProfile] = useState<WorkspaceSnapshotProfile>('hr-ops')
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<WorkspaceSnapshotEnvelope | null>(null)

  const [importMode, setImportMode] = useState<WorkspaceSnapshotMode>('merge')
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [parsedEnvelope, setParsedEnvelope] = useState<WorkspaceSnapshotEnvelope | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<WorkspaceSnapshotImportResult | null>(null)

  const profileOptions = [
    {
      value: 'hr-ops',
      label: t('debugConfig.workspaceExportProfileHrOps', { defaultValue: 'hr-ops (candidate status + blocks)' }),
    },
    {
      value: 'full',
      label: t('debugConfig.workspaceExportProfileFull', { defaultValue: 'full (+ search profiles + workspace config)' }),
    },
  ]

  const modeOptions = [
    {
      value: 'merge',
      label: t('debugConfig.workspaceImportModeMerge', { defaultValue: 'merge — add or update rows, keep everything else' }),
    },
    {
      value: 'replace',
      label: t('debugConfig.workspaceImportModeReplace', { defaultValue: 'replace — delete current rows for the included tables first' }),
    },
  ]

  async function handleExport() {
    setExporting(true)
    try {
      const payload = (await requestJson(`/api/workspace/export?profile=${encodeURIComponent(exportProfile)}`)) as unknown
      const parsed = parseWorkspaceSnapshotEnvelope(payload)
      if (!parsed) {
        throw new Error('Export returned an unexpected payload')
      }
      setExportResult(parsed)
      toast.success(t('debugConfig.workspaceExportSuccess', { defaultValue: 'Snapshot exported' }))
    } catch (error) {
      reportUiError('Failed to export workspace snapshot', error)
      toast.error(snapshotErrorMessage(error, t('debugConfig.workspaceExportFailed', { defaultValue: 'Export failed' })))
    } finally {
      setExporting(false)
    }
  }

  function handleDownload() {
    if (!exportResult) {
      return
    }
    const blob = new Blob([JSON.stringify(exportResult)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `workspace-snapshot-${exportResult.workspaceSlug}-${exportResult.profile}-${exportResult.exportedAt}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function countRows(envelope: WorkspaceSnapshotEnvelope): Record<WorkspaceSnapshotTableKey, number> {
    const counts = {} as Record<WorkspaceSnapshotTableKey, number>
    for (const key of WORKSPACE_SNAPSHOT_TABLE_KEYS) {
      counts[key] = envelope.tables[key].length
    }
    return counts
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setParsedEnvelope(null)
    setFileError(null)
    setImportResult(null)
    if (!selected) {
      return
    }
    try {
      const text = await selected.text()
      const parsed = parseWorkspaceSnapshotEnvelope(JSON.parse(text) as unknown)
      if (!parsed) {
        setFileError(t('debugConfig.workspaceImportFileInvalid', { defaultValue: 'Not a valid workspace snapshot file' }))
        return
      }
      setParsedEnvelope(parsed)
    } catch {
      setFileError(t('debugConfig.workspaceImportFileInvalid', { defaultValue: 'Not a valid workspace snapshot file' }))
    }
  }

  async function handleImport() {
    if (!parsedEnvelope) {
      return
    }
    setImporting(true)
    try {
      const payload = (await requestJson('/api/workspace/import', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: parsedEnvelope.schemaVersion,
          profile: parsedEnvelope.profile,
          mode: importMode,
          tables: parsedEnvelope.tables,
        }),
      })) as unknown
      if (!isRecord(payload) || payload.success !== true) {
        throw new Error('Import returned an unexpected payload')
      }
      const result = payload as unknown as WorkspaceSnapshotImportResult
      setImportResult(result)
      toast.success(t('debugConfig.workspaceImportSuccess', { defaultValue: 'Snapshot imported' }))
    } catch (error) {
      reportUiError('Failed to import workspace snapshot', error)
      toast.error(snapshotErrorMessage(error, t('debugConfig.workspaceImportFailed', { defaultValue: 'Import failed' })))
    } finally {
      setImporting(false)
    }
  }

  const importDisabled = !parsedEnvelope || importing || (importMode === 'replace' && !replaceConfirmed)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {t('debugConfig.settingsNavWorkspace', { defaultValue: 'Workspace' })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('debugConfig.workspacePageDescription', {
            defaultValue: 'Export and import portable workspace snapshots (same format as the CLI).',
          })}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.workspaceExportTitle', { defaultValue: 'Export snapshot' })}</CardTitle>
            <CardDescription>
              {t('debugConfig.workspaceExportDescription', {
                defaultValue:
                  'Download candidate status, candidate blocks, and optionally search profiles and workspace config as a JSON snapshot. The resume corpus is never included.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-export-profile">
                {t('debugConfig.workspaceExportProfileLabel', { defaultValue: 'Profile' })}
              </Label>
              <Select
                id="ws-export-profile"
                data-testid="ws-export-profile"
                options={profileOptions}
                value={exportProfile}
                onChange={(event) => setExportProfile(event.target.value as WorkspaceSnapshotProfile)}
              />
            </div>
            <Button
              type="button"
              data-testid="ws-export-button"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download className="h-4 w-4" />
              {exporting
                ? t('debugConfig.workspaceExporting', { defaultValue: 'Exporting...' })
                : t('debugConfig.workspaceExportButton', { defaultValue: 'Export snapshot' })}
            </Button>

            {exportResult && (
              <div data-testid="ws-export-summary" className="space-y-3 rounded-md border p-4">
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{t('debugConfig.workspaceExportSummaryWorkspace', { defaultValue: 'Workspace' })}: </span>
                    {exportResult.workspaceSlug}
                  </p>
                  <p>
                    <span className="font-medium">{t('debugConfig.workspaceExportSummaryExportedAt', { defaultValue: 'Exported at' })}: </span>
                    {new Date(exportResult.exportedAt).toLocaleString()}
                  </p>
                </div>
                <SnapshotCountsTable counts={countRows(exportResult)} t={t} />
                <Button type="button" data-testid="ws-download-button" onClick={handleDownload} variant="outline">
                  <Download className="h-4 w-4" />
                  {t('debugConfig.workspaceDownloadButton', { defaultValue: 'Download file' })}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.workspaceImportTitle', { defaultValue: 'Import snapshot' })}</CardTitle>
            <CardDescription>
              {t('debugConfig.workspaceImportDescription', {
                defaultValue: 'Restore a snapshot file produced by this page or the CLI into the current workspace.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-import-file">
                {t('debugConfig.workspaceImportFileLabel', { defaultValue: 'Snapshot file' })}
              </Label>
              <Input
                id="ws-import-file"
                data-testid="ws-import-file"
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
              />
              {fileError && <p className="text-sm text-destructive" data-testid="ws-import-file-error">{fileError}</p>}
            </div>

            {parsedEnvelope && (
              <div data-testid="ws-import-preview" className="space-y-4 rounded-md border p-4">
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{t('debugConfig.workspaceImportWorkspace', { defaultValue: 'Workspace' })}: </span>
                    {parsedEnvelope.workspaceSlug}
                  </p>
                  <p>
                    <span className="font-medium">{t('debugConfig.workspaceImportProfile', { defaultValue: 'Profile' })}: </span>
                    {parsedEnvelope.profile}
                  </p>
                  <p>
                    <span className="font-medium">{t('debugConfig.workspaceImportSchemaVersion', { defaultValue: 'Schema version' })}: </span>
                    {parsedEnvelope.schemaVersion}
                  </p>
                </div>
                <SnapshotCountsTable counts={countRows(parsedEnvelope)} t={t} />

                <div className="space-y-2">
                  <Label htmlFor="ws-import-mode">
                    {t('debugConfig.workspaceImportModeLabel', { defaultValue: 'Mode' })}
                  </Label>
                  <Select
                    id="ws-import-mode"
                    data-testid="ws-import-mode"
                    options={modeOptions}
                    value={importMode}
                    onChange={(event) => setImportMode(event.target.value as WorkspaceSnapshotMode)}
                  />
                </div>

                {importMode === 'replace' && (
                  <label className="flex items-start gap-2 text-sm" data-testid="ws-import-replace-confirm-label">
                    <Checkbox
                      data-testid="ws-import-replace-confirm"
                      checked={replaceConfirmed}
                      onCheckedChange={(checked) => setReplaceConfirmed(checked === true)}
                    />
                    <span>
                      {t('debugConfig.workspaceImportReplaceConfirm', {
                        defaultValue: 'I understand replace deletes current rows before importing',
                      })}
                    </span>
                  </label>
                )}

                <Button
                  type="button"
                  data-testid="ws-import-button"
                  onClick={handleImport}
                  disabled={importDisabled}
                >
                  <Upload className="h-4 w-4" />
                  {importing
                    ? t('debugConfig.workspaceImporting', { defaultValue: 'Importing...' })
                    : t('debugConfig.workspaceImportButton', { defaultValue: 'Import snapshot' })}
                </Button>
              </div>
            )}

            {importResult && (
              <div data-testid="ws-import-result" className="space-y-3 rounded-md border p-4">
                <p className="text-sm font-medium">
                  {t('debugConfig.workspaceImportResultTitle', { defaultValue: 'Import result' })}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {t('debugConfig.workspaceImportResultApplied', { defaultValue: 'Applied' })}
                    </p>
                    <SnapshotCountsTable counts={importResult.applied} t={t} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {t('debugConfig.workspaceImportResultDeleted', { defaultValue: 'Deleted' })}
                    </p>
                    <SnapshotCountsTable counts={importResult.deleted} t={t} />
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
