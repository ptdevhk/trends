/**
 * Profile-exported vars that made `make ci-local` non-deterministic on
 * runner hosts (2026-09-06 pvelxc: CONVEX_DEPLOYMENT=anonymous plus
 * AI_FALLBACK_MODEL / AUTH_HR_DEMO_TOKEN leaked into api tests).
 *
 * Keep the Makefile `ci-local` `env -u` list in sync with this array.
 * AI_MODEL is included because it is profile-exported on this host and is read
 * as the DEFAULT_<service>_MODEL in ai-summary-service.ts /
 * jd-keyword-extraction-service.ts, which makes those unit tests flaky under
 * full-suite runs (they assert a compiled-in "openai/gpt-4o-mini" default).
 */
export const CI_LOCAL_SCRUB_KEYS = [
  "CONVEX_DEPLOYMENT",
  "AI_FALLBACK_MODEL",
  "AI_MODEL",
  "AUTH_HR_DEMO_TOKEN",
] as const;

export type CiLocalEnv = Record<string, string | undefined>;

export function scrubCiLocalEnv(env: CiLocalEnv): CiLocalEnv {
  const next: CiLocalEnv = { ...env };
  for (const key of CI_LOCAL_SCRUB_KEYS) {
    delete next[key];
  }
  return next;
}
