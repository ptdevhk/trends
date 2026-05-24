// @ts-nocheck
/**
 * Snapshot collector — API state management, message hook installation,
 * and snapshot payload collection. Dependencies injected from content.ts.
 */

export function createSnapshotCollector(deps) {
  const {
    apiSnapshot,
    getCurrentSourceKey,
    SOURCE_KEYS,
    isJob51DetailPage,
    isJob51DetailReady,
    getSeekSnapshotCount,
    normalizeJob51AuthContext,
    getJob51TotalFromPayload,
    getJob51ResumeRows,
    getSeekPayloadData,
    chrome,
    normalizeCollectionLimit,
    pipelineState,
    waitForExtractionData,
    isSeekProfileMode,
    resolveSeekAutoSyncPageWindow,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    resolveSeekAutoSyncCurrentPageSelection,
    extractResumes,
    enrich51JobSearchResumesWithDetail,
    enrichJob5156SearchResumesWithDetail,
    isJob5156DetailPage,
    enrichSeekResumesWithDetail,
    getPaginationInfo,
    isSeekAutoSyncPageWindowReached,
    waitForPagination,
    clearCapturedResultsForNextPage,
    goToNextPageInternal,
    waitForPageTransition,
    buildSubmitMetadata,
    delay,
    document: doc,
  } = deps;

  // ── getApiSnapshotCount ──

  function getApiSnapshotCount() {
    if (Array.isArray(apiSnapshot.searchRows)) {
      return apiSnapshot.searchRows.length;
    }
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      if (isJob51DetailPage()) {
        return isJob51DetailReady() ? 1 : 0;
      }
      return Array.isArray(apiSnapshot.job51SearchRows)
        ? apiSnapshot.job51SearchRows.length
        : 0;
    }
    if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
      return getSeekSnapshotCount();
    }
    return 0;
  }

  // ── normalizeSnapshotCollectOptions ──

  function normalizeSnapshotCollectOptions(options = {}) {
    /** @type {{ limit?: number; maxPages?: number; allowEmpty?: boolean }} */
    const normalizedOptions =
      typeof options === "object" && options ? options : {};
    return {
      limit: normalizeCollectionLimit(normalizedOptions.limit),
      maxPages: normalizeCollectionLimit(normalizedOptions.maxPages),
      allowEmpty: !!normalizedOptions.allowEmpty,
    };
  }

  // ── installApiHook ──

  function installApiHook() {
    try {
      if (doc.documentElement.hasAttribute("data-tr-page-hook")) {
        doc.documentElement.setAttribute("data-tr-resume-hook", "true");
        return;
      }
      if (doc.documentElement.hasAttribute("data-tr-resume-hook")) return;
      const script = doc.createElement("script");
      script.src = chrome.runtime.getURL("page-hook.js");
      script.async = false;
      script.setAttribute("data-tr-resume-hook", "true");
      script.onload = () => script.remove();
      const mountTarget = doc.head || doc.documentElement;
      mountTarget.prepend(script);
      doc.documentElement.setAttribute("data-tr-resume-hook", "true");
    } catch (error) {
      console.warn("Failed to install API hook:", error);
    }
  }

  // ── updateApiSnapshot ──

  function setApiRowsAttribute() {
    try {
      doc.documentElement.setAttribute(
        "data-tr-api-rows",
        String(getApiSnapshotCount()),
      );
    } catch {
      // ignore
    }
  }

  function mergeJob51AuthContext(requestHeaders, request) {
    const authContext = normalizeJob51AuthContext(requestHeaders, request);
    if (authContext) {
      apiSnapshot.job51AuthContext = {
        ...(apiSnapshot.job51AuthContext || {}),
        ...authContext,
      };
    }
  }

  function updateApiSnapshot(message) {
    const {
      kind,
      payload,
      url,
      sourceKey,
      operationName,
      request,
      requestHeaders,
    } = message;
    apiSnapshot.lastUpdatedAt = new Date().toISOString();
    if (url) apiSnapshot.lastUrl = url;
    apiSnapshot.lastSourceKey = sourceKey || null;
    apiSnapshot.lastOperationName = operationName || null;

    try {
      doc.documentElement.setAttribute("data-tr-api-last", kind);
      doc.documentElement.setAttribute(
        "data-tr-api-updated",
        apiSnapshot.lastUpdatedAt,
      );
      if (sourceKey) {
        doc.documentElement.setAttribute("data-tr-source-key", sourceKey);
      }
    } catch {
      // ignore
    }

    if (kind === "search") {
      const rows = payload?.data?.resumePage?.rows;
      if (Array.isArray(rows)) {
        apiSnapshot.searchRows = rows;
        apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
        setApiRowsAttribute();
      }
      return;
    }
    if (kind === "job51search") {
      apiSnapshot.job51LastSearchRequest =
        request && typeof request === "object" ? request : null;
      mergeJob51AuthContext(requestHeaders, request);
      const total = getJob51TotalFromPayload(payload);
      if (typeof total === "number") {
        apiSnapshot.job51Total = total;
      }
      const rows = getJob51ResumeRows(payload);
      const hasResultPayload = Array.isArray(rows) || typeof total === "number";
      if (hasResultPayload) {
        apiSnapshot.job51SearchRows = Array.isArray(rows) ? rows : [];
        apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
        setApiRowsAttribute();
      }
      return;
    }
    if (kind === "job51detail") {
      mergeJob51AuthContext(requestHeaders, request);
      apiSnapshot.job51DetailPayload = payload || null;
      setApiRowsAttribute();
      return;
    }
    if (kind === "attach") {
      apiSnapshot.attachInfo = payload?.data?.attachResumeInfo || null;
      return;
    }
    if (kind === "chat") {
      apiSnapshot.chatInfo = payload?.data?.chatInfo || null;
      return;
    }
    if (kind === "insight") {
      apiSnapshot.insightInfo =
        payload?.data?.talentInsightInfo || payload?.data || null;
      return;
    }
    if (kind === "seekTalentSearch") {
      const data = getSeekPayloadData(payload, kind);
      const result = data?.talentSearchProfilesNaturalLanguageSearch?.result;
      const edges = Array.isArray(result?.edges) ? result.edges : null;
      if (edges) {
        // Unwrap Relay edges into bare nodes — downstream code expects an array
        // of candidate objects, same shape contract as seekRecommendedCandidates.
        const nodes = edges
          .map((edge) => edge?.node)
          .filter((node) => node && typeof node === "object");
        apiSnapshot.seekTalentSearch = nodes;
        apiSnapshot.seekTalentSearchRequest = request || null;
        apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
        setApiRowsAttribute();
      }
      return;
    }
    if (kind === "seekRecommendedCandidates") {
      const data = getSeekPayloadData(payload, kind);
      const candidates =
        data?.talentSearchRecommendedCandidatesV2?.items ||
        data?.getTalentSearchRecommendedCandidates?.candidates;
      if (Array.isArray(candidates)) {
        apiSnapshot.seekRecommendedCandidates = candidates;
        apiSnapshot.seekRecommendedRequest = request || null;
        apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
        setApiRowsAttribute();
      }
      return;
    }
    if (kind === "seekProfile") {
      const data = getSeekPayloadData(payload, kind);
      apiSnapshot.seekProfile =
        data?.talentSearchProfileV2 ||
        data?.talentSearchProfileCompleteV2 ||
        data?.getTalentSearchProfileCompleteV2 ||
        data?.talentSearchProfileV3 ||
        data ||
        null;
      apiSnapshot.seekProfileRequest =
        request ||
        apiSnapshot.seekProfileRequest ||
        apiSnapshot.seekRecommendedRequest ||
        null;
      setApiRowsAttribute();
      return;
    }
  }

  // ── collectSnapshotPayload ──

  /**
   * @param {{
   *   limit?: number;
   *   maxPages?: number;
   *   allowEmpty?: boolean;
   * } | null | undefined} [options]
   */
  async function collectSnapshotPayload(options = {}) {
    const { limit, maxPages, allowEmpty } =
      normalizeSnapshotCollectOptions(options);
    const sourceKey = getCurrentSourceKey();
    const job51BackfillRunId =
      sourceKey === SOURCE_KEYS.JOB51 ? pipelineState.runId + 1 : null;

    if (sourceKey === SOURCE_KEYS.JOB51) {
      pipelineState.runId = job51BackfillRunId;
      pipelineState.chain = Promise.resolve();
    }

    if (
      sourceKey !== SOURCE_KEYS.JOB5156 &&
      sourceKey !== SOURCE_KEYS.JOB51 &&
      sourceKey !== SOURCE_KEYS.SEEK
    ) {
      throw new Error(`Unsupported source for snapshot collection: ${sourceKey}`);
    }

    let collectedResumes = [];
    let pagesVisited = 0;
    let stopReason = "completed";
    let seekStartPage = null;
    let lastPageResumeCount = 0;
    let finalPagination;

    while (true) {
      finalPagination = getPaginationInfo();
      const currentPage = finalPagination.currentPage;
      const isSeekListPage =
        sourceKey === SOURCE_KEYS.SEEK && !isSeekProfileMode();
      if (isSeekListPage && seekStartPage === null) {
        seekStartPage = currentPage;
      }

      await waitForExtractionData({});
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

      const pageSelection = isSeekListPage
        ? resolveSeekAutoSyncCurrentPageSelection({
            limit,
            totalSubmitted: collectedResumes.length,
            currentPageResumeCount: getSeekCurrentCandidateCount(),
          })
        : {
            remainingCapacity:
              limit > 0 ? Math.max(limit - collectedResumes.length, 0) : null,
            selectedCount: null,
            hitLimitWithinPage: false,
            limitAlreadyReached:
              limit > 0
                ? Math.max(limit - collectedResumes.length, 0) <= 0
                : false,
          };

      if (pageSelection.limitAlreadyReached) {
        stopReason = "limit-reached";
        break;
      }

      let pageResumes = extractResumes();
      const hitLimitWithinPage = isSeekListPage
        ? pageSelection.hitLimitWithinPage
        : limit > 0 &&
          typeof pageSelection.remainingCapacity === "number" &&
          pageResumes.length > pageSelection.remainingCapacity;
      if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
        pageResumes = pageResumes.slice(0, pageSelection.selectedCount);
      } else if (
        limit > 0 &&
        typeof pageSelection.remainingCapacity === "number" &&
        pageResumes.length > pageSelection.remainingCapacity
      ) {
        pageResumes = pageResumes.slice(0, pageSelection.remainingCapacity);
      }

      if (
        sourceKey === SOURCE_KEYS.JOB51 &&
        !isJob51DetailPage() &&
        pageResumes.length > 0
      ) {
        pageResumes = await enrich51JobSearchResumesWithDetail(pageResumes);
      }
      if (
        sourceKey === SOURCE_KEYS.JOB5156 &&
        !isJob5156DetailPage() &&
        pageResumes.length > 0
      ) {
        pageResumes = await enrichJob5156SearchResumesWithDetail(pageResumes);
      }
      if (
        sourceKey === SOURCE_KEYS.SEEK &&
        !isSeekProfileMode() &&
        pageResumes.length > 0
      ) {
        pageResumes = await enrichSeekResumesWithDetail(pageResumes);
      }

      lastPageResumeCount = pageResumes.length;
      if (pageResumes.length > 0) {
        collectedResumes.push(...pageResumes);
      }

      finalPagination = getPaginationInfo();

      if (isSeekListPage && hitLimitWithinPage) {
        stopReason = "limit-reached";
        break;
      }
      if (
        isSeekListPage &&
        isSeekAutoSyncPageWindowReached(seekPageWindow, currentPage)
      ) {
        stopReason = "page-window-reached";
        break;
      }
      if (!isSeekListPage && limit > 0 && collectedResumes.length >= limit) {
        stopReason = "limit-reached";
        break;
      }
      if (!isSeekListPage && maxPages > 0 && pagesVisited >= maxPages) {
        stopReason = "max-pages-reached";
        break;
      }

      if (
        !finalPagination.hasNextPage ||
        finalPagination.currentPage >= finalPagination.totalPages
      ) {
        stopReason = "no-next-page";
        break;
      }

      try {
        await waitForPagination({ timeoutMs: 8000 });
      } catch {
        // Some layouts render pagination late or omit it on single-page results.
      }

      const nextPage = finalPagination.currentPage + 1;
      clearCapturedResultsForNextPage();
      const moved = goToNextPageInternal();
      if (!moved) {
        stopReason = "no-next-page";
        break;
      }

      await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
      await delay(500);
    }

    if (collectedResumes.length <= 0 && !allowEmpty) {
      throw new Error(
        "No resumes extracted. Ensure you are logged in and results are loaded.",
      );
    }

    const metadata = buildSubmitMetadata();
    metadata.generatedAt = new Date().toISOString();
    metadata.totalPages = pagesVisited;
    metadata.totalResumes = collectedResumes.length;

    return {
      metadata,
      resumes: collectedResumes,
      summary: {
        sourceKey,
        sourceHost: metadata.sourceHost,
        count: collectedResumes.length,
        pagesVisited,
        stopReason,
        lastPageResumeCount,
        limit: limit > 0 ? limit : null,
        maxPages: maxPages > 0 ? maxPages : null,
        pagination: finalPagination,
      },
    };
  }

  return {
    getApiSnapshotCount,
    updateApiSnapshot,
    installApiHook,
    normalizeSnapshotCollectOptions,
    collectSnapshotPayload,
  };
}
