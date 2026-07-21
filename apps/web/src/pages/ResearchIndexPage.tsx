import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { rawApiClient } from '@/lib/api-helpers'
import { useWorkspace } from '@/contexts/WorkspaceContext'

type CompanyHit = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
}

type ShowcaseCompanyCard = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
  kindCounts: Record<string, number>
  signalCount: number
  showcase: boolean
  href: string
}

type ShowcaseResponse = {
  success: boolean
  golden?: ShowcaseCompanyCard[]
  fromResumeDesk?: ShowcaseCompanyCard[]
  pulse?: Array<{ title: string; platform: string; url?: string; capturedAt: number }>
  meta?: {
    lastIngest?: { status?: string; newsInserted?: number; signalsInserted?: number } | null
    showcaseSeedVersion?: string
    seedIngestRunId?: string
  }
}

type SearchResponse = {
  success: boolean
  items?: CompanyHit[]
}

function CompanyCardGrid({
  cards,
  emptyLabel,
}: {
  cards: ShowcaseCompanyCard[]
  emptyLabel: string
}) {
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.companyKey}
          to={card.href}
          data-testid="showcase-company-card"
          data-company-key={card.companyKey}
          className="block rounded-lg border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-slate-50"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{card.displayName}</span>
            {card.showcase ? (
              <Badge variant="secondary" data-testid="showcase-data-badge">
                Showcase data
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{card.companyKey}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="outline">{card.signalCount} signals</Badge>
            {Object.entries(card.kindCounts).map(([kind, count]) => (
              <Badge key={kind} variant="outline" className="text-[10px]">
                {kind}:{count}
              </Badge>
            ))}
          </div>
        </Link>
      ))}
    </div>
  )
}

export function ResearchIndexPage() {
  const { t } = useTranslation()
  const { workspaceSlug } = useWorkspace()
  const teamSlug = workspaceSlug || 'hr'
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CompanyHit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const [showcase, setShowcase] = useState<ShowcaseResponse | null>(null)
  const [showcaseLoading, setShowcaseLoading] = useState(true)
  const [showcaseError, setShowcaseError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [ingesting, setIngesting] = useState(false)

  const loadShowcase = useCallback(async () => {
    setShowcaseLoading(true)
    setShowcaseError(null)
    const { data, error: apiError } = await rawApiClient.GET<ShowcaseResponse>(
      '/api/research/showcase',
    )
    setShowcaseLoading(false)
    if (apiError || !data?.success) {
      setShowcaseError(
        t('research.showcaseLoadError', { defaultValue: 'Failed to load showcase hub' }),
      )
      setShowcase(null)
      return
    }
    setShowcase(data)
  }, [t])

  useEffect(() => {
    void loadShowcase()
  }, [loadShowcase])

  const seedShowcase = useCallback(async () => {
    setSeeding(true)
    try {
      await rawApiClient.POST('/api/research/showcase/seed', { body: {} })
      await loadShowcase()
    } finally {
      setSeeding(false)
    }
  }, [loadShowcase])

  const runIngest = useCallback(async () => {
    setIngesting(true)
    try {
      await rawApiClient.POST('/api/research/ingest/run', { body: {} })
      await loadShowcase()
    } finally {
      setIngesting(false)
    }
  }, [loadShowcase])

  const search = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSearched(true)
    const { data, error: apiError } = await rawApiClient.GET<SearchResponse>(
      '/api/research/companies/search',
      { params: { query: { q: q.trim() } } },
    )
    setLoading(false)
    if (apiError || !data?.success) {
      setError(t('research.searchError', { defaultValue: 'Company search failed' }))
      setItems([])
      return
    }
    setItems(Array.isArray(data.items) ? data.items : [])
  }, [q, t])

  const golden = showcase?.golden ?? []
  const fromDesk = showcase?.fromResumeDesk ?? []
  const pulse = showcase?.pulse ?? []
  const needsSeed =
    !showcaseLoading &&
    golden.every((c) => c.signalCount === 0) &&
    fromDesk.every((c) => c.signalCount === 0)

  return (
    <div className="space-y-6 p-4" data-testid="research-index-page">
      <PageHeader
        title={t('research.indexTitle', { defaultValue: 'Research' })}
        description={t('research.indexDescription', {
          defaultValue: 'Company hiring and market signals for the HR desk.',
        })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={seeding}
          onClick={() => void seedShowcase()}
          data-testid="research-seed-showcase"
        >
          {seeding
            ? t('research.seedingShowcase', { defaultValue: 'Seeding showcase…' })
            : t('research.seedShowcase', { defaultValue: 'Load showcase data' })}
        </Button>
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
            : t('research.runIngest', { defaultValue: 'Run live ingest' })}
        </Button>
        {showcase?.meta?.seedIngestRunId ? (
          <span className="text-xs text-muted-foreground" data-testid="research-seed-meta">
            Seed id: {showcase.meta.seedIngestRunId}
          </span>
        ) : null}
      </div>

      {showcaseError ? (
        <p className="text-sm text-red-600" data-testid="research-showcase-error">
          {showcaseError}
        </p>
      ) : null}

      {needsSeed ? (
        <Card data-testid="research-showcase-empty-cta">
          <CardHeader>
            <CardTitle className="text-base">
              {t('research.showcaseEmptyTitle', { defaultValue: 'No showcase density yet' })}
            </CardTitle>
            <CardDescription>
              {t('research.showcaseEmptyBody', {
                defaultValue:
                  'Live hotlist rarely hits industrial aliases. Load curated showcase companies and multi-kind signals for the HR demo path.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" disabled={seeding} onClick={() => void seedShowcase()}>
              {t('research.seedShowcase', { defaultValue: 'Load showcase data' })}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section data-testid="research-section-golden">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionGolden', { defaultValue: 'Start here' })}
        </h2>
        {showcaseLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <CompanyCardGrid
            cards={golden}
            emptyLabel={t('research.goldenEmpty', { defaultValue: 'No golden companies yet.' })}
          />
        )}
      </section>

      <section data-testid="research-section-resume-desk">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionResumeDesk', { defaultValue: 'From your resume desk' })}
        </h2>
        {showcaseLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <CompanyCardGrid
            cards={fromDesk}
            emptyLabel={t('research.resumeDeskEmpty', {
              defaultValue: 'No resume-desk showcase employers yet.',
            })}
          />
        )}
      </section>

      <section data-testid="research-section-pulse">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionPulse', { defaultValue: 'Market pulse' })}
        </h2>
        {pulse.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('research.pulseEmpty', { defaultValue: 'No recent news items.' })}
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pulse.slice(0, 12).map((item, index) => (
              <li key={`${item.title}-${index}`} data-testid="research-pulse-item">
                <span className="text-xs text-muted-foreground">{item.platform}</span>
                {' · '}
                {item.url ? (
                  <a href={item.url} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="research-section-search">
        <h2 className="mb-2 text-sm font-semibold">
          {t('research.sectionSearch', { defaultValue: 'Search companies' })}
        </h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={t('research.searchPlaceholder', {
              defaultValue: 'Company name, alias, or key…',
            })}
            className="max-w-md"
            data-testid="research-company-search"
          />
          <Button type="submit" disabled={loading} data-testid="research-company-search-submit">
            {loading
              ? t('research.searching', { defaultValue: 'Searching…' })
              : t('research.search', { defaultValue: 'Search' })}
          </Button>
        </form>
        {error ? (
          <p className="mt-2 text-sm text-red-600" data-testid="research-search-error">
            {error}
          </p>
        ) : null}
        {!loading && searched && items.length === 0 && !error ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="research-search-empty">
            {t('research.searchEmpty', {
              defaultValue: 'No companies matched. Seed showcase or try another query.',
            })}
          </p>
        ) : null}
        <ul className="mt-2 space-y-2" data-testid="research-search-results">
          {items.map((item) => (
            <li key={item.companyKey}>
              <Link
                to={`/${teamSlug}/research/${encodeURIComponent(item.companyKey)}?persona=hr`}
                className="text-blue-600 hover:underline"
                data-testid="research-search-result"
              >
                {item.displayName}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {item.companyKey}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default ResearchIndexPage
