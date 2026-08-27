import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  errorMessage,
  filterHistoryForSession,
  isTerminalIndustryProposalStatus,
  parseBatchReviewResults,
  partitionReviewQueue,
  reviewInboxFilterToSlug,
  TERMINAL_INDUSTRY_PROPOSAL_STATUSES,
  type IndustryHistoryItem,
  type ReviewInboxItem,
  type ReviewInboxFilter,
  type ReviewInboxProposal,
  type ReviewInboxRow,
  type SessionApproval,
} from './industry-review-inbox-model'
import { IndustryHistoryList } from './IndustryHistoryList'
import {
  IndustryReviewRow,
} from './IndustryReviewRow'
import {
  IndustryBatchActionBar,
  IndustryBatchApproveDialog,
  IndustryBatchRejectDialog,
  type BatchApproveAction,
  type BatchAttestationInput,
  type BatchDialogKind,
  type BatchRejectAction,
} from './IndustryBatchReview'
import {
  IndustryIdentityResolutionDialog,
} from './IndustryIdentityResolutionDialog'
import {
  requiresIdentityResolution,
} from './industry-review-inbox-model'
import {
  useIndustryReviewQueue,
  useIndustrySessionRegistry,
  useIndustryIdentityResolution,
  type ReviewQueueStatus,
} from './use-industry-review-hooks'

type IndustryReviewInboxProps = {
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>
  initialStatus: ReviewQueueStatus
  requestedProposalId?: string
  selectedProposalId?: string
  targetItem?: ReviewInboxItem
  targetError?: string
  targetPending?: boolean
  /**
   * User-initiated selections — the row is already on screen; only deep links
   * need the targeted-row scroll.
   */
  suppressTargetScroll?: boolean
  onQueueStatusChange: (status: ReviewQueueStatus) => void
  onSelectProposal: (proposal: ReviewInboxProposal | undefined) => void
  onLoadedProposalsChange?: (proposals: ReviewInboxProposal[]) => void
  /**
   * Lifted session-approval registry (controlled mode). When provided, the
   * inbox routes all registry reads/writes through these props; otherwise it
   * falls back to its internal state.
   */
  sessionApprovals?: ReadonlyMap<string, SessionApproval>
  onSessionApprovalsChange?: Dispatch<SetStateAction<Map<string, SessionApproval>>>
}

function focusRow(proposalId: string) {
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-testid="industry-review-row-${proposalId}"]`)?.focus()
  }, 0)
}

export function IndustryReviewInbox({
  requestJson,
  initialStatus,
  requestedProposalId,
  selectedProposalId,
  targetItem,
  targetError,
  targetPending = false,
  suppressTargetScroll = false,
  onQueueStatusChange,
  onSelectProposal,
  onLoadedProposalsChange,
  sessionApprovals: sessionApprovalsProp,
  onSessionApprovalsChange,
}: IndustryReviewInboxProps) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const sessionProposalIds = useMemo(
    () => new Set(sessionApprovalsProp?.keys()),
    [sessionApprovalsProp],
  )

  const {
    effectiveQueueStatus,
    activeFilter,
    items,
    setItems,
    nextCursor,
    skippedCount,
    loading,
    refreshing,
    setRefreshing,
    queueError,
    riskFilter,
    confidenceFilter,
    actionFilter,
    setRiskFilter,
    setConfidenceFilter,
    setActionFilter,
    changeQueueStatus,
    selectFilter,
    loadActiveQueue,
    historyItems,
    historyLoading,
    historyError,
    historyPartial,
    historyLoaded,
    loadHistory,
  } = useIndustryReviewQueue(
    requestJson,
    initialStatus,
    searchParams,
    setSearchParams,
    onQueueStatusChange,
    sessionProposalIds,
    { targetItem, targetPending },
  )

  const {
    sessionApprovals: registry,
    setSessionApprovals: setRegistry,
    pendingActions,
    rowErrors,
    setRowError,
    forcedNeedsReview,
    undoBlocked,
    loadPacket,
    invalidatePacketCache,
    announcement,
    setAnnouncement,
    handleApprove,
    handleUndo,
    handleRowRetry,
    resetSession,
  } = useIndustrySessionRegistry(requestJson, {
    sessionApprovals: sessionApprovalsProp,
    onSessionApprovalsChange,
    onFocusRow: focusRow,
  })

  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set())
  const [batchDialog, setBatchDialog] = useState<BatchDialogKind | null>(null)
  const [batchSubmitting, setBatchSubmitting] = useState(false)

  const {
    identityDialogOpen,
    setIdentityDialogOpen,
    identityDialogItems,
    identityPackets,
    identityPreparing,
    identitySubmitting,
    registryCompanies,
    companiesLoading: registryCompaniesLoading,
    identityTarget,
    setIdentityTarget,
    handleRowResolveIdentity,
    handleBatchResolveIdentity,
    handleResolveIdentitySubmit,
  } = useIndustryIdentityResolution(requestJson, {
    loadPacket,
    invalidatePacketCache,
    setRowError,
    setAnnouncement,
    onSuccess: (succeeded) => {
      setBatchSelection((current) => {
        const next = new Set(current)
        for (const proposalId of succeeded) next.delete(proposalId)
        return next
      })
    },
    onReloadQueue: () => {
      void loadActiveQueue()
    },
  })

  const focusedTargetRef = useRef<string | undefined>(undefined)
  const targetIsTerminal = targetItem
    ? isTerminalIndustryProposalStatus(targetItem.proposal.status)
    : false

  useEffect(() => {
    if (!requestedProposalId) return
    const requested = items.find((item) => item.proposal.proposalId === requestedProposalId)
    if (requested && requested.proposal.proposalId !== selectedProposalId) {
      onSelectProposal(requested.proposal)
    }
  }, [items, onSelectProposal, requestedProposalId, selectedProposalId])

  const itemsWithTarget = useMemo(() => {
    if (!targetItem) return items
    // A terminal target is normally dropped from the queue view, but a
    // session-approved terminal target is still actionable (Undo) and must
    // stay visible until refresh.
    if (targetIsTerminal && !registry.has(targetItem.proposal.proposalId)) return items
    const targetProposalId = targetItem.proposal.proposalId
    return [
      targetItem,
      ...items.filter((item) => item.proposal.proposalId !== targetProposalId),
    ]
  }, [items, registry, targetIsTerminal, targetItem])

  useEffect(() => {
    // Report the QUEUE order (not the target-prepended display order) so the
    // detail header's Previous/Next can move to the adjacent queue rows.
    onLoadedProposalsChange?.(items.map((item) => item.proposal))
  }, [items, onLoadedProposalsChange])

  const partition = useMemo(() => {
    const base = partitionReviewQueue(itemsWithTarget, registry)
    const approvable: ReviewInboxRow[] = []
    const forcedReviewRows: ReviewInboxRow[] = []
    for (const row of base.approvable) {
      if (forcedNeedsReview.has(row.item.proposal.proposalId)) forcedReviewRows.push(row)
      else approvable.push(row)
    }
    return {
      all: base.all,
      approvable,
      needsReview: [...base.needsReview, ...forcedReviewRows],
    }
  }, [forcedNeedsReview, itemsWithTarget, registry])

  const visibleHistory = useMemo(
    () => filterHistoryForSession(historyItems, new Set(registry.keys())),
    [historyItems, registry],
  )

  const historyStatusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of visibleHistory) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
    }
    return TERMINAL_INDUSTRY_PROPOSAL_STATUSES
      .map((status) => ({ status, count: counts.get(status) ?? 0 }))
      .filter(({ count }) => count > 0)
  }, [visibleHistory])

  const historyStatusLabel = (status: string) => status === 'approved'
    ? t('industryEvidence.historyStatusApproved', { defaultValue: 'Approved' })
    : status === 'rejected'
      ? t('industryEvidence.historyStatusRejected', { defaultValue: 'Rejected' })
      : status === 'superseded'
        ? t('industryEvidence.historyStatusSuperseded', { defaultValue: 'Superseded' })
        : status

  const visibleRows = activeFilter === 'all'
    ? partition.all
    : activeFilter === 'approvable'
      ? partition.approvable
      : partition.needsReview
  const sessionApprovalCount = registry.size

  const filterTabs: Array<{ filter: ReviewInboxFilter; label: string; count: number }> = [
    {
      filter: 'all',
      label: t('industryEvidence.all', { defaultValue: 'All' }),
      count: partition.all.length,
    },
    {
      filter: 'approvable',
      label: t('industryEvidence.approvable', { defaultValue: 'Approvable' }),
      count: partition.approvable.length,
    },
    {
      filter: 'needs_review',
      label: t('industryEvidence.needsReview', { defaultValue: 'Needs review' }),
      count: partition.needsReview.length,
    },
    {
      filter: 'history',
      label: t('industryEvidence.history', { defaultValue: 'History' }),
      count: visibleHistory.length,
    },
  ]

  const refreshInbox = useCallback(async () => {
    setRefreshing(true)
    const previousSessionIds = new Set(registry.keys())
    const [nextItems, nextHistory] = await Promise.all([loadActiveQueue(), loadHistory()])
    if (nextItems && nextHistory) {
      setItems((current) => current.filter((item) => !previousSessionIds.has(item.proposal.proposalId)))
      resetSession()
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
  }, [loadActiveQueue, loadHistory, onSelectProposal, registry, resetSession, selectedProposalId, setAnnouncement, setItems, setRefreshing, t])

  const toggleBatchSelect = useCallback((proposalId: string) => {
    setBatchSelection((current) => {
      const next = new Set(current)
      if (next.has(proposalId)) next.delete(proposalId)
      else next.add(proposalId)
      return next
    })
  }, [])

  const clearBatchSelection = useCallback(() => setBatchSelection(new Set()), [])

  const batchSelectedItems = useMemo(
    () => items.filter((item) => batchSelection.has(item.proposal.proposalId)),
    [items, batchSelection],
  )

  const handleBatchApprove = useCallback(async (
    actions: BatchApproveAction[],
    attestation: BatchAttestationInput,
  ) => {
    if (actions.length === 0) return
    setBatchSubmitting(true)
    try {
      const response = await requestJson('/api/company-industry-proposals/batch-review', {
        method: 'POST',
        body: JSON.stringify({ actions, attestation }),
      })
      const results = parseBatchReviewResults(response)
      const succeeded = results.filter((item) => item.ok)
      const failed = results.filter((item) => !item.ok)
      setBatchSelection((current) => {
        const next = new Set(current)
        for (const item of succeeded) next.delete(item.proposalId)
        return next
      })
      const approvedAt = Date.now()
      setRegistry((current) => {
        const next = new Map(current)
        for (const item of succeeded) {
          if (item.kind !== 'approve' || !item.revisionId) continue
          next.set(item.proposalId, {
            proposalId: item.proposalId,
            approvedRevisionId: item.revisionId,
            approvedAt,
          })
        }
        return next
      })
      const approvedCount = succeeded.filter((item) => item.kind === 'approve').length
      const summary = t('industryEvidence.batchDone', {
        defaultValue: 'Batch review complete: {{approved}} approved, {{rejected}} rejected, {{failed}} failed.',
        approved: approvedCount,
        rejected: succeeded.length - approvedCount,
        failed: failed.length,
      })
      setAnnouncement(summary)
      if (failed.length > 0) {
        toast.warning(summary)
      } else {
        toast.success(summary)
      }
      setBatchDialog(null)
      void loadActiveQueue()
    } catch (error) {
      const message = errorMessage(error, t('industryEvidence.batchFailed', {
        defaultValue: 'Batch review failed. Refresh the queue and retry.',
      }))
      setAnnouncement(message)
      toast.error(message)
    } finally {
      setBatchSubmitting(false)
    }
  }, [loadActiveQueue, requestJson, setAnnouncement, setRegistry, t])

  const handleBatchReject = useCallback(async (actions: BatchRejectAction[]) => {
    if (actions.length === 0) return
    setBatchSubmitting(true)
    try {
      const response = await requestJson('/api/company-industry-proposals/batch-review', {
        method: 'POST',
        body: JSON.stringify({ actions }),
      })
      const results = parseBatchReviewResults(response)
      const succeeded = results.filter((item) => item.ok)
      const failed = results.filter((item) => !item.ok)
      setBatchSelection((current) => {
        const next = new Set(current)
        for (const item of succeeded) next.delete(item.proposalId)
        return next
      })
      const summary = t('industryEvidence.batchRejectDone', {
        defaultValue: 'Batch review complete: {{rejected}} rejected, {{failed}} failed.',
        rejected: succeeded.length,
        failed: failed.length,
      })
      setAnnouncement(summary)
      if (failed.length > 0) toast.warning(summary)
      else toast.success(summary)
      setBatchDialog(null)
      void loadActiveQueue()
    } catch (error) {
      const message = errorMessage(error, t('industryEvidence.batchFailed', {
        defaultValue: 'Batch review failed. Refresh the queue and retry.',
      }))
      setAnnouncement(message)
      toast.error(message)
    } finally {
      setBatchSubmitting(false)
    }
  }, [loadActiveQueue, requestJson, setAnnouncement, t])

  useEffect(() => {
    const proposalId = targetItem?.proposal.proposalId
    const targetListLoading = targetIsTerminal ? historyLoading : loading
    if (!proposalId || targetListLoading || suppressTargetScroll || focusedTargetRef.current === proposalId) return
    const rowTestId = targetIsTerminal
      ? `industry-history-row-${proposalId}`
      : `industry-review-row-${proposalId}`
    const timer = window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-testid="${rowTestId}"]`)
      if (!row) return
      row.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'auto' })
      row.focus({ preventScroll: true })
      focusedTargetRef.current = proposalId
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeFilter, historyLoading, loading, suppressTargetScroll, targetIsTerminal, targetItem, visibleRows.length])

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

      <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm" data-testid="industry-review-summary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t('industryEvidence.inboxSummary', {
              defaultValue: '{{count}} live proposals are waiting for a decision.',
              count: partition.all.length,
            })}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              {t('industryEvidence.sessionApprovedCount', { defaultValue: 'Approved this session' })}
              {' '}
              <span className="font-semibold tabular-nums text-foreground" data-testid="industry-review-summary-session-approved">
                {sessionApprovalCount}
              </span>
            </span>
            <span className="sr-only" data-testid="industry-review-summary-approvable">
              {partition.approvable.length}
            </span>
            <span className="sr-only" data-testid="industry-review-summary-needs-review">
              {partition.needsReview.length}
            </span>
          </div>
        </div>
      </div>

      {targetError ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          role="status"
          data-testid="industry-review-target-error"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{targetError}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('industryEvidence.inboxTabs', { defaultValue: 'Industry review filters' })}>
        {filterTabs.map(({ filter, label, count }) => (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={activeFilter === filter}
            aria-controls={`industry-review-tabpanel-${filter}`}
            data-testid={`industry-review-filter-${reviewInboxFilterToSlug(filter)}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeFilter === filter
                ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm hover:bg-emerald-800'
                : 'border-border bg-background text-foreground hover:border-emerald-500 hover:bg-emerald-50/50'
            }`}
            onClick={() => selectFilter(filter)}
          >
            {label}
            <span className={`ml-1.5 tabular-nums text-xs ${activeFilter === filter ? 'text-emerald-50' : 'text-muted-foreground'}`}>
              {count}
            </span>
            {filter === 'history' && historyStatusCounts.map(({ status, count: statusCount }) => (
              <span
                key={status}
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${activeFilter === filter ? 'bg-emerald-800/80 text-emerald-50' : 'bg-muted text-muted-foreground'}`}
                data-testid={`industry-review-history-status-${status}`}
              >
                {historyStatusLabel(status)} {statusCount}
              </span>
            ))}
          </button>
        ))}
      </div>

      {activeFilter === 'history' ? (
        <div id="industry-review-tabpanel-history" role="tabpanel" aria-label={t('industryEvidence.history', { defaultValue: 'History' })}>
          <IndustryHistoryList
            items={visibleHistory}
            targetItem={targetIsTerminal && targetItem && !registry.has(targetItem.proposal.proposalId)
              ? targetItem.proposal as IndustryHistoryItem | undefined
              : undefined}
            loading={historyLoading}
            loaded={historyLoaded}
            error={historyError}
            partial={historyPartial}
            selectedProposalId={selectedProposalId}
            onRetry={() => void loadHistory()}
            onSelect={(item) => onSelectProposal(item as unknown as ReviewInboxProposal)}
          />
        </div>
      ) : (
        <div id={`industry-review-tabpanel-${activeFilter}`} role="tabpanel" className="space-y-3">
          <details className="rounded-lg border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t('industryEvidence.queueFilters', { defaultValue: 'Queue filters' })}
            </summary>
            <div className="grid gap-3 pb-2 pt-3 sm:grid-cols-4">
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                <span>{t('industryEvidence.queueStatus', { defaultValue: 'Queue status' })}</span>
                <select
                  aria-label={t('industryEvidence.queueStatus', { defaultValue: 'Queue status' })}
                  value={effectiveQueueStatus}
                  onChange={(event) => changeQueueStatus(event.target.value as ReviewQueueStatus)}
                  className="h-9 w-full rounded-md border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <option value="ready_for_review">{t('industryEvidence.queueStatusReadyReview', { defaultValue: 'Ready for review' })}</option>
                  <option value="new">{t('industryEvidence.queueStatusNew', { defaultValue: 'New' })}</option>
                  <option value="researching">{t('industryEvidence.queueStatusResearching', { defaultValue: 'Researching' })}</option>
                  <option value="needs_more_evidence">{t('industryEvidence.queueStatusNeedsEvidence', { defaultValue: 'Needs more evidence' })}</option>
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
                  <option value="source_conflict">{t('industryEvidence.riskSourceConflict', { defaultValue: 'source conflict' })}</option>
                  <option value="low_source_diversity">{t('industryEvidence.riskLowDiversity', { defaultValue: 'low source diversity' })}</option>
                  <option value="cnc_claim_inferred">{t('industryEvidence.riskCncInferred', { defaultValue: 'CNC claim inferred' })}</option>
                  <option value="stale_or_failed_source">{t('industryEvidence.riskStaleSource', { defaultValue: 'stale or failed source' })}</option>
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
                  <option value="high">{t('industryEvidence.confidenceHigh', { defaultValue: 'high' })}</option>
                  <option value="medium">{t('industryEvidence.confidenceMedium', { defaultValue: 'medium' })}</option>
                  <option value="low">{t('industryEvidence.confidenceLow', { defaultValue: 'low' })}</option>
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
                  <option value="approve">{t('industryEvidence.actionApprove', { defaultValue: 'approve' })}</option>
                  <option value="needs_more_evidence">{t('industryEvidence.actionNeedsEvidence', { defaultValue: 'needs evidence' })}</option>
                  <option value="inspect">{t('industryEvidence.actionInspect', { defaultValue: 'inspect' })}</option>
                  <option value="reject">{t('industryEvidence.actionReject', { defaultValue: 'reject' })}</option>
                </select>
              </label>
            </div>
          </details>

          <IndustryBatchActionBar
            selectedCount={batchSelectedItems.length}
            disabled={batchSubmitting || identityPreparing}
            onApprove={() => setBatchDialog('approve')}
            onReject={() => setBatchDialog('reject')}
            onResolveIdentity={() => void handleBatchResolveIdentity(batchSelectedItems)}
            resolveIdentityDisabled={!batchSelectedItems.some((item) => requiresIdentityResolution(item))}
            onClear={clearBatchSelection}
          />

          {skippedCount > 0 ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
              role="status"
              data-testid="industry-review-skipped-banner"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                {t('industryEvidence.queueSkippedBanner', {
                  defaultValue: '{{count}} malformed proposals were skipped from this queue',
                  count: skippedCount,
                })}
              </p>
            </div>
          ) : null}

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
            <div className="rounded-xl border border-dashed p-10 text-center" data-testid={`industry-review-empty-${reviewInboxFilterToSlug(activeFilter)}`}>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                {activeFilter === 'approvable' ? <Sparkles className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <p className="mt-3 text-sm font-medium">
                {activeFilter === 'all'
                  ? t('industryEvidence.allEmpty', { defaultValue: 'No live review items are waiting.' })
                  : activeFilter === 'approvable'
                  ? t('industryEvidence.approvableEmpty', { defaultValue: 'No clean approvals are waiting.' })
                  : t('industryEvidence.needsReviewEmpty', { defaultValue: 'No exception proposals are waiting.' })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeFilter === 'all'
                  ? t('industryEvidence.allEmptyHint', { defaultValue: 'New proposals will appear here when the evidence worker finishes.' })
                  : activeFilter === 'approvable'
                  ? t('industryEvidence.approvableEmptyHint', { defaultValue: 'Check Needs review or open Advanced tools for research health.' })
                  : t('industryEvidence.needsReviewEmptyHint', { defaultValue: 'The queue is clear for this filter.' })}
              </p>
              {activeFilter === 'approvable' && partition.needsReview.length > 0 ? (
                <Button type="button" variant="link" className="mt-2" onClick={() => selectFilter('needs_review')}>
                  {t('industryEvidence.openNeedsReview', { defaultValue: 'Open Needs review' })}
                </Button>
              ) : null}
            </div>
          ) : (
            visibleRows.map((row) => {
              const proposalId = row.item.proposal.proposalId
              const batchSelectable = !isTerminalIndustryProposalStatus(row.item.proposal.status)
              return (
                <IndustryReviewRow
                  key={proposalId}
                  row={row}
                  selected={selectedProposalId === proposalId}
                  targeted={targetItem?.proposal.proposalId === proposalId}
                  pendingAction={pendingActions.get(proposalId)}
                  error={rowErrors.get(proposalId)}
                  undoDisabled={undoBlocked.has(proposalId)}
                  batchSelected={batchSelection.has(proposalId)}
                  batchDisabled={!batchSelectable}
                  onToggleBatchSelect={batchSelectable
                    ? () => toggleBatchSelect(proposalId)
                    : undefined}
                  onSelect={() => onSelectProposal(row.item.proposal)}
                  onApprove={() => void handleApprove(row.item)}
                  onUndo={() => void handleUndo(row.item)}
                  onRetry={() => handleRowRetry(row)}
                  onResolveIdentity={
                    requiresIdentityResolution(row.item)
                      ? () => void handleRowResolveIdentity(row.item)
                      : undefined
                  }
                  resolveIdentityPending={identityPreparing && identityTarget?.proposal.proposalId === proposalId}
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

      <IndustryBatchApproveDialog
        open={batchDialog === 'approve'}
        items={batchSelectedItems}
        submitting={batchSubmitting}
        onSubmit={(actions, attestation) => void handleBatchApprove(actions, attestation)}
        onOpenChange={(open) => setBatchDialog(open ? 'approve' : null)}
      />
      <IndustryBatchRejectDialog
        open={batchDialog === 'reject'}
        items={batchSelectedItems}
        submitting={batchSubmitting}
        onSubmit={(actions) => void handleBatchReject(actions)}
        onOpenChange={(open) => setBatchDialog(open ? 'reject' : null)}
      />

      <IndustryIdentityResolutionDialog
        open={identityDialogOpen}
        items={identityDialogItems}
        packets={identityPackets}
        companies={registryCompanies}
        companiesLoading={registryCompaniesLoading}
        submitting={identitySubmitting}
        onSubmit={(actions) => void handleResolveIdentitySubmit(actions)}
        onOpenChange={(open) => {
          setIdentityDialogOpen(open)
          if (!open) setIdentityTarget(undefined)
        }}
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="industry-review-announcement">
        {announcement}
      </div>
    </section>
  )
}
