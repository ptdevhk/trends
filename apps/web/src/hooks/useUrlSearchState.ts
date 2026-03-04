import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CandidateStatus, ResumeFilters } from '@/types/resume'

const KNOWN_PARAM_KEYS = [
  'loc',
  'location',
  'kw',
  'keyword',
  'jd',
  'tags',
  'co',
  'exp',
  'minExp',
  'maxExp',
  'minRoleYears',
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
  location?: string
  keywords: string[]
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

  return value
    .split(/[\s,，、]+/g)
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
  const locationRaw = getFirstParam(searchParams, ['loc', 'location'])
  const location = locationRaw?.trim() || undefined
  const keywordRaw = getFirstParam(searchParams, ['kw', 'keyword'])
  const keywords = normalizeUniqueValues(parseKeywordParam(keywordRaw))
  const jobDescriptionRaw = searchParams.get('jd')
  const jobDescriptionId = jobDescriptionRaw?.trim() || undefined
  const selectedTags = normalizeUniqueValues(parseCsvParam(searchParams.get('tags')))
  const selectedCompanies = normalizeUniqueValues(parseCsvParam(searchParams.get('co')))
  const selectedExperienceLevel = parseExperienceLevel(searchParams.get('exp'))

  const filters: Partial<ResumeFilters> = {}

  const minExperience = parseNumberParam(searchParams.get('minExp'))
  if (typeof minExperience === 'number') {
    filters.minExperience = minExperience
  }

  const maxExperience = parseNumberParam(searchParams.get('maxExp'))
  if (typeof maxExperience === 'number') {
    filters.maxExperience = maxExperience
  }

  const education = normalizeUniqueValues(parseCsvParam(searchParams.get('edu')))
  if (education.length > 0) {
    filters.education = education
  }

  const minRoleYears = parseNumberParam(searchParams.get('minRoleYears'))
  if (typeof minRoleYears === 'number') {
    filters.minRoleYears = minRoleYears
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

  const locations = normalizeUniqueValues(parseCsvParam(searchParams.get('locs')))
  if (locations.length > 0) {
    filters.locations = locations
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
    location,
    keywords,
    jobDescriptionId,
    selectedTags,
    selectedCompanies,
    selectedExperienceLevel,
    filters,
  }
}

export function useUrlSearchState() {
  const [searchParams, setSearchParams] = useSearchParams()
  const hasKeywordParam = searchParams.has('kw')
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

        const normalizedKeywords = normalizeUniqueValues(state.keywords)
        const normalizedTags = normalizeUniqueValues(state.selectedTags)
        const normalizedCompanies = normalizeUniqueValues(state.selectedCompanies)
        const hasKeywords = normalizedKeywords.length > 0

        setParam(nextParams, 'location', state.location?.trim())
        setParam(nextParams, 'keyword', hasKeywords ? normalizedKeywords.join(' ') : undefined)
        setParam(nextParams, 'jd', state.jobDescriptionId?.trim())
        setParam(nextParams, 'tags', normalizedTags.length > 0 ? normalizedTags.join(',') : undefined)
        setParam(nextParams, 'co', normalizedCompanies.length > 0 ? normalizedCompanies.join(',') : undefined)
        setParam(nextParams, 'exp', state.selectedExperienceLevel)

        if (typeof state.filters.minExperience === 'number' && Number.isFinite(state.filters.minExperience)) {
          setParam(nextParams, 'minExp', String(state.filters.minExperience))
        }

        if (typeof state.filters.maxExperience === 'number' && Number.isFinite(state.filters.maxExperience)) {
          setParam(nextParams, 'maxExp', String(state.filters.maxExperience))
        }

        if (typeof state.filters.minRoleYears === 'number' && Number.isFinite(state.filters.minRoleYears)) {
          setParam(nextParams, 'minRoleYears', String(state.filters.minRoleYears))
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

        if (Array.isArray(state.filters.locations) && state.filters.locations.length > 0) {
          setParam(nextParams, 'locs', normalizeUniqueValues(state.filters.locations).join(','))
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
