import type { ResumeItem } from '@/hooks/useResumes'
import type { ConvexResumeAnalysis } from '@/hooks/useConvexResumes'
import type { MatchBreakdown, Recommendation } from '@/types/resume'
import { deriveAnalysisLookupKey } from '@/lib/analysis-utils'

const VALID_RECOMMENDATIONS: Recommendation[] = ['strong_match', 'match', 'potential', 'no_match']

export function isRecommendation(value: string): value is Recommendation {
  return VALID_RECOMMENDATIONS.some((item) => item === value)
}

export function toRecommendation(value: string): Recommendation {
  return isRecommendation(value) ? value : 'potential'
}

export function toMatchBreakdown(value: Record<string, number> | undefined): MatchBreakdown | undefined {
  if (!value) return undefined

  const {
    skillMatch,
    experienceMatch,
    educationMatch,
    locationMatch,
    industryMatch,
    brandRelevance,
  } = value

  if (
    typeof skillMatch !== 'number'
    || typeof experienceMatch !== 'number'
    || typeof educationMatch !== 'number'
    || typeof locationMatch !== 'number'
    || typeof industryMatch !== 'number'
  ) {
    return undefined
  }

  return {
    skillMatch,
    experienceMatch,
    educationMatch,
    locationMatch,
    industryMatch,
    brandRelevance: typeof brandRelevance === 'number' ? brandRelevance : 0,
  }
}

export function getAnalysisForJob(
  resume: {
    analyses?: Record<string, ConvexResumeAnalysis>
    analysis?: ConvexResumeAnalysis
  },
  jobDescriptionId: string | undefined,
  keywords: string[]
): ConvexResumeAnalysis | undefined {
  const lookupKey = deriveAnalysisLookupKey(jobDescriptionId, keywords)
  if (lookupKey && resume.analyses?.[lookupKey]) {
    return resume.analyses[lookupKey]
  }
  if (resume.analysis) {
    if (!lookupKey) return resume.analysis
    if (resume.analysis.jobDescriptionId === lookupKey) return resume.analysis
  }
  return undefined
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
  if (resume.resumeId) {
    return resume.resumeId
  }
  if (resume.perUserId) {
    return resume.perUserId
  }
  if (isSafeProfileUrl(resume.profileUrl)) {
    return resume.profileUrl
  }
  return `${resume.name}-${resume.extractedAt || index}`
}

export function buildRuleScoringText(resume: {
  name?: string
  jobIntention?: string
  education?: string
  experience?: string
  location?: string
  selfIntro?: string
  workHistory?: Array<{ raw?: string }>
  tags?: string[]
}): string {
  return [
    resume.name,
    resume.jobIntention,
    resume.education,
    resume.experience,
    resume.location,
    resume.selfIntro,
    ...(resume.workHistory || []).map((work) => work.raw),
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
    industryTags: string[]
    brandHits?: Array<{
      brand: string
      role: string
      source: string
      context: string
    }>
    companyHits: string[]
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
    isStringArray(ingestData.industryTags)
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
  const tags = resume.ingestData.industryTags.length > 0
    ? resume.ingestData.industryTags.join('/')
    : 'none'
  const level = resume.ingestData.experienceLevel || 'unknown'
  return `${action} pattern -> ${tags} + ${level}`
}
