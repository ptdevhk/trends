/**
 * Seek-specific resume extraction utilities — page detection, snapshot query,
 * URL building, and auto-sync helpers. All dependencies injected from content.ts.
 */

/**
 * Seek GetTalentSearchProfileCompleteV3 returns
 * `{ __typename, result: { profileGuid, workHistories, ... } }` (sometimes
 * wrapped again under talentSearchProfileV3). Capture historically stored the
 * wrapper, so waitForSeekProfileSnapshot never saw profileGuid and always
 * timed out — serial enrichment then burned ~4s/card with no job descriptions.
 */
export function unwrapSeekProfileSnapshot(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  let current = raw as Record<string, unknown>;

  for (const key of [
    "talentSearchProfileV3",
    "talentSearchProfileV2",
    "talentSearchProfileCompleteV2",
    "getTalentSearchProfileCompleteV2",
  ]) {
    const nested = current[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      current = nested as Record<string, unknown>;
      break;
    }
  }

  const result = current.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const inner = result as Record<string, unknown>;
    if (
      typeof inner.profileGuid === "string" ||
      inner.profileId != null ||
      Array.isArray(inner.workHistories) ||
      typeof inner.firstName === "string"
    ) {
      return inner;
    }
  }

  return current;
}

export interface SeekExtractorDeps extends Record<string, unknown> {
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  apiSnapshot: Record<string, unknown>;
  normalizeOptionalPositiveInt: (value: unknown) => number | null;
  DEFAULT_SEEK_PAGE_SIZE: number;
  SEEK_PROFILE_TYPE: string;
  persistLatestAutoSyncSummary: () => void;
  win: { location: { pathname: string; href: string; hostname: string; search: string } };
  doc: { querySelector: (selector: string) => Element | null; querySelectorAll: (selector: string) => NodeListOf<Element> };
  asHTMLElement: (el: unknown) => HTMLElement | null;
  isDisabledPaginationControl: (el: unknown) => boolean;
  waitForSeekProfileSnapshot: (matchId: string, options: { timeoutMs: number }) => Promise<void>;
  SEEK_DETAIL_FETCH_CONCURRENCY: number;
  SEEK_DETAIL_FETCH_DELAY_MS: number;
  SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY: number;
  SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS: number;
  SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS: number;
  SEEK_DETAIL_PARAM: string;
  delay: (ms: number) => Promise<void>;
  SELECTORS: Record<string, string>;
}

export function createSeekExtractor(deps: SeekExtractorDeps) {
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
    SEEK_DETAIL_FETCH_CONCURRENCY,
    SEEK_DETAIL_FETCH_DELAY_MS,
    SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY,
    SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS,
    SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS,
    SEEK_DETAIL_PARAM,
    delay,
    // Pagination selectors
    SELECTORS,
  } = deps;

  function isSeekProfilePage() {
    return win.location.pathname.includes("/talentsearch/profile/");
  }

  function isSeekTalentSearchListPage() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    const { pathname, search } = win.location;
    if (pathname.includes("/talentsearch/profile/")) return false;
    return pathname === "/talentsearch" && search.length > 0;
  }

  function getCurrentSeekMode() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return null;
    if (isSeekProfilePage()) return "profile";
    if (isSeekTalentSearchListPage()) return "talentsearch";
    if (win.location.pathname.includes("/candidates/recommended")) return "recommended";
    return null;
  }

  function isSeekInlineProfileMode() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    if (!win.location.pathname.includes("/candidates/recommended")) return false;
    const openProfileId = normalizeOptionalPositiveInt(
      new URL(win.location.href).searchParams.get("openProfileId"),
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
      return (apiSnapshot.seekTalentSearch as unknown[]).length;
    }
    return hasSeekListSnapshot()
      ? (apiSnapshot.seekRecommendedCandidates as unknown[]).length
      : 0;
  }

  function isSeekSnapshotReady() {
    return getSeekSnapshotCount() > 0;
  }

  function getSeekCandidateIdentity(candidate: unknown) {
    const rec = candidate as Record<string, unknown> | null | undefined;
    const profileId =
      rec?.profileId != null ? String(rec.profileId) : "";
    return {
      profileId,
      profileType:
        typeof rec?.profileType === "string"
          ? rec.profileType
          : SEEK_PROFILE_TYPE,
    };
  }

  function buildSeekProfileUrl(profileId: string, jobId: string | undefined) {
    if (!profileId) return "";
    const hostname = window.location.hostname.toLowerCase();
    if (jobId) {
      return `https://${hostname}/candidates/recommended?jobId=${encodeURIComponent(jobId)}&openProfileId=${encodeURIComponent(profileId)}`;
    }
    return `https://${hostname}/candidates/${encodeURIComponent(profileId)}`;
  }

  function buildSeekNameSearchUrl(name: string, market: string | undefined, roleTitles: string | undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) return "";
    const trimmedRoleTitles = typeof roleTitles === "string" ? roleTitles.trim() : "";
    const roleTitlesParam = trimmedRoleTitles ? `&roleTitles=${encodeURIComponent(trimmedRoleTitles)}` : "";
    return `https://${window.location.hostname.toLowerCase()}/talentsearch/profiles/search?searchQuery=${encodeURIComponent(trimmed)}&market=${encodeURIComponent(market || "MY")}&pageNumber=1${roleTitlesParam}`;
  }

  function normalizeSeekLocationLabel(value: unknown) {
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
    return apiSnapshot.seekRecommendedRequest as Record<string, unknown> | null | undefined;
  }

  function getSeekTalentSearchRequest() {
    return apiSnapshot.seekTalentSearchRequest as Record<string, unknown> | null | undefined;
  }

  function getSeekProfileRequest() {
    return (apiSnapshot.seekProfileRequest || apiSnapshot.seekRecommendedRequest) as Record<string, unknown> | null | undefined;
  }

  function getSeekAutoSyncHelpers() {
    const helpers = globalThis.__TR_SEEK_AUTO_SYNC__;
    return helpers && typeof helpers === "object" ? helpers : null;
  }

  function resolveSeekAutoSyncPageSize(options: Record<string, unknown> = {}) {
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

  function resolveSeekAutoSyncPageWindow(options: Record<string, unknown> = {}) {
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

  function isSeekAutoSyncPageWindowReached(pageWindow: Record<string, unknown> | null, currentPage: unknown) {
    const helpers = getSeekAutoSyncHelpers();
    if (typeof helpers?.isSeekAutoSyncPageWindowReached === "function") {
      return helpers.isSeekAutoSyncPageWindowReached({ currentPage, targetPageEnd: pageWindow?.targetPageEnd });
    }
    const normalizedCurrentPage = normalizeOptionalPositiveInt(currentPage);
    const targetPageEnd = normalizeOptionalPositiveInt(pageWindow?.targetPageEnd);
    return !!(normalizedCurrentPage && targetPageEnd && normalizedCurrentPage >= targetPageEnd);
  }

  /**
   * Planned page windows assume full pages (ceil(limit / pageSize)).
   * When a page returns fewer cards (or extract drops rows), remaining capacity
   * can still be > 0 at targetPageEnd — e.g. limit 100 → only 99 collected.
   * Only honor the window stop once the limit is met (or when there is no limit).
   * Callers must still enforce maxPages as a hard cap when extending.
   */
  function shouldStopSeekAutoSyncForPageWindow(options: {
    pageWindowReached: boolean;
    limit?: number | null;
    totalSubmitted?: number | null;
  }): boolean {
    if (!options.pageWindowReached) {
      return false;
    }
    const normalizedLimit = normalizeOptionalPositiveInt(options.limit);
    if (!normalizedLimit) {
      return true;
    }
    const submitted = normalizeOptionalPositiveInt(options.totalSubmitted) || 0;
    return submitted >= normalizedLimit;
  }

  function resolveSeekAutoSyncCurrentPageSelection(options: Record<string, unknown> = {}) {
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
    const variables = getSeekRecommendedRequest()?.variables as Record<string, unknown> | undefined;
    const requestInput = variables?.input as Record<string, unknown> | undefined;
    return normalizeOptionalPositiveInt(requestInput?.size);
  }

  function getSeekCurrentCandidateCount() {
    if (getCurrentSeekMode() === "talentsearch") {
      return Array.isArray(apiSnapshot.seekTalentSearch) ? (apiSnapshot.seekTalentSearch as unknown[]).length : 0;
    }
    const recommendedCount = Array.isArray(apiSnapshot.seekRecommendedCandidates)
      ? (apiSnapshot.seekRecommendedCandidates as unknown[]).length
      : 0;
    return recommendedCount || getSeekRecommendedDomCardCount();
  }

  function setSeekAutoSyncWindowAttributes(pageWindow: Record<string, unknown> | null) {
    const attrs: [string, unknown][] = [
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

  function setSeekAutoSyncSelectionAttributes(selection: Record<string, unknown> | null) {
    const attrs: [string, unknown][] = [
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

  function findSeekProfileTrigger(profileId: string) {
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
    const profile = unwrapSeekProfileSnapshot(apiSnapshot.seekProfile);
    if (!profile) return [];

    const request = getSeekProfileRequest();
    const variables = request?.variables as Record<string, unknown> | undefined;
    const requestInput = variables?.input as Record<string, unknown> | undefined;
    const language = variables?.language;
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
    // Prefer UUID externalId for talentsearch identity stability when V3 also
    // returns a numeric profileId.
    const externalProfileKey = seekProfileGuid || profileId;
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
    // Fallback to structured country/state/suburb when currentLocation is empty
    const resolvedLocation = currentLocation
      || [
          typeof profile.suburb === "string" ? profile.suburb.trim() : "",
          typeof profile.state === "string" ? profile.state.trim() : "",
          typeof profile.country === "string" ? profile.country.trim() : "",
        ].filter(Boolean).join(", ")
      || "";
    const lastModifiedDate =
      typeof profile.lastModifiedDate === "string"
        ? profile.lastModifiedDate
        : typeof profile.lastModifiedDurationLabel === "string"
          ? profile.lastModifiedDurationLabel
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
    // V3 uses personalSummary; older payloads used resumeSnippet.
    const resumeSnippet =
      typeof profile.resumeSnippet === "string" && profile.resumeSnippet.trim()
        ? profile.resumeSnippet.trim()
        : typeof profile.personalSummary === "string"
          ? profile.personalSummary.trim()
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
      typeof (profile.rightToWork as Record<string, unknown> | undefined)?.label === "string"
        ? ((profile.rightToWork as Record<string, unknown>).label as string).trim()
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
        externalId: externalProfileKey
          ? `${win.location.hostname.toLowerCase()}:profile:${externalProfileKey}`
          : "",
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        // Talentsearch: name-search URL is the only operator-visitable link.
        // /candidates/<numericId> is invalid outside the recommended lane.
        profileUrl:
          getCurrentSeekMode() === "talentsearch"
            ? buildSeekNameSearchUrl(
                [firstName, lastName].filter(Boolean).join(" "),
                profileUrl.searchParams.get("market") || undefined,
                currentJobTitle,
              ) || buildSeekProfileUrl(profileId, jobId)
            : buildSeekProfileUrl(profileId, jobId),
        activityStatus: lastModifiedDate,
        age: "",
        experience: "",
        education,
        location: resolvedLocation,
        jobIntention: currentJobTitle,
        expectedSalary: formatSeekExpectedSalary((profile.salary as Record<string, unknown> | undefined)?.expected),
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
        noticePeriodDays: Number.isFinite(profile.noticePeriodDays as number)
          ? (profile.noticePeriodDays as number)
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

  function buildSeekCollectionContext(options: Record<string, unknown> = {}) {
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
      ? apiSnapshot.seekTalentSearchRequest as Record<string, unknown> | null
      : null;
    const request = talentSearchRequest ??
      (useProfileMode
        ? getSeekProfileRequest()
        : getSeekRecommendedRequest());
    const variables = request?.variables as Record<string, unknown> | undefined;
    const requestInput = variables?.input as Record<string, unknown> | undefined;
    const language = variables?.language;
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
    const context: Record<string, unknown> = {
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

  function getSeekPayloadData(payload: unknown, kind: string) {
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
      const obj = payload as Record<string, unknown>;
      return obj.data && typeof obj.data === "object"
        ? obj.data
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
      ? (apiSnapshot.seekRecommendedCandidates as Record<string, unknown>[])
      : [];
    if (candidates.length === 0 && getCurrentSeekMode() === "recommended") {
      return extractSeekRecommendedDomResumes();
    }
    const request = getSeekRecommendedRequest();
    const variables = request?.variables as Record<string, unknown> | undefined;
    const requestInput = variables?.input as Record<string, unknown> | undefined;
    const language = variables?.language;
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
      // Fallback to structured country/state/suburb when currentLocation is empty
      const resolvedLocation = currentLocation
        || [
            typeof candidate?.suburb === "string" ? candidate.suburb.trim() : "",
            typeof candidate?.state === "string" ? candidate.state.trim() : "",
            typeof candidate?.country === "string" ? candidate.country.trim() : "",
          ].filter(Boolean).join(", ")
        || "";
      const lastModifiedDate =
        typeof candidate?.lastModifiedDate === "string"
          ? candidate.lastModifiedDate
          : "";
      const salary = candidate?.salary as Record<string, unknown> | undefined;
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
        location: resolvedLocation,
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
      ? (apiSnapshot.seekTalentSearch as Record<string, unknown>[])
      : [];
    const request = getSeekTalentSearchRequest();
    const variables = request?.variables as Record<string, unknown> | undefined;
    const requestInput = variables?.input as Record<string, unknown> | undefined;
    const language = variables?.language;
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
        // Fallback to structured country/state/suburb when currentLocation is empty
        const resolvedLocation = currentLocation
          || [
              typeof node?.suburb === "string" ? node.suburb.trim() : "",
              typeof node?.state === "string" ? node.state.trim() : "",
              typeof node?.country === "string" ? node.country.trim() : "",
            ].filter(Boolean).join(", ")
          || "";
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
          location: resolvedLocation,
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
    if (getCurrentSeekMode() === "recommended") {
      return getSeekRecommendedDomCardCount();
    }

    return doc.querySelectorAll(
      'a[href*="/talentsearch/profile/"][href*="profilePosition="]',
    ).length;
  }

  function findSeekRecommendedDomCard(heading: Element) {
    let current = heading.parentElement;
    while (current) {
      if (current.querySelector('[data-testid="work-history"]')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function getSeekRecommendedDomCardCount() {
    if (getCurrentSeekMode() !== "recommended") return 0;

    const seenCards = new Set<Element>();
    for (const heading of doc.querySelectorAll('[data-role="heading"]')) {
      const name = (heading.textContent || "").trim();
      const card = name ? findSeekRecommendedDomCard(heading) : null;
      if (card && !seenCards.has(card)) {
        seenCards.add(card);
      }
    }
    return seenCards.size;
  }

  function getSeekRecommendedDomCards() {
    if (getCurrentSeekMode() !== "recommended") return [];

    const seenCards = new Set<Element>();
    return Array.from(doc.querySelectorAll('[data-role="heading"]'))
      .map((heading) => {
        const name = (heading.textContent || "").trim();
        const card = name ? findSeekRecommendedDomCard(heading) : null;
        if (!card || seenCards.has(card)) return null;

        const workHistory = Array.from(
          card.querySelectorAll('[data-testid="work-history"]'),
        )
          .map((item) => (item.textContent || "").trim())
          .filter(Boolean);
        if (workHistory.length === 0) return null;

        seenCards.add(card);
        return { name, workHistory };
      })
      .filter((card): card is { name: string; workHistory: string[] } =>
        Boolean(card),
      );
  }

  function getJobTitleFromWorkHistory(raw: string) {
    return raw.split(/\s+at\s+/iu)[0]?.trim() || "";
  }

  function extractSeekRecommendedDomResumes() {
    const url = new URL(win.location.href);
    const jobId =
      normalizeOptionalPositiveInt(url.searchParams.get("jobId")) ||
      "recommended";
    const currentPage =
      normalizeOptionalPositiveInt(url.searchParams.get("pageNumber")) || 1;
    const sourceHost = win.location.hostname.toLowerCase();

    const resumes: Record<string, unknown>[] = [];
    let pageIndex = 0;
    const seenCards = new Set<Element>();

    for (const heading of doc.querySelectorAll('[data-role="heading"]')) {
      const name = (heading.textContent || "").trim();
      const card = name ? findSeekRecommendedDomCard(heading) : null;
      if (!card || seenCards.has(card)) continue;

      const workHistory: string[] = [];
      for (const item of card.querySelectorAll('[data-testid="work-history"]')) {
        const text = (item.textContent || "").trim();
        if (text) workHistory.push(text);
      }
      if (workHistory.length === 0) continue;

      seenCards.add(card);
      pageIndex++;
      const profileId = `dom-${jobId}-${currentPage}-${pageIndex}`;
      resumes.push({
        profileId,
        profileType: SEEK_PROFILE_TYPE,
        externalId: `${sourceHost}:recommended:${profileId}`,
        name,
        profileUrl: win.location.href,
        activityStatus: "",
        age: "",
        experience: "",
        education: "",
        location: "",
        jobIntention: getJobTitleFromWorkHistory(workHistory[0] || ""),
        expectedSalary: "",
        selfIntro: "",
        workHistory: workHistory.map((raw) => ({ raw })),
        extractedAt: new Date().toISOString(),
        pageIndex,
        source: sourceHost,
        searchProfileId: "",
        language: "",
        pageNumber: currentPage,
      });
    }

    return resumes;
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

  /**
   * Talentsearch list GraphQL returns name/location/workHistory titles only —
   * not per-job description text. AI scoring uses the latest 3 job descriptions,
   * so V3 side-panel enrichment is ON by default for talentsearch.
   *
   * Opt out for list-only speed: ?tr_seek_detail=0 (also: false|off|no).
   * Recommended-lane collection always enriches.
   *
   * Prefer the live URL, then fall back to the sessionStorage capture written at
   * document_start (SEEK's SPA often strips unknown `tr_*` query params).
   */
  function readSeekDetailParamValue(): string | null {
    try {
      const params = new URLSearchParams(win.location.search || "");
      const fromUrl = params.get(SEEK_DETAIL_PARAM);
      if (fromUrl != null && fromUrl !== "") {
        return fromUrl.trim().toLowerCase();
      }
    } catch {
      // fall through to sessionStorage
    }
    try {
      if (typeof sessionStorage !== "undefined") {
        const stored = sessionStorage.getItem(`tr_seek_param_${SEEK_DETAIL_PARAM}`);
        if (stored != null && stored !== "") {
          return stored.trim().toLowerCase();
        }
      }
    } catch {
      // ignore sessionStorage access errors
    }
    return null;
  }

  function isSeekDetailOptOutValue(value: string | null): boolean {
    return value === "0" || value === "false" || value === "off" || value === "no";
  }

  function shouldEnrichSeekListWithDetail(): boolean {
    if (getCurrentSeekMode() !== "talentsearch") {
      return true;
    }
    // Default ON: list workHistory lacks job descriptions for latest-3 scoring.
    return !isSeekDetailOptOutValue(readSeekDetailParamValue());
  }

  /** True when work history already has description text on any of the first N roles. */
  function resumeHasWorkHistoryDescriptions(resume: unknown, minDescribed = 1): boolean {
    const rec = resume as Record<string, unknown> | null | undefined;
    const workHistory = Array.isArray(rec?.workHistory) ? rec.workHistory : [];
    let described = 0;
    for (const entry of workHistory) {
      if (!entry || typeof entry !== "object") continue;
      const description =
        typeof (entry as Record<string, unknown>).description === "string"
          ? ((entry as Record<string, unknown>).description as string).trim()
          : "";
      if (description) {
        described += 1;
        if (described >= minDescribed) return true;
      }
    }
    return false;
  }

  function dismissSeekProfilePanel() {
    try {
      const active = doc.querySelector?.("[data-role='heading']") as Element | null;
      // Prefer Escape so the SPA closes the side panel without navigation.
      const target = (doc as { body?: HTMLElement }).body || active;
      if (target && typeof (target as HTMLElement).dispatchEvent === "function") {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    } catch {
      // Best-effort; next click still works if the previous panel stays open.
    }
  }

  async function enrichSingleSeekResumeWithDetail(resume: unknown, cachedHeadings: unknown) {
    const rec = resume as Record<string, unknown> | null | undefined;
    const profileId =
      typeof rec?.profileId === "string" ? rec.profileId.trim() : "";
    if (!profileId) {
      return resume;
    }

    // Skip SPA panel open when list (or prior) data already has job descriptions.
    // List-only talentsearch never hits this; re-enrich / recommended may.
    if (resumeHasWorkHistoryDescriptions(resume, 1)) {
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
      // Drop stale V3 payload so waiters cannot resolve against the previous card.
      apiSnapshot.seekProfile = null;
      trigger.click();
      // For talentsearch, match by profileGuid (UUID); for recommended, match by numeric profileId
      const matchId = isTalentSearch ? (rec?.seekProfileGuid as string) || profileId : profileId;
      const timeoutMs = isTalentSearch ? SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS : 12000;
      await waitForSeekProfileSnapshot(matchId, { timeoutMs });
      const [detailResume] = extractSeekProfileResume() as (Record<string, unknown> | undefined)[];
      if (!detailResume) {
        dismissSeekProfilePanel();
        return resume;
      }
      // For talentsearch, verify the detail profile matches by profileGuid or profileId
      if (isTalentSearch) {
        const detailGuid = (detailResume.seekProfileGuid as string) || "";
        const detailProfileId = (detailResume.profileId as string) || "";
        if (detailGuid !== profileId && detailProfileId !== profileId) {
          dismissSeekProfilePanel();
          return resume;
        }
        // Merge: talentsearch detail may provide numeric profileId from V3 response
        const merged = mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
        dismissSeekProfilePanel();
        return merged;
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
      dismissSeekProfilePanel();
      return resume;
    }
  }

  async function enrichSeekResumesWithDetail(resumes: unknown[]) {
    if (!Array.isArray(resumes) || resumes.length === 0) return [];
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return resumes;
    if (isSeekProfileMode()) return resumes;
    if (!shouldEnrichSeekListWithDetail()) {
      return resumes;
    }

    // Cache DOM headings once for talentsearch card-finding (avoids O(N²) queries)
    const isTalentSearch = getCurrentSeekMode() === "talentsearch";
    const cachedHeadings = isTalentSearch
      ? Array.from(doc.querySelectorAll('[data-role="heading"]'))
      : null;

    // Talentsearch SPA only supports one open panel; serial enrichment avoids
    // lost GraphQL responses on the shared apiSnapshot.seekProfile slot.
    const concurrency = isTalentSearch
      ? SEEK_TALENTSEARCH_DETAIL_FETCH_CONCURRENCY
      : SEEK_DETAIL_FETCH_CONCURRENCY;
    const interBatchDelayMs = isTalentSearch
      ? SEEK_TALENTSEARCH_DETAIL_FETCH_DELAY_MS
      : SEEK_DETAIL_FETCH_DELAY_MS;

    const enriched = [];
    for (let start = 0; start < resumes.length; start += concurrency) {
      const batch = resumes.slice(start, start + concurrency);
      const batchResults = await Promise.all(
        batch.map((resume) => enrichSingleSeekResumeWithDetail(resume, cachedHeadings)),
      );
      enriched.push(...batchResults);
      if (start + concurrency < resumes.length) {
        await delay(interBatchDelayMs);
      }
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
  function escapeCssAttrValue(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function findSeekTalentSearchCardTrigger(profileId: string, resume: unknown, cachedHeadings: unknown) {
    if (!profileId) return null;
    // Try matching by data-tr-candidate-id attribute (set during extraction)
    const byAttr = doc.querySelector(
      `[data-tr-candidate-id="${escapeCssAttrValue(profileId)}"]`,
    );
    if (byAttr instanceof HTMLElement) return byAttr;
    // Fallback: match heading elements that contain the candidate name.
    // Talentsearch cards use [data-role="heading"] for the candidate name.
    const candidateName = typeof (resume as Record<string, unknown> | null)?.name === "string" ? ((resume as Record<string, unknown>).name as string).trim() : "";
    if (candidateName) {
      const headings = (cachedHeadings as Element[] | null) ||
        Array.from(doc.querySelectorAll('[data-role="heading"]'));
      const match = headings.find((h) => {
        const text = (h.textContent || "").trim();
        return text === candidateName;
      });
      if (match instanceof HTMLElement) return match;
    }
    return null;
  }

  function mergeSeekListResumeWithDetail(baseResume: unknown, detailResume: unknown, isTalentSearch = false) {
    const base = baseResume as Record<string, unknown>;
    const detail = detailResume as Record<string, unknown>;
    if (!detailResume || typeof detailResume !== "object") {
      return baseResume;
    }

    // Talentsearch: keep UUID seekProfileGuid; optional numeric profileId for
    // diagnostics only. Never rewrite profileUrl to /candidates/<id> — that path
    // is not visitable from the talentsearch lane (operators need name-search URLs).
    const seekProfileGuid = base.seekProfileGuid || detail.seekProfileGuid || undefined;
    const numericProfileId = isTalentSearch && detail.profileId && /^\d+$/.test(String(detail.profileId))
      ? String(detail.profileId)
      : undefined;

    const baseProfileUrl = typeof base.profileUrl === "string" ? base.profileUrl : "";
    const detailProfileUrl = typeof detail.profileUrl === "string" ? detail.profileUrl : "";
    const isCandidatesOnlyUrl = (url: string) =>
      /\/candidates\/\d+(?:\?|$)/.test(url) && !/talentsearch/i.test(url);
    let profileUrl = isTalentSearch
      ? // Prefer list name-search URL; rebuild if base empty or detail forced candidates URL.
        (!isCandidatesOnlyUrl(baseProfileUrl) && baseProfileUrl
          ? baseProfileUrl
          : !isCandidatesOnlyUrl(detailProfileUrl) && detailProfileUrl
            ? detailProfileUrl
            : "")
      : detailProfileUrl || baseProfileUrl;
    if (isTalentSearch && (!profileUrl || isCandidatesOnlyUrl(profileUrl))) {
      const name =
        (typeof base.name === "string" && base.name.trim()) ||
        (typeof detail.name === "string" && detail.name.trim()) ||
        "";
      const market =
        new URL(win.location.href).searchParams.get("market") || undefined;
      const roleTitle =
        (typeof base.jobIntention === "string" && base.jobIntention.trim()) ||
        (typeof detail.jobIntention === "string" && detail.jobIntention.trim()) ||
        undefined;
      profileUrl = buildSeekNameSearchUrl(name, market, roleTitle) || baseProfileUrl || detailProfileUrl;
    }

    // Prefer workHistory that includes job descriptions (V3 detail). List-only
    // titles/companies stay as fallback when detail workHistory is empty.
    const baseWorkHistory = Array.isArray(base.workHistory) ? base.workHistory : [];
    const detailWorkHistory = Array.isArray(detail.workHistory) ? detail.workHistory : [];
    const countDescribed = (entries: unknown[]) =>
      entries.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const description = (entry as Record<string, unknown>).description;
        return typeof description === "string" && description.trim().length > 0;
      }).length;
    const workHistory =
      countDescribed(detailWorkHistory) > 0
        ? detailWorkHistory
        : detailWorkHistory.length > 0
          ? detailWorkHistory
          : baseWorkHistory;

    return {
      ...base,
      ...detail,
      workHistory,
      // Keep list UUID externalId for talentsearch identity stability.
      externalId: isTalentSearch
        ? base.externalId || detail.externalId
        : detail.externalId || base.externalId,
      ...(seekProfileGuid ? { seekProfileGuid } : {}),
      ...(numericProfileId ? { profileId: numericProfileId } : {}),
      ...(profileUrl ? { profileUrl } : {}),
      pageIndex: base.pageIndex,
      pageNumber: base.pageNumber,
      extractedAt: base.extractedAt,
      source: base.source,
      searchProfileId: detail.searchProfileId || base.searchProfileId,
    };
  }

  function formatSeekExpectedSalary(expectedSalary: unknown) {
    if (!expectedSalary || typeof expectedSalary !== "object") return "";

    const salary = expectedSalary as Record<string, unknown>;
    const amounts = Array.isArray(salary.amount)
      ? (salary.amount as Record<string, unknown>[])
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
      typeof salary.currency === "string"
        ? salary.currency.trim()
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

  function buildSeekWorkHistoryItem(item: unknown) {
    if (!item || typeof item !== "object") return null;

    const rec = item as Record<string, unknown>;
    const companyName =
      typeof rec.companyName === "string" ? rec.companyName.trim() : "";
    const jobTitle =
      typeof rec.jobTitle === "string" ? rec.jobTitle.trim() : "";
    // V3 may use description / jobDescription / responsibilities; list often omits all.
    const descriptionCandidates = [
      rec.description,
      rec.jobDescription,
      rec.responsibilities,
      rec.highlights,
    ];
    let description = "";
    for (const candidate of descriptionCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        description = candidate.trim();
        break;
      }
      if (Array.isArray(candidate)) {
        const joined = candidate
          .map((line) => (typeof line === "string" ? line.trim() : ""))
          .filter(Boolean)
          .join("\n");
        if (joined) {
          description = joined;
          break;
        }
      }
    }
    const startDate =
      typeof rec.startDate === "string" ? rec.startDate.trim() : "";
    const endDate = typeof rec.endDate === "string" ? rec.endDate.trim() : "";
    const durationLabel =
      typeof rec.durationLabel === "string" ? rec.durationLabel.trim() : "";
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

  function buildSeekProfileEducationItem(item: unknown) {
    if (!item || typeof item !== "object") return null;

    const rec = item as Record<string, unknown>;
    const institution =
      typeof rec.institutionName === "string" ? rec.institutionName.trim() : "";
    const qualification =
      typeof rec.qualificationName === "string"
        ? rec.qualificationName.trim()
        : "";
    const completionYear = Number.isFinite(rec.completionYear)
      ? String(rec.completionYear)
      : "";
    const completionMonth =
      Number.isFinite(rec.completionMonth) && (rec.completionMonth as number) > 0
        ? String(rec.completionMonth).padStart(2, "0")
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
    shouldStopSeekAutoSyncForPageWindow,
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
