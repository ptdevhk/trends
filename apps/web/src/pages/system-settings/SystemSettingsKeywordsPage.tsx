import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  createEmptyCustomKeywordForm,
  createEmptyWorkflowSeedForm,
  customKeywordToForm,
  parseBrandKeywordsPayload,
  parseCustomKeywordsPayload,
  workflowSeedToForm,
  type BrandKeywordItem,
  type CustomKeywordCategory,
  type CustomKeywordFormState,
  type CustomKeywordWorkflowSeed,
  type CustomKeywordTag,
  type KeywordMarket,
  type WorkflowSeedFormState,
  useSettingsRequestJson,
} from '@/pages/system-settings/lib'

const MARKET_OPTIONS: Array<{ value: KeywordMarket; label: string }> = [
  { value: 'CN', label: 'CN' },
  { value: 'MY', label: 'MY' },
]

export function SystemSettingsKeywordsPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customKeywordTags, setCustomKeywordTags] = useState<CustomKeywordTag[]>([])
  const [customKeywordCategories, setCustomKeywordCategories] = useState<CustomKeywordCategory[]>([])
  const [workflowSeeds, setWorkflowSeeds] = useState<CustomKeywordWorkflowSeed[]>([])
  const [brandKeywords, setBrandKeywords] = useState<BrandKeywordItem[]>([])
  const [customKeywordDialogOpen, setCustomKeywordDialogOpen] = useState(false)
  const [editingCustomKeywordId, setEditingCustomKeywordId] = useState<string | null>(null)
  const [customKeywordForm, setCustomKeywordForm] = useState<CustomKeywordFormState>(createEmptyCustomKeywordForm)
  const [savingCustomKeyword, setSavingCustomKeyword] = useState(false)
  const [deleteCustomKeywordTargetId, setDeleteCustomKeywordTargetId] = useState<string | null>(null)
  const [deletingCustomKeyword, setDeletingCustomKeyword] = useState(false)
  const [workflowSeedDialogOpen, setWorkflowSeedDialogOpen] = useState(false)
  const [editingWorkflowSeedId, setEditingWorkflowSeedId] = useState<string | null>(null)
  const [workflowSeedForm, setWorkflowSeedForm] = useState<WorkflowSeedFormState>(createEmptyWorkflowSeedForm)
  const [savingWorkflowSeed, setSavingWorkflowSeed] = useState(false)
  const [deleteWorkflowSeedTargetId, setDeleteWorkflowSeedTargetId] = useState<string | null>(null)
  const [deletingWorkflowSeed, setDeletingWorkflowSeed] = useState(false)

  const loadCustomKeywords = useCallback(async () => {
    const payload = await requestJson('/api/config/custom-keywords')
    const parsed = parseCustomKeywordsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid custom keywords response')
    }

    setCustomKeywordTags(parsed.tags)
    setCustomKeywordCategories(parsed.categories)
    setWorkflowSeeds(parsed.workflowSeeds)
  }, [requestJson])

  const loadBrandKeywords = useCallback(async () => {
    const payload = await requestJson('/api/industry/brands')
    const parsed = parseBrandKeywordsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid brand keywords response')
    }

    setBrandKeywords(parsed)
  }, [requestJson])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      await Promise.all([loadCustomKeywords(), loadBrandKeywords()])
    } catch (error) {
      console.error('Failed to load keyword settings', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [loadBrandKeywords, loadCustomKeywords, t])

  useEffect(() => {
    loadData().catch((error) => {
      console.error('Unexpected loadData failure', error)
    })
  }, [loadData])

  const openAddCustomKeywordDialog = useCallback(() => {
    setEditingCustomKeywordId(null)
    setCustomKeywordForm(createEmptyCustomKeywordForm())
    setCustomKeywordDialogOpen(true)
  }, [])

  const openEditCustomKeywordDialog = useCallback((tag: CustomKeywordTag) => {
    setEditingCustomKeywordId(tag.id)
    setCustomKeywordForm(customKeywordToForm(tag))
    setCustomKeywordDialogOpen(true)
  }, [])

  const buildCustomKeywordFromForm = useCallback((): CustomKeywordTag => {
    const id = customKeywordForm.id.trim()
    const keyword = customKeywordForm.keyword.trim()
    const english = customKeywordForm.english.trim()
    const category = customKeywordForm.category.trim()
    const markets = Array.from(new Set(customKeywordForm.markets))

    if (!id || !keyword || !category) {
      throw new Error('Missing required fields')
    }

    return {
      id,
      keyword,
      category,
      english: english || undefined,
      markets: markets.length > 0 ? markets : undefined,
      visible: customKeywordForm.visible,
    }
  }, [customKeywordForm])

  const handleSaveCustomKeyword = useCallback(async () => {
    setSavingCustomKeyword(true)

    try {
      const tag = buildCustomKeywordFromForm()

      if (editingCustomKeywordId) {
        await requestJson(`/api/config/custom-keywords/${encodeURIComponent(editingCustomKeywordId)}`, {
          method: 'PUT',
          body: JSON.stringify(tag),
        })
      } else {
        await requestJson('/api/config/custom-keywords', {
          method: 'POST',
          body: JSON.stringify(tag),
        })
      }

      await loadCustomKeywords()
      setCustomKeywordDialogOpen(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to save custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingCustomKeyword(false)
    }
  }, [buildCustomKeywordFromForm, editingCustomKeywordId, loadCustomKeywords, requestJson, t])

  const handleDeleteCustomKeyword = useCallback(async () => {
    if (!deleteCustomKeywordTargetId) {
      return
    }

    setDeletingCustomKeyword(true)
    try {
      await requestJson(`/api/config/custom-keywords/${encodeURIComponent(deleteCustomKeywordTargetId)}`, {
        method: 'DELETE',
      })
      await loadCustomKeywords()
      setDeleteCustomKeywordTargetId(null)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to delete custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setDeletingCustomKeyword(false)
    }
  }, [deleteCustomKeywordTargetId, loadCustomKeywords, requestJson, t])

  const openAddWorkflowSeedDialog = useCallback(() => {
    setEditingWorkflowSeedId(null)
    setWorkflowSeedForm(createEmptyWorkflowSeedForm())
    setWorkflowSeedDialogOpen(true)
  }, [])

  const openEditWorkflowSeedDialog = useCallback((seed: CustomKeywordWorkflowSeed) => {
    setEditingWorkflowSeedId(seed.id)
    setWorkflowSeedForm(workflowSeedToForm(seed))
    setWorkflowSeedDialogOpen(true)
  }, [])

  const buildWorkflowSeedFromForm = useCallback((): CustomKeywordWorkflowSeed => {
    const id = workflowSeedForm.id.trim()
    const label = workflowSeedForm.label.trim()
    const location = workflowSeedForm.location.trim()
    const keywords = workflowSeedForm.keywords
      .split(/[,，\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    const collectUrl = workflowSeedForm.collectUrl.trim()
    const market = workflowSeedForm.market
    const collectionSourceType = workflowSeedForm.collectionSourceType

    if (!id || !label || keywords.length === 0) {
      throw new Error('Missing required workflow seed fields')
    }

    return {
      id,
      label,
      market,
      location,
      keywords,
      collectionSource: collectUrl
        ? {
            type: collectionSourceType,
            exactUrl: collectUrl,
          }
        : {
            type: collectionSourceType,
          },
      collectUrl: collectUrl || undefined,
      visible: workflowSeedForm.visible,
    }
  }, [workflowSeedForm])

  const handleSaveWorkflowSeed = useCallback(async () => {
    setSavingWorkflowSeed(true)

    try {
      const workflowSeed = buildWorkflowSeedFromForm()

      if (editingWorkflowSeedId) {
        await requestJson(`/api/config/custom-keywords/workflow-seeds/${encodeURIComponent(editingWorkflowSeedId)}`, {
          method: 'PUT',
          body: JSON.stringify(workflowSeed),
        })
      } else {
        await requestJson('/api/config/custom-keywords/workflow-seeds', {
          method: 'POST',
          body: JSON.stringify(workflowSeed),
        })
      }

      await loadCustomKeywords()
      setWorkflowSeedDialogOpen(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to save workflow seed', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingWorkflowSeed(false)
    }
  }, [buildWorkflowSeedFromForm, editingWorkflowSeedId, loadCustomKeywords, requestJson, t])

  const handleDeleteWorkflowSeed = useCallback(async () => {
    if (!deleteWorkflowSeedTargetId) {
      return
    }

    setDeletingWorkflowSeed(true)
    try {
      await requestJson(`/api/config/custom-keywords/workflow-seeds/${encodeURIComponent(deleteWorkflowSeedTargetId)}`, {
        method: 'DELETE',
      })
      await loadCustomKeywords()
      setDeleteWorkflowSeedTargetId(null)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to delete workflow seed', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setDeletingWorkflowSeed(false)
    }
  }, [deleteWorkflowSeedTargetId, loadCustomKeywords, requestJson, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('debugConfig.settingsNavKeywords', { defaultValue: 'Keywords' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.keywordsPageDescription', {
              defaultValue: 'Manage editable keywords and review derived brand data.',
            })}
          </p>
        </div>
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
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('debugConfig.customKeywords')}</CardTitle>
                <CardDescription>{t('debugConfig.customKeywordsDescription')}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{customKeywordTags.length}</Badge>
                <Button size="sm" onClick={openAddCustomKeywordDialog}>
                  {t('debugConfig.addCustomKeyword', { defaultValue: 'Add Keyword' })}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('debugConfig.customKeywordId')}</TableHead>
                    <TableHead>{t('debugConfig.customKeywordKeyword')}</TableHead>
                    <TableHead>{t('debugConfig.customKeywordEnglish')}</TableHead>
                    <TableHead>{t('debugConfig.customKeywordCategory')}</TableHead>
                    <TableHead>{t('debugConfig.customKeywordMarkets', { defaultValue: 'Markets' })}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedStatus', { defaultValue: 'Status' })}</TableHead>
                    <TableHead className="text-right">{t('jdManagement.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customKeywordTags.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {loading ? t('trends.loading') : t('debug.none')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    customKeywordTags.map((tag) => (
                      <TableRow key={tag.id} className={tag.visible === false ? 'opacity-60' : undefined}>
                        <TableCell className="font-mono text-xs">{tag.id}</TableCell>
                        <TableCell>{tag.keyword}</TableCell>
                        <TableCell>{tag.english || '-'}</TableCell>
                        <TableCell>{tag.category}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {tag.markets && tag.markets.length > 0 ? tag.markets.join(', ') : t('debugConfig.customKeywordMarketsAll', { defaultValue: 'All' })}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={tag.source === 'system' ? 'secondary' : 'outline'} className="w-fit text-xs">
                              {tag.source ?? 'workspace'}
                            </Badge>
                            <Badge variant={tag.visible === false ? 'secondary' : 'default'} className="w-fit text-xs">
                              {tag.visible === false
                                ? t('debugConfig.workflowSeedHidden', { defaultValue: 'Hidden' })
                                : t('debugConfig.workflowSeedVisible', { defaultValue: 'Visible' })}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                openEditCustomKeywordDialog(tag)
                              }}
                            >
                              {t('debugConfig.editCustomKeyword')}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setDeleteCustomKeywordTargetId(tag.id)
                              }}
                            >
                              {t('debugConfig.deleteCustomKeyword')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('quickStart.workflows', { defaultValue: 'Workflow Seeds' })}</CardTitle>
                <CardDescription>
                  {t('debugConfig.workflowSeedsDescription', {
                    defaultValue: 'Manage CN and MY quick-start presets used by the resume workflow panel.',
                  })}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{workflowSeeds.length}</Badge>
                <Button size="sm" onClick={openAddWorkflowSeedDialog}>
                  {t('debugConfig.addWorkflowSeed', { defaultValue: 'Add Seed' })}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('debugConfig.customKeywordId')}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedLabel', { defaultValue: 'Label' })}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedMarket', { defaultValue: 'Market' })}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedLocation', { defaultValue: 'Location' })}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedKeywords', { defaultValue: 'Keywords' })}</TableHead>
                    <TableHead>{t('debugConfig.workflowSeedStatus', { defaultValue: 'Status' })}</TableHead>
                    <TableHead className="text-right">{t('jdManagement.table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflowSeeds.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {loading ? t('trends.loading') : t('debug.none')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    workflowSeeds.map((seed) => (
                      <TableRow key={seed.id} className={seed.visible === false ? 'opacity-60' : undefined}>
                        <TableCell className="font-mono text-xs">{seed.id}</TableCell>
                        <TableCell className="font-medium">{seed.label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {seed.market}
                          </Badge>
                        </TableCell>
                        <TableCell>{seed.location || '-'}</TableCell>
                        <TableCell className="max-w-[240px] whitespace-normal break-words text-xs text-muted-foreground">
                          {seed.keywords.join(', ')}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={seed.source === 'system' ? 'secondary' : 'outline'} className="w-fit text-xs">
                              {seed.source ?? 'workspace'}
                            </Badge>
                            <Badge variant={seed.visible === false ? 'secondary' : 'default'} className="w-fit text-xs">
                              {seed.visible === false ? 'Hidden' : 'Visible'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                openEditWorkflowSeedDialog(seed)
                              }}
                            >
                              {t('debugConfig.editWorkflowSeed', { defaultValue: 'Edit Seed' })}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setDeleteWorkflowSeedTargetId(seed.id)
                              }}
                            >
                              {t('debugConfig.deleteWorkflowSeed', { defaultValue: 'Delete Seed' })}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        </div>

        <Card className="h-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('debugConfig.brandKeywords')}</CardTitle>
                <CardDescription>{t('debugConfig.brandKeywordsDescription')}</CardDescription>
              </div>
              <Badge variant="secondary">{brandKeywords.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('debugConfig.brandKeywordNameCn')}</TableHead>
                    <TableHead>{t('debugConfig.brandKeywordNameEn')}</TableHead>
                    <TableHead>{t('debugConfig.brandKeywordType')}</TableHead>
                    <TableHead>{t('debugConfig.brandKeywordOrigin')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brandKeywords.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        {loading ? t('trends.loading') : t('debug.none')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    brandKeywords.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.nameCn}</TableCell>
                        <TableCell className="text-muted-foreground">{item.nameEn || '-'}</TableCell>
                        <TableCell className="text-xs">{item.type}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.origin}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={customKeywordDialogOpen} onOpenChange={setCustomKeywordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCustomKeywordId ? t('debugConfig.editCustomKeyword') : t('debugConfig.addCustomKeyword')}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordId')}</p>
              <Input
                value={customKeywordForm.id}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, id: event.target.value }))
                }}
                disabled={Boolean(editingCustomKeywordId)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordKeyword')}</p>
              <Input
                value={customKeywordForm.keyword}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, keyword: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordEnglish')}</p>
              <Input
                value={customKeywordForm.english}
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, english: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordCategory')}</p>
              <Input
                value={customKeywordForm.category}
                list="custom-keyword-category-options"
                onChange={(event) => {
                  setCustomKeywordForm((current) => ({ ...current, category: event.target.value }))
                }}
              />
              <datalist id="custom-keyword-category-options">
                {customKeywordCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordMarkets', { defaultValue: 'Markets' })}</p>
              <div className="flex flex-wrap gap-4">
                {MARKET_OPTIONS.map((option) => {
                  const checked = customKeywordForm.markets.includes(option.value)
                  return (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setCustomKeywordForm((current) => {
                            const nextMarkets = new Set(current.markets)
                            if (nextChecked === true) {
                              nextMarkets.add(option.value)
                            } else {
                              nextMarkets.delete(option.value)
                            }
                            return { ...current, markets: Array.from(nextMarkets) }
                          })
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={customKeywordForm.visible}
                onCheckedChange={(checked) => {
                  setCustomKeywordForm((current) => ({
                    ...current,
                    visible: checked === true,
                  }))
                }}
              />
              <span>{t('debugConfig.workflowSeedVisible', { defaultValue: 'Visible' })}</span>
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCustomKeywordDialogOpen(false)
              }}
              disabled={savingCustomKeyword}
            >
              {t('jdManagement.cancel')}
            </Button>
            <Button
              onClick={() => {
                handleSaveCustomKeyword().catch((error) => {
                  console.error('Unexpected handleSaveCustomKeyword failure', error)
                })
              }}
              disabled={savingCustomKeyword}
            >
              {savingCustomKeyword ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workflowSeedDialogOpen} onOpenChange={setWorkflowSeedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWorkflowSeedId ? t('debugConfig.editWorkflowSeed', { defaultValue: 'Edit Seed' }) : t('debugConfig.addWorkflowSeed', { defaultValue: 'Add Seed' })}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.customKeywordId')}</p>
              <Input
                value={workflowSeedForm.id}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({ ...current, id: event.target.value }))
                }}
                disabled={Boolean(editingWorkflowSeedId)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedLabel', { defaultValue: 'Label' })}</p>
              <Input
                value={workflowSeedForm.label}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({ ...current, label: event.target.value }))
                }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedMarket', { defaultValue: 'Market' })}</p>
              <Select
                value={workflowSeedForm.market}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({
                    ...current,
                    market: event.target.value === 'MY' ? 'MY' : 'CN',
                  }))
                }}
                options={MARKET_OPTIONS}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedLocation', { defaultValue: 'Location' })}</p>
              <Input
                value={workflowSeedForm.location}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({ ...current, location: event.target.value }))
                }}
                placeholder={t('debugConfig.workflowSeedLocationPlaceholder', { defaultValue: 'Optional location' })}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedKeywords', { defaultValue: 'Keywords' })}</p>
              <Input
                value={workflowSeedForm.keywords}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({ ...current, keywords: event.target.value }))
                }}
                placeholder={t('debugConfig.workflowSeedKeywordsPlaceholder', {
                  defaultValue: 'Sales Engineer, Sales Manager',
                })}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedCollectionSource', { defaultValue: 'Collection source' })}</p>
              <Select
                value={workflowSeedForm.collectionSourceType}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({
                    ...current,
                    collectionSourceType: event.target.value === 'seek' ? 'seek' : 'job5156',
                  }))
                }}
                options={[
                  { value: 'job5156', label: 'job5156' },
                  { value: 'seek', label: 'seek' },
                ]}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('debugConfig.workflowSeedCollectUrl', { defaultValue: 'Collect URL' })}</p>
              <Input
                value={workflowSeedForm.collectUrl}
                onChange={(event) => {
                  setWorkflowSeedForm((current) => ({ ...current, collectUrl: event.target.value }))
                }}
                placeholder={t('debugConfig.workflowSeedCollectUrlPlaceholder', {
                  defaultValue: 'Optional base or collect URL',
                })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={workflowSeedForm.visible}
                onCheckedChange={(checked) => {
                  setWorkflowSeedForm((current) => ({
                    ...current,
                    visible: checked === true,
                  }))
                }}
              />
              <span>{t('debugConfig.workflowSeedVisible', { defaultValue: 'Visible' })}</span>
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWorkflowSeedDialogOpen(false)
              }}
              disabled={savingWorkflowSeed}
            >
              {t('jdManagement.cancel')}
            </Button>
            <Button
              onClick={() => {
                handleSaveWorkflowSeed().catch((error) => {
                  console.error('Unexpected handleSaveWorkflowSeed failure', error)
                })
              }}
              disabled={savingWorkflowSeed}
            >
              {savingWorkflowSeed ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteCustomKeywordTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deletingCustomKeyword) {
            setDeleteCustomKeywordTargetId(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (deletingCustomKeyword) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (deletingCustomKeyword) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugConfig.deleteCustomKeyword')}</DialogTitle>
            <DialogDescription>{t('debugConfig.confirmDelete')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteCustomKeywordTargetId(null)}
              disabled={deletingCustomKeyword}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleDeleteCustomKeyword().catch((error) => {
                  console.error('Unexpected handleDeleteCustomKeyword failure', error)
                })
              }}
              disabled={deletingCustomKeyword}
            >
              {t('debugConfig.deleteCustomKeyword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteWorkflowSeedTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deletingWorkflowSeed) {
            setDeleteWorkflowSeedTargetId(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (deletingWorkflowSeed) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event) => {
            if (deletingWorkflowSeed) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('debugConfig.deleteWorkflowSeed', { defaultValue: 'Delete Seed' })}</DialogTitle>
            <DialogDescription>{t('debugConfig.confirmDelete')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteWorkflowSeedTargetId(null)}
              disabled={deletingWorkflowSeed}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                handleDeleteWorkflowSeed().catch((error) => {
                  console.error('Unexpected handleDeleteWorkflowSeed failure', error)
                })
              }}
              disabled={deletingWorkflowSeed}
            >
              {t('debugConfig.deleteWorkflowSeed', { defaultValue: 'Delete Seed' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
