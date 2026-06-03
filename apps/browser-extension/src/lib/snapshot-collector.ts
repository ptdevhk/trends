/**
 * Snapshot collector — API state management, message hook installation,
 * and snapshot payload collection. Dependencies injected from content.ts.
 */

export interface SnapshotCollectorDeps extends Record<string, unknown> {
  apiSnapshot: Record<string, unknown>;
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  isJob51DetailPage: () => boolean;
  isJob51DetailReady: () => boolean;
  getSeekSnapshotCount: () => number;
  normalizeJob51AuthContext: (headers: unknown, request: unknown) => Record<string, unknown> | null;
  getJob51TotalFromPayload: (payload: unknown) => number | null;
  getJob51ResumeRows: (payload: unknown) => unknown[];
  getSeekPayloadData: (payload: unknown, kind: string) => Record<string, unknown> | null;
  chrome: Record<string, unknown>;
  normalizeCollectionLimit: (value: unknown) => number;
  pipelineState: Record<string, unknown>;
  waitForExtractionData: (options?: unknown) => Promise<unknown>;
  isSeekProfileMode: () => boolean;
  resolveSeekAutoSyncPageWindow: (options: Record<string, unknown>) => unknown;
  getSeekRequestedPageSize: () => number;
  getSeekCurrentCandidateCount: () => number;
  resolveSeekAutoSyncCurrentPageSelection: (options: Record<string, unknown>) => Record<string, unknown>;
  extractResumes: () => unknown[];
  enrich51JobSearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  enrichJob5156SearchResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  isJob5156DetailPage: () => boolean;
  enrichSeekResumesWithDetail: (resumes: unknown[]) => Promise<unknown[]>;
  getPaginationInfo: () => { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };
  loadCollectionGuards: () => Promise<Record<string, unknown>>;
  parseGuardFieldNames: (csv: string) => string[];
  applyCollectionGuards: (resume: unknown, fields: string[]) => unknown;
  isSeekAutoSyncPageWindowReached: (pageWindow: unknown, currentPage: number) => boolean;
  waitForPagination: (options?: unknown) => Promise<unknown>;
  clearCapturedResultsForNextPage: () => void;
  goToNextPageInternal: () => unknown;
  waitForPageTransition: (options: Record<string, unknown>) => Promise<unknown>;
  buildSubmitMetadata: (options?: unknown) => Record<string, unknown>;
  delay: (ms: number) => Promise<void>;
  document: Document;
}

export function createSnapshotCollector(deps: SnapshotCollectorDeps) {
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
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards,
  } = deps;

  // ── getApiSnapshotCount ──

  function getApiSnapshotCount() {
    if (Array.isArray(apiSnapshot.searchRows)) {
      return (apiSnapshot.searchRows as unknown[]).length;
    }
    if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
      if (isJob51DetailPage()) {
        return isJob51DetailReady() ? 1 : 0;
      }
      return Array.isArray(apiSnapshot.job51SearchRows)
        ? (apiSnapshot.job51SearchRows as unknown[]).length
        : 0;
    }
    if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
      return getSeekSnapshotCount();
    }
    return 0;
  }

  // ── normalizeSnapshotCollectOptions ──

  function normalizeSnapshotCollectOptions(options: Record<string, unknown> = {}) {
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
      const script = doc.createElement("script") as HTMLScriptElement;
      script.src = (chrome as { runtime: { getURL: (path: string) => string } }).runtime.getURL("page-hook.js");
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

  function mergeJob51AuthContext(requestHeaders: unknown, request: unknown) {
    const authContext = normalizeJob51AuthContext(requestHeaders, request);
    if (authContext) {
      apiSnapshot.job51AuthContext = {
        ...((apiSnapshot.job51AuthContext || {}) as Record<string, unknown>),
        ...authContext,
      };
    }
  }

  function updateApiSnapshot(message: Record<string, unknown>) {
    const {
      kind,
      payload,
      url,
      sourceKey,
      operationName,
      request,
      requestHeaders,
    } = message;
    const p = (payload ?? {}) as Record<string, unknown>;
    const pd = (p.data ?? {}) as Record<string, unknown>;
    apiSnapshot.lastUpdatedAt = new Date().toISOString();
    if (url) apiSnapshot.lastUrl = url as string;
    apiSnapshot.lastSourceKey = sourceKey as string || null;
    apiSnapshot.lastOperationName = operationName as string || null;

    try {
      doc.documentElement.setAttribute("data-tr-api-last", kind as string);
      doc.documentElement.setAttribute(
        "data-tr-api-updated",
        apiSnapshot.lastUpdatedAt as string,
      );
      if (sourceKey) {
        doc.documentElement.setAttribute("data-tr-source-key", sourceKey as string);
      }
    } catch {
      // ignore
    }

    if (kind === "search") {
      const rows = ((pd.resumePage ?? {}) as Record<string, unknown>)?.rows;
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
      apiSnapshot.attachInfo = pd.attachResumeInfo || null;
      return;
    }
    if (kind === "chat") {
      apiSnapshot.chatInfo = pd.chatInfo || null;
      return;
    }
    if (kind === "insight") {
      apiSnapshot.insightInfo =
        pd.talentInsightInfo || p.data || null;
      return;
    }
    if (kind === "seekTalentSearch") {
      const data = getSeekPayloadData(payload, kind);
      const tsResult = data?.talentSearchProfilesNaturalLanguageSearch as Record<string, unknown> | undefined;
      const result = tsResult?.result as Record<string, unknown> | undefined;
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
      const v2 = data?.talentSearchRecommendedCandidatesV2 as Record<string, unknown> | undefined;
      const legacy = data?.getTalentSearchRecommendedCandidates as Record<string, unknown> | undefined;
      const candidates =
        v2?.items ||
        legacy?.candidates;
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

  async function applySourceCollectionGuards(resumes: unknown[], sourceKey: string): Promise<unknown[]> {
    if (!Array.isArray(resumes) || resumes.length === 0) return resumes;
    if (
      sourceKey !== SOURCE_KEYS.JOB51 &&
      sourceKey !== SOURCE_KEYS.JOB5156 &&
      sourceKey !== SOURCE_KEYS.SEEK
    ) {
      return resumes;
    }
    const collectionGuards = await loadCollectionGuards();
    const guards =
      collectionGuards && typeof collectionGuards === "object"
        ? (collectionGuards as Record<string, unknown>)[sourceKey]
        : undefined;
    const guardFields = parseGuardFieldNames(typeof guards === "string" ? guards : "");
    if (guardFields.length === 0) return resumes;
    return resumes.map((resume) => applyCollectionGuards(resume, guardFields));
  }

  /**
   * @param {{
   *   limit?: number;
   *   maxPages?: number;
   *   allowEmpty?: boolean;
   * } | null | undefined} [options]
   */
  async function collectSnapshotPayload(options: Record<string, unknown> = {}) {
    const { limit, maxPages, allowEmpty } =
      normalizeSnapshotCollectOptions(options);
    const sourceKey = getCurrentSourceKey();
    const job51BackfillRunId =
      sourceKey === SOURCE_KEYS.JOB51 ? (pipelineState.runId as number) + 1 : null;

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

    let collectedResumes: unknown[] = [];
    let pagesVisited = 0;
    let stopReason = "completed";
    let seekStartPage: number | null = null;
    let lastPageResumeCount = 0;
    let finalPagination: { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };

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

      if (pageSelection.limitAlreadyReached as boolean) {
        stopReason = "limit-reached";
        break;
      }

      let pageResumes = extractResumes();
      const hitLimitWithinPage = isSeekListPage
        ? pageSelection.hitLimitWithinPage as boolean
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

      pageResumes = await applySourceCollectionGuards(pageResumes, sourceKey);

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
        sourceHost: metadata.sourceHost as string,
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
