const JOB5156_SEARCH_URL = 'https://hr.job5156.com/search'
const SEEK_TALENT_SEARCH_URL = 'https://my.employer.seek.com/candidates/recommended'
const SEEK_HOST_SUFFIX = '.employer.seek.com'
const SEEK_RECOMMENDED_PATH = '/candidates/recommended'
const CHINA_ROOT_LOCATION_LABELS = new Set([
  '中国',
  '中华人民共和国',
  '中国大陆',
  'China',
  'china',
  'CN',
  'cn',
])

export const SEARCH_PROFILE_SOURCE_TYPES = {
  job5156: 'job5156',
  seek: 'seek',
} as const

export type CollectionSourceType =
  | typeof SEARCH_PROFILE_SOURCE_TYPES.job5156
  | typeof SEARCH_PROFILE_SOURCE_TYPES.seek

export type CollectionSource = {
  type: CollectionSourceType
  exactUrl?: string
}

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

type BuildJob5156CollectUrlInput = Omit<BuildSeekCollectUrlInput, 'baseUrl'>

type BuildCollectionLaunchUrlInput = BuildJob5156CollectUrlInput & {
  source: CollectionSource
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

function isCollectionSourceType(value: string | undefined): value is CollectionSourceType {
  return value === SEARCH_PROFILE_SOURCE_TYPES.job5156 || value === SEARCH_PROFILE_SOURCE_TYPES.seek
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

function isChinaRootLocationLabel(value: string): boolean {
  return CHINA_ROOT_LOCATION_LABELS.has(value.trim())
}

function removeTrendsParams(url: URL): void {
  const keys = Array.from(url.searchParams.keys())
  keys.forEach((key) => {
    if (key.startsWith('tr_')) {
      url.searchParams.delete(key)
    }
  })
}

export function normalizeCollectionSource(
  value: CollectionSource | null | undefined,
): CollectionSource | undefined {
  if (!value || !isCollectionSourceType(value.type)) {
    return undefined
  }

  const exactUrl = value.type === SEARCH_PROFILE_SOURCE_TYPES.seek
    ? normalizeSeekJobUrl(value.exactUrl)
    : undefined

  return exactUrl
    ? { type: value.type, exactUrl }
    : { type: value.type }
}

export function getLegacyCollectionSource(collectUrl: string | undefined): CollectionSource | undefined {
  const exactUrl = normalizeSeekJobUrl(collectUrl)
  if (!exactUrl || !isSeekRecommendedCandidatesUrl(exactUrl)) {
    return undefined
  }

  return {
    type: SEARCH_PROFILE_SOURCE_TYPES.seek,
    exactUrl,
  }
}

export function resolveCollectionSource(
  collectionSource: CollectionSource | null | undefined,
  collectUrl?: string,
): CollectionSource | undefined {
  const normalizedSource = normalizeCollectionSource(collectionSource)
  const legacySource = getLegacyCollectionSource(collectUrl)

  if (normalizedSource?.type === SEARCH_PROFILE_SOURCE_TYPES.seek && !normalizedSource.exactUrl && legacySource?.exactUrl) {
    return {
      type: SEARCH_PROFILE_SOURCE_TYPES.seek,
      exactUrl: legacySource.exactUrl,
    }
  }

  return normalizedSource ?? legacySource
}

export function stripCollectionSourceExactUrl(
  collectionSource: CollectionSource | null | undefined,
): CollectionSource | undefined {
  const normalized = normalizeCollectionSource(collectionSource)
  if (!normalized) {
    return undefined
  }

  return { type: normalized.type }
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

export function getPreferredLaunchableSearchProfileSource(
  sources: SearchProfileSource[] | undefined,
): SearchProfileSource | undefined {
  if (!Array.isArray(sources) || sources.length === 0) {
    return undefined
  }

  return sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.enabled && isCollectionSourceType(source.type))
    .sort((left, right) => compareSourcePriority(left.source, right.source) || left.index - right.index)[0]?.source
}

export function getSearchProfileCollectionSource(
  sources: SearchProfileSource[] | undefined,
): CollectionSource | undefined {
  const source = getPreferredLaunchableSearchProfileSource(sources)
  if (!source || !isCollectionSourceType(source.type)) {
    return undefined
  }

  if (source.type === SEARCH_PROFILE_SOURCE_TYPES.seek) {
    return normalizeCollectionSource({
      type: SEARCH_PROFILE_SOURCE_TYPES.seek,
      exactUrl: source.jobUrl,
    }) ?? { type: SEARCH_PROFILE_SOURCE_TYPES.seek }
  }

  return { type: SEARCH_PROFILE_SOURCE_TYPES.job5156 }
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

export function buildJob5156CollectUrl({
  location,
  keywords,
  collectLimit,
  maxPages,
  minAge,
  maxAge,
}: BuildJob5156CollectUrlInput): string | null {
  const normalizedKeywords = normalizeKeywords(keywords)
  if (normalizedKeywords.length === 0) {
    return null
  }

  const url = new URL(JOB5156_SEARCH_URL)
  const normalizedLocation = location.trim()

  url.searchParams.set('keyword', normalizedKeywords.join(' '))
  if (normalizedLocation.length > 0 && !isChinaRootLocationLabel(normalizedLocation)) {
    url.searchParams.set('location', normalizedLocation)
  }

  url.searchParams.set('tr_auto_sync', 'true')

  const normalizedCollectLimit = normalizeOptionalPositiveInt(collectLimit)
  if (typeof normalizedCollectLimit === 'number') {
    url.searchParams.set('tr_limit', String(normalizedCollectLimit))
  }

  const normalizedMaxPages = normalizeOptionalPositiveInt(maxPages)
  if (typeof normalizedMaxPages === 'number') {
    url.searchParams.set('tr_max_pages', String(normalizedMaxPages))
  }

  const normalizedMinAge = normalizeOptionalPositiveInt(minAge)
  if (typeof normalizedMinAge === 'number') {
    url.searchParams.set('tr_min_age', String(normalizedMinAge))
  }

  const normalizedMaxAge = normalizeOptionalPositiveInt(maxAge)
  if (typeof normalizedMaxAge === 'number') {
    url.searchParams.set('tr_max_age', String(normalizedMaxAge))
  }

  return url.toString()
}

export function buildCollectionLaunchUrl({
  source,
  location,
  keywords,
  collectLimit,
  maxPages,
  minAge,
  maxAge,
}: BuildCollectionLaunchUrlInput): string | null {
  if (source.type === SEARCH_PROFILE_SOURCE_TYPES.seek) {
    return buildSeekCollectUrl({
      baseUrl: source.exactUrl,
      location,
      keywords,
      collectLimit,
      maxPages,
      minAge,
      maxAge,
    })
  }

  return buildJob5156CollectUrl({
    location,
    keywords,
    collectLimit,
    maxPages,
    minAge,
    maxAge,
  })
}
