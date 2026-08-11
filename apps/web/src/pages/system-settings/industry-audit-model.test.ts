import { describe, expect, it } from 'vitest'
import {
  AUDIT_QUERY_LIMIT,
  DECISION_MODE_LABELS,
  formatAuditTimestamp,
  identityAuditRow,
  INDUSTRY_CLASS_LABELS,
  MAPPING_MODE_LABELS,
  REVIEWER_TYPE_LABELS,
  RISK_FLAG_CODES,
  RISK_FLAG_LABELS,
  riskFlagLabelKey,
  verdictAuditRow,
  VERIFICATION_LEVEL_LABELS,
  type IdentityResolutionAudit,
  type VerdictRevision,
} from './industry-audit-model'

const identityFixture: IdentityResolutionAudit = {
  auditId: 'audit-1',
  proposalId: 'proposal-a',
  workspaceSlug: 'hr',
  actor: '  hr.lead  ',
  candidateFingerprint: 'fp-1',
  mappingMode: 'existing',
  targetCompanyKey: ' eonmetall-group ',
  sourceIds: ['src-1', 'src-2', 'src-3'],
  previousProposalUpdatedAt: 1000,
  reviewNote: '  Legal name matches registry.  ',
  createdAt: 1710000000000,
}

const verdictFixture: VerdictRevision = {
  revisionId: 'rev-1',
  companyKey: ' eonmetall-group ',
  industryClass: 'cnc',
  verificationLevel: 'verified',
  approvedSourceIds: ['src-1'],
  evidenceSummary: 'Official site confirms CNC machinery.',
  reviewedBy: ' hr.lead ',
  reviewerType: 'human',
  reviewedAt: 1710000000000,
  decisionReason: ' Official site confirms CNC machinery. ',
  taxonomyVersion: 'v1',
  reviewAttestation: {
    schemaVersion: 'industry-review-attestation.v1',
    inputFingerprint: 'fp-x',
    decisionMode: 'risk_override',
    acknowledgedRiskFlags: ['weak_industry_signal', 'source_conflict'],
    cncEvidenceAcknowledged: true,
    acknowledgementReason: 'Reviewed durable primary sources.',
    batchId: ' batch-9 ',
  },
}

describe('identityAuditRow', () => {
  it('normalizes the display row from an audit doc', () => {
    const row = identityAuditRow(identityFixture)
    expect(row.actor).toBe('hr.lead')
    expect(row.mappingMode).toBe('existing')
    expect(row.targetCompanyKey).toBe('eonmetall-group')
    expect(row.proposalId).toBe('proposal-a')
    expect(row.sourceCount).toBe(3)
    expect(row.createdAt).toBe(1710000000000)
    expect(row.reviewNote).toBe('Legal name matches registry.')
  })

  it('defaults reviewNote to an empty string when absent', () => {
    const row = identityAuditRow({ ...identityFixture, reviewNote: undefined })
    expect(row.reviewNote).toBe('')
  })
})

describe('verdictAuditRow', () => {
  it('extracts attestation fields including batchId', () => {
    const row = verdictAuditRow(verdictFixture)
    expect(row.companyKey).toBe('eonmetall-group')
    expect(row.industryClass).toBe('cnc')
    expect(row.verificationLevel).toBe('verified')
    expect(row.reviewedBy).toBe('hr.lead')
    expect(row.reviewerType).toBe('human')
    expect(row.reviewedAt).toBe(1710000000000)
    expect(row.decisionMode).toBe('risk_override')
    expect(row.acknowledgedRiskFlags).toEqual(['weak_industry_signal', 'source_conflict'])
    expect(row.batchId).toBe('batch-9')
    expect(row.decisionReason).toBe('Official site confirms CNC machinery.')
  })

  it('returns empty strings and empty flags when attestation is absent', () => {
    const withoutAttestation = { ...verdictFixture }
    delete withoutAttestation.reviewAttestation
    const row = verdictAuditRow(withoutAttestation)
    expect(row.batchId).toBe('')
    expect(row.decisionMode).toBe('')
    expect(row.acknowledgedRiskFlags).toEqual([])
    expect(row.reviewerType).toBe('human')
  })

  it('treats a missing reviewerType as empty', () => {
    const withoutReviewerType = { ...verdictFixture }
    delete withoutReviewerType.reviewerType
    expect(verdictAuditRow(withoutReviewerType).reviewerType).toBe('')
  })
})

describe('formatAuditTimestamp', () => {
  it('formats an epoch-ms timestamp with date and seconds', () => {
    expect(formatAuditTimestamp(1710000000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe('riskFlagLabelKey', () => {
  it('maps a flag code to its i18n key under industryAudit.riskFlags', () => {
    expect(riskFlagLabelKey('source_conflict')).toBe('industryAudit.riskFlagLabels.source_conflict')
    expect(riskFlagLabelKey('recompute_pending')).toBe('industryAudit.riskFlagLabels.recompute_pending')
  })

  it('covers every known risk flag code with an English fallback label', () => {
    for (const code of RISK_FLAG_CODES) {
      expect(RISK_FLAG_LABELS[code]).toBeTruthy()
    }
  })
})

describe('label fallback maps', () => {
  it('cover every industry class', () => {
    for (const value of ['cnc', 'automation', 'metrology', 'industrial', 'non_industry', 'unknown']) {
      expect(INDUSTRY_CLASS_LABELS[value]).toBeTruthy()
    }
  })

  it('cover verification levels, decision modes, reviewer types, and mapping modes', () => {
    expect(VERIFICATION_LEVEL_LABELS.verified).toBe('Verified')
    expect(VERIFICATION_LEVEL_LABELS.rejected).toBe('Rejected')
    expect(DECISION_MODE_LABELS.standard).toBe('Standard')
    expect(DECISION_MODE_LABELS.risk_override).toBe('Risk override')
    expect(REVIEWER_TYPE_LABELS.human).toBe('Human')
    expect(REVIEWER_TYPE_LABELS['auto-verify-bot']).toBe('Auto-verify bot')
    expect(MAPPING_MODE_LABELS.existing).toBe('Existing company')
    expect(MAPPING_MODE_LABELS.create_provisional).toBe('Provisional company')
  })
})

describe('AUDIT_QUERY_LIMIT', () => {
  it('defaults to 100 rows per query', () => {
    expect(AUDIT_QUERY_LIMIT).toBe(100)
  })
})
