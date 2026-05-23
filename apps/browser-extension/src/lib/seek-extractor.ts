// @ts-nocheck
/**
 * Seek-specific resume extraction utilities — page detection, snapshot query,
 * URL building, and auto-sync helpers. All dependencies injected from content.ts.
 */

export function createSeekExtractor(deps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    normalizeOptionalPositiveInt,
    DEFAULT_SEEK_PAGE_SIZE,
    SEEK_PROFILE_TYPE,
    persistLatestAutoSyncSummary,
  } = deps;

  function isSeekProfilePage() {
    return window.location.pathname.includes("/talentsearch/profile/");
  }

  function isSeekTalentSearchListPage() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    const { pathname, search } = window.location;
    if (pathname.includes("/talentsearch/profile/")) return false;
    return pathname === "/talentsearch" && search.length > 0;
  }

  function getCurrentSeekMode() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return null;
    if (isSeekProfilePage()) return "profile";
    if (isSeekTalentSearchListPage()) return "talentsearch";
    if (window.location.pathname.includes("/candidates/recommended")) return "recommended";
    return null;
  }

  function isSeekInlineProfileMode() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    if (!window.location.pathname.includes("/candidates/recommended")) return false;
    const openProfileId = normalizeOptionalPositiveInt(
      new URL(window.location.href).searchParams.get("openProfileId"),
    );
    return openProfileId !== null && hasSeekProfileSnapshot();
  }

  function isSeekProfileMode() {
    return isSeekProfilePage() || isSeekInlineProfileMode();
  }

  function hasSeekProfileSnapshot() {
    return !!(
      apiSnapshot.seekProfile && typeof apiSnapshot.seekProfile === "object"
    );
  }

  function hasSeekListSnapshot() {
    return Array.isArray(apiSnapshot.seekRecommendedCandidates);
  }

  function hasSeekTalentSearchSnapshot() {
    return Array.isArray(apiSnapshot.seekTalentSearch);
  }

  function getSeekSnapshotCount() {
    if (isSeekProfileMode()) {
      return hasSeekProfileSnapshot() ? 1 : 0;
    }
    if (hasSeekTalentSearchSnapshot()) {
      return apiSnapshot.seekTalentSearch.length;
    }
    return hasSeekListSnapshot()
      ? apiSnapshot.seekRecommendedCandidates.length
      : 0;
  }

  function isSeekSnapshotReady() {
    return getSeekSnapshotCount() > 0;
  }

  function getSeekCandidateIdentity(candidate) {
    const profileId =
      candidate?.profileId != null ? String(candidate.profileId) : "";
    return {
      profileId,
      profileType:
        typeof candidate?.profileType === "string"
          ? candidate.profileType
          : SEEK_PROFILE_TYPE,
    };
  }

  function buildSeekProfileUrl(profileId, jobId) {
    if (!profileId) return "";
    const hostname = window.location.hostname.toLowerCase();
    if (jobId) {
      return `https://${hostname}/candidates/recommended?jobId=${encodeURIComponent(jobId)}&openProfileId=${encodeURIComponent(profileId)}`;
    }
    return `https://${hostname}/candidates/${encodeURIComponent(profileId)}`;
  }

  function buildSeekNameSearchUrl(name, market, roleTitles) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) return "";
    const trimmedRoleTitles = typeof roleTitles === "string" ? roleTitles.trim() : "";
    const roleTitlesParam = trimmedRoleTitles ? `&roleTitles=${encodeURIComponent(trimmedRoleTitles)}` : "";
    return `https://${window.location.hostname.toLowerCase()}/talentsearch/profiles/search?searchQuery=${encodeURIComponent(trimmed)}&market=${encodeURIComponent(market || "MY")}&pageNumber=1${roleTitlesParam}`;
  }

  function normalizeSeekLocationLabel(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\bmalaysia\b/g, "")
      .replace(/\bmy\b/g, "")
      .replace(/[，,、]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function restoreSeekSearchParams() {
    try {
      const initialUrlStr = sessionStorage.getItem("tr_auto_sync_initial_url");
      if (!initialUrlStr) return;
      const currentUrl = new URL(window.location.href);
      const initialUrl = new URL(initialUrlStr);
      const seekParams = ["keywords", "roleTitles", "matchAll", "tr_max_age"];
      let changed = false;
      for (const p of seekParams) {
        const initialVal = initialUrl.searchParams.get(p);
        if (initialVal !== null && !currentUrl.searchParams.has(p)) {
          currentUrl.searchParams.set(p, initialVal);
          changed = true;
        }
      }
      if (changed) {
        history.replaceState(null, "", currentUrl.toString());
      }
    } catch {
      // Best-effort — if restore fails, the page still works with stripped params.
    }
  }

  function getSeekRecommendedRequest() {
    return apiSnapshot.seekRecommendedRequest;
  }

  function getSeekTalentSearchRequest() {
    return apiSnapshot.seekTalentSearchRequest;
  }

  function getSeekProfileRequest() {
    return apiSnapshot.seekProfileRequest || apiSnapshot.seekRecommendedRequest;
  }

  function getSeekAutoSyncHelpers() {
    const helpers = globalThis.__TR_SEEK_AUTO_SYNC__;
    return helpers && typeof helpers === "object" ? helpers : null;
  }

  function resolveSeekAutoSyncPageSize(options = {}) {
    const { requestedPageSize, currentPageCandidateCount, fallbackPageSize = DEFAULT_SEEK_PAGE_SIZE } = options;
    const helpers = getSeekAutoSyncHelpers();
    if (typeof helpers?.resolveSeekAutoSyncPageSize === "function") {
      return helpers.resolveSeekAutoSyncPageSize({ requestedPageSize, currentPageCandidateCount, fallbackPageSize });
    }
    return (
      normalizeOptionalPositiveInt(requestedPageSize) ||
      normalizeOptionalPositiveInt(currentPageCandidateCount) ||
      normalizeOptionalPositiveInt(fallbackPageSize) ||
      DEFAULT_SEEK_PAGE_SIZE
    );
  }

  function resolveSeekAutoSyncPageWindow(options = {}) {
    const { startPage, limit, maxPages, requestedPageSize, currentPageCandidateCount } = options;
    const helpers = getSeekAutoSyncHelpers();
    if (typeof helpers?.resolveSeekAutoSyncPageWindow === "function") {
      return helpers.resolveSeekAutoSyncPageWindow({ startPage, limit, maxPages, requestedPageSize, currentPageCandidateCount, fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE });
    }
    const normalizedStartPage = normalizeOptionalPositiveInt(startPage) || 1;
    const normalizedLimit = normalizeOptionalPositiveInt(limit);
    const normalizedMaxPages = normalizeOptionalPositiveInt(maxPages);
    const effectivePageSize = resolveSeekAutoSyncPageSize({ requestedPageSize, currentPageCandidateCount, fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE });
    const limitPageCount = normalizedLimit ? Math.max(1, Math.ceil(normalizedLimit / effectivePageSize)) : null;
    let allowedPageCount = null;
    if (limitPageCount && normalizedMaxPages) {
      allowedPageCount = Math.min(limitPageCount, normalizedMaxPages);
    } else if (limitPageCount) {
      allowedPageCount = limitPageCount;
    } else if (normalizedMaxPages) {
      allowedPageCount = normalizedMaxPages;
    }
    return { startPage: normalizedStartPage, targetPageEnd: allowedPageCount ? normalizedStartPage + allowedPageCount - 1 : null, effectivePageSize, limitPageCount, maxPages: normalizedMaxPages, allowedPageCount };
  }

  function isSeekAutoSyncPageWindowReached(pageWindow, currentPage) {
    const helpers = getSeekAutoSyncHelpers();
    if (typeof helpers?.isSeekAutoSyncPageWindowReached === "function") {
      return helpers.isSeekAutoSyncPageWindowReached({ currentPage, targetPageEnd: pageWindow?.targetPageEnd });
    }
    const normalizedCurrentPage = normalizeOptionalPositiveInt(currentPage);
    const targetPageEnd = normalizeOptionalPositiveInt(pageWindow?.targetPageEnd);
    return !!(normalizedCurrentPage && targetPageEnd && normalizedCurrentPage >= targetPageEnd);
  }

  function resolveSeekAutoSyncCurrentPageSelection(options = {}) {
    const helpers = getSeekAutoSyncHelpers();
    if (typeof helpers?.resolveSeekAutoSyncCurrentPageSelection === "function") {
      return helpers.resolveSeekAutoSyncCurrentPageSelection(options);
    }
    const normalizedLimit = normalizeOptionalPositiveInt(options.limit);
    const normalizedTotalSubmitted = normalizeOptionalPositiveInt(options.totalSubmitted) || 0;
    const normalizedCurrentPageResumeCount = normalizeOptionalPositiveInt(options.currentPageResumeCount) || 0;
    const remainingCapacity = normalizedLimit ? Math.max(normalizedLimit - normalizedTotalSubmitted, 0) : null;
    const selectedCount = remainingCapacity === null ? normalizedCurrentPageResumeCount : Math.min(normalizedCurrentPageResumeCount, remainingCapacity);
    return { remainingCapacity, selectedCount, hitLimitWithinPage: remainingCapacity !== null && normalizedCurrentPageResumeCount > remainingCapacity, limitAlreadyReached: remainingCapacity !== null && remainingCapacity <= 0 };
  }

  function getSeekRequestedPageSize() {
    const requestInput = getSeekRecommendedRequest()?.variables?.input;
    return normalizeOptionalPositiveInt(requestInput?.size);
  }

  function getSeekCurrentCandidateCount() {
    if (getCurrentSeekMode() === "talentsearch") {
      return Array.isArray(apiSnapshot.seekTalentSearch) ? apiSnapshot.seekTalentSearch.length : 0;
    }
    return Array.isArray(apiSnapshot.seekRecommendedCandidates) ? apiSnapshot.seekRecommendedCandidates.length : 0;
  }

  function setSeekAutoSyncWindowAttributes(pageWindow) {
    const attrs = [
      ["data-tr-auto-sync-target-start", pageWindow?.startPage],
      ["data-tr-auto-sync-target-end", pageWindow?.targetPageEnd],
      ["data-tr-auto-sync-effective-page-size", pageWindow?.effectivePageSize],
    ];
    try {
      for (const [name, value] of attrs) {
        if (typeof value === "number" && Number.isFinite(value)) {
          document.documentElement.setAttribute(name, String(value));
        } else {
          document.documentElement.removeAttribute(name);
        }
      }
    } catch { /* ignore */ }
    persistLatestAutoSyncSummary();
  }

  function setSeekAutoSyncSelectionAttributes(selection) {
    const attrs = [
      ["data-tr-auto-sync-selected-count", selection?.selectedCount],
      ["data-tr-auto-sync-remaining-capacity", selection?.remainingCapacity],
    ];
    try {
      for (const [name, value] of attrs) {
        if (typeof value === "number" && Number.isFinite(value)) {
          document.documentElement.setAttribute(name, String(value));
        } else {
          document.documentElement.removeAttribute(name);
        }
      }
    } catch { /* ignore */ }
    persistLatestAutoSyncSummary();
  }

  function findSeekProfileTrigger(profileId) {
    if (!profileId) return null;
    const candidateLinks = Array.from(document.querySelectorAll("a[href]"));
    return candidateLinks.find((link) => {
      const href = link.getAttribute("href") || "";
      return (
        href.includes(`/talentsearch/profile/${encodeURIComponent(profileId)}`) ||
        href.includes(`openProfileId=${encodeURIComponent(profileId)}`)
      );
    }) || null;
  }

  return {
    isSeekProfilePage,
    isSeekTalentSearchListPage,
    getCurrentSeekMode,
    isSeekInlineProfileMode,
    isSeekProfileMode,
    hasSeekProfileSnapshot,
    hasSeekListSnapshot,
    hasSeekTalentSearchSnapshot,
    getSeekSnapshotCount,
    isSeekSnapshotReady,
    getSeekCandidateIdentity,
    buildSeekProfileUrl,
    buildSeekNameSearchUrl,
    normalizeSeekLocationLabel,
    restoreSeekSearchParams,
    getSeekRecommendedRequest,
    getSeekTalentSearchRequest,
    getSeekProfileRequest,
    getSeekAutoSyncHelpers,
    resolveSeekAutoSyncPageSize,
    resolveSeekAutoSyncPageWindow,
    isSeekAutoSyncPageWindowReached,
    resolveSeekAutoSyncCurrentPageSelection,
    getSeekRequestedPageSize,
    getSeekCurrentCandidateCount,
    setSeekAutoSyncWindowAttributes,
    setSeekAutoSyncSelectionAttributes,
    findSeekProfileTrigger,
  };
}
