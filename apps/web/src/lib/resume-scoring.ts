import {
  buildLatestWorkHistoryEvidence,
  getCurrentResumeAiPromptVersion,
  isRecord,
  normalizeOptionalString,
  resolveResumeId,
} from '@trends/shared'
import type { ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeAnalysis } from '@/hooks/useConvexResumes'
import type { MatchBreakdown, Recommendation } from '@/types/resume'
import { buildResumeAnalysisLookupKeys } from '@/lib/analysis-utils'

export interface BrandHitLike {
  brand: string
  role: string
  source: string
  context: string
}

export function summarizeBrandHits(brandHits: BrandHitLike[] | undefined, maxCount = 4): string[] {
  if (!brandHits || brandHits.length === 0) return []
  const groups = new Map<string, number>()
  for (const hit of brandHits) {
    if (hit.context === 'employer') continue
    const key = hit.brand.trim().toLowerCase()
    if (!key) continue
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxCount)
    .map(([brand]) => brand)
}

const EXPERIENCE_LEVEL_MAP: Record<string, ExperienceLevelFilter> = {
  '资深': 'senior',
  '資深': 'senior',
  'senior level': 'senior',
  '中级': 'mid',
  '中級': 'mid',
  'mid level': 'mid',
  '初级': 'junior',
  '初級': 'junior',
  'junior level': 'junior',
  'entry level': 'junior',
}

export type ExperienceLevelFilter = 'senior' | 'mid' | 'junior'

export function normalizeExperienceLevel(level: string | undefined): ExperienceLevelFilter | undefined {
  const normalized = level?.trim().toLowerCase()
  if (!normalized || normalized === 'unknown') {
    return undefined
  }
  if (normalized === 'senior') return 'senior'
  if (normalized === 'mid') return 'mid'
  if (normalized === 'junior') return 'junior'
  const mapped = EXPERIENCE_LEVEL_MAP[level!.trim().toLowerCase()]
  return mapped
}

export function getExperienceBadge(level: string | undefined, t: (key: string, opts?: { defaultValue?: string }) => string): { label: string; className: string } | null {
  const canonical = normalizeExperienceLevel(level)
  if (canonical === 'senior') {
    return {
      label: t('resumes.experienceLevel.senior', { defaultValue: 'Senior' }),
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    }
  }
  if (canonical === 'mid') {
    return {
      label: t('resumes.experienceLevel.mid', { defaultValue: 'Mid' }),
      className: 'border-teal-200 bg-teal-50 text-teal-700',
    }
  }
  if (canonical === 'junior') {
    return {
      label: t('resumes.experienceLevel.junior', { defaultValue: 'Junior' }),
      className: 'border-zinc-200 bg-zinc-50 text-zinc-600',
    }
  }
  return null
}

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

export type ResumeScoringWorkHistoryItem = {
  raw?: string
  companyName?: string
  jobTitle?: string
  description?: string
  startDate?: string
  endDate?: string
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

export function recommendationFromScore(score: number): Recommendation {
  if (!Number.isFinite(score)) {
    return 'no_match'
  }

  if (score >= 85) {
    return 'strong_match'
  }

  if (score >= 70) {
    return 'match'
  }

  if (score >= 50) {
    return 'potential'
  }

  return 'no_match'
}

export function getRoleLabel(type: string): string {
  const normalized = type.trim().toLowerCase()
  return ROLE_LABELS[normalized] ?? type
}

export function formatRoleYears(years: number, locale?: string): string {
  if (!Number.isFinite(years) || years <= 0) {
    return locale?.startsWith('en') ? '0 years' : '0年'
  }

  const rounded = Math.round(years * 10) / 10
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  const value = label.replace(/\.0$/, '')

  if (locale?.startsWith('en')) {
    return years === 1 ? '1 year' : `${value} years`
  }
  return `${value}年`
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
  keywords: string[],
  options?: {
    location?: string
    promptVersion?: number
    sourceKey?: string
    locale?: string
  }
): ConvexResumeAnalysis | undefined {
  const lookupKeys = buildResumeAnalysisLookupKeys(jobDescriptionId, keywords, options)
  const hasCachedAnalyses = Boolean(resume.analyses && Object.keys(resume.analyses).length > 0)
  const analysisFromCache = lookupKeys.find((lookupKey) => lookupKey && resume.analyses?.[lookupKey])
  const analysis = analysisFromCache
    ? resume.analyses?.[analysisFromCache]
    : resume.analysis && (
      lookupKeys.length === 0
      || (
        (!options?.sourceKey || !hasCachedAnalyses)
        && lookupKeys.includes(resume.analysis.jobDescriptionId ?? '')
      )
    )
      ? resume.analysis
      : undefined

  if (!analysis) {
    return undefined
  }

  const currentPromptVersion = options?.promptVersion ?? getCurrentResumeAiPromptVersion()
  if (analysis.promptVersion !== currentPromptVersion) {
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
  const lower = value.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false
  }
  return lower.startsWith('http://') || lower.startsWith('https://')
}

export function getResumeSourceLabel(resume: unknown): string | undefined {
  if (!resume || typeof resume !== 'object' || !('source' in resume) || typeof resume.source !== 'string') {
    return undefined
  }

  return normalizeOptionalString(resume.source)
}

export function getResumeContentLocale(resume: unknown): string | undefined {
  const source = getResumeSourceLabel(resume)?.toLowerCase()
  if (!source) {
    return undefined
  }

  if (source.includes('51job')) {
    return 'zh-Hans'
  }
  if (source.includes('job5156')) {
    return 'zh-Hant'
  }
  if (source.includes('seek')) {
    return 'en'
  }

  return undefined
}

/**
 * Returns the appropriate locale for name sorting/collation.
 * Uses content locale when available, falls back to zh-Hans-CN
 * for backward compatibility with Chinese-source-only datasets.
 */
export function getNameSortLocale(resume: unknown): string {
  const contentLocale = getResumeContentLocale(resume)
  if (contentLocale?.startsWith('en')) {
    return 'en'
  }
  return 'zh-Hans-CN'
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
  workHistory?: ResumeScoringWorkHistoryItem[]
  projectExperience?: ResumeScoringWorkHistoryItem[]
  tags?: string[]
}): string {
  return [
    resume.name,
    resume.jobIntention,
    resume.education,
    resume.experience,
    resume.location,
    resume.selfIntro,
    ...buildLatestWorkHistoryEvidence(resume.workHistory).lines,
    ...(resume.projectExperience ?? []).map((entry) => entry?.raw || [entry?.companyName, entry?.jobTitle, entry?.description].filter(Boolean).join(' ')),
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
    brandHits?: BrandHitLike[]
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
const MY_INDUSTRY_DB_FLOOR = 40

const RELATED_EXP_CEILING_BY_RECOMMENDATION: Record<string, number> = {
  strong_match: 100,
  match: 100,
  potential: 60,
  no_match: 30,
}
const INDUSTRY_DB_V2_MIN_NONZERO_SAMPLE_SIZE = 5

export function computeDirectIndustryDb(
  raw: number | undefined,
  hasBrandHits: boolean,
  hasCompanyHits: boolean,
): number {
  // Additive weights matching Convex analysis_normalization.ts:
  //   brand hit → 30, company hit → 20, both → 50.
  // Math.max(raw, additive) so a high raw value is never suppressed.
  const additiveScore = (hasBrandHits ? 30 : 0) + (hasCompanyHits ? 20 : 0)
  const safeRaw = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  return clamp(Math.max(safeRaw, additiveScore), 0, INDUSTRY_DB_V2_SCORE_CAP)
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
  industryDb: number,
  market?: string,
): ConvexResumeAnalysis {
  const effectiveIndustryDb = market === 'MY' ? Math.max(MY_INDUSTRY_DB_FLOOR, industryDb) : industryDb
  const recommendationCeiling = RELATED_EXP_CEILING_BY_RECOMMENDATION[analysis.recommendation ?? ''] ?? 30
  const rawRelatedExp = typeof analysis.breakdown?.related_exp === 'number' ? analysis.breakdown.related_exp : 0
  // score = the related_exp factor (after the recommendation ceiling). industry_db is NOT
  // added to the score — it stays in the breakdown as a display/sort signal only.
  const cappedRelatedExp = clamp(Math.min(rawRelatedExp, recommendationCeiling), 0, 100)
  const nextBreakdown: MatchBreakdown = {
    ...(analysis.breakdown ?? {}),
    related_exp: cappedRelatedExp,
    industry_db: effectiveIndustryDb,
  }

  return {
    ...analysis,
    score: cappedRelatedExp,
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
