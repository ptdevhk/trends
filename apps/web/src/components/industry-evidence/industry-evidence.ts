import {
  parseVerifiedIndustryEvidenceSummary,
  type VerifiedIndustryEvidenceSummary,
} from '@trends/shared'

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
