import { describe, it, expect, vi } from "vitest";

import { createAutoSyncRunner, type AutoSyncRunnerDeps } from "../auto-sync-runner";

function createMockDeps(overrides: Record<string, unknown> = {}): AutoSyncRunnerDeps {
  return {
    getAutoSyncEnabled: vi.fn(() => true),
    setAutoSyncAttributes: vi.fn(),
    resolveAutoSyncErrorStatus: vi.fn(() => ({
      message: "Error",
      hint: "Try again",
    })),
    resolveAutoSyncStopReason: vi.fn(() => "error"),
    runAutoExportIfEnabled: vi.fn(),
    syncCurrentPageToServer: vi.fn(() =>
      Promise.resolve({ success: true, submitted: 5, inserted: 3, updated: 2 }),
    ),
    setSeekAutoSyncWindowAttributes: vi.fn(),
    setSeekAutoSyncSelectionAttributes: vi.fn(),
    isSeekProfileMode: vi.fn(() => false),
    getCurrentSeekMode: vi.fn(() => null),
    resolveSeekAutoSyncPageWindow: vi.fn(() => null),
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
    resolveSeekAutoSyncCurrentPageSelection: vi.fn(() => ({
      remainingCapacity: null,
      selectedCount: null,
      hitLimitWithinPage: false,
      limitAlreadyReached: false,
    })),
    getSeekRequestedPageSize: vi.fn(() => null),
    getSeekCurrentCandidateCount: vi.fn(() => 0),
    resolveSeekAutoSyncPageSize: vi.fn(() => 20),
    enrichSeekResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    getPaginationInfo: vi.fn(() => ({
      currentPage: 1,
      totalPages: 1,
      totalItems: 5,
      hasNextPage: false,
    })),
    waitForPagination: vi.fn(() => Promise.resolve()),
    getNextPageButtonState: vi.fn(() => ({ disabled: true })),
    waitForExtractionData: vi.fn(() => Promise.resolve()),
    extractResumes: vi.fn(() => [{ name: "Test" }]),
    goToNextPageInternal: vi.fn(() => false),
    clearCapturedResultsForNextPage: vi.fn(),
    enrich51JobSearchResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    enrichJob5156SearchResumesWithDetail: vi.fn((r) => Promise.resolve(r)),
    queueJob51DetailBackfill: vi.fn(() => Promise.resolve()),
    collectSnapshotPayload: vi.fn(() => Promise.resolve({ resumes: [] })),
    getApiSnapshotCount: vi.fn(() => 0),
    buildSubmitMetadata: vi.fn(() => ({})),
    extractProfileUrl: vi.fn(() => ""),
    loadCollectionGuards: vi.fn(() => Promise.resolve(null)),
    parseGuardFieldNames: vi.fn(() => []),
    applyCollectionGuards: vi.fn((r) => r),
    ensureJob51PageAllowed: vi.fn(),
    isJob51RateLimitedPage: vi.fn(() => false),
    waitForJob51Cooldown: vi.fn(() => Promise.resolve()),
    filterResumesByAgeRange: vi.fn((r) => r),
    getAgeRangeFromUrl: vi.fn(() => null),
    normalizeOptionalPositiveInt: vi.fn(() => null),
    buildAutoSyncProgressHint: vi.fn(() => ""),
    buildAutoSyncSelectedCountHint: vi.fn(() => ""),
    buildAutoSyncCompletionHint: vi.fn(() => ""),
    persistLatestAutoSyncSummary: vi.fn(),
    getCurrentAgeRange: vi.fn(() => ({ enabled: false })),
    resolveCurrentJob51AutoSyncDetailWaitMode: vi.fn(() => "background"),
    waitForPageTransition: vi.fn(() => Promise.resolve()),
    delay: vi.fn(() => Promise.resolve()),
    getCurrentSourceKey: vi.fn(() => "job5156"),
    SOURCE_KEYS: { JOB51: "job51", JOB5156: "job5156", SEEK: "seek" },
    getCollectionLimits: vi.fn(() => Promise.resolve({ limit: 50, maxPages: 5 })),
    getKeywordMode: vi.fn(() => "normal"),
    isJob5156DetailPage: vi.fn(() => false),
    isJob51DetailPage: vi.fn(() => false),
    SyncStatusWidget: {
      show: vi.fn(),
      hide: vi.fn(),
    },
    document: {
      documentElement: {
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => ""),
      },
    },
    window: {},
    chrome: {},
    state: {
      _autoSyncTriggered: false,
      _autoSyncCancelled: false,
    },
    ...overrides,
  } as unknown as AutoSyncRunnerDeps;
}

describe("auto-sync-runner", () => {
  describe("runAutoSyncIfEnabled", () => {
    it("skips when auto sync is disabled", async () => {
      const deps = createMockDeps({
        getAutoSyncEnabled: vi.fn(() => false),
      });
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith("skipped");
      expect(deps.SyncStatusWidget.show).not.toHaveBeenCalled();
    });

    it("skips when already triggered", async () => {
      const deps = createMockDeps({
        state: { _autoSyncTriggered: true, _autoSyncCancelled: false },
      });
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();
      expect(deps.setAutoSyncAttributes).not.toHaveBeenCalled();
    });

    it("syncs resumes and shows success", async () => {
      const deps = createMockDeps();
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.state._autoSyncTriggered).toBe(true);
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith("running", 0, 0);
      expect(deps.syncCurrentPageToServer).toHaveBeenCalled();
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith(
        "done",
        5,
        1,
      );
      expect(deps.SyncStatusWidget.show).toHaveBeenCalledWith(
        expect.objectContaining({ state: "success" }),
      );
    });

    it("handles sync failure and shows error", async () => {
      const deps = createMockDeps({
        syncCurrentPageToServer: vi.fn(() =>
          Promise.reject(new Error("Network error")),
        ),
      });
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.resolveAutoSyncErrorStatus).toHaveBeenCalled();
      expect(deps.SyncStatusWidget.show).toHaveBeenCalledWith(
        expect.objectContaining({ state: "error" }),
      );
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith("failed");
    });

    it("handles sync failure with error response object", async () => {
      const deps = createMockDeps({
        syncCurrentPageToServer: vi.fn(() =>
          Promise.resolve({ success: false, error: "Server rejected" }),
        ),
      });
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.resolveAutoSyncErrorStatus).toHaveBeenCalled();
      expect(deps.SyncStatusWidget.show).toHaveBeenCalledWith(
        expect.objectContaining({ state: "error" }),
      );
    });

    it("cancels sync when state flag set", async () => {
      let callCount = 0;
      const deps = createMockDeps({
        syncCurrentPageToServer: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            deps.state._autoSyncCancelled = true;
          }
          return Promise.resolve({
            success: true,
            submitted: 5,
            inserted: 3,
            updated: 2,
          });
        }),
        getPaginationInfo: vi.fn(() => ({
          currentPage: 1,
          totalPages: 5,
          totalItems: 50,
          hasNextPage: true,
        })),
        goToNextPageInternal: vi.fn(() => true),
      });
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith(
        "cancelled",
        5,
        1,
      );
    });

    it("shows progress widget during sync", async () => {
      const deps = createMockDeps();
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.SyncStatusWidget.show).toHaveBeenCalledWith(
        expect.objectContaining({ state: "progress" }),
      );
    });

    it("sets auto sync limit and max pages attributes", async () => {
      const deps = createMockDeps();
      const runner = createAutoSyncRunner(deps);
      await runner.runAutoSyncIfEnabled();

      expect(deps.document.documentElement.setAttribute).toHaveBeenCalledWith(
        "data-tr-auto-sync-limit",
        "50",
      );
      expect(deps.document.documentElement.setAttribute).toHaveBeenCalledWith(
        "data-tr-auto-sync-max-pages",
        "5",
      );
    });

    it("does not submit sparse seek talent-search resumes after enrichment", async () => {
      const submittedBatches: unknown[][] = [];
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        getCurrentSeekMode: vi.fn(() => "talentsearch"),
        window: { location: { pathname: "/talentsearch/profiles/search" } },
        extractResumes: vi.fn(() => [
          { name: "Detailed", workHistory: [{ description: "" }] },
          { name: "Sparse", workHistory: [{ description: "" }] },
        ]),
        enrichSeekResumesWithDetail: vi.fn(async () => [
          { name: "Detailed", workHistory: [{ description: "Closed enterprise deals." }] },
          { name: "Sparse", workHistory: [{ description: "RESPONSIBILITIES: ACCOMPLISHMENT:" }] },
        ]),
        syncCurrentPageToServer: vi.fn(async (resumes: unknown[]) => {
          submittedBatches.push(Array.isArray(resumes) ? resumes : []);
          return {
            success: true,
            submitted: Array.isArray(resumes) ? resumes.length : 0,
            inserted: Array.isArray(resumes) ? resumes.length : 0,
            updated: 0,
          };
        }),
        getPaginationInfo: vi.fn(() => ({
          currentPage: 1,
          totalPages: 1,
          totalItems: 2,
          hasNextPage: false,
        })),
      });
      const runner = createAutoSyncRunner(deps);

      await runner.runAutoSyncIfEnabled();

      expect(submittedBatches).toHaveLength(1);
      expect(submittedBatches[0]).toEqual([
        { name: "Detailed", workHistory: [{ description: "Closed enterprise deals." }] },
      ]);
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith("done", 1, 1);
    });

    it("stops seek after consecutive pages without usable work history", async () => {
      let currentPage = 1;
      const deps = createMockDeps({
        getCurrentSourceKey: vi.fn(() => "seek"),
        getCurrentSeekMode: vi.fn(() => "talentsearch"),
        window: { location: { pathname: "/talentsearch/profiles/search" } },
        getCollectionLimits: vi.fn(() => Promise.resolve({ limit: 100, maxPages: 25 })),
        extractResumes: vi.fn(() => [
          { workHistory: [{ description: "" }] },
        ]),
        enrichSeekResumesWithDetail: vi.fn(async (resumes: unknown[]) => resumes),
        getPaginationInfo: vi.fn(() => ({
          currentPage,
          totalPages: currentPage + 3,
          totalItems: 0,
          hasNextPage: true,
        })),
        goToNextPageInternal: vi.fn(() => {
          currentPage += 1;
          return true;
        }),
      });
      const runner = createAutoSyncRunner(deps);

      await runner.runAutoSyncIfEnabled();

      expect(deps.syncCurrentPageToServer).not.toHaveBeenCalled();
      expect(deps.goToNextPageInternal).toHaveBeenCalledTimes(2);
      expect(deps.setAutoSyncAttributes).toHaveBeenCalledWith("done", 0, 3);
      expect(deps.document.documentElement.setAttribute).toHaveBeenCalledWith(
        "data-tr-auto-sync-stop-reason",
        "seek-no-usable-results",
      );
    });
  });
});
