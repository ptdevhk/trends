import { DEFAULT_RESUME_AI_PROMPT_LOCALE, getResumeAiPromptDefinition } from "./generated/resume-ai-prompts.js";

const JOB5156_HOST_TOKEN = "job5156.com";
const MANUAL_51JOB_SOURCE_TOKEN = "51job-manual";
const SEEK_HOST_SUFFIX = ".employer.seek.com";

function stableHash(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

function normalizeKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => normalizeText(keyword))
        .filter((keyword): keyword is string => Boolean(keyword))
    )
  );
}

export type AnalysisRoleSignalLike = {
  type: string;
  verifyIn?: string;
  years?: number;
  roleRelevantYears?: number;
  industryVerifiedYears?: number;
  industryVerifiedRelevantYears?: number;
};

export type AnalysisKeywordKeyOptions = {
  location?: string;
  promptVersion?: number;
  sourceKey?: string;
};

export type AnalysisResultLike = {
  score: number;
  recommendation: string;
  breakdown?: {
    related_exp?: number;
    industry_db?: number;
    [key: string]: number | undefined;
  };
};

function getPromptVersionFallback(): number {
  return getResumeAiPromptDefinition(DEFAULT_RESUME_AI_PROMPT_LOCALE).metadata.version;
}

function normalizeLocation(value: string | undefined): string | undefined {
  return normalizeText(value);
}

function normalizeJobDescriptionId(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : "default";
}

export type ResumeAnalysisSourceKey = "job5156" | "seek";

export function normalizeResumeAnalysisSourceKey(
  value: string | null | undefined
): ResumeAnalysisSourceKey | undefined {
  const normalized = normalizeText(value ?? undefined);
  if (!normalized) {
    return undefined;
  }

  if (normalized === "seek" || normalized.endsWith(SEEK_HOST_SUFFIX)) {
    return "seek";
  }

  if (
    normalized === "job5156"
    || normalized === MANUAL_51JOB_SOURCE_TOKEN
    || normalized.includes(JOB5156_HOST_TOKEN)
  ) {
    return "job5156";
  }

  return undefined;
}

export function resolveResumeAnalysisSourceKey(scope?: {
  sourceKey?: string | null;
  source?: string | null;
}): ResumeAnalysisSourceKey | undefined {
  return normalizeResumeAnalysisSourceKey(scope?.sourceKey)
    ?? normalizeResumeAnalysisSourceKey(scope?.source);
}

export function buildResumeAnalysisStorageKey(
  jobDescriptionId: string | undefined,
  options?: {
    sourceKey?: string;
  }
): string {
  const normalizedJobDescriptionId = normalizeJobDescriptionId(jobDescriptionId);
  const sourceKey = resolveResumeAnalysisSourceKey({ sourceKey: options?.sourceKey });
  if (!sourceKey) {
    return normalizedJobDescriptionId;
  }

  return `source:${sourceKey}|analysis:${normalizedJobDescriptionId}`;
}

export function buildResumeAnalysisLookupKeys(
  jobDescriptionId: string | undefined,
  keywords: string[],
  options?: AnalysisKeywordKeyOptions
): string[] {
  if (jobDescriptionId) {
    const legacyKey = normalizeJobDescriptionId(jobDescriptionId);
    const sourceAwareKey = buildResumeAnalysisStorageKey(jobDescriptionId, { sourceKey: options?.sourceKey });
    return sourceAwareKey === legacyKey ? [legacyKey] : [sourceAwareKey, legacyKey];
  }

  if (keywords.length > 0) {
    const legacyKey = buildKeywordAnalysisId(keywords, options);
    const sourceAwareKey = buildResumeAnalysisStorageKey(legacyKey, { sourceKey: options?.sourceKey });
    return sourceAwareKey === legacyKey ? [legacyKey] : [sourceAwareKey, legacyKey];
  }

  return [];
}

export function isResumeAnalysisKeyForJobDescription(
  key: string,
  jobDescriptionId: string | undefined
): boolean {
  const normalizedJobDescriptionId = normalizeJobDescriptionId(jobDescriptionId);
  return key === normalizedJobDescriptionId || key.endsWith(`|analysis:${normalizedJobDescriptionId}`);
}

export function getCurrentResumeAiPromptVersion(): number {
  return getPromptVersionFallback();
}

export function buildKeywordAnalysisId(
  keywords: string[],
  options?: AnalysisKeywordKeyOptions
): string {
  const normalizedKeywords = normalizeKeywords(keywords);
  if (normalizedKeywords.length === 0) {
    return "keyword-search";
  }

  const seedParts = [...normalizedKeywords].sort();
  const normalizedLocation = normalizeLocation(options?.location);
  if (normalizedLocation) {
    seedParts.push(`location:${normalizedLocation}`);
  }

  const promptVersion = options?.promptVersion ?? getPromptVersionFallback();
  seedParts.push(`prompt:${promptVersion}`);

  return `keyword-search:${normalizedKeywords.length}:${stableHash(seedParts.join("|"))}`;
}

export function deriveAnalysisLookupKey(
  jobDescriptionId: string | undefined,
  keywords: string[],
  options?: AnalysisKeywordKeyOptions
): string {
  return buildResumeAnalysisLookupKeys(jobDescriptionId, keywords, options)[0] ?? "";
}

export function getRoleSignalYears(
  roleSignals: AnalysisRoleSignalLike[] | undefined,
  roleType: string,
  verifyIn?: string
): number {
  if (!roleSignals || roleSignals.length === 0) {
    return 0;
  }

  const normalizedType = roleType.trim().toLowerCase();
  const normalizedVerifyIn = verifyIn?.trim().toLowerCase();

  const matched = roleSignals.find((signal) => {
    if (signal.type.trim().toLowerCase() !== normalizedType) {
      return false;
    }
    if (!normalizedVerifyIn) {
      return true;
    }
    return signal.verifyIn?.trim().toLowerCase() === normalizedVerifyIn;
  });

  if (!matched) {
    return 0;
  }

  const years =
    matched.industryVerifiedRelevantYears
    ?? matched.roleRelevantYears
    ?? matched.industryVerifiedYears
    ?? matched.years
    ?? 0;

  return Number.isFinite(years) ? years : 0;
}

export function getSalesRoleYears(roleSignals: AnalysisRoleSignalLike[] | undefined): number {
  return getRoleSignalYears(roleSignals, "sales", "workHistory");
}

export function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
  const haystack = texts
    .map((text) => normalizeText(text))
    .filter((text): text is string => Boolean(text))
    .join(" ");

  if (!haystack) {
    return false;
  }

  return /(?:^|\b)(?:sales|sale|business development|bd)(?:\b|$)|销售|销售工程师|销售经理|业务拓展|客户开发/.test(haystack);
}

export function normalizeKeywordSalesAnalysis<T extends AnalysisResultLike>(
  analysis: T,
  options: {
    salesRequired: boolean;
    roleSignals?: AnalysisRoleSignalLike[];
    maxRelatedExp?: number;
    maxScore?: number;
    rewriteBreakdown?: boolean;
  }
): T {
  if (!options.salesRequired) {
    return analysis;
  }

  const salesRoleYears = getSalesRoleYears(options.roleSignals);
  if (salesRoleYears > 0) {
    return analysis;
  }

  const maxRelatedExp = options.maxRelatedExp ?? 20;
  const maxScore = options.maxScore ?? 49;
  const rewriteBreakdown = options.rewriteBreakdown !== false;
  const originalBreakdown = analysis.breakdown ?? {};
  const relatedExp = typeof originalBreakdown.related_exp === "number"
    ? Math.min(originalBreakdown.related_exp, maxRelatedExp)
    : 0;
  const score = Math.min(Number.isFinite(analysis.score) ? analysis.score : 0, maxScore);
  const recommendation = score <= 0 ? "no_match" : "potential";

  if (!rewriteBreakdown) {
    return {
      ...analysis,
      score,
      recommendation,
    };
  }

  return {
    ...analysis,
    score,
    recommendation,
    breakdown: {
      ...originalBreakdown,
      related_exp: relatedExp,
      industry_db: typeof originalBreakdown.industry_db === "number"
        ? originalBreakdown.industry_db
        : 0,
    },
  };
}
