import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { reportUiError } from '@/lib/ui-error-reporting'
import {
  createEmptyCustomKeywordForm,
  customKeywordToForm,
  parseBrandKeywordsPayload,
  parseCustomKeywordsPayload,
  type BrandKeywordItem,
  type CustomKeywordCategory,
  type CustomKeywordFormState,
  type CustomKeywordTag,
  type KeywordMarket,
  type SystemLocationItem,
  useSettingsRequestJson,
} from '@/pages/system-settings/lib'

const MARKET_OPTIONS: Array<{ value: KeywordMarket; label: string }> = [
  { value: 'CN', label: 'CN' },
  { value: 'MY', label: 'MY' },
]

export function SettingsKeywordsPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customKeywordTags, setCustomKeywordTags] = useState<CustomKeywordTag[]>([])
  const [customKeywordCategories, setCustomKeywordCategories] = useState<CustomKeywordCategory[]>([])
  const [systemLocationItems, setSystemLocationItems] = useState<SystemLocationItem[]>([])
  const [systemLocationQuery, setSystemLocationQuery] = useState('')
  const [savingSystemLocationId, setSavingSystemLocationId] = useState<string | null>(null)
  const [brandKeywords, setBrandKeywords] = useState<BrandKeywordItem[]>([])
  const [customKeywordDialogOpen, setCustomKeywordDialogOpen] = useState(false)
  const [editingCustomKeywordId, setEditingCustomKeywordId] = useState<string | null>(null)
  const [customKeywordForm, setCustomKeywordForm] = useState<CustomKeywordFormState>(createEmptyCustomKeywordForm)
  const [savingCustomKeyword, setSavingCustomKeyword] = useState(false)
  const [deleteCustomKeywordTargetId, setDeleteCustomKeywordTargetId] = useState<string | null>(null)
  const [deletingCustomKeyword, setDeletingCustomKeyword] = useState(false)

  const visibleSystemLocationCount = useMemo(
    () => systemLocationItems.filter((item) => item.visible).length,
    [systemLocationItems],
  )

  const filteredSystemLocationItems = useMemo(() => {
    const query = systemLocationQuery.trim().toLowerCase()

    return [...systemLocationItems]
      .filter((item) => {
        if (!query) {
          return true
        }

        const keyword = item.keyword.toLowerCase()
        const parent = item.parentKeyword?.toLowerCase() ?? ''
        const level = item.level.toLowerCase()
        return keyword.includes(query) || parent.includes(query) || level.includes(query)
      })
      .sort((left, right) => {
        if (left.visible !== right.visible) {
          return left.visible ? -1 : 1
        }
        if (left.level !== right.level) {
          return left.level === 'province' ? -1 : 1
        }
        return left.keyword.localeCompare(right.keyword, 'zh-Hans-CN')
      })
  }, [systemLocationItems, systemLocationQuery])

  const loadSearchSetupConfig = useCallback(async () => {
    const payload = await requestJson('/api/config/custom-keywords')
    const parsed = parseCustomKeywordsPayload(payload)
    if (!parsed) {
      throw new Error('Invalid custom keywords response')
    }

    setCustomKeywordTags(parsed.tags)
    setCustomKeywordCategories(parsed.categories)
    setSystemLocationItems(parsed.systemLocations)
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
      await Promise.all([loadSearchSetupConfig(), loadBrandKeywords()])
    } catch (error) {
      reportUiError('Failed to load search setup settings', error)
      setLoadError(t('resumes.error'))
    } finally {
      setLoading(false)
    }
  }, [loadBrandKeywords, loadSearchSetupConfig, t])

  useEffect(() => {
    loadData().catch((error) => {
      reportUiError('Unexpected loadData failure', error)
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

      await loadSearchSetupConfig()
      setCustomKeywordDialogOpen(false)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to save custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingCustomKeyword(false)
    }
  }, [buildCustomKeywordFromForm, editingCustomKeywordId, loadSearchSetupConfig, requestJson, t])

  const handleDeleteCustomKeyword = useCallback(async () => {
    if (!deleteCustomKeywordTargetId) {
      return
    }

    setDeletingCustomKeyword(true)
    try {
      await requestJson(`/api/config/custom-keywords/${encodeURIComponent(deleteCustomKeywordTargetId)}`, {
        method: 'DELETE',
      })
      await loadSearchSetupConfig()
      setDeleteCustomKeywordTargetId(null)
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to delete custom keyword', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setDeletingCustomKeyword(false)
    }
  }, [deleteCustomKeywordTargetId, loadSearchSetupConfig, requestJson, t])

  const handleToggleSystemLocationVisibility = useCallback(async (item: SystemLocationItem) => {
    setSavingSystemLocationId(item.id)

    try {
      await requestJson(`/api/config/custom-keywords/system-locations/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ visible: !item.visible }),
      })
      setSystemLocationItems((current) =>
        current.map((entry) => (
          entry.id === item.id
            ? { ...entry, visible: !item.visible }
            : entry
        )),
      )
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      reportUiError('Failed to toggle system location visibility', error)
      toast.error(t('debugConfig.saveError'))
    } finally {
      setSavingSystemLocationId(null)
    }
  }, [requestJson, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('settings.searchSetup.title', { defaultValue: 'Search setup' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('settings.searchSetup.description', {
              defaultValue: 'Configure the workspace keywords and location visibility that steer candidate discovery.',
            })}
          </p>
        </div>
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
                  <CardDescription>
                    {t('debugConfig.customKeywordsDescription', {
                      defaultValue: 'Add or adjust workspace keywords that shape the candidate pool.',
                    })}
                  </CardDescription>
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
                  <CardTitle>
                    {t('settings.searchSetup.locationsTitle', { defaultValue: 'Locations' })}
                  </CardTitle>
                  <CardDescription>
                    {t('settings.searchSetup.locationsDescription', {
                      defaultValue: 'Choose which location chips stay visible for workspace search and onboarding.',
                    })}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{visibleSystemLocationCount}/{systemLocationItems.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={systemLocationQuery}
                onChange={(event) => setSystemLocationQuery(event.target.value)}
                placeholder={t('debugConfig.systemLocationSearchPlaceholder', {
                  defaultValue: 'Search locations by name, parent, or level',
                })}
              />
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('debugConfig.systemLocationKeyword', { defaultValue: 'Location' })}</TableHead>
                      <TableHead>{t('debugConfig.systemLocationLevel', { defaultValue: 'Level' })}</TableHead>
                      <TableHead>{t('debugConfig.systemLocationParent', { defaultValue: 'Parent' })}</TableHead>
                      <TableHead>{t('debugConfig.systemLocationVisible', { defaultValue: 'Status' })}</TableHead>
                      <TableHead className="text-right">{t('jdManagement.table.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSystemLocationItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          {loading ? t('trends.loading') : t('debug.none')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSystemLocationItems.map((item) => {
                        const isSaving = savingSystemLocationId === item.id

                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">{item.keyword}</TableCell>
                            <TableCell>
                              {item.level === 'province'
                                ? t('debugConfig.systemLocationProvince', { defaultValue: 'Province' })
                                : t('debugConfig.systemLocationCity', { defaultValue: 'City' })}
                            </TableCell>
                            <TableCell>{item.parentKeyword || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={item.visible ? 'default' : 'secondary'}>
                                {item.visible
                                  ? t('debugConfig.systemLocationVisibleShown', { defaultValue: 'Visible' })
                                  : t('debugConfig.systemLocationVisibleHidden', { defaultValue: 'Hidden' })}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end">
                                <Button
                                  variant={item.visible ? 'outline' : 'default'}
                                  size="sm"
                                  disabled={isSaving}
                                  onClick={() => {
                                    handleToggleSystemLocationVisibility(item).catch((error) => {
                                      reportUiError('Unexpected handleToggleSystemLocationVisibility failure', error)
                                    })
                                  }}
                                >
                                  {isSaving
                                    ? `${t('debugConfig.save')}...`
                                    : item.visible
                                      ? t('debugConfig.systemLocationHideAction', { defaultValue: 'Hide' })
                                      : t('debugConfig.systemLocationShowAction', { defaultValue: 'Show' })}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
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
                  <CardTitle>{t('quickStart.workflows', { defaultValue: 'Landing quick starts / Search Profiles' })}</CardTitle>
                  <CardDescription>
                    {t('settings.searchSetup.profilesDescription', {
                      defaultValue: 'Use Search Profiles for richer saved configurations after the initial keyword and location setup is in place.',
                    })}
                  </CardDescription>
                </div>
                <Link
                  className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                  to={`/${slug}/settings/profiles`}
                >
                  {t('searchProfiles.title', { defaultValue: 'Open Search Profiles' })}
                </Link>
              </div>
            </CardHeader>
          </Card>
        </div>

        <Card className="h-full">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{t('debugConfig.brandKeywords')}</CardTitle>
                <CardDescription>
                  {t('settings.searchSetup.brandKeywordsDescription', {
                    defaultValue: 'Read-only brand reference data to help members align custom search keywords.',
                  })}
                </CardDescription>
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
                        onCheckedChange={(nextChecked: boolean | 'indeterminate') => {
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
                onCheckedChange={(checked: boolean | 'indeterminate') => {
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
                  reportUiError('Unexpected handleSaveCustomKeyword failure', error)
                })
              }}
              disabled={savingCustomKeyword}
            >
              {savingCustomKeyword ? `${t('debugConfig.save')}...` : t('debugConfig.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteCustomKeywordTargetId !== null}
        onOpenChange={(open: boolean) => {
          if (!open && !deletingCustomKeyword) {
            setDeleteCustomKeywordTargetId(null)
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event: { preventDefault: () => void }) => {
            if (deletingCustomKeyword) {
              event.preventDefault()
            }
          }}
          onPointerDownOutside={(event: { preventDefault: () => void }) => {
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
                  reportUiError('Unexpected handleDeleteCustomKeyword failure', error)
                })
              }}
              disabled={deletingCustomKeyword}
            >
              {t('debugConfig.deleteCustomKeyword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
