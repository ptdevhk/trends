import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import type { ResumeItem } from './useResumes'

export type ConvexResumeAnalysis = {
  score: number
  summary: string
  highlights: string[]
  recommendation: string
  analyzedAt?: number
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
  roleSignals?: Array<{
    type: string
    matchedSignals: string[]
    signalCount: number
    occurrences: number
    years: number
    verifyIn: string
  }>
  tagEnvelope?: Array<{
    tag: string
    source: string
    confidence: number
    evidence: string[]
    version: number
  }>
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

export type ConvexResumeItem = ResumeItem & {
  resumeId: Doc<'resumes'>['_id']
  identityKey?: string
  ageNumber?: number
  externalId: string
  crawledAt: number
  analysis?: ConvexResumeAnalysis
  analyses?: Record<string, ConvexResumeAnalysis>
  ingestData?: ConvexIngestData
  source: string
  tags: string[]
}

const JOB5156_HOST = 'hr.job5156.com'
const JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractJob5156ResumeId(pathname: string): string | null {
  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i)
  if (oldRouteMatch && oldRouteMatch[1]) {
    return decodeURIComponentSafe(oldRouteMatch[1])
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i)
  if (viewRouteMatch && viewRouteMatch[1]) {
    return decodeURIComponentSafe(viewRouteMatch[1])
  }

  return null
}

function normalizeJob5156ProfileUrlForDisplay(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const directResumeId = extractJob5156ResumeId(trimmed)
  if (directResumeId) {
    return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(directResumeId)}`
  }

  let parsed: URL | null = null
  try {
    parsed = new URL(trimmed)
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      parsed = null
    }
  }

  if (!parsed || parsed.hostname.toLowerCase() !== JOB5156_HOST) {
    return trimmed
  }

  const resumeId = extractJob5156ResumeId(parsed.pathname)
  if (!resumeId) {
    return trimmed
  }

  return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

function toWorkHistory(value: unknown): ResumeItem['workHistory'] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }
      return { raw: toStringValue(item.raw) }
    })
    .filter((item): item is { raw: string } => item !== null)
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

function parseTagEnvelope(value: unknown): ConvexIngestData['tagEnvelope'] {
  if (!Array.isArray(value)) {
    return undefined
  }

  const parsed = value
    .map((item) => {
      if (!isRecord(item)) {
        return null
      }

      const tag = toStringValue(item.tag).trim().toLowerCase()
      const source = toStringValue(item.source).trim().toLowerCase()
      const confidence = toNumber(item.confidence)
      const version = toNumber(item.version)

      if (!tag || !source || confidence === null || version === null) {
        return null
      }

      return {
        tag,
        source,
        confidence,
        evidence: toStringArray(item.evidence),
        version,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return parsed.length > 0 ? parsed : undefined
}

function inferTaggingStage(tag: string): string {
  if (tag.startsWith('industry:')) {
    return 'industry_taxonomy'
  }
  if (tag.startsWith('synonym:')) {
    return 'synonym_expansion'
  }
  if (tag.startsWith('company:')) {
    return 'company_pattern_match'
  }
  if (tag.startsWith('role:')) {
    return 'role_signal_aggregation'
  }
  if (tag.startsWith('experience:')) {
    return 'experience_signal_detection'
  }
  return 'derived'
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

function parseLegacyTaggingEnvelope(
  tagEnvelope: ConvexIngestData['tagEnvelope'],
  generatedAt: number
): ConvexIngestData['taggingEnvelope'] {
  if (!tagEnvelope || tagEnvelope.length === 0) {
    return undefined
  }

  return {
    schemaVersion: 1,
    generatedAt,
    entries: tagEnvelope.map((entry) => ({
      tag: entry.tag,
      source: entry.source,
      confidence: entry.confidence,
      version: entry.version,
      provenance: {
        stage: inferTaggingStage(entry.tag),
        generatedBy: 'legacy-tag-envelope-bridge',
        evidence: entry.evidence,
      },
    })),
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

  const tagEnvelope = parseTagEnvelope(value.tagEnvelope)
  const taggingEnvelope = parseTaggingEnvelope(value.taggingEnvelope)
    ?? parseLegacyTaggingEnvelope(tagEnvelope, computedAt)

  return {
    evidenceText: toStringValue(value.evidenceText) || undefined,
    industryTags: toStringArray(value.industryTags),
    synonymHits: toStringArray(value.synonymHits),
    brandHits: parseBrandHits(value.brandHits),
    companyHits: toStringArray(value.companyHits),
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
              verifyIn: toStringValue(item.verifyIn) || 'workHistory',
            }
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : undefined,
    tagEnvelope,
    taggingEnvelope,
    ruleScores: parseRuleScores(value.ruleScores),
    experienceLevel: toStringValue(value.experienceLevel) || 'unknown',
    computedAt,
    skillsVersion,
  }
}

function mapResumeDoc(doc: Doc<'resumes'>): ConvexResumeItem {
  const content = isRecord(doc.content) ? doc.content : {}
  const rawProfileUrl = toStringValue(content.profileUrl)
    || toStringValue(content.profile_url)
    || toStringValue(content.profileURL)
    || toStringValue(content.url)

  return {
    name: toStringValue(content.name),
    profileUrl: normalizeJob5156ProfileUrlForDisplay(rawProfileUrl),
    activityStatus: toStringValue(content.activityStatus),
    age: toStringValue(content.age),
    experience: '',
    education: toStringValue(content.education),
    location: toStringValue(content.location),
    selfIntro: '',
    jobIntention: '',
    expectedSalary: toStringValue(content.expectedSalary),
    workHistory: toWorkHistory(content.workHistory),
    extractedAt: toStringValue(content.extractedAt),
    resumeId: doc._id,
    identityKey: typeof doc.identityKey === 'string' ? doc.identityKey : undefined,
    ageNumber: typeof doc.age === 'number' ? doc.age : undefined,
    perUserId: toStringValue(content.perUserId) || undefined,
    externalId: doc.externalId,
    crawledAt: doc.crawledAt,
    analysis: parseAnalysis(doc.analysis),
    analyses: parseAnalysesMap(doc.analyses),
    ingestData: parseIngestData(doc.ingestData),
    source: doc.source,
    tags: doc.tags,
  }
}

export function useConvexResumes(limit: number = 200, query?: string, jobDescriptionId?: string) {
  const normalizedJobDescriptionId = jobDescriptionId?.trim() || undefined

  const searchResults = useQuery(
    api.resumes.searchWithIngestData,
    query ? { query, limit, jobDescriptionId: normalizedJobDescriptionId } : 'skip'
  )

  const listResults = useQuery(
    api.resumes.listWithIngestData,
    query ? 'skip' : { limit, jobDescriptionId: normalizedJobDescriptionId }
  )

  const convexResumes = query ? searchResults : listResults

  const mappedResumes = (convexResumes ?? []).map(mapResumeDoc)

  return {
    resumes: mappedResumes,
    loading: convexResumes === undefined,
    jobDescriptionId: normalizedJobDescriptionId,
  }
}
