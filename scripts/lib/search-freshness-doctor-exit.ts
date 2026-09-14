export type SearchFreshnessDoctorReport = {
  authenticated?: unknown;
  searchFreshnessError?: unknown;
  searchFreshnessHttp?: unknown;
  dryRunError?: unknown;
  dryRunReingestHttp?: unknown;
  dryRunReingest?: { computeStaleCount?: number };
  goldenQueries?: Array<{ ok?: boolean | null }>;
};

/**
 * Fallback exit after the preferred `/api/resumes/search-freshness` path
 * did not return an `exitCodeHint`.
 *
 * Authenticated runs that produce no stale-window number are unverifiable
 * (exit 1), not green. Login-unreachable / unauthenticated offline notes
 * stay exit 0 so deploy hooks can still run unit-only.
 */
export function resolveSearchFreshnessDoctorFallbackExit(
  report: SearchFreshnessDoctorReport,
): number {
  const dry = report.dryRunReingest;
  if (typeof dry?.computeStaleCount === "number" && dry.computeStaleCount >= 1) {
    return 2;
  }
  if (report.goldenQueries?.some((g) => g.ok === false)) {
    return 3;
  }
  const measured = typeof dry?.computeStaleCount === "number";
  if (report.authenticated === true && !measured) {
    const unverifiable = Boolean(
      report.searchFreshnessError ||
        report.dryRunError ||
        report.searchFreshnessHttp ||
        report.dryRunReingestHttp,
    );
    if (unverifiable) {
      return 1;
    }
  }
  return 0;
}
