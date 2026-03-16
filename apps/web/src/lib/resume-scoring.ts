import { buildWorkHistoryEntryText, resolveResumeId } from '@trends/shared'
import type { ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeAnalysis } from '@/hooks/useConvexResumes'
import type { MatchBreakdown, Recommendation } from '@/types/resume'
import { deriveAnalysisLookupKey } from '@/lib/analysis-utils'

export type IndustryDbV2Stats = {
  size: number
  min?: number
  max?: number
  p50?: number
  p80: number
  mean?: number
  stddev?: number
  histogram50: number[]
}

export type ResumeMatchedWorkEntry = {
  companyName?: string
  jobTitle?: string
  years: number
  industryVerified: boolean
  matchedSignals: string[]
}

export type ResumeRoleSignalLike = {
  type: string
  matchedSignals: string[]
  signalCount: number
  occurrences: number
  years: number
  industryVerifiedYears?: number
  roleRelevantYears?: number
  industryVerifiedRelevantYears?: number
  matchedWorkEntries?: ResumeMatchedWorkEntry[]
  verifyIn: string
}

const VALID_RECOMMENDATIONS: Recommendation[] = ['strong_match', 'match', 'potential', 'no_match']
const ROLE_LABELS: Record<string, string> = {
  sales: '销售',
  engineer: '工程',
  operator: '操作',
  technician: '技术',
  manager: '管理',
}

export function isRecommendation(value: string): value is Recommendation {
  return VALID_RECOMMENDATIONS.some((item) => item === value)
}

export function toRecommendation(value: string): Recommendation {
  return isRecommendation(value) ? value : 'potential'
}

export function getRoleLabel(type: string): string {
  const normalized = type.trim().toLowerCase()
  return ROLE_LABELS[normalized] ?? type
}

export function formatRoleYears(years: number): string {
  if (!Number.isFinite(years) || years <= 0) {
    return '0年'
  }

  const rounded = Math.round(years * 10) / 10
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${label.replace(/\.0$/, '')}年`
}

export function getRoleRelevantYears(signal: Pick<ResumeRoleSignalLike, 'roleRelevantYears' | 'years'>): number {
  return typeof signal.roleRelevantYears === 'number' && Number.isFinite(signal.roleRelevantYears)
    ? signal.roleRelevantYears
    : signal.years
}

export function getRoleVerifiedYears(
  signal: Pick<ResumeRoleSignalLike, 'industryVerifiedRelevantYears' | 'industryVerifiedYears'>
): number {
  if (typeof signal.industryVerifiedRelevantYears === 'number' && Number.isFinite(signal.industryVerifiedRelevantYears)) {
    return signal.industryVerifiedRelevantYears
  }

  return typeof signal.industryVerifiedYears === 'number' && Number.isFinite(signal.industryVerifiedYears)
    ? signal.industryVerifiedYears
    : 0
}

export function toMatchBreakdown(value: Record<string, number> | undefined): MatchBreakdown | undefined {
  if (!value || Object.keys(value).length === 0) return undefined
  return value
}

export function getAnalysisForJob(
  resume: {
    analyses?: Record<string, ConvexResumeAnalysis>
    analysis?: ConvexResumeAnalysis
    ingestData?: {
      computedAt?: number
    }
  },
  jobDescriptionId: string | undefined,
  keywords: string[]
): ConvexResumeAnalysis | undefined {
  const lookupKey = deriveAnalysisLookupKey(jobDescriptionId, keywords)
  const analysis = lookupKey && resume.analyses?.[lookupKey]
    ? resume.analyses[lookupKey]
    : resume.analysis && (!lookupKey || resume.analysis.jobDescriptionId === lookupKey)
      ? resume.analysis
      : undefined

  if (!analysis) {
    return undefined
  }

  const ingestTime = resume.ingestData?.computedAt
  const analysisTime = analysis.analyzedAt
  if (analysis && ingestTime && analysisTime && ingestTime > analysisTime) {
    return undefined
  }

  return analysis
}

export function isAutoFilteredAnalysis(analysis: ConvexResumeAnalysis | undefined): boolean {
  if (!analysis) return false
  const summary = analysis.summary || ''
  const keywordMatch = analysis.breakdown?.keyword_match
  return (
    summary.startsWith('Auto-filtered: Low keyword match with JD.')
    && analysis.recommendation === 'no_match'
    && keywordMatch === 10
  )
}

export function isSafeProfileUrl(value: string | undefined): value is string {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

export function buildResumeKey(resume: ResumeItem, index: number): string {
  return resolveResumeId(resume, index)
}

export function buildRuleScoringText(resume: {
  name?: string
  jobIntention?: string
  education?: string
  experience?: string
  location?: string
  selfIntro?: string
  workHistory?: ResumeItem['workHistory']
  tags?: string[]
}): string {
  return [
    resume.name,
    resume.jobIntention,
    resume.education,
    resume.experience,
    resume.location,
    resume.selfIntro,
    ...(resume.workHistory || []).map((work) => buildWorkHistoryEntryText(work)),
    resume.tags?.join(' '),
  ]
    .filter((item): item is string => Boolean(item))
    .join(' ')
}

export function getPrecomputedRuleScore(
  resume: {
    ingestData?: {
      ruleScores?: Record<string, number>
    }
  },
  jobDescriptionId: string | undefined
): number | null {
  if (!jobDescriptionId) {
    return null
  }

  const score = resume.ingestData?.ruleScores?.[jobDescriptionId]
  if (typeof score === 'number' && Number.isFinite(score)) {
    return score
  }

  return null
}

export type ResumeWithIngestData = ResumeItem & {
  ingestData: {
    evidenceText?: string
    industryTags: string[]
    brandHits?: Array<{
      brand: string
      role: string
      source: string
      context: string
    }>
    companyHits: string[]
    roleSignals?: ResumeRoleSignalLike[]
    ruleScores: Record<string, number>
    experienceLevel: string
    computedAt: number
    skillsVersion: number
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeHistogram50(histogram50: number[]): number[] {
  return Array.from({ length: 51 }, (_, score) => {
    const count = histogram50[score]
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  })
}

function countHistogramSamples(histogram50: number[]): number {
  return histogram50.reduce((total, count) => total + count, 0)
}

const INDUSTRY_DB_V2_SCORE_CAP = 50
const INDUSTRY_DB_V2_MIN_NONZERO_SAMPLE_SIZE = 5
const INDUSTRY_DB_V2_BRAND_SECTION_SCORE = 30
const INDUSTRY_DB_V2_COMPANY_SECTION_SCORE = 20

export function bumpIndustryDbV2Raw(
  raw: number | undefined,
  hasBrandHits: boolean,
  hasCompanyHits: boolean
): number {
  const sectionBump =
    (hasBrandHits ? INDUSTRY_DB_V2_BRAND_SECTION_SCORE : 0) +
    (hasCompanyHits ? INDUSTRY_DB_V2_COMPANY_SECTION_SCORE : 0)
  const safeRaw = typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, 0, INDUSTRY_DB_V2_SCORE_CAP) : 0
  return Math.max(safeRaw, sectionBump)
}

function nonZeroP80FromHistogram(histogram50: number[]): { p80: number; count: number } {
  const nonZeroValues: number[] = []
  histogram50.forEach((count, score) => {
    if (score > 0) {
      for (let i = 0; i < count; i++) {
        nonZeroValues.push(score)
      }
    }
  })
  if (nonZeroValues.length === 0) {
    return { p80: 0, count: 0 }
  }
  nonZeroValues.sort((a, b) => a - b)
  const pos = (nonZeroValues.length - 1) * 0.8
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const p80 = lo === hi ? nonZeroValues[lo] : nonZeroValues[lo] * (1 - (pos - lo)) + nonZeroValues[hi] * (pos - lo)
  return { p80, count: nonZeroValues.length }
}

function percentileRankFromHistogram(histogram50: number[], raw: number): number {
  const total = countHistogramSamples(histogram50)
  if (total <= 1) {
    return 1
  }

  const roundedRaw = Math.round(clamp(raw, 0, INDUSTRY_DB_V2_SCORE_CAP))
  let lowerBound = 0
  let upperBound = 0

  histogram50.forEach((count, score) => {
    if (score < roundedRaw) {
      lowerBound += count
      upperBound += count
      return
    }

    if (score === roundedRaw) {
      upperBound += count
    }
  })

  if (upperBound === 0) {
    return 0
  }

  if (lowerBound === total) {
    return 1
  }

  const midpoint = (lowerBound + upperBound - 1) / 2
  return midpoint / (total - 1)
}

function safeFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function toIndustryDbV2Stats(value: unknown): IndustryDbV2Stats | undefined {
  if (!isRecord(value) || !Array.isArray(value.histogram50)) {
    return undefined
  }

  const size = safeFiniteNumber(value.size)
  const min = safeFiniteNumber(value.min)
  const max = safeFiniteNumber(value.max)
  const p50 = safeFiniteNumber(value.p50)
  const p80 = safeFiniteNumber(value.p80)
  const mean = safeFiniteNumber(value.mean)
  const stddev = safeFiniteNumber(value.stddev)

  return {
    size: size !== undefined ? Math.max(0, Math.floor(size)) : 0,
    ...(min !== undefined && { min }),
    ...(max !== undefined && { max }),
    ...(p50 !== undefined && { p50 }),
    p80: p80 ?? 0,
    ...(mean !== undefined && { mean }),
    ...(stddev !== undefined && { stddev }),
    histogram50: normalizeHistogram50(value.histogram50),
  }
}

export function createBatchNormalizer(
  stats: IndustryDbV2Stats | undefined
): (raw: number | undefined) => number {
  const toSafeRaw = (raw: number | undefined) =>
    typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, 0, INDUSTRY_DB_V2_SCORE_CAP) : 0

  if (!stats || stats.size < 30) {
    return (raw) => Math.round(toSafeRaw(raw))
  }

  const histogram50 = normalizeHistogram50(stats.histogram50)
  const sampleSize = countHistogramSamples(histogram50)
  if (sampleSize < 30) {
    return (raw) => Math.round(toSafeRaw(raw))
  }

  const { p80: effectiveP80, count: nonZeroCount } = nonZeroP80FromHistogram(histogram50)
  if (nonZeroCount < INDUSTRY_DB_V2_MIN_NONZERO_SAMPLE_SIZE) {
    return (raw) => Math.round(toSafeRaw(raw))
  }

  return (raw) => {
    const safeRaw = toSafeRaw(raw)
    const rank = percentileRankFromHistogram(histogram50, safeRaw)
    const base = 40 * clamp(safeRaw / Math.max(effectiveP80, 1), 0, 1)
    const bonus = 10 * clamp((rank - 0.8) / 0.2, 0, 1)
    return Math.round(Math.min(INDUSTRY_DB_V2_SCORE_CAP, base + bonus))
  }
}

export function computeNormalizedIndustryDbScore(raw: number | undefined, stats: IndustryDbV2Stats | undefined): number {
  return createBatchNormalizer(stats)(raw)
}

export function overrideIndustryDbBreakdown(
  analysis: ConvexResumeAnalysis,
  raw: number | undefined,
  normalizer: (raw: number | undefined) => number
): ConvexResumeAnalysis {
  const normalizedIndustryDb = normalizer(raw)
  const nextBreakdown: MatchBreakdown = {
    ...(analysis.breakdown ?? {}),
    industry_db: normalizedIndustryDb,
  }
  const relatedExp = typeof nextBreakdown.related_exp === 'number' ? nextBreakdown.related_exp : 0

  return {
    ...analysis,
    score: Math.min(100, relatedExp + normalizedIndustryDb),
    breakdown: nextBreakdown,
  }
}

export function hasIngestData(resume: unknown): resume is ResumeWithIngestData {
  if (typeof resume !== 'object' || resume === null || !('ingestData' in resume)) {
    return false
  }

  const ingestData = resume.ingestData
  if (!isRecord(ingestData)) {
    return false
  }

  const ruleScores = ingestData.ruleScores
  if (!isRecord(ruleScores)) {
    return false
  }

  return (
    (ingestData.evidenceText === undefined || typeof ingestData.evidenceText === 'string')
    && isStringArray(ingestData.industryTags)
    && isStringArray(ingestData.companyHits)
    && typeof ingestData.experienceLevel === 'string'
    && typeof ingestData.computedAt === 'number'
    && typeof ingestData.skillsVersion === 'number'
  )
}

export function buildLearningObservation(
  action: 'shortlist' | 'reject',
  resume: ResumeWithIngestData
): string {
  const level = resume.ingestData.experienceLevel || 'unknown'
  const tokens = [...resume.ingestData.industryTags, level].filter((token) => token.length > 0)

  if (action === 'shortlist') {
    return `shortlist_pattern: ${tokens.join(' + ')} -> high_priority`
  }

  return `reject_pattern: ${tokens.join('/')} -> low_fit`
}
