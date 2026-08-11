import { describe, expect, it } from 'vitest'

import {
  displayCompany,
  formatDate,
  formatRunLine,
  isCurrentMaintenanceFailure,
  parseCoverageSummary,
  parseItems,
  parseResearchSummary,
  parseReviewContext,
  parseReviewPacket,
  type CoverageMaintenanceRun,
} from './industry-verification-model'

describe('displayCompany', () => {
  it('falls back for missing input', () => {
    expect(displayCompany(undefined)).toBe('Unresolved employer')
    expect(displayCompany('')).toBe('Unresolved employer')
  })

  it('uppercases hyphen / underscore / space separated tokens', () => {
    expect(displayCompany('eonmetall-group')).toBe('EONMETALL GROUP')
    expect(displayCompany('lung_kee_metal')).toBe('LUNG KEE METAL')
    expect(displayCompany('vision machine tools')).toBe('VISION MACHINE TOOLS')
  })
})

describe('formatDate', () => {
  it('renders a dash for missing or non-finite values', () => {
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate(Number.NaN)).toBe('—')
    expect(formatDate(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('formats a valid epoch with medium date style', () => {
    const value = new Date(2026, 5, 15).getTime()
    expect(formatDate(value)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)))
  })
})

describe('parseItems', () => {
  it('returns [] for non-record payloads', () => {
    expect(parseItems<{ id: string }>(null)).toEqual([])
    expect(parseItems<{ id: string }>('nope')).toEqual([])
    expect(parseItems<{ id: string }>({ entries: [] })).toEqual([])
  })

  it('returns the raw items array', () => {
    expect(parseItems<{ id: string }>({ items: [{ id: 'a' }] })).toEqual([{ id: 'a' }])
  })
})

describe('parseReviewContext', () => {
  it('returns an empty bundle for invalid input', () => {
    expect(parseReviewContext(undefined)).toEqual({ profile: null, revisions: [] })
  })

  it('keeps valid profile and revisions', () => {
    const profile = { companyKey: 'acme', verificationLevel: 'verified' }
    const revisions = [{ revisionId: 'r1' }]
    expect(parseReviewContext({ profile, revisions })).toEqual({ profile, revisions })
  })
})

describe('parseResearchSummary', () => {
  it('returns feature-disabled fallback for invalid input', () => {
    expect(parseResearchSummary(null)).toEqual({ featureEnabled: false, active: null, history: [] })
  })

  it('drops malformed history entries and normalizes flags', () => {
    const result = parseResearchSummary({
      featureEnabled: true,
      active: null,
      history: [
        {
          requestId: 'req-1',
          proposalId: 'prop-1',
          origin: 'scheduled_sweep',
          state: 'queued',
          priority: 10,
          requestedAt: 1,
          demandCount: 2,
          attemptCount: 3,
          updatedAt: 4,
          canRetry: true,
          canCancel: false,
        },
        { requestId: 'broken' },
      ],
    })
    expect(result.featureEnabled).toBe(true)
    expect(result.history).toHaveLength(1)
    expect(result.history[0]).toMatchObject({
      requestId: 'req-1',
      state: 'queued',
      canRetry: true,
      canCancel: false,
    })
  })
})

describe('parseReviewPacket', () => {
  it('returns null when the envelope is incomplete', () => {
    expect(parseReviewPacket(null)).toBeNull()
    expect(parseReviewPacket({ proposal: {}, recommendation: {} })).toBeNull()
    expect(parseReviewPacket({ proposal: {}, recommendation: {}, dataset: {} })).toBeNull()
  })

  it('parses a valid packet and falls back to bundle for reviewContext', () => {
    const packet = parseReviewPacket({
      proposal: { proposalId: 'p1', status: 'ready_for_review' },
      recommendation: { recommendedAction: 'approve' },
      dataset: { inputFingerprint: 'fp-1', sourceVersions: [{ sourceId: 's1', updatedAt: 2 }, { sourceId: 3 }] },
      sources: [{ sourceId: 's1' }],
      bundle: { profile: { companyKey: 'acme' }, revisions: [] },
      recomputeRuns: [{ runId: 'run-1' }],
    })
    expect(packet).not.toBeNull()
    expect(packet?.dataset.inputFingerprint).toBe('fp-1')
    expect(packet?.dataset.sourceVersions).toEqual([{ sourceId: 's1', updatedAt: 2 }])
    expect(packet?.sources).toEqual([{ sourceId: 's1' }])
    expect(packet?.recomputeRuns).toEqual([{ runId: 'run-1' }])
    expect(packet?.reviewContext).toEqual({ profile: { companyKey: 'acme' }, revisions: [] })
  })
})

describe('parseCoverageSummary', () => {
  it('returns null for invalid payloads', () => {
    expect(parseCoverageSummary(null)).toBeNull()
    expect(parseCoverageSummary({ item: { openTotal: 5 } })).toBeNull()
  })

  it('defaults missing researchQueue fields and keeps the rest', () => {
    const summary = parseCoverageSummary({
      item: {
        generatedAt: 1,
        workspaceSlug: 'dev',
        proposalsByStatus: {},
        openTotal: 487,
        openWithSources: 0,
        openWithoutSources: 487,
        emptyEvidenceBottleneck: true,
        readyBacklogBottleneck: false,
        resumes: { total: 83, withVerifiedEvidence: 1 },
        profiles: { total: 9, verified: 4, rejected: 5 },
        maintenance: { latest: null, lastUseful: null, lastFailed: null },
      },
    })
    expect(summary?.openTotal).toBe(487)
    expect(summary?.researchQueue).toEqual({
      active: 0,
      queued: 0,
      leased: 0,
      retryWait: 0,
      needsIdentityReview: 0,
      failed: 0,
      byOrigin: {},
      oldestRequestedAt: null,
      oldestPriority: null,
      alerts: {
        oldestDirectDemandAgeMs: 0,
        highRetryRate: false,
        providerLimitedBacklog: 0,
        workerUnreachableRuns: 0,
      },
    })
  })
})

describe('formatRunLine', () => {
  it('renders a dash for missing runs', () => {
    expect(formatRunLine(null)).toBe('—')
    expect(formatRunLine(undefined)).toBe('—')
  })

  it('joins status, trigger, and counts', () => {
    const run: CoverageMaintenanceRun = {
      runId: 'run-1',
      status: 'completed',
      triggerSource: 'manual',
      counts: {
        proposalsResearched: 20,
        readyCreated: 0,
        sourcesDemoted: 0,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
    }
    expect(formatRunLine(run)).toBe('completed · manual · researched 20, ready 0')
  })
})

describe('isCurrentMaintenanceFailure', () => {
  const failedRun: CoverageMaintenanceRun = {
    runId: 'run-fail',
    status: 'failed',
    counts: {
      proposalsResearched: 0,
      readyCreated: 0,
      sourcesDemoted: 0,
      freshnessChecked: 0,
      freshnessRefreshed: 0,
      errors: 0,
    },
  }
  const newerRun: CoverageMaintenanceRun = {
    ...failedRun,
    runId: 'run-success',
    status: 'completed',
  }

  it('surfaces the failure when it is still the latest run', () => {
    expect(isCurrentMaintenanceFailure(null, failedRun)).toBe(true)
    expect(isCurrentMaintenanceFailure(failedRun, failedRun)).toBe(true)
  })

  it('hides a superseded failure', () => {
    expect(isCurrentMaintenanceFailure(newerRun, failedRun)).toBe(false)
    expect(isCurrentMaintenanceFailure(null, null)).toBe(false)
  })
})
