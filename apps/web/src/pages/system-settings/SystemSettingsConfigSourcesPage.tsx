import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  parseConfigSourceDetailPayload,
  parseConfigSourceGroupsPayload,
  type ConfigSourceDetail,
  type ConfigSourceGroupSummary,
  useSettingsRequestJson,
} from '@/pages/system-settings/lib'
import { reportUiError } from '@/lib/ui-error-reporting'

export function SystemSettingsConfigSourcesPage() {
  const { t } = useTranslation()
  const { requestJson } = useSettingsRequestJson()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [configSourceGroups, setConfigSourceGroups] = useState<ConfigSourceGroupSummary[]>([])
  const [resumeDisplayLimits, setResumeDisplayLimits] = useState<{
    latestWorkHistoryLimit: number
    source: string
  } | null>(null)
  const [selectedConfigSourceKey, setSelectedConfigSourceKey] = useState<string | null>(null)
  const [selectedConfigSourceDetail, setSelectedConfigSourceDetail] = useState<ConfigSourceDetail | null>(null)

  const configSources = useMemo(
    () => configSourceGroups.flatMap((group) => group.sources),
    [configSourceGroups],
  )

  const selectedConfigSourcePreview = useMemo(() => {
    if (!selectedConfigSourceDetail) {
      return ''
    }

    if (typeof selectedConfigSourceDetail.parsedPreview === 'string') {
      return selectedConfigSourceDetail.parsedPreview
    }

    return JSON.stringify(selectedConfigSourceDetail.parsedPreview, null, 2) ?? ''
  }, [selectedConfigSourceDetail])

  const loadConfigSourceDetail = useCallback(async (key: string) => {
    const payload = await requestJson(`/api/config/sources/${encodeURIComponent(key)}`)
    const parsed = parseConfigSourceDetailPayload(payload)
    if (!parsed) {
      throw new Error('Invalid config source detail response')
    }
    return parsed
  }, [requestJson])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      const resumeDisplayLimitsPromise = requestJson('/api/config/resume-display-limits').catch((error) => {
        reportUiError('Failed to load resume display limits', error)
        return null
      })
      const payload = await requestJson('/api/config/source-groups')
      const parsed = parseConfigSourceGroupsPayload(payload)
      if (!parsed) {
        throw new Error('Invalid config source groups response')
      }
      setConfigSourceGroups(parsed)

      const resumeDisplayLimitsPayload = await resumeDisplayLimitsPromise
      if (
        resumeDisplayLimitsPayload
        && typeof resumeDisplayLimitsPayload === 'object'
        && (resumeDisplayLimitsPayload as { success?: unknown }).success === true
        && typeof (resumeDisplayLimitsPayload as { latestWorkHistoryLimit?: unknown }).latestWorkHistoryLimit === 'number'
      ) {
        setResumeDisplayLimits({
          latestWorkHistoryLimit: (resumeDisplayLimitsPayload as { latestWorkHistoryLimit: number }).latestWorkHistoryLimit,
          source: typeof (resumeDisplayLimitsPayload as { source?: unknown }).source === 'string'
            ? (resumeDisplayLimitsPayload as { source: string }).source
            : 'system_settings.resumeWorkHistoryLimit',
        })
      }
    } catch (error) {
      reportUiError('Failed to load config source groups', error)
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

  useEffect(() => {
    const nextSelectedKey = configSources.some((source) => source.key === selectedConfigSourceKey)
      ? selectedConfigSourceKey
      : (configSources[0]?.key ?? null)

    if (nextSelectedKey !== selectedConfigSourceKey) {
      setSelectedConfigSourceKey(nextSelectedKey)
      return
    }

    if (!nextSelectedKey) {
      setSelectedConfigSourceDetail(null)
      return
    }

    let cancelled = false

    loadConfigSourceDetail(nextSelectedKey)
      .then((detail) => {
        if (!cancelled) {
          setSelectedConfigSourceDetail(detail)
        }
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        reportUiError('Failed to load config source detail', error)
        setSelectedConfigSourceDetail(null)
        toast.error(t('debugConfig.configSourcesLoadError'))
      })

    return () => {
      cancelled = true
    }
  }, [configSources, selectedConfigSourceKey, loadConfigSourceDetail, t])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t('debugConfig.settingsNavConfigSources', { defaultValue: 'Config sources' })}</h2>
          <p className="text-sm text-muted-foreground">
            {t('debugConfig.configSourcesPageDescription', {
              defaultValue: 'Inspect read-only prompt and configuration sources.',
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

      {resumeDisplayLimits ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('debugConfig.resumeDisplayLimits', { defaultValue: 'Resume display limits' })}</CardTitle>
            <CardDescription>{t('debugConfig.resumeDisplayLimitsDescription', { defaultValue: 'Read-only limits used by resume presentation logic.' })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">{t('debugConfig.latestWorkHistoryEntries', { defaultValue: 'Latest work history entries' })}</p>
              <p className="text-lg font-semibold">{resumeDisplayLimits.latestWorkHistoryLimit}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('debugConfig.resumeDisplayLimitsSource', { defaultValue: 'Source file' })}</p>
              <p className="font-mono text-xs text-muted-foreground">{resumeDisplayLimits.source}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{t('debugConfig.configSources')}</CardTitle>
              <CardDescription>{t('debugConfig.configSourcesDescription')}</CardDescription>
            </div>
            <Badge variant="secondary">{configSources.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="space-y-4">
              {configSourceGroups.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-muted-foreground">
                  {loading ? t('trends.loading') : t('debug.none')}
                </div>
              ) : (
                configSourceGroups.map((group) => (
                  <div key={group.key} className="rounded-md border">
                    <div className="border-b bg-muted/20 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold">{group.label}</h3>
                          <p className="text-xs text-muted-foreground">{group.description}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-normal">{group.audience}</Badge>
                          <Badge variant="secondary">{group.sources.length}</Badge>
                        </div>
                      </div>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('debugConfig.configSourceLabel')}</TableHead>
                          <TableHead>{t('debugConfig.configSourceType')}</TableHead>
                          <TableHead>{t('debugConfig.configSourcePath')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.sources.map((source) => (
                          <TableRow
                            key={source.key}
                            className={selectedConfigSourceKey === source.key ? 'bg-muted/50' : undefined}
                          >
                            <TableCell>
                              <button
                                type="button"
                                className="space-y-1 text-left"
                                onClick={() => setSelectedConfigSourceKey(source.key)}
                              >
                                <div className="font-medium">{source.label}</div>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="font-normal">{t('debugConfig.readOnly')}</Badge>
                                  {source.metadata?.locale && (
                                    <Badge variant="secondary" className="font-normal">{source.metadata.locale}</Badge>
                                  )}
                                  {source.metadata?.version !== undefined && (
                                    <span>{t('debugConfig.configSourceVersion', { version: source.metadata.version })}</span>
                                  )}
                                </div>
                                {source.parseError && (
                                  <p className="text-xs text-destructive">{source.parseError}</p>
                                )}
                              </button>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{source.type}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{source.relativePath}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-4">
              {!selectedConfigSourceDetail ? (
                <div className="rounded-md border p-6 text-sm text-muted-foreground">
                  {loading ? t('trends.loading') : t('debug.none')}
                </div>
              ) : (
                <>
                  <div className="rounded-md border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold">{selectedConfigSourceDetail.label}</h3>
                        <p className="font-mono text-xs text-muted-foreground">{selectedConfigSourceDetail.relativePath}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{t('debugConfig.readOnly')}</Badge>
                        <Badge variant="secondary">{selectedConfigSourceDetail.type}</Badge>
                        <Badge variant="outline">{selectedConfigSourceDetail.group}</Badge>
                        <Badge variant="outline">{selectedConfigSourceDetail.audience}</Badge>
                        {selectedConfigSourceDetail.metadata?.locale && (
                          <Badge variant="secondary">{selectedConfigSourceDetail.metadata.locale}</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourcePath')}</p>
                        <p className="font-mono text-xs">{selectedConfigSourceDetail.relativePath}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourceType')}</p>
                        <p className="font-medium">{selectedConfigSourceDetail.type}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Group</p>
                        <p className="font-medium">{selectedConfigSourceDetail.group}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Audience</p>
                        <p className="font-medium">{selectedConfigSourceDetail.audience}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourceVersionLabel')}</p>
                        <p className="font-medium">{selectedConfigSourceDetail.metadata?.version ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourceUpdatedAt')}</p>
                        <p className="font-medium">{selectedConfigSourceDetail.metadata?.updatedAt ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourceRequestedLocale')}</p>
                        <p className="font-medium">{selectedConfigSourceDetail.metadata?.requestedLocale ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('debugConfig.configSourceResolvedLocale')}</p>
                        <p className="font-medium">{selectedConfigSourceDetail.metadata?.resolvedSourceLocale ?? '-'}</p>
                      </div>
                    </div>

                    {selectedConfigSourceDetail.metadata?.description && (
                      <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                        {selectedConfigSourceDetail.metadata.description}
                      </div>
                    )}

                    {selectedConfigSourceDetail.metadata?.fallbackToZhHans !== undefined && (
                      <div className="mt-3">
                        <Badge variant={selectedConfigSourceDetail.metadata.fallbackToZhHans ? 'secondary' : 'outline'}>
                          {selectedConfigSourceDetail.metadata.fallbackToZhHans
                            ? t('debugConfig.configSourceFallbackEnabled')
                            : t('debugConfig.configSourceFallbackDisabled')}
                        </Badge>
                      </div>
                    )}

                    {selectedConfigSourceDetail.parseError && (
                      <p className="mt-4 rounded border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                        {selectedConfigSourceDetail.parseError}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t('debugConfig.configSourceRaw')}</p>
                      <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-5">
                        <code>{selectedConfigSourceDetail.rawSource}</code>
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t('debugConfig.configSourceParsedPreview')}</p>
                      <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-5">
                        <code>{selectedConfigSourcePreview}</code>
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
