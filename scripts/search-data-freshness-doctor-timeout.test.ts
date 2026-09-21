import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS,
  SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS,
  UNDICI_DEFAULT_FETCH_TIMEOUT_MS,
} from "./lib/search-freshness-doctor-fetch.ts";

/**
 * The doctor's preferred path hits `/api/resumes/search-freshness`, whose
 * full-corpus lag scan can take 300–400 s on a prod-restored Convex SQLite.
 * AbortSignal.timeout(600_000) is not the ceiling that failed on preview:
 * undici's default headersTimeout/bodyTimeout (300 s) throws "fetch failed"
 * first. This test requires the shipped script to call the undici-timeout
 * helper, not merely grep for AbortSignal.
 */
const doctorSource = readFileSync(
  new URL("./search-data-freshness-doctor.ts", import.meta.url),
  "utf8",
);

describe("search-data-freshness-doctor search-freshness fetch timeout", () => {
  it("preferred and fallback lag scans use the undici headers/body timeout helper", () => {
    expect(doctorSource).toContain("fetchWithSearchFreshnessDoctorTimeout");
    expect(doctorSource).toContain("SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS");
    expect(doctorSource).toContain("SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS");
    expect(SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS).toBeGreaterThan(
      UNDICI_DEFAULT_FETCH_TIMEOUT_MS,
    );
    expect(SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS).toBeGreaterThan(
      UNDICI_DEFAULT_FETCH_TIMEOUT_MS,
    );

    expect(doctorSource).toMatch(
      /fetchWithSearchFreshnessDoctorTimeout\(\s*`\$\{base\}\/api\/resumes\/search-freshness/,
    );
    expect(doctorSource).toMatch(
      /fetchWithSearchFreshnessDoctorTimeout\(\s*`\$\{base\}\/api\/resumes\/trigger-reingest/,
    );
  });

  it("still pairs AbortSignal.timeout with the undici timeouts (not AbortSignal alone)", () => {
    const helperSource = readFileSync(
      new URL("./lib/search-freshness-doctor-fetch.ts", import.meta.url),
      "utf8",
    );
    expect(helperSource).toContain("AbortSignal.timeout");
    expect(helperSource).toContain("headersTimeout");
    expect(helperSource).toContain("bodyTimeout");
    expect(helperSource).not.toMatch(/headersTimeout\s*:\s*UNDICI_DEFAULT_FETCH_TIMEOUT_MS/);
  });

  it("preferred HTTP 200 path uses resolveSearchFreshnessPreferredExit (missing hint is not 0)", () => {
    expect(doctorSource).toContain("resolveSearchFreshnessPreferredExit");
    expect(doctorSource).not.toMatch(
      /return typeof body\.exitCodeHint === "number" \? body\.exitCodeHint : 0/,
    );
  });
});
