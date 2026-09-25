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
 * Research monitoring settings — `/hr/settings/research`.
 * Legacy `/hr/research/settings` redirects here. Reuses ResearchSettingsPanel
 * (CNC keyword tree + platforms + news sources) independent of the hub pulse fetch.
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
    void loadKeywords()
    void loadPlatforms()
    void loadNewsSources()
  }, [loadKeywords, loadPlatforms, loadNewsSources])

  return (
    <div className="space-y-6" data-testid="research-settings-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">
            {t('research.settings.pageTitle', { defaultValue: '行业研究 / 监控设置' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('settings.research.nav', { defaultValue: '研究监控' })}
            {saving ? ' · …' : ''}
          </p>
        </div>
        <Button asChild type="button" variant="outline" size="sm">
          <Link to={`/${teamSlug}/research`} data-testid="research-settings-back">
            {t('research.settings.backToWorkflow', { defaultValue: '‹ 返回每日销售工作流' })}
          </Link>
        </Button>
      </div>

      <nav className="sr-only" data-testid="research-settings-tabs">
        <span data-testid="research-settings-tab-config">
          {t('research.settings.tabConfig', { defaultValue: '⚙ 监控设置' })}
        </span>
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
    </div>
  )
}

export default ResearchSettingsPage
