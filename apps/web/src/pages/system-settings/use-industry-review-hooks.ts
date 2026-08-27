import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { isRecord } from '@trends/shared'
import {
  buildCleanApprovalRequest,
  errorMessage,
  errorStatus,
  getOneClickEligibility,
  isTerminalIndustryProposalStatus,
  parseCleanPacket,
  parseHistory,
  parseReviewInboxFilter,
  parseReviewInboxItems,
  parseReviewQueueSkippedCount,
  reviewInboxFilterToSlug,
  rowErrorKind,
  TERMINAL_INDUSTRY_PROPOSAL_STATUSES,
  type CleanReviewPacket,
  type IndustryHistoryItem,
  type InboxErrorKind,
  type ReviewInboxFilter,
  type ReviewInboxItem,
  type ReviewInboxProposal,
  type ReviewInboxRow,
  type SessionApproval,
} from './industry-review-inbox-model'
import type {
  ReviewRowAction,
  ReviewRowError,
} from './IndustryReviewRow'
import type {
  IdentityDialogPacket,
  IdentityResolutionAction,
  RegistryCompany,
} from './IndustryIdentityResolutionDialog'
import {
  createRevisionId,
  displayCompany,
} from './industry-verification-model'

export type ReviewQueueStatus = ReviewInboxProposal['status']

type InboxPolicyError = Error & { kind: 'policy' }

function parseQueue(value: unknown): ReviewInboxItem[] {
  return parseReviewInboxItems(value)
}

export function uniqueHistory(items: IndustryHistoryItem[]): IndustryHistoryItem[] {
  const byId = new Map<string, IndustryHistoryItem>()
  for (const item of items) {
    if (!byId.has(item.proposalId)) byId.set(item.proposalId, item)
  }
  return [...byId.values()].sort((left, right) => (
    (right.reviewedAt ?? right.updatedAt) - (left.reviewedAt ?? left.updatedAt)
  ))
}

// ---------------------------------------------------------------------------
// Hook 1: useIndustryReviewQueue
// ---------------------------------------------------------------------------

export type UseIndustryReviewQueueOptions = {
  targetItem?: ReviewInboxItem
  targetPending?: boolean
}

export function useIndustryReviewQueue(
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>,
  initialStatus: ReviewQueueStatus,
  searchParams: URLSearchParams,
  setSearchParams: (next: URLSearchParams, options?: { replace?: boolean }) => void,
  onQueueStatusChange: (status: ReviewQueueStatus) => void,
  sessionProposalIds: ReadonlySet<string>,
  options?: UseIndustryReviewQueueOptions,
) {
  const { t } = useTranslation()
  const targetItem = options?.targetItem
  const targetPending = options?.targetPending ?? false

  const activeFilter = parseReviewInboxFilter(searchParams.get('filter'))
  const [queueStatus, setQueueStatus] = useState<ReviewQueueStatus>(initialStatus)
  const [riskFilter, setRiskFilter] = useState('')
  const [confidenceFilter, setConfidenceFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [items, setItems] = useState<ReviewInboxItem[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [skippedCount, setSkippedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [queueError, setQueueError] = useState<string>()

  const [historyItems, setHistoryItems] = useState<IndustryHistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string>()
  const [historyPartial, setHistoryPartial] = useState(false)

  const syncedTargetStatusRef = useRef<string | undefined>(undefined)
  const targetIsTerminal = targetItem
    ? isTerminalIndustryProposalStatus(targetItem.proposal.status)
    : false
  const targetStatusNeedsInitialSync = Boolean(
    targetItem
    && !targetIsTerminal
    && syncedTargetStatusRef.current !== targetItem.proposal.proposalId,
  )
  const effectiveQueueStatus = targetStatusNeedsInitialSync
    ? targetItem!.proposal.status
    : queueStatus
  const hasExplicitFilter = searchParams.has('filter')

  const loadActiveQueue = useCallback(async (cursor?: string, append = false): Promise<ReviewInboxItem[] | null> => {
    setLoading(true)
    if (!append) setQueueError(undefined)
    try {
      const query = new URLSearchParams({ status: effectiveQueueStatus, limit: '100' })
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
      setSkippedCount(parseReviewQueueSkippedCount(isRecord(payload) ? payload.skippedCount : undefined))
      return next
    } catch (error) {
      const message = errorMessage(error, t('industryEvidence.queueLoadFailed', { defaultValue: 'Failed to load industry review queue' }))
      setQueueError(message)
      if (!append) toast.error(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [actionFilter, confidenceFilter, effectiveQueueStatus, requestJson, riskFilter, t])

  const loadHistory = useCallback(async (): Promise<IndustryHistoryItem[] | null> => {
    setHistoryLoading(true)
    setHistoryError(undefined)
    setHistoryPartial(false)
    try {
      const paths = TERMINAL_INDUSTRY_PROPOSAL_STATUSES.map(
        (status) => `/api/company-industry-proposals?status=${status}`,
      )
      const results = await Promise.allSettled(paths.map((path) => requestJson(path)))
      const fulfilledResponses = results.flatMap((result) => (
        result.status === 'fulfilled' ? [result.value] : []
      ))
      const hasFailedRequests = results.some((result) => result.status === 'rejected')
      const fetchedItems = fulfilledResponses.flatMap(parseHistory)

      if (!hasFailedRequests) {
        const next = uniqueHistory(fetchedItems)
        setHistoryItems(next)
        setHistoryLoaded(true)
        return next
      }

      setHistoryItems((current) => uniqueHistory([...fetchedItems, ...current]))
      if (fulfilledResponses.length > 0) {
        setHistoryLoaded(true)
        setHistoryPartial(true)
        setHistoryError(t('industryEvidence.historyPartialLoadFailed', {
          defaultValue: 'Some History records could not be loaded. Available records remain visible.',
        }))
      } else {
        setHistoryError(t('industryEvidence.historyUnavailable', {
          defaultValue: 'History is temporarily unavailable. The live review queue is still available.',
        }))
      }
      return null
    } catch (error) {
      setHistoryError(errorMessage(error, t('industryEvidence.historyUnavailable', {
        defaultValue: 'History is temporarily unavailable. The live review queue is still available.',
      })))
      return null
    } finally {
      setHistoryLoading(false)
    }
  }, [requestJson, t])

  useEffect(() => {
    if (targetPending || (targetIsTerminal && (activeFilter === 'history' || !hasExplicitFilter))) return
    void loadActiveQueue()
  }, [activeFilter, hasExplicitFilter, loadActiveQueue, targetIsTerminal, targetPending])

  useEffect(() => {
    if (!targetItem || targetIsTerminal) {
      syncedTargetStatusRef.current = undefined
      return
    }
    const targetKey = targetItem.proposal.proposalId
    if (syncedTargetStatusRef.current === targetKey) return
    syncedTargetStatusRef.current = targetKey
    setQueueStatus(targetItem.proposal.status)
    onQueueStatusChange(targetItem.proposal.status)
  }, [onQueueStatusChange, targetIsTerminal, targetItem])

  useEffect(() => {
    if (!targetItem || !targetIsTerminal || searchParams.has('filter')) return
    // A terminal target that was approved in this session stays in the queue
    // view (Undo affordance) until refresh — do not auto-redirect to History.
    if (sessionProposalIds.has(targetItem.proposal.proposalId)) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('filter', 'history')
    setSearchParams(nextParams, { replace: true })
  }, [sessionProposalIds, searchParams, setSearchParams, targetIsTerminal, targetItem])

  const changeQueueStatus = useCallback((status: ReviewQueueStatus) => {
    setQueueStatus(status)
    onQueueStatusChange(status)
  }, [onQueueStatusChange])

  const selectFilter = useCallback((filter: ReviewInboxFilter) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('filter', reviewInboxFilterToSlug(filter))
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const reload = useCallback(() => {
    void loadActiveQueue()
  }, [loadActiveQueue])

  useEffect(() => {
    if (activeFilter === 'history' && !historyLoaded && !historyLoading) {
      void loadHistory()
    }
  }, [activeFilter, historyLoaded, historyLoading, loadHistory])

  return {
    queueStatus,
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
    setQueueStatus,
    changeQueueStatus,
    selectFilter,
    loadActiveQueue,
    reload,
    historyItems,
    setHistoryItems,
    historyLoading,
    historyError,
    historyPartial,
    historyLoaded,
    loadHistory,
  }
}

// ---------------------------------------------------------------------------
// Hook 2: useIndustrySessionRegistry
// ---------------------------------------------------------------------------

export type UseIndustrySessionRegistryOptions = {
  sessionApprovals?: ReadonlyMap<string, SessionApproval>
  onSessionApprovalsChange?: Dispatch<SetStateAction<Map<string, SessionApproval>>>
  onFocusRow?: (proposalId: string) => void
}

export function useIndustrySessionRegistry(
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>,
  options?: UseIndustrySessionRegistryOptions,
) {
  const { t } = useTranslation()
  const [internalSessionApprovals, setInternalSessionApprovals] = useState<Map<string, SessionApproval>>(new Map())
  const sessionApprovals = options?.sessionApprovals ?? internalSessionApprovals
  const setSessionApprovals = options?.onSessionApprovalsChange ?? setInternalSessionApprovals
  const onFocusRow = options?.onFocusRow

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

  const invalidatePacketCache = useCallback((proposalId: string) => {
    setPacketCache((current) => {
      const next = new Map(current)
      next.delete(proposalId)
      return next
    })
  }, [])

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
      setPacketCache((current) => {
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
      setAnnouncement(t('industryEvidence.undoAvailableAnnouncement', {
        defaultValue: '{{company}} approved. Undo remains available until refresh.',
        company: displayCompany(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      toast.success(t('industryEvidence.approved', { defaultValue: 'Industry verdict revision approved' }))
      onFocusRow?.(proposalId)
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
  }, [clearRowError, loadPacket, onFocusRow, requestJson, setSessionApprovals, setRowError, t, updatePending])

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
        expectedCurrentRevisionId: approval.approvedRevisionId,
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
      setPacketCache((current) => {
        const next = new Map(current)
        next.delete(proposalId)
        return next
      })
      setAnnouncement(t('industryEvidence.undoSuccess', {
        defaultValue: '{{company}} restored to pending review.',
        company: displayCompany(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      toast.success(t('industryEvidence.undoSuccess', {
        defaultValue: 'Approval undone; proposal is ready for review again.',
        company: displayCompany(item.proposal.companyKey ?? item.proposal.normalizedEmployerSurface),
      }))
      onFocusRow?.(proposalId)
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
  }, [clearRowError, loadPacket, onFocusRow, requestJson, sessionApprovals, setSessionApprovals, setRowError, t, undoBlocked, updatePending])

  const handleRowRetry = useCallback((row: ReviewInboxRow) => {
    if (row.sessionApproval) void handleUndo(row.item)
    else void handleApprove(row.item)
  }, [handleApprove, handleUndo])

  const resetSession = useCallback(() => {
    setSessionApprovals(new Map())
    setPendingActions(new Map())
    setRowErrors(new Map())
    setForcedNeedsReview(new Set())
    setUndoBlocked(new Set())
  }, [setSessionApprovals])

  return {
    sessionApprovals,
    setSessionApprovals,
    pendingActions,
    updatePending,
    rowErrors,
    setRowError,
    clearRowError,
    forcedNeedsReview,
    setForcedNeedsReview,
    undoBlocked,
    setUndoBlocked,
    packetCache,
    loadPacket,
    invalidatePacketCache,
    announcement,
    setAnnouncement,
    handleApprove,
    handleUndo,
    handleRowRetry,
    resetSession,
  }
}

// ---------------------------------------------------------------------------
// Hook 3: useIndustryIdentityResolution
// ---------------------------------------------------------------------------

export type UseIndustryIdentityResolutionOptions = {
  loadPacket: (item: ReviewInboxItem) => Promise<CleanReviewPacket>
  invalidatePacketCache?: (proposalId: string) => void
  setRowError: (proposalId: string, error: ReviewRowError) => void
  setAnnouncement: (message: string) => void
  onSuccess?: (succeededProposalIds: string[]) => void
  onReloadQueue?: () => void
}

export function useIndustryIdentityResolution(
  requestJson: (path: string, init?: RequestInit) => Promise<unknown>,
  options: UseIndustryIdentityResolutionOptions,
) {
  const { t } = useTranslation()
  const {
    loadPacket,
    invalidatePacketCache,
    setRowError,
    setAnnouncement,
    onSuccess,
    onReloadQueue,
  } = options

  const [identityDialogOpen, setIdentityDialogOpen] = useState(false)
  const [identityDialogItems, setIdentityDialogItems] = useState<ReviewInboxItem[]>([])
  const [identityPackets, setIdentityPackets] = useState<Map<string, IdentityDialogPacket>>(new Map())
  const [identityPreparing, setIdentityPreparing] = useState(false)
  const [identitySubmitting, setIdentitySubmitting] = useState(false)
  const [registryCompanies, setRegistryCompanies] = useState<RegistryCompany[]>([])
  const [registryCompaniesLoading, setRegistryCompaniesLoading] = useState(false)
  const [identityTarget, setIdentityTarget] = useState<ReviewInboxItem>()

  const openIdentityDialog = useCallback(async (items: ReviewInboxItem[]) => {
    if (items.length === 0) return
    setIdentityPreparing(true)
    const packetMap = new Map<string, IdentityDialogPacket>()
    await Promise.allSettled(items.map(async (item) => {
      try {
        const packet = await loadPacket(item)
        packetMap.set(item.proposal.proposalId, {
          candidates: packet.identityCandidates,
          proposalUpdatedAt: packet.dataset.proposalUpdatedAt || item.proposal.updatedAt,
        })
      } catch {
        // Items without a loadable packet stay in the excluded group.
      }
    }))
    setIdentityPackets(packetMap)
    setIdentityDialogItems(items)
    setIdentityDialogOpen(true)
    setIdentityPreparing(false)
  }, [loadPacket])

  const openRegistryCompanies = useCallback(async () => {
    setRegistryCompaniesLoading(true)
    try {
      const payload = await requestJson('/api/companies')
      if (!isRecord(payload) || !Array.isArray(payload.items)) return
      setRegistryCompanies(payload.items.filter((item): item is RegistryCompany => (
        isRecord(item)
        && typeof item.companyKey === 'string'
        && typeof item.displayName === 'string'
        && item.status !== 'merged'
      )))
    } catch {
      // The provisional path remains available if the registry is degraded.
    } finally {
      setRegistryCompaniesLoading(false)
    }
  }, [requestJson])

  const openIdentityDialogFromRows = useCallback(async (items: ReviewInboxItem[]) => {
    void openIdentityDialog(items)
    void openRegistryCompanies()
  }, [openIdentityDialog, openRegistryCompanies])

  const handleRowResolveIdentity = useCallback(async (item: ReviewInboxItem) => {
    setIdentityTarget(item)
    await openIdentityDialogFromRows([item])
  }, [openIdentityDialogFromRows])

  const handleBatchResolveIdentity = useCallback(async (items: ReviewInboxItem[]) => {
    setIdentityTarget(undefined)
    await openIdentityDialogFromRows(items)
  }, [openIdentityDialogFromRows])

  const handleResolveIdentitySubmit = useCallback(async (actions: IdentityResolutionAction[]) => {
    if (actions.length === 0) return
    setIdentitySubmitting(true)
    const succeeded: string[] = []
    const failed: Array<{ proposalId: string; kind: InboxErrorKind; message: string }> = []
    for (const action of actions) {
      try {
        await requestJson(`/api/company-industry-proposals/${encodeURIComponent(action.proposalId)}/identity-resolution`, {
          method: 'POST',
          body: JSON.stringify(action),
        })
        succeeded.push(action.proposalId)
        invalidatePacketCache?.(action.proposalId)
      } catch (error) {
        failed.push({
          proposalId: action.proposalId,
          kind: rowErrorKind(errorStatus(error)),
          message: errorMessage(error, t('industryEvidence.identityResolveFailed', {
            defaultValue: 'Identity resolution failed.',
          })),
        })
      }
    }
    onSuccess?.(succeeded)
    setIdentityTarget(undefined)
    const summary = t('industryEvidence.identityResolveDone', {
      defaultValue: 'Identity resolution complete: {{resolved}} mapped, {{failed}} failed.',
      resolved: succeeded.length,
      failed: failed.length,
    })
    setAnnouncement(summary)
    if (failed.length > 0) {
      toast.warning(summary)
      for (const failure of failed) setRowError(failure.proposalId, { kind: failure.kind, message: failure.message })
    } else {
      toast.success(summary)
    }
    setIdentityDialogOpen(false)
    onReloadQueue?.()
  }, [invalidatePacketCache, onReloadQueue, onSuccess, requestJson, setAnnouncement, setRowError, t])

  return {
    identityDialogOpen,
    setIdentityDialogOpen,
    identityDialogItems,
    setIdentityDialogItems,
    identityPackets,
    setIdentityPackets,
    identityPreparing,
    identitySubmitting,
    registryCompanies,
    companiesLoading: registryCompaniesLoading,
    registryCompaniesLoading,
    identityTarget,
    setIdentityTarget,
    openIdentityDialog,
    openRegistryCompanies,
    openIdentityDialogFromRows,
    handleRowResolveIdentity,
    handleBatchResolveIdentity,
    handleResolveIdentitySubmit,
  }
}
