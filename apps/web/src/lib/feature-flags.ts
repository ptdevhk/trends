/**
 * Feature flag helpers for experimental features.
 *
 * All flags default to **off** (false) unless the corresponding
 * VITE_ env variable is explicitly set to `"true"`.
 * This ensures production deployments that omit the variable
 * never expose the experimental feature.
 */

export function isReviewPacketsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_REVIEW_PACKETS === 'true'
}

export function isResumeAiSummaryEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_RESUME_AI_SUMMARY === 'true'
}

export function isHeadlessCollectorEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_HEADLESS_COLLECTOR === 'true'
}
