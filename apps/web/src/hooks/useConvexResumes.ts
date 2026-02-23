import { useQuery } from 'convex/react'
import { api } from '../../../../packages/convex/convex/_generated/api'
import type { Doc } from '../../../../packages/convex/convex/_generated/dataModel'
import type { ResumeItem } from './useResumes'

export type ConvexResumeAnalysis = {
  score: number
  summary: string
  highlights: string[]
  recommendation: string
  concerns?: string[]
  breakdown?: Record<string, number>
  jobDescriptionId?: string
}

export type ConvexIngestData = {
  industryTags: string[]
  synonymHits: string[]
  ruleScores: Record<string, number>
  experienceLevel: string
  computedAt: number
  skillsVersion: number
}

export type ConvexResumeItem = ResumeItem & {
  resumeId: Doc<'resumes'>['_id']
  externalId: string
  crawledAt: number
  analysis?: ConvexResumeAnalysis
  analyses?: Record<string, ConvexResumeAnalysis>
  ingestData?: ConvexIngestData
  source: string
  tags: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
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

  return {
    industryTags: toStringArray(value.industryTags),
    synonymHits: toStringArray(value.synonymHits),
    ruleScores: parseRuleScores(value.ruleScores),
    experienceLevel: toStringValue(value.experienceLevel) || 'unknown',
    computedAt,
    skillsVersion,
  }
}

function mapResumeDoc(doc: Doc<'resumes'>): ConvexResumeItem {
  const content = isRecord(doc.content) ? doc.content : {}

  return {
    name: toStringValue(content.name),
    profileUrl: toStringValue(content.profileUrl),
    activityStatus: toStringValue(content.activityStatus),
    age: toStringValue(content.age),
    experience: toStringValue(content.experience),
    education: toStringValue(content.education),
    location: toStringValue(content.location),
    selfIntro: toStringValue(content.selfIntro),
    jobIntention: toStringValue(content.jobIntention),
    expectedSalary: toStringValue(content.expectedSalary),
    workHistory: toWorkHistory(content.workHistory),
    extractedAt: toStringValue(content.extractedAt),
    resumeId: doc._id,
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
