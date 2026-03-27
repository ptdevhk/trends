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

const STATUS_OPTIONS: Array<{ value: TaxonomyClusterStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]

const SOURCE_OPTIONS: Array<{ value: TaxonomyClusterSource; label: string }> = [
  { value: 'human', label: 'Human' },
  { value: 'ai', label: 'AI' },
  { value: 'merged', label: 'Merged' },
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

function formatSourceLabel(value: TaxonomyClusterSource): string {
  return SOURCE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function formatStatusLabel(value: TaxonomyClusterStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
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
      console.error('Failed to load taxonomy clusters', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    loadData().catch((error) => {
      console.error('Unexpected taxonomy load failure', error)
    })
  }, [loadData])

  const statusCounts = useMemo(() => ({
    active: items.filter((item) => item.status === 'active').length,
    draft: items.filter((item) => item.status === 'draft').length,
    archived: items.filter((item) => item.status === 'archived').length,
  }), [items])

  const parentSlugOptions = useMemo(() => {
    return [
      { value: '', label: 'None' },
      ...items
        .filter((item) => !editingItem || item.id !== editingItem.id)
        .map((item) => ({ value: item.slug, label: item.name })),
    ]
  }, [editingItem, items])

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
      console.error('Failed to save taxonomy cluster', error)
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
      console.error('Failed to delete taxonomy cluster', error)
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
      toast.success(`Generated ${parsed.length} draft taxonomy suggestions`)
    } catch (error) {
      console.error('Failed to suggest taxonomy clusters', error)
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
              console.error('Unexpected taxonomy load failure', error)
            })
          }} disabled={loading}>
            {loading ? t('trends.loading') : t('common.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button variant="outline" onClick={() => {
            void suggestClusters()
          }} disabled={suggesting}>
            {suggesting ? 'Generating drafts...' : 'Generate Drafts'}
          </Button>
          <Button onClick={openCreateDialog}>New Cluster</Button>
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
            <CardTitle className="text-base">Active</CardTitle>
            <CardDescription>Visible in the search facet sidebar.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.active}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Draft</CardTitle>
            <CardDescription>Generated or staged before approval.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.draft}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Archived</CardTitle>
            <CardDescription>Kept for history but hidden from search.</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{statusCounts.archived}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cluster registry</CardTitle>
          <CardDescription>
            Drafts can be reviewed and promoted to active clusters. Active clusters are used by the search-first resume sidebar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">{t('trends.loading')}</div>
          ) : items.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No taxonomy clusters yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
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
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void deleteCluster(item.id)
                          }}
                          disabled={deletingId === item.id}
                        >
                          {deletingId === item.id ? 'Deleting...' : 'Delete'}
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
            <DialogTitle>{editingItem ? 'Edit taxonomy cluster' : 'Create taxonomy cluster'}</DialogTitle>
            <DialogDescription>
              Define a stable cluster name, slug, and the raw tags that should roll up into it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value
                  setForm((current) => ({
                    ...current,
                    name,
                    slug: current.slug ? current.slug : slugifyTaxonomyValue(name),
                  }))
                }}
                placeholder="Backend Languages"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Slug</label>
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
              <label className="text-sm font-medium">Status</label>
              <Select
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(event) => {
                  setForm((current) => ({ ...current, status: event.target.value as TaxonomyClusterStatus }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Source</label>
              <Select
                options={SOURCE_OPTIONS}
                value={form.source}
                onChange={(event) => {
                  setForm((current) => ({ ...current, source: event.target.value as TaxonomyClusterSource }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Parent Cluster</label>
              <Select
                options={parentSlugOptions}
                value={form.parentSlug}
                onChange={(event) => {
                  setForm((current) => ({ ...current, parentSlug: event.target.value }))
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Confidence</label>
              <Input
                value={form.confidence}
                onChange={(event) => {
                  setForm((current) => ({ ...current, confidence: event.target.value }))
                }}
                placeholder="0.75"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Tags</label>
              <Input
                value={form.tags}
                onChange={(event) => {
                  setForm((current) => ({ ...current, tags: event.target.value }))
                }}
                placeholder="Go, Java, Rust"
              />
              <p className="text-xs text-muted-foreground">
                Separate tags with commas. Search facets will group any matching resume tag into this cluster.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => {
              void saveCluster()
            }} disabled={saving}>
              {saving ? 'Saving...' : editingItem ? 'Save Changes' : 'Create Cluster'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
