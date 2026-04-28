import { DEFAULT_RESUME_AI_PROMPT_LOCALE, getResumeAiPromptDefinition } from "./generated/resume-ai-prompts.js";

const JOB5156_HOST_TOKEN = "job5156.com";
const MANUAL_51JOB_SOURCE_TOKEN = "51job-manual";
const JOB51_HOST_TOKEN = "ehire.51job.com";
const JOB51_SOURCE_KEY = "51job";
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
  matchedWorkEntries?: AnalysisMatchedWorkEntryLike[];
};

export type AnalysisMatchedWorkEntryLike = {
  years?: number;
  directRoleMatch?: boolean;
  industryVerified?: boolean;
};

export type AnalysisKeywordKeyOptions = {
  location?: string;
  promptVersion?: number;
  sourceKey?: string;
  locale?: string;
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

export type ResumeAnalysisSourceKey = "job5156" | "51job" | "seek";
export type ResumeDiagnosticsSourceKey =
  | ResumeAnalysisSourceKey
  | "51job-manual"
  | "unknown";

export const KNOWN_DIAGNOSTICS_SOURCE_KEYS: readonly Exclude<ResumeDiagnosticsSourceKey, "unknown">[] = [
  "job5156",
  "51job",
  "51job-manual",
  "seek",
];

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

  // Live 51job (ehire.51job.com, profileType "51job") gets its own lane.
  // 51job-manual stays in the job5156 lane for backward compatibility.
  if (
    normalized === JOB51_SOURCE_KEY
    || normalized === JOB51_HOST_TOKEN
    || normalized.endsWith(JOB51_HOST_TOKEN)
  ) {
    return "51job";
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

function normalizeResumeDiagnosticsSourceKey(
  value: string | null | undefined
): ResumeDiagnosticsSourceKey | undefined {
  const normalized = normalizeText(value ?? undefined);
  if (!normalized) {
    return undefined;
  }

  if (normalized === MANUAL_51JOB_SOURCE_TOKEN) {
    return MANUAL_51JOB_SOURCE_TOKEN;
  }

  if (normalized === "seek" || normalized.endsWith(SEEK_HOST_SUFFIX)) {
    return "seek";
  }

  if (
    normalized === JOB51_SOURCE_KEY
    || normalized === JOB51_HOST_TOKEN
    || normalized.endsWith(JOB51_HOST_TOKEN)
  ) {
    return "51job";
  }

  if (
    normalized === "job5156"
    || normalized.includes(JOB5156_HOST_TOKEN)
  ) {
    return "job5156";
  }

  return undefined;
}

export function resolveResumeDiagnosticsSourceKey(scope?: {
  sourceKey?: string | null;
  source?: string | null;
}): ResumeDiagnosticsSourceKey {
  return normalizeResumeDiagnosticsSourceKey(scope?.sourceKey)
    ?? normalizeResumeDiagnosticsSourceKey(scope?.source)
    ?? "unknown";
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
    locale?: string;
  }
): string {
  const normalizedJobDescriptionId = normalizeJobDescriptionId(jobDescriptionId);
  const sourceKey = resolveResumeAnalysisSourceKey({ sourceKey: options?.sourceKey });
  const normalizedLocale = normalizeText(options?.locale);
  if (!sourceKey && !normalizedLocale) {
    return normalizedJobDescriptionId;
  }

  const parts: string[] = [];
  if (sourceKey) {
    parts.push(`source:${sourceKey}`);
  }
  if (normalizedLocale) {
    parts.push(`locale:${normalizedLocale}`);
  }
  parts.push(`analysis:${normalizedJobDescriptionId}`);
  return parts.join("|");
}

export function buildResumeAnalysisLookupKeys(
  jobDescriptionId: string | undefined,
  keywords: string[],
  options?: AnalysisKeywordKeyOptions
): string[] {
  if (jobDescriptionId) {
    const legacyKey = normalizeJobDescriptionId(jobDescriptionId);
    const sourceAwareKey = buildResumeAnalysisStorageKey(jobDescriptionId, { sourceKey: options?.sourceKey, locale: options?.locale });
    return sourceAwareKey === legacyKey ? [legacyKey] : [sourceAwareKey, legacyKey];
  }

  if (keywords.length > 0) {
    const legacyKey = buildKeywordAnalysisId(keywords, options);
    const sourceAwareKey = buildResumeAnalysisStorageKey(legacyKey, { sourceKey: options?.sourceKey, locale: options?.locale });
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

/**
 * Strict variant of {@link getRoleSignalYears} that counts only
 * industry-verified role years. Used by the `minRoleYears` filter so that
 * unverified signal years cannot pass the gate.
 *
 * Precedence per signal:
 *  1. If `matchedWorkEntries` carry `directRoleMatch` + `industryVerified`
 *     flags, sum years of entries where both are `true`.
 *  2. Otherwise fall back to `industryVerifiedRelevantYears` or
 *     `industryVerifiedYears` only — never to unverified `roleRelevantYears`
 *     or `years`.
 */
export function getVerifiedRoleSignalYears(
  roleSignals: AnalysisRoleSignalLike[] | undefined,
  roleType: string,
  verifyIn?: string
): number {
  if (!roleSignals || roleSignals.length === 0) {
    return 0;
  }

  const normalizedType = roleType.trim().toLowerCase();
  const normalizedVerifyIn = verifyIn?.trim().toLowerCase();

  const resolveVerifiedYears = (signal: AnalysisRoleSignalLike): number => {
    if (Array.isArray(signal.matchedWorkEntries) && signal.matchedWorkEntries.length > 0) {
      const flaggedEntries = signal.matchedWorkEntries.filter(
        (entry) => typeof entry.directRoleMatch === "boolean"
      );
      if (flaggedEntries.length > 0) {
        const verifiedYears = flaggedEntries.reduce((total, entry) => {
          if (entry.directRoleMatch !== true) {
            return total;
          }
          if (entry.industryVerified !== true) {
            return total;
          }
          const years = entry.years;
          if (typeof years !== "number" || !Number.isFinite(years)) {
            return total;
          }
          return total + years;
        }, 0);
        return Number.isFinite(verifiedYears) ? verifiedYears : 0;
      }
    }

    const years = signal.industryVerifiedRelevantYears || signal.industryVerifiedYears || 0;
    return Number.isFinite(years) ? years : 0;
  };

  if (!normalizedType) {
    return roleSignals.reduce((maxYears, signal) => {
      return Math.max(maxYears, resolveVerifiedYears(signal));
    }, 0);
  }

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

  return resolveVerifiedYears(matched);
}

/**
 * Precomputed projection of verified role years, keyed by normalized role
 * type (lower-cased, trimmed). Used to populate `ingestData.verifiedRoleYears`
 * at ingest time so the `minRoleYears` filter can gate on a single field
 * without re-walking `roleSignals`.
 *
 * Uses the same `getVerifiedRoleSignalYears` semantics: only
 * `industryVerified=true` entries or the `industryVerifiedRelevantYears` /
 * `industryVerifiedYears` aggregate fields contribute. Never falls back to
 * raw `years` or unverified `roleRelevantYears`.
 *
 * Plan: docs/superpowers/plans/2026-04-24-direct-role-years-precomputed-field-plan.md
 */
export function computeVerifiedRoleYears(
  roleSignals: AnalysisRoleSignalLike[] | undefined
): Record<string, number> {
  if (!Array.isArray(roleSignals) || roleSignals.length === 0) {
    return {};
  }

  const out: Record<string, number> = {};
  for (const signal of roleSignals) {
    const key = signal.type?.trim().toLowerCase();
    if (!key) {
      continue;
    }
    const years = getVerifiedRoleSignalYears([signal], key);
    if (years > 0) {
      out[key] = years;
    }
  }
  return out;
}

/**
 * Ranking / display helper — returns the "best available" years estimate
 * for a role signal. May include unverified `roleRelevantYears`.
 *
 * WARNING: Do NOT use this for the `minRoleYears` filter or any hard gate.
 * Filter callers MUST use `getVerifiedRoleSignalYears` or read
 * `ingestData.verifiedRoleYears` directly. See plan:
 * docs/superpowers/plans/2026-04-24-direct-role-years-precomputed-field-plan.md
 */
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

  const resolveSignalYears = (signal: AnalysisRoleSignalLike, signalType: string): number => {
    if (signalType === "sales" && Array.isArray(signal.matchedWorkEntries) && signal.matchedWorkEntries.length > 0) {
      const flaggedEntries = signal.matchedWorkEntries.filter(
        (entry) => typeof entry.directRoleMatch === "boolean"
      );
      if (flaggedEntries.length > 0) {
        const directYears = flaggedEntries.reduce((total, entry) => {
          if (entry.directRoleMatch !== true) {
            return total;
          }
          const years = entry.years;
          if (typeof years !== "number" || !Number.isFinite(years)) {
            return total;
          }
          return total + years;
        }, 0);
        return Number.isFinite(directYears) ? directYears : 0;
      }
    }

    const years =
      signal.industryVerifiedRelevantYears
      ?? signal.roleRelevantYears
      ?? signal.industryVerifiedYears
      ?? 0;

    return Number.isFinite(years) ? years : 0;
  };

  if (!normalizedType) {
    return roleSignals.reduce((maxYears, signal) => {
      const signalType = signal.type.trim().toLowerCase();
      const years = resolveSignalYears(signal, signalType);
      return Math.max(maxYears, years);
    }, 0);
  }

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

  return resolveSignalYears(matched, normalizedType);
}

export function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
  const haystack = texts
    .map((text) => normalizeText(text))
    .filter((text): text is string => Boolean(text))
    .join(" ");

  if (!haystack) {
    return false;
  }

  return /(?:^|\b)(?:sales?|business development|bd|account manager|key account manager|channel sales|channel manager|territory sales manager|regional sales manager)(?:\b|$)|销售工程师|销售经理|业务拓展|业务开发|客户开发|大客户|渠道销售|渠道经理|销售|渠道/.test(haystack);
}
