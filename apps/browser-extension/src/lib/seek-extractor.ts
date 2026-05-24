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
    // Extraction function deps
    win,
    doc,
    buildSeekWorkHistoryItem,
    buildSeekProfileEducationItem,
    formatSeekExpectedSalary,
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

  // ============================================================================
  // Extraction Functions
  // ============================================================================

  function extractSeekProfileResume() {
    const profile = apiSnapshot.seekProfile;
    if (!profile || typeof profile !== "object") return [];

    const request = getSeekProfileRequest();
    const requestInput = request?.variables?.input;
    const language = request?.variables?.language;
    const profileUrl = new URL(win.location.href);
    const jobIdFromUrl = normalizeOptionalPositiveInt(
      profileUrl.searchParams.get("jobId"),
    );
    const jobId =
      requestInput?.jobId != null
        ? String(requestInput.jobId)
        : jobIdFromUrl != null
          ? String(jobIdFromUrl)
          : undefined;
    const { profileId, profileType } = getSeekCandidateIdentity(profile);
    const seekProfileGuid =
      typeof profile.profileGuid === "string" && profile.profileGuid
        ? profile.profileGuid
        : undefined;
    const firstName =
      typeof profile.firstName === "string" ? profile.firstName.trim() : "";
    const lastName =
      typeof profile.lastName === "string" ? profile.lastName.trim() : "";
    const currentJobTitle =
      typeof profile.currentJobTitle === "string"
        ? profile.currentJobTitle.trim()
        : "";
    const currentLocation =
      typeof profile.currentLocation === "string"
        ? profile.currentLocation.trim()
        : "";
    const lastModifiedDate =
      typeof profile.lastModifiedDate === "string"
        ? profile.lastModifiedDate
        : "";
    const workHistory = Array.isArray(profile.workHistories)
      ? profile.workHistories
          .map((item) => buildSeekWorkHistoryItem(item))
          .filter(Boolean)
      : [];
    const profileEducation = Array.isArray(profile.profileEducation)
      ? profile.profileEducation
          .map((item) => buildSeekProfileEducationItem(item))
          .filter(Boolean)
      : [];
    const licences = Array.isArray(profile.licences)
      ? profile.licences
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const name = typeof item.name === "string" ? item.name.trim() : "";
            const authority =
              typeof item.issuingOrganisationName === "string"
                ? item.issuingOrganisationName.trim()
                : "";
            if (!name && !authority) return null;
            return { name, authority: authority || undefined };
          })
          .filter(Boolean)
      : [];
    const skills = Array.isArray(profile.skills)
      ? profile.skills.filter((item) => typeof item === "string" && item.trim())
      : [];
    const languages = Array.isArray(profile.languages)
      ? profile.languages.filter(
          (item) => typeof item === "string" && item.trim(),
        )
      : [];
    const resumeSnippet =
      typeof profile.resumeSnippet === "string"
        ? profile.resumeSnippet.trim()
        : "";
    const currentIndustry =
      typeof profile.currentIndustry === "string"
        ? profile.currentIndustry.trim()
        : "";
    const currentSubindustry =
      typeof profile.currentSubindustry === "string"
        ? profile.currentSubindustry.trim()
        : "";
    const rightToWork =
      typeof profile.rightToWork?.label === "string"
        ? profile.rightToWork.label.trim()
        : "";
    const education = profileEducation[0]?.qualification || "";
    const pageNumber =
      normalizeOptionalPositiveInt(profileUrl.searchParams.get("pageNumber")) ||
      1;

    return [
      {
        profileId,
        profileType,
        seekProfileGuid,
        externalId: profileId
          ? `${win.location.hostname.toLowerCase()}:profile:${profileId}`
          : "",
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        profileUrl: buildSeekProfileUrl(profileId, jobId),
        activityStatus: lastModifiedDate,
        age: "",
        experience: "",
        education,
        location: currentLocation,
        jobIntention: currentJobTitle,
        expectedSalary: formatSeekExpectedSalary(profile.salary?.expected),
        selfIntro: resumeSnippet,
        workHistory,
        profileEducation:
          profileEducation.length > 0 ? profileEducation : undefined,
        skills: skills.length > 0 ? skills : undefined,
        languages: languages.length > 0 ? languages : undefined,
        licences: licences.length > 0 ? licences : undefined,
        resumeSnippet: resumeSnippet || undefined,
        currentIndustry: currentIndustry || undefined,
        currentSubindustry: currentSubindustry || undefined,
        rightToWork: rightToWork || undefined,
        noticePeriodDays: Number.isFinite(profile.noticePeriodDays)
          ? profile.noticePeriodDays
          : undefined,
        extractedAt: new Date().toISOString(),
        pageIndex: 1,
        source: win.location.hostname.toLowerCase(),
        searchProfileId:
          typeof requestInput?.searchId === "string"
            ? requestInput.searchId
            : "",
        language: typeof language === "string" ? language : "",
        pageNumber,
      },
    ];
  }

  function buildSeekCollectionContext(options = {}) {
    /** @type {{ captureModeOverride?: string }} */
    const normalizedOptions =
      typeof options === "object" && options ? options : {};
    const captureModeOverride = normalizedOptions.captureModeOverride;
    const seekMode = getCurrentSeekMode();
    const isTalentSearchList = seekMode === "talentsearch";
    const useProfileMode = captureModeOverride
      ? captureModeOverride === "graphql-profile"
      : isSeekProfileMode();
    const talentSearchRequest = isTalentSearchList
      ? apiSnapshot.seekTalentSearchRequest
      : null;
    const request = talentSearchRequest ??
      (useProfileMode
        ? getSeekProfileRequest()
        : getSeekRecommendedRequest());
    const requestInput = request?.variables?.input;
    const language = request?.variables?.language;
    const url = new URL(win.location.href);
    const pageNumberFromUrl = normalizeOptionalPositiveInt(
      url.searchParams.get("pageNumber"),
    );
    const jobIdFromUrl = normalizeOptionalPositiveInt(
      url.searchParams.get("jobId"),
    );
    const captureMode =
      captureModeOverride ||
      (isTalentSearchList
        ? "graphql-talentsearch"
        : (useProfileMode && apiSnapshot.seekProfile
            ? "graphql-profile"
            : "graphql-list"));
    const defaultOperation =
      captureMode === "graphql-profile"
        ? "GetTalentSearchProfileCompleteV2"
        : captureMode === "graphql-talentsearch"
          ? "SearchProfilesByNaturalLanguage"
          : "GetTalentSearchRecommendedCandidates";

    /** @type {Record<string, unknown>} */
    const context = {
      captureMode,
      operation: apiSnapshot.lastOperationName || defaultOperation,
      profileType: SEEK_PROFILE_TYPE,
    };
    if (seekMode) context.seekMode = seekMode;
    if (typeof language === "string") context.language = language;

    if (isTalentSearchList) {
      if (typeof requestInput?.pageNumber === "number") {
        context.pageNumber = requestInput.pageNumber;
      } else if (pageNumberFromUrl != null) {
        context.pageNumber = pageNumberFromUrl;
      }
      if (typeof requestInput?.originalNaturalLanguageQuery === "string") {
        context.searchQuery = requestInput.originalNaturalLanguageQuery;
      }
      if (typeof requestInput?.searchMode === "string") {
        context.searchMode = requestInput.searchMode;
      }
    } else if (requestInput?.page != null) {
      context.pageNumber = requestInput.page;
    } else if (pageNumberFromUrl != null) {
      context.pageNumber = pageNumberFromUrl;
    }
    if (jobIdFromUrl != null) context.jobId = jobIdFromUrl;
    if (apiSnapshot.lastOperationName) {
      context.lastOperationName = apiSnapshot.lastOperationName;
    }

    return context;
  }

  function getSeekPayloadData(payload, kind) {
    if (!payload) return null;

    if (Array.isArray(payload)) {
      const entry = payload.find((item) => {
        const data = item?.data;
        if (!data || typeof data !== "object") return false;
        if (kind === "seekRecommendedCandidates") {
          return !!(
            data.talentSearchRecommendedCandidatesV2 ||
            data.getTalentSearchRecommendedCandidates
          );
        }
        if (kind === "seekTalentSearch") {
          return !!data.talentSearchProfilesNaturalLanguageSearch;
        }
        if (kind === "seekProfile") {
          return !!(
            data.talentSearchProfileV2 ||
            data.talentSearchProfileCompleteV2 ||
            data.getTalentSearchProfileCompleteV2 ||
            data.talentSearchProfileV3
          );
        }
        return false;
      });
      return entry?.data || null;
    }

    if (payload && typeof payload === "object") {
      return payload.data && typeof payload.data === "object"
        ? payload.data
        : payload;
    }

    return null;
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
    // Extraction functions
    extractSeekProfileResume,
    buildSeekCollectionContext,
    getSeekPayloadData,
  };
}
