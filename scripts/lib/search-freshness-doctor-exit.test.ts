import { describe, expect, it } from "vitest";

import { resolveSearchFreshnessDoctorFallbackExit } from "./search-freshness-doctor-exit.ts";

describe("resolveSearchFreshnessDoctorFallbackExit", () => {
  it("exits 1 when authenticated but both lag paths fail (no stale number)", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        searchFreshnessError: "fetch failed",
        dryRunError: "fetch failed",
      }),
    ).toBe(1);
  });

  it("exits 2 when dry-run reports compute-stale rows", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        dryRunReingest: { computeStaleCount: 12 },
      }),
    ).toBe(2);
  });

  it("exits 0 when dry-run measured a zero-stale window", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        dryRunReingest: { computeStaleCount: 0 },
      }),
    ).toBe(0);
  });

  it("keeps login-unreachable / unauthenticated offline as exit 0", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: false,
      }),
    ).toBe(0);
  });
});
