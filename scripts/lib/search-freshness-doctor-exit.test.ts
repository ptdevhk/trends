import { describe, expect, it } from "vitest";

import {
  resolveSearchFreshnessDoctorFallbackExit,
  resolveSearchFreshnessPreferredExit,
} from "./search-freshness-doctor-exit.ts";

describe("resolveSearchFreshnessPreferredExit", () => {
  it("uses a numeric exitCodeHint", () => {
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: 2 })).toBe(2);
  });

  it("exits 1 when HTTP 200 omits exitCodeHint (not green)", () => {
    expect(resolveSearchFreshnessPreferredExit({})).toBe(1);
  });

  it("exits 1 for NaN / Infinity / fractional hints (Node would coerce those to 0)", () => {
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: Number.NaN })).toBe(1);
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: Number.POSITIVE_INFINITY })).toBe(1);
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: 0.5 })).toBe(1);
  });

  it("exits 1 for string or out-of-contract hints", () => {
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: "0" })).toBe(1);
    expect(resolveSearchFreshnessPreferredExit({ exitCodeHint: 4 })).toBe(1);
  });
});

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

  it("exits 1 when authenticated with no measurement and no error flags", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
      }),
    ).toBe(1);
  });

  it("exits 1 when authenticated and only HTTP statuses mark the scan", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        searchFreshnessHttp: 500,
        dryRunReingestHttp: 504,
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

  it("exits 3 when a golden query is explicitly not ok", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        dryRunReingest: { computeStaleCount: 0 },
        goldenQueries: [{ ok: false }],
      }),
    ).toBe(3);
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

  it("exits 1 when authenticated and computeStaleCount is NaN (not a measured window)", () => {
    expect(
      resolveSearchFreshnessDoctorFallbackExit({
        authenticated: true,
        dryRunReingest: { computeStaleCount: Number.NaN },
      }),
    ).toBe(1);
  });
});
