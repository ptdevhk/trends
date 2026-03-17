(() => {
  const DEFAULT_PAGE_SIZE = 20;

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function normalizePositiveInt(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * @param {{
   *   requestedPageSize?: number | null;
   *   currentPageCandidateCount?: number | null;
   *   fallbackPageSize?: number | null;
   * }} [options]
   */
  function resolveSeekAutoSyncPageSize(options = {}) {
    const {
      requestedPageSize,
      currentPageCandidateCount,
      fallbackPageSize = DEFAULT_PAGE_SIZE,
    } = options;
    return normalizePositiveInt(requestedPageSize)
      || normalizePositiveInt(currentPageCandidateCount)
      || normalizePositiveInt(fallbackPageSize)
      || DEFAULT_PAGE_SIZE;
  }

  /**
   * @param {{
   *   startPage?: number | null;
   *   limit?: number | null;
   *   maxPages?: number | null;
   *   requestedPageSize?: number | null;
   *   currentPageCandidateCount?: number | null;
   *   fallbackPageSize?: number | null;
   * }} [options]
   */
  function resolveSeekAutoSyncPageWindow(options = {}) {
    const {
      startPage,
      limit,
      maxPages,
      requestedPageSize,
      currentPageCandidateCount,
      fallbackPageSize = DEFAULT_PAGE_SIZE,
    } = options;
    const normalizedStartPage = normalizePositiveInt(startPage) || 1;
    const normalizedLimit = normalizePositiveInt(limit);
    const normalizedMaxPages = normalizePositiveInt(maxPages);
    const effectivePageSize = resolveSeekAutoSyncPageSize({
      requestedPageSize,
      currentPageCandidateCount,
      fallbackPageSize,
    });
    const limitPageCount = normalizedLimit
      ? Math.max(1, Math.ceil(normalizedLimit / effectivePageSize))
      : null;

    let allowedPageCount = null;
    if (limitPageCount && normalizedMaxPages) {
      allowedPageCount = Math.min(limitPageCount, normalizedMaxPages);
    } else if (limitPageCount) {
      allowedPageCount = limitPageCount;
    } else if (normalizedMaxPages) {
      allowedPageCount = normalizedMaxPages;
    }

    return {
      startPage: normalizedStartPage,
      targetPageEnd: allowedPageCount
        ? normalizedStartPage + allowedPageCount - 1
        : null,
      effectivePageSize,
      limitPageCount,
      maxPages: normalizedMaxPages,
      allowedPageCount,
    };
  }

  /**
   * @param {{ currentPage?: number | null; targetPageEnd?: number | null }} [options]
   */
  function isSeekAutoSyncPageWindowReached(options = {}) {
    const { currentPage, targetPageEnd } = options;
    const normalizedCurrentPage = normalizePositiveInt(currentPage);
    const normalizedTargetPageEnd = normalizePositiveInt(targetPageEnd);
    return !!(normalizedCurrentPage && normalizedTargetPageEnd && normalizedCurrentPage >= normalizedTargetPageEnd);
  }

  /**
   * @param {{
   *   limit?: number | null;
   *   totalSubmitted?: number | null;
   *   currentPageResumeCount?: number | null;
   * }} [options]
   */
  function resolveSeekAutoSyncCurrentPageSelection(options = {}) {
    const {
      limit,
      totalSubmitted,
      currentPageResumeCount,
    } = options;
    const normalizedLimit = normalizePositiveInt(limit);
    const normalizedTotalSubmitted = normalizePositiveInt(totalSubmitted) || 0;
    const normalizedCurrentPageResumeCount = normalizePositiveInt(currentPageResumeCount) || 0;
    const remainingCapacity = normalizedLimit
      ? Math.max(normalizedLimit - normalizedTotalSubmitted, 0)
      : null;
    const selectedCount = remainingCapacity === null
      ? normalizedCurrentPageResumeCount
      : Math.min(normalizedCurrentPageResumeCount, remainingCapacity);

    return {
      remainingCapacity,
      selectedCount,
      hitLimitWithinPage: remainingCapacity !== null && normalizedCurrentPageResumeCount > remainingCapacity,
      limitAlreadyReached: remainingCapacity !== null && remainingCapacity <= 0,
    };
  }

  globalThis.__TR_SEEK_AUTO_SYNC__ = Object.freeze({
    DEFAULT_PAGE_SIZE,
    resolveSeekAutoSyncPageSize,
    resolveSeekAutoSyncPageWindow,
    isSeekAutoSyncPageWindowReached,
    resolveSeekAutoSyncCurrentPageSelection,
  });
})();
