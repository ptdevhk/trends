/**
 * Canonical collection guard configuration — shared across the browser
 * extension, snapshot backup pipeline, and any future collection entry points.
 *
 * Each source key maps to a list of field names that should be blanked
 * (set to "") during collection. This is a data-minimization measure:
 * fields like jobIntention and selfIntro may contain PII or sensitive
 * free-text that shouldn't be persisted in sample snapshots.
 */

export const COLLECTION_GUARDS: Record<string, string[]> = {
  job5156: ["experience", "jobIntention", "selfIntro"],
  "51job": ["experience", "jobIntention", "selfIntro"],
  seek: ["experience", "jobIntention", "selfIntro"],
};

export function applyCollectionGuards(
  resume: Record<string, unknown>,
  guardFields: string[],
): Record<string, unknown> {
  if (!guardFields.length) return resume;
  const guarded = { ...resume };
  for (const field of guardFields) {
    guarded[field] = "";
  }
  return guarded;
}
