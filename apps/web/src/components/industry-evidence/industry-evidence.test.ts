import { describe, expect, it } from 'vitest'
import {
  getVerifiedIndustryEvidenceSummaries,
  selectPrimaryIndustryEvidence,
} from '@/components/industry-evidence/industry-evidence'

function summary(overrides: Record<string, unknown> = {}) {
  return {
    companyKey: 'acme-cnc',
    companyName: 'Acme CNC',
    industryClass: 'cnc',
    verificationLevel: 'verified',
    verdictRevisionId: 'revision-1',
    evidenceSummary: 'Approved CNC machinery manufacturer.',
    reviewedAt: Date.UTC(2026, 6, 20),
    verifiedYears: 3,
    roleTypes: ['service'],
    latestRoleAt: Date.UTC(2024, 0, 1),
    sourceCount: 1,
    sourcePreviews: [{
      sourceId: 'source-1',
      url: 'https://acme.example/about',
      sourceDomain: 'acme.example',
      sourceType: 'official_site',
      trustTier: 'primary',
      title: 'About Acme',
      evidenceExcerpt: 'Acme manufactures CNC machining centres.',
    }],
    ...overrides,
  }
}

describe('industry evidence selection', () => {
  it('accepts only safe, human-approved verified projections', () => {
    const result = getVerifiedIndustryEvidenceSummaries({
      ingestData: {
        verifiedIndustryEvidenceSummaries: [
          summary(),
          summary({
            companyKey: 'candidate-company',
            verdictRevisionId: 'candidate-revision',
            verificationLevel: 'candidate',
          }),
          summary({
            companyKey: 'unsafe-company',
            verdictRevisionId: 'unsafe-revision',
            sourcePreviews: [{
              sourceId: 'unsafe-source',
              url: 'javascript:alert(1)',
              sourceDomain: 'unsafe.example',
              sourceType: 'official_site',
              trustTier: 'primary',
            }],
          }),
        ],
      },
    })

    expect(result).toHaveLength(2)
    expect(result[0]?.companyKey).toBe('acme-cnc')
    expect(result[1]?.sourcePreviews).toEqual([])
  })

  it('prefers role relevance, then verified years, with deterministic ties', () => {
    const selected = selectPrimaryIndustryEvidence([
      summary({
        companyKey: 'more-years',
        companyName: 'More Years',
        verdictRevisionId: 'revision-more-years',
        verifiedYears: 8,
        roleTypes: ['service'],
      }),
      summary({
        companyKey: 'role-relevant-z',
        companyName: 'Zeta Role Relevant',
        verdictRevisionId: 'revision-role-z',
        verifiedYears: 4,
        roleTypes: ['sales'],
      }),
      summary({
        companyKey: 'role-relevant-a',
        companyName: 'Alpha Role Relevant',
        verdictRevisionId: 'revision-role-a',
        verifiedYears: 4,
        roleTypes: ['sales'],
      }),
    ], {
      preferredRoleTypes: ['sales'],
    })

    expect(selected?.primary.companyKey).toBe('role-relevant-a')
    expect(selected?.additionalVerifiedEmployerCount).toBe(2)
  })
})
