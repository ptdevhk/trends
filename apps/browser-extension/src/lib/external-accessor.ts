// @ts-nocheck
/**
 * External CDP accessor — exposes content script functions via window.__TR_RESUME_DATA__
 * for CDP automation and testing.
 */

export function getExternalAccessorStatus(deps) {
  const {
    getExtensionVersion,
    getPaginationInfo,
    getCurrentAgeRange,
    getCurrentSourceKey,
    getApiSnapshotCount,
    getSeekCardCount,
    SOURCE_KEYS,
    isExtractionReady,
    isLoggedIn,
    apiSnapshot,
    SELECTORS,
    isJob5156DetailPage,
    isJob5156DetailReady,
  } = deps;
  const version = getExtensionVersion();
  const pagination = getPaginationInfo();
  const ageRange = getCurrentAgeRange();
  const sourceKey = getCurrentSourceKey();
  const apiSnapshotCount = getApiSnapshotCount();
  const cardCount =
    sourceKey === SOURCE_KEYS.SEEK
      ? Math.max(apiSnapshotCount, getSeekCardCount())
      : sourceKey === SOURCE_KEYS.JOB51
        ? apiSnapshotCount
        : isJob5156DetailPage()
          ? isJob5156DetailReady()
            ? 1
            : 0
          : document.querySelectorAll(SELECTORS.resumeCard).length;
  const autoSearch =
    document.documentElement.getAttribute("data-tr-auto-search") || "";
  const autoLocation =
    document.documentElement.getAttribute("data-tr-auto-location") || "";
  const autoAge =
    document.documentElement.getAttribute("data-tr-auto-age") || "";
  const autoExport =
    document.documentElement.getAttribute("data-tr-auto-export") || "";
  const autoSync =
    document.documentElement.getAttribute("data-tr-auto-sync") || "";
  const autoSyncCountRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-count") || "";
  const autoSyncPagesRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-pages") || "";
  const autoSyncTargetStartRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-target-start") ||
    "";
  const autoSyncTargetEndRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-target-end") || "";
  const autoSyncEffectivePageSizeRaw =
    document.documentElement.getAttribute(
      "data-tr-auto-sync-effective-page-size",
    ) || "";
  const autoSyncSelectedCountRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-selected-count") ||
    "";
  const autoSyncRemainingCapacityRaw =
    document.documentElement.getAttribute(
      "data-tr-auto-sync-remaining-capacity",
    ) || "";
  const autoSyncStopReason =
    document.documentElement.getAttribute("data-tr-auto-sync-stop-reason") ||
    "";
  const autoSyncCount = Number.parseInt(autoSyncCountRaw, 10);
  const autoSyncPages = Number.parseInt(autoSyncPagesRaw, 10);
  const autoSyncTargetStart = Number.parseInt(autoSyncTargetStartRaw, 10);
  const autoSyncTargetEnd = Number.parseInt(autoSyncTargetEndRaw, 10);
  const autoSyncEffectivePageSize = Number.parseInt(
    autoSyncEffectivePageSizeRaw,
    10,
  );
  const autoSyncSelectedCount = Number.parseInt(autoSyncSelectedCountRaw, 10);
  const autoSyncRemainingCapacity = Number.parseInt(
    autoSyncRemainingCapacityRaw,
    10,
  );

  return {
    extensionLoaded: true,
    extensionVersion: version,
    sourceKey,
    apiSnapshotCount,
    domReady: isExtractionReady(),
    loggedIn: isLoggedIn(),
    ageRange: ageRange.enabled
      ? {
          minAge: typeof ageRange.minAge === "number" ? ageRange.minAge : null,
          maxAge: typeof ageRange.maxAge === "number" ? ageRange.maxAge : null,
        }
      : null,
    cardCount,
    autoSearch,
    autoLocation,
    autoAge,
    autoExport,
    autoSync,
    autoSyncCount: Number.isFinite(autoSyncCount) ? autoSyncCount : 0,
    autoSyncPages: Number.isFinite(autoSyncPages) ? autoSyncPages : 0,
    autoSyncTargetPageStart: Number.isFinite(autoSyncTargetStart)
      ? autoSyncTargetStart
      : null,
    autoSyncTargetPageEnd: Number.isFinite(autoSyncTargetEnd)
      ? autoSyncTargetEnd
      : null,
    autoSyncEffectivePageSize: Number.isFinite(autoSyncEffectivePageSize)
      ? autoSyncEffectivePageSize
      : null,
    autoSyncSelectedCount: Number.isFinite(autoSyncSelectedCount)
      ? autoSyncSelectedCount
      : null,
    autoSyncRemainingCapacity: Number.isFinite(autoSyncRemainingCapacity)
      ? autoSyncRemainingCapacity
      : null,
    autoSyncStopReason: autoSyncStopReason || null,
    pagination,
    lastOperationName: apiSnapshot.lastOperationName,
    timestamp: new Date().toISOString(),
  };
}

export function installExternalAccessor(key, deps) {
  try {
    const {
      extractResumes,
      extractResumesRaw,
      collectSnapshotPayload,
      apiSnapshot,
      getPaginationInfo,
      isExtractionReady,
      isLoggedIn,
      getExternalAccessorStatus,
      syncToServer,
      goToNextPageInternal,
      version,
    } = deps;
    window[key] = {
      extract: () => extractResumes(),
      extractRaw: (options) => extractResumesRaw(options),
      collect: (options) => collectSnapshotPayload(options),
      getApiSnapshot: () => apiSnapshot,
      getPaginationInfo: () => getPaginationInfo(),
      isReady: () => isExtractionReady(),
      isLoggedIn: () => isLoggedIn(),
      status: () => getExternalAccessorStatus(),
      syncToServer: () => syncToServer(),
      version,
      goToNextPage: () => goToNextPageInternal(),
    };
  } catch (error) {
    console.warn("🎯 [External Access] Failed to install accessor:", error);
  }
}
