import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { normalizeResearchPersona, type ResearchPersona } from '@trends/shared'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  CompanyResearchPanel,
  type ResearchSignalView,
} from '@/components/research/CompanyResearchPanel'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { upsertResearchRecentCompany } from '@/lib/research-recent-companies'
import {
  isCompanyOnOpenRefreshEnabled,
  readLastCompanyRefreshAt,
  shouldAutoRefreshCompany,
  writeLastCompanyRefreshAt,
} from '@/lib/research-company-refresh'

type SignalsResponse = {
  success: boolean
  persona?: string
  items?: ResearchSignalView[]
  meta?: {
    liveCount: number
    showcaseCount: number
    liveFirst?: boolean
  }
}

type LatestIngestResponse = {
  success: boolean
  run?: {
    runId?: string
    status?: string
    finishedAt?: number
    newsInserted?: number
    signalsInserted?: number
    unresolvedMentions?: number
    error?: string
  } | null
}

type CompanyMeta = {
  companyKey: string
  nameCn?: string
  nameEn?: string
  displayName: string
  type?: string
  source?: string
}

type IndustryResolveResponse = {
  success: boolean
  hit?: {
    companyKey: string
    nameCn: string
    nameEn?: string
    displayName: string
    matchTier?: string
    entityId?: string
    source?: string
  } | null
}

type SearchResponse = {
  success: boolean
  items?: Array<{
    companyKey: string
    displayName: string
    nameCn?: string
    nameEn?: string
  }>
}

type IndustryBrowseResponse = {
  success: boolean
  items?: Array<{
    companyKey: string
    nameCn: string
    nameEn?: string
    displayName: string
    type?: string
  }>
}

function metaFromHit(hit: {
  companyKey: string
  nameCn?: string
  nameEn?: string
  displayName: string
  type?: string
  source?: string
}): CompanyMeta {
  return {
    companyKey: hit.companyKey,
    displayName: hit.displayName,
    ...(hit.nameCn ? { nameCn: hit.nameCn } : {}),
    ...(hit.nameEn ? { nameEn: hit.nameEn } : {}),
    ...(hit.type ? { type: hit.type } : {}),
    ...(hit.source ? { source: hit.source } : {}),
  }
}

export function ResearchCompanyPage() {
  const { t } = useTranslation()
  const { companyKey: companyKeyParam } = useParams()
  const { slug } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()
  const companyKey = decodeURIComponent(companyKeyParam ?? '').trim()
  const persona = normalizeResearchPersona(searchParams.get('persona'))
  const selectedKinds = useMemo(() => {
    const raw = searchParams.get('kinds')
    if (!raw) {
      return [] as string[]
    }
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }, [searchParams])

  const [signals, setSignals] = useState<ResearchSignalView[]>([])
  const [signalsMeta, setSignalsMeta] = useState<SignalsResponse['meta'] | null>(null)
  const [companyMeta, setCompanyMeta] = useState<CompanyMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [latestRun, setLatestRun] = useState<LatestIngestResponse['run']>(null)
  const [ingesting, setIngesting] = useState(false)

  const setPersona = useCallback(
    (next: ResearchPersona) => {
      const params = new URLSearchParams(searchParams)
      params.set('persona', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setSelectedKinds = useCallback(
    (kinds: string[]) => {
      const params = new URLSearchParams(searchParams)
      if (kinds.length === 0) {
        params.delete('kinds')
      } else {
        params.set('kinds', kinds.join(','))
      }
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const loadCompanyMeta = useCallback(async () => {
    if (!companyKey) {
      setCompanyMeta(null)
      return
    }

    // Prefer industry resolve (nameCn-first brands + overrides), then search, then industry browse by key.
    const resolve = await rawApiClient.GET<IndustryResolveResponse>(
      '/api/research/industry/resolve',
      { params: { query: { q: companyKey } } },
    )
    if (resolve.data?.success && resolve.data.hit?.companyKey) {
      setCompanyMeta(metaFromHit(resolve.data.hit))
      return
    }

    const search = await rawApiClient.GET<SearchResponse>('/api/research/companies/search', {
      params: { query: { q: companyKey } },
    })
    const exact = (search.data?.items ?? []).find((item) => item.companyKey === companyKey)
    if (exact) {
      setCompanyMeta(
        metaFromHit({
          companyKey: exact.companyKey,
          displayName: exact.displayName,
          nameCn: exact.nameCn,
          nameEn: exact.nameEn,
          source: 'search',
        }),
      )
      return
    }

    const industry = await rawApiClient.GET<IndustryBrowseResponse>('/api/research/industry', {
      params: { query: { q: companyKey, limit: 20 } },
    })
    const industryHit = (industry.data?.items ?? []).find((item) => item.companyKey === companyKey)
    if (industryHit) {
      setCompanyMeta(
        metaFromHit({
          companyKey: industryHit.companyKey,
          displayName: industryHit.displayName,
          nameCn: industryHit.nameCn,
          nameEn: industryHit.nameEn,
          type: industryHit.type,
          source: 'industry',
        }),
      )
      return
    }

    setCompanyMeta({
      companyKey,
      displayName: companyKey,
    })
  }, [companyKey])

  const loadSignals = useCallback(async () => {
    if (!companyKey) {
      setLoading(false)
      setError(t('research.missingCompany', { defaultValue: 'Missing company key' }))
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await rawApiClient.GET<SignalsResponse>(
      `/api/research/companies/${encodeURIComponent(companyKey)}/signals`,
      { params: { query: { persona } } },
    )
    if (apiError || !data?.success) {
      setError(
        t('research.loadError', {
          defaultValue: 'Failed to load research signals',
        }),
      )
      setSignals([])
      setSignalsMeta(null)
      setLoading(false)
      return
    }
    setSignals(Array.isArray(data.items) ? data.items : [])
    setSignalsMeta(data.meta ?? null)
    setLoading(false)
  }, [companyKey, persona, t])

  const loadLatest = useCallback(async () => {
    const { data } = await rawApiClient.GET<LatestIngestResponse>('/api/research/ingest/latest')
    if (data?.success) {
      setLatestRun(data.run ?? null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.all([loadSignals(), loadCompanyMeta()])
      if (!cancelled) {
        await loadLatest()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadSignals, loadCompanyMeta, loadLatest])

  useEffect(() => {
    if (!companyKey) return
    const nameCn = companyMeta?.nameCn || companyMeta?.displayName || companyKey
    upsertResearchRecentCompany({
      companyKey,
      nameCn,
      ...(companyMeta?.nameEn ? { nameEn: companyMeta.nameEn } : {}),
    })
  }, [companyKey, companyMeta])

  const runIngest = useCallback(async () => {
    setIngesting(true)
    try {
      await rawApiClient.POST('/api/research/ingest/run', { body: {} })
      await loadSignals()
      await loadLatest()
    } finally {
      setIngesting(false)
    }
  }, [loadLatest, loadSignals])

  // Phase C: optional background refresh after first paint (never blocks initial load).
  useEffect(() => {
    if (!companyKey || loading) return
    const enabled = isCompanyOnOpenRefreshEnabled()
    const now = Date.now()
    const last = readLastCompanyRefreshAt(companyKey)
    if (
      !shouldAutoRefreshCompany({
        enabled,
        companyKey,
        now,
        lastRefreshAt: last,
      })
    ) {
      return
    }
    let cancelled = false
    writeLastCompanyRefreshAt(companyKey, now)
    void (async () => {
      try {
        await rawApiClient.POST('/api/research/ingest/run', { body: {} })
        if (!cancelled) {
          await loadSignals()
          await loadLatest()
        }
      } catch {
        /* soft-fail: keep painted rows */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyKey, loading, loadSignals, loadLatest])

  const teamSlug = slug || 'hr'
  const pageTitle =
    companyMeta?.nameCn ||
    companyMeta?.displayName ||
    companyKey ||
    t('research.pageTitle', { defaultValue: 'Research' })
  const pageDescription = [
    companyMeta?.nameEn,
    companyKey || null,
    companyMeta?.type,
  ]
    .filter(Boolean)
    .join(' · ')

  const latestSummary =
    latestRun == null
      ? null
      : t('research.latestIngestSummary', {
          defaultValue: 'Last ingest: {{status}} · news +{{news}} · signals +{{signals}}',
          status: latestRun.status ?? 'unknown',
          news: latestRun.newsInserted ?? 0,
          signals: latestRun.signalsInserted ?? 0,
        })

  return (
    <div className="space-y-4 p-4" data-testid="research-company-page">
      <PageHeader title={pageTitle} description={pageDescription || undefined} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          to={`/${teamSlug}/research`}
          className="text-blue-600 hover:underline"
          data-testid="research-back-to-index"
        >
          {t('research.backToIndex', { defaultValue: '返回研究首页' })}
        </Link>
        <Link
          to={`/${teamSlug}/settings/policies?tab=companies`}
          className="text-blue-600 hover:underline"
          data-testid="research-back-to-policies"
        >
          {t('research.backToPolicies', { defaultValue: '企业策略' })}
        </Link>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={ingesting}
          onClick={() => void runIngest()}
          data-testid="research-run-ingest"
        >
          {ingesting
            ? t('research.ingesting', { defaultValue: '正在抓取…' })
            : t('research.runIngest', { defaultValue: '运行抓取' })}
        </Button>
      </div>
      {latestSummary ? (
        <p className="text-xs text-muted-foreground" data-testid="research-latest-ingest">
          {latestSummary}
        </p>
      ) : null}
      <CompanyResearchPanel
        companyKey={companyKey || '—'}
        companyName={companyMeta?.nameCn || companyMeta?.displayName}
        nameEn={companyMeta?.nameEn}
        companyType={companyMeta?.type}
        signals={signals}
        meta={signalsMeta}
        persona={persona}
        onPersonaChange={setPersona}
        selectedKinds={selectedKinds}
        onSelectedKindsChange={setSelectedKinds}
        loading={loading}
        error={error}
        teamSlug={teamSlug}
        emptyExtra={(
          <Button
            type="button"
            size="sm"
            disabled={ingesting}
            onClick={() => void runIngest()}
            data-testid="research-run-ingest-empty"
          >
            {t('research.runIngestCta', { defaultValue: '运行抓取以获取信号' })}
          </Button>
        )}
      />
    </div>
  )
}

export default ResearchCompanyPage
