import { formatKeywordQuery, parseKeywordQuery } from '@trends/shared'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CandidateStatus, ResumeFilters } from '@/types/resume'

const KNOWN_PARAM_KEYS = [
  'q',
  'loc',
  'location',
  'kw',
  'keyword',
  'jd',
  'tags',
  'co',
  'rkw',
  'exp',
  'minExp',
  'maxExp',
  'minRoleYears',
  'maxRoleYears',
  'roleType',
  'minAge',
  'maxAge',
  'edu',
  'minScore',
  'locs',
  'status',
  'sort',
  'order',
] as const

export type ExperienceLevelFilter = 'senior' | 'mid' | 'junior'

export type UrlSearchState = {
  shareSessionId?: string
  query?: string
  location?: string
  keywords: string[]
  requiredKeywords: string[]
  jobDescriptionId?: string
  selectedTags: string[]
  selectedCompanies: string[]
  selectedExperienceLevel?: ExperienceLevelFilter
  filters: Partial<ResumeFilters>
}

function getFirstParam(searchParams: URLSearchParams, keys: string[]): string | null {
  for (const key of keys) {
    const value = searchParams.get(key)
    if (value !== null) {
      return value
    }
  }
  return null
}

function parseKeywordParam(value: string | null): string[] {
  if (!value) {
    return []
  }

  return parseKeywordQuery(value).keywords
}

function parseLocationParam(value: string | undefined): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[,，、]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseCsvParam(value: string | null): string[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseNumberParam(value: string | null): number | undefined {
  if (!value) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed
}

function parseExperienceLevel(value: string | null): ExperienceLevelFilter | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'senior') return 'senior'
  if (normalized === 'mid') return 'mid'
  if (normalized === 'junior') return 'junior'

  return undefined
}

function parseSortBy(value: string | null): ResumeFilters['sortBy'] | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'score') return 'score'
  if (normalized === 'name') return 'name'
  if (normalized === 'experience') return 'experience'
  if (normalized === 'extractedat') return 'extractedAt'

  return undefined
}

function parseSortOrder(value: string | null): ResumeFilters['sortOrder'] | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'asc') return 'asc'
  if (normalized === 'desc') return 'desc'

  return undefined
}

function parseStatusList(value: string | null): CandidateStatus[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is CandidateStatus =>
      item === 'new'
      || item === 'contacted'
      || item === 'interviewing'
      || item === 'interviewed_pass'
      || item === 'interviewed_reject'
      || item === 'offer'
      || item === 'hired'
      || item === 'withdrawn'
    )
}

function normalizeUniqueValues(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  values.forEach((value) => {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) {
      return
    }

    seen.add(key)
    normalized.push(value.trim())
  })

  return normalized
}

function setParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value && value.length > 0) {
    params.set(key, value)
    return
  }

  params.delete(key)
}

export function hasKnownUrlSearchParams(searchParams: URLSearchParams): boolean {
  return KNOWN_PARAM_KEYS.some((key) => searchParams.has(key))
}

export function parseUrlSearchState(searchParams: URLSearchParams): UrlSearchState {
  const shareSessionIdRaw = searchParams.get('sid')
  const shareSessionId = shareSessionIdRaw?.trim() || undefined
  const queryRaw = getFirstParam(searchParams, ['q', 'kw', 'keyword'])
  const query = queryRaw?.trim() || undefined
  const locationRaw = getFirstParam(searchParams, ['loc', 'location'])
  const normalizedLocation = locationRaw?.trim() || ''
  const locationFromLocationParam = normalizeUniqueValues(parseLocationParam(normalizedLocation))
  const locationFromLocsParam = normalizeUniqueValues(parseCsvParam(searchParams.get('locs')))
  const effectiveLocations = locationFromLocsParam.length > 0
    ? locationFromLocsParam
    : locationFromLocationParam
  const location = normalizedLocation || (effectiveLocations.length > 0 ? effectiveLocations.join(',') : undefined)
  const keywords = normalizeUniqueValues(parseKeywordParam(query ?? null))
  const requiredKeywords = normalizeUniqueValues(parseCsvParam(searchParams.get('rkw')))
  const jobDescriptionRaw = searchParams.get('jd')
  const jobDescriptionId = jobDescriptionRaw?.trim() || undefined
  const selectedTags = normalizeUniqueValues(parseCsvParam(searchParams.get('tags')))
  const selectedCompanies = normalizeUniqueValues(parseCsvParam(searchParams.get('co')))
  const selectedExperienceLevel = parseExperienceLevel(searchParams.get('exp'))

  const filters: Partial<ResumeFilters> = {}

  const maxExperience = parseNumberParam(getFirstParam(searchParams, ['maxRoleYears', 'maxExp']))
  if (typeof maxExperience === 'number') {
    filters.maxExperience = maxExperience
  }

  const education = normalizeUniqueValues(parseCsvParam(searchParams.get('edu')))
  if (education.length > 0) {
    filters.education = education
  }

  const minRoleYears = parseNumberParam(getFirstParam(searchParams, ['minRoleYears', 'minExp']))
  if (typeof minRoleYears === 'number') {
    filters.minRoleYears = minRoleYears
    filters.minExperience = minRoleYears
  }

  const roleFilterType = searchParams.get('roleType')?.trim()
  if (roleFilterType && roleFilterType.length > 0) {
    filters.roleFilterType = roleFilterType
  }

  const minAge = parseNumberParam(searchParams.get('minAge'))
  if (typeof minAge === 'number') {
    filters.minAge = minAge
  }

  const maxAge = parseNumberParam(searchParams.get('maxAge'))
  if (typeof maxAge === 'number') {
    filters.maxAge = maxAge
  }

  const minMatchScore = parseNumberParam(searchParams.get('minScore'))
  if (typeof minMatchScore === 'number') {
    filters.minMatchScore = minMatchScore
  }

  if (effectiveLocations.length > 0) {
    filters.locations = effectiveLocations
  }

  const status = parseStatusList(searchParams.get('status'))
  if (status.length > 0) {
    filters.status = status
  }

  const sortBy = parseSortBy(searchParams.get('sort'))
  if (sortBy) {
    filters.sortBy = sortBy
  }

  const sortOrder = parseSortOrder(searchParams.get('order'))
  if (sortOrder) {
    filters.sortOrder = sortOrder
  }

  return {
    shareSessionId,
    query,
    location,
    keywords,
    requiredKeywords,
    jobDescriptionId,
    selectedTags,
    selectedCompanies,
    selectedExperienceLevel,
    filters,
  }
}

export function useUrlSearchState() {
  const [searchParams, setSearchParams] = useSearchParams()
  const hasKeywordParam = searchParams.has('q')
    || searchParams.has('kw')
    || searchParams.has('keyword')
  const hasJobDescriptionParam = searchParams.has('jd')

  const hasUrlParams = useMemo(
    () => hasKnownUrlSearchParams(searchParams),
    [searchParams]
  )

  const parsedState = useMemo<UrlSearchState>(() => {
    return parseUrlSearchState(searchParams)
  }, [searchParams])

  const syncToUrl = useCallback(
    (state: UrlSearchState) => {
      setSearchParams((prevParams) => {
        const nextParams = new URLSearchParams(prevParams)

        KNOWN_PARAM_KEYS.forEach((key) => {
          nextParams.delete(key)
        })
        nextParams.delete('sid')

        const normalizedKeywords = normalizeUniqueValues(state.keywords)
        const normalizedTags = normalizeUniqueValues(state.selectedTags)
        const normalizedCompanies = normalizeUniqueValues(state.selectedCompanies)
        const normalizedQuery = state.query?.trim()
        const hasKeywords = normalizedKeywords.length > 0

        const normalizedLocation = state.location?.trim()
        const normalizedLocations = Array.isArray(state.filters.locations)
          ? normalizeUniqueValues(state.filters.locations)
          : []
        const locationFromField = normalizeUniqueValues(parseLocationParam(normalizedLocation))
        const locationForUrlParts = locationFromField.length > 0
          ? locationFromField
          : normalizedLocations
        const locationForUrl = locationForUrlParts.length > 0
          ? locationForUrlParts.join(',')
          : normalizedLocation
        setParam(nextParams, 'location', locationForUrl)
        setParam(nextParams, 'q', normalizedQuery || (hasKeywords ? formatKeywordQuery(normalizedKeywords) : undefined))
        const normalizedRequiredKeywords = normalizeUniqueValues(state.requiredKeywords)
        setParam(nextParams, 'rkw', normalizedRequiredKeywords.length > 0 ? normalizedRequiredKeywords.join(',') : undefined)
        setParam(nextParams, 'jd', state.jobDescriptionId?.trim())
        setParam(nextParams, 'tags', normalizedTags.length > 0 ? normalizedTags.join(',') : undefined)
        setParam(nextParams, 'co', normalizedCompanies.length > 0 ? normalizedCompanies.join(',') : undefined)
        setParam(nextParams, 'exp', state.selectedExperienceLevel)

        if (typeof state.filters.maxExperience === 'number' && Number.isFinite(state.filters.maxExperience)) {
          setParam(nextParams, 'maxRoleYears', String(state.filters.maxExperience))
        }

        const canonicalMinRoleYears =
          typeof state.filters.minRoleYears === 'number' && Number.isFinite(state.filters.minRoleYears)
            ? state.filters.minRoleYears
            : (typeof state.filters.minExperience === 'number' && Number.isFinite(state.filters.minExperience)
                ? state.filters.minExperience
                : undefined)
        if (typeof canonicalMinRoleYears === 'number') {
          setParam(nextParams, 'minRoleYears', String(canonicalMinRoleYears))
        }

        if (state.filters.roleFilterType && state.filters.roleFilterType.trim().length > 0) {
          setParam(nextParams, 'roleType', state.filters.roleFilterType.trim())
        }

        if (typeof state.filters.minAge === 'number' && Number.isFinite(state.filters.minAge)) {
          setParam(nextParams, 'minAge', String(state.filters.minAge))
        }

        if (typeof state.filters.maxAge === 'number' && Number.isFinite(state.filters.maxAge)) {
          setParam(nextParams, 'maxAge', String(state.filters.maxAge))
        }

        if (Array.isArray(state.filters.education) && state.filters.education.length > 0) {
          setParam(nextParams, 'edu', normalizeUniqueValues(state.filters.education).join(','))
        }

        if (typeof state.filters.minMatchScore === 'number' && Number.isFinite(state.filters.minMatchScore)) {
          setParam(nextParams, 'minScore', String(state.filters.minMatchScore))
        }

        if (Array.isArray(state.filters.status) && state.filters.status.length > 0) {
          setParam(nextParams, 'status', normalizeUniqueValues(state.filters.status).join(','))
        }

        if (state.filters.sortBy) {
          setParam(nextParams, 'sort', state.filters.sortBy)
        }

        if (state.filters.sortOrder) {
          setParam(nextParams, 'order', state.filters.sortOrder)
        }

        if (nextParams.toString() === prevParams.toString()) {
          return prevParams
        }

        return nextParams
      }, { replace: true })
    },
    [setSearchParams]
  )

  return {
    parsedState,
    hasUrlParams,
    hasKeywordParam,
    hasJobDescriptionParam,
    syncToUrl,
  }
}
