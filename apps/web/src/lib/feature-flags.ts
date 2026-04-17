/**
 * Feature flag helpers for experimental features.
 *
 * All flags default to **off** (false) unless the corresponding
 * VITE_ env variable is explicitly set to `"true"`.
 * This ensures production deployments that omit the variable
 * never expose the experimental feature.
 */

/** Returns true when the review-packets feature is enabled via env. */
export function isReviewPacketsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_REVIEW_PACKETS === 'true'
}
