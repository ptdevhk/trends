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
    // Pagination + extraction deps
    asHTMLElement,
    isDisabledPaginationControl,
    // Detail enrichment deps
    waitForSeekProfileSnapshot,
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

  // ============================================================================
  // Seek Resumes Extraction
  // ============================================================================

  /**
   * Extract all resumes from current page
   * @returns {Array} - Array of resume objects
   */
  function extractSeekResumes() {
    const candidates = Array.isArray(apiSnapshot.seekRecommendedCandidates)
      ? apiSnapshot.seekRecommendedCandidates
      : [];
    const request = getSeekRecommendedRequest();
    const requestInput = request?.variables?.input;
    const language = request?.variables?.language;
    const url = new URL(win.location.href);
    const jobIdFromUrl = normalizeOptionalPositiveInt(
      url.searchParams.get("jobId"),
    );
    const jobId =
      requestInput?.jobId != null
        ? String(requestInput.jobId)
        : jobIdFromUrl != null
          ? String(jobIdFromUrl)
          : undefined;
    const currentPage =
      typeof requestInput?.page === "number"
        ? requestInput.page
        : normalizeOptionalPositiveInt(url.searchParams.get("pageNumber")) || 1;

    return candidates.map((candidate, index) => {
      const { profileId, profileType } = getSeekCandidateIdentity(candidate);
      const firstName =
        typeof candidate?.firstName === "string"
          ? candidate.firstName.trim()
          : "";
      const lastName =
        typeof candidate?.lastName === "string" ? candidate.lastName.trim() : "";
      const currentJobTitle =
        typeof candidate?.currentJobTitle === "string"
          ? candidate.currentJobTitle.trim()
          : "";
      const currentLocation =
        typeof candidate?.currentLocation === "string"
          ? candidate.currentLocation.trim()
          : "";
      const lastModifiedDate =
        typeof candidate?.lastModifiedDate === "string"
          ? candidate.lastModifiedDate
          : "";
      const salary = candidate?.salary;
      const salaryParts = [salary?.minLabel, salary?.maxLabel].filter(
        (value) => typeof value === "string" && value.trim(),
      );
      const workHistory = Array.isArray(candidate?.workHistories)
        ? candidate.workHistories
            .map((item) => buildSeekWorkHistoryItem(item))
            .filter(Boolean)
        : [];

      return {
        profileId,
        profileType,
        externalId: profileId
          ? `${win.location.hostname.toLowerCase()}:profile:${profileId}`
          : "",
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        profileUrl: buildSeekProfileUrl(profileId, jobId),
        activityStatus: lastModifiedDate,
        age: "",
        experience: "",
        education: "",
        location: currentLocation,
        jobIntention: currentJobTitle,
        expectedSalary: salaryParts.join(" - "),
        selfIntro: "",
        workHistory,
        extractedAt: new Date().toISOString(),
        pageIndex: index + 1,
        source: win.location.hostname.toLowerCase(),
        searchProfileId:
          typeof requestInput?.searchId === "string"
            ? requestInput.searchId
            : "",
        language: typeof language === "string" ? language : "",
        pageNumber: currentPage,
      };
    });
  }

  /**
   * Extract resumes from seek talent-search (SearchProfilesByNaturalLanguage) list-page snapshot.
   */
  function extractSeekTalentSearchResumes() {
    const candidates = Array.isArray(apiSnapshot.seekTalentSearch)
      ? apiSnapshot.seekTalentSearch
      : [];
    const request = getSeekTalentSearchRequest();
    const requestInput = request?.variables?.input;
    const language = request?.variables?.language;
    const url = new URL(win.location.href);
    const currentPage =
      typeof requestInput?.pageNumber === "number"
        ? requestInput.pageNumber
        : normalizeOptionalPositiveInt(url.searchParams.get("pageNumber")) || 1;

    return candidates
      .map((node, index) => {
        const profileGuid =
          typeof node?.profileGuid === "string" && node.profileGuid
            ? node.profileGuid
            : "";
        const relayId =
          typeof node?.id === "string" && node.id ? node.id : "";
        const profileId = profileGuid || relayId;
        if (!profileId) return null;

        const firstName =
          typeof node?.firstName === "string" ? node.firstName.trim() : "";
        const lastName =
          typeof node?.lastName === "string" ? node.lastName.trim() : "";
        const currentJobTitle =
          typeof node?.currentJobTitle === "string"
            ? node.currentJobTitle.trim()
            : "";
        const currentLocation =
          typeof node?.currentLocation === "string"
            ? node.currentLocation.trim()
            : "";
        const lastModifiedDurationLabel =
          typeof node?.lastModifiedDurationLabel === "string"
            ? node.lastModifiedDurationLabel
            : "";
        const workHistory = Array.isArray(node?.workHistories)
          ? node.workHistories
              .map((item) => buildSeekWorkHistoryItem(item))
              .filter(Boolean)
          : [];

        return {
          profileId,
          profileType: "seek",
          seekProfileGuid: profileGuid || undefined,
          externalId: profileId
            ? `${win.location.hostname.toLowerCase()}:profile:${profileId}`
            : "",
          name: [firstName, lastName].filter(Boolean).join(" ").trim(),
          profileUrl: buildSeekNameSearchUrl(
            [firstName, lastName].filter(Boolean).join(" "),
            url.searchParams.get("market") || undefined,
            currentJobTitle,
          ),
          activityStatus: lastModifiedDurationLabel,
          age: "",
          experience: "",
          education: "",
          location: currentLocation,
          jobIntention: currentJobTitle,
          expectedSalary: "",
          selfIntro: "",
          workHistory,
          extractedAt: new Date().toISOString(),
          pageIndex: index + 1,
          source: win.location.hostname.toLowerCase(),
          searchProfileId: "",
          language: typeof language === "string" ? language : "",
          pageNumber: currentPage,
        };
      })
      .filter(Boolean);
  }

  // ============================================================================
  // Seek Pagination Helpers
  // ============================================================================

  function getSeekCardCount() {
    return doc.querySelectorAll(
      'a[href*="/talentsearch/profile/"][href*="profilePosition="]',
    ).length;
  }

  function getSeekPaginationInfo() {
    const isTalentSearch = getCurrentSeekMode() === "talentsearch";
    const currentPage =
      normalizeOptionalPositiveInt(
        new URL(win.location.href).searchParams.get("pageNumber"),
      ) || 1;
    const pagination = doc.querySelector(
      isTalentSearch
        ? SELECTORS.seekTalentSearchPagination
        : SELECTORS.seekPagination,
    );
    if (!pagination) {
      return {
        currentPage,
        totalPages: currentPage,
        totalItems: 0,
        hasNextPage: false,
      };
    }

    const links = Array.from(pagination.querySelectorAll("a"));
    const pageNumbers = links
      .map((item) => {
        const label = item.getAttribute("aria-label") || "";
        const text = item.textContent || "";
        const match =
          label.match(/page\s+(\d+)/i) || text.trim().match(/^(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .filter((value) => Number.isFinite(value) && value > 0);
    const totalPages = Math.max(
      pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0,
      currentPage,
    );
    const nextLink = getSeekNextPageLinkForMode();
    const hasNextPage =
      totalPages > currentPage && !isDisabledPaginationControl(nextLink);

    return { currentPage, totalPages, totalItems: 0, hasNextPage };
  }

  function getSeekNextPageLink() {
    const pagination = doc.querySelector(SELECTORS.seekPagination);
    if (!pagination) return null;
    const links = Array.from(pagination.querySelectorAll("a"));
    const nextLink = links.find((node) =>
      /next/i.test((node.textContent || "").trim()),
    );
    return asHTMLElement(nextLink || null);
  }

  function getSeekTalentSearchNextPageLink() {
    const pagination = doc.querySelector(SELECTORS.seekTalentSearchPagination);
    if (!pagination) return null;
    const explicit = pagination.querySelector('a[rel="next"]');
    if (explicit) return asHTMLElement(explicit);
    const links = Array.from(pagination.querySelectorAll("a"));
    const labeled = links.find((node) =>
      /next/i.test(
        (node.getAttribute("aria-label") || node.textContent || "").trim(),
      ),
    );
    return asHTMLElement(labeled || null);
  }

  function getSeekNextPageLinkForMode() {
    if (getCurrentSeekMode() === "talentsearch") {
      return getSeekTalentSearchNextPageLink();
    }
    return getSeekNextPageLink();
  }

  // ============================================================================
  // Seek Detail Enrichment
  // ============================================================================

  async function enrichSingleSeekResumeWithDetail(resume, cachedHeadings) {
    const profileId =
      typeof resume?.profileId === "string" ? resume.profileId.trim() : "";
    if (!profileId) {
      return resume;
    }

    const isTalentSearch = getCurrentSeekMode() === "talentsearch";
    const trigger = isTalentSearch
      ? findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings)
      : findSeekProfileTrigger(profileId);
    if (!(trigger instanceof HTMLElement)) {
      return resume;
    }

    try {
      trigger.click();
      // For talentsearch, match by profileGuid (UUID); for recommended, match by numeric profileId
      const matchId = isTalentSearch ? resume.seekProfileGuid || profileId : profileId;
      await waitForSeekProfileSnapshot(matchId, { timeoutMs: 12000 });
      const [detailResume] = extractSeekProfileResume();
      if (!detailResume) {
        return resume;
      }
      // For talentsearch, verify the detail profile matches by profileGuid or profileId
      if (isTalentSearch) {
        const detailGuid = detailResume.seekProfileGuid || "";
        const detailProfileId = detailResume.profileId || "";
        if (detailGuid !== profileId && detailProfileId !== profileId) {
          return resume;
        }
        // Merge: talentsearch detail may provide numeric profileId from V3 response
        return mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
      }
      if (detailResume.profileId !== profileId) {
        return resume;
      }
      return mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
    } catch (error) {
      console.warn(
        "🎯 [Auto Sync] Failed to enrich Seek detail resume:",
        profileId,
        error,
      );
      return resume;
    }
  }

  async function enrichSeekResumesWithDetail(resumes) {
    if (!Array.isArray(resumes) || resumes.length === 0) return [];
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return resumes;
    if (isSeekProfileMode()) return resumes;

    // Cache DOM headings once for talentsearch card-finding (avoids O(N²) queries)
    const isTalentSearch = getCurrentSeekMode() === "talentsearch";
    const cachedHeadings = isTalentSearch
      ? Array.from(doc.querySelectorAll('[data-role="heading"]'))
      : null;

    const enriched = [];
    for (const resume of resumes) {
      enriched.push(await enrichSingleSeekResumeWithDetail(resume, cachedHeadings));
    }
    return enriched;
  }

  // ============================================================================
  // Internalized extraction helpers (moved from content.ts)
  // ============================================================================

  /**
   * Talentsearch cards have no <a> links — candidate name is a [data-role="heading"]
   * element clicked via SPA event handlers. Find the card matching this profileId
   * (UUID) by checking data attributes or card index.
   */
  function findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings) {
    if (!profileId) return null;
    // Try matching by data-tr-candidate-id attribute (set during extraction)
    const byAttr = doc.querySelector(
      `[data-tr-candidate-id="${CSS.escape(profileId)}"]`,
    );
    if (byAttr instanceof HTMLElement) return byAttr;
    // Fallback: match heading elements that contain the candidate name.
    // Talentsearch cards use [data-role="heading"] for the candidate name.
    const candidateName = typeof resume?.name === "string" ? resume.name.trim() : "";
    if (candidateName) {
      const headings = cachedHeadings ||
        Array.from(doc.querySelectorAll('[data-role="heading"]'));
      const match = headings.find((h) => {
        const text = (h.textContent || "").trim();
        return text === candidateName;
      });
      if (match instanceof HTMLElement) return match;
    }
    return null;
  }

  function mergeSeekListResumeWithDetail(baseResume, detailResume, isTalentSearch = false) {
    if (!detailResume || typeof detailResume !== "object") {
      return baseResume;
    }

    // For talentsearch: if V3 detail provides a numeric profileId, use it for
    // profileUrl construction but preserve the UUID seekProfileGuid
    const seekProfileGuid = baseResume.seekProfileGuid || detailResume.seekProfileGuid || undefined;
    const numericProfileId = isTalentSearch && detailResume.profileId && /^\d+$/.test(detailResume.profileId)
      ? detailResume.profileId
      : undefined;

    // If we got a numeric profileId from V3 detail, update the profileUrl
    let profileUrl = detailResume.profileUrl || baseResume.profileUrl;
    if (numericProfileId) {
      // Derive jobId from the current page URL or API request for recommended URL format
      const seekRequest = getSeekTalentSearchRequest();
      const requestJobId = seekRequest?.variables?.input?.jobId;
      const urlJobId = normalizeOptionalPositiveInt(
        new URL(win.location.href).searchParams.get("jobId"),
      );
      const jobId = requestJobId != null
        ? String(requestJobId)
        : urlJobId != null
          ? String(urlJobId)
          : undefined;
      profileUrl = buildSeekProfileUrl(numericProfileId, jobId);
    }

    return {
      ...baseResume,
      ...detailResume,
      ...(seekProfileGuid ? { seekProfileGuid } : {}),
      ...(numericProfileId ? { profileId: numericProfileId } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      pageIndex: baseResume.pageIndex,
      pageNumber: baseResume.pageNumber,
      extractedAt: baseResume.extractedAt,
      source: baseResume.source,
      searchProfileId: detailResume.searchProfileId || baseResume.searchProfileId,
    };
  }

  function formatSeekExpectedSalary(expectedSalary) {
    if (!expectedSalary || typeof expectedSalary !== "object") return "";

    const amounts = Array.isArray(expectedSalary.amount)
      ? expectedSalary.amount
      : [];
    const preferredFrequencies = ["MONTHLY", "ANNUAL", "HOURLY"];
    const amount =
      preferredFrequencies
        .map((frequency) =>
          amounts.find((entry) => entry?.frequency === frequency),
        )
        .find(Boolean) || amounts[0];

    if (!amount || typeof amount !== "object") return "";

    const value =
      typeof amount.value === "number" ? amount.value : Number(amount.value);
    const formattedValue = Number.isFinite(value)
      ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
      : "";
    const currency =
      typeof expectedSalary.currency === "string"
        ? expectedSalary.currency.trim()
        : "";
    const period =
      amount.frequency === "ANNUAL"
        ? "/year"
        : amount.frequency === "HOURLY"
          ? "/hour"
          : amount.frequency === "DAILY"
            ? "/day"
            : "/month";

    const prefix = [currency, formattedValue].filter(Boolean).join(" ");
    return prefix ? `${prefix}${period}` : "";
  }

  function buildSeekWorkHistoryItem(item) {
    if (!item || typeof item !== "object") return null;

    const companyName =
      typeof item.companyName === "string" ? item.companyName.trim() : "";
    const jobTitle =
      typeof item.jobTitle === "string" ? item.jobTitle.trim() : "";
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const startDate =
      typeof item.startDate === "string" ? item.startDate.trim() : "";
    const endDate = typeof item.endDate === "string" ? item.endDate.trim() : "";
    const durationLabel =
      typeof item.durationLabel === "string" ? item.durationLabel.trim() : "";
    const raw = [jobTitle, companyName, durationLabel]
      .filter(Boolean)
      .join(" · ");

    if (!raw && !description) return null;

    return {
      raw: raw || description,
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description: description || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  function buildSeekProfileEducationItem(item) {
    if (!item || typeof item !== "object") return null;

    const institution =
      typeof item.institutionName === "string" ? item.institutionName.trim() : "";
    const qualification =
      typeof item.qualificationName === "string"
        ? item.qualificationName.trim()
        : "";
    const completionYear = Number.isFinite(item.completionYear)
      ? String(item.completionYear)
      : "";
    const completionMonth =
      Number.isFinite(item.completionMonth) && item.completionMonth > 0
        ? String(item.completionMonth).padStart(2, "0")
        : "";
    const endDate = completionYear
      ? completionMonth
        ? `${completionYear}-${completionMonth}`
        : completionYear
      : "";

    if (!institution && !qualification && !endDate) return null;

    return {
      institution: institution || undefined,
      qualification: qualification || undefined,
      endDate: endDate || undefined,
    };
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
    // Resumes extraction
    extractSeekResumes,
    extractSeekTalentSearchResumes,
    // Pagination helpers
    getSeekCardCount,
    getSeekPaginationInfo,
    getSeekNextPageLink,
    getSeekTalentSearchNextPageLink,
    getSeekNextPageLinkForMode,
    // Detail enrichment
    enrichSingleSeekResumeWithDetail,
    enrichSeekResumesWithDetail,
  };
}
