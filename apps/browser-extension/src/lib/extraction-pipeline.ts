// @ts-nocheck
/**
 * Extraction pipeline orchestrators — site-generic wait helpers, pagination,
 * resume extraction dispatch, detail backfill. Dependencies injected from content.ts.
 */

export function createExtractionPipeline(deps) {
  const {
    getCurrentSourceKey,
    SOURCE_KEYS,
    apiSnapshot,
    SELECTORS,
    getApiSnapshotCount,
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
  } = deps;

  // --- Collection guards ---

  const GUARD_ARRAY_FIELD_NAMES = new Set([
    "workHistory",
    "profileEducation",
    "projectExperience",
    "skills",
    "licences",
  ]);

  async function loadCollectionGuards() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        { collectionGuards: DEFAULT_COLLECTION_GUARDS },
        (items) => resolve(items.collectionGuards || {}),
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
          .filter((field) => GUARD_ARRAY_FIELD_NAMES.has(field)),
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
        if (
          count >= minCount ||
          (getCurrentSourceKey() === SOURCE_KEYS.JOB51 && isExtractionReady())
        ) {
          done = true;
          cleanup();
          resolve(count);
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
        const snapshot = apiSnapshot.seekProfile;
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
  };
}
