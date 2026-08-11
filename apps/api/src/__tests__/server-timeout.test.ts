import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The BFF API serves the lag-scan endpoint (`/api/resumes/search-freshness`)
 * whose full-corpus dry-run can take 300–400 s on a prod-restored ~9 k-row
 * Convex SQLite. Node's default http.Server `requestTimeout` is 300 s, which
 * kills the connection mid-scan and forces the doctor's fallback path. This
 * test asserts the shipped server entry point raises that ceiling via
 * `serverOptions.requestTimeout` so the preferred scan path completes.
 */
const serverSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

describe("BFF server requestTimeout", () => {
  it("serve() passes serverOptions with requestTimeout above the lag-scan ceiling (300s)", () => {
    // Must include serverOptions with a requestTimeout value > 300_000 ms.
    expect(serverSource).toContain("serverOptions");
    expect(serverSource).toContain("requestTimeout");

    const match = serverSource.match(/requestTimeout\s*:\s*([\d_]+)/);
    expect(match).not.toBeNull();
    const timeoutMs = Number(match![1].replace(/_/g, ""));
    expect(timeoutMs).toBeGreaterThan(300_000);
  });
});