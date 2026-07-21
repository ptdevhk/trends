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

type SignalsResponse = {
  success: boolean
  persona?: string
  items?: ResearchSignalView[]
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

export function ResearchCompanyPage() {
  const { t } = useTranslation()
  const { companyKey: companyKeyParam } = useParams()
  const { workspaceSlug } = useWorkspace()
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
      setLoading(false)
      return
    }
    setSignals(Array.isArray(data.items) ? data.items : [])
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
      await loadSignals()
      if (!cancelled) {
        await loadLatest()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadSignals, loadLatest])

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

  const teamSlug = workspaceSlug || 'hr'

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
      <PageHeader
        title={t('research.pageTitle', { defaultValue: 'Research' })}
        description={companyKey || undefined}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          to={`/${teamSlug}/research`}
          className="text-blue-600 hover:underline"
          data-testid="research-back-to-index"
        >
          {t('research.backToIndex', { defaultValue: 'Company search' })}
        </Link>
        <Link
          to={`/${teamSlug}/settings/policies?tab=companies`}
          className="text-blue-600 hover:underline"
          data-testid="research-back-to-policies"
        >
          {t('research.backToPolicies', { defaultValue: 'Company policies' })}
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
            ? t('research.ingesting', { defaultValue: 'Running ingest…' })
            : t('research.runIngest', { defaultValue: 'Run ingest' })}
        </Button>
      </div>
      {latestSummary ? (
        <p className="text-xs text-muted-foreground" data-testid="research-latest-ingest">
          {latestSummary}
        </p>
      ) : null}
      <CompanyResearchPanel
        companyKey={companyKey || '—'}
        signals={signals}
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
            {t('research.runIngestCta', { defaultValue: 'Run ingest to fetch signals' })}
          </Button>
        )}
      />
    </div>
  )
}

export default ResearchCompanyPage
