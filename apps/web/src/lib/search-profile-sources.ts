import { formatKeywordQuery, normalizeKeywordPhrases } from '@trends/shared'

const JOB5156_SEARCH_URL = 'https://hr.job5156.com/search'
const EHIRE_51JOB_SEARCH_URL = 'https://ehire.51job.com/Revision/talent/search'
const SEEK_TALENT_SEARCH_URL = 'https://my.employer.seek.com/candidates/recommended'
const SOURCE_HOST_MAP: Record<string, string> = {
  'hr.job5156.com': 'job5156',
  'ehire.51job.com': '51job',
}

export function getSourceLabelFromHostname(hostname: string | undefined): string | undefined {
  const normalized = hostname?.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  return SOURCE_HOST_MAP[normalized] ?? normalized
}

export { SOURCE_HOST_MAP }
export const SEEK_HOST_SUFFIX = '.employer.seek.com'
const SEEK_RECOMMENDED_PATH = '/candidates/recommended'
export const JOB51_SAFE_LAUNCH_LIMIT = 50
export const JOB51_SAFE_LAUNCH_MAX_PAGES = 1
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
  job51: '51job',
  seek: 'seek',
} as const

export type CollectionSourceType =
  | typeof SEARCH_PROFILE_SOURCE_TYPES.job5156
  | typeof SEARCH_PROFILE_SOURCE_TYPES.job51
  | typeof SEARCH_PROFILE_SOURCE_TYPES.seek

export const SEEK_MODE = {
  recommended: 'recommended',
  talentsearch: 'talentsearch',
} as const

export type SeekMode = typeof SEEK_MODE[keyof typeof SEEK_MODE]

export function resolveSeekMode(value: string | undefined): SeekMode {
  if (value === SEEK_MODE.talentsearch) {
    return SEEK_MODE.talentsearch
  }
  return SEEK_MODE.recommended
}

export type CollectionSource = {
  type: CollectionSourceType
  exactUrl?: string
  unsafeLimits?: boolean
  job51CollectLimit?: number
  job51MaxPages?: number
  collectLimit?: number
  maxPages?: number
}

const SOURCE_MARKET_MAP: Record<CollectionSourceType, 'CN' | 'MY'> = {
  [SEARCH_PROFILE_SOURCE_TYPES.job5156]: 'CN',
  [SEARCH_PROFILE_SOURCE_TYPES.job51]: 'CN',
  [SEARCH_PROFILE_SOURCE_TYPES.seek]: 'MY',
}

export function getCollectionSourceMarket(sourceType: CollectionSourceType): 'CN' | 'MY' {
  return SOURCE_MARKET_MAP[sourceType]
}

export type SearchProfileSource = {
  type: string
  enabled: boolean
  priority?: number
  jobUrl?: string
  mode?: SeekMode      // valid only when type === 'seek'; absent ≡ 'recommended'
  unsafeLimits?: boolean
  job51CollectLimit?: number
  job51MaxPages?: number
  collectLimit?: number
  maxPages?: number
}

type BuildSeekCollectUrlInput = {
  baseUrl?: string
  location: string
  keywords: string[]
  collectLimit?: number
  maxPages?: number
  minAge?: number
  maxAge?: number
  sourceCollectLimit?: number
  sourceMaxPages?: number
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
  return normalizeKeywordPhrases(keywords)
}

function normalizeOptionalPositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

function isCollectionSourceType(value: string | undefined): value is CollectionSourceType {
  return value === SEARCH_PROFILE_SOURCE_TYPES.job5156
    || value === SEARCH_PROFILE_SOURCE_TYPES.job51
    || value === SEARCH_PROFILE_SOURCE_TYPES.seek
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

  const job51Extras = value.type === SEARCH_PROFILE_SOURCE_TYPES.job51
    ? {
        ...(value.unsafeLimits === true ? { unsafeLimits: true } : {}),
        ...(typeof value.job51CollectLimit === 'number' && value.job51CollectLimit > 0
          ? { job51CollectLimit: value.job51CollectLimit }
          : {}),
        ...(typeof value.job51MaxPages === 'number' && value.job51MaxPages > 0
          ? { job51MaxPages: value.job51MaxPages }
          : {}),
      }
    : {}

  const sourceLevelLimits = (value.type === SEARCH_PROFILE_SOURCE_TYPES.job5156 || value.type === SEARCH_PROFILE_SOURCE_TYPES.seek)
    ? {
        ...(typeof value.collectLimit === 'number' && value.collectLimit > 0
          ? { collectLimit: value.collectLimit }
          : {}),
        ...(typeof value.maxPages === 'number' && value.maxPages > 0
          ? { maxPages: value.maxPages }
          : {}),
      }
    : {}

  return exactUrl
    ? { type: value.type, exactUrl, ...job51Extras, ...sourceLevelLimits }
    : { type: value.type, ...job51Extras, ...sourceLevelLimits }
}

export function resolveCollectionSource(
  collectionSource: CollectionSource | null | undefined,
): CollectionSource | undefined {
  return normalizeCollectionSource(collectionSource) ?? undefined
}

export function stripCollectionSourceExactUrl(
  collectionSource: CollectionSource | null | undefined,
): CollectionSource | undefined {
  const normalized = normalizeCollectionSource(collectionSource)
  if (!normalized) {
    return undefined
  }

  if (normalized.type === SEARCH_PROFILE_SOURCE_TYPES.job51) {
    return {
      type: normalized.type,
      ...(normalized.unsafeLimits === true ? { unsafeLimits: true } : {}),
      ...(typeof normalized.job51CollectLimit === 'number' ? { job51CollectLimit: normalized.job51CollectLimit } : {}),
      ...(typeof normalized.job51MaxPages === 'number' ? { job51MaxPages: normalized.job51MaxPages } : {}),
    }
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

const SEEK_TALENT_SEARCH_PATH = '/talentsearch'

export function isSeekTalentSearchUrl(value: string | undefined): boolean {
  const normalized = normalizeSeekJobUrl(value)
  if (!normalized) {
    return false
  }
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:'
      && url.hostname.toLowerCase().endsWith(SEEK_HOST_SUFFIX)
      && url.pathname.replace(/\/+$/, '') === SEEK_TALENT_SEARCH_PATH
      && url.search.length > 0
  } catch {
    return false
  }
}

type BuildSeekTalentSearchUrlInput = {
  host?: string  // 'hk.employer.seek.com' | 'my.employer.seek.com'
  searchQuery?: string
  keywords?: string
  market?: string
  roleTitles?: string[]
  pageNumber?: number
  sortBy?: string
  matchAll?: boolean
  salaryType?: string
  minSalary?: number
  maxSalary?: number
  salaryUnspecified?: boolean
}

export function buildSeekTalentSearchUrl(input: BuildSeekTalentSearchUrlInput): string | null {
  const host = input.host && input.host.endsWith(SEEK_HOST_SUFFIX)
    ? input.host
    : 'my.employer.seek.com'

  const hasQuery = (input.searchQuery && input.searchQuery.trim().length > 0)
    || (input.keywords && input.keywords.trim().length > 0)
  if (!hasQuery) {
    return null
  }

  const url = new URL(`https://${host}${SEEK_TALENT_SEARCH_PATH}`)
  if (input.searchQuery) url.searchParams.set('searchQuery', input.searchQuery)
  if (input.keywords) url.searchParams.set('keywords', input.keywords)
  if (input.market) url.searchParams.set('market', input.market)
  if (input.roleTitles && input.roleTitles.length > 0) {
    url.searchParams.set('roleTitles', input.roleTitles.join(','))
  }
  if (typeof input.pageNumber === 'number' && input.pageNumber > 0) {
    url.searchParams.set('pageNumber', String(input.pageNumber))
  }
  if (input.sortBy) url.searchParams.set('sortBy', input.sortBy)
  if (typeof input.matchAll === 'boolean') {
    url.searchParams.set('matchAll', String(input.matchAll))
  }
  if (input.salaryType) url.searchParams.set('salaryType', input.salaryType)
  if (typeof input.minSalary === 'number') {
    url.searchParams.set('minSalary', String(input.minSalary))
  }
  if (typeof input.maxSalary === 'number') {
    url.searchParams.set('maxSalary', String(input.maxSalary))
  }
  if (typeof input.salaryUnspecified === 'boolean') {
    url.searchParams.set('salaryUnspecified', String(input.salaryUnspecified))
  }
  return url.toString()
}

export function resolveSeekModeFromUrl(value: string | undefined): SeekMode | null {
  if (isSeekTalentSearchUrl(value)) return SEEK_MODE.talentsearch
  if (isSeekRecommendedCandidatesUrl(value)) return SEEK_MODE.recommended
  return null
}

type ValidateSeekSourceJobUrlInput = {
  mode?: SeekMode
  jobUrl: string | undefined
}

type ValidateSeekSourceJobUrlResult =
  | { ok: true }
  | { ok: false; reason: string }

export function validateSeekSourceJobUrl(
  input: ValidateSeekSourceJobUrlInput,
): ValidateSeekSourceJobUrlResult {
  const mode = resolveSeekMode(input.mode)
  const urlMode = resolveSeekModeFromUrl(input.jobUrl)
  if (urlMode === null) {
    return { ok: false, reason: 'jobUrl is not a recognized seek URL' }
  }
  if (urlMode !== mode) {
    return {
      ok: false,
      reason: `jobUrl matches mode=${urlMode} but source declared mode=${mode}`,
    }
  }
  return { ok: true }
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
      collectLimit: source.collectLimit,
      maxPages: source.maxPages,
    }) ?? { type: SEARCH_PROFILE_SOURCE_TYPES.seek, collectLimit: source.collectLimit, maxPages: source.maxPages }
  }

  if (source.type === SEARCH_PROFILE_SOURCE_TYPES.job51) {
    return normalizeCollectionSource({
      type: SEARCH_PROFILE_SOURCE_TYPES.job51,
      unsafeLimits: source.unsafeLimits,
      job51CollectLimit: source.job51CollectLimit,
      job51MaxPages: source.job51MaxPages,
    })
  }

  return { type: SEARCH_PROFILE_SOURCE_TYPES.job5156, collectLimit: source.collectLimit, maxPages: source.maxPages }
}

export function getSearchProfileCollectUrl(
  sources: SearchProfileSource[] | undefined,
): string | undefined {
  const seekSource = getPreferredSeekSource(sources)
  if (!seekSource || !seekSource.jobUrl) {
    return undefined
  }
  // Accept either seek mode (recommended or talentsearch); reject anything else.
  if (resolveSeekModeFromUrl(seekSource.jobUrl) === null) {
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
  sourceCollectLimit,
  sourceMaxPages,
}: BuildSeekCollectUrlInput): string | null {
  const normalizedBaseUrl = normalizeSeekJobUrl(baseUrl)
  const normalizedKeywords = normalizeKeywords(keywords)
  const normalizedLocation = location.trim()

  if (!normalizedBaseUrl && normalizedKeywords.length === 0) {
    return null
  }

  // Preserve a recognized seek base URL (recommended or talent-search) verbatim
  // so caller-provided query params (jobId / searchQuery / market / etc.) are
  // not lost. Fall back to the legacy keyword-driven search URL only when the
  // base URL is missing or unrecognized.
  const baseUrlMode = normalizedBaseUrl ? resolveSeekModeFromUrl(normalizedBaseUrl) : null
  const url = normalizedBaseUrl && baseUrlMode !== null
    ? new URL(normalizedBaseUrl)
    : new URL(SEEK_TALENT_SEARCH_URL)

  if (!normalizedBaseUrl || baseUrlMode === null) {
    url.searchParams.set('keyword', formatKeywordQuery(normalizedKeywords))
    if (normalizedLocation.length > 0) {
      url.searchParams.set('location', normalizedLocation)
    } else {
      url.searchParams.delete('location')
    }
  }

  removeTrendsParams(url)
  url.searchParams.set('tr_auto_sync', 'true')

  // Source-level overrides take priority over generic args
  const effectiveCollectLimit = typeof sourceCollectLimit === 'number' && sourceCollectLimit > 0
    ? sourceCollectLimit
    : normalizeOptionalPositiveInt(collectLimit)
  const effectiveMaxPages = typeof sourceMaxPages === 'number' && sourceMaxPages > 0
    ? sourceMaxPages
    : normalizeOptionalPositiveInt(maxPages)

  if (typeof effectiveCollectLimit === 'number') {
    url.searchParams.set('tr_limit', String(effectiveCollectLimit))
  } else {
    url.searchParams.delete('tr_limit')
  }

  if (typeof effectiveMaxPages === 'number') {
    url.searchParams.set('tr_max_pages', String(effectiveMaxPages))
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
  sourceCollectLimit,
  sourceMaxPages,
}: BuildJob5156CollectUrlInput): string | null {
  const normalizedKeywords = normalizeKeywords(keywords)
  if (normalizedKeywords.length === 0) {
    return null
  }

  const url = new URL(JOB5156_SEARCH_URL)
  const normalizedLocation = location.trim()

  url.searchParams.set('keyword', formatKeywordQuery(normalizedKeywords))
  if (normalizedLocation.length > 0 && !isChinaRootLocationLabel(normalizedLocation)) {
    url.searchParams.set('location', normalizedLocation)
  }

  url.searchParams.set('tr_auto_sync', 'true')

  // Source-level overrides take priority over generic args
  const effectiveCollectLimit = typeof sourceCollectLimit === 'number' && sourceCollectLimit > 0
    ? sourceCollectLimit
    : normalizeOptionalPositiveInt(collectLimit)
  const effectiveMaxPages = typeof sourceMaxPages === 'number' && sourceMaxPages > 0
    ? sourceMaxPages
    : normalizeOptionalPositiveInt(maxPages)

  if (typeof effectiveCollectLimit === 'number') {
    url.searchParams.set('tr_limit', String(effectiveCollectLimit))
  }

  if (typeof effectiveMaxPages === 'number') {
    url.searchParams.set('tr_max_pages', String(effectiveMaxPages))
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

type BuildJob51CollectUrlInput = BuildJob5156CollectUrlInput & {
  unsafeLimits?: boolean
  job51CollectLimit?: number
  job51MaxPages?: number
}

export function buildJob51CollectUrl({
  location,
  keywords,
  collectLimit,
  maxPages,
  minAge,
  maxAge,
  unsafeLimits,
  job51CollectLimit: sourceLevelLimit,
  job51MaxPages: sourceLevelMaxPages,
}: BuildJob51CollectUrlInput): string | null {
  const normalizedKeywords = normalizeKeywords(keywords)
  if (normalizedKeywords.length === 0) {
    return null
  }

  const url = new URL(EHIRE_51JOB_SEARCH_URL)
  const normalizedLocation = location.trim()

  url.searchParams.set('keyword', formatKeywordQuery(normalizedKeywords))
  if (normalizedLocation.length > 0 && !isChinaRootLocationLabel(normalizedLocation)) {
    url.searchParams.set('location', normalizedLocation)
  }

  url.searchParams.set('tr_auto_sync', 'true')

  // Source-level limit takes priority over generic collectLimit
  const effectiveLimit = typeof sourceLevelLimit === 'number' && sourceLevelLimit > 0
    ? sourceLevelLimit
    : normalizeOptionalPositiveInt(collectLimit)
  // Source-level maxPages takes priority over generic maxPages
  const effectiveMaxPages = typeof sourceLevelMaxPages === 'number' && sourceLevelMaxPages > 0
    ? sourceLevelMaxPages
    : normalizeOptionalPositiveInt(maxPages)

  // Derive unsafeLimits: true if either source-level or effective exceeds safe threshold
  const derivedUnsafeLimits = unsafeLimits === true
    || (typeof sourceLevelLimit === 'number' && sourceLevelLimit > JOB51_SAFE_LAUNCH_LIMIT)
    || (typeof sourceLevelMaxPages === 'number' && sourceLevelMaxPages > JOB51_SAFE_LAUNCH_MAX_PAGES)

  const finalLimit = typeof effectiveLimit === 'number'
    ? (derivedUnsafeLimits ? effectiveLimit : Math.min(effectiveLimit, JOB51_SAFE_LAUNCH_LIMIT))
    : JOB51_SAFE_LAUNCH_LIMIT
  const finalMaxPages = typeof effectiveMaxPages === 'number'
    ? (derivedUnsafeLimits ? effectiveMaxPages : Math.min(effectiveMaxPages, JOB51_SAFE_LAUNCH_MAX_PAGES))
    : JOB51_SAFE_LAUNCH_MAX_PAGES

  url.searchParams.set('tr_limit', String(finalLimit))
  url.searchParams.set('tr_max_pages', String(finalMaxPages))
  if (derivedUnsafeLimits) {
    url.searchParams.set('tr_unsafe_limits', '1')
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
      sourceCollectLimit: source.collectLimit,
      sourceMaxPages: source.maxPages,
    })
  }

  if (source.type === SEARCH_PROFILE_SOURCE_TYPES.job51) {
    return buildJob51CollectUrl({
      location,
      keywords,
      collectLimit,
      maxPages,
      minAge,
      maxAge,
      unsafeLimits: source.unsafeLimits,
      job51CollectLimit: source.job51CollectLimit,
      job51MaxPages: source.job51MaxPages,
    })
  }

  return buildJob5156CollectUrl({
    location,
    keywords,
    collectLimit,
    maxPages,
    minAge,
    maxAge,
    sourceCollectLimit: source.collectLimit,
    sourceMaxPages: source.maxPages,
  })
}
