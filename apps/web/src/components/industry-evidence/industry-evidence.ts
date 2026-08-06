import {
  parseVerifiedIndustryEvidenceSummary,
  type VerifiedIndustryEvidenceSummary,
} from '@trends/shared'
import type { ResumeMatchedWorkEntry, ResumeRoleSignalLike } from '@/lib/resume-scoring'

export type IndustryEvidenceProvenance = 'none' | 'legacy' | 'stale' | 'approved'

type ApprovedEvidenceRevision = Pick<
  VerifiedIndustryEvidenceSummary,
  'companyKey' | 'verdictRevisionId'
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type PrimaryIndustryEvidenceSelection = {
  primary: VerifiedIndustryEvidenceSummary
  additionalVerifiedEmployerCount: number
}

function normalizeRoleType(value: string): string {
  return value.trim().toLowerCase()
}

const approvedEvidenceKeyCache = new WeakMap<object, ReadonlySet<string>>()

const INDUSTRY_EVIDENCE_PROVENANCE_PRIORITY: Record<IndustryEvidenceProvenance, number> = {
  none: 0,
  stale: 1,
  legacy: 2,
  approved: 3,
}

function getApprovedEvidenceKey(companyKey: string, verdictRevisionId: string): string {
  return `${companyKey.trim().toLowerCase()}\u0000${verdictRevisionId.trim()}`
}

function getApprovedEvidenceKeys(
  summaries: readonly ApprovedEvidenceRevision[],
): ReadonlySet<string> {
  const cached = approvedEvidenceKeyCache.get(summaries)
  if (cached) {
    return cached
  }

  const keys = new Set<string>()
  for (const summary of summaries) {
    keys.add(getApprovedEvidenceKey(summary.companyKey, summary.verdictRevisionId))
  }
  approvedEvidenceKeyCache.set(summaries, keys)
  return keys
}

export function mergeIndustryEvidenceProvenance(
  current: IndustryEvidenceProvenance,
  next: IndustryEvidenceProvenance,
): IndustryEvidenceProvenance {
  return INDUSTRY_EVIDENCE_PROVENANCE_PRIORITY[next] > INDUSTRY_EVIDENCE_PROVENANCE_PRIORITY[current]
    ? next
    : current
}

export function getIndustryEvidenceWorkEntryFingerprint(
  workEntry: Pick<
    ResumeMatchedWorkEntry,
    'companyKey' | 'verdictRevisionId' | 'workEntryFingerprint' | 'years'
  >,
): string {
  const fingerprint = workEntry.workEntryFingerprint?.trim()
  if (fingerprint) {
    return fingerprint
  }
  return `${workEntry.companyKey?.trim().toLowerCase() ?? ''}\u0000${workEntry.verdictRevisionId?.trim() ?? ''}\u0000${workEntry.years}`
}

/**
 * The historical `industryVerified` boolean is only a rules signal. A green
 * evidence state requires the entry's company/revision pair to be present in
 * the current materialized human-approved summaries.
 */
export function getMatchedWorkEntryIndustryEvidenceProvenance(
  workEntry: Pick<
    ResumeMatchedWorkEntry,
    'companyKey' | 'directRoleMatch' | 'industryVerified' | 'verdictRevisionId'
  >,
  summaries: readonly ApprovedEvidenceRevision[],
): IndustryEvidenceProvenance {
  if (!workEntry.industryVerified) {
    return 'none'
  }

  const verdictRevisionId = workEntry.verdictRevisionId?.trim()
  if (!verdictRevisionId) {
    return 'legacy'
  }

  const companyKey = workEntry.companyKey?.trim()
  if (!companyKey) {
    return 'stale'
  }

  if (!getApprovedEvidenceKeys(summaries).has(
    getApprovedEvidenceKey(companyKey, verdictRevisionId),
  )) {
    return 'stale'
  }

  return workEntry.directRoleMatch === true ? 'approved' : 'none'
}

export function getRoleSignalIndustryEvidenceProvenance(
  signal: Pick<ResumeRoleSignalLike, 'matchedWorkEntries'>,
  summaries: readonly ApprovedEvidenceRevision[],
): IndustryEvidenceProvenance {
  let provenance: IndustryEvidenceProvenance = 'none'

  for (const workEntry of signal.matchedWorkEntries ?? []) {
    provenance = mergeIndustryEvidenceProvenance(
      provenance,
      getMatchedWorkEntryIndustryEvidenceProvenance(workEntry, summaries),
    )
    if (provenance === 'approved') {
      return 'approved'
    }
  }

  return provenance
}

export function getRoleSignalApprovedIndustryYears(
  signal: Pick<ResumeRoleSignalLike, 'matchedWorkEntries'>,
  summaries: readonly ApprovedEvidenceRevision[],
): number {
  const seenFingerprints = new Set<string>()
  return (signal.matchedWorkEntries ?? []).reduce((total, workEntry) => {
    if (getMatchedWorkEntryIndustryEvidenceProvenance(workEntry, summaries) !== 'approved') {
      return total
    }
    const fingerprint = getIndustryEvidenceWorkEntryFingerprint(workEntry)
    if (seenFingerprints.has(fingerprint)) {
      return total
    }
    seenFingerprints.add(fingerprint)
    return total + (Number.isFinite(workEntry.years) ? Math.max(workEntry.years, 0) : 0)
  }, 0)
}

export function hasLegacyIndustryEvidenceInSignals(
  roleSignals: readonly Pick<ResumeRoleSignalLike, 'matchedWorkEntries'>[] | undefined,
  summaries: readonly ApprovedEvidenceRevision[],
): boolean {
  return (roleSignals ?? []).some((roleSignal) =>
    getRoleSignalIndustryEvidenceProvenance(roleSignal, summaries) === 'legacy',
  )
}

function roleRelevance(
  summary: VerifiedIndustryEvidenceSummary,
  preferredRoleTypes: ReadonlySet<string>,
): number {
  if (preferredRoleTypes.size === 0) {
    return 0
  }

  return summary.roleTypes?.some((roleType) =>
    preferredRoleTypes.has(normalizeRoleType(roleType)),
  ) ? 1 : 0
}

export function getVerifiedIndustryEvidenceSummaries(
  resume: unknown,
): VerifiedIndustryEvidenceSummary[] {
  if (!isRecord(resume) || !isRecord(resume.ingestData)) {
    return []
  }
  const values = resume.ingestData.verifiedIndustryEvidenceSummaries
  if (!Array.isArray(values)) {
    return []
  }

  const summaries: VerifiedIndustryEvidenceSummary[] = []
  const seenRevisions = new Set<string>()
  for (const value of values) {
    const summary = parseVerifiedIndustryEvidenceSummary(value)
    if (!summary || seenRevisions.has(summary.verdictRevisionId)) {
      continue
    }
    seenRevisions.add(summary.verdictRevisionId)
    summaries.push(summary)
  }
  return summaries
}

export function selectPrimaryIndustryEvidence(
  values: readonly unknown[],
  options: { preferredRoleTypes?: readonly string[] } = {},
): PrimaryIndustryEvidenceSelection | null {
  const summaries: VerifiedIndustryEvidenceSummary[] = []
  const seenRevisions = new Set<string>()
  for (const value of values) {
    const summary = parseVerifiedIndustryEvidenceSummary(value)
    if (!summary || seenRevisions.has(summary.verdictRevisionId)) {
      continue
    }
    seenRevisions.add(summary.verdictRevisionId)
    summaries.push(summary)
  }
  if (summaries.length === 0) {
    return null
  }

  const preferredRoleTypes = new Set(
    (options.preferredRoleTypes ?? [])
      .map(normalizeRoleType)
      .filter(Boolean),
  )
  const sorted = [...summaries].sort((left, right) => {
    const roleDifference =
      roleRelevance(right, preferredRoleTypes) -
      roleRelevance(left, preferredRoleTypes)
    if (roleDifference !== 0) {
      return roleDifference
    }

    const yearDifference =
      (right.verifiedYears ?? 0) -
      (left.verifiedYears ?? 0)
    if (yearDifference !== 0) {
      return yearDifference
    }

    const recencyDifference =
      (right.latestRoleAt ?? right.reviewedAt) -
      (left.latestRoleAt ?? left.reviewedAt)
    if (recencyDifference !== 0) {
      return recencyDifference
    }

    return (
      left.companyName.localeCompare(right.companyName) ||
      left.companyKey.localeCompare(right.companyKey) ||
      left.verdictRevisionId.localeCompare(right.verdictRevisionId)
    )
  })

  return {
    primary: sorted[0],
    additionalVerifiedEmployerCount: sorted.length - 1,
  }
}

export function normalizeCompanyNameForMatching(name: string | undefined): string {
  if (!name || !name.trim()) {
    return ''
  }
  return name
    .toLowerCase()
    .replace(/[.()（）,/\-\\_]/g, ' ')
    .replace(/\bsdn\s*bhd\b/gi, '')
    .replace(/\bpte\s*ltd\b/gi, '')
    .replace(/\bco\s*ltd\b/gi, '')
    .replace(/\bltd\b/gi, '')
    .replace(/\binc\b/gi, '')
    .replace(/\bcorp\b/gi, '')
    .replace(/\bcorporation\b/gi, '')
    .replace(/\bcompany\b/gi, '')
    .replace(/\b有限责任公司\b/gu, '')
    .replace(/\b股份有限公司\b/gu, '')
    .replace(/\b科技发展有限公司\b/gu, '')
    .replace(/\b科技有限公司\b/gu, '')
    .replace(/\b设备有限公司\b/gu, '')
    .replace(/\b实业有限公司\b/gu, '')
    .replace(/\b有限公司\b/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findVerifiedIndustrySummaryForCompany(
  companyName: string | undefined,
  summaries: readonly VerifiedIndustryEvidenceSummary[],
  options?: {
    matchedCompanyKey?: string
    roleSignals?: readonly Pick<ResumeRoleSignalLike, 'matchedWorkEntries'>[]
    jobTitle?: string
    rawText?: string
  },
): VerifiedIndustryEvidenceSummary | undefined {
  if (summaries.length === 0) {
    return undefined
  }

  // Tier 1: Match by explicit matchedCompanyKey
  if (options?.matchedCompanyKey) {
    const keyTarget = options.matchedCompanyKey.trim().toLowerCase()
    const match = summaries.find((s) => s.companyKey.trim().toLowerCase() === keyTarget)
    if (match) return match
  }

  // Tier 2: Match by roleSignals matchedWorkEntries
  const targetCompName = companyName?.trim() || options?.rawText?.trim()
  if (options?.roleSignals && targetCompName) {
    const targetCompNorm = normalizeCompanyNameForMatching(targetCompName)
    for (const signal of options.roleSignals) {
      for (const entry of signal.matchedWorkEntries ?? []) {
        if (!entry.companyKey) continue
        const entryCompNorm = normalizeCompanyNameForMatching(entry.companyName)
        const compMatches = (targetCompNorm.length > 0 && entryCompNorm.length > 0)
          ? (targetCompNorm === entryCompNorm || targetCompNorm.includes(entryCompNorm) || entryCompNorm.includes(targetCompNorm))
          : false
        if (compMatches) {
          const match = summaries.find((s) =>
            s.companyKey.trim().toLowerCase() === entry.companyKey!.trim().toLowerCase() ||
            (entry.verdictRevisionId && s.verdictRevisionId === entry.verdictRevisionId)
          )
          if (match) return match
        }
      }
    }
  }

  if (!targetCompName) {
    return undefined
  }

  // Tier 3: Direct substring or equality match
  const normTarget = targetCompName.toLowerCase()
  const exactMatch = summaries.find((s) => {
    const normSummary = s.companyName.trim().toLowerCase()
    return normSummary === normTarget || normTarget.includes(normSummary) || normSummary.includes(normTarget)
  })
  if (exactMatch) return exactMatch

  // Tier 4: Normalized company name matching (stripping dots, brackets (M), Sdn Bhd / Pte Ltd / Ltd)
  const normCleanTarget = normalizeCompanyNameForMatching(targetCompName)
  if (normCleanTarget.length >= 2) {
    const normalizedMatch = summaries.find((s) => {
      const normCleanSummary = normalizeCompanyNameForMatching(s.companyName)
      if (normCleanSummary.length < 2) return false
      return (
        normCleanSummary === normCleanTarget ||
        normCleanTarget.includes(normCleanSummary) ||
        normCleanSummary.includes(normCleanTarget)
      )
    })
    if (normalizedMatch) return normalizedMatch

    // Also match clean target against normalized s.companyKey (e.g. "lionapex-equipment" -> "lionapex equipment")
    const keyMatch = summaries.find((s) => {
      const keyNorm = s.companyKey.replace(/-/g, ' ').trim().toLowerCase()
      return (
        keyNorm === normCleanTarget ||
        normCleanTarget.includes(keyNorm) ||
        keyNorm.includes(normCleanTarget)
      )
    })
    if (keyMatch) return keyMatch
  }

  return undefined
}

