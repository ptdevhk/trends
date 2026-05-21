/**
 * Shared resume filter helpers.
 *
 * Used by both BFF (apps/api) and web (apps/web) for consistent
 * education/experience normalization across filter paths.
 *
 * Convex cannot import from @trends/shared and maintains its own copy
 * in convex/resumes.ts — keep them in sync via the sync test in
 * convex/__tests__/schema-validator-sync.test.ts.
 */

/**
 * Normalize education level strings to standard English tokens.
 *
 * Supports both Chinese (博士, 硕士, 本科, etc.) and English
 * (PhD, Master, Bachelor, Diploma, SPM, STPM) terms.
 * Returns null if the value cannot be recognized.
 */
export function normalizeEducationLevel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  // Chinese education terms
  if (/博士/.test(normalized)) return "phd";
  if (/硕士|研究生/.test(normalized)) return "master";
  if (/本科/.test(normalized)) return "bachelor";
  if (/大专|专科/.test(normalized)) return "associate";
  if (/中专|高中|中技/.test(normalized)) return "high_school";
  // English education terms (Seek MY market)
  if (/\bph\.?d\.?\b/.test(normalized) || /\bdoctorate\b/.test(normalized)) return "phd";
  if (/\bmaster/.test(normalized) || /\bm\.?s\.?\b/.test(normalized) || /\bm\.?a\.?\b/.test(normalized) || /\bmba\b/.test(normalized)) return "master";
  if (/\bdiploma\b/.test(normalized) || /\bassociate\b/.test(normalized)) return "associate";
  if (/\bbachelor/.test(normalized) || /\bdegree\b/.test(normalized) || /\bb\.?s\.?\b/.test(normalized) || /\bb\.?a\.?\b/.test(normalized)) return "bachelor";
  if (/\bhigh school\b/.test(normalized) || /\bspm\b/.test(normalized) || /\bstpm\b/.test(normalized)) return "high_school";
  return null;
}

/**
 * Parse experience years from a string value.
 *
 * Supports:
 * - Chinese terms: "应届" / "无经验" → 0
 * - Range formats: "3-5" → 5, "2~3" → 3, "1到3" → 3
 * - Single values: "5" → 5
 *
 * Returns null if the value cannot be parsed.
 * For ranges, returns the max value (conservative estimate).
 */
export function parseExperienceYears(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/应届|无经验|fresh grad|entry level|no experience|fresh graduate|beginner/i.test(normalized)) return 0;
  const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return Number.isNaN(max) ? null : max;
}
