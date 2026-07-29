/**
 * Seek-specific resume extraction utilities — page detection, snapshot query,
 * URL building, and auto-sync helpers. All dependencies injected from content.ts.
 */

import { isMeaningfulSeekWorkHistoryDescription } from "./seek-work-history-quality";

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

  const SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_COOLDOWN_MS = 30000;
  const SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_MAX_HITS = 2;
  const SEEK_TALENTSEARCH_DETAIL_SETTLE_MS = 300;
  let seekTalentSearchDetailRateLimitHits = 0;
  let seekTalentSearchDetailCooldownUntil = 0;

  function getSeekProfileErrorInfo() {
    const error =
      apiSnapshot.seekProfileError && typeof apiSnapshot.seekProfileError === "object"
        ? (apiSnapshot.seekProfileError as Record<string, unknown>)
        : null;
    if (!error) return null;
    const code = typeof error.code === "string" ? error.code : "";
    const message = typeof error.message === "string" ? error.message : "";
    if (!code && !message) return null;
    return { code, message };
  }

  function isSeekProfileRateLimitError() {
    return getSeekProfileErrorInfo()?.code === "RATE_LIMIT_REACHED";
  }

  function resetSeekTalentSearchRateLimitState() {
    seekTalentSearchDetailRateLimitHits = 0;
    seekTalentSearchDetailCooldownUntil = 0;
  }

  function noteSeekTalentSearchRateLimit(profileId: string) {
    seekTalentSearchDetailRateLimitHits += 1;
    seekTalentSearchDetailCooldownUntil = Math.max(
      seekTalentSearchDetailCooldownUntil,
      Date.now() + SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_COOLDOWN_MS,
    );
    if (seekTalentSearchDetailRateLimitHits >= SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_MAX_HITS) {
      console.warn(
        "🎯 [Auto Sync] Seek detail rate-limited repeatedly; extending cooldown before the next talent-search detail attempt.",
        { profileId, cooldownMs: SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_COOLDOWN_MS },
      );
      return;
    }
    console.warn(
      "🎯 [Auto Sync] Seek detail rate-limited; backing off before the next talent-search detail attempt.",
      { profileId, cooldownMs: SEEK_TALENTSEARCH_DETAIL_RATE_LIMIT_COOLDOWN_MS },
    );
  }

  function isSeekProfilePath(pathname: string) {
    return pathname.includes("/talentsearch/profile/")
      || pathname.includes("/talentsearch/profiles/");
  }

  function isSeekProfilePage() {
    return isSeekProfilePath(win.location.pathname);
  }

  function isSeekTalentSearchListPage() {
    if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
    const { pathname, search } = win.location;
    if (isSeekProfilePath(pathname)) return false;
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
        href.includes(`/talentsearch/profiles/${encodeURIComponent(profileId)}`) ||
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
    const profileWorkHistory = Array.isArray(profile.workHistories)
      ? profile.workHistories
          .map((item) => buildSeekWorkHistoryItem(item))
          .filter(Boolean)
      : [];
    const resumeWorkHistory = Array.isArray(
      (profile.resume as Record<string, unknown> | undefined)?.resumeWorkHistories,
    )
      ? (
          (profile.resume as Record<string, unknown>).resumeWorkHistories as unknown[]
        )
          .map((item) => buildSeekWorkHistoryItem(item))
          .filter(Boolean)
      : [];
    const workHistory = mergeSeekDetailWorkHistory(
      profileWorkHistory,
      resumeWorkHistory,
    );
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
      'a[href*="/talentsearch/profiles/"], a[href*="/talentsearch/profile/"]',
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
      if (isMeaningfulSeekWorkHistoryDescription(description)) {
        described += 1;
        if (described >= minDescribed) return true;
      }
    }
    return false;
  }

  function getSeekOpenSidePanelDialog() {
    const dialogs = Array.from(
      doc.querySelectorAll('[role="dialog"], dialog'),
    );
    return dialogs.find((dialog) => {
      if (!(dialog instanceof Element)) return false;
      const hasCloseButton = !!dialog.querySelector(
        'button[aria-label="Close"], button[title="Close"]',
      );
      if (hasCloseButton) return true;
      const text = normalizeSeekDialogText(dialog.textContent || "");
      return /career history|cv preview|no interactions|we'?re working on it|can.?t show this profile right now/i.test(
        text,
      );
    }) || null;
  }

  function isSeekTemporaryUnavailableDialog(dialog: Element | null | undefined) {
    if (!(dialog instanceof Element)) return false;
    return /we'?re working on it|can.?t show this profile right now/i.test(
      normalizeSeekDialogText(dialog.textContent || ""),
    );
  }

  function getSeekDialogCloseButton(dialog: Element | null | undefined) {
    if (!(dialog instanceof Element)) return null;
    const byAria = dialog.querySelector(
      'button[aria-label="Close"], button[title="Close"]',
    );
    if (byAria instanceof HTMLElement) return byAria;
    const byText = Array.from(dialog.querySelectorAll("button"))
      .find((button) => /^close$/i.test(normalizeSeekDialogText(button.textContent || "")));
    return byText instanceof HTMLElement ? byText : null;
  }

  async function dismissSeekProfilePanel(
    { timeoutMs = 1200 }: { timeoutMs?: number } = {},
  ) {
    const dialog = getSeekOpenSidePanelDialog() || getSeekOpenProfileDialog();
    if (!(dialog instanceof Element)) return;

    try {
      const closeButton = getSeekDialogCloseButton(dialog);
      if (closeButton) {
        closeButton.click();
      } else {
        const active = doc.querySelector?.("[data-role='heading']") as Element | null;
        // Fallback to Escape if the explicit close control is unavailable.
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
      }
    } catch {
      // Best-effort; next click still works if the previous panel stays open.
    }

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      const remaining = getSeekOpenSidePanelDialog() || getSeekOpenProfileDialog();
      if (!(remaining instanceof Element)) {
        return;
      }
      await delay(50);
    }
  }

  function normalizeSeekDialogText(value: unknown) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n+ */g, "\n")
      .trim();
  }

  function getSeekDialogText(node: Element | null | undefined) {
    return normalizeSeekDialogText(node?.textContent || "");
  }

  function getSeekDialogMultilineText(node: Element | null | undefined) {
    if (!(node instanceof Element)) return "";
    const paragraphText = Array.from(node.querySelectorAll("p"))
      .map((paragraph) => normalizeSeekDialogText(paragraph.textContent || ""))
      .filter(Boolean);
    if (paragraphText.length > 0) {
      return paragraphText.join("\n");
    }
    return getSeekDialogText(node);
  }

  function getSeekOpenProfileDialog() {
    const dialogs = Array.from(
      doc.querySelectorAll('[role="dialog"], dialog'),
    );
    return dialogs.find((dialog) =>
      /career history/i.test(dialog.textContent || ""),
    ) || null;
  }

  function dialogMatchesSeekResume(dialog: Element, resume: unknown) {
    const expectedName =
      typeof (resume as Record<string, unknown> | null)?.name === "string"
        ? ((resume as Record<string, unknown>).name as string).trim()
        : "";
    if (!expectedName) return true;

    const headingTexts = Array.from(
      dialog.querySelectorAll("h1, h2, h3, [role='heading']"),
    )
      .map((heading) => getSeekDialogText(heading))
      .filter(Boolean);
    return headingTexts.includes(expectedName);
  }

  function extractSeekProfileDialogResume(resume: unknown) {
    const dialog = getSeekOpenProfileDialog();
    if (!(dialog instanceof Element) || !dialogMatchesSeekResume(dialog, resume)) {
      return null;
    }

    const careerHeading = Array.from(dialog.querySelectorAll("h1, h2, h3, h4"))
      .find((heading) => /^career history$/i.test(getSeekDialogText(heading)));
    const careerSection = careerHeading?.parentElement;
    if (!(careerSection instanceof Element)) {
      return null;
    }

    const workHistory = Array.from(careerSection.children)
      .filter((child) => child !== careerHeading)
      .map((child) => {
        if (!(child instanceof Element)) return null;

        const companyEl = child.querySelector('[data-testid="subHeading"]');
        const durationEl = child.querySelector('[data-testid="subHeadingSecondary"]');
        const descriptionEl = child.querySelector('[data-testid="description"]');
        const jobTitleEl =
          companyEl?.previousElementSibling instanceof Element
            ? companyEl.previousElementSibling
            : null;

        const jobTitle = getSeekDialogText(jobTitleEl);
        const companyName = getSeekDialogText(companyEl);
        const duration = getSeekDialogText(durationEl);
        const description = getSeekDialogMultilineText(descriptionEl);
        const raw = [jobTitle, companyName, duration].filter(Boolean).join(" · ");

        if (!raw && !description) return null;
        return {
          raw: raw || description,
          companyName: companyName || undefined,
          jobTitle: jobTitle || undefined,
          description: description || undefined,
        };
      })
      .filter(Boolean);

    if (workHistory.length === 0) {
      return null;
    }

    return { workHistory };
  }

  async function waitForSeekProfileDialogResume(
    resume: unknown,
    { timeoutMs = 0 }: { timeoutMs?: number } = {},
  ) {
    const effectiveTimeoutMs = Math.max(
      0,
      Math.min(
        Number.isFinite(timeoutMs) ? timeoutMs : 0,
        SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS,
      ),
    );
    const deadline = Date.now() + effectiveTimeoutMs;

    while (true) {
      const dialogResume = extractSeekProfileDialogResume(resume) as Record<string, unknown> | null;
      if (dialogResume && resumeHasWorkHistoryDescriptions(dialogResume, 1)) {
        return dialogResume;
      }

      if (Date.now() >= deadline) {
        return null;
      }

      await delay(100);
    }
  }

  async function waitForSeekTalentSearchDialogOutcome(
    resume: unknown,
    { timeoutMs = 0 }: { timeoutMs?: number } = {},
  ) {
    const effectiveTimeoutMs = Math.max(
      0,
      Math.min(
        Number.isFinite(timeoutMs) ? timeoutMs : 0,
        SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS,
      ),
    );
    const deadline = Date.now() + effectiveTimeoutMs;

    while (true) {
      if (isSeekProfileRateLimitError()) {
        return {
          kind: "rate-limited" as const,
          error: getSeekProfileErrorInfo(),
        };
      }
      const dialog = getSeekOpenSidePanelDialog() || getSeekOpenProfileDialog();
      if (dialog instanceof Element && isSeekTemporaryUnavailableDialog(dialog)) {
        return { kind: "unavailable" as const };
      }

      const dialogResume = extractSeekProfileDialogResume(resume) as Record<string, unknown> | null;
      if (dialogResume && resumeHasWorkHistoryDescriptions(dialogResume, 1)) {
        return { kind: "resume" as const, resume: dialogResume };
      }

      if (Date.now() >= deadline) {
        return { kind: "timeout" as const };
      }

      await delay(100);
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
    if (isTalentSearch) {
      const cooldownMs = seekTalentSearchDetailCooldownUntil - Date.now();
      if (cooldownMs > 0) {
        await delay(cooldownMs);
      }
    }
    const trigger = isTalentSearch
      ? findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings)
      : findSeekProfileTrigger(profileId);
    if (!(trigger instanceof HTMLElement)) {
      return resume;
    }

    const talentSearchUnavailableRetryDelayMs = 1500;
    const talentSearchUnavailableMaxRetries = 1;
    let attempt = 0;

    while (true) {
      if (attempt > 0 && isTalentSearch) {
        await delay(talentSearchUnavailableRetryDelayMs);
      }

      try {
        if (isTalentSearch) {
          await dismissSeekProfilePanel();
        }
        // Drop stale V3 payload so waiters cannot resolve against the previous card.
        apiSnapshot.seekProfile = null;
        apiSnapshot.seekProfileError = null;
        trigger.click();
        const timeoutMs = isTalentSearch ? SEEK_TALENTSEARCH_DETAIL_TIMEOUT_MS : 12000;
        if (isTalentSearch) {
          const dialogOutcome = await waitForSeekTalentSearchDialogOutcome(resume, {
            timeoutMs: Math.min(timeoutMs, 3000),
          });
          if (dialogOutcome.kind === "resume") {
            resetSeekTalentSearchRateLimitState();
            await delay(SEEK_TALENTSEARCH_DETAIL_SETTLE_MS);
            await dismissSeekProfilePanel();
            return mergeSeekListResumeWithDetail(resume, dialogOutcome.resume, true);
          }
          if (dialogOutcome.kind === "rate-limited") {
            noteSeekTalentSearchRateLimit(profileId);
            await dismissSeekProfilePanel();
            return resume;
          }
          if (dialogOutcome.kind === "unavailable") {
            await dismissSeekProfilePanel();
            if (attempt < talentSearchUnavailableMaxRetries) {
              attempt += 1;
              continue;
            }
            return resume;
          }
        }
        // For talentsearch, match by profileGuid (UUID); for recommended, match by numeric profileId
        const matchId = isTalentSearch ? (rec?.seekProfileGuid as string) || profileId : profileId;
        await waitForSeekProfileSnapshot(matchId, { timeoutMs });
        const [detailResume] = extractSeekProfileResume() as (Record<string, unknown> | undefined)[];
        if (!detailResume) {
          const dialogResume = isTalentSearch
            ? await waitForSeekProfileDialogResume(resume, { timeoutMs: 1000 })
            : extractSeekProfileDialogResume(resume) as Record<string, unknown> | null;
          if (isTalentSearch && dialogResume && resumeHasWorkHistoryDescriptions(dialogResume, 1)) {
            await delay(SEEK_TALENTSEARCH_DETAIL_SETTLE_MS);
          }
          await dismissSeekProfilePanel();
          if (dialogResume && resumeHasWorkHistoryDescriptions(dialogResume, 1)) {
            return mergeSeekListResumeWithDetail(resume, dialogResume, isTalentSearch);
          }
          return resume;
        }
        // For talentsearch, verify the detail profile matches by profileGuid or profileId
        if (isTalentSearch) {
          const detailGuid = (detailResume.seekProfileGuid as string) || "";
          const detailProfileId = (detailResume.profileId as string) || "";
          if (detailGuid !== profileId && detailProfileId !== profileId) {
            await dismissSeekProfilePanel();
            return resume;
          }
          // Merge: talentsearch detail may provide numeric profileId from V3 response
          const merged = mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
          resetSeekTalentSearchRateLimitState();
          await delay(SEEK_TALENTSEARCH_DETAIL_SETTLE_MS);
          await dismissSeekProfilePanel();
          return merged;
        }
        if (detailResume.profileId !== profileId) {
          return resume;
        }
        resetSeekTalentSearchRateLimitState();
        return mergeSeekListResumeWithDetail(resume, detailResume, isTalentSearch);
      } catch (error) {
        const dialogResume = isTalentSearch
          ? await waitForSeekProfileDialogResume(resume, { timeoutMs: 1000 })
          : extractSeekProfileDialogResume(resume) as Record<string, unknown> | null;
        if (dialogResume && resumeHasWorkHistoryDescriptions(dialogResume, 1)) {
          if (isTalentSearch) {
            await delay(SEEK_TALENTSEARCH_DETAIL_SETTLE_MS);
          }
          await dismissSeekProfilePanel();
          return mergeSeekListResumeWithDetail(resume, dialogResume, isTalentSearch);
        }
        const unavailableDialog = isTalentSearch
          ? getSeekOpenSidePanelDialog() || getSeekOpenProfileDialog()
          : null;
        if (
          isSeekTemporaryUnavailableDialog(unavailableDialog)
          && attempt < talentSearchUnavailableMaxRetries
        ) {
          await dismissSeekProfilePanel();
          attempt += 1;
          continue;
        }
        if (isTalentSearch && isSeekProfileRateLimitError()) {
          noteSeekTalentSearchRateLimit(profileId);
          await dismissSeekProfilePanel();
          return resume;
        }
        console.warn(
          "🎯 [Auto Sync] Failed to enrich Seek detail resume:",
          profileId,
          error,
        );
        await dismissSeekProfilePanel();
        return resume;
      }
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
    const byCurrentHref = doc.querySelector(
      `a[href*="/talentsearch/profiles/${escapeCssAttrValue(profileId)}"], a[href*="/talentsearch/profile/${escapeCssAttrValue(profileId)}"]`,
    );
    if (byCurrentHref instanceof HTMLElement) return byCurrentHref;
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
        return isMeaningfulSeekWorkHistoryDescription(description);
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

  function countSeekWorkHistoryDescriptions(entries: unknown[]) {
    return entries.filter((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const description = (entry as Record<string, unknown>).description;
      return isMeaningfulSeekWorkHistoryDescription(description);
    }).length;
  }

  function normalizeSeekWorkHistoryKeyPart(value: unknown) {
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().toLowerCase()
      : "";
  }

  function getSeekWorkHistoryDurationLabel(entry: unknown) {
    if (!entry || typeof entry !== "object") return "";
    const rec = entry as Record<string, unknown>;
    const durationLabel =
      typeof rec.durationLabel === "string" ? rec.durationLabel.trim() : "";
    if (durationLabel) return durationLabel;
    const raw = typeof rec.raw === "string" ? rec.raw.trim() : "";
    const parts = raw.split(" · ").map((part) => part.trim()).filter(Boolean);
    return parts.length >= 3 ? parts[parts.length - 1] : "";
  }

  function buildSeekWorkHistoryKeys(entry: unknown) {
    if (!entry || typeof entry !== "object") return [];
    const rec = entry as Record<string, unknown>;
    const title = normalizeSeekWorkHistoryKeyPart(rec.jobTitle);
    const company = normalizeSeekWorkHistoryKeyPart(rec.companyName);
    const duration = normalizeSeekWorkHistoryKeyPart(
      getSeekWorkHistoryDurationLabel(entry),
    );
    return [
      title && company && duration ? `${title}|${company}|${duration}` : "",
      title && company ? `${title}|${company}` : "",
      title && duration ? `${title}|${duration}` : "",
      company && duration ? `${company}|${duration}` : "",
    ].filter(Boolean);
  }

  function mergeSeekWorkHistoryEntry(
    primaryEntry: Record<string, unknown>,
    fallbackEntry: Record<string, unknown>,
  ) {
    const primaryDescription =
      typeof primaryEntry.description === "string"
        ? primaryEntry.description.trim()
        : "";
    const fallbackDescription =
      typeof fallbackEntry.description === "string"
        ? fallbackEntry.description.trim()
        : "";

    return {
      ...fallbackEntry,
      ...primaryEntry,
      raw:
        (typeof primaryEntry.raw === "string" && primaryEntry.raw.trim())
          ? primaryEntry.raw
          : fallbackEntry.raw,
      companyName:
        (typeof primaryEntry.companyName === "string" && primaryEntry.companyName.trim())
          ? primaryEntry.companyName
          : fallbackEntry.companyName,
      jobTitle:
        (typeof primaryEntry.jobTitle === "string" && primaryEntry.jobTitle.trim())
          ? primaryEntry.jobTitle
          : fallbackEntry.jobTitle,
      description:
        (isMeaningfulSeekWorkHistoryDescription(primaryDescription) && primaryDescription)
        || (isMeaningfulSeekWorkHistoryDescription(fallbackDescription) && fallbackDescription)
        || undefined,
      durationLabel:
        (typeof primaryEntry.durationLabel === "string" && primaryEntry.durationLabel.trim())
          ? primaryEntry.durationLabel
          : fallbackEntry.durationLabel,
    };
  }

  function mergeSeekDetailWorkHistory(primaryEntries: unknown[], fallbackEntries: unknown[]) {
    const primary = Array.isArray(primaryEntries) ? primaryEntries : [];
    const fallback = Array.isArray(fallbackEntries) ? fallbackEntries : [];
    const fallbackDescribedCount = countSeekWorkHistoryDescriptions(fallback);
    if (fallback.length === 0 || fallbackDescribedCount === 0) {
      return primary;
    }

    const fallbackByKey = new Map<string, number[]>();
    for (const [index, entry] of fallback.entries()) {
      if (!entry || typeof entry !== "object") continue;
      const description = (entry as Record<string, unknown>).description;
      if (!isMeaningfulSeekWorkHistoryDescription(description)) continue;
      for (const key of buildSeekWorkHistoryKeys(entry)) {
        const current = fallbackByKey.get(key) || [];
        current.push(index);
        fallbackByKey.set(key, current);
      }
    }

    const usedFallbackIndexes = new Set<number>();
    const merged = primary.map((entry, index) => {
      if (!entry || typeof entry !== "object") return entry;
      const primaryEntry = entry as Record<string, unknown>;
      const primaryDescription =
        typeof primaryEntry.description === "string"
          ? primaryEntry.description.trim()
          : "";
      if (isMeaningfulSeekWorkHistoryDescription(primaryDescription)) {
        return primaryEntry;
      }

      let matchedIndex: number | null = null;
      for (const key of buildSeekWorkHistoryKeys(primaryEntry)) {
        const candidates = fallbackByKey.get(key) || [];
        const nextIndex = candidates.find((candidateIndex) => !usedFallbackIndexes.has(candidateIndex));
        if (typeof nextIndex === "number") {
          matchedIndex = nextIndex;
          break;
        }
      }

      if (matchedIndex === null) {
        const sameIndexCandidate = fallback[index];
        const sameIndexDescription =
          sameIndexCandidate && typeof sameIndexCandidate === "object"
            ? (sameIndexCandidate as Record<string, unknown>).description
            : "";
        if (
          !usedFallbackIndexes.has(index)
          && isMeaningfulSeekWorkHistoryDescription(sameIndexDescription)
        ) {
          matchedIndex = index;
        }
      }

      if (matchedIndex === null) {
        return primaryEntry;
      }

      usedFallbackIndexes.add(matchedIndex);
      return mergeSeekWorkHistoryEntry(
        primaryEntry,
        fallback[matchedIndex] as Record<string, unknown>,
      );
    });

    if (
      countSeekWorkHistoryDescriptions(merged) === 0
      && fallbackDescribedCount > 0
    ) {
      return fallback;
    }

    return merged;
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
      rec.displayDescription,
    ];
    let description = "";
    for (const candidate of descriptionCandidates) {
      if (typeof candidate === "string" && isMeaningfulSeekWorkHistoryDescription(candidate)) {
        description = candidate.trim();
        break;
      }
      if (Array.isArray(candidate)) {
        const joined = candidate
          .map((line) => {
            if (typeof line === "string") return line.trim();
            if (line && typeof line === "object") {
              const descriptionText =
                typeof (line as Record<string, unknown>).description === "string"
                  ? ((line as Record<string, unknown>).description as string).trim()
                  : "";
              if (!descriptionText) return "";
              return (line as Record<string, unknown>).isBullet === true
                ? `• ${descriptionText}`
                : descriptionText;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (isMeaningfulSeekWorkHistoryDescription(joined)) {
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
      durationLabel: durationLabel || undefined,
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
