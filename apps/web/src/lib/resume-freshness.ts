import skillsKnowledgeSource from '../../../../config/resume/skills.md?raw'

import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  getCurrentResumeAiPromptVersion,
  isIngestStale,
} from '@trends/shared'

import { buildResumeAnalysisLookupKeys } from '@/lib/analysis-utils'

export type ResumeAnalysisLike = {
  analyzedAt?: number
  jobDescriptionId?: string
  promptVersion?: number
}

type ResumeIngestLike = {
  computedAt?: number
  skillsVersion?: number | null
  ingestComputeEpoch?: number | null
}

type ResumeAnalysisMapLike<TAnalysis extends ResumeAnalysisLike = ResumeAnalysisLike> = Record<string, TAnalysis | undefined>

export type ResumeRefreshResumeLike<TAnalysis extends ResumeAnalysisLike = ResumeAnalysisLike> = {
  analysis?: TAnalysis
  analyses?: ResumeAnalysisMapLike<TAnalysis>
  ingestData?: ResumeIngestLike | null
}

export type ResumeRefreshAnalysisContext = {
  jobDescriptionId?: string
  keywords?: string[]
  location?: string
  sourceKey?: string
  locale?: string
}

export type ResumeRefreshAction = 'reingest' | 'rerun_analysis'

export type ResumeRefreshKind =
  | 'fresh'
  | 'ingest_stale'
  | 'analysis_stale'
  | 'both_stale'

export type ResumeRefreshState = {
  kind: ResumeRefreshKind
  isStale: boolean
  ingestStale: boolean
  analysisStale: boolean
  actions: ResumeRefreshAction[]
}

function parseCurrentResumeSkillsVersion(source: string): number {
  const match = source.match(/(?:^|\n)version:\s*(\d+)\s*(?:\n|$)/)
  if (!match) {
    throw new Error('Unable to resolve current resume skills version from config/resume/skills.md')
  }

  const version = Number(match[1])
  if (!Number.isFinite(version)) {
    throw new Error('Resolved resume skills version is not a finite number')
  }

  return version
}

function hasMeaningfulAnalysisContext(
  context: ResumeRefreshAnalysisContext | undefined,
): boolean {
  if (!context) {
    return false
  }

  const normalizedJobDescriptionId = context.jobDescriptionId?.trim()
  if (normalizedJobDescriptionId) {
    return true
  }

  return (context.keywords ?? []).some((keyword) => keyword.trim().length > 0)
}

function buildResumeRefreshActions(params: {
  ingestStale: boolean
  analysisStale: boolean
}): ResumeRefreshAction[] {
  const actions: ResumeRefreshAction[] = []

  if (params.ingestStale) {
    actions.push('reingest')
  }

  if (params.analysisStale) {
    actions.push('rerun_analysis')
  }

  return actions
}

export const CURRENT_RESUME_SKILLS_VERSION = parseCurrentResumeSkillsVersion(skillsKnowledgeSource)

export function resolveStoredResumeAnalysis<TAnalysis extends ResumeAnalysisLike>(params: {
  resume: ResumeRefreshResumeLike<TAnalysis>
  analysisContext?: ResumeRefreshAnalysisContext
}): TAnalysis | undefined {
  const { resume, analysisContext } = params
  const normalizedJobDescriptionId = analysisContext?.jobDescriptionId?.trim() || undefined
  const keywords = analysisContext?.keywords ?? []
  const lookupKeys = buildResumeAnalysisLookupKeys(normalizedJobDescriptionId, keywords, {
    location: analysisContext?.location,
    sourceKey: analysisContext?.sourceKey,
    locale: analysisContext?.locale,
  })
  const hasCachedAnalyses = Boolean(resume.analyses && Object.keys(resume.analyses).length > 0)

  const analysisFromCache = lookupKeys.find((lookupKey) => lookupKey && resume.analyses?.[lookupKey])
  if (analysisFromCache) {
    return resume.analyses?.[analysisFromCache]
  }

  if (!resume.analysis) {
    return undefined
  }

  if (lookupKeys.length === 0) {
    return resume.analysis
  }

  if ((!analysisContext?.sourceKey || !hasCachedAnalyses) && lookupKeys.includes(resume.analysis.jobDescriptionId ?? '')) {
    return resume.analysis
  }

  return undefined
}

export function resolveResumeRefreshState(params: {
  resume: ResumeRefreshResumeLike
  analysisContext?: ResumeRefreshAnalysisContext
  currentSkillsVersion?: number
  currentIngestComputeEpoch?: number
  currentPromptVersion?: number
}): ResumeRefreshState {
  const currentSkillsVersion = params.currentSkillsVersion ?? CURRENT_RESUME_SKILLS_VERSION
  const currentIngestComputeEpoch = params.currentIngestComputeEpoch ?? CURRENT_INGEST_COMPUTE_EPOCH
  const currentPromptVersion = params.currentPromptVersion ?? getCurrentResumeAiPromptVersion()

  const ingestStale = isIngestStale(
    params.resume.ingestData,
    currentSkillsVersion,
    currentIngestComputeEpoch,
  )

  const matchingAnalysis = hasMeaningfulAnalysisContext(params.analysisContext)
    ? resolveStoredResumeAnalysis({
        resume: params.resume,
        analysisContext: params.analysisContext,
      })
    : undefined

  const analysisPromptVersion = matchingAnalysis?.promptVersion
  const ingestComputedAt = params.resume.ingestData?.computedAt
  const analyzedAt = matchingAnalysis?.analyzedAt

  const analysisStale = Boolean(
    matchingAnalysis
    && (
      typeof analysisPromptVersion !== 'number'
      || analysisPromptVersion < currentPromptVersion
      || (
        typeof ingestComputedAt === 'number'
        && Number.isFinite(ingestComputedAt)
        && typeof analyzedAt === 'number'
        && Number.isFinite(analyzedAt)
        && analyzedAt < ingestComputedAt
      )
    )
  )

  const kind: ResumeRefreshKind = ingestStale && analysisStale
    ? 'both_stale'
    : ingestStale
      ? 'ingest_stale'
      : analysisStale
        ? 'analysis_stale'
        : 'fresh'

  const actions = buildResumeRefreshActions({
    ingestStale,
    analysisStale,
  })

  return {
    kind,
    isStale: actions.length > 0,
    ingestStale,
    analysisStale,
    actions,
  }
}

export function hasResumeRefreshIssue(
  refreshState: ResumeRefreshState | null | undefined,
): boolean {
  return refreshState?.isStale === true
}
