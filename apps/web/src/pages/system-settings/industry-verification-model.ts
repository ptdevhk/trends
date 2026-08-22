import {
  isIndustryEvidenceResearchFailureCode,
  isIndustryEvidenceResearchOrigin,
  isIndustryEvidenceResearchState,
  type IndustryReviewRecommendation,
  type IndustryReviewWarning,
} from '@trends/shared'
import type { paths } from '@/lib/api-types'

type ProposalListResponse = paths['/api/company-industry-proposals']['get']['responses'][200]['content']['application/json']
export type IndustryProposal = ProposalListResponse['items'][number]
type EvidenceSourceListResponse = paths['/api/company-industry-evidence-sources']['get']['responses'][200]['content']['application/json']
export type EvidenceSource = EvidenceSourceListResponse['items'][number]
type IndustryBundleResponse = paths['/api/company-industry-bundles/:companyKey']['get']['responses'][200]['content']['application/json']
export type IndustryBundle = Pick<IndustryBundleResponse, 'profile' | 'revisions' | 'sources'>
export type IndustryRevision = IndustryBundle['revisions'][number]
type IndustryRecomputeListResponse = paths['/api/company-industry-recompute-runs']['get']['responses'][200]['content']['application/json']
export type IndustryRecomputeRun = IndustryRecomputeListResponse['items'][number]
export type IndustryClass = NonNullable<IndustryProposal['suggestedIndustryClass']>
export type VerificationLevel = Extract<NonNullable<IndustryProposal['suggestedVerificationLevel']>, 'verified' | 'rejected'>
export type ReviewQueueStatus = IndustryProposal['status']

type ReviewPacketResponse = paths['/api/company-industry-proposals/:proposalId/review-packet']['get']['responses'][200]['content']['application/json']
export type ReviewContext = Pick<ReviewPacketResponse['reviewContext'], 'profile' | 'revisions'>
export type ReviewPacket = Pick<ReviewPacketResponse, 'proposal' | 'recommendation' | 'warnings' | 'dataset' | 'sources' | 'reviewContext' | 'recomputeRuns' | 'research' | 'identityCandidates'>
export type DetailBundle = ReviewContext

export const REVIEW_RISK_FLAG_LABELS: Record<string, string> = {
  canonical_mapping_missing: 'canonical company mapping is missing',
  only_discovery_sources: 'only discovery sources are attached',
  source_conflict: 'sources conflict on the industry class',
  weak_industry_signal: 'the industry signal is weak',
  cnc_claim_inferred: 'the CNC claim is inferred from keywords',
  stale_or_failed_source: 'a source is stale, unavailable, or failed',
  low_source_diversity: 'source diversity is low',
  worker_unreachable: 'the evidence worker was unreachable',
  recompute_pending: 'a targeted recompute is pending',
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseItems<T>(value: unknown): T[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items as T[]
}

export function parseBundle(value: unknown): IndustryBundle {
  if (!isRecord(value)) return { profile: null, revisions: [], sources: [] }
  return {
    profile: isRecord(value.profile) ? value.profile as IndustryBundle['profile'] : null,
    revisions: Array.isArray(value.revisions) ? value.revisions as IndustryRevision[] : [],
    sources: Array.isArray(value.sources) ? value.sources as EvidenceSource[] : [],
  }
}

export function parseReviewContext(value: unknown): DetailBundle {
  if (!isRecord(value)) return { profile: null, revisions: [] }
  return {
    profile: isRecord(value.profile) ? value.profile as DetailBundle['profile'] : null,
    revisions: Array.isArray(value.revisions) ? value.revisions as DetailBundle['revisions'] : [],
  }
}

export function parseResearchSummary(value: unknown): ReviewPacket['research'] {
  const fallback: ReviewPacket['research'] = { featureEnabled: false, active: null, history: [] }
  if (!isRecord(value)) return fallback
  const parseRequest = (item: unknown): NonNullable<ReviewPacket['research']['active']> | null => {
    if (!isRecord(item)) return null
    if (
      typeof item.requestId !== 'string'
      || typeof item.proposalId !== 'string'
      || !isIndustryEvidenceResearchOrigin(item.origin)
      || !isIndustryEvidenceResearchState(item.state)
      || typeof item.priority !== 'number'
      || typeof item.requestedAt !== 'number'
      || typeof item.demandCount !== 'number'
      || typeof item.attemptCount !== 'number'
      || typeof item.updatedAt !== 'number'
    ) return null
    return {
      requestId: item.requestId,
      proposalId: item.proposalId,
      origin: item.origin,
      state: item.state,
      priority: item.priority,
      requestedAt: item.requestedAt,
      demandCount: item.demandCount,
      attemptCount: item.attemptCount,
      ...(typeof item.nextAttemptAt === 'number' ? { nextAttemptAt: item.nextAttemptAt } : {}),
      ...(typeof item.leaseExpiresAt === 'number' ? { leaseExpiresAt: item.leaseExpiresAt } : {}),
      ...(typeof item.lastRunId === 'string' ? { lastRunId: item.lastRunId } : {}),
      ...(typeof item.lastOutcome === 'string' ? { lastOutcome: item.lastOutcome } : {}),
      ...(isIndustryEvidenceResearchFailureCode(item.lastErrorCode) ? { lastErrorCode: item.lastErrorCode } : {}),
      updatedAt: item.updatedAt,
      canRetry: item.canRetry === true,
      canCancel: item.canCancel === true,
    }
  }
  const history = Array.isArray(value.history)
    ? value.history.map(parseRequest).filter((item): item is NonNullable<typeof item> => item !== null)
    : []
  return {
    featureEnabled: value.featureEnabled === true,
    active: parseRequest(value.active),
    history,
  }
}

export function parseIdentityCandidates(value: unknown): ReviewPacket['identityCandidates'] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ReviewPacket['identityCandidates'][number] => (
    isRecord(item)
    && typeof item.candidateFingerprint === 'string'
    && typeof item.proposalId === 'string'
    && typeof item.normalizedLegalName === 'string'
    && Array.isArray(item.sourceIds)
    && item.sourceIds.every((sourceId) => typeof sourceId === 'string')
    && typeof item.confidence === 'number'
    && Array.isArray(item.conflictCodes)
    && item.conflictCodes.every((code) => typeof code === 'string')
    && (item.reviewState === 'candidate' || item.reviewState === 'reviewed' || item.reviewState === 'rejected' || item.reviewState === 'needs_more_evidence')
    && typeof item.extractionVersion === 'string'
    && typeof item.createdAt === 'number'
    && typeof item.updatedAt === 'number'
  )) as ReviewPacket['identityCandidates']
}

export function parseReviewPacket(value: unknown): ReviewPacket | null {
  if (!isRecord(value) || !isRecord(value.proposal) || !isRecord(value.recommendation)) return null
  if (!isRecord(value.dataset) || typeof value.dataset.inputFingerprint !== 'string') return null
  return {
    proposal: value.proposal as IndustryProposal,
    recommendation: value.recommendation as unknown as IndustryReviewRecommendation,
    warnings: Array.isArray(value.warnings) ? value.warnings as IndustryReviewWarning[] : [],
    dataset: {
      revision: typeof value.dataset.revision === 'string' ? value.dataset.revision : '',
      inputFingerprint: value.dataset.inputFingerprint,
      generatedAt: typeof value.dataset.generatedAt === 'number' ? value.dataset.generatedAt : 0,
      proposalUpdatedAt: typeof value.dataset.proposalUpdatedAt === 'number' ? value.dataset.proposalUpdatedAt : 0,
      sourceVersions: Array.isArray(value.dataset.sourceVersions)
        ? value.dataset.sourceVersions.filter((item): item is { sourceId: string; updatedAt: number } => (
          isRecord(item) && typeof item.sourceId === 'string' && typeof item.updatedAt === 'number'
        ))
        : [],
    },
    sources: parseItems<EvidenceSource>({ items: value.sources }),
    reviewContext: parseReviewContext(value.reviewContext ?? value.bundle),
    recomputeRuns: parseItems<IndustryRecomputeRun>({ items: value.recomputeRuns }),
    research: parseResearchSummary(value.research),
    identityCandidates: parseIdentityCandidates(value.identityCandidates),
  }
}

export function displayCompany(value: string | undefined): string {
  if (!value) return 'Unresolved employer'
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase())
    .join(' ')
}

export function formatDate(value: number | undefined, locale?: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(locale ?? undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export function createRevisionId(companyKey: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `industry-${companyKey}-${suffix}`
}

export type MaintenanceRun = {
  runId: string
  triggerSource?: string
  status?: string
  operatorSummary?: string
  startedAt?: number
}

export type MaintenanceLedgerRow = {
  proposalId: string
  action: string
  reason: string
  companyKey?: string
}

export const LEDGER_ACTION_TONES: Record<string, string> = {
  ready: 'bg-green-100 text-green-800',
  demoted: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  needs_more_evidence: 'bg-amber-100 text-amber-800',
}

export type ReviewedProfileSummary = {
  companyKey: string
  companyName?: string
  verificationLevel?: string
  industryClass?: string
}

export type CoverageMaintenanceRun = {
  runId: string
  status?: string
  triggerSource?: string
  triggerContext?: string
  operatorSummary?: string
  failureMessage?: string
  partial?: boolean
  startedAt?: number
  finishedAt?: number
  counts: {
    proposalsResearched: number
    readyCreated: number
    sourcesDemoted: number
    freshnessChecked: number
    freshnessRefreshed: number
    errors: number
  }
}

export type IndustryCoverageSummary = {
  generatedAt: number
  workspaceSlug: string
  proposalsByStatus: Record<string, number>
  openTotal: number
  openWithSources: number
  openWithoutSources: number
  emptyEvidenceBottleneck: boolean
  readyBacklogBottleneck: boolean
  resumes: {
    total: number
    withVerifiedEvidence: number
  }
  profiles: {
    total: number
    verified: number
    rejected: number
  }
  maintenance: {
    latest: CoverageMaintenanceRun | null
    lastUseful: CoverageMaintenanceRun | null
    lastFailed: CoverageMaintenanceRun | null
  }
  researchQueue: {
    active: number
    queued: number
    leased: number
    retryWait: number
    needsIdentityReview: number
    failed: number
    byOrigin: Record<string, number>
    oldestRequestedAt: number | null
    oldestPriority: number | null
    alerts: {
      oldestDirectDemandAgeMs: number
      highRetryRate: boolean
      providerLimitedBacklog: number
      workerUnreachableRuns: number
    }
  }
}

export const PIPELINE_STATUS_ORDER = [
  'new',
  'researching',
  'ready_for_review',
  'needs_more_evidence',
  'approved',
  'rejected',
] as const

export const PIPELINE_STATUS_LABELS: Record<(typeof PIPELINE_STATUS_ORDER)[number], string> = {
  new: 'new',
  researching: 'researching',
  ready_for_review: 'ready',
  needs_more_evidence: 'needs evidence',
  approved: 'approved',
  rejected: 'rejected',
}

export const PIPELINE_STATUS_TONES: Record<(typeof PIPELINE_STATUS_ORDER)[number], string> = {
  new: 'border-slate-300 bg-slate-50 text-slate-800',
  researching: 'border-sky-300 bg-sky-50 text-sky-900',
  ready_for_review: 'border-green-300 bg-green-50 text-green-900',
  needs_more_evidence: 'border-amber-300 bg-amber-50 text-amber-900',
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  rejected: 'border-rose-300 bg-rose-50 text-rose-900',
}

export function parseCoverageSummary(value: unknown): IndustryCoverageSummary | null {
  if (!isRecord(value)) return null
  const item = isRecord(value.item) ? value.item : value
  if (!isRecord(item)) return null
  if (typeof item.generatedAt !== 'number' || typeof item.openTotal !== 'number') return null
  if (!isRecord(item.resumes) || !isRecord(item.profiles) || !isRecord(item.maintenance)) return null
  const queue = isRecord(item.researchQueue) ? item.researchQueue : {}
  return {
    ...(item as unknown as Omit<IndustryCoverageSummary, 'researchQueue'>),
    researchQueue: {
      active: typeof queue.active === 'number' ? queue.active : 0,
      queued: typeof queue.queued === 'number' ? queue.queued : 0,
      leased: typeof queue.leased === 'number' ? queue.leased : 0,
      retryWait: typeof queue.retryWait === 'number' ? queue.retryWait : 0,
      needsIdentityReview: typeof queue.needsIdentityReview === 'number' ? queue.needsIdentityReview : 0,
      failed: typeof queue.failed === 'number' ? queue.failed : 0,
      byOrigin: isRecord(queue.byOrigin)
        ? Object.fromEntries(Object.entries(queue.byOrigin).filter(([, value]) => typeof value === 'number')) as Record<string, number>
        : {},
      oldestRequestedAt: typeof queue.oldestRequestedAt === 'number' ? queue.oldestRequestedAt : null,
      oldestPriority: typeof queue.oldestPriority === 'number' ? queue.oldestPriority : null,
      alerts: {
        oldestDirectDemandAgeMs: isRecord(queue.alerts) && typeof queue.alerts.oldestDirectDemandAgeMs === 'number' ? queue.alerts.oldestDirectDemandAgeMs : 0,
        highRetryRate: isRecord(queue.alerts) && queue.alerts.highRetryRate === true,
        providerLimitedBacklog: isRecord(queue.alerts) && typeof queue.alerts.providerLimitedBacklog === 'number' ? queue.alerts.providerLimitedBacklog : 0,
        workerUnreachableRuns: isRecord(queue.alerts) && typeof queue.alerts.workerUnreachableRuns === 'number' ? queue.alerts.workerUnreachableRuns : 0,
      },
    },
  }
}

export function formatRunLine(run: CoverageMaintenanceRun | null | undefined): string {
  if (!run) return '—'
  const parts = [
    run.status ?? 'unknown',
    run.triggerSource ? `· ${run.triggerSource}` : null,
    run.counts
      ? `· researched ${run.counts.proposalsResearched}, ready ${run.counts.readyCreated}`
      : null,
  ].filter(Boolean)
  return parts.join(' ')
}

export function isCurrentMaintenanceFailure(
  latest: CoverageMaintenanceRun | null,
  lastFailed: CoverageMaintenanceRun | null,
): boolean {
  if (!lastFailed) return false
  // `lastFailed` is historical by design. Only surface the red alert when
  // that failed run is still the latest run; a newer completed run means the
  // failure has been superseded and remains available in run history.
  return latest === null || latest.runId === lastFailed.runId
}
