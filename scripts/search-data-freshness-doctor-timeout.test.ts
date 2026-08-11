import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The doctor's preferred path fetches `/api/resumes/search-freshness`, whose
 * full-corpus lag scan can take 300–400 s on a prod-restored Convex SQLite.
 * Without an explicit client-side timeout the fetch inherits Node's ~300 s
 * stack ceiling and throws "fetch failed" mid-scan. This test asserts the
 * shipped doctor script adds an `AbortSignal.timeout` above that ceiling so
 * the preferred scan path completes instead of falling back.
 */
const doctorSource = readFileSync(
  new URL("./search-data-freshness-doctor.ts", import.meta.url),
  "utf8",
);

describe("search-data-freshness-doctor search-freshness fetch timeout", () => {
  it("search-freshness fetch uses AbortSignal.timeout above the lag-scan ceiling (300s)", () => {
    // The fetch to /api/resumes/search-freshness must include AbortSignal.timeout.
    expect(doctorSource).toContain("AbortSignal.timeout");

    // Extract the timeout value passed to AbortSignal.timeout.
    const match = doctorSource.match(/AbortSignal\.timeout\(([\d_]+)\)/);
    expect(match).not.toBeNull();
    const timeoutMs = Number(match![1].replace(/_/g, ""));
    expect(timeoutMs).toBeGreaterThan(300_000);
  });
});