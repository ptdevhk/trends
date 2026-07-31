import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SettingsRequestError } from '@/pages/system-settings/lib'
import {
  filterHistoryForSession,
  getOneClickEligibility,
  partitionReviewQueue,
  type ReviewInboxItem,
  type ReviewInboxProposal,
  type ReviewInboxRecommendation,
  type ReviewInboxRow,
  type ReviewInboxTab,
  type SessionApproval,
} from './industry-review-inbox-model'
import {
  IndustryHistoryList,
  type IndustryHistoryItem,
} from './IndustryHistoryList'
import {
  IndustryReviewRow,
  type ReviewRowAction,
  type ReviewRowError,
} from './IndustryReviewRow'

type ReviewQueueStatus = ReviewInboxProposal['status']
type CleanReviewPacket = {
  proposal: ReviewInboxProposal
  recommendation: ReviewInboxRecommendation
  dataset: {
    inputFingerprint: string
    proposalUpdatedAt: number
    sourceVersions: Array<{ sourceId: string; updatedAt: number }>
  }
  reviewContext: {
    profile: { currentRevisionId?: string } | null
  }
}

type InboxErrorKind = ReviewRowError['kind']

type InboxPolicyError = Error & { kind: 'policy' }

type IndustryReviewInboxProps = {
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
  initialStatus: ReviewQueueStatus
  requestedProposalId?: string
  selectedProposalId?: string
  onQueueStatusChange: (status: ReviewQueueStatus) => void
  onSelectProposal: (proposal: ReviewInboxProposal | undefined) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseQueue(value: unknown): ReviewInboxItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.filter((item): item is ReviewInboxItem => {
    if (!isRecord(item) || !isRecord(item.proposal) || !isRecord(item.recommendation)) return false
    return typeof item.proposal.proposalId === 'string'
      && typeof item.recommendation.proposalId === 'string'
  }) as ReviewInboxItem[]
}

function parseHistory(value: unknown): IndustryHistoryItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.filter((item): item is IndustryHistoryItem => (
    isRecord(item) && typeof item.proposalId === 'string'
  )) as IndustryHistoryItem[]
}

function parseCleanPacket(value: unknown): CleanReviewPacket | null {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.recommendation)) return null
  if (!isRecord(value.dataset) || typeof value.dataset.inputFingerprint !== 'string') return null
  const reviewContextValue = isRecord(value.reviewContext)
    ? value.reviewContext
    : isRecord(value.bundle)
      ? value.bundle
      : {}
  const profile = isRecord(reviewContextValue.profile)
    ? { currentRevisionId: typeof reviewContextValue.profile.currentRevisionId === 'string' ? reviewContextValue.profile.currentRevisionId : undefined }
    : null
  return {
    proposal: value.proposal as ReviewInboxProposal,
    recommendation: value.recommendation as ReviewInboxRecommendation,
    dataset: {
      inputFingerprint: value.dataset.inputFingerprint,
      proposalUpdatedAt: typeof value.dataset.proposalUpdatedAt === 'number'
        ? value.dataset.proposalUpdatedAt
        : 0,
      sourceVersions: Array.isArray(value.dataset.sourceVersions)
        ? value.dataset.sourceVersions.filter((item): item is { sourceId: string; updatedAt: number } => (
          isRecord(item) && typeof item.sourceId === 'string' && typeof item.updatedAt === 'number'
        ))
        : [],
    },
    reviewContext: { profile },
  }
}

function createRevisionId(companyKey: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `industry-${companyKey}-${suffix}`
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof SettingsRequestError ? error.status : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof SettingsRequestError && isRecord(error.body)) {
    const bodyMessage = error.body.error ?? error.body.message
    if (typeof bodyMessage === 'string' && bodyMessage.trim()) return bodyMessage
  }
  if (error instanceof Error && error.message && !/^HTTP \d+$/.test(error.message)) {
    return error.message
  }
  return fallback
}

function rowErrorKind(status: number | undefined): InboxErrorKind {
  if (status === 409) return 'conflict'
  if (status === 422) return 'policy'
  return 'network'
}

function buildCleanApprovalRequest(
  item: ReviewInboxItem,
  packet: CleanReviewPacket,
  revisionId: string,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const packetItem: ReviewInboxItem = {
    ...item,
    proposal: packet.proposal,
    recommendation: packet.recommendation,
  }
  const eligibility = getOneClickEligibility(packetItem)
  if (!eligibility.eligible) {
    return {
      ok: false,
      message: 'The review packet is no longer eligible for one-click approval.',
    }
  }
  return {
    ok: true,
    body: {
      revisionId,
      ...(packet.reviewContext.profile?.currentRevisionId
        ? { expectedCurrentRevisionId: packet.reviewContext.profile.currentRevisionId }
        : {}),
      expectedProposalUpdatedAt: packet.dataset.proposalUpdatedAt || item.proposal.updatedAt,
      expectedInputFingerprint: packet.dataset.inputFingerprint,
      expectedSourceVersions: packet.dataset.sourceVersions,
      verificationLevel: packet.recommendation.recommendedVerificationLevel,
      industryClass: packet.recommendation.recommendedIndustryClass,
      approvedSourceIds: eligibility.safeSourceIds,
      evidenceSummary: packet.recommendation.evidenceSummaryDraft.trim(),
      decisionReason: packet.recommendation.decisionReasonDraft.trim(),
      taxonomyVersion: 'industry-v1',
    },
  }
}

function companyLabel(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

function focusRow(proposalId: string) {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-testid="industry-review-row-${proposalId}"]`)?.focus()
  }, 0)
}

function uniqueHistory(items: IndustryHistoryItem[]): IndustryHistoryItem[] {
  const byId = new Map<string, IndustryHistoryItem>()
  for (const item of items) {
    if (!byId.has(item.proposalId)) byId.set(item.proposalId, item)
  }
  return [...byId.values()].sort((left, right) => (
    (right.reviewedAt ?? right.updatedAt) - (left.reviewedAt ?? left.updatedAt)
  ))
}

export function IndustryReviewInbox({
  requestJson,
  initialStatus,
  requestedProposalId,
  selectedProposalId,
  onQueueStatusChange,
  onSelectProposal,
}: IndustryReviewInboxProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ReviewInboxTab>('approvable')
  const [queueStatus, setQueueStatus] = useState<ReviewQueueStatus>(initialStatus)
  const [riskFilter, setRiskFilter] = useState('')
  const [confidenceFilter, setConfidenceFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [items, setItems] = useState<ReviewInboxItem[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [queueError, setQueueError] = useState<string>()
  const [historyItems, setHistoryItems] = useState<IndustryHistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [sessionApprovals, setSessionApprovals] = useState<Map<string, SessionApproval>>(new Map())
  const [pendingActions, setPendingActions] = useState<Map<string, ReviewRowAction>>(new Map())
  const [rowErrors, setRowErrors] = useState<Map<string, ReviewRowError>>(new Map())
  const [forcedNeedsReview, setForcedNeedsReview] = useState<Set<string>>(new Set())
  const [undoBlocked, setUndoBlocked] = useState<Set<string>>(new Set())
  const [packetCache, setPacketCache] = useState<Map<string, CleanReviewPacket>>(new Map())
  const [announcement, setAnnouncement] = useState('')

  const updatePending = useCallback((proposalId: string, action?: ReviewRowAction) => {
    setPendingActions((current) => {
      const next = new Map(current)
      if (action) next.set(proposalId, action)
      else next.delete(proposalId)
      return next
    })
  }, [])

  const clearRowError = useCallback((proposalId: string) => {
    setRowErrors((current) => {
      const next = new Map(current)
      next.delete(proposalId)
      return next
    })
  }, [])

  const setRowError = useCallback((proposalId: string, error: ReviewRowError) => {
    setRowErrors((current) => new Map(current).set(proposalId, error))
  }, [])

  const loadActiveQueue = useCallback(async (cursor?: string, append = false): Promise<ReviewInboxItem[] | null> => {
    setLoading(true)
    if (!append) setQueueError(undefined)
    try {
      const query = new URLSearchParams({ status: queueStatus, limit: '100' })
      if (cursor) query.set('cursor', cursor)
      if (riskFilter) query.set('riskFlag', riskFilter)
      if (confidenceFilter) query.set('confidenceBand', confidenceFilter)
      if (actionFilter) query.set('recommendedAction', actionFilter)
      const payload = await requestJson(`/api/company-industry-proposals/review-queue?${query.toString()}`)
      const next = parseQueue(payload)
      setItems((current) => append
        ? [...current, ...next.filter((item) => !current.some((existing) => existing.proposal.proposalId === item.proposal.proposalId))]
        : next)
      setNextCursor(isRecord(payload) && typeof payload.nextCursor === 'string' ? payload.nextCursor : undefined)
      return next
    } catch (error) {
      const message = errorMessage(error, t('industryEvidence.queueLoadFailed', { defaultValue: 'Failed to load industry review queue' }))
      setQueueError(message)
      if (!append) toast.error(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [actionFilter, confidenceFilter, queueStatus, requestJson, riskFilter, t])

  const loadHistory = useCallback(async (): Promise<IndustryHistoryItem[] | null> => {
    setHistoryLoading(true)
    setHistoryError(undefined)
    try {
      const responses = await Promise.all([
        requestJson('/api/company-industry-proposals?status=approved'),
        requestJson('/api/company-industry-proposals?status=rejected'),
        requestJson('/api/company-industry-proposals?status=superseded'),
      ])
      const next = uniqueHistory(responses.flatMap(parseHistory))
      setHistoryItems(next)
      setHistoryLoaded(true)
      return next
    } catch (error) {
      const message = errorMessage(error, t('industryEvidence.historyLoadFailed', { defaultValue: 'Failed to load review history' }))
      setHistoryError(message)
      return null
    } finally {
      setHistoryLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    void loadActiveQueue()
  }, [loadActiveQueue])

  useEffect(() => {
    if (!requestedProposalId) return
    const requested = items.find((item) => item.proposal.proposalId === requestedProposalId)
    if (requested && requested.proposal.proposalId !== selectedProposalId) {
      onSelectProposal(requested.proposal)
    }
  }, [items, onSelectProposal, requestedProposalId, selectedProposalId])

  const partition = useMemo(() => {
    const base = partitionReviewQueue(items, sessionApprovals)
    const forcedIds = forcedNeedsReview
    const moveToNeedsReview = base.approvable.filter((row) => forcedIds.has(row.item.proposal.proposalId))
    return {
      approvable: base.approvable.filter((row) => !forcedIds.has(row.item.proposal.proposalId)),
      needsReview: [...base.needsReview, ...moveToNeedsReview],
    }
  }, [forcedNeedsReview, items, sessionApprovals])

  const visibleHistory = useMemo(
    () => filterHistoryForSession(historyItems, new Set(sessionApprovals.keys())),
    [historyItems, sessionApprovals],
  )

  const visibleRows = activeTab === 'approvable'
    ? partition.approvable
    : partition.needsReview
  const sessionApprovalCount = sessionApprovals.size

  const changeQueueStatus = useCallback((status: ReviewQueueStatus) => {
    setQueueStatus(status)
    onQueueStatusChange(status)
  }, [onQueueStatusChange])

  const handleTabChange = useCallback((tab: ReviewInboxTab) => {
    setActiveTab(tab)
    if (tab === 'history' && !historyLoaded && !historyLoading) {
      void loadHistory()
    }
  }, [historyLoaded, historyLoading, loadHistory])

  const loadPacket = useCallback(async (item: ReviewInboxItem): Promise<CleanReviewPacket> => {
    const cached = packetCache.get(item.proposal.proposalId)
    if (cached) return cached
    const payload = await requestJson(
      `/api/company-industry-proposals/${encodeURIComponent(item.proposal.proposalId)}/review-packet`,
    )
    const packet = parseCleanPacket(payload)
    if (!packet) throw new Error('The review packet response was incomplete.')
    setPacketCache((current) => new Map(current).set(item.proposal.proposalId, packet))
    return packet
  }, [packetCache, requestJson])

  const handleApprove = useCallback(async (item: ReviewInboxItem) => {
    const proposalId = item.proposal.proposalId
    const currentEligibility = getOneClickEligibility(item)
    if (!currentEligibility.eligible) return
    updatePending(proposalId, 'approve')
    clearRowError(proposalId)
    try {
      const packet = await loadPacket(item)
      const revisionId = createRevisionId(item.proposal.companyKey ?? proposalId)
      const request = buildCleanApprovalRequest(item, packet, revisionId)
      if (!request.ok) {
        const policyError = new Error(request.message) as InboxPolicyError
        policyError.kind = 'policy'
        throw policyError
      }
      const response = await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(proposalId)}/approve`,
        { method: 'POST', body: JSON.stringify(request.body) },
      )
      if (!isRecord(response) || typeof response.revisionId !== 'string') {
        throw new Error('Approval response did not include a revision.')
      }
      const recompute = isRecord(response.recompute) && typeof response.recompute.runId === 'string'
        ? response.recompute.runId
        : undefined
      const approvedAt = Date.now()
      setSessionApprovals((current) => new Map(current).set(proposalId, {
        proposalId,
        approvedRevisionId: response.revisionId as string,
        ...(recompute ? { recomputeRunId: recompute } : {}),
        approvedAt,
      }))
      setForcedNeedsReview((current) => {
        const next = new Set(current)
        next.delete(proposalId)
        return next
      })
      setUndoBlocked((current) => {
        const next = new Set(current)
        next.delete(proposalId)
        return next
      })
      setAnnouncement(t('industryEvidence.undoAvailableAnnouncement', {
        defaultValue: '{{company}} approved. Undo remains available until refresh.',
        company: companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      toast.success(t('industryEvidence.approved', { defaultValue: 'Industry verdict revision approved' }))
      focusRow(proposalId)
    } catch (error) {
      const status = error instanceof (Error) && 'kind' in error && (error as InboxPolicyError).kind === 'policy'
        ? 422
        : errorStatus(error)
      const kind = rowErrorKind(status)
      const fallback = kind === 'conflict'
        ? t('industryEvidence.refreshRequired', { defaultValue: 'Review changed. Refresh before approving.' })
        : kind === 'policy'
          ? t('industryEvidence.rowPolicyRejected', { defaultValue: 'This row no longer meets the one-click approval policy. Open it for review.' })
          : t('industryEvidence.rowApproveFailed', { defaultValue: 'Approval failed. Retry this row.' })
      const message = errorMessage(error, fallback)
      if (kind === 'policy') {
        setForcedNeedsReview((current) => new Set(current).add(proposalId))
      }
      setRowError(proposalId, { kind, message })
      setAnnouncement(message)
      if (kind !== 'conflict') toast.error(message)
    } finally {
      updatePending(proposalId)
    }
  }, [clearRowError, loadPacket, requestJson, setRowError, t, updatePending])

  const handleUndo = useCallback(async (item: ReviewInboxItem) => {
    const proposalId = item.proposal.proposalId
    const approval = sessionApprovals.get(proposalId)
    if (!approval || undoBlocked.has(proposalId)) return
    updatePending(proposalId, 'undo')
    clearRowError(proposalId)
    try {
      const packet = await loadPacket(item)
      const body = {
        approvedRevisionId: approval.approvedRevisionId,
        ...(packet.reviewContext.profile?.currentRevisionId
          ? { expectedCurrentRevisionId: packet.reviewContext.profile.currentRevisionId }
          : {}),
        expectedProposalUpdatedAt: packet.dataset.proposalUpdatedAt || item.proposal.updatedAt,
        ...(approval.recomputeRunId ? { recomputeRunId: approval.recomputeRunId } : {}),
      }
      await requestJson(
        `/api/company-industry-proposals/${encodeURIComponent(proposalId)}/undo-approval`,
        { method: 'POST', body: JSON.stringify(body) },
      )
      setSessionApprovals((current) => {
        const next = new Map(current)
        next.delete(proposalId)
        return next
      })
      setForcedNeedsReview((current) => {
        const next = new Set(current)
        next.delete(proposalId)
        return next
      })
      setUndoBlocked((current) => {
        const next = new Set(current)
        next.delete(proposalId)
        return next
      })
      setAnnouncement(t('industryEvidence.undoSuccess', {
        defaultValue: '{{company}} restored to pending review.',
        company: companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      toast.success(t('industryEvidence.undoSuccess', {
        defaultValue: 'Approval undone; proposal is ready for review again.',
        company: companyLabel(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      focusRow(proposalId)
    } catch (error) {
      const status = errorStatus(error)
      const kind = rowErrorKind(status)
      const fallback = kind === 'conflict'
        ? t('industryEvidence.undoConflict', { defaultValue: 'Undo is no longer safe. Refresh before trying again.' })
        : kind === 'policy'
          ? t('industryEvidence.undoPolicyRejected', { defaultValue: 'Undo was rejected by the current evidence policy. Review the row.' })
          : t('industryEvidence.undoFailed', { defaultValue: 'Undo failed. Retry or refresh to reconcile.' })
      const message = errorMessage(error, fallback)
      if (kind === 'conflict' || kind === 'policy') {
        setUndoBlocked((current) => new Set(current).add(proposalId))
      }
      if (kind === 'policy') {
        setForcedNeedsReview((current) => new Set(current).add(proposalId))
      }
      setRowError(proposalId, { kind, message })
      setAnnouncement(message)
    } finally {
      updatePending(proposalId)
    }
  }, [clearRowError, loadPacket, requestJson, sessionApprovals, t, undoBlocked, updatePending])

  const refreshInbox = useCallback(async () => {
    setRefreshing(true)
    const previousSessionIds = new Set(sessionApprovals.keys())
    const [nextItems, nextHistory] = await Promise.all([loadActiveQueue(), loadHistory()])
    if (nextItems && nextHistory) {
      setItems((current) => current.filter((item) => !previousSessionIds.has(item.proposal.proposalId)))
      setSessionApprovals(new Map())
      setPendingActions(new Map())
      setRowErrors(new Map())
      setForcedNeedsReview(new Set())
      setUndoBlocked(new Set())
      setAnnouncement(t('industryEvidence.refreshReconciled', {
        defaultValue: 'Refresh complete. Approved rows are now reconciled into History.',
      }))
      if (previousSessionIds.has(selectedProposalId ?? '')) onSelectProposal(undefined)
      focusRow(selectedProposalId ?? '')
    } else {
      const message = t('industryEvidence.refreshRetainedSession', {
        defaultValue: 'Refresh failed. The current session actions remain visible.',
      })
      setAnnouncement(message)
      toast.error(message)
    }
    setRefreshing(false)
  }, [loadActiveQueue, loadHistory, onSelectProposal, selectedProposalId, sessionApprovals, t])

  const handleRowRetry = useCallback((row: ReviewInboxRow) => {
    if (row.sessionApproval) void handleUndo(row.item)
    else void handleApprove(row.item)
  }, [handleApprove, handleUndo])

  return (
    <section className="space-y-4" aria-labelledby="industry-review-inbox-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="industry-review-inbox-title" className="text-base font-semibold">
            {t('industryEvidence.inboxTitle', { defaultValue: 'Review inbox' })}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('industryEvidence.inboxDescription', {
              defaultValue: 'Resolve the cleanest evidence first. Exceptions stay visible until a reviewer inspects them.',
            })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refreshInbox()} disabled={loading || refreshing} data-testid="industry-review-refresh">
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing
            ? t('industryEvidence.refreshing', { defaultValue: 'Refreshing…' })
            : t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="industry-review-summary">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-800">
            {t('industryEvidence.approvable', { defaultValue: 'Approvable' })}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-950" data-testid="industry-review-summary-approvable">
            {partition.approvable.length}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
            {t('industryEvidence.needsReview', { defaultValue: 'Needs review' })}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-950" data-testid="industry-review-summary-needs-review">
            {partition.needsReview.length}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-sky-800">
            {t('industryEvidence.sessionApprovedCount', { defaultValue: 'Approved this session' })}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-950" data-testid="industry-review-summary-session-approved">
            {sessionApprovalCount}
          </p>
        </div>
      </div>

      <div className="border-b" role="tablist" aria-label={t('industryEvidence.inboxTabs', { defaultValue: 'Industry review groups' })}>
        {([
          ['approvable', t('industryEvidence.approvable', { defaultValue: 'Approvable' }), partition.approvable.length],
          ['needs_review', t('industryEvidence.needsReview', { defaultValue: 'Needs review' }), partition.needsReview.length],
          ['history', t('industryEvidence.history', { defaultValue: 'History' }), visibleHistory.length],
        ] as const).map(([tab, label, count]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`industry-review-tabpanel-${tab}`}
            className={`mr-5 border-b-2 px-1 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => handleTabChange(tab)}
          >
            {label}
            <span className="ml-2 tabular-nums text-xs text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>

      {activeTab === 'history' ? (
        <div id="industry-review-tabpanel-history" role="tabpanel" aria-label={t('industryEvidence.history', { defaultValue: 'History' })}>
          <IndustryHistoryList
            items={visibleHistory}
            loading={historyLoading}
            loaded={historyLoaded}
            error={historyError}
            selectedProposalId={selectedProposalId}
            onRetry={() => void loadHistory()}
            onSelect={(item) => onSelectProposal(item as unknown as ReviewInboxProposal)}
          />
        </div>
      ) : (
        <div id={`industry-review-tabpanel-${activeTab}`} role="tabpanel" className="space-y-3">
          <details className="rounded-lg border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('industryEvidence.queueFilters', { defaultValue: 'Queue filters' })}
            </summary>
            <div className="grid gap-3 pb-2 pt-3 sm:grid-cols-4">
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>{t('industryEvidence.queueStatus', { defaultValue: 'Queue status' })}</span>
                <select
                  aria-label={t('industryEvidence.queueStatus', { defaultValue: 'Queue status' })}
                  value={queueStatus}
                  onChange={(event) => changeQueueStatus(event.target.value as ReviewQueueStatus)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="ready_for_review">Ready for review</option>
                  <option value="new">New</option>
                  <option value="researching">Researching</option>
                  <option value="needs_more_evidence">Needs more evidence</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>{t('industryEvidence.riskFilter', { defaultValue: 'Risk' })}</span>
                <select
                  aria-label={t('industryEvidence.riskFilter', { defaultValue: 'Risk' })}
                  value={riskFilter}
                  onChange={(event) => setRiskFilter(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allRisks', { defaultValue: 'All risks' })}</option>
                  <option value="source_conflict">source conflict</option>
                  <option value="low_source_diversity">low source diversity</option>
                  <option value="cnc_claim_inferred">CNC claim inferred</option>
                  <option value="stale_or_failed_source">stale or failed source</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>{t('industryEvidence.confidenceFilter', { defaultValue: 'Confidence' })}</span>
                <select
                  aria-label={t('industryEvidence.confidenceFilter', { defaultValue: 'Confidence' })}
                  value={confidenceFilter}
                  onChange={(event) => setConfidenceFilter(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allConfidence', { defaultValue: 'All confidence' })}</option>
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>{t('industryEvidence.actionFilter', { defaultValue: 'Action' })}</span>
                <select
                  aria-label={t('industryEvidence.actionFilter', { defaultValue: 'Action' })}
                  value={actionFilter}
                  onChange={(event) => setActionFilter(event.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="">{t('industryEvidence.allActions', { defaultValue: 'All actions' })}</option>
                  <option value="approve">approve</option>
                  <option value="needs_more_evidence">needs evidence</option>
                  <option value="inspect">inspect</option>
                  <option value="reject">reject</option>
                </select>
              </label>
            </div>
          </details>

          {queueError ? (
            <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950" role="alert" data-testid="industry-review-queue-error">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p>{queueError}</p>
                <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-current" onClick={() => void loadActiveQueue()}>
                  {t('industryEvidence.retryRow', { defaultValue: 'Retry' })}
                </Button>
              </div>
            </div>
          ) : null}

          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('common.loading', { defaultValue: 'Loading…' })}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center" data-testid={`industry-review-empty-${activeTab}`}>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                {activeTab === 'approvable' ? <Sparkles className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <p className="mt-3 text-sm font-medium">
                {activeTab === 'approvable'
                  ? t('industryEvidence.approvableEmpty', { defaultValue: 'No clean approvals are waiting.' })
                  : t('industryEvidence.needsReviewEmpty', { defaultValue: 'No exception proposals are waiting.' })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeTab === 'approvable'
                  ? t('industryEvidence.approvableEmptyHint', { defaultValue: 'Check Needs review or open Advanced tools for research health.' })
                  : t('industryEvidence.needsReviewEmptyHint', { defaultValue: 'The queue is clear for this filter.' })}
              </p>
              {activeTab === 'approvable' && partition.needsReview.length > 0 ? (
                <Button type="button" variant="link" className="mt-2" onClick={() => handleTabChange('needs_review')}>
                  {t('industryEvidence.openNeedsReview', { defaultValue: 'Open Needs review' })}
                </Button>
              ) : null}
            </div>
          ) : (
            visibleRows.map((row) => {
              const proposalId = row.item.proposal.proposalId
              return (
                <IndustryReviewRow
                  key={proposalId}
                  row={row}
                  selected={selectedProposalId === proposalId}
                  pendingAction={pendingActions.get(proposalId)}
                  error={rowErrors.get(proposalId)}
                  undoDisabled={undoBlocked.has(proposalId)}
                  onSelect={() => onSelectProposal(row.item.proposal)}
                  onApprove={() => void handleApprove(row.item)}
                  onUndo={() => void handleUndo(row.item)}
                  onRetry={() => handleRowRetry(row)}
                />
              )
            })
          )}
          {nextCursor ? (
            <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => void loadActiveQueue(nextCursor, true)}>
              {t('industryEvidence.loadMore', { defaultValue: 'Load next review page' })}
            </Button>
          ) : null}
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="industry-review-announcement">
        {announcement}
      </div>
    </section>
  )
}
