import { describe, it, expect, vi } from "vitest";

import { createSnapshotCollector, type SnapshotCollectorDeps } from "../snapshot-collector";

function createMockDeps(overrides: Record<string, unknown> = {}): SnapshotCollectorDeps {
  return {
    apiSnapshot: {
      searchRows: [],
      job51SearchRows: [],
      seekRecommendedCandidates: [],
      seekTalentSearch: [],
      seekProfile: null,
      job51AuthContext: null,
      job51DetailPayload: null,
    },
    getCurrentSourceKey: vi.fn(() => "job51"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    isJob51DetailPage: vi.fn(() => false),
    isJob51DetailReady: vi.fn(() => false),
    getSeekSnapshotCount: vi.fn(() => 0),
    normalizeJob51AuthContext: vi.fn(() => null),
    getJob51TotalFromPayload: vi.fn(() => null),
    getJob51ResumeRows: vi.fn(() => null),
    getSeekPayloadData: vi.fn(() => null),
    chrome: { runtime: { getURL: vi.fn(() => "chrome-extension://abc/page-hook.js") } },
    normalizeCollectionLimit: (v: unknown) =>
      typeof v === "number" && v > 0 ? v : 0,
    pipelineState: { runId: 0, chain: Promise.resolve() },
    waitForExtractionData: vi.fn(() => Promise.resolve()),
    isSeekProfileMode: vi.fn(() => false),
    resolveSeekAutoSyncPageWindow: vi.fn(() => null),
    getSeekRequestedPageSize: vi.fn(() => null),
    getSeekCurrentCandidateCount: vi.fn(() => 0),
    resolveSeekAutoSyncCurrentPageSelection: vi.fn(() => ({
      remainingCapacity: null,
      selectedCount: null,
      hitLimitWithinPage: false,
      limitAlreadyReached: false,
    })),
    extractResumes: vi.fn(() => []),
    enrich51JobSearchResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    enrichJob5156SearchResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    isJob5156DetailPage: vi.fn(() => false),
    enrichSeekResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    getPaginationInfo: vi.fn(() => ({
      currentPage: 1,
      totalPages: 1,
      totalItems: 0,
      hasNextPage: false,
    })),
    isSeekAutoSyncPageWindowReached: vi.fn(() => false),
    shouldStopSeekAutoSyncForPageWindow: vi.fn(({
      pageWindowReached,
      limit,
      totalSubmitted,
    }: {
      pageWindowReached: boolean;
      limit?: number | null;
      totalSubmitted?: number | null;
    }) => {
      if (!pageWindowReached) return false;
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return true;
      return (typeof totalSubmitted === "number" ? totalSubmitted : 0) >= limit;
    }),
    waitForPagination: vi.fn(() => Promise.resolve()),
    clearCapturedResultsForNextPage: vi.fn(),
    goToNextPageInternal: vi.fn(() => false),
    waitForPageTransition: vi.fn(() => Promise.resolve()),
    buildSubmitMetadata: vi.fn(() => ({})),
    delay: vi.fn(() => Promise.resolve()),
    loadCollectionGuards: vi.fn(async () => ({
      job5156: "experience,jobIntention,selfIntro",
      "51job": "experience,jobIntention,selfIntro",
      seek: "experience,jobIntention,selfIntro",
    })),
    parseGuardFieldNames: vi.fn((csv: string) =>
      csv ? csv.split(",").map((f) => f.trim()).filter(Boolean) : [],
    ),
    applyCollectionGuards: vi.fn((resume: unknown, fields: string[]) => {
      if (!resume || typeof resume !== "object") return resume;
      const guarded = { ...(resume as Record<string, unknown>) };
      const arrayFields = new Set(["workHistory", "profileEducation", "projectExperience", "skills", "licences"]);
      for (const field of fields) guarded[field] = arrayFields.has(field) ? [] : "";
      return guarded;
    }),
    document: {
      documentElement: {
        hasAttribute: vi.fn(() => false),
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => ""),
      },
      createElement: vi.fn(() => ({
        src: "",
        async: false,
        setAttribute: vi.fn(),
        onload: null,
        remove: vi.fn(),
      })),
      head: { prepend: vi.fn() },
    },
    ...overrides,
  } as unknown as SnapshotCollectorDeps;
}

describe("snapshot-collector", () => {
  describe("getApiSnapshotCount", () => {
    it("returns searchRows length when array", () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot: { searchRows: [1, 2, 3] },
        }),
      );
      expect(collector.getApiSnapshotCount()).toBe(3);
    });

    it("returns job51SearchRows length for job51 source", () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot: { searchRows: null, job51SearchRows: [1, 2] },
        }),
      );
      expect(collector.getApiSnapshotCount()).toBe(2);
    });

    it("returns seek snapshot count for seek source", () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot: { searchRows: null, job51SearchRows: null },
          getCurrentSourceKey: vi.fn(() => "seek"),
          getSeekSnapshotCount: vi.fn(() => 5),
        }),
      );
      expect(collector.getApiSnapshotCount()).toBe(5);
    });

    it("returns 0 for empty snapshots", () => {
      const collector = createSnapshotCollector(createMockDeps());
      expect(collector.getApiSnapshotCount()).toBe(0);
    });

    it("returns 1 for job51 detail page when ready", () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot: { searchRows: null, job51SearchRows: null },
          isJob51DetailPage: vi.fn(() => true),
          isJob51DetailReady: vi.fn(() => true),
        }),
      );
      expect(collector.getApiSnapshotCount()).toBe(1);
    });

    it("returns 0 for job51 detail page when not ready", () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot: { searchRows: null, job51SearchRows: null },
          isJob51DetailPage: vi.fn(() => true),
          isJob51DetailReady: vi.fn(() => false),
        }),
      );
      expect(collector.getApiSnapshotCount()).toBe(0);
    });
  });

  describe("normalizeSnapshotCollectOptions", () => {
    it("returns normalized defaults for empty input", () => {
      const collector = createSnapshotCollector(createMockDeps());
      const result = collector.normalizeSnapshotCollectOptions();
      expect(result).toEqual({
        limit: 0,
        maxPages: 0,
        allowEmpty: false,
      });
    });

    it("returns normalized options for valid input", () => {
      const collector = createSnapshotCollector(createMockDeps());
      const result = collector.normalizeSnapshotCollectOptions({
        limit: 50,
        maxPages: 5,
        allowEmpty: true,
      });
      expect(result).toEqual({
        limit: 50,
        maxPages: 5,
        allowEmpty: true,
      });
    });

    it("handles non-object input", () => {
      const collector = createSnapshotCollector(createMockDeps());
      const result = collector.normalizeSnapshotCollectOptions(null);
      expect(result).toEqual({
        limit: 0,
        maxPages: 0,
        allowEmpty: false,
      });
    });
  });

  describe("updateApiSnapshot", () => {
    it("updates searchRows for kind=search", () => {
      const apiSnapshot = { searchRows: [] } as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "search",
        payload: { data: { resumePage: { rows: [{ id: 1 }] } } },
        sourceKey: "job5156",
      });
      expect(apiSnapshot.searchRows).toEqual([{ id: 1 }]);
    });

    it("updates job51SearchRows for kind=job51search", () => {
      const apiSnapshot = {
        job51SearchRows: null,
      } as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({
          apiSnapshot,
          getJob51TotalFromPayload: () => 100,
          getJob51ResumeRows: () => [{ id: 1 }],
        }),
      );
      collector.updateApiSnapshot({
        kind: "job51search",
        payload: { data: { total: 100, list: [{ id: 1 }] } },
        sourceKey: "job51",
      });
      expect(apiSnapshot.job51SearchRows).toEqual([{ id: 1 }]);
      expect(apiSnapshot.job51Total).toBe(100);
    });

    it("updates job51DetailPayload for kind=job51detail", () => {
      const apiSnapshot = {
        job51DetailPayload: null,
      } as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "job51detail",
        payload: { detail: "data" },
        sourceKey: "job51",
      });
      expect(apiSnapshot.job51DetailPayload).toEqual({ detail: "data" });
    });

    it("sets lastUrl from message", () => {
      const apiSnapshot = {} as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "search",
        url: "https://example.com/api",
        payload: { data: { resumePage: { rows: [] } } },
      });
      expect(apiSnapshot.lastUrl).toBe("https://example.com/api");
    });

    it("sets lastSourceKey from message", () => {
      const apiSnapshot = {} as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "search",
        sourceKey: "job51",
        payload: { data: { resumePage: { rows: [] } } },
      });
      expect(apiSnapshot.lastSourceKey).toBe("job51");
    });

    it("updates attachInfo for kind=attach", () => {
      const apiSnapshot = {} as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "attach",
        payload: { data: { attachResumeInfo: { attached: true } } },
      });
      expect(apiSnapshot.attachInfo).toEqual({ attached: true });
    });

    it("updates chatInfo for kind=chat", () => {
      const apiSnapshot = {} as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "chat",
        payload: { data: { chatInfo: { chatId: "123" } } },
      });
      expect(apiSnapshot.chatInfo).toEqual({ chatId: "123" });
    });

    it("updates insightInfo for kind=insight", () => {
      const apiSnapshot = {} as Record<string, unknown>;
      const collector = createSnapshotCollector(
        createMockDeps({ apiSnapshot }),
      );
      collector.updateApiSnapshot({
        kind: "insight",
        payload: { data: { talentInsightInfo: { score: 95 } } },
      });
      expect(apiSnapshot.insightInfo).toEqual({ score: 95 });
    });
  });

  describe("installApiHook", () => {
    it("sets data-tr-resume-hook attribute when page-hook already loaded", () => {
      const mockDoc = {
        documentElement: {
          hasAttribute: vi.fn((attr: string) => attr === "data-tr-page-hook"),
          setAttribute: vi.fn(),
        },
        createElement: vi.fn(),
      };
      const collector = createSnapshotCollector(
        createMockDeps({ document: mockDoc }),
      );
      collector.installApiHook();
      expect(mockDoc.documentElement.setAttribute).toHaveBeenCalledWith(
        "data-tr-resume-hook",
        "true",
      );
      expect(mockDoc.createElement).not.toHaveBeenCalled();
    });

    it("skips when resume-hook already installed", () => {
      const mockDoc = {
        documentElement: {
          hasAttribute: vi.fn((attr: string) =>
            ["data-tr-resume-hook"].includes(attr)),
          setAttribute: vi.fn(),
        },
        createElement: vi.fn(),
      };
      const collector = createSnapshotCollector(
        createMockDeps({ document: mockDoc }),
      );
      collector.installApiHook();
      expect(mockDoc.createElement).not.toHaveBeenCalled();
    });

    it("creates script element when hook not yet installed", () => {
      const scriptEl = {
        src: "",
        async: false,
        setAttribute: vi.fn(),
        onload: null,
        remove: vi.fn(),
      };
      const mockDoc = {
        documentElement: {
          hasAttribute: vi.fn(() => false),
          setAttribute: vi.fn(),
        },
        createElement: vi.fn(() => scriptEl),
        head: { prepend: vi.fn() },
      };
      const collector = createSnapshotCollector(
        createMockDeps({ document: mockDoc }),
      );
      collector.installApiHook();
      expect(mockDoc.createElement).toHaveBeenCalledWith("script");
      expect(scriptEl.src).toBe(
        "chrome-extension://abc/page-hook.js",
      );
      expect(mockDoc.head.prepend).toHaveBeenCalledWith(scriptEl);
    });
  });

  describe("collectSnapshotPayload", () => {
    it("throws for unsupported source key", async () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          getCurrentSourceKey: vi.fn(() => "unknown"),
        }),
      );
      await expect(collector.collectSnapshotPayload()).rejects.toThrow(
        "Unsupported source for snapshot collection: unknown",
      );
    });

    it("throws when no resumes extracted and allowEmpty is false", async () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          extractResumes: vi.fn(() => []),
        }),
      );
      await expect(
        collector.collectSnapshotPayload({ allowEmpty: false }),
      ).rejects.toThrow("No resumes extracted");
    });

    it("returns empty result when allowEmpty is true", async () => {
      const collector = createSnapshotCollector(
        createMockDeps({
          extractResumes: vi.fn(() => []),
        }),
      );
      const result = await collector.collectSnapshotPayload({
        allowEmpty: true,
      });
      expect(result.resumes).toEqual([]);
      expect(result.summary.count).toBe(0);
      expect(result.summary.pagesVisited).toBe(1);
      expect(result.summary.stopReason).toBe("no-next-page");
    });

    it("returns collected resumes with metadata", async () => {
      const mockResumes = [{ name: "Test" }, { name: "Test2" }];
      const collector = createSnapshotCollector(
        createMockDeps({
          extractResumes: vi.fn(() => mockResumes),
        }),
      );
      const result = await collector.collectSnapshotPayload({
        allowEmpty: true,
      });
      expect(result.resumes).toEqual(mockResumes);
      expect(result.summary.count).toBe(2);
      expect(result.metadata.totalResumes).toBe(2);
    });

    it("guards job5156 snapshot rows after detail enrichment", async () => {
      const collector = createSnapshotCollector(createMockDeps({
        getCurrentSourceKey: vi.fn(() => "job5156"),
        extractResumes: vi.fn(() => [
          { name: "Alice", experience: "", jobIntention: "", selfIntro: "" },
        ]),
        enrichJob5156SearchResumesWithDetail: vi.fn(async () => [
          {
            name: "Alice",
            experience: "8 years",
            jobIntention: "Sales Engineer",
            selfIntro: "Sensitive free text",
          },
        ]),
        getPaginationInfo: vi.fn(() => ({
          currentPage: 1,
          totalPages: 1,
          totalItems: 1,
          hasNextPage: false,
        })),
        buildSubmitMetadata: vi.fn(() => ({
          sourceKey: "job5156",
          sourceHost: "hr.job5156.com",
          generatedBy: "browser-extension@1.0.0",
        })),
      }));

      const payload = await collector.collectSnapshotPayload({ limit: 1 });

      expect(payload.resumes).toEqual([
        expect.objectContaining({
          name: "Alice",
          experience: "",
          jobIntention: "",
          selfIntro: "",
        }),
      ]);
    });
  });
});
