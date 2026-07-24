import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import {
  formatKeywordQuery,
  formatLocationHierarchySearchText,
  normalizeKeywordPhrases,
  parseRawSalaryRange,
  resolveGateRoleYears,
  resolveResumeAnalysisSourceKey,
} from '@trends/shared'
import type { ExperienceLevelFilter, UrlSearchState } from '@/hooks/useUrlSearchState'

import { CANDIDATE_STATUS_VALUES, type CandidateStatus, type ResumeFilters } from '@/types/resume'
import type { CollectionSource } from '@/lib/search-profile-sources'

const EDUCATION_KEYWORDS: Record<string, string[]> = {
  high_school: ['高中', '中专', '技校', 'high school'],
  associate: ['大专', '专科', 'associate'],
  bachelor: ['本科', '学士', 'bachelor'],
  master: ['硕士', '研究生', 'master'],
  phd: ['博士', 'phd', 'doctor'],
}

const CANDIDATE_STATUS_SET = new Set<CandidateStatus>(CANDIDATE_STATUS_VALUES)

export function normalizeFilterToken(value: string): string {
  return value.trim().toLowerCase()
}

export function matchesEducationFilter(educationValue: string | undefined, selectedEducation: string[]): boolean {
  if (selectedEducation.length === 0) {
    return true
  }

  const normalizedEducation = normalizeFilterToken(educationValue ?? '')
  if (!normalizedEducation) {
    return false
  }

  return selectedEducation.some((level) => {
    const keywords = EDUCATION_KEYWORDS[level]
    if (!keywords || keywords.length === 0) {
      return false
    }

    return keywords.some((keyword) => normalizedEducation.includes(normalizeFilterToken(keyword)))
  })
}

export function matchesSalaryFilter(
  expectedSalary: string | undefined,
  minSalary?: number,
  maxSalary?: number,
): boolean {
  if (typeof minSalary !== 'number' && typeof maxSalary !== 'number') {
    return true
  }

  const salary = parseRawSalaryRange(expectedSalary)
  if (!salary) {
    return false
  }

  if (typeof minSalary === 'number') {
    const upper = salary.max ?? salary.min
    if (typeof upper === 'number' && upper < minSalary) {
      return false
    }
  }

  if (typeof maxSalary === 'number') {
    const lower = salary.min ?? salary.max
    if (typeof lower === 'number' && lower > maxSalary) {
      return false
    }
  }

  return true
}

export function toStatusFilterList(values: CandidateStatus[] | undefined): CandidateStatus[] {
  if (!Array.isArray(values)) {
    return []
  }

  const unique = new Set<CandidateStatus>()
  values.forEach((value) => {
    if (CANDIDATE_STATUS_SET.has(value)) {
      unique.add(value)
    }
  })
  return Array.from(unique).sort()
}

type RoleYearsResume = Pick<ConvexResumeItem, 'ingestData' | 'source'> & {
  sourceKey?: string
}

export function hasMatchingRoleSignal(resume: Pick<ConvexResumeItem, 'ingestData'>, roleType: string | undefined): boolean {
  const normalizedRoleType = normalizeFilterToken(roleType ?? '')
  if (!normalizedRoleType) {
    return true
  }

  // Match Convex hasMatchingRoleSignal: precomputed verifiedRoleYears counts
  // even when roleSignals are sparse / not yet re-ingested.
  const stored = resume.ingestData?.verifiedRoleYears?.[normalizedRoleType]
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    return true
  }

  const roleSignals = resume.ingestData?.roleSignals
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return false
  }

  return roleSignals.some((signal) => normalizeFilterToken(signal.type) === normalizedRoleType)
}

/** minRoleYears gate years — shared MY/Seek fallback via resolveGateRoleYears. */
export function getRoleYears(resume: RoleYearsResume, roleType: string): number {
  return resolveGateRoleYears(
    resume.ingestData?.roleSignals,
    roleType,
    {
      market: resume.ingestData?.market,
      sourceKey: resume.sourceKey,
      source: resume.source,
    },
    resume.ingestData?.verifiedRoleYears,
  )
}

export function matchesAllRequiredKeywords(text: string, requiredKeywords: string[]): boolean {
  const normalizedKeywords = requiredKeywords
    .map((keyword) => normalizeFilterToken(keyword))
    .filter((keyword) => keyword.length > 0)

  if (normalizedKeywords.length === 0) {
    return true
  }

  const haystack = text.trim().toLowerCase()
  if (!haystack) {
    return false
  }

  return normalizedKeywords.every((keyword) => haystack.includes(keyword))
}

export function normalizeKeywordFingerprint(keywords: readonly string[] | undefined): string {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return ''
  }

  return normalizeKeywordPhrases([...keywords])
    .map((keyword) => keyword.toLowerCase())
    .sort()
    .join('|')
}

export function areKeywordListsEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return normalizeKeywordFingerprint(left) === normalizeKeywordFingerprint(right)
}

export function parseExtractedAt(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function parseSerializedStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function toExperienceLevel(value: string | undefined): ExperienceLevelFilter | undefined {
  if (!value) {
    return undefined
  }

  const normalized = normalizeFilterToken(value)
  if (normalized === 'senior' || normalized === '资深' || normalized === '資深') return 'senior'
  if (normalized === 'mid' || normalized === '中级' || normalized === '中級') return 'mid'
  if (normalized === 'junior' || normalized === '初级' || normalized === '初級') return 'junior'
  return undefined
}

export function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export function normalizeFilterList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const token = normalizeFilterToken(value)
    if (!token || seen.has(token)) {
      return
    }
    seen.add(token)
    normalized.push(token)
  })

  return normalized.sort()
}

export function serializeLocationFilter(values: string[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return ''
  }

  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const trimmed = value.trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) {
      return
    }

    seen.add(key)
    normalized.push(trimmed)
  })

  return normalized.join(',')
}

export function appendKeywordToken(current: string[], token: string): string[] {
  const normalizedToken = token.trim()
  if (!normalizedToken) {
    return current
  }

  return [...current, normalizedToken]
}

export function normalizeUrlFilters(filters: Partial<ResumeFilters>): Partial<ResumeFilters> {
  return {
    maxExperience: normalizeOptionalNumber(filters.maxExperience),
    minRoleYears: normalizeOptionalNumber(filters.minRoleYears),
    roleFilterType: normalizeOptionalString(filters.roleFilterType),
    minAge: normalizeOptionalNumber(filters.minAge),
    maxAge: normalizeOptionalNumber(filters.maxAge),
    education: normalizeFilterList(filters.education),
    status: toStatusFilterList(filters.status),
    minMatchScore: normalizeOptionalNumber(filters.minMatchScore),
    minSalary: normalizeOptionalNumber(filters.minSalary),
    maxSalary: normalizeOptionalNumber(filters.maxSalary),
    locations: normalizeFilterList(filters.locations),
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  }
}

export function normalizeUrlSearchStateValue(state: Partial<UrlSearchState> | undefined): UrlSearchState {
  return {
    shareSessionId: normalizeOptionalString(state?.shareSessionId),
    query: normalizeOptionalString(state?.query),
    location: normalizeOptionalString(state?.location),
    keywords: Array.isArray(state?.keywords) ? state.keywords : [],
    requiredKeywords: Array.isArray(state?.requiredKeywords) ? state.requiredKeywords : [],
    jobDescriptionId: normalizeOptionalString(state?.jobDescriptionId),
    selectedTags: Array.isArray(state?.selectedTags) ? state.selectedTags : [],
    selectedCompanies: Array.isArray(state?.selectedCompanies) ? state.selectedCompanies : [],
    selectedSources: Array.isArray(state?.selectedSources) ? state.selectedSources : [],
    selectedBrands: Array.isArray(state?.selectedBrands) ? state.selectedBrands : [],
    selectedExperienceLevel: state?.selectedExperienceLevel,
    filters: state?.filters ?? {},
  }
}

export function areUrlFiltersEqual(left: Partial<ResumeFilters>, right: Partial<ResumeFilters>): boolean {
  return JSON.stringify(normalizeUrlFilters(left)) === JSON.stringify(normalizeUrlFilters(right))
}


export interface AnalysisTaskMatchContext {
  status: string
  config: {
    jobDescriptionId?: string
    keywords?: string[]
    location?: string
    promptVersion?: number
  }
}

export function taskMatchesCurrentSearch(
  task: AnalysisTaskMatchContext,
  jobDescriptionId: string | undefined,
  sessionKeywords: string[],
  location: string,
  promptVersion: number
): boolean {
  if (task.status !== 'pending' && task.status !== 'processing') {
    return false
  }

  const normalizedJobDescriptionId = (jobDescriptionId ?? '').trim()
  if (normalizedJobDescriptionId && task.config.jobDescriptionId === normalizedJobDescriptionId) {
    return task.config.promptVersion === promptVersion
      && normalizeOptionalString(task.config.location) === normalizeOptionalString(location)
  }

  if (sessionKeywords.length > 0 && task.config.keywords?.length) {
    const normalizedSessionKeywords = normalizeKeywordFingerprint(sessionKeywords)
    const normalizedTaskKeywords = normalizeKeywordFingerprint(task.config.keywords)
    return (
      normalizedSessionKeywords.length > 0
      && normalizedSessionKeywords === normalizedTaskKeywords
      && task.config.promptVersion === promptVersion
      && normalizeOptionalString(task.config.location) === normalizeOptionalString(location)
    )
  }

  return false
}

export function buildSearchHistoryTitle(location: string, keywords: string[], jobDescriptionId?: string): string {
  const normalizedLocation = location.trim()
  const normalizedKeywords = formatKeywordQuery(keywords).trim()
  const normalizedJobDescriptionId = normalizeOptionalString(jobDescriptionId)
  const primarySubject = normalizedKeywords || normalizedJobDescriptionId || ''
  const parts = [normalizedLocation, primarySubject].filter((value) => value.length > 0)
  return parts.join(' · ') || 'Untitled search'
}

export function getResumeLocationText(
  resume: { location?: string; locationHierarchy?: { country: string; province?: string; city?: string; district?: string } }
): string {
  return formatLocationHierarchySearchText(resume.locationHierarchy) || resume.location || ''
}

export function resolveAnalysisSourceKeyForResume(
  resume: { source?: string; profileType?: string },
  collectionSource: CollectionSource | undefined,
): string | undefined {
  return collectionSource?.type
    ?? resolveResumeAnalysisSourceKey({
      sourceKey: resume.profileType,
      source: resume.source ?? '',
    })
}

export function getResumeIdentityKey(resume: ConvexResumeItem, fallback: string): string {
  const identityKey = resume.identityKey?.trim()
  if (identityKey) {
    return identityKey
  }
  return fallback
}
