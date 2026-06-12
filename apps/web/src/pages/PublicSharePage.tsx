import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Clock, Search } from 'lucide-react'
import { useQuery } from 'convex/react'
import type { WorkspaceSlug } from '@trends/shared'

import { SearchResultsList } from '@/components/search/SearchResultsList'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'
import { useCandidateActions } from '@/hooks/useCandidateActions'
import { useCandidateBlocks } from '@/hooks/useCandidateBlocks'
import { useCandidateStatus } from '@/hooks/useCandidateStatus'
import { mapResumeDoc } from '@/hooks/useConvexResumes'
import { rawApiClient } from '@/lib/api-helpers'
import type { ResumeSearchResultItem } from '@/components/search/search-types'
import type { CandidateActionType, CandidateStatus } from '@/types/resume'
import { api } from '../../../../packages/convex/convex/_generated/api'

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
    member?: {
      workspaceSlug: string
      canReview: boolean
      searchRun: {
        id: string
        resumeKeys: string[]
        query: Record<string, unknown>
        filters: Record<string, unknown>
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

function buildSnapshotAnalysis(result: PublicShareResult | undefined): ResumeSearchResultItem['analysis'] {
  if (!result) {
    return undefined
  }

  if (
    typeof result.score !== 'number'
    && !result.summary
    && !result.recommendation
    && !result.highlights?.length
    && !result.concerns?.length
  ) {
    return undefined
  }

  return {
    score: result.score ?? 0,
    summary: result.summary ?? '',
    highlights: result.highlights ?? [],
    recommendation: result.recommendation ?? '',
    concerns: result.concerns,
  }
}

function StaticPublicShareResults({ results }: { results: PublicShareResult[] }) {
  return (
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
  )
}

function MemberPublicShareResults({
  member,
  results,
  searchQuery,
}: {
  member: NonNullable<NonNullable<PublicShareResponse['share']>['member']>
  results: PublicShareResult[]
  searchQuery?: string
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const docs = useQuery(api.resumes.getResumeDocsByIdentityKeys, {
    identityKeys: member.searchRun.resumeKeys,
  })
  const { statusByIdentity, updateStatus } = useCandidateStatus(member.canReview)
  const { actionsByResume, ratingsByResume, saveAction } = useCandidateActions(
    member.searchRun.id,
    undefined,
    member.canReview,
  )
  const { blocksByIdentity, blockCandidates, unblockCandidate } = useCandidateBlocks(member.canReview)
  const snapshotByKey = useMemo(() => {
    const map = new Map<string, PublicShareResult>()
    results.forEach((result) => {
      map.set(result.resumeKey, result)
    })
    return map
  }, [results])

  const items = useMemo<ResumeSearchResultItem[]>(() => {
    if (!docs) {
      return []
    }

    return docs.map((doc) => {
      const resume = mapResumeDoc(doc)
      const identityKey = resume.identityKey?.trim() || String(resume.resumeId)
      const snapshot = snapshotByKey.get(identityKey) ?? snapshotByKey.get(String(resume.resumeId))
      const statusMeta = statusByIdentity[identityKey]
      const block = blocksByIdentity[identityKey]
      const analysis = buildSnapshotAnalysis(snapshot) ?? resume.analysis
      const score = typeof snapshot?.score === 'number'
        ? snapshot.score
        : typeof analysis?.score === 'number'
          ? analysis.score
          : resume.primaryRuleScore

      return {
        key: identityKey,
        identityKey,
        resume,
        blocked: Boolean(block),
        analysis,
        score,
        scoreSource: typeof snapshot?.score === 'number' || analysis ? 'ai' : 'rule',
        status: statusMeta?.status ?? 'new',
        statusMeta,
      }
    })
  }, [blocksByIdentity, docs, snapshotByKey, statusByIdentity])

  const handleToggleExpanded = useCallback((key: string) => {
    setExpandedIds((current) => {
      if (current.has(key)) {
        return new Set()
      }

      return new Set([key])
    })
  }, [])

  const handleToggleSelect = useCallback((key: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const handleAction = useCallback(
    (resumeId: string, actionType: CandidateActionType) => {
      void saveAction({ resumeId, actionType })
    },
    [saveAction],
  )

  const handleRating = useCallback(
    (resumeId: string, rating: number) => {
      void saveAction({ resumeId, actionType: 'rating', actionData: { rating } })
    },
    [saveAction],
  )

  const handleCandidateStatusChange = useCallback(
    (identityKey: string, status: CandidateStatus, notes?: string) => {
      void updateStatus(identityKey, status, notes)
    },
    [updateStatus],
  )

  const handleToggleBlock = useCallback(
    (identityKey: string, blocked: boolean, reason?: string) => {
      if (blocked) {
        void unblockCandidate(identityKey)
        return
      }

      void blockCandidates([identityKey], reason)
    },
    [blockCandidates, unblockCandidate],
  )

  return (
    <section className="space-y-3">
      <div className="text-sm font-medium text-foreground">
        Results
      </div>
      <SearchResultsList
        expandedIds={expandedIds}
        hasMore={false}
        items={items}
        loading={docs === undefined}
        onLoadMore={() => {}}
        onToggleExpanded={handleToggleExpanded}
        selectedIds={selectedIds}
        actionsByResume={actionsByResume}
        ratingsByResume={ratingsByResume}
        onToggleSelect={member.canReview ? handleToggleSelect : undefined}
        onAction={member.canReview ? handleAction : undefined}
        onRating={member.canReview ? handleRating : undefined}
        onCandidateStatusChange={member.canReview ? handleCandidateStatusChange : undefined}
        onToggleBlock={member.canReview ? handleToggleBlock : undefined}
        searchQuery={searchQuery}
        showAiScore
      />
    </section>
  )
}

function PublicShareReady({ share }: { share: NonNullable<PublicShareResponse['share']> }) {
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

      {share.member ? (
        <MemberPublicShareResults
          member={share.member}
          results={results}
          searchQuery={payload.search?.query}
        />
      ) : (
        <StaticPublicShareResults results={results} />
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        {share.snapshot.scoringMode} · {share.snapshot.promptVersion} · {share.snapshot.skillConfigVersion}
      </footer>
    </div>
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

  if (share.member) {
    return (
      <WorkspaceProvider workspaceSlug={share.member.workspaceSlug as WorkspaceSlug} surface="workspace">
        <PublicShareReady share={share} />
      </WorkspaceProvider>
    )
  }

  return <PublicShareReady share={share} />
}
