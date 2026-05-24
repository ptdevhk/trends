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
import {
  DEFAULT_COLLECTION_GUARDS,
  GUARD_FIELD_NAMES,
  GUARD_ARRAY_FIELD_NAMES,
  loadCollectionGuards,
  parseGuardFieldNames,
  applyCollectionGuards,
} from "./lib/collection-guards";

/**
 * 智通直聘 Resume Collector - Content Script
 * Extracts resume data from hr.job5156.com/search page
 */

// CSS Selectors based on DOM analysis
const SELECTORS = {
  listContainer: ".el-checkbox-group.resume-search-item-list-content-block",
  resumeCard: ".list-content__li_part",
  name: ".item-title-part1 a.name, a.name",
  activityStatus: ".date-type-diff-text-block",
  basicInfoRow: ".basic-line",
  basicInfoItem: ".basic-line__text",
  locationItem: ".resume-search-item-search-addre__span",
  locationFallbackItem: ".text-truncate.text-center",
  selfIntro: ".basic-keywords",
  topRow: ".list-content__li__up-block",
  topRowText: ".up-block__look-text",
  workHistory: ".work-block",
  workItem: ".work-item",
  pagination: ".el-pagination",
  nextPageBtn: ".el-pagination .btn-next",
  seekPagination: 'nav[aria-label="Pagination of results"]',
  seekTalentSearchPagination: 'nav[aria-label="PAGINATION_OF_RESULTS"]',
  searchInput: ".el-autocomplete input.el-input__inner",
  searchButton: ".resume-search-item-search-input-block__input-button",
  // 51job eHire selectors
  job51SearchInput: ".talent_search_keywords_input input.el-input__inner",
  job51SearchButton: "button.search_button",
  // Area selector (location filter modal)
  areaTrigger: ".resume-search-item-search-addre",
  areaModal: ".area-selector-item-block",
  areaProvinceBlock:
    ".area-selector-item-block__content__down__blcok:first-child",
  areaCityBlock: ".area-selector-item-block__content__down__blcok:nth-child(2)",
  areaDistrictBlock:
    ".area-selector-item-block__content__down__blcok:nth-child(3)",
  areaItem: ".down__blcok__select",
  areaDistrictItem: ".down__block__big-select__block",
  areaConfirmBtn: ".area-selector-item-block__footer .button-block.blue",
  areaCancelBtn: ".area-selector-item-block__footer .button-block:not(.blue)",
  areaSelectedCount: ".content__up__number__select",
};

const AUTO_EXPORT_PARAM = "tr_auto_export";
const AUTO_SYNC_PARAM = "tr_auto_sync";
const AUTO_LIMIT_PARAM = "tr_limit";
const AUTO_MAX_PAGES_PARAM = "tr_max_pages";
const AUTO_MIN_AGE_PARAM = "tr_min_age";
const AUTO_MAX_AGE_PARAM = "tr_max_age";
const AUTO_SEARCH_PARAM = "keyword";
const AUTO_LOCATION_PARAM = "location";
const AUTO_KEYWORD_MODE_PARAM = "tr_kw_mode";
const SAMPLE_NAME_PARAM = "tr_sample_name";
const JOB5156_HOST = "hr.job5156.com";
const SEEK_HOST_SUFFIX = ".employer.seek.com";
const JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`;
const SOURCE_KEYS = {
  JOB5156: "job5156",
  JOB51: "51job",
  SEEK: "seek",
  UNKNOWN: "unknown",
};
const SEEK_PROFILE_TYPE = "seek";
const KEYWORD_MODE_CONCAT = "concat";
const KEYWORD_MODE_SPACED = "spaced";
const JOB51_PAGE_COOLDOWN_MS = 8000;
const JOB51_RATE_LIMIT_ERROR_MESSAGE =
  "51job 已触发访问频率限制，请60分钟后再试";
let autoExportTriggered = false;
let autoSyncTriggered = false;
let autoSyncCancelled = false;
const API_CAPTURE_SOURCE = "tr-resume-api";
const EXTERNAL_ACCESS_KEY = "__TR_RESUME_DATA__";
const PAGE_BRIDGE_REQUEST_EVENT = "trResumeBridgeRequest";
const PAGE_BRIDGE_RESPONSE_EVENT = "trResumeBridgeResponse";
const PAGE_BRIDGE_REQUEST_ATTR = "data-tr-resume-bridge-request";
const PAGE_BRIDGE_RESPONSE_ATTR = "data-tr-resume-bridge-response";
const JOB51_NEXT_PAGE_EVENT = "trJob51NextPageRequest";
const CONTENT_SCRIPT_SOURCE = "tr-resume-content-script";
const JOB5156_DETAIL_FETCH_TIMEOUT_MS = 5000;
const JOB5156_DETAIL_FETCH_CONCURRENCY = 5;
const JOB51_DETAIL_FETCH_TIMEOUT_MS = 8000;
const JOB51_DETAIL_FETCH_CONCURRENCY = 2;
const DEFAULT_SEEK_PAGE_SIZE = 20;
const LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY = "latestAutoSyncSummaries";

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

const _resumeExtractor = createResumeExtractor({
  SELECTORS,
  JOB5156_HOST,
  doc: document,
  getCurrentSourceKey,
  SOURCE_KEYS,
  extractProfileUrl,
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
  getApiRowForIndex,
  normalizeResumeText,
  normalizeResumeMultilineText,
  applyCollectionGuards,
  parseGuardFieldNames,
  GUARD_FIELD_NAMES,
  DEFAULT_COLLECTION_GUARDS,
});
const { extractSingleResume } = _resumeExtractor;

function buildSubmitMetadata(options = {}) {
  const url = new URL(window.location.href);
  const sourceKey = getCurrentSourceKey();
  const keyword = normalizeKeyword(
    url.searchParams.get(AUTO_SEARCH_PARAM) || "",
  );
  const location = getAutoLocationValues(url).join(",");

  url.searchParams.delete(AUTO_EXPORT_PARAM);
  url.searchParams.delete(AUTO_SYNC_PARAM);
  url.searchParams.delete(AUTO_LIMIT_PARAM);
  url.searchParams.delete(AUTO_MAX_PAGES_PARAM);
  url.searchParams.delete(SAMPLE_NAME_PARAM);

  const metadata = {
    sourceKey,
    sourceHost: url.hostname.toLowerCase(),
    sourceUrl: url.toString(),
    generatedBy: getExtensionGeneratedBy(),
  };

  if (keyword) metadata.keyword = keyword;
  if (location) metadata.location = location;
  if (sourceKey === SOURCE_KEYS.SEEK) {
    metadata.collectionContext = buildSeekCollectionContext({
      captureModeOverride: options.seekCaptureMode,
    });
  }

  return metadata;
}

function getApiRowForIndex(index) {
  if (!Array.isArray(apiSnapshot.searchRows)) return null;
  return apiSnapshot.searchRows[index] || null;
}

function isPlaceholderProfileUrl(value) {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "#" ||
    normalized.startsWith("javascript:") ||
    normalized === "about:blank"
  );
}

function extractProfileUrl(card, apiRow) {
  const nameLink = card.querySelector(SELECTORS.name);
  if (!nameLink) return buildProfileUrlFromApiRow(apiRow);

  const candidates = [
    nameLink.getAttribute("href"),
    nameLink.getAttribute("data-href"),
    nameLink.getAttribute("data-url"),
    nameLink.getAttribute("data-link"),
    nameLink.href,
  ];

  for (const candidate of candidates) {
    const normalized = toAbsoluteHttpUrl(candidate);
    if (normalized) return normalizeJob5156ProfileUrlForExport(normalized);
  }

  return buildProfileUrlFromApiRow(apiRow);
}


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



const SyncStatusWidget = (() => {
  const WIDGET_ID = "tr-sync-status-widget";
  const DEFAULT_AUTO_DISMISS_MS = 5000;
  const HIDE_DELAY_MS = 220;
  let widgetEl = null;
  let dismissTimer = null;
  let hideTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clearTimers() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function ensureWidget() {
    if (widgetEl && widgetEl.isConnected) return widgetEl;

    widgetEl = document.createElement("div");
    widgetEl.id = WIDGET_ID;
    widgetEl.className = "tr-sync-widget";
    widgetEl.setAttribute("role", "status");
    widgetEl.setAttribute("aria-live", "polite");
    widgetEl.setAttribute("aria-atomic", "true");
    const mountTarget = document.body || document.documentElement;
    mountTarget.appendChild(widgetEl);
    return widgetEl;
  }

  function renderIcon(state) {
    if (state === "progress") {
      return '<span class="tr-sync-widget__spinner" aria-hidden="true"></span>';
    }
    if (state === "success") {
      return '<span aria-hidden="true">✓</span>';
    }
    return '<span aria-hidden="true">!</span>';
  }

  function openOptionsPage() {
    try {
      void chrome.runtime
        .sendMessage({ action: "openOptionsPage" })
        .catch((error) => {
          console.warn("🎯 [Auto Sync] Failed to open options page:", error);
        });
    } catch (error) {
      console.warn("🎯 [Auto Sync] Failed to request options page:", error);
    }
  }

  function show({
    state = "progress",
    message = "",
    hint = "",
    autoDismiss = false,
  } = {}) {
    const normalizedState =
      state === "success" || state === "error" ? state : "progress";
    const safeMessage = escapeHtml(message);
    const safeHint = escapeHtml(hint);
    const widget = ensureWidget();
    clearTimers();

    widget.className = `tr-sync-widget tr-sync-widget--${normalizedState}`;
    widget.classList.remove("tr-sync-widget--hidden");
    widget.innerHTML = `
      <div class="tr-sync-widget__icon">${renderIcon(normalizedState)}</div>
      <div class="tr-sync-widget__content">
        <div class="tr-sync-widget__message">${safeMessage}</div>
        ${safeHint ? `<div class="tr-sync-widget__hint">${safeHint}</div>` : ""}
      </div>
      ${
        normalizedState === "progress"
          ? '<button type="button" class="tr-sync-widget__cancel" aria-label="取消同步">取消</button>'
          : normalizedState === "error"
            ? '<button type="button" class="tr-sync-widget__close" aria-label="关闭提示">×</button>'
            : ""
      }
    `;

    widget.onclick = null;
    if (normalizedState === "progress") {
      const cancelBtn = widget.querySelector(".tr-sync-widget__cancel");
      cancelBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        autoSyncCancelled = true;
        cancelBtn.setAttribute("disabled", "true");
        cancelBtn.textContent = "取消中...";
      });
    }
    if (normalizedState === "error") {
      widget.onclick = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".tr-sync-widget__close")) return;
        openOptionsPage();
      };

      const closeBtn = widget.querySelector(".tr-sync-widget__close");
      closeBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        hide();
      });
    }

    const dismissMs =
      typeof autoDismiss === "number"
        ? autoDismiss
        : autoDismiss
          ? DEFAULT_AUTO_DISMISS_MS
          : 0;
    if (dismissMs > 0) {
      dismissTimer = setTimeout(() => {
        hide();
      }, dismissMs);
    }
  }

  function hide() {
    if (!widgetEl) return;
    clearTimers();
    widgetEl.classList.add("tr-sync-widget--hidden");
    hideTimer = setTimeout(() => {
      if (widgetEl) {
        widgetEl.remove();
        widgetEl = null;
      }
      hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  return {
    show,
    hide,
  };
})();

async function runAutoSyncIfEnabled() {
  if (autoSyncTriggered) return;
  const enabled = getAutoSyncEnabled();
  if (!enabled) {
    setAutoSyncAttributes("skipped");
    setSeekAutoSyncWindowAttributes(null);
    setSeekAutoSyncSelectionAttributes(null);
    return;
  }

  const { limit, maxPages } = await getCollectionLimits();
  const isJob51Source = getCurrentSourceKey() === SOURCE_KEYS.JOB51;

  autoSyncTriggered = true;
  autoSyncCancelled = false;
  setAutoSyncAttributes("running", 0, 0);
  setSeekAutoSyncWindowAttributes(null);
  setSeekAutoSyncSelectionAttributes(null);
  try {
    document.documentElement.setAttribute(
      "data-tr-auto-sync-limit",
      String(limit),
    );
    document.documentElement.setAttribute(
      "data-tr-auto-sync-max-pages",
      String(maxPages),
    );
  } catch {
    // ignore
  }
  SyncStatusWidget.show({
    state: "progress",
    message: "正在同步简历到服务器...",
    hint: `${isJob51Source ? "51job 保守模式 · " : ""}数量上限: ${limit > 0 ? limit : "不限"} · 页数上限: ${maxPages > 0 ? maxPages : "不限"}`,
  });

  try {
    let totalSubmitted = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let pagesVisited = 0;
    let lastSelectedCount = null;
    let stopReason = "completed";
    let seekStartPage = null;

    while (true) {
      if (autoSyncCancelled) {
        stopReason = "cancelled";
        break;
      }

      ensureJob51PageAllowed();

      const paginationBefore = getPaginationInfo();
      const currentPage = paginationBefore.currentPage;
      const totalPages = paginationBefore.totalPages;
      const isSeekListPage =
        getCurrentSourceKey() === SOURCE_KEYS.SEEK && !isSeekProfileMode();
      if (isSeekListPage && seekStartPage === null) {
        seekStartPage = currentPage;
      }

      try {
        await waitForExtractionData({});
      } catch {
        // waitForExtractionData timed out — SEEK may be rate-limiting or
        // the page loaded without API rows. Don't abort the entire sync:
        // let the resumes.length check below handle it (skip to next page).
        console.warn(
          "🎯 [Auto Sync] waitForExtractionData timed out — continuing",
        );
      }
      ensureJob51PageAllowed();

      pagesVisited += 1;

      const seekPageWindow = isSeekListPage
        ? resolveSeekAutoSyncPageWindow({
            startPage: seekStartPage || currentPage,
            limit,
            maxPages,
            requestedPageSize: getSeekRequestedPageSize(),
            currentPageCandidateCount: getSeekCurrentCandidateCount(),
          })
        : null;
      setSeekAutoSyncWindowAttributes(seekPageWindow);

      const pageSelection = isSeekListPage
        ? resolveSeekAutoSyncCurrentPageSelection({
            limit,
            totalSubmitted,
            currentPageResumeCount: getSeekCurrentCandidateCount(),
          })
        : {
            remainingCapacity:
              limit > 0 ? Math.max(limit - totalSubmitted, 0) : null,
            selectedCount: null,
            hitLimitWithinPage: false,
            limitAlreadyReached:
              limit > 0 ? Math.max(limit - totalSubmitted, 0) <= 0 : false,
          };
      setSeekAutoSyncSelectionAttributes(isSeekListPage ? pageSelection : null);

      if (
        (isSeekListPage && pageSelection.limitAlreadyReached) ||
        (!isSeekListPage && limit > 0 && pageSelection.limitAlreadyReached)
      ) {
        stopReason = "limit-reached";
        break;
      }

      let resumes = extractResumes();
      const hitLimitWithinPage = isSeekListPage
        ? pageSelection.hitLimitWithinPage
        : limit > 0 &&
          typeof pageSelection.remainingCapacity === "number" &&
          resumes.length > pageSelection.remainingCapacity;
      if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
        resumes = resumes.slice(0, pageSelection.selectedCount);
      } else if (
        limit > 0 &&
        typeof pageSelection.remainingCapacity === "number" &&
        resumes.length > pageSelection.remainingCapacity
      ) {
        resumes = resumes.slice(0, pageSelection.remainingCapacity);
      }
      lastSelectedCount = isSeekListPage ? resumes.length : null;
      if (
        getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
        !isJob5156DetailPage() &&
        resumes.length > 0
      ) {
        resumes = await enrichJob5156SearchResumesWithDetail(resumes);
      }
      if (
        getCurrentSourceKey() === SOURCE_KEYS.SEEK &&
        !isSeekProfileMode() &&
        resumes.length > 0
      ) {
        resumes = await enrichSeekResumesWithDetail(resumes);
      }
      if (resumes.length <= 0) {
        const ageRange = getCurrentAgeRange();
        const ageHint = ageRange.enabled
          ? ` · 年龄: ${typeof ageRange.minAge === "number" ? ageRange.minAge : "—"}-${typeof ageRange.maxAge === "number" ? ageRange.maxAge : "—"}`
          : "";
        const progressHint = buildAutoSyncProgressHint({
          limit,
          totalSubmitted,
          selectedCount: isSeekListPage ? resumes.length : null,
          ageHint,
        });

        SyncStatusWidget.show({
          state: "progress",
          message: `第 ${currentPage}/${Math.max(totalPages, currentPage)} 页无符合条件的简历，继续...`,
          hint: progressHint,
        });
        setAutoSyncAttributes("running", totalSubmitted, pagesVisited);

        if (autoSyncCancelled) {
          stopReason = "cancelled";
          break;
        }
        if (
          isSeekListPage &&
          isSeekAutoSyncPageWindowReached(seekPageWindow, currentPage)
        ) {
          stopReason = "page-window-reached";
          break;
        }
        if (!isSeekListPage && maxPages > 0 && pagesVisited >= maxPages) {
          stopReason = "max-pages-reached";
          break;
        }

        const paginationAfter = getPaginationInfo();
        if (
          !paginationAfter.hasNextPage ||
          paginationAfter.currentPage >= paginationAfter.totalPages
        ) {
          stopReason = "no-next-page";
          break;
        }
        try {
          await waitForPagination({ timeoutMs: 8000 });
        } catch {
          // Some layouts render pagination late or omit it on single-page results.
        }
        const nextPage = paginationAfter.currentPage + 1;
        try {
          document.documentElement.setAttribute(
            "data-tr-auto-sync-next-state",
            JSON.stringify(getNextPageButtonState()),
          );
        } catch {
          // ignore
        }
        await waitForJob51Cooldown();
        clearCapturedResultsForNextPage();
        const moved = goToNextPageInternal();
        if (!moved) {
          stopReason = "no-next-page";
          break;
        }
        await waitForPageTransition({
          expectedPage: nextPage,
          timeoutMs: 15000,
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const progressHint = buildAutoSyncProgressHint({
        limit,
        totalSubmitted,
        selectedCount: isSeekListPage ? resumes.length : null,
      });
      SyncStatusWidget.show({
        state: "progress",
        message: `正在同步第 ${currentPage}/${Math.max(totalPages, currentPage)} 页 (${resumes.length} 份)...`,
        hint: progressHint,
      });

      const response = await syncCurrentPageToServer(resumes);
      if (!response?.success) {
        throw response?.error || response || "Auto sync failed";
      }

      const submitted =
        typeof response.submitted === "number"
          ? response.submitted
          : resumes.length;
      const inserted =
        typeof response.inserted === "number" ? response.inserted : 0;
      const updated =
        typeof response.updated === "number" ? response.updated : 0;
      totalSubmitted += submitted;
      totalInserted += inserted;
      totalUpdated += updated;
      setAutoSyncAttributes("running", totalSubmitted, pagesVisited);

      if (
        getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
        !isJob51DetailPage() &&
        resumes.length > 0
      ) {
        const detailBackfillPromise = queueJob51DetailBackfill(resumes, {
          currentPage,
          totalPages: Math.max(totalPages, currentPage),
        });
        const waitMode = resolveCurrentJob51AutoSyncDetailWaitMode();
        const shouldWaitForDetails =
          waitMode === "all" || (waitMode === "page1" && currentPage === 1);
        if (shouldWaitForDetails) {
          SyncStatusWidget.show({
            state: "progress",
            message: `正在补充第 ${currentPage}/${Math.max(totalPages, currentPage)} 页详情...`,
            hint: "等待 51job 详情补充后再完成本页同步",
          });
          await detailBackfillPromise;
        }
      }

      if (autoSyncCancelled) {
        stopReason = "cancelled";
        break;
      }
      if (isSeekListPage && hitLimitWithinPage) {
        stopReason = "limit-reached";
        break;
      }
      if (
        isSeekListPage &&
        isSeekAutoSyncPageWindowReached(seekPageWindow, currentPage)
      ) {
        stopReason = "page-window-reached";
        break;
      }
      if (!isSeekListPage && limit > 0 && totalSubmitted >= limit) {
        stopReason = "limit-reached";
        break;
      }
      if (!isSeekListPage && maxPages > 0 && pagesVisited >= maxPages) {
        stopReason = "max-pages-reached";
        break;
      }

      const paginationAfter = getPaginationInfo();
      if (
        !paginationAfter.hasNextPage ||
        paginationAfter.currentPage >= paginationAfter.totalPages
      ) {
        stopReason = "no-next-page";
        break;
      }
      try {
        await waitForPagination({ timeoutMs: 8000 });
      } catch {
        // Some layouts render pagination late or omit it on single-page results.
      }
      const nextPage = paginationAfter.currentPage + 1;
      try {
        document.documentElement.setAttribute(
          "data-tr-auto-sync-next-state",
          JSON.stringify(getNextPageButtonState()),
        );
      } catch {
        // ignore
      }
      await waitForJob51Cooldown();
      clearCapturedResultsForNextPage();
      const moved = goToNextPageInternal();
      if (!moved) {
        stopReason = "no-next-page";
        break;
      }
      await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    try {
      document.documentElement.setAttribute(
        "data-tr-auto-sync-stop-reason",
        stopReason,
      );
    } catch {
      // ignore
    }
    persistLatestAutoSyncSummary();

    if (autoSyncCancelled) {
      SyncStatusWidget.show({
        state: "success",
        message: `同步已取消，已同步 ${totalSubmitted} 份简历`,
        hint: buildAutoSyncCompletionHint({
          totalInserted,
          totalUpdated,
          pagesVisited,
          selectedCount: lastSelectedCount,
        }),
        autoDismiss: true,
      });
      setAutoSyncAttributes("cancelled", totalSubmitted, pagesVisited);
      return;
    }

    SyncStatusWidget.show({
      state: "success",
      message: `已同步 ${totalSubmitted} 份简历 (${totalInserted} 新增, ${totalUpdated} 更新), 共 ${pagesVisited} 页`,
      hint: [
        buildAutoSyncSelectedCountHint({
          selectedCount: lastSelectedCount,
          prefix: "",
        }),
        isJob51Source ? "51job 详情补充正在后台继续" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      autoDismiss: true,
    });
    setAutoSyncAttributes("done", totalSubmitted, pagesVisited);
  } catch (error) {
    console.warn("🎯 [Auto Sync] Failed:", error);
    const status = resolveAutoSyncErrorStatus(error);
    SyncStatusWidget.show({
      state: "error",
      message: status.message,
      hint: status.hint,
    });
    setAutoSyncAttributes("failed");
    try {
      document.documentElement.setAttribute(
        "data-tr-auto-sync-stop-reason",
        resolveAutoSyncStopReason(error),
      );
    } catch {
      // ignore
    }
    persistLatestAutoSyncSummary();
  }
}

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
