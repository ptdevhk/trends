import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { isRecord } from '@trends/shared'
import type { ExportFieldKey } from '@trends/shared'
import { FIELD_GROUPS, FIELD_LABELS } from './SystemSettingsExportFieldsPage.metadata'

interface ExportFieldsConfigState {
  fields: ExportFieldKey[]
  includeDebugWhenEnabled: boolean
}

function parseExportFieldsPayload(payload: unknown): ExportFieldsConfigState | null {
  if (!isRecord(payload) || !payload.success) return null
  const data = payload.config
  if (data === null || data === undefined) return null
  if (!isRecord(data)) return null
  if (!Array.isArray(data.fields)) return null
  return {
    fields: data.fields.filter((f): f is ExportFieldKey =>
      typeof f === 'string' && f in FIELD_LABELS,
    ),
    includeDebugWhenEnabled: typeof data.includeDebugWhenEnabled === 'boolean' ? data.includeDebugWhenEnabled : false,
  }
}

export function SystemSettingsExportFieldsPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedFields, setSelectedFields] = useState<ExportFieldKey[]>([])
  const [includeDebug, setIncludeDebug] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [saving, setSaving] = useState(false)

  const selectedSet = useMemo(() => new Set(selectedFields), [selectedFields])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const response = await requestJson('/api/config/export-fields')
      if (!isRecord(response) || !response.success) {
        throw new Error('Failed to load export fields config')
      }

      const config = parseExportFieldsPayload(response)
      if (config) {
        setSelectedFields(config.fields)
        setIncludeDebug(config.includeDebugWhenEnabled)
        setHasConfig(true)
      } else {
        // No config — defaults will be used
        setSelectedFields([])
        setIncludeDebug(false)
        setHasConfig(false)
      }
    } catch (error) {
      console.error('Failed to load export fields config', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    loadData().catch((error) => {
      console.error('Unexpected loadData failure', error)
    })
  }, [loadData])

  const handleToggleField = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => {
      if (current.includes(field)) {
        return current.filter((f) => f !== field)
      }
      return [...current, field]
    })
    setHasConfig(true)
  }, [])

  const handleToggleGroup = useCallback((groupFields: ExportFieldKey[]) => {
    setSelectedFields((current) => {
      const currentSet = new Set(current)
      const allSelected = groupFields.every((f) => currentSet.has(f))
      if (allSelected) {
        return current.filter((f) => !groupFields.includes(f))
      }
      const newFields = [...current]
      for (const field of groupFields) {
        if (!currentSet.has(field)) {
          newFields.push(field)
        }
      }
      return newFields
    })
    setHasConfig(true)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await requestJson('/api/config/export-fields', {
        method: 'PUT',
        body: JSON.stringify({ fields: selectedFields, includeDebugWhenEnabled: includeDebug }),
      })
      setHasConfig(selectedFields.length > 0)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to save export fields config', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSaving(false)
    }
  }, [selectedFields, includeDebug, requestJson, t])

  const handleReset = useCallback(async () => {
    setSaving(true)
    try {
      await requestJson('/api/config/export-fields', {
        method: 'PUT',
        body: JSON.stringify({ fields: [] as ExportFieldKey[] }),
      })
      setSelectedFields([])
      setIncludeDebug(false)
      setHasConfig(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to reset export fields config', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSaving(false)
    }
  }, [requestJson, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('debugConfig.settingsNavExportFields', { defaultValue: 'Export Fields' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.exportFieldsPageDescription', {
              defaultValue: 'Configure which columns appear in resume CSV/XLSX exports.',
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              loadData().catch((error) => {
                console.error('Unexpected loadData failure', error)
              })
            }}
            disabled={loading}
          >
            {loading ? t('trends.loading') : t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saving || loading}
          >
            {t('debugConfig.exportFieldsResetDefaults', { defaultValue: 'Reset to defaults' })}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? t('debugConfig.saving', { defaultValue: 'Saving...' }) : t('debugConfig.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {!hasConfig && !loading && (
        <div className="rounded-md border border-muted bg-muted/30 p-3 text-sm text-muted-foreground">
          {t('debugConfig.exportFieldsNoConfig', {
            defaultValue: 'Using default columns. Configure below to customize.',
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {t('debugConfig.exportFieldsTitle', { defaultValue: 'Column Selection' })}
          </CardTitle>
          <CardDescription>
            {t('debugConfig.exportFieldsDescription', {
              defaultValue: 'Select which fields to include in exports. Fields are exported in the order shown.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('trends.loading')}</p>
          ) : (
            <>
              {FIELD_GROUPS.map((group) => {
                const allSelected = group.fields.every((f) => selectedSet.has(f))
                const someSelected = group.fields.some((f) => selectedSet.has(f))

                return (
                  <div key={group.label} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`group-${group.label}`}
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={() => handleToggleGroup(group.fields)}
                      />
                      <Label
                        htmlFor={`group-${group.label}`}
                        className="text-sm font-semibold"
                      >
                        {group.label}
                      </Label>
                    </div>
                    <div className="ml-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.fields.map((field) => (
                        <div key={field} className="flex items-center gap-2">
                          <Checkbox
                            id={`field-${field}`}
                            checked={selectedSet.has(field)}
                            onCheckedChange={() => handleToggleField(field)}
                          />
                          <Label
                            htmlFor={`field-${field}`}
                            className="text-sm font-normal"
                          >
                            {FIELD_LABELS[field]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center gap-2 pt-2 border-t">
                <Checkbox
                  id="include-debug"
                  checked={includeDebug}
                  onCheckedChange={(checked) => {
                    setIncludeDebug(checked === true)
                    setHasConfig(true)
                  }}
                />
                <Label htmlFor="include-debug" className="text-sm">
                  {t('debugConfig.exportFieldsIncludeDebug', {
                    defaultValue: 'Include debug columns when debug mode is enabled',
                  })}
                </Label>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
