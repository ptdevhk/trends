// @ts-nocheck
import {
  filterResumesByAgeRange,
  getAgeRangeFromUrl,
  normalizeOptionalPositiveInt,
} from "./lib/job51-age-filter";
import {
  EHIRE_51JOB_HOST,
  EHIRE_51JOB_PROFILE_URL_PREFIX,
  buildJob51DetailResumeFromPayload,
  normalizeJob51MultilineText,
  normalizeJob51Text,
} from "./lib/job51-detail-parser";
import {
  resolveJob51AutoSyncDetailWaitMode,
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
} from "./lib/job51-collection-config";
import {
  collectJob5156SectionItemsByHeading,
  isMeaningfulJob5156WorkHistoryEntry,
} from "./lib/job5156-detail-utils";
import {
  buildWorkHistoryRawParts,
  normalizeResumeMultilineText,
  normalizeResumeText,
} from "./lib/resume-text-utils";
import { createSeekExtractor } from "./lib/seek-extractor";
import { createJob5156Extractor } from "./lib/job5156-extractor";
import { createJob51SearchExtractor } from "./lib/job51-search-extractor";
import { createExtractionPipeline } from "./lib/extraction-pipeline";
import { createSnapshotCollector } from "./lib/snapshot-collector";
import { createAutoActions } from "./lib/auto-actions";
import { createUiUtils } from "./lib/ui-utils";
import { createPaginationUtils } from "./lib/pagination-utils";
import { createDomUtils, delay } from "./lib/dom-utils";
import { createResumeExtractor } from "./lib/resume-extractor";
import { createSyncStatusWidget } from "./lib/sync-status-widget";
import { createAutoSyncRunner } from "./lib/auto-sync-runner";
import {
  DEFAULT_COLLECTION_GUARDS,
  GUARD_FIELD_NAMES,
  GUARD_ARRAY_FIELD_NAMES,
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,
} from "./lib/collection-guards";
import {
  SELECTORS,
  AUTO_EXPORT_PARAM,
  AUTO_SYNC_PARAM,
  AUTO_LIMIT_PARAM,
  AUTO_MAX_PAGES_PARAM,
  AUTO_MIN_AGE_PARAM,
  AUTO_MAX_AGE_PARAM,
  AUTO_SEARCH_PARAM,
  AUTO_LOCATION_PARAM,
  AUTO_KEYWORD_MODE_PARAM,
  SAMPLE_NAME_PARAM,
  JOB5156_HOST,
  SEEK_HOST_SUFFIX,
  JOB5156_PROFILE_URL_PREFIX,
  SOURCE_KEYS,
  SEEK_PROFILE_TYPE,
  KEYWORD_MODE_CONCAT,
  KEYWORD_MODE_SPACED,
  JOB51_PAGE_COOLDOWN_MS,
  JOB51_RATE_LIMIT_ERROR_MESSAGE,
  API_CAPTURE_SOURCE,
  EXTERNAL_ACCESS_KEY,
  PAGE_BRIDGE_REQUEST_EVENT,
  PAGE_BRIDGE_RESPONSE_EVENT,
  PAGE_BRIDGE_REQUEST_ATTR,
  PAGE_BRIDGE_RESPONSE_ATTR,
  JOB51_NEXT_PAGE_EVENT,
  CONTENT_SCRIPT_SOURCE,
  JOB5156_DETAIL_FETCH_TIMEOUT_MS,
  JOB5156_DETAIL_FETCH_CONCURRENCY,
  JOB51_DETAIL_FETCH_TIMEOUT_MS,
  JOB51_DETAIL_FETCH_CONCURRENCY,
  DEFAULT_SEEK_PAGE_SIZE,
  LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY,
} from "./lib/content-constants";

/**
 * 智通直聘 Resume Collector - Content Script
 * Extracts resume data from hr.job5156.com/search page
 */

let autoExportTriggered = false;

// Capture auto-sync params from the initial URL at module init (document_start).
// SEEK's SPA may strip unknown query params via history.replaceState before the
// content script's runtime code checks window.location.search. Saving to
// sessionStorage at parse time preserves the flag across SPA navigations within
// the same tab. sessionStorage is shared between ISOLATED and MAIN worlds.
const INITIAL_URL_CAPTURED_PARAMS = (() => {
  try {
    const url = new URL(window.location.href);
    const val = url.searchParams.get(AUTO_SYNC_PARAM);
    if (val) {
      sessionStorage.setItem("tr_auto_sync_captured", val);
      sessionStorage.setItem("tr_auto_sync_initial_url", window.location.href);
      // Also persist SEEK-specific search params that SEEK's SPA may strip
      // via history.replaceState. These are needed for the correct search context.
      const seekParams = ["keywords", "roleTitles", "matchAll", "tr_max_age"];
      for (const p of seekParams) {
        const v = url.searchParams.get(p);
        if (v !== null) {
          sessionStorage.setItem(`tr_seek_param_${p}`, v);
        }
      }
    }
    return { autoSync: val, initialUrl: window.location.href };
  } catch {
    return { autoSync: null, initialUrl: null };
  }
})();


const apiSnapshot = {
  searchRows: null,
  job51SearchRows: null,
  job51Total: null,
  job51LastSearchRequest: null,
  job51AuthContext: null,
  job51DetailPayload: null,
  attachInfo: null,
  chatInfo: null,
  insightInfo: null,
  seekRecommendedCandidates: null,
  seekRecommendedRequest: null,
  seekProfile: null,
  seekProfileRequest: null,
  seekTalentSearch: null,
  seekTalentSearchRequest: null,
  lastUpdatedAt: null,
  lastSearchAt: null,
  lastUrl: null,
  lastSourceKey: null,
  lastOperationName: null,
};

let job51DetailBackfillChain = Promise.resolve();
let job51DetailBackfillRunId = 0;
const pipelineState = {
  get chain() { return job51DetailBackfillChain; },
  set chain(v) { job51DetailBackfillChain = v; },
  get runId() { return job51DetailBackfillRunId; },
  set runId(v) { job51DetailBackfillRunId = v; },
};

const _paginationUtils = createPaginationUtils({
  getCurrentSourceKey,
  SOURCE_KEYS,
  isJob51DetailPage,
  isJob5156DetailPage,
  isJob51DetailReady,
  isJob5156DetailReady,
  getSeekPaginationInfo,
  getSeekNextPageLinkForMode,
  getCurrentSeekMode,
  apiSnapshot,
  normalizeOptionalPositiveInt,
  doc: document,
  win: window,
  SELECTORS,
});
const {
  getPaginationInfo,
  getNextPageButtonState,
  waitForPagination,
} = _paginationUtils;

const _uiUtils = createUiUtils({
  win: window,
  doc: document,
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
  makeRandomId,
  getPaginationInfo,
  getExternalAccessorStatus,
  getAgeRangeFromUrl,
  filterResumesByAgeRange,
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
  resolveJob51AutoSyncDetailWaitMode,
  isJob51DetailPage,
  chrome,
});
const {
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
} = _uiUtils;

const _domUtils = createDomUtils({
  win: window,
  doc: document,
  getPaginationInfo,
});
const {
  waitForPageTransition,
  isElementVisible,
  asHTMLElement,
  setInputValue,
  fireMouseEvent,
  activateElement,
  findVueParentByName,
} = _domUtils;

const _seekExtractor = createSeekExtractor({
  getCurrentSourceKey,
  SOURCE_KEYS,
  apiSnapshot,
  normalizeOptionalPositiveInt,
  DEFAULT_SEEK_PAGE_SIZE,
  SEEK_PROFILE_TYPE,
  persistLatestAutoSyncSummary,
  // Extraction deps
  win: window,
  doc: document,
  // Pagination + extraction deps
  asHTMLElement,
  isDisabledPaginationControl,
  // Detail enrichment deps
  waitForSeekProfileSnapshot,
});
const {
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
} = _seekExtractor;

// Schedule restore after SEEK's SPA has had a chance to strip params.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", restoreSeekSearchParams);
} else {
  restoreSeekSearchParams();
}












async function getKeywordMode() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        { keywordMode: KEYWORD_MODE_CONCAT },
        (items) => {
          resolve(normalizeKeywordMode(items?.keywordMode));
        },
      );
    } catch (error) {
      console.warn(
        "🎯 [Auto Search] Failed to read keyword mode from storage:",
        error,
      );
      resolve(KEYWORD_MODE_CONCAT);
    }
  });
}

async function getCollectionLimits() {
  const params = new URLSearchParams(window.location.search || "");
  const hasLimitParam = params.has(AUTO_LIMIT_PARAM);
  const hasMaxPagesParam = params.has(AUTO_MAX_PAGES_PARAM);
  const paramLimit = normalizeCollectionLimit(params.get(AUTO_LIMIT_PARAM));
  const paramMaxPages = normalizeCollectionLimit(
    params.get(AUTO_MAX_PAGES_PARAM),
  );

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ collectLimit: 0, maxPages: 0 }, (items) => {
        const resolvedLimit = hasLimitParam
          ? paramLimit
          : normalizeCollectionLimit(items?.collectLimit);
        const resolvedMaxPages = hasMaxPagesParam
          ? paramMaxPages
          : normalizeCollectionLimit(items?.maxPages);
        if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
          resolve(resolveCurrentJob51CollectionLimits(resolvedLimit, resolvedMaxPages));
          return;
        }
        resolve({
          limit: resolvedLimit,
          maxPages: resolvedMaxPages,
        });
      });
    } catch (error) {
      console.warn(
        "🎯 [Auto Sync] Failed to read collection limits from storage:",
        error,
      );
      if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
        resolve(
          resolveCurrentJob51CollectionLimits(
            hasLimitParam ? paramLimit : 0,
            hasMaxPagesParam ? paramMaxPages : 0,
          ),
        );
        return;
      }
      resolve({
        limit: hasLimitParam ? paramLimit : 0,
        maxPages: hasMaxPagesParam ? paramMaxPages : 0,
      });
    }
  });
}








function isExtractionReady() {
  if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
    return isJob51DetailPage()
      ? isJob51DetailReady()
      : hasJob51SearchSnapshot();
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    return isSeekSnapshotReady();
  }
  if (isJob5156DetailPage()) {
    return isJob5156DetailReady();
  }
  return document.querySelector(SELECTORS.listContainer) !== null;
}


const _job5156Extractor = createJob5156Extractor({
  getCurrentSourceKey,
  SOURCE_KEYS,
  apiSnapshot,
  normalizeResumeText,
  normalizeResumeMultilineText,
  buildWorkHistoryRawParts,
  normalizeOptionalPositiveInt,
  JOB5156_HOST,
  JOB5156_PROFILE_URL_PREFIX,
  JOB5156_DETAIL_FETCH_TIMEOUT_MS,
  JOB5156_DETAIL_FETCH_CONCURRENCY,
  DEFAULT_COLLECTION_GUARDS,
  GUARD_FIELD_NAMES,
  GUARD_ARRAY_FIELD_NAMES,
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,
  isMeaningfulJob5156WorkHistoryEntry,
  collectJob5156SectionItemsByHeading,
});
const {
  isJob5156DetailPage,
  getJob5156DetailRoot,
  getJob5156DetailHeaderText,
  isJob5156DetailReady,
  isJob5156DetailRootReady,
  parseJob5156BasicInfoItems,
  buildJob5156WorkHistoryItem,
  buildJob5156EducationItem,
  buildJob5156DetailWorkHistoryItem,
  buildJob5156DetailResumeFromRoot,
  extractJob5156DetailResume,
  buildJob5156DetailWorkHistoryItemFromApi,
  buildJob5156EducationItemFromApi,
  normalizeJob5156ExtractOptions,
  buildJob5156DetailResumeFromApiPayload,
  fetchJob5156ResumeDetail,
  enrichSingleJob5156SearchResumeWithDetail,
  enrichJob5156SearchResumesWithDetail,
  extractJob5156ResumeId,
  normalizeJob5156ProfileUrlForExport,
} = _job5156Extractor;

const _job51SearchExtractor = createJob51SearchExtractor({
  getCurrentSourceKey,
  SOURCE_KEYS,
  apiSnapshot,
  normalizeJob51Text,
  normalizeJob51MultilineText,
  normalizeResumeText,
  buildWorkHistoryRawParts,
  EHIRE_51JOB_PROFILE_URL_PREFIX,
  EHIRE_51JOB_HOST,
  JOB51_PAGE_COOLDOWN_MS,
  JOB51_DETAIL_FETCH_TIMEOUT_MS,
  JOB51_RATE_LIMIT_ERROR_MESSAGE,
  buildJob51DetailResumeFromPayload,
  filterCurrentResumesByAgeRange,
  chrome,
  window,
  fetch: globalThis.fetch.bind(globalThis),
  delay,
  isElementVisible,
  activateElement,
  findVueParentByName,
});
const {
  isJob51DetailPage,
  isJob51DetailReady,
  normalizeJob51AuthContext,
  getJob51RawRows,
  getJob51TotalFromPayload,
  isLikelyJob51ResumeRow,
  getJob51ResumeRows,
  hasJob51SearchSnapshot,
  isJob51EmptySearchPromptVisible,
  isJob51RateLimitedPage,
  ensureJob51PageAllowed,
  waitForJob51Cooldown,
  isJob51RateLimitedErrorMessage,
  isJob51RateLimitedPayload,
  isJob51DetailApiErrorPayload,
  collectJob51DetailFromBackground,
  fetch51JobResumeDetail,
  enrich51JobSearchResumeWithDetail,
  extract51JobResumes,
  extractJob51DetailResume,
  resolveJob51AgeFilterDropdown,
  ensureJob51AgeCustomRangeInputs,
  applyJob51AgeCustomRangeViaVue,
  normalizeAgeRequestValue,
  hasMatchingJob51AgeSearchRequest,
  waitForJob51AgeFilterRefresh,
} = _job51SearchExtractor;

const _resumeExtractor = createResumeExtractor({
  SELECTORS,
  JOB5156_HOST,
  doc: document,
  getCurrentSourceKey,
  SOURCE_KEYS,
  parseJob5156BasicInfoItems,
  buildJob5156WorkHistoryItem,
  buildJob5156EducationItem,
  isJob51DetailPage,
  isJob5156DetailPage,
  isJob51DetailReady,
  isJob5156DetailReady,
  getJob51DetailRoot,
  getJob5156DetailRoot,
  getJob51ResumePayload,
  getJob5156ResumePayload,
  normalizeResumeText,
  normalizeResumeMultilineText,
  applyCollectionGuards,
  parseGuardFieldNames,
  GUARD_FIELD_NAMES,
  DEFAULT_COLLECTION_GUARDS,
  apiSnapshot,
  JOB5156_PROFILE_URL_PREFIX,
  normalizeJob5156ProfileUrlForExport,
  win: window,
  normalizeKeyword,
  AUTO_SEARCH_PARAM,
  getAutoLocationValues,
  AUTO_EXPORT_PARAM,
  AUTO_SYNC_PARAM,
  AUTO_LIMIT_PARAM,
  AUTO_MAX_PAGES_PARAM,
  SAMPLE_NAME_PARAM,
  getExtensionGeneratedBy,
  buildSeekCollectionContext,
});
const {
  extractSingleResume,
  getApiRowForIndex,
  extractProfileUrl,
  buildSubmitMetadata,
} = _resumeExtractor;

const _extractionPipeline = createExtractionPipeline({
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
  document,
  window,
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
});
const {
  isDisabledPaginationControl,
  waitForResumeCards,
  waitForApiRows,
  waitForExtractionData,
  clearCapturedResultsForNextPage,
  waitForSeekProfileSnapshot,
  extractResumes,
  extractResumesRaw,
  goToNextPageInternal,
  enrich51JobSearchResumesWithDetail,
  queueJob51DetailBackfill,
} = _extractionPipeline;

const _snapshotCollector = createSnapshotCollector({
  apiSnapshot,
  getCurrentSourceKey,
  SOURCE_KEYS,
  isJob51DetailPage,
  isJob51DetailReady,
  getSeekSnapshotCount,
  normalizeJob51AuthContext,
  getJob51TotalFromPayload,
  getJob51ResumeRows,
  getSeekPayloadData,
  chrome,
  normalizeCollectionLimit,
  pipelineState,
  waitForExtractionData,
  isSeekProfileMode,
  resolveSeekAutoSyncPageWindow,
  getSeekRequestedPageSize,
  getSeekCurrentCandidateCount,
  resolveSeekAutoSyncCurrentPageSelection,
  extractResumes,
  enrich51JobSearchResumesWithDetail,
  enrichJob5156SearchResumesWithDetail,
  isJob5156DetailPage,
  enrichSeekResumesWithDetail,
  getPaginationInfo,
  isSeekAutoSyncPageWindowReached,
  waitForPagination,
  clearCapturedResultsForNextPage,
  goToNextPageInternal,
  waitForPageTransition,
  buildSubmitMetadata,
  delay,
  document,
});
const {
  getApiSnapshotCount,
  updateApiSnapshot,
  installApiHook,
  normalizeSnapshotCollectOptions,
  collectSnapshotPayload,
} = _snapshotCollector;

const _autoActions = createAutoActions({
  activateElement,
  fireMouseEvent,
  setInputValue,
  apiSnapshot,
  getCurrentSourceKey,
  getCurrentAgeRange,
  SOURCE_KEYS,
  isElementVisible,
  resolveJob51AgeFilterDropdown,
  ensureJob51AgeCustomRangeInputs,
  applyJob51AgeCustomRangeViaVue,
  waitForJob51AgeFilterRefresh,
  waitForExtractionData,
  asHTMLElement,
  SELECTORS,
  AUTO_LOCATION_PARAM,
  AUTO_SEARCH_PARAM,
  AUTO_KEYWORD_MODE_PARAM,
  KEYWORD_MODE_SPACED,
  normalizeKeyword,
  normalizeKeywordMode,
  getKeywordMode,
  normalizeSeekLocationLabel,
  hasJob51SearchSnapshot,
  isJob51EmptySearchPromptVisible,
  parseAutoLocationValues,
  extractResumes,
  extractResumesRaw,
  isJob51DetailPage,
  isJob5156DetailPage,
  isSeekProfileMode,
  enrich51JobSearchResumesWithDetail,
  enrichJob5156SearchResumesWithDetail,
  enrichSeekResumesWithDetail,
  buildSubmitMetadata,
  AUTO_EXPORT_PARAM,
  AUTO_SYNC_PARAM,
  buildExportMetadata,
  buildExportFilename,
  document,
  window,
});
const {
  findAgeFilterBlock,
  openAgeFilterDropdown,
  resolveAgeSelectBox,
  waitForAgeFilterDropdown,
  resolveAgeFilterActions,
  autoApplyAgeFilterFromUrl,
  autoSelectLocation,
  autoSearchFromUrl,
  normalizeCardText,
  rawToMarkdown,
  resumesToCSV,
  makeRandomId,
  downloadFile,
  getExtensionVersion,
  parseAutoExportMode,
  getAutoExportConfig,
  parseAutoSyncFlag,
  getAutoSyncEnabled,
  runAutoExportIfEnabled,
  syncCurrentPageToServer,
  resolveAutoSyncErrorStatus,
  resolveAutoSyncStopReason,
} = _autoActions;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== API_CAPTURE_SOURCE) return;
  updateApiSnapshot(msg);
});

window.addEventListener(PAGE_BRIDGE_REQUEST_EVENT, async () => {
  const requestPayload = document.documentElement.getAttribute(
    PAGE_BRIDGE_REQUEST_ATTR,
  );
  if (!requestPayload) return;

  let response = {
    id: null,
    ok: false,
    error: "Invalid bridge request",
    value: undefined,
  };

  try {
    const request = JSON.parse(requestPayload);
    const requestId = request?.id ?? null;
    const method = typeof request?.method === "string" ? request.method : "";
    const args = Array.isArray(request?.args) ? request.args : [];

    response.id = requestId;

    switch (method) {
      case "extract":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: extractResumes(),
        };
        break;
      case "extractRaw":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: extractResumesRaw(args[0]),
        };
        break;
      case "collect":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: await collectSnapshotPayload(args[0]),
        };
        break;
      case "getApiSnapshot":
        response = { id: requestId, ok: true, error: "", value: apiSnapshot };
        break;
      case "getPaginationInfo":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: getPaginationInfo(),
        };
        break;
      case "isReady":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: isExtractionReady(),
        };
        break;
      case "isLoggedIn":
        response = { id: requestId, ok: true, error: "", value: isLoggedIn() };
        break;
      case "status":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: window[EXTERNAL_ACCESS_KEY]?.status?.(),
        };
        break;
      case "syncToServer":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: await syncCurrentPageToServer(args[0]),
        };
        break;
      case "goToNextPage":
        response = {
          id: requestId,
          ok: true,
          error: "",
          value: goToNextPageInternal(),
        };
        break;
      default:
        response = {
          id: requestId,
          ok: false,
          error: method
            ? `Unsupported bridge method: ${method}`
            : "Missing bridge method",
          value: undefined,
        };
        break;
    }
  } catch (error) {
    response = {
      ...response,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  document.documentElement.setAttribute(
    PAGE_BRIDGE_RESPONSE_ATTR,
    JSON.stringify(response),
  );
  window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_RESPONSE_EVENT));
});



const _autoSyncRunnerState = {
  _autoSyncTriggered: false,
  _autoSyncCancelled: false,
};

const SyncStatusWidget = createSyncStatusWidget({
  win: window,
  doc: document,
  chrome,
  onCancel: () => { _autoSyncRunnerState._autoSyncCancelled = true; },
});

const _autoSyncRunner = createAutoSyncRunner({
  state: _autoSyncRunnerState,

  // Auto-actions helpers
  getAutoSyncEnabled,
  setAutoSyncAttributes,
  resolveAutoSyncErrorStatus,
  resolveAutoSyncStopReason,
  runAutoExportIfEnabled,
  syncCurrentPageToServer,

  // Seek extractor
  setSeekAutoSyncWindowAttributes,
  setSeekAutoSyncSelectionAttributes,
  isSeekProfileMode,
  resolveSeekAutoSyncPageWindow,
  isSeekAutoSyncPageWindowReached,
  resolveSeekAutoSyncCurrentPageSelection,
  getSeekRequestedPageSize,
  getSeekCurrentCandidateCount,
  resolveSeekAutoSyncPageSize,
  enrichSeekResumesWithDetail,

  // Pagination utils
  getPaginationInfo,
  waitForPagination,
  getNextPageButtonState,

  // Extraction pipeline
  waitForExtractionData,
  extractResumes,
  goToNextPageInternal,
  clearCapturedResultsForNextPage,
  enrich51JobSearchResumesWithDetail,
  enrichJob5156SearchResumesWithDetail,
  queueJob51DetailBackfill,

  // Snapshot collector
  collectSnapshotPayload,
  getApiSnapshotCount,

  // Resume extractor
  buildSubmitMetadata,
  extractProfileUrl,

  // Collection guards
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,

  // Job51 search extractor
  ensureJob51PageAllowed,
  isJob51RateLimitedPage,
  waitForJob51Cooldown,

  // Job51 age filter
  filterResumesByAgeRange,
  getAgeRangeFromUrl,
  normalizeOptionalPositiveInt,

  // UI utils
  buildAutoSyncProgressHint,
  buildAutoSyncSelectedCountHint,
  buildAutoSyncCompletionHint,
  persistLatestAutoSyncSummary,
  getCurrentAgeRange,
  resolveCurrentJob51AutoSyncDetailWaitMode,

  // Dom utils
  waitForPageTransition,
  delay,

  // Content.ts scope helpers
  getCurrentSourceKey,
  SOURCE_KEYS,
  getCollectionLimits,
  getKeywordMode,

  // Job5156 extractor
  isJob5156DetailPage,

  // Job51 extractor
  isJob51DetailPage,

  // SyncStatusWidget
  SyncStatusWidget,

  // DOM globals
  document,
  window,

  // Browser API
  chrome,
});
const { runAutoSyncIfEnabled } = _autoSyncRunner;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractCurrentPage") {
    const resumes = extractResumes();
    const pagination = getPaginationInfo();
    const metadata = buildSubmitMetadata();
    sendResponse({
      success: true,
      data: resumes,
      count: resumes.length,
      pagination,
      metadata,
    });
  } else if (request.action === "downloadCSV") {
    const resumes = extractResumes();
    const csv = resumesToCSV(resumes);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `resumes_${timestamp}_${makeRandomId()}.csv`;
    const saveAs = !!request.saveAs;

    // Download via background script (chrome.downloads API preserves filenames)
    downloadFile(csv, filename, "text/csv", saveAs)
      .then(() =>
        sendResponse({ success: true, count: resumes.length, filename }),
      )
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  } else if (request.action === "downloadJSON") {
    const resumes = extractResumes();
    const metadata = buildExportMetadata(resumes);
    const payload = { metadata, data: resumes };
    const json = JSON.stringify(payload, null, 2);
    const filename = buildExportFilename();
    const saveAs = !!request.saveAs;

    // Download via background script (chrome.downloads API preserves filenames)
    downloadFile(json, filename, "application/json", saveAs)
      .then(() =>
        sendResponse({ success: true, count: resumes.length, filename }),
      )
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  } else if (request.action === "getPaginationInfo") {
    sendResponse(getPaginationInfo());
  } else if (request.action === "getRuntimeStatus") {
    sendResponse({
      success: true,
      status: getExternalAccessorStatus(),
    });
  } else if (request.action === "ping") {
    sendResponse({ success: true, message: "Content script loaded" });
  }

  return true; // Keep channel open for async response
});




import {
  getExternalAccessorStatus as getExternalAccessorStatusFn,
  installExternalAccessor as installExternalAccessorFn,
} from "./lib/external-accessor";

function installContentTestExports() {
  if (typeof globalThis.__TR_BROWSER_EXTENSION_TEST__ !== "object") {
    return null;
  }
  globalThis.__TR_BROWSER_EXTENSION_TEST__.content = {
    SOURCE_KEYS,
    autoApplyAgeFilterFromUrl,
    extractResumes,
    extractJob51DetailResume,
    extractJob5156DetailResume,
    filterCurrentResumesByAgeRange,
    getCurrentAgeRange,
    getExternalAccessorStatus: () =>
      getExternalAccessorStatusFn({
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
      }),
  };
  return globalThis.__TR_BROWSER_EXTENSION_TEST__.content;
}

// ── Initialization ──────────────────────────────────────────

console.log("🎯 智通直聘 Resume Collector loaded");
installApiHook();
installReloadHelper();
installExternalAccessorFn(EXTERNAL_ACCESS_KEY, {
  extractResumes,
  extractResumesRaw,
  collectSnapshotPayload,
  apiSnapshot,
  getPaginationInfo,
  isExtractionReady,
  isLoggedIn,
  getExternalAccessorStatus: () =>
    getExternalAccessorStatusFn({
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
    }),
  syncToServer: syncCurrentPageToServer,
  goToNextPageInternal,
  version: getExtensionVersion(),
});
installContentTestExports();
autoSelectLocation()
  .catch((error) => console.warn("🎯 [Auto Location] Failed:", error))
  .then(() => autoSearchFromUrl())
  .catch((error) => console.warn("🎯 [Auto Search] Failed:", error))
  .then(() => autoApplyAgeFilterFromUrl())
  .catch((error) => console.warn("🎯 [Auto Age] Failed:", error))
  .finally(() => {
    void (async () => {
      await runAutoExportIfEnabled();
      await runAutoSyncIfEnabled();
    })();
  });
