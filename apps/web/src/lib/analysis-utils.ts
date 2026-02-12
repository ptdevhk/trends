function stableHash(seed: string): string {
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function normalizeKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length > 0)
    )
  )
}

export function buildKeywordAnalysisId(keywords: string[]): string {
  const normalizedKeywords = normalizeKeywords(keywords)
  if (normalizedKeywords.length === 0) {
    return 'keyword-search'
  }

  const stableKeywords = [...normalizedKeywords].sort()
  const seed = stableKeywords.join('|')
  return `keyword-search:${stableKeywords.length}:${stableHash(seed)}`
}

export function deriveAnalysisLookupKey(
  jobDescriptionId: string | undefined,
  keywords: string[]
): string {
  if (jobDescriptionId) return jobDescriptionId
  if (keywords.length > 0) return buildKeywordAnalysisId(keywords)
  return ''
}
