import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useSettingsRequestJson } from '@/pages/system-settings/lib'
import { EXPORT_CORE_FIELDS, EXPORT_DEBUG_FIELDS, EXPORT_DETAIL_FIELDS, isRecord } from '@trends/shared'
import type { ExportFieldKey } from '@trends/shared'
import { FIELD_GROUPS, FIELD_LABELS } from './SystemSettingsExportFieldsPage.metadata'
import { reportUiError } from '@/lib/ui-error-reporting'

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
  const fields = data.fields.filter((f): f is ExportFieldKey =>
    typeof f === 'string' && f in FIELD_LABELS,
  )
  if (fields.length === 0) return null
  return {
    fields,
    includeDebugWhenEnabled: typeof data.includeDebugWhenEnabled === 'boolean' ? data.includeDebugWhenEnabled : false,
  }
}

function getDefaultSelectedFields(): ExportFieldKey[] {
  return [...EXPORT_CORE_FIELDS]
}

function SortableFieldRow({
  field,
  position,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  field: ExportFieldKey
  position: number
  onRemove: (field: ExportFieldKey) => void
  onMoveUp: (field: ExportFieldKey) => void
  onMoveDown: (field: ExportFieldKey) => void
  isFirst: boolean
  isLast: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`flex items-center gap-2 rounded-md border bg-background px-2 py-2 ${isDragging ? 'opacity-60 shadow-md' : ''}`}
    >
      <button
        type="button"
        className="flex cursor-grab items-center text-muted-foreground hover:text-foreground"
        aria-label={`Drag ${FIELD_LABELS[field]} to reorder`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums">
        {position}
      </span>
      <Label className="flex-1 text-sm font-normal">
        {FIELD_LABELS[field]}
      </Label>
      <button
        type="button"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        onClick={() => onMoveUp(field)}
        disabled={isFirst}
        aria-label={`Move ${FIELD_LABELS[field]} up`}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        onClick={() => onMoveDown(field)}
        disabled={isLast}
        aria-label={`Move ${FIELD_LABELS[field]} down`}
      >
        <ArrowDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => onRemove(field)}
        aria-label={`Remove ${FIELD_LABELS[field]}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function SystemSettingsExportFieldsPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedFields, setSelectedFields] = useState<ExportFieldKey[]>(getDefaultSelectedFields)
  const [includeDebug, setIncludeDebug] = useState(false)
  const [hasConfig, setHasConfig] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const selectedSet = useMemo(() => new Set(selectedFields), [selectedFields])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const toggleGroupCollapse = useCallback((groupLabel: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupLabel)) {
        next.delete(groupLabel)
      } else {
        next.add(groupLabel)
      }
      return next
    })
  }, [])

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
        setSelectedFields(getDefaultSelectedFields())
        setIncludeDebug(false)
        setHasConfig(false)
      }
    } catch (error) {
      reportUiError('Failed to load export fields config', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    loadData().catch((error) => {
      reportUiError('Unexpected loadData failure', error)
    })
  }, [loadData])

  const handleAddField = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => {
      if (current.includes(field)) return current
      return [...current, field]
    })
    setHasConfig(true)
  }, [])

  const handleToggleField = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => {
      if (current.includes(field)) {
        return current.filter((f) => f !== field)
      }
      return [...current, field]
    })
    setHasConfig(true)
  }, [])

  const handleRemoveField = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => current.filter((f) => f !== field))
    setHasConfig(true)
  }, [])

  const handleMoveUp = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => {
      const index = current.indexOf(field)
      if (index <= 0) return current
      return arrayMove(current, index, index - 1)
    })
    setHasConfig(true)
  }, [])

  const handleMoveDown = useCallback((field: ExportFieldKey) => {
    setSelectedFields((current) => {
      const index = current.indexOf(field)
      if (index < 0 || index >= current.length - 1) return current
      return arrayMove(current, index, index + 1)
    })
    setHasConfig(true)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setSelectedFields((current) => {
      const oldIndex = current.indexOf(active.id as ExportFieldKey)
      const newIndex = current.indexOf(over.id as ExportFieldKey)
      if (oldIndex < 0 || newIndex < 0) return current
      return arrayMove(current, oldIndex, newIndex)
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
      if (selectedFields.length > 0) {
        setHasConfig(true)
      } else {
        setSelectedFields(getDefaultSelectedFields())
        setIncludeDebug(false)
        setHasConfig(false)
      }
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to save export fields config', error)
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
      setSelectedFields(getDefaultSelectedFields())
      setIncludeDebug(false)
      setHasConfig(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to reset export fields config', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSaving(false)
    }
  }, [requestJson, t])

  const handleResetOrder = useCallback(() => {
    setSelectedFields((current) => {
      // Canonical default order is core -> detail -> debug, as defined in
      // packages/shared/src/export-fields-config.ts. This preserves the
      // user's current field selection while restoring the default ordering.
      const canonicalOrder = [...EXPORT_CORE_FIELDS, ...EXPORT_DETAIL_FIELDS, ...EXPORT_DEBUG_FIELDS]
      const orderIndex = new Map<ExportFieldKey, number>()
      canonicalOrder.forEach((key, index) => orderIndex.set(key, index))
      return [...current].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))
    })
    setHasConfig(true)
  }, [])

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
                reportUiError('Unexpected loadData failure', error)
              })
            }}
            disabled={loading}
          >
            {loading ? t('trends.loading') : t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            variant="outline"
            onClick={handleResetOrder}
            disabled={saving || loading}
          >
            {t('debugConfig.exportFieldsResetOrder', { defaultValue: 'Reset order' })}
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
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  {t('debugConfig.exportFieldsOrderTitle', { defaultValue: 'Export order' })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('debugConfig.exportFieldsOrderDescription', {
                    defaultValue: 'Drag to reorder. This is the column order used in exports.',
                  })}
                </p>
                {selectedFields.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    {t('debugConfig.exportFieldsEmpty', {
                      defaultValue: 'No fields selected. Add fields from below.',
                    })}
                  </p>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  >
                    <SortableContext items={selectedFields} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {selectedFields.map((field, index) => (
                          <SortableFieldRow
                            key={field}
                            field={field}
                            position={index + 1}
                            onRemove={handleRemoveField}
                            onMoveUp={handleMoveUp}
                            onMoveDown={handleMoveDown}
                            isFirst={index === 0}
                            isLast={index === selectedFields.length - 1}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>

              <div className="space-y-4 border-t pt-4">
                <Label className="text-sm font-semibold">
                  {t('debugConfig.exportFieldsAvailableTitle', { defaultValue: 'Available fields' })}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('debugConfig.exportFieldsAvailableDescription', {
                    defaultValue: 'Click + to add a field to the export order.',
                  })}
                </p>
                {FIELD_GROUPS.map((group) => {
                  const allSelected = group.fields.every((f) => selectedSet.has(f))
                  const someSelected = group.fields.some((f) => selectedSet.has(f))
                  const groupCount = group.fields.length
                  const selectedCount = group.fields.filter((f) => selectedSet.has(f)).length
                  const isCollapsed = collapsedGroups.has(group.label)

                  return (
                    <div key={group.label} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`group-${group.label}`}
                          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                          onCheckedChange={() => handleToggleGroup(group.fields)}
                          aria-label={`Toggle all ${group.label} fields`}
                        />
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-1 rounded-sm text-left"
                          onClick={() => toggleGroupCollapse(group.label)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="text-sm font-semibold">
                            {group.label}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              ({selectedCount}/{groupCount})
                            </span>
                          </span>
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="ml-6 space-y-1">
                          {group.fields.map((field) => {
                            const isSelected = selectedSet.has(field)
                            return (
                              <div
                                key={field}
                                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
                              >
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id={`field-${field}`}
                                    checked={isSelected}
                                    onCheckedChange={() => handleToggleField(field)}
                                    aria-label={FIELD_LABELS[field]}
                                  />
                                  <Label htmlFor={`field-${field}`} className="text-sm text-muted-foreground">
                                    {FIELD_LABELS[field]}
                                  </Label>
                                </div>
                                {!isSelected && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                                    onClick={() => handleAddField(field)}
                                    aria-label={`Add ${FIELD_LABELS[field]}`}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    {t('debugConfig.exportFieldsAdd', { defaultValue: 'Add' })}
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

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
