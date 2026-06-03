import {
  filterResumesByAgeRange,
  getAgeRangeFromUrl,
  normalizeOptionalPositiveInt,
} from "./lib/job51-age-filter";
import {
  EHIRE_51JOB_HOST,
  EHIRE_51JOB_PROFILE_URL_PREFIX,
  buildJob51DetailResumeFromPayload,
  getJob51DetailRoot,
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
import { createJob51SearchExtractor, type Job51SearchExtractorDeps } from "./lib/job51-search-extractor";
import { createExtractionPipeline, type ExtractionPipelineDeps } from "./lib/extraction-pipeline";
import { createSnapshotCollector } from "./lib/snapshot-collector";
import { createAutoActions } from "./lib/auto-actions";
import { createUiUtils, type UiUtilsDeps } from "./lib/ui-utils";
import { createPaginationUtils } from "./lib/pagination-utils";
import { createDomUtils, delay } from "./lib/dom-utils";
import { createResumeExtractor, type ResumeExtractorDeps } from "./lib/resume-extractor";
import { createPageBridge, type PageBridgeDeps } from "./lib/page-bridge";
import { createChromeMessageHandler, type ChromeMessageHandlerDeps } from "./lib/chrome-message-handler";
import { createSyncStatusWidget } from "./lib/sync-status-widget";
import { createAutoSyncRunner } from "./lib/auto-sync-runner";
import {
  getExternalAccessorStatus as getExternalAccessorStatusFn,
  installExternalAccessor as installExternalAccessorFn,
  type ExternalAccessorDeps,
} from "./lib/external-accessor";
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
  JOB51_NEXT_PAGE_EVENT,
  CONTENT_SCRIPT_SOURCE,
  JOB5156_DETAIL_FETCH_TIMEOUT_MS,
  JOB5156_DETAIL_FETCH_CONCURRENCY,
  JOB51_DETAIL_FETCH_TIMEOUT_MS,
  JOB51_DETAIL_FETCH_CONCURRENCY,
  SEEK_DETAIL_FETCH_CONCURRENCY,
  SEEK_DETAIL_FETCH_DELAY_MS,
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

// Forward declarations — assigned after the factory that produces them
let getCurrentSourceKey: () => string;
let isJob51DetailPage: () => boolean;
let isJob5156DetailPage: () => boolean;
let isJob51DetailReady: () => boolean;
let isJob5156DetailReady: () => boolean;
let getSeekPaginationInfo: () => { currentPage: number; totalPages: number; totalItems: number; hasNextPage: boolean };
let getSeekNextPageLinkForMode: () => HTMLElement | null;
let getCurrentSeekMode: () => string;
let makeRandomId: () => string;
let getSeekCardCount: () => number;
let isDisabledPaginationControl: (el: unknown) => boolean;
let waitForSeekProfileSnapshot: (matchId: string, options: { timeoutMs: number }) => Promise<void>;
let getApiSnapshotCount: () => number;
let syncCurrentPageToServer: (resumes?: unknown) => Promise<unknown>;
let getExternalAccessorStatus: () => Record<string, unknown>;
let setAutoAgeAttributes: (status: string, minAge?: number | null, maxAge?: number | null) => void;

const _paginationUtils = createPaginationUtils({
  getCurrentSourceKey: () => getCurrentSourceKey(),
  SOURCE_KEYS,
  isJob51DetailPage: () => isJob51DetailPage(),
  isJob5156DetailPage: () => isJob5156DetailPage(),
  isJob51DetailReady: () => isJob51DetailReady(),
  isJob5156DetailReady: () => isJob5156DetailReady(),
  getSeekPaginationInfo: () => getSeekPaginationInfo(),
  getSeekNextPageLinkForMode: () => getSeekNextPageLinkForMode(),
  getCurrentSeekMode: () => getCurrentSeekMode(),
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
  makeRandomId: () => makeRandomId(),
  getPaginationInfo,
  getExternalAccessorStatus: () => getExternalAccessorStatus(),
  getAgeRangeFromUrl,
  filterResumesByAgeRange,
  resolveJob51CollectionLimits,
  resolveJob51DetailFetchDelayMs,
  resolveJob51AutoSyncDetailWaitMode,
  isJob51DetailPage: () => isJob51DetailPage(),
  chrome: chrome as unknown as UiUtilsDeps["chrome"],
});
const {
  // Export & Metadata
  sanitizeSampleName,
  normalizeKeyword,
  normalizeKeywordMode,
  normalizeCollectionLimit,
  buildExportFilename,
  buildExportMetadata,
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
({ getCurrentSourceKey } = _uiUtils);

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
  isDisabledPaginationControl: ((el: unknown) => isDisabledPaginationControl(el)) as (el: unknown) => boolean,
  // Detail enrichment deps
  waitForSeekProfileSnapshot: ((matchId: string, options: { timeoutMs: number }) => waitForSeekProfileSnapshot(matchId, options)) as unknown as (matchId: string, options: { timeoutMs: number }) => Promise<void>,
  SEEK_DETAIL_FETCH_CONCURRENCY,
  SEEK_DETAIL_FETCH_DELAY_MS,
  delay: ((ms: number) => delay(ms)) as (ms: number) => Promise<void>,
  SELECTORS,
});
const {
  isSeekProfilePage,
  isSeekTalentSearchListPage,
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
  getSeekNextPageLink,
  getSeekTalentSearchNextPageLink,
  // Detail enrichment
  enrichSingleSeekResumeWithDetail,
  enrichSeekResumesWithDetail,
} = _seekExtractor;
({ getCurrentSeekMode, getSeekCardCount, getSeekPaginationInfo, getSeekNextPageLinkForMode } = _seekExtractor);

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
  isMeaningfulJob5156WorkHistoryEntry,
  collectJob5156SectionItemsByHeading,
});
const {
  getJob5156DetailRoot,
  getJob5156DetailHeaderText,
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
({ isJob5156DetailPage, isJob5156DetailReady } = _job5156Extractor);

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
  chrome: chrome as Job51SearchExtractorDeps["chrome"],
  window: window as Job51SearchExtractorDeps["window"],
  fetch: globalThis.fetch.bind(globalThis),
  delay: delay as (ms: number) => Promise<void>,
  isElementVisible,
  activateElement,
  findVueParentByName,
});
const {
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
({ isJob51DetailPage, isJob51DetailReady } = _job51SearchExtractor);

const _resumeExtractor = createResumeExtractor({
  SELECTORS,
  JOB5156_HOST,
  doc: document,
  getCurrentSourceKey,
  SOURCE_KEYS,
  parseJob5156BasicInfoItems: parseJob5156BasicInfoItems as unknown as ResumeExtractorDeps["parseJob5156BasicInfoItems"],
  buildJob5156WorkHistoryItem,
  buildJob5156EducationItem,
  isJob51DetailPage,
  isJob5156DetailPage,
  isJob51DetailReady,
  isJob5156DetailReady,
  getJob51DetailRoot: getJob51DetailRoot as () => Element | null,
  getJob5156DetailRoot: getJob5156DetailRoot as () => Element | null,
  getJob51ResumePayload: () => apiSnapshot.job51DetailPayload,
  getJob5156ResumePayload: () => null,
  normalizeResumeText,
  normalizeResumeMultilineText,
  applyCollectionGuards: applyCollectionGuards as (resume: any, guardFieldNames: Set<string>) => any,
  parseGuardFieldNames: parseGuardFieldNames as unknown as (csv: string) => Set<string>,
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
  getApiSnapshotCount: () => getApiSnapshotCount(),
  getSeekCurrentCandidateCount,
  isExtractionReady,
  isJob51RateLimitedPage,
  JOB51_RATE_LIMIT_ERROR_MESSAGE,
  getSeekCandidateIdentity,
  chrome: chrome as ExtractionPipelineDeps["chrome"],
  DEFAULT_COLLECTION_GUARDS,
  CONTENT_SCRIPT_SOURCE,
  JOB51_NEXT_PAGE_EVENT,
  document,
  window,
  resolveCurrentJob51DetailFetchDelayMs,
  JOB51_DETAIL_FETCH_CONCURRENCY,
  enrich51JobSearchResumeWithDetail,
  syncCurrentPageToServer: (resumes?: unknown) => syncCurrentPageToServer(resumes),
  delay: delay as (ms: number) => Promise<void>,
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
  extractSingleResume: extractSingleResume as unknown as (card: Element, apiRow: unknown) => Record<string, unknown>,
  isJob51DetailReady,
  getSeekProfileRequest,
  getSeekTalentSearchRequest,
  getSeekRecommendedRequest,
  SEEK_PROFILE_TYPE,
  getJob5156DetailRoot,
  getSeekNextPageLinkForMode: () => getSeekNextPageLinkForMode(),
  getPaginationInfo,
  asHTMLElement,
});
const {
  waitForResumeCards,
  waitForApiRows,
  waitForExtractionData,
  clearCapturedResultsForNextPage,
  extractResumes,
  extractResumesRaw,
  goToNextPageInternal,
  enrich51JobSearchResumesWithDetail,
  queueJob51DetailBackfill,
} = _extractionPipeline;
isDisabledPaginationControl = _extractionPipeline.isDisabledPaginationControl;
waitForSeekProfileSnapshot = _extractionPipeline.waitForSeekProfileSnapshot as unknown as typeof waitForSeekProfileSnapshot;

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
  chrome: chrome as Record<string, unknown>,
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
  delay: delay as (ms: number) => Promise<void>,
  document,
  loadCollectionGuards: loadCollectionGuards as () => Promise<Record<string, unknown>>,
  parseGuardFieldNames: parseGuardFieldNames as unknown as (csv: string) => string[],
  applyCollectionGuards: applyCollectionGuards as (resume: unknown, fields: string[]) => unknown,
});
const {
  updateApiSnapshot,
  installApiHook,
  normalizeSnapshotCollectOptions,
  collectSnapshotPayload,
} = _snapshotCollector;
({ getApiSnapshotCount } = _snapshotCollector);

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
  ensureJob51AgeCustomRangeInputs: ensureJob51AgeCustomRangeInputs as unknown as (selectBox: unknown, options?: Record<string, unknown>) => Promise<void>,
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
  getKeywordMode: getKeywordMode as () => Promise<string>,
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
  loadCollectionGuards: loadCollectionGuards as () => Promise<Record<string, unknown>>,
  parseGuardFieldNames: parseGuardFieldNames as unknown as (csv: string) => string[],
  applyCollectionGuards: applyCollectionGuards as (resume: unknown, fields: string[]) => unknown,
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
  downloadFile,
  getExtensionVersion,
  parseAutoExportMode,
  getAutoExportConfig,
  parseAutoSyncFlag,
  getAutoSyncEnabled,
  runAutoExportIfEnabled,
  resolveAutoSyncErrorStatus,
  resolveAutoSyncStopReason,
} = _autoActions;
({ makeRandomId, syncCurrentPageToServer, setAutoAgeAttributes } = _autoActions);

// Assign getExternalAccessorStatus — wraps getExternalAccessorStatusFn with lazily-bound deps
const _accessorDoc = document;
getExternalAccessorStatus = () =>
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
    extractResumes,
    extractResumesRaw: extractResumesRaw as unknown as ExternalAccessorDeps["extractResumesRaw"],
    collectSnapshotPayload: collectSnapshotPayload as unknown as ExternalAccessorDeps["collectSnapshotPayload"],
    syncToServer: syncCurrentPageToServer,
    goToNextPageInternal,
    getExternalAccessorStatus: getExternalAccessorStatusFn,
    version: getExtensionVersion(),
    document: _accessorDoc,
  });

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== API_CAPTURE_SOURCE) return;
  updateApiSnapshot(msg);
});

const _pageBridge = createPageBridge({
  doc: document,
  win: window as PageBridgeDeps["win"],
  extractResumes,
  extractResumesRaw,
  collectSnapshotPayload,
  getApiSnapshot: () => apiSnapshot,
  getPaginationInfo,
  isExtractionReady,
  isLoggedIn,
  syncCurrentPageToServer,
  goToNextPageInternal,
});
_pageBridge.installPageBridgeListener();



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
  extractProfileUrl: ((resume: unknown) => extractProfileUrl(resume as Element, undefined)) as (resume: unknown) => string,

  // Collection guards
  loadCollectionGuards,
  parseGuardFieldNames: parseGuardFieldNames as unknown as (csv: string) => Set<string>,
  applyCollectionGuards: applyCollectionGuards as (resume: unknown, fields: Set<string>) => unknown,

  // Job51 search extractor
  ensureJob51PageAllowed: ensureJob51PageAllowed as unknown as () => boolean,
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
  delay: delay as (ms: number) => Promise<void>,

  // Content.ts scope helpers
  getCurrentSourceKey,
  SOURCE_KEYS,
  getCollectionLimits: getCollectionLimits as () => Promise<Record<string, unknown>>,
  getKeywordMode: getKeywordMode as unknown as () => string,

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
  chrome: chrome as Record<string, unknown>,
});
const { runAutoSyncIfEnabled } = _autoSyncRunner;

const _chromeMessageHandler = createChromeMessageHandler({
  extractResumes,
  getPaginationInfo,
  buildSubmitMetadata,
  resumesToCSV,
  makeRandomId,
  downloadFile,
  buildExportMetadata,
  buildExportFilename,
  getExternalAccessorStatus,
});
_chromeMessageHandler.installChromeMessageListener();




function installContentTestExports() {
  if (typeof globalThis.__TR_BROWSER_EXTENSION_TEST__ !== "object") {
    return null;
  }
  globalThis.__TR_BROWSER_EXTENSION_TEST__.content = {
    SOURCE_KEYS,
    autoApplyAgeFilterFromUrl,
    setAutoAgeAttributes,
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
        extractResumes,
        extractResumesRaw,
        collectSnapshotPayload,
        syncToServer: syncCurrentPageToServer,
        goToNextPageInternal,
        getExternalAccessorStatus: getExternalAccessorStatusFn,
        version: getExtensionVersion(),
        document: _accessorDoc,
      } as unknown as ExternalAccessorDeps),
  };
  return globalThis.__TR_BROWSER_EXTENSION_TEST__.content;
}

// ── Initialization ──────────────────────────────────────────

console.log("🎯 智通直聘 Resume Collector loaded");
installApiHook();
installReloadHelper();
installExternalAccessorFn(EXTERNAL_ACCESS_KEY, {
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
  extractResumes,
  extractResumesRaw,
  collectSnapshotPayload,
  syncToServer: syncCurrentPageToServer,
  goToNextPageInternal,
  getExternalAccessorStatus: getExternalAccessorStatusFn,
  version: getExtensionVersion(),
  document: _accessorDoc,
} as unknown as ExternalAccessorDeps);
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
