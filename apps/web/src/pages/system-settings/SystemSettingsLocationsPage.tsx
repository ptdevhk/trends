import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  parseCustomKeywordsPayload,
  type SystemLocationItem,
  useSettingsRequestJson,
} from '@/pages/system-settings/lib'

export function SystemSettingsLocationsPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [systemLocationItems, setSystemLocationItems] = useState<SystemLocationItem[]>([])
  const [systemLocationQuery, setSystemLocationQuery] = useState('')
  const [savingSystemLocationId, setSavingSystemLocationId] = useState<string | null>(null)

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

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const payload = await requestJson('/api/config/custom-keywords')
      const parsed = parseCustomKeywordsPayload(payload)
      if (!parsed) {
        throw new Error('Invalid custom keywords response')
      }

      setSystemLocationItems(parsed.systemLocations)
    } catch (error) {
      console.error('Failed to load system locations', error)
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

  const handleToggleSystemLocationVisibility = useCallback(async (item: SystemLocationItem) => {
    setSavingSystemLocationId(item.id)

    try {
      await requestJson(`/api/config/custom-keywords/system-locations/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ visible: !item.visible }),
      })
      setSystemLocationItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, visible: !item.visible }
            : entry),
      )
      toast.success(t('debugConfig.saved'))
    } catch (error) {
      console.error('Failed to toggle system location visibility', error)
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
            {t('debugConfig.settingsNavLocations', { defaultValue: 'Locations' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.locationsPageDescription', {
              defaultValue: 'Control which system location chips are visible in the UI.',
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {t('debugConfig.systemLocationConfigTitle', { defaultValue: 'System location config' })}
              </CardTitle>
              <CardDescription>
                {t('debugConfig.systemLocationConfigDescription', {
                  defaultValue: 'Backed by Job5156 location data with per-chip visibility controls.',
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
                  <TableHead>
                    {t('debugConfig.systemLocationKeyword', { defaultValue: 'Location' })}
                  </TableHead>
                  <TableHead>
                    {t('debugConfig.systemLocationLevel', { defaultValue: 'Level' })}
                  </TableHead>
                  <TableHead>
                    {t('debugConfig.systemLocationParent', { defaultValue: 'Parent' })}
                  </TableHead>
                  <TableHead>
                    {t('debugConfig.systemLocationVisible', { defaultValue: 'Status' })}
                  </TableHead>
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
                                  console.error('Unexpected handleToggleSystemLocationVisibility failure', error)
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
    </div>
  )
}
