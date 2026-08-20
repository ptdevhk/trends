import { describe, expect, it } from 'vitest'

import en from './locales/en.json'
import zhHans from './locales/zh-Hans.json'
import zhHant from './locales/zh-Hant.json'

const LOCALES: Record<string, Record<string, unknown>> = {
  en,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
}

// Mirrors i18next key resolution: try the whole remaining path as a literal
// key first (locale JSON stores dotted keys flat, e.g. "riskFlag.source_conflict"),
// then fall back to walking nested objects segment by segment.
function lookupPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  let remaining = path
  while (remaining !== '') {
    if (typeof current !== 'object' || current === null) return undefined
    const record = current as Record<string, unknown>
    if (remaining in record) return record[remaining]
    const dot = remaining.indexOf('.')
    if (dot === -1) return undefined
    const segment = remaining.slice(0, dot)
    current = record[segment]
    remaining = remaining.slice(dot + 1)
  }
  return current
}

// Keys localized for the industry review detail pane, the attestation form
// card, and the industry evidence summary components.
const KEYS: Record<string, string> = {
  'industryEvidence.detailCurrentVerdict': 'Current verdict',
  'industryEvidence.detailNoApprovedRevision': 'No approved revision',
  'industryEvidence.detailCurrentRevision': 'Current revision',
  'industryEvidence.detailFreshness': 'Freshness',
  'industryEvidence.detailNotRecorded': 'Not recorded',
  'industryEvidence.recommendationTitle': 'Review recommendation',
  'industryEvidence.recommendationAdvisory':
    'Advisory only. A human must confirm the exact evidence and verdict.',
  'industryEvidence.recommendationConfidence': '{{band}} confidence',
  'industryEvidence.recommendationInspectEvidence':
    'Inspect the attached evidence before deciding.',
  'industryEvidence.recommendationReviewFlags': 'Review flags',
  'industryEvidence.recommendationSuggestedClass': 'Suggested class',
  'industryEvidence.recommendationSuggestedSources': 'Suggested sources',
  'industryEvidence.recommendationPacketFingerprint': 'Packet fingerprint',
  'industryEvidence.acknowledgeRiskFlag': 'Acknowledge {{flag}}',
  'industryEvidence.riskFlag.canonical_mapping_missing': 'Canonical company mapping missing',
  'industryEvidence.riskFlag.only_discovery_sources': 'Only discovery sources attached',
  'industryEvidence.riskFlag.source_conflict': 'Sources conflict on industry class',
  'industryEvidence.riskFlag.weak_industry_signal': 'Weak industry signal',
  'industryEvidence.riskFlag.cnc_claim_inferred': 'CNC claim inferred from keywords',
  'industryEvidence.riskFlag.stale_or_failed_source': 'Source stale, unreachable, or failed',
  'industryEvidence.riskFlag.low_source_diversity': 'Low source diversity',
  'industryEvidence.riskFlag.worker_unreachable': 'Evidence worker unreachable',
  'industryEvidence.riskFlag.recompute_pending': 'Targeted recompute pending',
  'industryEvidence.recomputeEmpty': 'No targeted recompute run yet.',
  'industryEvidence.recomputeAdvance': 'Advance',
  'industryEvidence.recomputeRetry': 'Retry',
  'industryEvidence.evidenceEmpty': 'No evidence sources attached.',
  'industryEvidence.selectEvidenceSource': 'Select evidence source {{title}}',
  'industryEvidence.sourceRecommended': 'Recommended',
  'industryEvidence.fetchedOn': 'Fetched {{date}}',
  'industryEvidence.revisionHistoryEmpty': 'No immutable revisions yet.',
  'industryEvidence.terminalReadOnlyNotice':
    'This proposal is in terminal history. Its evidence and immutable revision history are read-only.',
  'industryEvidence.verdict': 'Verdict',
  'industryEvidence.suggestedSuffix': '(Suggested)',
  'industryEvidence.industryClassLabel': 'Industry class',
  'industryEvidence.evidenceSummaryLabel': 'Evidence summary',
  'industryEvidence.decisionReasonLabel': 'Decision reason',
  'industryEvidence.confirmImmutableTitle': 'Confirm this immutable revision',
  'industryEvidence.approving':
    'You are approving {{industryClass}} as {{verificationLevel}} for {{company}}.',
  'industryEvidence.approvingSources':
    'Sources: {{sourceIds}} · this will create a new revision and start targeted recompute.',
  'industryEvidence.approvingFlagsRemain': 'Review flags remain: {{flags}}',
  'industryEvidence.confirmApprove': 'Confirm approve revision',
  'industryEvidence.taxonomyVersionLabel': 'Taxonomy version',
  'industryEvidence.detailReviewNoteLabel': 'Review note (for reject / more evidence)',
  'industryEvidence.approveRevision': 'Approve revision',
  'industryEvidence.requestMoreEvidence': 'Request more evidence',
  'industryEvidence.rejectProposal': 'Reject proposal',
  'industryEvidence.requestMoreEvidenceNote':
    '“Request more evidence” records the human review disposition only. Use “Research & verify employer” above to queue the guarded worker.',
  'industryEvidence.sourceType.official_site': 'Official',
  'industryEvidence.sourceType.registry': 'SSM / MSIC',
  'industryEvidence.sourceType.taxonomy': 'Taxonomy',
  'industryEvidence.sourceType.oem_partner': 'OEM',
  'industryEvidence.sourceType.trade_body': 'Trade body',
  'industryEvidence.sourceType.directory': 'Directory',
  'industryEvidence.sourceType.reporting': 'Reporting',
  'industryEvidence.sourceType.other': 'Reviewed',
  'industryEvidence.trustTier.primary': 'Trusted primary source',
  'industryEvidence.trustTier.authoritative': 'Trusted authoritative source',
  'industryEvidence.trustTier.corroborating': 'Reviewed corroborating source',
  'industryEvidence.sourceAccessibleName': '{{label}} source from {{domain}}',
  'industryEvidence.sourceTitleFallback': '{{label}} evidence',
  'industryEvidence.noExcerpt': 'Reviewed source; no excerpt is available.',
  'industryEvidence.humanApproved': 'Human approved',
  'industryEvidence.reviewedOn': 'Reviewed {{date}}',
  'industryEvidence.openSource': 'Open source',
  'industryEvidence.openOfficialWebsite': 'Open official website for {{companyName}}',
  'industryEvidence.verifiedPathHuman':
    'Human-verified by {{reviewer}} based on {{count}} approved evidence source(s).',
  'industryEvidence.verifiedPathHumanWithDate':
    'Human-verified by {{reviewer}} based on {{count}} approved evidence source(s) on {{date}}.',
  'industryEvidence.verifiedPathAuto':
    'Auto-verified {{industry}} industry employer based on {{count}} corroborating evidence source(s).',
  'industryEvidence.filterByCompany': 'Click to filter candidate search by this company',
  'industryEvidence.approvedEvidenceFor': 'Approved industry evidence for {{companyName}}',
  'industryEvidence.industryVerifiedStatus': '{{industry}} Industry Verification Status',
  'industryEvidence.verificationStatusDescription':
    'Confirms registered manufacturing & enterprise capabilities for candidate search filtering.',
  'industryEvidence.industryField': 'Industry:',
  'industryEvidence.approvedSourcesLabel': 'Approved sources:',
  'industryEvidence.relevantRoles': 'Relevant roles:',
  'industryEvidence.verifiedYears': '{{count}} verified years',
  'industryEvidence.verifiedYearsTitle': 'Verified Experience Duration',
  'industryEvidence.verifiedYearsDescription':
    'Calculated from {{years}} years of candidate work history at this confirmed {{industry}} industry employer.',
  'industryEvidence.additionalSources': '+{{count}} sources',
  'industryEvidence.sourceCountLabel': '{{count}} approved {{sources}}',
  'industryEvidence.reviewedDateSuffix': ' · reviewed {{date}}',
  'industryEvidence.additionalEmployers': '+{{count}} {{employers}}',
  'industryEvidence.verifiedEmployerOne': 'verified employer',
  'industryEvidence.verifiedEmployerOther': 'verified employers',
  'industryEvidence.detailHeading': 'Approved industry evidence',
  'industryEvidence.detailDescription':
    'Human-reviewed evidence materialized with this resume. No live web research runs on this page.',
  'industryEvidence.verifiedBadge': '{{industry}} Industry Verification',
  'industryEvidence.requestRefresh': 'Request refresh',
  'industryEvidence.requestRefreshFor': 'Request refresh for {{companyName}}',
  'industryEvidence.requesting': 'Requesting…',
  'industryEvidence.requested': 'Requested',
  'industryEvidence.refreshRequested': 'Refresh requested',
  'industryEvidence.refreshError':
    'Refresh request could not be submitted. The approved verdict remains unchanged.',
  'industryEvidence.detailApprovedRevision': 'Approved revision',
  'industryEvidence.detailReviewed': 'Reviewed',
  'industryEvidence.detailReviewer': 'Reviewer',
  'industryEvidence.detailCurrentApproved': 'Current approved evidence',
  'industryEvidence.detailCanonicalCompany': 'Canonical company',
  'industryEvidence.detailRevisionId': 'Revision ID',
  'industryEvidence.approvedSourcesTitle': 'Approved sources',
  'industryEvidence.sourcePreviewsUnavailable':
    'Source previews are not available in this materialized projection.',
  'industryEvidence.additionalApprovedSources': '{{count}} additional approved {{sources}}',
}

// Keys whose zh values legitimately contain no CJK (proper nouns / ASCII terms).
const ZH_CJK_SKIP = new Set([
  'industryEvidence.sourceType.registry',
  'industryEvidence.sourceType.oem_partner',
])

describe('industry review detail + evidence summary i18n keys', () => {
  it('resolves every key to a non-empty string in all locales', () => {
    const missing: string[] = []
    for (const path of Object.keys(KEYS)) {
      for (const [localeName, locale] of Object.entries(LOCALES)) {
        const value = lookupPath(locale, path)
        if (typeof value !== 'string' || value.trim() === '') {
          missing.push(`${path} (${localeName})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('matches the exact English values', () => {
    const mismatches: string[] = []
    for (const [path, enValue] of Object.entries(KEYS)) {
      const value = lookupPath(LOCALES.en, path)
      if (value !== enValue) {
        mismatches.push(`${path}: expected "${enValue}", got "${String(value)}"`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('localizes zh values to CJK text (no untranslated English leftovers)', () => {
    const ascii: string[] = []
    for (const path of Object.keys(KEYS)) {
      if (ZH_CJK_SKIP.has(path)) continue
      for (const localeName of ['zh-Hans', 'zh-Hant'] as const) {
        const value = lookupPath(LOCALES[localeName], path)
        if (typeof value !== 'string' || !/[\u4e00-\u9fff]/.test(value)) {
          ascii.push(`${path} (${localeName})`)
        }
      }
    }
    expect(ascii).toEqual([])
  })
})
