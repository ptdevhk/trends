export {
  buildKeywordAnalysisId,
  buildResumeAnalysisLookupKeys,
  buildResumeAnalysisStorageKey,
  deriveAnalysisLookupKey,
  getCurrentResumeAiPromptVersion,
  isResumeAnalysisKeyForJobDescription,
  resolveResumeAnalysisSourceKey,
} from '@trends/shared'

const DEFAULT_ANALYSIS_TOP_N = 10
const MAX_ANALYSIS_TOP_N = 500

export function resolveAnalysisTopN(envValue: unknown): number {
  const parsed =
    typeof envValue === 'number'
      ? envValue
      : typeof envValue === 'string'
        ? Number(envValue.trim())
        : Number.NaN

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_ANALYSIS_TOP_N
  }

  return Math.min(Math.floor(parsed), MAX_ANALYSIS_TOP_N)
}
