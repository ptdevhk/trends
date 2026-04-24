import { useEffect, useMemo, useState } from 'react'
import { normalizeProfileUrlForDisplay, normalizeSharedResumeFields, parseKeywordQuery } from '@trends/shared'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import { rawApiClient } from '@/lib/api-helpers'
import type { ResumeItem } from './useResumes'

export const DEFAULT_CONVEX_RESUME_LIMIT = 200
export const CONVEX_RESUME_PAGE_SIZE = 200
export const MAX_CONVEX_RESUME_LIMIT = 2000

export type ConvexResumeSortBy = 'experience' | 'extractedAt'

export type ConvexResumeFilters = {
  minExperience?: number
  maxExperience?: number
  minRoleYears?: number
  roleFilterType?: string
  minAge?: number
  maxAge?: number
  education?: string[]
  skills?: string[]
  requiredKeywords?: string[]
  locations?: string[]
  minSalary?: number
  maxSalary?: number
  sources?: string[]
}

export type ConvexResumeAnalysis = {
  score: number
  summary: string
  highlights: string[]
  recommendation: string
  analyzedAt?: number
  promptVersion?: number
  locale?: string
  queryLocation?: string
  concerns?: string[]
  breakdown?: Record<string, number>
  jobDescriptionId?: string
}

export type ConvexIngestData = {
  evidenceText?: string
  industryTags: string[]
  synonymHits: string[]
  brandHits: Array<{
    brand: string
    role: string
    source: string
    context: string
  }>
  companyHits: string[]
  industryDbV2Raw?: number
  industryDbV2RawComponents?: {
    companyScore: number
    brandScore: number
    weightedBrandUnits: number
    uniqueCompanies: number
    brandUnitCount: number
  }
  roleSignals?: Array<{
    type: string
    matchedSignals: string[]
    signalCount: number
    occurrences: number
    years: number
    industryVerifiedYears: number
    roleRelevantYears?: number
    industryVerifiedRelevantYears?: number
    matchedWorkEntries?: Array<{
      companyName?: string
      jobTitle?: string
      years: number
      industryVerified: boolean
      matchedSignals: string[]
      directRoleMatch?: boolean
    }>
    verifyIn: string
  }>
  verifiedRoleYears?: Record<string, number>
  taggingEnvelope?: {
    schemaVersion: number
    generatedAt: number
    entries: Array<{
      tag: string
      source: string
      confidence: number
      version: number
      provenance: {
        stage: string
        generatedBy: string
        evidence: string[]
      }
    }>
  }
  ruleScores: Record<string, number>
  experienceLevel: string
  computedAt: number
  skillsVersion: number
}

export type ConvexRoleSignal = NonNullable<ConvexIngestData['roleSignals']>[number]

export type ConvexResumeItem = ResumeItem & {
  resumeId: Doc<'resumes'>['_id']
  identityKey?: string
  ageNumber?: number
  externalId: string
  crawledAt: number
  analysis?: ConvexResumeAnalysis
  analyses?: Record<string, ConvexResumeAnalysis>
  ingestData?: ConvexIngestData
  primaryRuleScore?: number
  source: string
  tags: string[]
  _provenance?: Array<{
    term: string
    source: 'searchText' | 'industryTags' | 'companyHits' | 'synonymHits'
    expandedFrom?: string
  }>
}

type ResumeListDocLike = {
  _id: Doc<'resumes'>['_id']
  identityKey?: string
  age?: number
  externalId: string
  crawledAt: number
  analysis?: unknown
  analyses?: unknown
  primaryRuleScore?: number
  ingestData?: {
    industryTags: string[]
    synonymHits?: string[]
    brandHits?: Array<{
      brand: string
      role: string
      source: string
      context: string
    }>
    companyHits?: string[]
    industryDbV2Raw?: number
    roleSignals?: Array<{
      type: string
      matchedSignals: string[]
      signalCount: number
      occurrences: number
      years: number
      industryVerifiedYears?: number
      roleRelevantYears?: number
      industryVerifiedRelevantYears?: number
      matchedWorkEntries?: Array<{
        companyName?: string
        jobTitle?: string
        years: number
        industryVerified: boolean
        matchedSignals: string[]
        directRoleMatch?: boolean
      }>
      verifyIn: string
    }>
    verifiedRoleYears?: Record<string, number>
    ruleScores: unknown
    experienceLevel: string
    computedAt: number
    skillsVersion: number
  }
  source: string
  tags: string[]
  content: Record<string, unknown>
}

type KeywordExpansionSummary = {
  groups: Array<{
    original: string
    variants: string[]
  }>
  mode: 'AND' | 'OR'
  expandedTo: string[]
  sourceMapping: Record<string, string>
}

type MockConvexResumePayload = {
  list?: ResumeListDocLike[]
  search?: {
    results?: Array<{
      resume: ResumeListDocLike
      provenance?: Array<{
        term: string
        source: 'searchText' | 'industryTags' | 'companyHits' | 'synonymHits'
        expandedFrom?: string
      }>
    }>
    expansion?: unknown
  }
}

type MockSearchResult = NonNullable<NonNullable<MockConvexResumePayload['search']>['results']>[number]

type SearchProvenance = NonNullable<MockSearchResult['provenance']>[number]

type IndexedMockSearchResult = MockSearchResult & {
  matchedGroupCount: number
  provenance: SearchProvenance[]
}

type SearchResultEntry = {
  resume: ResumeListDocLike
  provenance?: SearchProvenance[]
}

type ExactKeywordMatchContext = {
  score: number
}

function buildFallbackKeywordExpansion(query: string): KeywordExpansionSummary {
  const parsed = parseKeywordQuery(query)
  const terms = parsed.keywords
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0)

  return {
    groups: terms.map((term) => ({ original: term, variants: [term] })),
    mode: parsed.mode,
    expandedTo: terms,
    sourceMapping: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildMockSearchText(doc: ResumeListDocLike): string {
  const content = isRecord(doc.content) ? doc.content : {}
  const fragments = [
    toStringValue(content.name),
    toStringValue(content.location),
    toStringValue(content.expectedSalary),
    ...toStringArray(doc.tags),
    ...toStringArray(doc.ingestData?.industryTags),
    ...toStringArray(doc.ingestData?.synonymHits),
    ...toStringArray(doc.ingestData?.companyHits),
    ...toStringArray(doc.ingestData?.brandHits?.map((hit) => hit.brand)),
    ...toStringArray(doc.ingestData?.roleSignals?.flatMap((signal) => signal.matchedSignals ?? [])),
    ...toStringArray(doc.ingestData?.roleSignals?.flatMap((signal) => signal.matchedWorkEntries?.flatMap((entry) => [entry.companyName, entry.jobTitle] as const) ?? [])),
    ...toStringArray(Array.isArray(content.workHistory)
      ? content.workHistory.flatMap((entry) => {
          if (!isRecord(entry)) {
            return []
          }
          return [entry.raw, entry.companyName, entry.jobTitle, entry.description]
        })
      : []),
    ...toStringArray(Array.isArray(content.projectExperience)
      ? content.projectExperience.flatMap((entry) => {
          if (!isRecord(entry)) {
            return []
          }
          return [entry.raw, entry.companyName, entry.jobTitle, entry.description]
        })
      : []),
  ]

  return fragments
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join(' ')
}

function matchesKeywordExpansion(searchText: string, expansion: KeywordExpansionSummary): SearchProvenance[] {
  const seen = new Set<string>()
  const matches: SearchProvenance[] = []

  for (const group of expansion.groups) {
    for (const variant of group.variants) {
      const normalizedVariant = variant.trim().toLowerCase()
      if (!normalizedVariant || !searchText.includes(normalizedVariant) || seen.has(normalizedVariant)) {
        continue
      }

      seen.add(normalizedVariant)
      matches.push({
        term: normalizedVariant,
        source: 'searchText',
        expandedFrom: expansion.sourceMapping[normalizedVariant],
      })
    }
  }

  return matches
}

function indexMockSearchResults(
  results: MockSearchResult[],
  expansion: KeywordExpansionSummary,
): IndexedMockSearchResult[] {
  return results.map((entry) => {
    const searchText = buildMockSearchText(entry.resume)
    const matchedGroupCount = expansion.groups.filter((group) =>
      group.variants.some((variant) => searchText.includes(variant.trim().toLowerCase()))
    ).length

    return {
      ...entry,
      matchedGroupCount,
      provenance: matchesKeywordExpansion(searchText, expansion),
    }
  })
}

function stripMatchedGroupCount(entry: IndexedMockSearchResult): MockSearchResult {
  return {
    resume: entry.resume,
    provenance: entry.provenance,
  }
}

function applyMockExpansionProvenance(
  results: MockSearchResult[],
  expansion: KeywordExpansionSummary,
): MockSearchResult[] {
  return indexMockSearchResults(results, expansion).map(stripMatchedGroupCount)
}

function filterMockSearchResults(
  results: MockSearchResult[],
  expansion: KeywordExpansionSummary,
): MockSearchResult[] {
  if (expansion.groups.length === 0) {
    return []
  }

  return indexMockSearchResults(results, expansion)
    .filter((entry) => {
      const matched = expansion.mode === 'AND'
        ? entry.matchedGroupCount === expansion.groups.length
        : entry.matchedGroupCount > 0

      return matched && entry.provenance.length > 0
    })
    .map(stripMatchedGroupCount)
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseBreakdown(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const parsed: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const numeric = toNumber(rawValue)
    if (numeric !== null) {
      parsed[key] = numeric
    }
  }

  return Object.keys(parsed).length ? parsed : undefined
}

function parseAnalysis(value: unknown): ConvexResumeAnalysis | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const score = toNumber(value.score)
  if (score === null) {
    return undefined
  }

  return {
    score,
    summary: toStringValue(value.summary),
    highlights: toStringArray(value.highlights),
    recommendation: toStringValue(value.recommendation),
    analyzedAt: toNumber(value.analyzedAt) ?? undefined,
    promptVersion: toNumber(value.promptVersion) ?? undefined,
    locale: toStringValue(value.locale) || undefined,
    queryLocation: toStringValue(value.queryLocation) || undefined,
    concerns: toStringArray(value.concerns),
    breakdown: parseBreakdown(value.breakdown),
    jobDescriptionId: toStringValue(value.jobDescriptionId) || undefined,
  }
}

function parseRuleScores(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const parsed: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const score = toNumber(rawValue)
    if (score !== null) {
      parsed[key] = score
    }
  }

  return parsed
}

function parseBrandHits(value: unknown): ConvexIngestData['brandHits'] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }

      const brand = toStringValue(item.brand)
      const role = toStringValue(item.role)
      const source = toStringValue(item.source)
      const context = toStringValue(item.context)

      if (!brand || !role || !source || !context) {
        return null
      }

      return { brand, role, source, context }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

function parseTaggingEnvelope(value: unknown): ConvexIngestData['taggingEnvelope'] {
  if (!isRecord(value)) {
    return undefined
  }

  const schemaVersion = toNumber(value.schemaVersion)
  const generatedAt = toNumber(value.generatedAt)
  if (schemaVersion === null || generatedAt === null || !Array.isArray(value.entries)) {
    return undefined
  }

  const entries = value.entries
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }

      const tag = toStringValue(item.tag).trim().toLowerCase()
      const source = toStringValue(item.source).trim().toLowerCase()
      const confidence = toNumber(item.confidence)
      const version = toNumber(item.version)
      const provenance = isRecord(item.provenance) ? item.provenance : null
      const stage = provenance ? toStringValue(provenance.stage).trim().toLowerCase() : ''
      const generatedBy = provenance ? toStringValue(provenance.generatedBy).trim() : ''

      if (!tag || !source || confidence === null || version === null || !stage || !generatedBy) {
        return null
      }

      return {
        tag,
        source,
        confidence,
        version,
        provenance: {
          stage,
          generatedBy,
          evidence: provenance ? toStringArray(provenance.evidence) : [],
        },
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  if (entries.length === 0) {
    return undefined
  }

  return {
    schemaVersion,
    generatedAt,
    entries,
  }
}

function parseAnalysesMap(value: unknown): Record<string, ConvexResumeAnalysis> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const parsed: Record<string, ConvexResumeAnalysis> = {}
  for (const [key, rawAnalysis] of Object.entries(value)) {
    const analysis = parseAnalysis(rawAnalysis)
    if (analysis) {
      parsed[key] = analysis
    }
  }

  return Object.keys(parsed).length ? parsed : undefined
}

function parseIngestData(value: unknown): ConvexIngestData | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const computedAt = toNumber(value.computedAt)
  const skillsVersion = toNumber(value.skillsVersion)
  if (computedAt === null || skillsVersion === null) {
    return undefined
  }

  const taggingEnvelope = parseTaggingEnvelope(value.taggingEnvelope)

  return {
    evidenceText: toStringValue(value.evidenceText) || undefined,
    industryTags: toStringArray(value.industryTags),
    synonymHits: toStringArray(value.synonymHits),
    brandHits: parseBrandHits(value.brandHits),
    companyHits: toStringArray(value.companyHits),
    industryDbV2Raw: toNumber(value.industryDbV2Raw) ?? undefined,
    industryDbV2RawComponents: isRecord(value.industryDbV2RawComponents)
      ? {
          companyScore: toNumber(value.industryDbV2RawComponents.companyScore) ?? 0,
          brandScore: toNumber(value.industryDbV2RawComponents.brandScore) ?? 0,
          weightedBrandUnits: toNumber(value.industryDbV2RawComponents.weightedBrandUnits) ?? 0,
          uniqueCompanies: toNumber(value.industryDbV2RawComponents.uniqueCompanies) ?? 0,
          brandUnitCount: toNumber(value.industryDbV2RawComponents.brandUnitCount) ?? 0,
        }
      : undefined,
    roleSignals: Array.isArray(value.roleSignals)
      ? value.roleSignals
          .map((item) => {
            if (!isRecord(item)) {
              return null
            }
            const type = toStringValue(item.type)
            const years = toNumber(item.years)
            if (!type || years === null) {
              return null
            }
            return {
              type,
              matchedSignals: toStringArray(item.matchedSignals),
              signalCount: toNumber(item.signalCount) ?? 0,
              occurrences: toNumber(item.occurrences) ?? 0,
              years,
              industryVerifiedYears: toNumber(item.industryVerifiedYears) ?? 0,
              roleRelevantYears: toNumber(item.roleRelevantYears) ?? undefined,
              industryVerifiedRelevantYears: toNumber(item.industryVerifiedRelevantYears) ?? undefined,
              matchedWorkEntries: Array.isArray(item.matchedWorkEntries)
                ? item.matchedWorkEntries
                    .map((workEntry) => {
                      if (!isRecord(workEntry)) {
                        return null
                      }

                      const workEntryYears = toNumber(workEntry.years)
                      if (workEntryYears === null) {
                        return null
                      }

                      return {
                        companyName: toStringValue(workEntry.companyName) || undefined,
                        jobTitle: toStringValue(workEntry.jobTitle) || undefined,
                        years: workEntryYears,
                        industryVerified: Boolean(workEntry.industryVerified),
                        matchedSignals: toStringArray(workEntry.matchedSignals),
                        directRoleMatch: typeof workEntry.directRoleMatch === 'boolean'
                          ? workEntry.directRoleMatch
                          : undefined,
                      }
                    })
                    .filter((workEntry): workEntry is NonNullable<typeof workEntry> => workEntry !== null)
                : undefined,
              verifyIn: toStringValue(item.verifyIn) || 'workHistory',
            }
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : undefined,
    ...(isRecord(value.verifiedRoleYears)
      ? {
          verifiedRoleYears: Object.fromEntries(
            Object.entries(value.verifiedRoleYears)
              .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])),
          ),
        }
      : {}),
    taggingEnvelope,
    ruleScores: parseRuleScores(value.ruleScores),
    experienceLevel: toStringValue(value.experienceLevel) || 'unknown',
    computedAt,
    skillsVersion,
  }
}

function readMockConvexResumePayload(): MockConvexResumePayload | null {
  if (typeof window === 'undefined') {
    return null
  }

  const value = (window as typeof window & { __TR_PLAYWRIGHT_MOCK_RESUMES__?: unknown }).__TR_PLAYWRIGHT_MOCK_RESUMES__
  if (!isRecord(value)) {
    return null
  }

  return value as MockConvexResumePayload
}

function mapResumeDoc(doc: ResumeListDocLike): ConvexResumeItem {
  const content = isRecord(doc.content) ? doc.content : {}
  const profileUrl = normalizeProfileUrlForDisplay(
    content.profileUrl ?? content.profile_url ?? content.profileURL ?? content.url,
    doc.source
  )

  return {
    name: toStringValue(content.name),
    activityStatus: toStringValue(content.activityStatus),
    age: toStringValue(content.age),
    experience: toStringValue(content.experience),
    education: toStringValue(content.education),
    location: toStringValue(content.location),
    selfIntro: toStringValue(content.selfIntro),
    jobIntention: toStringValue(content.jobIntention),
    expectedSalary: toStringValue(content.expectedSalary),
    extractedAt: toStringValue(content.extractedAt),
    ...normalizeSharedResumeFields({ ...content, profileUrl }, doc.source),
    resumeId: doc._id,
    identityKey: typeof doc.identityKey === 'string' ? doc.identityKey : undefined,
    ageNumber: typeof doc.age === 'number' ? doc.age : undefined,
    perUserId: toStringValue(content.perUserId) || undefined,
    externalId: doc.externalId,
    crawledAt: doc.crawledAt,
    analysis: parseAnalysis(doc.analysis),
    analyses: parseAnalysesMap(doc.analyses),
    ingestData: parseIngestData(doc.ingestData),
    primaryRuleScore: typeof doc.primaryRuleScore === 'number' ? doc.primaryRuleScore : undefined,
    source: doc.source,
    tags: doc.tags,
  }
}

function getResumeIdentityKey(doc: ResumeListDocLike): string {
  const identityKey = typeof doc.identityKey === 'string' ? doc.identityKey.trim() : ''
  return identityKey || String(doc._id)
}

function mergeSearchProvenance(
  left: SearchProvenance[] | undefined,
  right: SearchProvenance[] | undefined,
): SearchProvenance[] {
  const merged: SearchProvenance[] = []
  const seen = new Set<string>()

  for (const entry of [...(left ?? []), ...(right ?? [])]) {
    const key = `${entry.term}::${entry.source}::${entry.expandedFrom ?? ''}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(entry)
  }

  return merged
}

function getKeywordMatchScore(
  entry: SearchResultEntry,
  matchMap: Readonly<Record<string, ExactKeywordMatchContext>>,
): number {
  return matchMap[String(entry.resume._id)]?.score ?? -1
}

function getKeywordPrimaryRuleScore(entry: SearchResultEntry): number {
  return typeof entry.resume.primaryRuleScore === 'number' ? entry.resume.primaryRuleScore : 0
}

function compareExactKeywordDuplicateSelection(
  left: SearchResultEntry,
  right: SearchResultEntry,
  matchMap: Readonly<Record<string, ExactKeywordMatchContext>>,
): number {
  const matchScoreDiff = getKeywordMatchScore(right, matchMap) - getKeywordMatchScore(left, matchMap)
  if (matchScoreDiff !== 0) {
    return matchScoreDiff
  }

  const primaryRuleDiff = getKeywordPrimaryRuleScore(right) - getKeywordPrimaryRuleScore(left)
  if (primaryRuleDiff !== 0) {
    return primaryRuleDiff
  }

  return right.resume.crawledAt - left.resume.crawledAt
}

function parseKeywordEntryExperience(entry: SearchResultEntry): number {
  const content = isRecord(entry.resume.content) ? entry.resume.content : {}
  const matched = toStringValue(content.experience).match(/\d+(?:\.\d+)?/)
  if (!matched?.[0]) {
    return -1
  }

  const parsed = Number(matched[0])
  return Number.isFinite(parsed) ? parsed : -1
}

function parseKeywordEntryExtractedAt(entry: SearchResultEntry): number {
  const content = isRecord(entry.resume.content) ? entry.resume.content : {}
  const timestamp = Date.parse(toStringValue(content.extractedAt))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortKeywordEntries(
  entries: SearchResultEntry[],
  sortBy: ConvexResumeSortBy | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
): SearchResultEntry[] {
  if (!sortBy) {
    return entries
  }

  const direction = (sortOrder ?? 'desc') === 'desc' ? -1 : 1
  return [...entries].sort((left, right) => {
    if (sortBy === 'experience') {
      return (parseKeywordEntryExperience(left) - parseKeywordEntryExperience(right)) * direction
    }

    return (parseKeywordEntryExtractedAt(left) - parseKeywordEntryExtractedAt(right)) * direction
  })
}

function dedupeExactKeywordEntries(
  entries: SearchResultEntry[],
  matchMap: Readonly<Record<string, ExactKeywordMatchContext>>,
): SearchResultEntry[] {
  const deduped = new Map<string, SearchResultEntry>()

  for (const entry of entries) {
    const identityKey = getResumeIdentityKey(entry.resume)
    const existing = deduped.get(identityKey)
    if (!existing) {
      deduped.set(identityKey, {
        ...entry,
        provenance: mergeSearchProvenance(undefined, entry.provenance),
      })
      continue
    }

    const preferred = compareExactKeywordDuplicateSelection(existing, entry, matchMap) <= 0
      ? existing
      : entry
    deduped.set(identityKey, {
      ...preferred,
      provenance: mergeSearchProvenance(existing.provenance, entry.provenance),
    })
  }

  return Array.from(deduped.values())
}

export function useConvexResumes(
  limit: number = DEFAULT_CONVEX_RESUME_LIMIT,
  query?: string,
  jobDescriptionId?: string,
  options?: {
    enabled?: boolean
    sortBy?: ConvexResumeSortBy
    sortOrder?: 'asc' | 'desc'
    filters?: ConvexResumeFilters
  }
) {
  const enabled = options?.enabled ?? true
  const normalizedJobDescriptionId = jobDescriptionId?.trim() || undefined
  const normalizedQuery = query?.trim() || undefined
  const useExactKeywordScan = Boolean(normalizedQuery && normalizedJobDescriptionId)
  const resolvedSortOrder = options?.sortBy ? (options.sortOrder ?? 'desc') : undefined
  const initialNumItems = Math.min(limit, CONVEX_RESUME_PAGE_SIZE)
  const mockPayload = useMemo(() => readMockConvexResumePayload(), [])
  const mockKeywordExpansion = useMemo(
    () => normalizedQuery ? buildFallbackKeywordExpansion(normalizedQuery) : null,
    [normalizedQuery]
  )
  const [keywordExpansion, setKeywordExpansion] = useState<KeywordExpansionSummary | null>(null)
  const [expansionLoading, setExpansionLoading] = useState(false)

  useEffect(() => {
    let active = true

    if (!enabled) {
      setKeywordExpansion(null)
      setExpansionLoading(false)
      return () => {
        active = false
      }
    }

    if (mockPayload) {
      setKeywordExpansion(mockKeywordExpansion)
      setExpansionLoading(false)
      return () => {
        active = false
      }
    }

    if (!normalizedQuery) {
      setKeywordExpansion(null)
      setExpansionLoading(false)
      return () => {
        active = false
      }
    }

    setExpansionLoading(true)
    void rawApiClient
      .GET<{
        success: boolean
        summary?: {
          groups?: Array<{
            original: string
            variants: string[]
          }>
          mode?: 'AND' | 'OR'
          expandedTo?: string[]
          sourceMapping?: Record<string, string>
        }
      }>('/api/resumes/keyword-expansion', {
        params: {
          query: {
            q: normalizedQuery,
          },
        },
      })
      .then(({ data, error }) => {
        if (!active) {
          return
        }

        if (error || !data?.success) {
          setKeywordExpansion(buildFallbackKeywordExpansion(normalizedQuery))
          return
        }

        setKeywordExpansion({
          groups: data.summary?.groups ?? [],
          mode: data.summary?.mode ?? 'AND',
          expandedTo: data.summary?.expandedTo ?? [],
          sourceMapping: data.summary?.sourceMapping ?? {},
        })
      })
      .catch((error: unknown) => {
        console.error('Failed to load keyword expansion', error)
        if (!active) {
          return
        }
        setKeywordExpansion(buildFallbackKeywordExpansion(normalizedQuery))
      })
      .finally(() => {
        if (active) {
          setExpansionLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [enabled, mockKeywordExpansion, mockPayload, normalizedQuery])

  const paginatedSearchResults = usePaginatedQuery(
    api.resumes.searchWithTagExpansionPaginated,
    mockPayload
      ? 'skip'
      : enabled && !useExactKeywordScan && normalizedQuery && keywordExpansion
        ? {
            query: normalizedQuery,
            keywordGroups: keywordExpansion.groups,
            mode: keywordExpansion.mode,
            sourceMappings: Object.entries(keywordExpansion.sourceMapping).map(([term, expandedFrom]) => ({
              term,
              expandedFrom,
            })),
            jobDescriptionId: normalizedJobDescriptionId,
            ...(options?.filters ?? {}),
            ...(options?.sortBy ? {
              sortBy: options.sortBy,
              sortOrder: resolvedSortOrder,
            } : {}),
          }
        : 'skip',
    {
      initialNumItems,
    }
  )

  const paginatedKeywordScanResults = usePaginatedQuery(
    api.resumes.searchWithTagExpansionScanPage,
    mockPayload
      ? 'skip'
      : enabled && normalizedQuery && normalizedJobDescriptionId && keywordExpansion
        ? {
            query: normalizedQuery,
            keywordGroups: keywordExpansion.groups,
            mode: keywordExpansion.mode,
            sourceMappings: Object.entries(keywordExpansion.sourceMapping).map(([term, expandedFrom]) => ({
              term,
              expandedFrom,
            })),
            ...(options?.filters ?? {}),
          }
        : 'skip',
    {
      initialNumItems,
    }
  )

  const paginatedListResults = usePaginatedQuery(
    api.resumes.listWithIngestDataPaginated,
    mockPayload
      ? 'skip'
      : !enabled
        ? 'skip'
        : normalizedQuery && !normalizedJobDescriptionId
        ? 'skip'
        : {
            jobDescriptionId: normalizedJobDescriptionId,
            ...(options?.filters ?? {}),
            ...(options?.sortBy ? {
              sortBy: options.sortBy,
              sortOrder: resolvedSortOrder,
            } : {}),
          },
    {
      initialNumItems,
    }
  )

  const [exactKeywordMatchMap, setExactKeywordMatchMap] = useState<Record<string, ExactKeywordMatchContext>>({})
  const exactKeywordResumeIds = useMemo(() => {
    if (!useExactKeywordScan) {
      return []
    }

    return Array.from(new Set(
      paginatedKeywordScanResults.results.map((entry) => String(entry.resume._id))
    )).sort()
  }, [paginatedKeywordScanResults.results, useExactKeywordScan])
  const exactKeywordMatchScopeKey = useMemo(() => {
    if (!useExactKeywordScan) {
      return ''
    }

    return JSON.stringify({
      jobDescriptionId: normalizedJobDescriptionId,
      resumeIds: exactKeywordResumeIds,
    })
  }, [exactKeywordResumeIds, normalizedJobDescriptionId, useExactKeywordScan])

  useEffect(() => {
    let active = true

    if (!enabled || !useExactKeywordScan || !normalizedJobDescriptionId) {
      setExactKeywordMatchMap((current) => (Object.keys(current).length === 0 ? current : {}))
      return () => {
        active = false
      }
    }

    if (exactKeywordResumeIds.length === 0) {
      setExactKeywordMatchMap((current) => (Object.keys(current).length === 0 ? current : {}))
      return () => {
        active = false
      }
    }

    void rawApiClient
      .POST<{
        success: boolean
        results?: Array<{
          resumeId: string
          score: number
          recommendation: string
        }>
      }>('/api/resumes/match', {
        body: {
          source: 'convex',
          persist: false,
          mode: 'rules_only',
          jobDescriptionId: normalizedJobDescriptionId,
          resumeIds: exactKeywordResumeIds,
        },
      })
      .then(({ data, error }) => {
        if (!active) {
          return
        }

        if (error || !data?.success) {
          setExactKeywordMatchMap({})
          return
        }

        const nextMatchMap: Record<string, ExactKeywordMatchContext> = {}
        for (const item of data.results ?? []) {
          nextMatchMap[item.resumeId] = {
            score: item.score,
          }
        }
        setExactKeywordMatchMap(nextMatchMap)
      })
      .catch((error: unknown) => {
        console.error('Failed to load exact keyword match scores', error)
        if (active) {
          setExactKeywordMatchMap({})
        }
      })

    return () => {
      active = false
    }
  }, [enabled, exactKeywordMatchScopeKey, exactKeywordResumeIds, normalizedJobDescriptionId, useExactKeywordScan])

  const dedupedExactKeywordEntries = useMemo(() => {
    if (mockPayload || !useExactKeywordScan) {
      return []
    }

    return sortKeywordEntries(
      dedupeExactKeywordEntries(paginatedKeywordScanResults.results, exactKeywordMatchMap),
      options?.sortBy,
      resolvedSortOrder,
    )
  }, [
    exactKeywordMatchMap,
    mockPayload,
    options?.sortBy,
    paginatedKeywordScanResults.results,
    resolvedSortOrder,
    useExactKeywordScan,
  ])

  const useJobDescriptionFallback = Boolean(
    normalizedQuery
      && normalizedJobDescriptionId
      && !expansionLoading
      && (useExactKeywordScan ? paginatedKeywordScanResults.status : paginatedSearchResults.status) === 'Exhausted'
      && (useExactKeywordScan ? paginatedKeywordScanResults.results.length : paginatedSearchResults.results.length) === 0
  )

  const activePaginatedStatus = normalizedQuery
    ? (useJobDescriptionFallback
        ? paginatedListResults.status
        : useExactKeywordScan
          ? paginatedKeywordScanResults.status
          : paginatedSearchResults.status)
    : paginatedListResults.status
  const activePaginatedResultsLength = normalizedQuery
    ? (useJobDescriptionFallback
        ? paginatedListResults.results.length
        : useExactKeywordScan
          ? dedupedExactKeywordEntries.length
          : paginatedSearchResults.results.length)
    : paginatedListResults.results.length
  const activePaginatedLoadMore = normalizedQuery
    ? (useJobDescriptionFallback
        ? paginatedListResults.loadMore
        : useExactKeywordScan
          ? paginatedKeywordScanResults.loadMore
          : paginatedSearchResults.loadMore)
    : paginatedListResults.loadMore

  useEffect(() => {
    if (mockPayload || limit <= 0) {
      return
    }
    if (activePaginatedStatus !== 'CanLoadMore' || activePaginatedResultsLength >= limit) {
      return
    }
    activePaginatedLoadMore(Math.min(CONVEX_RESUME_PAGE_SIZE, limit - activePaginatedResultsLength))
  }, [
    activePaginatedLoadMore,
    activePaginatedResultsLength,
    activePaginatedStatus,
    limit,
    mockPayload,
  ])

  const visibleSearchResults = useMemo(
    () => paginatedSearchResults.results.slice(0, limit),
    [limit, paginatedSearchResults.results]
  )
  const visibleExactKeywordEntries = useMemo(
    () => dedupedExactKeywordEntries.slice(0, limit),
    [dedupedExactKeywordEntries, limit]
  )
  const visibleListResults = useMemo(
    () => paginatedListResults.results.slice(0, limit),
    [limit, paginatedListResults.results]
  )

  const mappedResumes = useMemo(() => (
    mockPayload
      ? normalizedQuery
        ? ((mockKeywordExpansion?.mode === 'OR'
            ? filterMockSearchResults(mockPayload.search?.results ?? [], mockKeywordExpansion)
            : applyMockExpansionProvenance(mockPayload.search?.results ?? [], mockKeywordExpansion ?? buildFallbackKeywordExpansion(normalizedQuery)))
          .slice(0, limit)
          .map((entry) => ({
            ...mapResumeDoc(entry.resume),
            _provenance: entry.provenance,
          })))
        : (mockPayload.list ?? []).slice(0, limit).map(mapResumeDoc)
      : normalizedQuery
        ? useJobDescriptionFallback
          ? visibleListResults.map(mapResumeDoc)
          : useExactKeywordScan
            ? visibleExactKeywordEntries.map((entry) => ({
                ...mapResumeDoc(entry.resume),
                _provenance: entry.provenance,
              }))
          : visibleSearchResults.map((entry) => ({
              ...mapResumeDoc(entry.resume),
              _provenance: entry.provenance,
            }))
        : visibleListResults.map(mapResumeDoc)
  ), [
    limit,
    mockKeywordExpansion,
    mockPayload,
    normalizedQuery,
    useExactKeywordScan,
    useJobDescriptionFallback,
    visibleExactKeywordEntries,
    visibleListResults,
    visibleSearchResults,
  ])

  const isLoading = !enabled
    ? false
    : mockPayload
    ? false
    : normalizedQuery
      ? (expansionLoading || activePaginatedStatus === 'LoadingFirstPage')
      : paginatedListResults.status === 'LoadingFirstPage'

  const hasMore = useMemo(() => {
    if (!enabled) {
      return false
    }

    if (mockPayload) {
      return normalizedQuery
        ? (mockPayload.search?.results?.length ?? 0) > limit
        : (mockPayload.list?.length ?? 0) > limit
    }

    return activePaginatedResultsLength > limit || activePaginatedStatus === 'CanLoadMore' || activePaginatedStatus === 'LoadingMore'
  }, [activePaginatedResultsLength, activePaginatedStatus, enabled, limit, mockPayload, normalizedQuery])

  const resolvedExpansion = mockPayload
    ? (mockPayload.search?.expansion ?? mockKeywordExpansion)
    : keywordExpansion

  const loadingMore = enabled
    && !mockPayload
    && activePaginatedStatus === 'LoadingMore'

  return {
    resumes: enabled ? mappedResumes : [],
    loading: isLoading,
    loadingMore,
    hasMore,
    jobDescriptionId: normalizedJobDescriptionId,
    expansion: resolvedExpansion,
  }
}

export function useConvexResumeDetail(resumeId: Doc<'resumes'>['_id'] | null | undefined) {
  const detailDoc = useQuery(api.resumes.getResumeDetail, resumeId ? { resumeId } : 'skip')

  return useMemo(() => ({
    resume: detailDoc ? mapResumeDoc(detailDoc) : null,
    loading: resumeId !== null && resumeId !== undefined && detailDoc === undefined,
  }), [detailDoc, resumeId])
}
