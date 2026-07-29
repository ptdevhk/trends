/**
 * Extraction pipeline orchestrators — site-generic wait helpers, pagination,
 * resume extraction dispatch, detail backfill. Dependencies injected from content.ts.
 */

import { unwrapSeekProfileSnapshot } from "./seek-extractor";

export interface ExtractionPipelineDeps extends Record<string, unknown> {
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  apiSnapshot: Record<string, unknown>;
  SELECTORS: Record<string, string>;
  getApiSnapshotCount: () => number;
  getSeekCurrentCandidateCount: () => number;
  isExtractionReady: () => boolean;
  isJob51RateLimitedPage: () => boolean;
  JOB51_RATE_LIMIT_ERROR_MESSAGE: string;
  getSeekCandidateIdentity: (candidate: unknown) => { profileId: string; profileType: string };
  chrome: { storage: { local: { get: (defaults: unknown, cb: (items: unknown) => void) => void } } };
  DEFAULT_COLLECTION_GUARDS: unknown;
  CONTENT_SCRIPT_SOURCE: string;
  JOB51_NEXT_PAGE_EVENT: string;
  document: Document;
  window: Window;
  resolveCurrentJob51DetailFetchDelayMs: () => number;
  JOB51_DETAIL_FETCH_CONCURRENCY: number;
  enrich51JobSearchResumeWithDetail: (resume: unknown, extractedAt: string) => Promise<{ resume: unknown; enriched: boolean; rateLimited: boolean }>;
  syncCurrentPageToServer: (resumes: unknown[]) => Promise<unknown>;
  delay: (ms: number) => Promise<void>;
  pipelineState: { runId: number; chain: Promise<unknown> };
  isJob51DetailPage: () => boolean;
  filterCurrentResumesByAgeRange: (resumes: unknown) => unknown[];
  extractJob51DetailResume: () => unknown[];
  extract51JobResumes: () => unknown[];
  isSeekProfileMode: () => boolean;
  hasSeekProfileSnapshot: () => boolean;
  extractSeekProfileResume: () => unknown[];
  hasSeekTalentSearchSnapshot: () => boolean;
  extractSeekTalentSearchResumes: () => unknown[];
  hasSeekListSnapshot: () => boolean;
  extractSeekResumes: () => unknown[];
  isJob5156DetailPage: () => boolean;
  extractJob5156DetailResume: () => unknown[];
  getApiRowForIndex: (index: number) => unknown;
  extractSingleResume: (card: Element, apiRow: unknown) => Record<string, unknown>;
  isJob51DetailReady: () => boolean;
  getSeekProfileRequest: () => unknown;
  getSeekTalentSearchRequest: () => unknown;
  getSeekRecommendedRequest: () => unknown;
  SEEK_PROFILE_TYPE: string;
  getJob5156DetailRoot: () => unknown;
  getSeekNextPageLinkForMode: () => HTMLElement | null;
  getPaginationInfo: () => { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };
  asHTMLElement: (el: unknown) => HTMLElement | null;
}

export function createExtractionPipeline(deps: ExtractionPipelineDeps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    SELECTORS,
    getApiSnapshotCount,
    getSeekCurrentCandidateCount,
    isExtractionReady,
    isJob51RateLimitedPage,
    JOB51_RATE_LIMIT_ERROR_MESSAGE,
    getSeekCandidateIdentity,
    chrome,
    DEFAULT_COLLECTION_GUARDS,
    CONTENT_SCRIPT_SOURCE,
    JOB51_NEXT_PAGE_EVENT,
    document: doc,
    window: win,
    resolveCurrentJob51DetailFetchDelayMs,
    JOB51_DETAIL_FETCH_CONCURRENCY,
    enrich51JobSearchResumeWithDetail,
    syncCurrentPageToServer,
    delay,
    pipelineState,
    isJob51DetailPage,
    filterCurrentResumesByAgeRange,
    extractJob51DetailResume,
    extract51JobResumes,
    isSeekProfileMode,
    hasSeekProfileSnapshot,
    extractSeekProfileResume,
    hasSeekTalentSearchSnapshot,
    extractSeekTalentSearchResumes,
    hasSeekListSnapshot,
    extractSeekResumes,
    isJob5156DetailPage,
    extractJob5156DetailResume,
    getApiRowForIndex,
    extractSingleResume,
    isJob51DetailReady,
    getSeekProfileRequest,
    getSeekTalentSearchRequest,
    getSeekRecommendedRequest,
    SEEK_PROFILE_TYPE,
    getJob5156DetailRoot,
    getSeekNextPageLinkForMode,
    getPaginationInfo,
    asHTMLElement,
  } = deps;

  // --- Collection guards ---

  const GUARD_FIELD_NAMES = new Set([
    "experience",
    "jobIntention",
    "selfIntro",
    "expectedSalary",
    "workHistory",
    "profileEducation",
    "projectExperience",
    "skills",
    "licences",
  ]);

  const GUARD_ARRAY_FIELD_NAMES = new Set([
    "workHistory",
    "profileEducation",
    "projectExperience",
    "skills",
    "licences",
  ]);

  function getDefaultGuardFields(sourceKey: string): string[] {
    const guards =
      (DEFAULT_COLLECTION_GUARDS as Record<string, unknown>)?.[sourceKey];
    return parseGuardFieldNames(
      typeof guards === "string" ? guards : "",
    );
  }

  function applyDefaultGuards(resumes: unknown[], sourceKey: string): unknown[] {
    if (sourceKey !== SOURCE_KEYS.JOB51 &&
        sourceKey !== SOURCE_KEYS.JOB5156 &&
        sourceKey !== SOURCE_KEYS.SEEK) {
      return resumes;
    }
    const guardFields = getDefaultGuardFields(sourceKey);
    if (guardFields.length === 0) return resumes;
    return resumes.map((r) => applyCollectionGuards(r, guardFields));
  }

  async function loadCollectionGuards() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        { collectionGuards: DEFAULT_COLLECTION_GUARDS },
        (items) => resolve((items as Record<string, unknown>).collectionGuards || {}),
      );
    });
  }

  function parseGuardFieldNames(csv) {
    if (!csv || typeof csv !== "string") return [];
    return Array.from(
      new Set(
        csv
          .split(",")
          .map((field) => field.trim())
          .filter((field) => GUARD_FIELD_NAMES.has(field)),
      ),
    );
  }

  function applyCollectionGuards(resume, guardFieldNames) {
    if (
      !resume ||
      typeof resume !== "object" ||
      !Array.isArray(guardFieldNames) ||
      guardFieldNames.length === 0
    ) {
      return resume;
    }

    const guarded = { ...resume };
    for (const field of guardFieldNames) {
      guarded[field] = GUARD_ARRAY_FIELD_NAMES.has(field) ? [] : "";
    }
    return guarded;
  }

  // --- Pagination helpers ---

  function isDisabledPaginationControl(control) {
    if (!control) return true;
    return (
      control.hasAttribute("disabled") ||
      control.classList.contains("disabled") ||
      control.classList.contains("is-disabled") ||
      control.getAttribute("aria-disabled") === "true" ||
      control.getAttribute("aria-hidden") === "true" ||
      control.getAttribute("tabindex") === "-1"
    );
  }

  // --- Wait helpers ---

  function waitForResumeCards({ timeoutMs = 30000, minCount = 1 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (done) return;
        const count = doc.querySelectorAll(SELECTORS.resumeCard).length;
        if (count >= minCount) {
          done = true;
          cleanup();
          resolve(count);
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for resume cards"));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 500);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  function waitForApiRows({ timeoutMs = 15000, minCount = 1 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (done) return;
        if (
          getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
          isJob51RateLimitedPage()
        ) {
          done = true;
          cleanup();
          reject(new Error(JOB51_RATE_LIMIT_ERROR_MESSAGE));
          return;
        }
        const count = getApiSnapshotCount();
        const seekCandidateCount =
          getCurrentSourceKey() === SOURCE_KEYS.SEEK
            ? getSeekCurrentCandidateCount()
            : 0;
        if (
          count >= minCount ||
          seekCandidateCount >= minCount ||
          (getCurrentSourceKey() === SOURCE_KEYS.JOB51 && isExtractionReady())
        ) {
          done = true;
          cleanup();
          resolve(Math.max(count, seekCandidateCount));
        } else if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error("Timed out waiting for API rows"));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 300);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  async function waitForExtractionData({ timeoutMs = 30000, minCount = 1 } = {}) {
    if (
      getCurrentSourceKey() === SOURCE_KEYS.SEEK ||
      getCurrentSourceKey() === SOURCE_KEYS.JOB51
    ) {
      return waitForApiRows({ timeoutMs, minCount });
    }

    const count = await waitForResumeCards({ timeoutMs, minCount });
    try {
      await waitForApiRows({ timeoutMs, minCount });
    } catch {
      // API rows are optional for Job5156 DOM extraction.
    }
    return count;
  }

  function clearCapturedResultsForNextPage() {
    apiSnapshot.searchRows = null;
    apiSnapshot.job51SearchRows = null;
    // Preserve job51LastSearchRequest across page transitions so that
    // getPaginationInfo() can track the current page index from the last
    // captured request. It will be overwritten by the next API response.
    // apiSnapshot.job51LastSearchRequest = null;
    apiSnapshot.job51DetailPayload = null;
    if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
      apiSnapshot.seekRecommendedCandidates = null;
      apiSnapshot.seekRecommendedRequest = null;
      apiSnapshot.seekProfile = null;
      apiSnapshot.seekProfileError = null;
      apiSnapshot.seekProfileRequest = null;
      apiSnapshot.seekTalentSearch = null;
      apiSnapshot.seekTalentSearchRequest = null;
    }
  }

  function waitForSeekProfileSnapshot(profileId, { timeoutMs = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (done) return;
        // Unwrap V3 envelope if capture stored the wrapper (defense in depth).
        const snapshot = unwrapSeekProfileSnapshot(apiSnapshot.seekProfile);
        if (snapshot && apiSnapshot.seekProfile !== snapshot) {
          apiSnapshot.seekProfile = snapshot;
        }
        const identity = snapshot ? getSeekCandidateIdentity(snapshot) : null;
        // Match by profileId (numeric) or profileGuid (UUID for talentsearch)
        const snapshotGuid =
          typeof snapshot?.profileGuid === "string" ? snapshot.profileGuid : "";
        if (
          identity?.profileId === String(profileId) ||
          snapshotGuid === String(profileId)
        ) {
          done = true;
          cleanup();
          resolve(snapshot);
          return;
        }
        if (Date.now() > deadline) {
          done = true;
          cleanup();
          reject(new Error(`Timed out waiting for Seek profile ${profileId}`));
        }
      };

      const cleanup = () => {
        clearInterval(intervalId);
        observer.disconnect();
      };

      const intervalId = setInterval(check, 200);
      const observer = new MutationObserver(check);
      observer.observe(doc.body || doc.documentElement, {
        childList: true,
        subtree: true,
      });
      check();
    });
  }

  function isElementVisible(element) {
    if (!element) return false;
    const style = win.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  // --- Resume extraction orchestration ---

  function extractResumes() {
    const sourceKey = getCurrentSourceKey();
    let resumes: unknown[] = [];

    if (isJob51DetailPage()) {
      resumes = filterCurrentResumesByAgeRange(extractJob51DetailResume());
    } else if (sourceKey === SOURCE_KEYS.JOB51) {
      resumes = filterCurrentResumesByAgeRange(extract51JobResumes());
    } else if (sourceKey === SOURCE_KEYS.SEEK) {
      if (isSeekProfileMode()) {
        if (hasSeekProfileSnapshot()) {
          resumes = extractSeekProfileResume();
        }
      } else if (hasSeekTalentSearchSnapshot()) {
        resumes = extractSeekTalentSearchResumes();
      } else {
        resumes = extractSeekResumes();
      }
    } else if (isJob5156DetailPage()) {
      resumes = filterCurrentResumesByAgeRange(extractJob5156DetailResume());
    } else {
      const cards = doc.querySelectorAll(SELECTORS.resumeCard);
      cards.forEach((card, index) => {
        try {
          const apiRow = getApiRowForIndex(index) as Record<string, unknown> | null;
          const resume = extractSingleResume(card, apiRow);
          resume.pageIndex = index + 1;
          if (apiRow) {
            resume.resumeId = apiRow.resumeId ?? "";
            resume.perUserId = apiRow.perUserId ?? "";
          }
          resumes.push(resume);
        } catch (error) {
          console.error(`Error extracting resume ${index}:`, error);
        }
      });
      resumes = filterCurrentResumesByAgeRange(resumes);
    }

    return applyDefaultGuards(resumes, sourceKey) as unknown[];
  }

  /**
   * Extract raw HTML/text from resume cards (no predefined schema).
   * @param {Object} [options]
   * @param {boolean} [options.includePage=false] - Include full page HTML
   * @returns {Object} - Raw payload
   */
  function extractResumesRaw(options: Record<string, unknown> = {}) {
    const includePage = !!(
      options &&
      typeof options === "object" &&
      options.includePage
    );

    if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
      const seekProfile =
        isSeekProfileMode() && hasSeekProfileSnapshot()
          ? apiSnapshot.seekProfile
          : null;
      const seekProfileIdentity = seekProfile
        ? getSeekCandidateIdentity(seekProfile)
        : null;
      const seekTalentSearchCandidates =
        !seekProfile && hasSeekTalentSearchSnapshot()
          ? apiSnapshot.seekTalentSearch
          : null;
      const candidates =
        (seekTalentSearchCandidates ||
        (!seekProfile && hasSeekListSnapshot()
          ? apiSnapshot.seekRecommendedCandidates
          : [])) as unknown[];
      const seekRequest = seekProfile
        ? getSeekProfileRequest()
        : seekTalentSearchCandidates
          ? getSeekTalentSearchRequest()
          : getSeekRecommendedRequest();
      const cards = seekProfile
        ? [
            {
              index: 1,
              profileId: seekProfileIdentity?.profileId || "",
              profileType: seekProfileIdentity?.profileType || SEEK_PROFILE_TYPE,
              text: JSON.stringify(seekProfile, null, 2),
            },
          ]
        : candidates.map((candidate, index) => {
            const cand = candidate as Record<string, unknown>;
            // Talent-search nodes use profileGuid (UUID); recommended nodes use numeric profileId
            const profileId = seekTalentSearchCandidates
              ? typeof cand?.profileGuid === "string" && cand.profileGuid
                ? cand.profileGuid
                : ""
              : getSeekCandidateIdentity(candidate).profileId;
            const profileType = SEEK_PROFILE_TYPE;
            return {
              index: index + 1,
              profileId,
              profileType,
              text: JSON.stringify(candidate, null, 2),
            };
          });

      if (seekProfile || candidates.length > 0) {
        const payload: Record<string, unknown> = {
          url: win.location.href,
          extractedAt: new Date().toISOString(),
          count: cards.length,
          cards,
          api: {
            lastSearchAt: apiSnapshot.lastSearchAt,
            lastUpdatedAt: apiSnapshot.lastUpdatedAt,
            searchRowCount: cards.length,
            sourceKey: SOURCE_KEYS.SEEK,
            operationName: apiSnapshot.lastOperationName,
            request: seekProfile
              ? getSeekProfileRequest()
              : seekRequest,
          },
        };

        if (includePage) {
          payload.pageHtml = doc.documentElement.outerHTML;
        }

        return payload;
      }
    }

    if (isJob51DetailPage() && isJob51DetailReady()) {
      const detailResumes = extractJob51DetailResume();
      const detailResume = detailResumes[0] as Record<string, unknown> | null;
      const payload: Record<string, unknown> = {
        url: win.location.href,
        extractedAt: new Date().toISOString(),
        count: detailResumes.length,
        cards: [
          {
            index: 1,
            resumeId: detailResume?.resumeId || "",
            perUserId: detailResume?.perUserId || "",
            text: JSON.stringify(
              detailResume?.rawData || apiSnapshot.job51DetailPayload,
              null,
              2,
            ),
          },
        ],
        api: {
          lastSearchAt: apiSnapshot.lastSearchAt,
          lastUpdatedAt: apiSnapshot.lastUpdatedAt,
          searchRowCount: detailResumes.length,
          sourceKey: SOURCE_KEYS.JOB51,
          operationName: apiSnapshot.lastOperationName,
          request: apiSnapshot.job51AuthContext,
          payload: apiSnapshot.job51DetailPayload,
        },
      };

      if (includePage) {
        payload.pageHtml = doc.documentElement.outerHTML;
      }

      return payload;
    }

    const detailResumes = isJob5156DetailPage()
      ? extractJob5156DetailResume()
      : [];
    const detailRoot = getJob5156DetailRoot();
    const detailRootElement =
      detailRoot instanceof HTMLElement ? detailRoot : null;
    const items =
      detailResumes.length > 0
        ? [
            {
              index: 1,
              resumeId: (detailResumes[0] as Record<string, unknown>)?.resumeId || "",
              perUserId: "",
              html: (detailRoot as HTMLElement | null)?.outerHTML || "",
              text: detailRootElement?.innerText || (detailRoot as HTMLElement | null)?.textContent || "",
            },
          ]
        : Array.from(doc.querySelectorAll(SELECTORS.resumeCard)).map(
            (card, index) => {
              const el = card as HTMLElement;
              const apiRow = getApiRowForIndex(index) as Record<string, unknown> | null;
              return {
                index: index + 1,
                resumeId: apiRow?.resumeId ?? "",
                perUserId: apiRow?.perUserId ?? "",
                html: el.outerHTML,
                text: el.innerText,
              };
            },
          );

    const payload: Record<string, unknown> = {
      url: win.location.href,
      extractedAt: new Date().toISOString(),
      count: items.length,
      cards: items,
      api: {
        lastSearchAt: apiSnapshot.lastSearchAt,
        lastUpdatedAt: apiSnapshot.lastUpdatedAt,
        searchRowCount: Array.isArray(apiSnapshot.searchRows)
          ? apiSnapshot.searchRows.length
          : 0,
      },
    };

    if (includePage) {
      payload.pageHtml = doc.documentElement.outerHTML;
    }

    return payload;
  }

  // --- Pagination ---

  function goToNextPageInternal() {
    const sourceKey = getCurrentSourceKey();
    if (sourceKey === SOURCE_KEYS.SEEK) {
      const nextBtn = getSeekNextPageLinkForMode();
      if (!nextBtn || isDisabledPaginationControl(nextBtn)) return false;
      nextBtn.click();
      return true;
    }
    // 51job eHire uses infinite scroll — dispatch a custom event that
    // page-hook.js (MAIN world) intercepts to call Vue listToBottom().
    if (sourceKey === SOURCE_KEYS.JOB51) {
      const pagination = getPaginationInfo();
      if (!pagination.hasNextPage) return false;
      win.postMessage(
          { source: CONTENT_SCRIPT_SOURCE, action: JOB51_NEXT_PAGE_EVENT },
          "*",
        );
      return true;
    }
    const nextBtn = asHTMLElement(doc.querySelector(SELECTORS.nextPageBtn));
    if (!nextBtn || isDisabledPaginationControl(nextBtn)) return false;
    nextBtn.click();
    return true;
  }

  // --- Detail enrichment / backfill ---

  async function enrich51JobSearchResumesWithDetail(resumes: unknown[], options: Record<string, unknown> = {}) {
    if (!Array.isArray(resumes) || resumes.length === 0) return [];

    const extractedAt = new Date().toISOString();
    const interBatchDelayMs =
      typeof options.interBatchDelayMs === "number" &&
      Number.isFinite(options.interBatchDelayMs)
        ? options.interBatchDelayMs
        : resolveCurrentJob51DetailFetchDelayMs();
    const shouldContinue =
      typeof options.shouldContinue === "function"
        ? options.shouldContinue
        : () => true;
    const enriched = [];
    let enrichedCount = 0;

    let rateLimited = false;

    for (
      let start = 0;
      start < resumes.length;
      start += JOB51_DETAIL_FETCH_CONCURRENCY
    ) {
      if (!shouldContinue() || rateLimited) {
        break;
      }

      const batch = resumes.slice(
        start,
        start + JOB51_DETAIL_FETCH_CONCURRENCY,
      );
      const batchResults = await Promise.all(
        batch.map((resume) =>
          enrich51JobSearchResumeWithDetail(resume, extractedAt),
        ),
      );

      for (const result of batchResults) {
        if (result?.resume) {
          enriched.push(result.resume);
        }
        if (result?.enriched) {
          enrichedCount += 1;
        }
        if (result?.rateLimited) {
          rateLimited = true;
        }
      }

      console.log(
        `51job detail enrichment: ${Math.min(start + batch.length, resumes.length)}/${resumes.length} (${enrichedCount} enriched)`,
      );

      if (rateLimited || !shouldContinue()) {
        break;
      }

      if (start + JOB51_DETAIL_FETCH_CONCURRENCY < resumes.length) {
        await delay(interBatchDelayMs);
      }
    }

    return enriched;
  }

  function queueJob51DetailBackfill(resumes: unknown[], context: Record<string, unknown> = {}) {
    if (!Array.isArray(resumes) || resumes.length === 0) {
      return Promise.resolve(null);
    }

    const runId =
      typeof context.runId === "number" && Number.isFinite(context.runId)
        ? context.runId
        : null;
    const isCancelled = () =>
      runId !== null && runId !== pipelineState.runId;

    const task = async () => {
      const detailFetchDelayMs = resolveCurrentJob51DetailFetchDelayMs();

      if (isCancelled()) {
        console.log("51job detail backfill skipped", {
          count: resumes.length,
          currentPage: context.currentPage,
          totalPages: context.totalPages,
        });
        return null;
      }

      console.log("51job detail backfill queued", {
        count: resumes.length,
        currentPage: context.currentPage,
        totalPages: context.totalPages,
        delayMs: detailFetchDelayMs,
        concurrency: JOB51_DETAIL_FETCH_CONCURRENCY,
      });

      const enrichedResumes = await enrich51JobSearchResumesWithDetail(resumes, {
        interBatchDelayMs: detailFetchDelayMs,
        shouldContinue: () => !isCancelled(),
      });
      if (!Array.isArray(enrichedResumes) || enrichedResumes.length === 0) {
        return null;
      }
      if (isCancelled()) {
        console.log("51job detail backfill cancelled", {
          count: resumes.length,
          currentPage: context.currentPage,
          totalPages: context.totalPages,
        });
        return null;
      }

      const response = await syncCurrentPageToServer(enrichedResumes) as Record<string, unknown>;
      if (!response?.success) {
        throw response?.error || response || "51job detail backfill failed";
      }

      console.log("51job detail backfill synced", {
        submitted:
          typeof response.submitted === "number"
            ? response.submitted
            : enrichedResumes.length,
        inserted: typeof response.inserted === "number" ? response.inserted : 0,
        updated: typeof response.updated === "number" ? response.updated : 0,
        currentPage: context.currentPage,
        totalPages: context.totalPages,
      });

      return response;
    };

    const scheduled = pipelineState.chain.catch(() => null).then(task);
    pipelineState.chain = scheduled.catch((error) => {
      console.warn("51job detail backfill failed:", error);
      return null;
    });
    return scheduled;
  }

  return {
    loadCollectionGuards,
    parseGuardFieldNames,
    applyCollectionGuards,
    isDisabledPaginationControl,
    waitForResumeCards,
    waitForApiRows,
    waitForExtractionData,
    clearCapturedResultsForNextPage,
    waitForSeekProfileSnapshot,
    isElementVisible,
    extractResumes,
    extractResumesRaw,
    goToNextPageInternal,
    enrich51JobSearchResumesWithDetail,
    queueJob51DetailBackfill,
  };
}
