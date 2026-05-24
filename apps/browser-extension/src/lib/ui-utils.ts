/**
 * UI/utility functions for export, auto-sync, and collection helpers.
 * All dependencies injected from content.ts via DI factory.
 */

export interface UiUtilsDeps extends Record<string, unknown> {
  win: Window;
  doc: Document;
  SOURCE_KEYS: Record<string, string>;
  AUTO_EXPORT_PARAM: string;
  AUTO_SYNC_PARAM: string;
  AUTO_LIMIT_PARAM: string;
  AUTO_MAX_PAGES_PARAM: string;
  AUTO_MIN_AGE_PARAM: string;
  AUTO_MAX_AGE_PARAM: string;
  AUTO_SEARCH_PARAM: string;
  AUTO_LOCATION_PARAM: string;
  SAMPLE_NAME_PARAM: string;
  KEYWORD_MODE_CONCAT: string;
  KEYWORD_MODE_SPACED: string;
  LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY: string;
  JOB5156_HOST: string;
  EHIRE_51JOB_HOST: string;
  SEEK_HOST_SUFFIX: string;
  getPaginationInfo: () => { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };
  makeRandomId: () => string;
  getExternalAccessorStatus: () => Record<string, unknown>;
  getAgeRangeFromUrl: (search: string, minParam: string, maxParam: string) => { enabled: boolean; minAge?: number; maxAge?: number };
  filterResumesByAgeRange: (resumes: unknown, search: string, minParam: string, maxParam: string) => unknown[];
  resolveJob51CollectionLimits: (limit: number, maxPages: number, search: string) => { limit: number; maxPages: number };
  resolveJob51DetailFetchDelayMs: (search: string) => number;
  resolveJob51AutoSyncDetailWaitMode: (search: string) => string;
  isJob51DetailPage: () => boolean;
  chrome: { runtime?: { getManifest?: () => { version: string }; sendMessage?: (message: unknown) => Promise<unknown> }; storage?: { local?: { get?: (defaults: unknown, cb: (items: unknown) => void) => void; set?: (items: unknown) => void } } };
}

export function createUiUtils(deps: UiUtilsDeps) {
  const {
    // Window/Document
    win,
    doc,

    // Constants
    SOURCE_KEYS,
    AUTO_EXPORT_PARAM,
    AUTO_SYNC_PARAM,
    AUTO_LIMIT_PARAM,
    AUTO_MAX_PAGES_PARAM,
    AUTO_MIN_AGE_PARAM,
    AUTO_MAX_AGE_PARAM,
    AUTO_SEARCH_PARAM,
    AUTO_LOCATION_PARAM,
    SAMPLE_NAME_PARAM,
    KEYWORD_MODE_CONCAT,
    KEYWORD_MODE_SPACED,
    LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY,
    JOB5156_HOST,
    EHIRE_51JOB_HOST,
    SEEK_HOST_SUFFIX,

    // Functions from other factories
    getPaginationInfo,
    makeRandomId,
    getExternalAccessorStatus,
    getAgeRangeFromUrl,
    filterResumesByAgeRange,
    resolveJob51CollectionLimits,
    resolveJob51DetailFetchDelayMs,
    resolveJob51AutoSyncDetailWaitMode,
    isJob51DetailPage,

    // External globals
    chrome,
  } = deps;

  // Module-level state for sync fingerprint dedup
  const lastPersistedAutoSyncSummaryFingerprintBySource = {};

  // ============================================================================
  // Export & Metadata Functions
  // ============================================================================

  function sanitizeSampleName(value) {
    if (!value) return "";
    return value
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 80);
  }

  /**
   * Normalize keyword for consistent handling
   * - Full-width space (U+3000) → half-width space (U+0020)
   * - Multiple spaces → single space
   * - Trim leading/trailing
   */
  function normalizeKeyword(keyword) {
    if (!keyword) return "";
    return keyword
      .replace(/[\u3000]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeKeywordMode(mode) {
    return mode === KEYWORD_MODE_SPACED
      ? KEYWORD_MODE_SPACED
      : KEYWORD_MODE_CONCAT;
  }

  function normalizeCollectionLimit(value) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function buildExportFilename() {
    const params = new URLSearchParams(win.location.search || "");
    const rawSampleName = params.get(SAMPLE_NAME_PARAM) || "";
    const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, "");
    const timestamp = new Date().toISOString().slice(0, 10);

    if (sampleName) return `${sampleName}.json`;

    const rawKeyword = params.get(AUTO_SEARCH_PARAM) || "";
    const keyword = sanitizeSampleName(normalizeKeyword(rawKeyword));
    if (keyword) return `sample-${keyword}-${timestamp}.json`;

    return `resumes_${timestamp}_${makeRandomId()}.json`;
  }

  function parseAutoLocationValues(locationRaw) {
    if (!locationRaw) return [];
    return Array.from(
      new Set(
        String(locationRaw)
          .split(/[，,、]+/)
          .map((location) => location.trim())
          .filter(Boolean),
      ),
    ).slice(0, 10);
  }

  function getAutoLocationValues(url) {
    return parseAutoLocationValues(
      url.searchParams.get(AUTO_LOCATION_PARAM) || "",
    );
  }

  function getExtensionGeneratedBy() {
    let generatedBy = "browser-extension";
    try {
      const version = chrome?.runtime?.getManifest?.().version;
      if (version) generatedBy = `browser-extension@${version}`;
    } catch {
      // ignore
    }
    return generatedBy;
  }

  function buildExportMetadata(resumes) {
    const url = new URL(win.location.href);
    const keyword = normalizeKeyword(
      url.searchParams.get(AUTO_SEARCH_PARAM) || "",
    );
    const locationArray = getAutoLocationValues(url);
    const rawSampleName = url.searchParams.get(SAMPLE_NAME_PARAM) || "";
    const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, "");

    url.searchParams.delete(AUTO_EXPORT_PARAM);
    url.searchParams.delete(AUTO_SYNC_PARAM);
    url.searchParams.delete(AUTO_LIMIT_PARAM);
    url.searchParams.delete(AUTO_MAX_PAGES_PARAM);
    url.searchParams.delete(SAMPLE_NAME_PARAM);

    const filters = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (key === AUTO_SEARCH_PARAM || key === AUTO_LOCATION_PARAM) continue;
      if (!value) continue;
      filters[key] = value;
    }

    const pagination = getPaginationInfo();
    const reproductionParams = new URLSearchParams();
    reproductionParams.set(AUTO_EXPORT_PARAM, "json");
    if (sampleName) reproductionParams.set(SAMPLE_NAME_PARAM, sampleName);

    return {
      sourceUrl: url.toString(),
      searchCriteria: {
        keyword,
        location: locationArray.length > 0 ? locationArray : "",
        filters: Object.keys(filters).length ? filters : {},
      },
      generatedAt: new Date().toISOString(),
      generatedBy: getExtensionGeneratedBy(),
      totalPages: pagination.totalPages,
      totalResumes: resumes.length,
      reproduction: `Navigate to sourceUrl, then add ?${reproductionParams.toString()}`,
    };
  }

  function getCurrentSourceKey() {
    const hostname = win.location.hostname.toLowerCase();
    if (hostname === JOB5156_HOST) return SOURCE_KEYS.JOB5156;
    if (hostname === EHIRE_51JOB_HOST) return SOURCE_KEYS.JOB51;
    if (hostname.endsWith(SEEK_HOST_SUFFIX)) return SOURCE_KEYS.SEEK;
    return SOURCE_KEYS.UNKNOWN;
  }

  // ============================================================================
  // Collection Helper Functions
  // ============================================================================

  function getCurrentLocationSearch() {
    return win.location.search || "";
  }

  function getCurrentAgeRange() {
    return getAgeRangeFromUrl(
      getCurrentLocationSearch(),
      AUTO_MIN_AGE_PARAM,
      AUTO_MAX_AGE_PARAM,
    );
  }

  function filterCurrentResumesByAgeRange(resumes) {
    if (
      getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
      !isJob51DetailPage() &&
      doc.documentElement.getAttribute("data-tr-auto-age") !== "done"
    ) {
      return Array.isArray(resumes) ? resumes : [];
    }
    return filterResumesByAgeRange(
      resumes,
      getCurrentLocationSearch(),
      AUTO_MIN_AGE_PARAM,
      AUTO_MAX_AGE_PARAM,
    );
  }

  function resolveCurrentJob51CollectionLimits(limit, maxPages) {
    return resolveJob51CollectionLimits(
      limit,
      maxPages,
      getCurrentLocationSearch(),
    );
  }

  function resolveCurrentJob51DetailFetchDelayMs() {
    return resolveJob51DetailFetchDelayMs(getCurrentLocationSearch());
  }

  function resolveCurrentJob51AutoSyncDetailWaitMode() {
    return resolveJob51AutoSyncDetailWaitMode(getCurrentLocationSearch());
  }

  // ============================================================================
  // Auto-Sync UI Functions
  // ============================================================================

  function setAutoSyncAttributes(status, count, pagesProcessed) {
    try {
      doc.documentElement.setAttribute("data-tr-auto-sync", status);
      if (typeof count === "number" && Number.isFinite(count)) {
        doc.documentElement.setAttribute(
          "data-tr-auto-sync-count",
          String(count),
        );
      } else {
        doc.documentElement.removeAttribute("data-tr-auto-sync-count");
      }
      if (typeof pagesProcessed === "number" && Number.isFinite(pagesProcessed)) {
        doc.documentElement.setAttribute(
          "data-tr-auto-sync-pages",
          String(pagesProcessed),
        );
      } else {
        doc.documentElement.removeAttribute("data-tr-auto-sync-pages");
      }
    } catch {
      // ignore
    }

    if (status && status !== "skipped") {
      persistLatestAutoSyncSummary();
    }
  }

  /**
   * @param {{
   *   limit?: number | null;
   *   totalSubmitted?: number | null;
   *   selectedCount?: number | null;
   *   ageHint?: string;
   * }} [options]
   */
  function buildAutoSyncProgressHint({
    limit = 0,
    totalSubmitted = 0,
    selectedCount = null,
    ageHint = "",
  }: { limit?: number | null; totalSubmitted?: number | null; selectedCount?: number | null; ageHint?: string } = {}) {
    const progressHint =
      limit > 0
        ? `\u5df2\u91c7\u96c6 ${Math.min(totalSubmitted, limit)}/${limit}`
        : `\u5df2\u91c7\u96c6 ${totalSubmitted}`;
    const selectedHint = buildAutoSyncSelectedCountHint({ selectedCount });

    return `${progressHint}${selectedHint}${ageHint}`;
  }

  /**
   * @param {{
   *   selectedCount?: number | null;
   *   prefix?: string;
   * }} [options]
   */
  function buildAutoSyncSelectedCountHint({
    selectedCount = null,
    prefix = " \u00b7 ",
  } = {}) {
    return typeof selectedCount === "number" && Number.isFinite(selectedCount)
      ? `${prefix}\u672c\u9875\u9009\u4e2d ${selectedCount} \u4efd`
      : "";
  }

  /**
   * @param {{
   *   totalInserted?: number | null;
   *   totalUpdated?: number | null;
   *   pagesVisited?: number | null;
   *   selectedCount?: number | null;
   * }} [options]
   */
  function buildAutoSyncCompletionHint({
    totalInserted = 0,
    totalUpdated = 0,
    pagesVisited = 0,
    selectedCount = null,
  } = {}) {
    return `${totalInserted} \u65b0\u589e, ${totalUpdated} \u66f4\u65b0, \u5171 ${pagesVisited} \u9875${buildAutoSyncSelectedCountHint(
      {
        selectedCount,
      },
    )}`;
  }

  function buildPersistedAutoSyncSummary(status = getExternalAccessorStatus()) {
    const autoSync = typeof status?.autoSync === "string" ? status.autoSync : "";
    if (!autoSync || autoSync === "skipped") {
      return null;
    }

    return {
      autoSync,
      autoSyncCount:
        typeof status?.autoSyncCount === "number" ? status.autoSyncCount : 0,
      autoSyncPages:
        typeof status?.autoSyncPages === "number" ? status.autoSyncPages : 0,
      autoSyncTargetPageStart: status?.autoSyncTargetPageStart ?? null,
      autoSyncTargetPageEnd: status?.autoSyncTargetPageEnd ?? null,
      autoSyncEffectivePageSize: status?.autoSyncEffectivePageSize ?? null,
      autoSyncSelectedCount: status?.autoSyncSelectedCount ?? null,
      autoSyncRemainingCapacity: status?.autoSyncRemainingCapacity ?? null,
      autoSyncStopReason: status?.autoSyncStopReason ?? null,
      sourceKey:
        typeof status?.sourceKey === "string"
          ? status.sourceKey
          : getCurrentSourceKey(),
      sourceUrl: win.location.href,
      summarySource: "stored",
      persistedAt: new Date().toISOString(),
    };
  }

  function persistLatestAutoSyncSummary() {
    try {
      if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.set) return;
      const summary = buildPersistedAutoSyncSummary();
      if (!summary) return;
      const sourceKey =
        typeof summary.sourceKey === "string" && summary.sourceKey
          ? summary.sourceKey
          : SOURCE_KEYS.UNKNOWN;

      const fingerprint = JSON.stringify({
        autoSync: summary.autoSync,
        autoSyncCount: summary.autoSyncCount,
        autoSyncPages: summary.autoSyncPages,
        autoSyncTargetPageStart: summary.autoSyncTargetPageStart,
        autoSyncTargetPageEnd: summary.autoSyncTargetPageEnd,
        autoSyncEffectivePageSize: summary.autoSyncEffectivePageSize,
        autoSyncSelectedCount: summary.autoSyncSelectedCount,
        autoSyncRemainingCapacity: summary.autoSyncRemainingCapacity,
        autoSyncStopReason: summary.autoSyncStopReason,
        sourceKey: summary.sourceKey,
        sourceUrl: summary.sourceUrl,
        summarySource: summary.summarySource,
      });

      if (
        summary.autoSync === "running" &&
        lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] === fingerprint
      ) {
        return;
      }

      lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] = fingerprint;
      chrome.storage.local.get(
        { [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY]: {} },
        (items) => {
          const existingSummaries =
            items?.[LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY];
          const nextSummaries =
            existingSummaries &&
            typeof existingSummaries === "object" &&
            !Array.isArray(existingSummaries)
              ? { ...existingSummaries }
              : {};
          nextSummaries[sourceKey] = summary;
          chrome.storage.local.set({
            [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY]: nextSummaries,
          });
        },
      );
    } catch (error) {
      console.warn(
        "\u{1F389} [Auto Sync] Failed to persist latest auto sync summary:",
        error,
      );
    }
  }

  // ============================================================================
  // Additional Utilities
  // ============================================================================

  function installReloadHelper() {
    try {
      if (globalThis.trReloadExtension) return;
      globalThis.trReloadExtension = async () => {
        try {
          const response = await chrome.runtime.sendMessage({
            action: "reloadExtension",
          });
          console.log("🎯 [DEV] Reload requested", response);
        } catch (error) {
          console.warn("🎯 [DEV] Reload failed:", error);
        }
      };
      console.log(
        '🎯 [DEV] Use trReloadExtension() in the DevTools "Content scripts" context to reload the extension',
      );
    } catch (error) {
      console.warn("🎯 [DEV] Failed to install reload helper:", error);
    }
  }

  function isLoggedIn() {
    return doc.querySelector('.login-btn, [href*="login"]') === null;
  }

  // ============================================================================
  // Exports
  // ============================================================================

  return {
    // Export & Metadata
    sanitizeSampleName,
    normalizeKeyword,
    normalizeKeywordMode,
    normalizeCollectionLimit,
    buildExportFilename,
    buildExportMetadata,
    getCurrentSourceKey,
    getExtensionGeneratedBy,
    parseAutoLocationValues,
    getAutoLocationValues,
    // Collection Helpers
    getCurrentLocationSearch,
    getCurrentAgeRange,
    filterCurrentResumesByAgeRange,
    resolveCurrentJob51CollectionLimits,
    resolveCurrentJob51DetailFetchDelayMs,
    resolveCurrentJob51AutoSyncDetailWaitMode,
    // Auto-Sync UI
    setAutoSyncAttributes,
    buildAutoSyncProgressHint,
    buildAutoSyncSelectedCountHint,
    buildAutoSyncCompletionHint,
    buildPersistedAutoSyncSummary,
    persistLatestAutoSyncSummary,
    // Additional Utilities
    installReloadHelper,
    isLoggedIn,
  };
}
