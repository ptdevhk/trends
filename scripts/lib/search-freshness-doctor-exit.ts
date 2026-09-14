export type SearchFreshnessDoctorReport = {
  authenticated?: unknown;
  searchFreshnessError?: unknown;
  searchFreshnessHttp?: unknown;
  dryRunError?: unknown;
  dryRunReingestHttp?: unknown;
  dryRunReingest?: { computeStaleCount?: number };
  goldenQueries?: Array<{ ok?: boolean | null }>;
};

/** Doctor process exits: 0 ok, 1 unverifiable, 2 compute lag, 3 golden fail. */
const ALLOWED_DOCTOR_EXITS = new Set([0, 1, 2, 3]);

function isAllowedDoctorExit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && ALLOWED_DOCTOR_EXITS.has(value);
}

function isMeasuredNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Preferred `/api/resumes/search-freshness` HTTP 200 body.
 * A missing or non-integer `exitCodeHint` is unverifiable (exit 1), not green.
 * Node `process.exit(0.5)` / `process.exit(NaN)` coerce to 0.
 */
export function resolveSearchFreshnessPreferredExit(body: {
  exitCodeHint?: unknown;
}): number {
  return isAllowedDoctorExit(body.exitCodeHint) ? body.exitCodeHint : 1;
}

/**
 * Fallback exit after the preferred `/api/resumes/search-freshness` path
 * did not return an `exitCodeHint`.
 *
 * Authenticated runs that produce no stale-window number are unverifiable
 * (exit 1), not green — even when error flags are absent. Login-unreachable /
 * unauthenticated offline notes stay exit 0 so deploy hooks can still run
 * unit-only.
 */
export function resolveSearchFreshnessDoctorFallbackExit(
  report: SearchFreshnessDoctorReport,
): number {
  const stale = report.dryRunReingest?.computeStaleCount;
  if (isMeasuredNonNegativeInt(stale) && stale >= 1) {
    return 2;
  }
  if (report.goldenQueries?.some((g) => g.ok === false)) {
    return 3;
  }
  if (report.authenticated === true && !isMeasuredNonNegativeInt(stale)) {
    return 1;
  }
  return 0;
}
