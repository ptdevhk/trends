const SEEK_TALENT_SEARCH_URL = 'https://my.employer.seek.com/candidates/recommended'
const SEEK_HOST_SUFFIX = '.employer.seek.com'
const SEEK_RECOMMENDED_PATH = '/candidates/recommended'

export const SEARCH_PROFILE_SOURCE_TYPES = {
  job5156: 'job5156',
  seek: 'seek',
} as const

export type SearchProfileSource = {
  type: string
  enabled: boolean
  priority?: number
  jobUrl?: string
}

type BuildSeekCollectUrlInput = {
  baseUrl?: string
  location: string
  keywords: string[]
  collectLimit?: number
  maxPages?: number
  minAge?: number
  maxAge?: number
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizeKeywords(keywords: string[]): string[] {
  return keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
}

function normalizeOptionalPositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function compareSourcePriority(left: SearchProfileSource, right: SearchProfileSource): number {
  const leftPriority = typeof left.priority === 'number' && Number.isFinite(left.priority)
    ? left.priority
    : Number.MAX_SAFE_INTEGER
  const rightPriority = typeof right.priority === 'number' && Number.isFinite(right.priority)
    ? right.priority
    : Number.MAX_SAFE_INTEGER

  return leftPriority - rightPriority
}

function removeTrendsParams(url: URL): void {
  const keys = Array.from(url.searchParams.keys())
  keys.forEach((key) => {
    if (key.startsWith('tr_')) {
      url.searchParams.delete(key)
    }
  })
}

export function normalizeSeekJobUrl(value: string | undefined): string | undefined {
  const normalizedValue = normalizeOptionalString(value)
  if (!normalizedValue) {
    return undefined
  }

  try {
    const url = new URL(normalizedValue)
    return url.toString()
  } catch {
    return undefined
  }
}

export function isSeekRecommendedCandidatesUrl(value: string | undefined): boolean {
  const normalizedValue = normalizeSeekJobUrl(value)
  if (!normalizedValue) {
    return false
  }

  try {
    const url = new URL(normalizedValue)
    return url.protocol === 'https:'
      && url.hostname.toLowerCase().endsWith(SEEK_HOST_SUFFIX)
      && url.pathname.replace(/\/+$/, '') === SEEK_RECOMMENDED_PATH
  } catch {
    return false
  }
}

export function getActiveSearchProfileSource(
  sources: SearchProfileSource[] | undefined,
): SearchProfileSource | undefined {
  if (!Array.isArray(sources) || sources.length === 0) {
    return undefined
  }

  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.enabled)
    .sort((left, right) => compareSourcePriority(left.source, right.source) || left.index - right.index)[0]?.source
}

export function getPreferredSeekSource(
  sources: SearchProfileSource[] | undefined,
): SearchProfileSource | undefined {
  if (!Array.isArray(sources) || sources.length === 0) {
    return undefined
  }

  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.enabled && source.type === SEARCH_PROFILE_SOURCE_TYPES.seek)
    .sort((left, right) => compareSourcePriority(left.source, right.source) || left.index - right.index)[0]?.source
}

export function getSearchProfileCollectUrl(
  sources: SearchProfileSource[] | undefined,
): string | undefined {
  const seekSource = getPreferredSeekSource(sources)
  if (!seekSource || !isSeekRecommendedCandidatesUrl(seekSource.jobUrl)) {
    return undefined
  }

  return normalizeSeekJobUrl(seekSource.jobUrl)
}

export function buildSeekCollectUrl({
  baseUrl,
  location,
  keywords,
  collectLimit,
  maxPages,
  minAge,
  maxAge,
}: BuildSeekCollectUrlInput): string | null {
  const normalizedBaseUrl = normalizeSeekJobUrl(baseUrl)
  const normalizedKeywords = normalizeKeywords(keywords)
  const normalizedLocation = location.trim()

  if (!normalizedBaseUrl && normalizedKeywords.length === 0) {
    return null
  }

  const url = normalizedBaseUrl && isSeekRecommendedCandidatesUrl(normalizedBaseUrl)
    ? new URL(normalizedBaseUrl)
    : new URL(SEEK_TALENT_SEARCH_URL)

  if (!normalizedBaseUrl) {
    url.searchParams.set('keyword', normalizedKeywords.join(' '))
    if (normalizedLocation.length > 0) {
      url.searchParams.set('location', normalizedLocation)
    } else {
      url.searchParams.delete('location')
    }
  }

  removeTrendsParams(url)
  url.searchParams.set('tr_auto_sync', 'true')

  const normalizedCollectLimit = normalizeOptionalPositiveInt(collectLimit)
  if (typeof normalizedCollectLimit === 'number') {
    url.searchParams.set('tr_limit', String(normalizedCollectLimit))
  } else {
    url.searchParams.delete('tr_limit')
  }

  const normalizedMaxPages = normalizeOptionalPositiveInt(maxPages)
  if (typeof normalizedMaxPages === 'number') {
    url.searchParams.set('tr_max_pages', String(normalizedMaxPages))
  } else {
    url.searchParams.delete('tr_max_pages')
  }

  const normalizedMinAge = normalizeOptionalPositiveInt(minAge)
  if (typeof normalizedMinAge === 'number') {
    url.searchParams.set('tr_min_age', String(normalizedMinAge))
  } else {
    url.searchParams.delete('tr_min_age')
  }

  const normalizedMaxAge = normalizeOptionalPositiveInt(maxAge)
  if (typeof normalizedMaxAge === 'number') {
    url.searchParams.set('tr_max_age', String(normalizedMaxAge))
  } else {
    url.searchParams.delete('tr_max_age')
  }

  return url.toString()
}
