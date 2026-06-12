import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Clock, Search } from 'lucide-react'

import { rawApiClient } from '@/lib/api-helpers'

type PublicShareResult = {
  resumeKey: string
  displayName?: string
  headline?: string
  location?: string
  summary?: string
  score?: number
  recommendation?: string
  highlights?: string[]
  concerns?: string[]
  skills?: string[]
}

type PublicShareResponse = {
  success: boolean
  share?: {
    id: string
    title?: string
    description?: string
    createdAt: string
    expiresAt?: string
    snapshot: {
      id: string
      scoringMode: string
      promptVersion: string
      skillConfigVersion: string
      modelProvider: string
      modelName: string
      payload: {
        title?: string
        search?: {
          query?: string
          filters?: Record<string, unknown>
        }
        results: PublicShareResult[]
      }
    }
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; share: NonNullable<PublicShareResponse['share']> }
  | { status: 'unavailable' }
  | { status: 'not-found' }
  | { status: 'error' }

function formatDate(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(', ')
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

function EmptyPublicShareState({ title, description }: { title: string; description: string }) {
  return (
    <section className="mx-auto flex min-h-[55vh] max-w-xl flex-col justify-center gap-6 py-12">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
        <AlertTriangle className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </section>
  )
}

export function PublicSharePage() {
  const { token } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!token) {
      setState({ status: 'not-found' })
      return
    }

    const publicToken = token
    let active = true

    async function loadPublicShare() {
      setState({ status: 'loading' })
      const { data, error, response } = await rawApiClient.GET<PublicShareResponse>(
        `/api/public-shares/${encodeURIComponent(publicToken)}`
      )
      if (!active) {
        return
      }
      if (data?.success && data.share) {
        setState({ status: 'ready', share: data.share })
        return
      }
      if (response?.status === 410) {
        setState({ status: 'unavailable' })
        return
      }
      if (response?.status === 404) {
        setState({ status: 'not-found' })
        return
      }
      if (error) {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'not-found' })
    }

    void loadPublicShare()

    return () => {
      active = false
    }
  }, [token])

  if (state.status === 'loading') {
    return <div className="py-6 text-sm text-muted-foreground">Loading...</div>
  }

  if (state.status === 'unavailable') {
    return (
      <EmptyPublicShareState
        title="Public share unavailable"
        description="This snapshot link has expired or was revoked."
      />
    )
  }

  if (state.status === 'error') {
    return (
      <EmptyPublicShareState
        title="Public share unavailable"
        description="The snapshot could not be loaded."
      />
    )
  }

  if (state.status === 'not-found') {
    return (
      <EmptyPublicShareState
        title="Public share not found"
        description="The snapshot link does not exist."
      />
    )
  }

  const { share } = state
  const createdAt = formatDate(share.createdAt)
  const expiresAt = formatDate(share.expiresAt)
  const payload = share.snapshot.payload
  const results = payload.results
  const filters = payload.search?.filters ? Object.entries(payload.search.filters) : []

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <header className="space-y-4 border-b pb-6">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="rounded-md border px-2 py-1 font-medium text-foreground">Snapshot</span>
          {createdAt && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {createdAt}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {share.title ?? payload.title ?? 'Public resume snapshot'}
          </h1>
          {share.description && (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{share.description}</p>
          )}
          {expiresAt && (
            <p className="text-xs text-muted-foreground">Expires {expiresAt}</p>
          )}
        </div>
      </header>

      {(payload.search?.query || filters.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Search className="h-4 w-4" />
            Search
          </div>
          {payload.search?.query && (
            <p className="text-sm text-muted-foreground">{payload.search.query}</p>
          )}
          {filters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filters.map(([key, value]) => {
                const label = formatFilterValue(value)
                return label ? (
                  <span key={key} className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                    {key}: {label}
                  </span>
                ) : null
              })}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="text-sm font-medium text-foreground">
          Results
        </div>
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No public results are included in this snapshot.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {results.map((result) => (
              <article key={result.resumeKey} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-foreground">
                      {result.displayName ?? result.resumeKey}
                    </h2>
                    {result.headline && <p className="text-sm text-muted-foreground">{result.headline}</p>}
                    {result.location && <p className="text-xs text-muted-foreground">{result.location}</p>}
                  </div>
                  {result.summary && <p className="text-sm leading-6 text-foreground">{result.summary}</p>}
                  {result.highlights && result.highlights.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {result.highlights.map((highlight) => (
                        <span key={highlight} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {highlight}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {typeof result.score === 'number' && (
                  <div className="min-w-16 text-left md:text-right">
                    <div className="text-2xl font-semibold text-foreground">{result.score}</div>
                    {result.recommendation && (
                      <div className="text-xs text-muted-foreground">{result.recommendation}</div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        {share.snapshot.scoringMode} · {share.snapshot.promptVersion} · {share.snapshot.skillConfigVersion}
      </footer>
    </div>
  )
}
