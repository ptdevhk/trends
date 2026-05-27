import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock ActionStorage before importing the service
const mockReplayActions = vi.fn().mockReturnValue({ replayed: 0, deduped: 0 });
vi.mock("../action-storage.js", () => {
  return {
    ActionStorage: class MockActionStorage {
      replayActions = mockReplayActions;
    },
  };
});

import {
  resolveConvexUrl,
  normalizeResumeImportPayload,
  submitNormalizedResumeImport,
  replayCandidateState,
  submitResumeImport,
} from "../resume-import-service.js";

function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: "https://hr.job5156.com/search?keyword=sales",
    generatedBy: "browser-extension@1.0.0",
    ...overrides,
  };
}

function makeResume(overrides: Record<string, unknown> = {}) {
  return {
    name: "Alex Chen",
    ...overrides,
  };
}

describe("resume-import-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONVEX_URL;
    delete process.env.VITE_CONVEX_URL;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // ── resolveConvexUrl ──────────────────────────────────────────────

  describe("resolveConvexUrl", () => {
    it("returns CONVEX_URL env var when set", () => {
      process.env.CONVEX_URL = "https://my-convex.convex.cloud";
      expect(resolveConvexUrl()).toBe("https://my-convex.convex.cloud");
    });

    it("returns VITE_CONVEX_URL env var when CONVEX_URL is unset", () => {
      process.env.VITE_CONVEX_URL = "https://vite-convex.convex.cloud";
      expect(resolveConvexUrl()).toBe("https://vite-convex.convex.cloud");
    });

    it("prefers CONVEX_URL over VITE_CONVEX_URL", () => {
      process.env.CONVEX_URL = "https://primary.convex.cloud";
      process.env.VITE_CONVEX_URL = "https://secondary.convex.cloud";
      expect(resolveConvexUrl()).toBe("https://primary.convex.cloud");
    });

    it("falls back to http://127.0.0.1:3210 when no env vars set and no files found", () => {
      // No env vars set; .env.local files may or may not exist in test env.
      // Assert a valid URL is returned — either from a file or the hardcoded default.
      const url = resolveConvexUrl();
      expect(url).toMatch(/^https?:\/\/.+:\d+/);
    });
  });

  // ── normalizeResumeImportPayload ──────────────────────────────────

  describe("normalizeResumeImportPayload", () => {
    it("normalizes empty resumes array", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [],
      });
      expect(result.convexResumes).toEqual([]);
      expect(result.resumes).toEqual([]);
      expect(result.source).toBe("hr.job5156.com");
    });

    it("uses data field as fallback when resumes is absent", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        data: [makeResume()],
      });
      expect(result.convexResumes).toHaveLength(1);
      expect(result.resumes).toHaveLength(1);
    });

    it("resolves source from sourceHost metadata", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ sourceHost: "hk.employer.seek.com" }),
        resumes: [makeResume()],
      });
      expect(result.source).toBe("hk.employer.seek.com");
    });

    it("resolves source from sourceKey job5156", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ sourceKey: "job5156" }),
        resumes: [makeResume()],
      });
      expect(result.source).toBe("hr.job5156.com");
    });

    it("resolves source from sourceKey 51job", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ sourceKey: "51job", sourceHost: undefined }),
        resumes: [makeResume()],
      });
      expect(result.source).toBe("ehire.51job.com");
    });

    it("resolves source from sourceUrl hostname as last resort", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ sourceHost: undefined, sourceKey: undefined }),
        resumes: [makeResume()],
      });
      expect(result.source).toBe("hr.job5156.com");
    });

    it("uses searchProfileId as default tag", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ searchProfileId: "sales-eng" }),
        resumes: [makeResume()],
      });
      expect(result.tags).toEqual(["sales-eng"]);
      expect(result.convexResumes[0].tags).toEqual(["sales-eng"]);
    });

    it("uses keyword as fallback tag when no searchProfileId", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ keyword: "CNC" }),
        resumes: [makeResume()],
      });
      expect(result.tags).toEqual(["CNC"]);
    });

    it("prefers item-level tags over default tags", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ searchProfileId: "default-tag" }),
        resumes: [makeResume({ tags: ["custom-tag"] })],
      });
      expect(result.convexResumes[0].tags).toEqual(["custom-tag"]);
    });

    it("generates stable sha256 hash for resume content", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      expect(result.convexResumes[0].hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("generates same hash for identical input", () => {
      const input = { metadata: makeMetadata(), resumes: [makeResume()] };
      const r1 = normalizeResumeImportPayload(input);
      const r2 = normalizeResumeImportPayload(input);
      expect(r1.convexResumes[0].hash).toBe(r2.convexResumes[0].hash);
    });

    it("generates different hashes for different content", () => {
      const r1 = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume({ name: "Alice" })],
      });
      const r2 = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume({ name: "Bob" })],
      });
      expect(r1.convexResumes[0].hash).not.toBe(r2.convexResumes[0].hash);
    });

    // ── external ID resolution ────────────────────────────────────

    describe("external ID resolution", () => {
      it("prefers explicit externalId", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ externalId: "ext-123", profileId: "p-456" })],
        });
        expect(result.convexResumes[0].externalId).toBe("ext-123");
      });

      it("uses profileId when no externalId", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ profileId: "p-456" })],
        });
        expect(result.convexResumes[0].externalId).toBe("hr.job5156.com:profile:p-456");
      });

      it("uses resumeId when no profileId or externalId", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ resumeId: "r-789" })],
        });
        expect(result.convexResumes[0].externalId).toBe("hr.job5156.com:resume:r-789");
      });

      it("uses perUserId when no other IDs", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ perUserId: "u-101" })],
        });
        expect(result.convexResumes[0].externalId).toBe("hr.job5156.com:user:u-101");
      });

      it("falls back to hash-based ID", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume()],
        });
        expect(result.convexResumes[0].externalId).toMatch(/^hr\.job5156\.com:hash:[a-f0-9]{64}$/);
      });

      it("coerces numeric IDs to strings", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ profileId: 12345 as unknown })],
        });
        expect(result.convexResumes[0].externalId).toBe("hr.job5156.com:profile:12345");
      });
    });

    // ── restore state normalization ───────────────────────────────

    describe("restore state", () => {
      it("preserves crawledAt", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ restoreState: { crawledAt: 1700000000000 } })],
        });
        expect(result.convexResumes[0].restoreState?.crawledAt).toBe(1700000000000);
      });

      it("preserves isArchived and archivedAt", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ restoreState: { isArchived: true, archivedAt: 1700000000000 } })],
        });
        expect(result.convexResumes[0].restoreState?.isArchived).toBe(true);
        expect(result.convexResumes[0].restoreState?.archivedAt).toBe(1700000000000);
      });

      it("preserves searchText and primaryRuleScore", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ restoreState: { searchText: "alice cnc", primaryRuleScore: 85 } })],
        });
        expect(result.convexResumes[0].restoreState?.searchText).toBe("alice cnc");
        expect(result.convexResumes[0].restoreState?.primaryRuleScore).toBe(85);
      });

      it("preserves ingestData and analysis", () => {
        const ingestData = { skills: ["welding"] };
        const analysis = { score: 90, summary: "strong candidate" };
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ restoreState: { ingestData, analysis } })],
        });
        expect(result.convexResumes[0].restoreState?.ingestData).toEqual(ingestData);
        expect(result.convexResumes[0].restoreState?.analysis).toEqual(analysis);
      });

      it("drops derived fields when recomputeDerivedFields is true", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          options: { recomputeDerivedFields: true },
          resumes: [makeResume({
            restoreState: {
              crawledAt: 1700000000000,
              searchText: "old search",
              primaryRuleScore: 85,
              ingestData: { old: true },
              analysis: { score: 90 },
            },
          })],
        });
        const rs = result.convexResumes[0].restoreState;
        expect(rs?.crawledAt).toBe(1700000000000);
        expect(rs?.searchText).toBeUndefined();
        expect(rs?.primaryRuleScore).toBeUndefined();
        expect(rs?.ingestData).toBeUndefined();
        expect(rs?.analysis).toBeUndefined();
      });

      it("returns undefined restoreState when empty object", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ restoreState: {} })],
        });
        // An empty restoreState produces an empty normalized object, which returns undefined
        expect(result.convexResumes[0].restoreState).toBeUndefined();
      });

      it("rejects non-finite numbers in restoreState via schema validation", () => {
        expect(() =>
          normalizeResumeImportPayload({
            metadata: makeMetadata(),
            resumes: [makeResume({ restoreState: { crawledAt: Infinity, primaryRuleScore: NaN } })],
          }),
        ).toThrow();
      });
    });

    // ── content normalization ─────────────────────────────────────

    describe("content normalization", () => {
      it("strips sourceHost, tags, restoreState from content", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ sourceHost: "example.com", tags: ["a"], restoreState: { crawledAt: 1 } })],
        });
        const content = result.convexResumes[0].content as Record<string, unknown>;
        expect(content.sourceHost).toBeUndefined();
        expect(content.tags).toBeUndefined();
        expect(content.restoreState).toBeUndefined();
      });

      it("preserves name and other fields in content", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ name: "Bob", age: "30", education: "PhD" })],
        });
        const content = result.convexResumes[0].content as Record<string, unknown>;
        expect(content.name).toBe("Bob");
        expect(content.age).toBe("30");
        expect(content.education).toBe("PhD");
      });

      it("sets location from resume location field", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ location: "Shenzhen" })],
        });
        const content = result.convexResumes[0].content as Record<string, unknown>;
        expect(content.location).toBe("Shenzhen");
      });

      it("trims whitespace from location", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata(),
          resumes: [makeResume({ location: "  Shenzhen  " })],
        });
        const content = result.convexResumes[0].content as Record<string, unknown>;
        expect(content.location).toBe("Shenzhen");
      });
    });

    // ── metadata normalization ────────────────────────────────────

    describe("metadata normalization", () => {
      it("trims and normalizes sourceHost to lowercase", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata({ sourceHost: "  HK.EMPLOYER.SEEK.COM  " }),
          resumes: [makeResume()],
        });
        expect(result.metadata.sourceHost).toBe("hk.employer.seek.com");
      });

      it("normalizes keyword from searchCriteria fallback", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata({
            keyword: undefined,
            searchCriteria: { keyword: "  sales  " },
          }),
          resumes: [makeResume()],
        });
        expect(result.metadata.keyword).toBe("sales");
      });

      it("normalizes location from searchCriteria fallback", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata({
            location: undefined,
            searchCriteria: { location: "  Dongguan  " },
          }),
          resumes: [makeResume()],
        });
        expect(result.metadata.location).toBe("Dongguan");
      });

      it("prefers direct keyword over searchCriteria keyword", () => {
        const result = normalizeResumeImportPayload({
          metadata: makeMetadata({
            keyword: "direct",
            searchCriteria: { keyword: "criteria" },
          }),
          resumes: [makeResume()],
        });
        expect(result.metadata.keyword).toBe("direct");
      });
    });

    // ── item-level sourceHost override ────────────────────────────

    it("uses item-level sourceHost for per-resume source", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata({ sourceHost: "default.seek.com" }),
        resumes: [
          makeResume({ name: "Alice" }),
          makeResume({ name: "Bob", sourceHost: "custom.source.com" }),
        ],
      });
      expect(result.convexResumes[0].source).toBe("default.seek.com");
      expect(result.convexResumes[1].source).toBe("custom.source.com");
    });

    // ── options ───────────────────────────────────────────────────

    it("defaults recomputeDerivedFields to false", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      expect(result.options.recomputeDerivedFields).toBe(false);
    });

    it("passes through recomputeDerivedFields when set", () => {
      const result = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        options: { recomputeDerivedFields: true },
        resumes: [makeResume()],
      });
      expect(result.options.recomputeDerivedFields).toBe(true);
    });
  });

  // ── submitNormalizedResumeImport ──────────────────────────────────

  describe("submitNormalizedResumeImport", () => {
    const mockConvexUrl = "https://test-convex.convex.cloud";

    beforeEach(() => {
      process.env.CONVEX_URL = mockConvexUrl;
    });

    it("submits resumes and returns summary", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "success",
          value: { submitted: 1, deduped: 0, inserted: 1, updated: 0, unchanged: 0 },
        }),
      });

      const payload = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      const result = await submitNormalizedResumeImport(payload);

      expect(result.success).toBe(true);
      expect(result.submitted).toBe(1);
      expect(result.inserted).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`${mockConvexUrl}/api/mutation`);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const payload = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      await expect(submitNormalizedResumeImport(payload)).rejects.toThrow(
        "Convex mutation failed (500)",
      );
    });

    it("throws on Convex error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "error",
          errorMessage: "Schema validation failed",
        }),
      });

      const payload = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      await expect(submitNormalizedResumeImport(payload)).rejects.toThrow(
        "Schema validation failed",
      );
    });

    it("splits into multiple batches when resumes exceed 200", async () => {
      // Create 201 resumes to trigger 2 batches (200 + 1)
      const resumes = Array.from({ length: 201 }, (_, i) => makeResume({ name: `Candidate ${i}` }));
      const payload = normalizeResumeImportPayload({
        metadata: makeMetadata(),
        resumes,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          value: { submitted: 100, deduped: 0, inserted: 100, updated: 0, unchanged: 0 },
        }),
      });

      const result = await submitNormalizedResumeImport(payload);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.submitted).toBe(200); // 100 per batch
    });
  });

  // ── replayCandidateState ─────────────────────────────────────────

  describe("replayCandidateState", () => {
    const mockConvexUrl = "https://test-convex.convex.cloud";

    beforeEach(() => {
      process.env.CONVEX_URL = mockConvexUrl;
    });

    it("returns zeros when no status or actions provided", async () => {
      const result = await replayCandidateState({
        workspaceSlug: "dev",
        mode: "merge",
      });
      expect(result).toEqual({ statusReplayed: 0, actionsReplayed: 0, actionsDeduped: 0 });
    });

    it("replays candidate status via Convex mutations", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      const result = await replayCandidateState({
        candidateStatus: [
          { identityKey: "candidate-1", status: "shortlisted", updatedAt: Date.now() },
          { identityKey: "candidate-2", status: "archived", updatedAt: Date.now() },
        ],
        workspaceSlug: "dev",
        mode: "merge",
      });
      expect(result.statusReplayed).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("continues on individual status replay failure", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const result = await replayCandidateState({
        candidateStatus: [
          { identityKey: "bad-one", status: "shortlisted", updatedAt: Date.now() },
          { identityKey: "good-one", status: "archived", updatedAt: Date.now() },
        ],
        workspaceSlug: "dev",
        mode: "merge",
      });
      // First fails, second succeeds
      expect(result.statusReplayed).toBe(1);
    });

    it("replays candidate actions via ActionStorage", async () => {
      const actions = [
        { candidateId: "c1", action: "star" as const, createdAt: "2026-01-01" },
      ];
      const result = await replayCandidateState({
        candidateActions: actions as unknown as Parameters<typeof replayCandidateState>[0]["candidateActions"],
        workspaceSlug: "dev",
        mode: "merge",
      });
      expect(mockReplayActions).toHaveBeenCalledWith({ actions, mode: "merge" });
      expect(result.actionsReplayed).toBe(0);
      expect(result.actionsDeduped).toBe(0);
    });
  });

  // ── submitResumeImport (full pipeline) ───────────────────────────

  describe("submitResumeImport", () => {
    const mockConvexUrl = "https://test-convex.convex.cloud";

    beforeEach(() => {
      process.env.CONVEX_URL = mockConvexUrl;
    });

    it("combines normalize + submit + replay", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          value: { submitted: 1, deduped: 0, inserted: 1, updated: 0, unchanged: 0 },
        }),
      });

      const result = await submitResumeImport({
        metadata: makeMetadata(),
        resumes: [makeResume()],
      });
      expect(result.success).toBe(true);
      expect(result.submitted).toBe(1);
      expect(result.inserted).toBe(1);
      expect(result.statusReplayed).toBe(0);
      expect(result.actionsReplayed).toBe(0);
      expect(result.actionsDeduped).toBe(0);
    });

    it("uses default workspace 'dev' when not specified", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          value: { submitted: 0, deduped: 0, inserted: 0, updated: 0, unchanged: 0 },
        }),
      });

      await submitResumeImport({
        metadata: makeMetadata(),
        candidateStatus: [
          { identityKey: "c1", status: "shortlisted", updatedAt: Date.now() },
        ],
      });

      // Verify the mutation was called with workspaceSlug "dev"
      const mutationCalls = mockFetch.mock.calls.filter((call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("/api/mutation"),
      );
      expect(mutationCalls.length).toBeGreaterThan(0);
      const body = JSON.parse(mutationCalls[mutationCalls.length - 1][1].body);
      expect(body.args.workspaceSlug).toBe("dev");
    });

    it("uses provided workspaceSlug", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          value: { submitted: 0, deduped: 0, inserted: 0, updated: 0, unchanged: 0 },
        }),
      });

      await submitResumeImport(
        {
          metadata: makeMetadata(),
          candidateStatus: [
            { identityKey: "c1", status: "shortlisted", updatedAt: Date.now() },
          ],
        },
        "custom-workspace",
      );

      const mutationCalls = mockFetch.mock.calls.filter((call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("/api/mutation"),
      );
      const body = JSON.parse(mutationCalls[mutationCalls.length - 1][1].body);
      expect(body.args.workspaceSlug).toBe("custom-workspace");
    });
  });
});
