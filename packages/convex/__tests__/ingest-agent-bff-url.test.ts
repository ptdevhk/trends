import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultBffApiUrlForRole,
  previewPublicBffOrigin,
  resolveBffApiUrl,
} from "@trends/shared";
import { reIngestStaleResumes } from "../convex/ingest_agent";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const reIngestStaleResumesHandler = (reIngestStaleResumes as unknown as ConvexHandler<
  { limit?: number; mode?: string; dryRun?: boolean },
  {
    scheduled: number
    batches: number
    currentVersion: number
    hasMore: boolean
    skillsStaleCount?: number
    computeStaleCount?: number
  }
>)._handler

const __dirname = dirname(fileURLToPath(import.meta.url));
const ingestAgentSource = readFileSync(
  join(__dirname, "../convex/ingest_agent.ts"),
  "utf8",
);

describe("ingest_agent BFF URL wiring (structural + live resolver)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BFF_API_URL;
    delete process.env.TRENDS_BFF_API_URL;
    delete process.env.TRENDS_DEPLOYMENT_ROLE;
    delete process.env.PREVIEW_PUBLIC_HOST;
  });

  it("imports and uses shared resolveBffApiUrl (not a hard-coded localhost-only getter)", () => {
    expect(ingestAgentSource).toMatch(/resolveBffApiUrl/);
    expect(ingestAgentSource).toMatch(/from "@trends\/shared"/);
    // Must not reintroduce the old only-path default without resolver.
    expect(ingestAgentSource).not.toMatch(
      /return process\.env\.BFF_API_URL \|\| "http:\/\/localhost:/,
    );
  });

  it("reIngestStaleResumes fetches skills-version from resolved BFF base URL", async () => {
    const base = previewPublicBffOrigin();
    process.env.BFF_API_URL = base;
    process.env.TRENDS_DEPLOYMENT_ROLE = "preview";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: 9, ingestComputeEpoch: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const ctx = {
      async runQuery() {
        return {
          continueCursor: "",
          isDone: true,
          page: [],
        };
      },
      scheduler: {
        async runAfter() {},
      },
    };

    await reIngestStaleResumesHandler(ctx as never, { dryRun: true, limit: 10 });

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toBe(`${base}/api/resumes/skills-version`);
    // Sanity: same base as shared resolver under the same env
    expect(resolveBffApiUrl(process.env)).toBe(base);
  });

  it("preview role default (no explicit URL) is public host, not container localhost", () => {
    const resolved = resolveBffApiUrl({ TRENDS_DEPLOYMENT_ROLE: "preview" });
    expect(resolved).toBe(defaultBffApiUrlForRole("preview"));
    expect(resolved).toBe(previewPublicBffOrigin());
    expect(resolved.startsWith("https://")).toBe(true);
    expect(resolved).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
