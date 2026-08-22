import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { parseOptionalNumberInput, useSettingsRequestJson } from '@/pages/system-settings/lib'
import {
  createEmptyTaxonomyClusterForm,
  normalizeOptionalString,
  parseTaxonomyClustersPayload,
  slugifyTaxonomyValue,
  taxonomyClusterToForm,
  type TaxonomyCluster,
  type TaxonomyClusterFormState,
  type TaxonomyClusterSource,
  type TaxonomyClusterStatus,
} from '@/lib/taxonomy'
import { reportUiError } from '@/lib/ui-error-reporting'

const STATUS_OPTIONS: Array<{ value: TaxonomyClusterStatus; labelKey: string; defaultLabel: string }> = [
  { value: 'active', labelKey: 'debugConfig.taxonomy.status.active', defaultLabel: 'Active' },
  { value: 'draft', labelKey: 'debugConfig.taxonomy.status.draft', defaultLabel: 'Draft' },
  { value: 'archived', labelKey: 'debugConfig.taxonomy.status.archived', defaultLabel: 'Archived' },
]

const SOURCE_OPTIONS: Array<{ value: TaxonomyClusterSource; labelKey: string; defaultLabel: string }> = [
  { value: 'human', labelKey: 'debugConfig.taxonomy.source.human', defaultLabel: 'Human' },
  { value: 'ai', labelKey: 'debugConfig.taxonomy.source.ai', defaultLabel: 'AI' },
  { value: 'merged', labelKey: 'debugConfig.taxonomy.source.merged', defaultLabel: 'Merged' },
]

function buildTaxonomyPayload(form: TaxonomyClusterFormState) {
  const tags = form.tags
    .split(/[,，\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (!form.name.trim() || !form.slug.trim() || tags.length === 0) {
    throw new Error('Missing taxonomy fields')
  }

  const confidenceInput = parseOptionalNumberInput(form.confidence)
  if (!confidenceInput.valid) {
    throw new Error('Invalid confidence value')
  }

  return {
    name: form.name.trim(),
    slug: slugifyTaxonomyValue(form.slug),
    parentSlug: normalizeOptionalString(form.parentSlug),
    tags,
    source: form.source,
    confidence: confidenceInput.value,
    status: form.status,
  }
}

export function SystemSettingsTaxonomyPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [items, setItems] = useState<TaxonomyCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<TaxonomyCluster | null>(null)
  const [form, setForm] = useState<TaxonomyClusterFormState>(createEmptyTaxonomyClusterForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const payload = await requestJson('/api/taxonomy')
      const parsed = parseTaxonomyClustersPayload(payload)
      if (!parsed) {
        throw new Error('Invalid taxonomy payload')
      }
      setItems(parsed)
    } catch (error) {
      reportUiError('Failed to load taxonomy clusters', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    loadData().catch((error) => {
      reportUiError('Unexpected taxonomy load failure', error)
    })
  }, [loadData])

  const statusCounts = useMemo(() => ({
    active: items.filter((item) => item.status === 'active').length,
    draft: items.filter((item) => item.status === 'draft').length,
    archived: items.filter((item) => item.status === 'archived').length,
  }), [items])

  const statusOptions = useMemo(() => STATUS_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey, { defaultValue: option.defaultLabel }),
  })), [t])

  const sourceOptions = useMemo(() => SOURCE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey, { defaultValue: option.defaultLabel }),
  })), [t])

  const formatStatusLabel = useCallback((value: TaxonomyClusterStatus) => {
    return statusOptions.find((option) => option.value === value)?.label ?? value
  }, [statusOptions])

  const formatSourceLabel = useCallback((value: TaxonomyClusterSource) => {
    return sourceOptions.find((option) => option.value === value)?.label ?? value
  }, [sourceOptions])

  const parentSlugOptions = useMemo(() => {
    return [
      { value: '', label: t('debugConfig.taxonomy.none', { defaultValue: 'None' }) },
      ...items
        .filter((item) => !editingItem || item.id !== editingItem.id)
        .map((item) => ({ value: item.slug, label: item.name })),
    ]
  }, [editingItem, items, t])

  const openCreateDialog = useCallback(() => {
    setEditingItem(null)
    setForm(createEmptyTaxonomyClusterForm())
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((item: TaxonomyCluster) => {
    setEditingItem(item)
    setForm(taxonomyClusterToForm(item))
    setDialogOpen(true)
  }, [])

  const saveCluster = useCallback(async () => {
    setSaving(true)
    try {
      const body = {
        ...(editingItem ? { id: editingItem.id } : {}),
        ...buildTaxonomyPayload(form),
      }
      const payload = await requestJson('/api/taxonomy', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const parsed = parseTaxonomyClustersPayload(payload)
      if (!parsed) {
        throw new Error('Invalid taxonomy save payload')
      }
      setItems(parsed)
      setDialogOpen(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to save taxonomy cluster', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSaving(false)
    }
  }, [editingItem, form, requestJson, t])

  const deleteCluster = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const payload = await requestJson(`/api/taxonomy/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const parsed = parseTaxonomyClustersPayload(payload)
      if (!parsed) {
        throw new Error('Invalid taxonomy delete payload')
      }
      setItems(parsed)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to delete taxonomy cluster', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setDeletingId(null)
    }
  }, [requestJson, t])

  const suggestClusters = useCallback(async () => {
    setSuggesting(true)
    try {
      const payload = await requestJson('/api/taxonomy/suggest', {
        method: 'POST',
        body: JSON.stringify({ limit: 10 }),
      })
      const parsed = parseTaxonomyClustersPayload(payload)
      if (!parsed) {
        throw new Error('Invalid taxonomy suggest payload')
      }
      await loadData()
      toast.success(t('debugConfig.taxonomy.generatedDrafts', {
        count: parsed.length,
        defaultValue: 'Generated {{count}} draft taxonomy suggestions',
      }))
    } catch (error) {
      reportUiError('Failed to suggest taxonomy clusters', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSuggesting(false)
    }
  }, [loadData, requestJson, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('debugConfig.settingsNavTaxonomy', { defaultValue: 'Taxonomy' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.taxonomyPageDescription', {
              defaultValue: 'Manage grouped resume skill clusters used by the search facet sidebar.',
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => {
            loadData().catch((error) => {
              reportUiError('Unexpected taxonomy load failure', error)
            })
          }} disabled={loading}>
            {loading ? t('trends.loading') : t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button variant="outline" onClick={() => {
            void suggestClusters()
          }} disabled={suggesting}>
            {suggesting
              ? t('debugConfig.taxonomy.generatingDrafts', { defaultValue: 'Generating drafts...' })
              : t('debugConfig.taxonomy.generateDrafts', { defaultValue: 'Generate Drafts' })}
          </Button>
          <Button onClick={openCreateDialog}>{t('debugConfig.taxonomy.newCluster', { defaultValue: 'New Cluster' })}</Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('debugConfig.taxonomy.status.active', { defaultValue: 'Active' })}</CardTitle>
            <CardDescription>{t('debugConfig.taxonomy.activeDescription', { defaultValue: 'Visible in the search facet sidebar.' })}</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.active}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('debugConfig.taxonomy.status.draft', { defaultValue: 'Draft' })}</CardTitle>
            <CardDescription>{t('debugConfig.taxonomy.draftDescription', { defaultValue: 'Generated or staged before approval.' })}</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.draft}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('debugConfig.taxonomy.status.archived', { defaultValue: 'Archived' })}</CardTitle>
            <CardDescription>{t('debugConfig.taxonomy.archivedDescription', { defaultValue: 'Kept for history but hidden from search.' })}</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.archived}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('debugConfig.taxonomy.clusterRegistry', { defaultValue: 'Cluster registry' })}</CardTitle>
          <CardDescription>
            {t('debugConfig.taxonomy.clusterRegistryDescription', {
              defaultValue: 'Drafts can be reviewed and promoted to active clusters. Active clusters are used by the search-first resume sidebar.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('trends.loading')}</div>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {t('debugConfig.taxonomy.empty', { defaultValue: 'No taxonomy clusters yet.' })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('debugConfig.taxonomy.name', { defaultValue: 'Name' })}</TableHead>
                  <TableHead>{t('debugConfig.taxonomy.statusLabel', { defaultValue: 'Status' })}</TableHead>
                  <TableHead>{t('debugConfig.taxonomy.sourceLabel', { defaultValue: 'Source' })}</TableHead>
                  <TableHead>{t('debugConfig.taxonomy.parent', { defaultValue: 'Parent' })}</TableHead>
                  <TableHead>{t('debugConfig.taxonomy.tags', { defaultValue: 'Tags' })}</TableHead>
                  <TableHead className="w-[180px] text-right">{t('debugConfig.taxonomy.actions', { defaultValue: 'Actions' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="align-top">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.slug}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant={item.status === 'active' ? 'default' : 'outline'}>
                        {formatStatusLabel(item.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">{formatSourceLabel(item.source)}</TableCell>
                    <TableCell className="align-top">{item.parentSlug ?? '—'}</TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 6).map((tag) => (
                          <Badge key={`${item.id}-${tag}`} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                        {item.tags.length > 6 ? (
                          <Badge variant="outline">+{item.tags.length - 6}</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditDialog(item)}>
                          {t('common.edit', { defaultValue: 'Edit' })}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setPendingDeleteId(item.id)
                          }}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id
                            ? t('common.deleting', { defaultValue: 'Deleting...' })
                            : t('common.delete', { defaultValue: 'Delete' })}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingItem
                ? t('debugConfig.taxonomy.editCluster', { defaultValue: 'Edit taxonomy cluster' })
                : t('debugConfig.taxonomy.createCluster', { defaultValue: 'Create taxonomy cluster' })}
            </DialogTitle>
            <DialogDescription>
              {t('debugConfig.taxonomy.dialogDescription', {
                defaultValue: 'Define a stable cluster name, slug, and the raw tags that should roll up into it.',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.name', { defaultValue: 'Name' })}</label>
              <Input
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value
                  const nextAutoSlug = slugifyTaxonomyValue(name)
                  setForm((current) => ({
                    ...current,
                    name,
                    slug: !current.slug || current.slug === slugifyTaxonomyValue(current.name)
                      ? nextAutoSlug
                      : current.slug,
                  }))
                }}
                placeholder={t('debugConfig.taxonomy.namePlaceholder', { defaultValue: 'Backend Languages' })}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.slug', { defaultValue: 'Slug' })}</label>
              <Input
                value={form.slug}
                onChange={(event) => {
                  const slug = slugifyTaxonomyValue(event.target.value)
                  setForm((current) => ({ ...current, slug }))
                }}
                placeholder="backend-languages"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.statusLabel', { defaultValue: 'Status' })}</label>
              <Select
                options={statusOptions}
                value={form.status}
                onChange={(event) => {
                  setForm((current) => ({ ...current, status: event.target.value as TaxonomyClusterStatus }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.sourceLabel', { defaultValue: 'Source' })}</label>
              <Select
                options={sourceOptions}
                value={form.source}
                onChange={(event) => {
                  setForm((current) => ({ ...current, source: event.target.value as TaxonomyClusterSource }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.parentCluster', { defaultValue: 'Parent Cluster' })}</label>
              <Select
                options={parentSlugOptions}
                value={form.parentSlug}
                onChange={(event) => {
                  setForm((current) => ({ ...current, parentSlug: event.target.value }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.confidence', { defaultValue: 'Confidence' })}</label>
              <Input
                value={form.confidence}
                onChange={(event) => {
                  setForm((current) => ({ ...current, confidence: event.target.value }))
                }}
                placeholder="0.75"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">{t('debugConfig.taxonomy.tags', { defaultValue: 'Tags' })}</label>
              <Input
                value={form.tags}
                onChange={(event) => {
                  setForm((current) => ({ ...current, tags: event.target.value }))
                }}
                placeholder={t('debugConfig.taxonomy.tagsPlaceholder', { defaultValue: 'Go, Java, Rust' })}
              />
              <p className="text-xs text-muted-foreground">
                {t('debugConfig.taxonomy.tagsHelp', {
                  defaultValue: 'Separate tags with commas. Search facets will group any matching resume tag into this cluster.',
                })}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={() => {
              void saveCluster()
            }} disabled={saving}>
              {saving
                ? t('common.saving', { defaultValue: 'Saving...' })
                : editingItem
                  ? t('debugConfig.taxonomy.saveChanges', { defaultValue: 'Save Changes' })
                  : t('debugConfig.taxonomy.createClusterButton', { defaultValue: 'Create Cluster' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setPendingDeleteId(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('debugConfig.taxonomy.deleteConfirmTitle', {
                defaultValue: 'Delete taxonomy cluster?',
              })}
            </DialogTitle>
            <DialogDescription>
              {t('debugConfig.taxonomy.deleteConfirmBody', {
                defaultValue: 'This permanently removes cluster {{name}} ({{slug}}).',
                name: items.find((item) => item.id === pendingDeleteId)?.name ?? '',
                slug: items.find((item) => item.id === pendingDeleteId)?.slug ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="taxonomy-delete-cancel"
              onClick={() => setPendingDeleteId(null)}
              disabled={pendingDeleteId !== null && deletingId === pendingDeleteId}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              data-testid="taxonomy-delete-confirm"
              onClick={() => {
                const id = pendingDeleteId
                setPendingDeleteId(null)
                if (id !== null) {
                  void deleteCluster(id)
                }
              }}
              disabled={pendingDeleteId !== null && deletingId === pendingDeleteId}
            >
              {t('common.delete', { defaultValue: 'Delete' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
