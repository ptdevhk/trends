import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { rawApiClient } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { ResearchSettingsPanel } from '@/components/research/ResearchSettingsPanel'
import type { PulseKeywordsDialogState } from '@/components/research/PulseKeywordsDialog'
import type { HotlistPlatformsDialogState } from '@/components/research/HotlistPlatformsDialog'
import type { NewsSourcesDialogState } from '@/components/research/NewsSourcesDialog'

type PulseKeywordsResponse = PulseKeywordsDialogState & { success: boolean }
type HotlistPlatformsResponse = HotlistPlatformsDialogState & { success: boolean }
type NewsSourcesResponse = NewsSourcesDialogState & { success: boolean }

/**
 * V1 · 独立配置页 — /hr/research/settings.
 * Mounts the same ResearchSettingsPanel the hub used to inline, but as a full
 * page with its own state loaders (keywords / platforms / news-sources) so it
 * can be reached via the right-top ⚙ 配置 tab and from anywhere, independent
 * of the hub's pulse fetch. ‹ 返回主页 links back to /hr/research.
 */
export function ResearchSettingsPage() {
  const { t } = useTranslation()
  const { slug } = useWorkspace()
  const teamSlug = slug || 'hr'

  const [keywordsState, setKeywordsState] = useState<PulseKeywordsDialogState | null>(null)
  const [platformsState, setPlatformsState] = useState<HotlistPlatformsDialogState | null>(null)
  const [newsSourcesState, setNewsSourcesState] = useState<NewsSourcesDialogState | null>(null)
  const [saving, setSaving] = useState(false)

  const loadKeywords = useCallback(async () => {
    const { data, error } = await rawApiClient.GET<PulseKeywordsResponse>(
      '/api/research/pulse/keywords',
    )
    if (!error && data?.success && data.seed && data.workspace && Array.isArray(data.effective)) {
      setKeywordsState({
        seed: data.seed,
        workspace: data.workspace,
        effective: data.effective,
      })
    }
  }, [])

  const loadPlatforms = useCallback(async () => {
    const { data, error } = await rawApiClient.GET<HotlistPlatformsResponse>(
      '/api/research/platforms',
    )
    if (!error && data?.success && data.seed && Array.isArray(data.effective)) {
      setPlatformsState({
        seed: data.seed,
        workspace: data.workspace ?? { version: 1, enabled: [], excluded: [] },
        effective: data.effective,
      })
    }
  }, [])

  const loadNewsSources = useCallback(async () => {
    const { data, error } = await rawApiClient.GET<NewsSourcesResponse>(
      '/api/research/news-sources',
    )
    if (!error && data?.success && data.seed && Array.isArray(data.effective)) {
      setNewsSourcesState({
        seed: data.seed,
        workspace:
          data.workspace ?? {
            version: 1,
            excludedGroups: [],
            excludedFeeds: [],
            enabledFeeds: [],
          },
        effective: data.effective,
      })
    }
  }, [])

  useEffect(() => {
    void loadKeywords()
    void loadPlatforms()
    void loadNewsSources()
  }, [loadKeywords, loadPlatforms, loadNewsSources])

  const handleSaveKeywords = useCallback(
    async (body: { enabled: string[]; excluded: string[]; custom: string[] }) => {
      setSaving(true)
      try {
        const { data, error } = await rawApiClient.PUT<PulseKeywordsResponse>(
          '/api/research/pulse/keywords',
          { body },
        )
        if (!error && data?.success) {
          setKeywordsState({ seed: data.seed, workspace: data.workspace, effective: data.effective })
        }
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const handleSavePlatforms = useCallback(
    async (body: { enabled: string[]; excluded: string[] }) => {
      setSaving(true)
      try {
        const { data, error } = await rawApiClient.PUT<HotlistPlatformsResponse>(
          '/api/research/platforms',
          { body },
        )
        if (!error && data?.success) {
          setPlatformsState({ seed: data.seed, workspace: data.workspace, effective: data.effective })
        }
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const handleSaveNewsSources = useCallback(
    async (body: {
      masterEnabled?: boolean
      excludedGroups: string[]
      excludedFeeds: string[]
      enabledFeeds: string[]
    }) => {
      setSaving(true)
      try {
        const { data, error } = await rawApiClient.PUT<NewsSourcesResponse>(
          '/api/research/news-sources',
          { body },
        )
        if (!error && data?.success) {
          setNewsSourcesState({ seed: data.seed, workspace: data.workspace, effective: data.effective })
        }
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const restoreDefaults = useCallback(() => {
    // Re-seed the panel's local state from the seed defaults by reloading.
    void loadKeywords()
    void loadPlatforms()
    void loadNewsSources()
  }, [loadKeywords, loadPlatforms, loadNewsSources])

  return (
    <div className="space-y-6 p-3 sm:p-4" data-testid="research-settings-page">
      <nav
        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
        data-testid="research-settings-tabs"
      >
        <Link
          to={`/${teamSlug}/research`}
          className="rounded-md border border-slate-200 px-3 py-1 text-sm text-gray-600 hover:border-blue-300"
          data-testid="research-settings-back"
        >
          {t('research.settings.back', { defaultValue: '‹ 返回主页' })}
        </Link>
        <span className="ml-2 rounded-md bg-blue-600 px-3 py-1 text-sm font-semibold text-white" data-testid="research-settings-tab-config">
          {t('research.settings.tabConfig', { defaultValue: '⚙ 监控设置' })}
        </span>
        <span className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-600">
          {t('research.settings.tabHarvest', { defaultValue: '🎙 采收' })}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">{saving ? '⏳' : ''}</span>
      </nav>

      <ResearchSettingsPanel
        realtimeItems={[]}
        realtimeLoading={false}
        keywords={keywordsState}
        platforms={platformsState}
        newsSources={newsSourcesState}
        onSaveKeywords={handleSaveKeywords}
        onSavePlatforms={handleSavePlatforms}
        onSaveNewsSources={handleSaveNewsSources}
        onRestoreDefaults={restoreDefaults}
      />

      <Button asChild type="button" variant="outline" size="sm">
        <Link to={`/${teamSlug}/research`}>{t('research.settings.back', { defaultValue: '‹ 返回主页' })}</Link>
      </Button>
    </div>
  )
}

export default ResearchSettingsPage
