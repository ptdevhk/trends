/**
 * Factory: createAutoSyncRunner
 * Extracts the runAutoSyncIfEnabled orchestration from content.ts into a
 * dependency-injected module so content.ts stays thin.
 */

export interface AutoSyncRunnerDeps extends Record<string, unknown> {
  getAutoSyncEnabled: () => boolean;
  setAutoSyncAttributes: (status: string, count?: number, pages?: number) => void;
  resolveAutoSyncErrorStatus: (error: unknown) => { message: string; hint: string };
  resolveAutoSyncStopReason: (...args: unknown[]) => string;
  runAutoExportIfEnabled: () => Promise<unknown>;
  syncCurrentPageToServer: (resumes?: unknown) => Promise<unknown>;
  setSeekAutoSyncWindowAttributes: (attrs: unknown) => void;
  setSeekAutoSyncSelectionAttributes: (attrs: unknown) => void;
  isSeekProfileMode: () => boolean;
  resolveSeekAutoSyncPageWindow: (options?: unknown) => unknown;
  isSeekAutoSyncPageWindowReached: (pageWindow?: unknown, currentPage?: number) => boolean;
  shouldStopSeekAutoSyncForPageWindow: (options: {
    pageWindowReached: boolean;
    limit?: number | null;
    totalSubmitted?: number | null;
  }) => boolean;
  resolveSeekAutoSyncCurrentPageSelection: (options?: unknown) => { remainingCapacity: number | null; selectedCount: number | null; hitLimitWithinPage: boolean; limitAlreadyReached: boolean };
  getSeekRequestedPageSize: () => number;
  getSeekCurrentCandidateCount: () => number;
  resolveSeekAutoSyncPageSize: () => number;
  enrichSeekResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  getPaginationInfo: () => { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };
  waitForPagination: (options?: unknown) => Promise<unknown>;
  getNextPageButtonState: () => unknown;
  waitForExtractionData: (options?: unknown) => Promise<unknown>;
  extractResumes: () => unknown[];
  goToNextPageInternal: () => unknown;
  clearCapturedResultsForNextPage: () => void;
  enrich51JobSearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  enrichJob5156SearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  queueJob51DetailBackfill: (...args: unknown[]) => unknown;
  collectSnapshotPayload: (options?: unknown) => unknown;
  getApiSnapshotCount: () => number;
  buildSubmitMetadata: (options?: unknown) => unknown;
  extractProfileUrl: (resume: unknown) => string;
  loadCollectionGuards: () => unknown;
  parseGuardFieldNames: (csv: string) => Set<string>;
  applyCollectionGuards: (resume: unknown, fields: Set<string>) => unknown;
  ensureJob51PageAllowed: () => boolean;
  isJob51RateLimitedPage: () => boolean;
  waitForJob51Cooldown: () => Promise<unknown>;
  filterResumesByAgeRange: (resumes: unknown[]) => unknown[];
  getAgeRangeFromUrl: (...args: unknown[]) => unknown;
  normalizeOptionalPositiveInt: (value: unknown) => number;
  buildAutoSyncProgressHint: (options: Record<string, unknown>) => string;
  buildAutoSyncSelectedCountHint: (options: Record<string, unknown>) => string;
  buildAutoSyncCompletionHint: (options: Record<string, unknown>) => string;
  persistLatestAutoSyncSummary: () => void;
  getCurrentAgeRange: () => { enabled: boolean; minAge?: number; maxAge?: number };
  resolveCurrentJob51AutoSyncDetailWaitMode: () => string;
  waitForPageTransition: (options?: unknown) => Promise<unknown>;
  delay: (ms: number) => Promise<void>;
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  getCollectionLimits: () => Promise<Record<string, unknown>>;
  getKeywordMode: () => string;
  isJob5156DetailPage: () => boolean;
  isJob51DetailPage: () => boolean;
  SyncStatusWidget: { show: (options: Record<string, unknown>) => void; hide: () => void };
  document: Document;
  window: Window;
  chrome: Record<string, unknown>;
  state: Record<string, unknown>;
}

export function createAutoSyncRunner(deps: AutoSyncRunnerDeps) {
  const {
    // Auto-actions helpers
    getAutoSyncEnabled,
    setAutoSyncAttributes,
    resolveAutoSyncErrorStatus,
    resolveAutoSyncStopReason,
    runAutoExportIfEnabled,
    syncCurrentPageToServer,

    // Seek extractor
    setSeekAutoSyncWindowAttributes,
    setSeekAutoSyncSelectionAttributes,
    isSeekProfileMode,
    resolveSeekAutoSyncPageWindow,
    isSeekAutoSyncPageWindowReached,
    shouldStopSeekAutoSyncForPageWindow,
    resolveSeekAutoSyncCurrentPageSelection,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    resolveSeekAutoSyncPageSize,
    enrichSeekResumesWithDetail,

    // Pagination utils
    getPaginationInfo,
    waitForPagination,
    getNextPageButtonState,

    // Extraction pipeline
    waitForExtractionData,
    extractResumes,
    goToNextPageInternal,
    clearCapturedResultsForNextPage,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    queueJob51DetailBackfill,

    // Snapshot collector
    collectSnapshotPayload,
    getApiSnapshotCount,

    // Resume extractor
    buildSubmitMetadata,
    extractProfileUrl,

    // Collection guards
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards,

    // Job51 search extractor
    ensureJob51PageAllowed,
    isJob51RateLimitedPage,
    waitForJob51Cooldown,

    // Job51 age filter
    filterResumesByAgeRange,
    getAgeRangeFromUrl,
    normalizeOptionalPositiveInt,

    // UI utils
    buildAutoSyncProgressHint,
    buildAutoSyncSelectedCountHint,
    buildAutoSyncCompletionHint,
    persistLatestAutoSyncSummary,
    getCurrentAgeRange,
    resolveCurrentJob51AutoSyncDetailWaitMode,

    // Dom utils
    waitForPageTransition,
    delay,

    // Content.ts scope helpers
    getCurrentSourceKey,
    SOURCE_KEYS,
    getCollectionLimits,
    getKeywordMode,

    // Job5156 extractor
    isJob5156DetailPage,

    // Job51 extractor
    isJob51DetailPage,

    // SyncStatusWidget
    SyncStatusWidget,

    // DOM globals
    document,
    window,

    // Browser API
    chrome,
  } = deps;

  async function runAutoSyncIfEnabled() {
    if (deps.state._autoSyncTriggered as boolean) return;
    const enabled = getAutoSyncEnabled();
    if (!enabled) {
      setAutoSyncAttributes("skipped");
      setSeekAutoSyncWindowAttributes(null);
      setSeekAutoSyncSelectionAttributes(null);
      return;
    }

    const { limit, maxPages } = (await getCollectionLimits()) as { limit: number; maxPages: number };
    const isJob51Source = getCurrentSourceKey() === SOURCE_KEYS.JOB51;

    deps.state._autoSyncTriggered = true as boolean;
    deps.state._autoSyncCancelled = false as boolean;
    setAutoSyncAttributes("running", 0, 0);
    setSeekAutoSyncWindowAttributes(null);
    setSeekAutoSyncSelectionAttributes(null);
    try {
      document.documentElement.setAttribute(
        "data-tr-auto-sync-limit",
        String(limit),
      );
      document.documentElement.setAttribute(
        "data-tr-auto-sync-max-pages",
        String(maxPages),
      );
    } catch (e) {
      console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: DOM attribute set failed (limit/maxPages)", e?.message || e);
    }
    SyncStatusWidget.show({
      state: "progress",
      message: "正在同步简历到服务器...",
      hint: `${isJob51Source ? "51job 保守模式 · " : ""}数量上限: ${limit > 0 ? limit : "不限"} · 页数上限: ${maxPages > 0 ? maxPages : "不限"}`,
    });

    try {
      let totalSubmitted = 0;
      let totalInserted = 0;
      let totalUpdated = 0;
      let pagesVisited = 0;
      let lastSelectedCount = null;
      let stopReason = "completed";
      let seekStartPage = null;

      while (true) {
        if (deps.state._autoSyncCancelled) {
          stopReason = "cancelled";
          break;
        }

        ensureJob51PageAllowed();

        const paginationBefore = getPaginationInfo();
        const currentPage = paginationBefore.currentPage;
        const totalPages = paginationBefore.totalPages;
        const isSeekListPage =
          getCurrentSourceKey() === SOURCE_KEYS.SEEK && !isSeekProfileMode();
        if (isSeekListPage && seekStartPage === null) {
          seekStartPage = currentPage;
        }

        try {
          await waitForExtractionData({});
        } catch {
          // waitForExtractionData timed out — SEEK may be rate-limiting or
          // the page loaded without API rows. Don't abort the entire sync:
          // let the resumes.length check below handle it (skip to next page).
          console.warn(
            "🎯 [Auto Sync] waitForExtractionData timed out — continuing",
          );
        }
        ensureJob51PageAllowed();

        pagesVisited += 1;

        const seekPageWindow = isSeekListPage
          ? resolveSeekAutoSyncPageWindow({
              startPage: seekStartPage || currentPage,
              limit,
              maxPages,
              requestedPageSize: getSeekRequestedPageSize(),
              currentPageCandidateCount: getSeekCurrentCandidateCount(),
            })
          : null;
        setSeekAutoSyncWindowAttributes(seekPageWindow);

        const pageSelection = isSeekListPage
          ? resolveSeekAutoSyncCurrentPageSelection({
              limit,
              totalSubmitted,
              currentPageResumeCount: getSeekCurrentCandidateCount(),
            })
          : {
              remainingCapacity:
                limit > 0 ? Math.max(limit - totalSubmitted, 0) : null,
              selectedCount: null,
              hitLimitWithinPage: false,
              limitAlreadyReached:
                limit > 0 ? Math.max(limit - totalSubmitted, 0) <= 0 : false,
            };
        setSeekAutoSyncSelectionAttributes(isSeekListPage ? pageSelection : null);

        if (
          (isSeekListPage && pageSelection.limitAlreadyReached) ||
          (!isSeekListPage && limit > 0 && pageSelection.limitAlreadyReached)
        ) {
          stopReason = "limit-reached";
          break;
        }

        let resumes = extractResumes();
        const hitLimitWithinPage = isSeekListPage
          ? pageSelection.hitLimitWithinPage
          : limit > 0 &&
            typeof pageSelection.remainingCapacity === "number" &&
            resumes.length > pageSelection.remainingCapacity;
        if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
          resumes = resumes.slice(0, pageSelection.selectedCount);
        } else if (
          limit > 0 &&
          typeof pageSelection.remainingCapacity === "number" &&
          resumes.length > pageSelection.remainingCapacity
        ) {
          resumes = resumes.slice(0, pageSelection.remainingCapacity);
        }
        lastSelectedCount = isSeekListPage ? resumes.length : null;
        if (
          getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
          !isJob5156DetailPage() &&
          resumes.length > 0
        ) {
          resumes = await enrichJob5156SearchResumesWithDetail(resumes);
        }
        if (
          getCurrentSourceKey() === SOURCE_KEYS.SEEK &&
          !isSeekProfileMode() &&
          resumes.length > 0
        ) {
          resumes = await enrichSeekResumesWithDetail(resumes);
        }
        if (resumes.length <= 0) {
          const ageRange = getCurrentAgeRange();
          const ageHint = ageRange.enabled
            ? ` · 年龄: ${typeof ageRange.minAge === "number" ? ageRange.minAge : "—"}-${typeof ageRange.maxAge === "number" ? ageRange.maxAge : "—"}`
            : "";
          const progressHint = buildAutoSyncProgressHint({
            limit,
            totalSubmitted,
            selectedCount: isSeekListPage ? resumes.length : null,
            ageHint,
          });

          SyncStatusWidget.show({
            state: "progress",
            message: `第 ${currentPage}/${Math.max(totalPages, currentPage)} 页无符合条件的简历，继续...`,
            hint: progressHint,
          });
          setAutoSyncAttributes("running", totalSubmitted, pagesVisited);

          if (deps.state._autoSyncCancelled) {
            stopReason = "cancelled";
            break;
          }
          if (
            isSeekListPage &&
            shouldStopSeekAutoSyncForPageWindow({
              pageWindowReached: isSeekAutoSyncPageWindowReached(seekPageWindow, currentPage),
              limit,
              totalSubmitted,
            })
          ) {
            stopReason = "page-window-reached";
            break;
          }
          if (maxPages > 0 && pagesVisited >= maxPages) {
            stopReason = "max-pages-reached";
            break;
          }

          const paginationAfter = getPaginationInfo();
          if (
            !paginationAfter.hasNextPage ||
            paginationAfter.currentPage >= paginationAfter.totalPages
          ) {
            stopReason = "no-next-page";
            break;
          }
          try {
            await waitForPagination({ timeoutMs: 8000 });
          } catch (e) {
            console.warn("[tr-auto-sync]", "waitForPagination timed out (empty-resumes branch)", e?.message || e);
          }
          const nextPage = paginationAfter.currentPage + 1;
          try {
            document.documentElement.setAttribute(
              "data-tr-auto-sync-next-state",
              JSON.stringify(getNextPageButtonState()),
            );
          } catch (e) {
            console.warn("[tr-auto-sync]", "DOM attribute set failed (next-state, empty-resumes)", e?.message || e);
          }
          await waitForJob51Cooldown();
          clearCapturedResultsForNextPage();
          const moved = goToNextPageInternal();
          if (!moved) {
            stopReason = "no-next-page";
            break;
          }
          await waitForPageTransition({
            expectedPage: nextPage,
            timeoutMs: 15000,
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        const progressHint = buildAutoSyncProgressHint({
          limit,
          totalSubmitted,
          selectedCount: isSeekListPage ? resumes.length : null,
        });
        SyncStatusWidget.show({
          state: "progress",
          message: `正在同步第 ${currentPage}/${Math.max(totalPages, currentPage)} 页 (${resumes.length} 份)...`,
          hint: progressHint,
        });

        const response = (await syncCurrentPageToServer(resumes)) as Record<string, unknown> | null;
        if (!response?.success) {
          throw response?.error || response || "Auto sync failed";
        }

        const submitted =
          typeof response.submitted === "number"
            ? response.submitted
            : resumes.length;
        const inserted =
          typeof response.inserted === "number" ? response.inserted : 0;
        const updated =
          typeof response.updated === "number" ? response.updated : 0;
        totalSubmitted += submitted;
        totalInserted += inserted;
        totalUpdated += updated;
        setAutoSyncAttributes("running", totalSubmitted, pagesVisited);

        if (
          getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
          !isJob51DetailPage() &&
          resumes.length > 0
        ) {
          const detailBackfillPromise = queueJob51DetailBackfill(resumes, {
            currentPage,
            totalPages: Math.max(totalPages, currentPage),
          });
          const waitMode = resolveCurrentJob51AutoSyncDetailWaitMode();
          const shouldWaitForDetails =
            waitMode === "all" || (waitMode === "page1" && currentPage === 1);
          if (shouldWaitForDetails) {
            SyncStatusWidget.show({
              state: "progress",
              message: `正在补充第 ${currentPage}/${Math.max(totalPages, currentPage)} 页详情...`,
              hint: "等待 51job 详情补充后再完成本页同步",
            });
            await detailBackfillPromise;
          }
        }

        if (deps.state._autoSyncCancelled) {
          stopReason = "cancelled";
          break;
        }
        if (isSeekListPage && hitLimitWithinPage) {
          stopReason = "limit-reached";
          break;
        }
        if (limit > 0 && totalSubmitted >= limit) {
          stopReason = "limit-reached";
          break;
        }
        if (
          isSeekListPage &&
          shouldStopSeekAutoSyncForPageWindow({
            pageWindowReached: isSeekAutoSyncPageWindowReached(seekPageWindow, currentPage),
            limit,
            totalSubmitted,
          })
        ) {
          stopReason = "page-window-reached";
          break;
        }
        if (maxPages > 0 && pagesVisited >= maxPages) {
          stopReason = "max-pages-reached";
          break;
        }

        const paginationAfter = getPaginationInfo();
        if (
          !paginationAfter.hasNextPage ||
          paginationAfter.currentPage >= paginationAfter.totalPages
        ) {
          stopReason = "no-next-page";
          break;
        }
        try {
          await waitForPagination({ timeoutMs: 8000 });
        } catch (e) {
          console.warn("[tr-auto-sync]", "waitForPagination timed out (sync-success branch)", e?.message || e);
        }
        const nextPage = paginationAfter.currentPage + 1;
        try {
          document.documentElement.setAttribute(
            "data-tr-auto-sync-next-state",
            JSON.stringify(getNextPageButtonState()),
          );
        } catch (e) {
          console.warn("[tr-auto-sync]", "DOM attribute set failed (next-state, sync-success)", e?.message || e);
        }
        await waitForJob51Cooldown();
        clearCapturedResultsForNextPage();
        const moved = goToNextPageInternal();
        if (!moved) {
          stopReason = "no-next-page";
          break;
        }
        await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      try {
        document.documentElement.setAttribute(
          "data-tr-auto-sync-stop-reason",
          stopReason,
        );
      } catch (e) {
        console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: DOM attribute set failed (stop-reason)", e?.message || e);
      }
      persistLatestAutoSyncSummary();

      if (deps.state._autoSyncCancelled) {
        SyncStatusWidget.show({
          state: "success",
          message: `同步已取消，已同步 ${totalSubmitted} 份简历`,
          hint: buildAutoSyncCompletionHint({
            totalInserted,
            totalUpdated,
            pagesVisited,
            selectedCount: lastSelectedCount,
          }),
          autoDismiss: true,
        });
        setAutoSyncAttributes("cancelled", totalSubmitted, pagesVisited);
        return;
      }

      SyncStatusWidget.show({
        state: "success",
        message: `已同步 ${totalSubmitted} 份简历 (${totalInserted} 新增, ${totalUpdated} 更新), 共 ${pagesVisited} 页`,
        hint: [
          buildAutoSyncSelectedCountHint({
            selectedCount: lastSelectedCount,
            prefix: "",
          }),
          isJob51Source ? "51job 详情补充正在后台继续" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        autoDismiss: true,
      });
      setAutoSyncAttributes("done", totalSubmitted, pagesVisited);
    } catch (error) {
      console.warn("🎯 [Auto Sync] Failed:", error);
      const status = resolveAutoSyncErrorStatus(error);
      SyncStatusWidget.show({
        state: "error",
        message: status.message,
        hint: status.hint,
      });
      setAutoSyncAttributes("failed");
      try {
        document.documentElement.setAttribute(
          "data-tr-auto-sync-stop-reason",
          resolveAutoSyncStopReason(error),
        );
      } catch (e) {
        console.warn("[tr-auto-sync]", "runAutoSyncIfEnabled: fallback attribute set failed (stop-reason)", e?.message || e);
      }
      persistLatestAutoSyncSummary();
    }
  }

  return { runAutoSyncIfEnabled };
}
