/**
 * Tests for company-industry-evidence-service.ts — proves the API's
 * `listIndustryEvidenceSources` path sends the correct `writeSecret` to
 * Convex so the reviewer page load does not throw `Unauthorized Convex read`
 * (acceptance criterion 4: CONVEX_WRITE_SECRET env wiring reaches
 * `config.auth.convexWriteSecret` and is passed through on the real path).
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  listIndustryEvidenceSources,
} from "./company-industry-evidence-service.js";

// The service reads config lazily through its own module; make the secret
// value observable by spying on the underlying fetch (callConvexQuery uses
// globalThis.fetch to POST { path, args } to the Convex HTTP endpoint).
afterEach(() => {
  vi.restoreAllMocks();
});

describe("listIndustryEvidenceSources secret path", () => {
  beforeEach(() => {
    vi.stubEnv("CONVEX_WRITE_SECRET", "test-secret-123");
    vi.stubEnv("CONVEX_URL", "http://127.0.0.1:3210");
  });

  it("passes the configured CONVEX_WRITE_SECRET through to the Convex query", async () => {
    const capturedArgs: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
        path?: string;
        args?: unknown;
      };
      capturedArgs.push(body.args);
      return new Response(
        JSON.stringify({
          status: "success",
          value: [
            {
              _id: "s1",
              sourceId: "source-1",
              proposalId: "proposal-1",
              companyKey: "acme-cnc",
              url: "https://example.com/catalog",
              sourceType: "official_site",
              trustTier: "primary",
              title: "Catalog",
              evidenceExcerpt: "excerpt",
              fetchStatus: "fetched",
              reviewStatus: "unreviewed",
              sourceState: "active",
              suggestedIndustryClass: "cnc",
              workerConfidence: 0.98,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const sources = await listIndustryEvidenceSources();

    expect(sources).toHaveLength(1);
    expect(sources[0].sourceId).toBe("source-1");
    expect(capturedArgs[0]).toMatchObject({
      writeSecret: "test-secret-123",
    });
    // The writeSecret must be the exact env value the Convex backend
    // validates against (requireReadSecret compares equality).
    expect(
      (capturedArgs[0] as { writeSecret: string }).writeSecret,
    ).toBe("test-secret-123");
  });

  it("propagates a Convex Unauthorized read failure instead of masking it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          status: "error",
          errorMessage: "Unauthorized Convex read",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(listIndustryEvidenceSources()).rejects.toThrow(
      /Unauthorized Convex read|Convex query failed/i,
    );
  });
});
