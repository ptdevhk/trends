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

const DEFAULT_COLLECTION_GUARDS = {
  job5156: "experience,jobIntention,selfIntro",
  "51job": "experience,jobIntention,selfIntro",
  seek: "experience,jobIntention,selfIntro",
};

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

const lastPersistedAutoSyncSummaryFingerprintBySource = {};
let job51DetailBackfillChain = Promise.resolve();
let job51DetailBackfillRunId = 0;
const pipelineState = {
  get chain() { return job51DetailBackfillChain; },
  set chain(v) { job51DetailBackfillChain = v; },
  get runId() { return job51DetailBackfillRunId; },
  set runId(v) { job51DetailBackfillRunId = v; },
};

const _seekExtractor = createSeekExtractor({
  getCurrentSourceKey,
  SOURCE_KEYS,
  apiSnapshot,
  normalizeOptionalPositiveInt,
  DEFAULT_SEEK_PAGE_SIZE,
  SEEK_PROFILE_TYPE,
  persistLatestAutoSyncSummary,
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
} = _seekExtractor;

// Schedule restore after SEEK's SPA has had a chance to strip params.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", restoreSeekSearchParams);
} else {
  restoreSeekSearchParams();
}

function sanitizeSampleName(value) {
  if (!value) return "";
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80);
}

/**
 * Normalize keyword for consistent handling
 * - Full-width space (U+3000) → half-width space (U+0020)
 * - Multiple spaces → single space
 * - Trim leading/trailing
 */
function normalizeKeyword(keyword) {
  if (!keyword) return "";
  return keyword
    .replace(/[\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeywordMode(mode) {
  return mode === KEYWORD_MODE_SPACED
    ? KEYWORD_MODE_SPACED
    : KEYWORD_MODE_CONCAT;
}

function normalizeCollectionLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getCurrentLocationSearch() {
  return window.location.search || "";
}

function getCurrentAgeRange() {
  return getAgeRangeFromUrl(
    getCurrentLocationSearch(),
    AUTO_MIN_AGE_PARAM,
    AUTO_MAX_AGE_PARAM,
  );
}

function filterCurrentResumesByAgeRange(resumes) {
  if (
    getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
    !isJob51DetailPage() &&
    document.documentElement.getAttribute("data-tr-auto-age") !== "done"
  ) {
    return Array.isArray(resumes) ? resumes : [];
  }
  return filterResumesByAgeRange(
    resumes,
    getCurrentLocationSearch(),
    AUTO_MIN_AGE_PARAM,
    AUTO_MAX_AGE_PARAM,
  );
}

function resolveCurrentJob51CollectionLimits(limit, maxPages) {
  return resolveJob51CollectionLimits(
    limit,
    maxPages,
    getCurrentLocationSearch(),
  );
}

function resolveCurrentJob51DetailFetchDelayMs() {
  return resolveJob51DetailFetchDelayMs(getCurrentLocationSearch());
}

function resolveCurrentJob51AutoSyncDetailWaitMode() {
  return resolveJob51AutoSyncDetailWaitMode(getCurrentLocationSearch());
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

function buildExportFilename() {
  const params = new URLSearchParams(window.location.search || "");
  const rawSampleName = params.get(SAMPLE_NAME_PARAM) || "";
  const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, "");
  const timestamp = new Date().toISOString().slice(0, 10);

  if (sampleName) return `${sampleName}.json`;

  const rawKeyword = params.get(AUTO_SEARCH_PARAM) || "";
  const keyword = sanitizeSampleName(normalizeKeyword(rawKeyword));
  if (keyword) return `sample-${keyword}-${timestamp}.json`;

  return `resumes_${timestamp}_${makeRandomId()}.json`;
}

function parseAutoLocationValues(locationRaw) {
  if (!locationRaw) return [];
  return Array.from(
    new Set(
      String(locationRaw)
        .split(/[，,、]+/)
        .map((location) => location.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);
}

function getAutoLocationValues(url) {
  return parseAutoLocationValues(
    url.searchParams.get(AUTO_LOCATION_PARAM) || "",
  );
}

function buildExportMetadata(resumes) {
  const url = new URL(window.location.href);
  const keyword = normalizeKeyword(
    url.searchParams.get(AUTO_SEARCH_PARAM) || "",
  );
  const locationArray = getAutoLocationValues(url);
  const rawSampleName = url.searchParams.get(SAMPLE_NAME_PARAM) || "";
  const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, "");

  url.searchParams.delete(AUTO_EXPORT_PARAM);
  url.searchParams.delete(AUTO_SYNC_PARAM);
  url.searchParams.delete(AUTO_LIMIT_PARAM);
  url.searchParams.delete(AUTO_MAX_PAGES_PARAM);
  url.searchParams.delete(SAMPLE_NAME_PARAM);

  const filters = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === AUTO_SEARCH_PARAM || key === AUTO_LOCATION_PARAM) continue;
    if (!value) continue;
    filters[key] = value;
  }

  const pagination = getPaginationInfo();
  const reproductionParams = new URLSearchParams();
  reproductionParams.set(AUTO_EXPORT_PARAM, "json");
  if (sampleName) reproductionParams.set(SAMPLE_NAME_PARAM, sampleName);

  return {
    sourceUrl: url.toString(),
    searchCriteria: {
      keyword,
      location: locationArray.length > 0 ? locationArray : "",
      filters: Object.keys(filters).length ? filters : {},
    },
    generatedAt: new Date().toISOString(),
    generatedBy: getExtensionGeneratedBy(),
    totalPages: pagination.totalPages,
    totalResumes: resumes.length,
    reproduction: `Navigate to sourceUrl, then add ?${reproductionParams.toString()}`,
  };
}

function getCurrentSourceKey() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === JOB5156_HOST) return SOURCE_KEYS.JOB5156;
  if (hostname === EHIRE_51JOB_HOST) return SOURCE_KEYS.JOB51;
  if (hostname.endsWith(SEEK_HOST_SUFFIX)) return SOURCE_KEYS.SEEK;
  return SOURCE_KEYS.UNKNOWN;
}


function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Talentsearch cards have no <a> links — candidate name is a [data-role="heading"]
 * element clicked via SPA event handlers. Find the card matching this profileId
 * (UUID) by checking data attributes or card index.
 */
function findSeekTalentSearchCardTrigger(profileId, resume, cachedHeadings) {
  if (!profileId) return null;
  // Try matching by data-tr-candidate-id attribute (set during extraction)
  const byAttr = document.querySelector(
    `[data-tr-candidate-id="${CSS.escape(profileId)}"]`,
  );
  if (byAttr instanceof HTMLElement) return byAttr;
  // Fallback: match heading elements that contain the candidate name.
  // Talentsearch cards use [data-role="heading"] for the candidate name.
  const candidateName = typeof resume?.name === "string" ? resume.name.trim() : "";
  if (candidateName) {
    const headings = cachedHeadings ||
      Array.from(document.querySelectorAll('[data-role="heading"]'));
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
      new URL(window.location.href).searchParams.get("jobId"),
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

function parseJob5156BasicInfoItems(items, locationOverride = "") {
  const basicInfo = Array.isArray(items)
    ? items.map((item) => normalizeResumeText(item)).filter(Boolean)
    : [];

  let age = "";
  let experience = "";
  let education = "";
  let location = "";
  if (basicInfo.length >= 4) {
    [age, experience, education, location] = basicInfo;
  } else {
    basicInfo.forEach((item) => {
      if (!age && item.includes("岁")) age = item;
      else if (!experience && item.includes("年") && !item.includes("元"))
        experience = item;
      else if (
        !education &&
        /(中专|高中|大专|本科|硕|博|研究生|MBA|EMBA)/.test(item)
      )
        education = item;
      else if (!location && !item.includes("元")) location = item;
    });
  }

  if (locationOverride) {
    location = normalizeResumeText(locationOverride);
  }

  return { age, experience, education, location };
}

function buildJob5156WorkHistoryItem(item) {
  if (!(item instanceof Element)) return null;

  const startDate = normalizeResumeText(
    item.querySelector(".work-time > span:first-child")?.textContent,
  );
  const durationLabel = normalizeResumeText(
    item.querySelector(".work-time-other")?.textContent,
  );
  const companyName = normalizeResumeText(
    item.querySelector(".work-company")?.textContent,
  );
  const jobTitle = normalizeResumeText(
    item.querySelector(".work-position")?.textContent,
  );
  const description = normalizeResumeText(
    item.querySelector(
      ".work-desc, .work-detail, .work-content, .work-responsibility, .work-duty",
    )?.textContent,
  );
  const endDate = startDate.includes("~")
    ? normalizeResumeText(startDate.split("~").slice(1).join("~"))
    : "";
  const raw = buildWorkHistoryRawParts([
    startDate,
    durationLabel,
    companyName,
    jobTitle,
    description,
  ]);

  if (!raw) return null;

  return {
    raw,
    companyName: companyName || undefined,
    jobTitle: jobTitle || undefined,
    description: description || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
}

function buildJob5156EducationItem(item) {
  if (!(item instanceof Element)) return null;

  const liveEducationText = normalizeResumeText(item.textContent);
  if (
    item.classList.contains("resume-education__info") ||
    item.closest(".resume-education")
  ) {
    const institution = normalizeResumeText(
      item.querySelector(".flex.w-full > div:last-child")?.textContent,
    );
    const rowText = Array.from(item.querySelectorAll(".flex.w-full > div"))
      .map((node) => normalizeResumeText(node.textContent))
      .filter(Boolean);
    const endDate = rowText.find((value) => /^\d{4}(~|-)/.test(value)) || "";
    const qualification = rowText
      .filter((value) => value !== institution && value !== endDate)
      .join(" · ");

    if (!institution && !qualification && !endDate && !liveEducationText)
      return null;

    return {
      institution: institution || undefined,
      qualification: qualification || undefined,
      endDate: endDate || undefined,
      description: liveEducationText || undefined,
    };
  }

  const institution = normalizeResumeText(
    item.querySelector(".school-name")?.textContent,
  );
  const qualification = normalizeResumeText(
    item.querySelector(".school-major")?.textContent,
  );
  const degree = normalizeResumeText(
    item.querySelector(".school-degree")?.textContent,
  );
  const endDate = normalizeResumeText(
    item.querySelector(".school-time")?.textContent,
  );

  if (!institution && !qualification && !degree && !endDate) return null;

  return {
    institution: institution || undefined,
    qualification:
      [qualification, degree].filter(Boolean).join(" · ") || undefined,
    endDate: endDate || undefined,
  };
}

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
  parseJob5156BasicInfoItems,
  buildJob5156WorkHistoryItem,
  buildJob5156EducationItem,
  isMeaningfulJob5156WorkHistoryEntry,
  collectJob5156SectionItemsByHeading,
});
const {
  isJob5156DetailPage,
  getJob5156DetailRoot,
  getJob5156DetailHeaderText,
  isJob5156DetailReady,
  isJob5156DetailRootReady,
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

function extractSeekProfileResume() {
  const profile = apiSnapshot.seekProfile;
  if (!profile || typeof profile !== "object") return [];

  const request = getSeekProfileRequest();
  const requestInput = request?.variables?.input;
  const language = request?.variables?.language;
  const profileUrl = new URL(window.location.href);
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
          return {
            name,
            authority: authority || undefined,
          };
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
        ? `${window.location.hostname.toLowerCase()}:profile:${profileId}`
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
      source: window.location.hostname.toLowerCase(),
      searchProfileId:
        typeof requestInput?.searchId === "string" ? requestInput.searchId : "",
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
  const request = talentSearchRequest
    ?? (useProfileMode
      ? getSeekProfileRequest()
      : getSeekRecommendedRequest());
  const requestInput = request?.variables?.input;
  const language = request?.variables?.language;
  const url = new URL(window.location.href);
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
  if (seekMode) {
    context.seekMode = seekMode;
  }
  if (typeof language === "string") {
    context.language = language;
  }

  if (isTalentSearchList) {
    // Talent-search variables are nested under input.{...} per recon.
    // Surface the search-shaping fields so analytics can later distinguish
    // discovery-lane characteristics.
    if (typeof requestInput?.pageNumber === "number") {
      context.pageNumber = requestInput.pageNumber;
    } else if (pageNumberFromUrl != null) {
      context.pageNumber = pageNumberFromUrl;
    }
    if (typeof requestInput?.originalNaturalLanguageQuery === "string") {
      context.searchQuery = requestInput.originalNaturalLanguageQuery;
    }
    if (typeof requestInput?.countryCode === "string") {
      context.market = requestInput.countryCode;
    }
    if (Array.isArray(requestInput?.roleTitles?.values)) {
      context.roleTitles = requestInput.roleTitles.values;
    }
    if (Array.isArray(requestInput?.keywords?.values)) {
      context.keywords = requestInput.keywords.values;
    }
    if (typeof requestInput?.keywords?.matchAll === "boolean") {
      context.matchAll = requestInput.keywords.matchAll;
    }
    if (typeof requestInput?.sortBy === "string") {
      context.sortBy = requestInput.sortBy;
    }
    if (typeof requestInput?.salary?.frequency === "string") {
      context.salaryType = requestInput.salary.frequency;
    }
    if (typeof requestInput?.salary?.range?.minimum === "number") {
      context.minSalary = requestInput.salary.range.minimum;
    }
    if (typeof requestInput?.salary?.includeUnspecified === "boolean") {
      context.salaryUnspecified = requestInput.salary.includeUnspecified;
    }
    if (typeof requestInput?.searchId === "string") {
      context.searchId = requestInput.searchId;
    }
  } else {
    // Recommended / profile path uses the existing flat input shape.
    if (requestInput?.jobId != null) {
      context.jobId = String(requestInput.jobId);
    } else if (jobIdFromUrl != null) {
      context.jobId = String(jobIdFromUrl);
    }
    if (typeof requestInput?.searchId === "string") {
      context.searchId = requestInput.searchId;
    }
    if (typeof requestInput?.page === "number") {
      context.pageNumber = requestInput.page;
    } else if (pageNumberFromUrl != null) {
      context.pageNumber = pageNumberFromUrl;
    }
  }

  return context;
}

function getExtensionGeneratedBy() {
  let generatedBy = "browser-extension";
  try {
    const version = chrome?.runtime?.getManifest?.().version;
    if (version) generatedBy = `browser-extension@${version}`;
  } catch {
    // ignore
  }
  return generatedBy;
}

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

function toAbsoluteHttpUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (isPlaceholderProfileUrl(url.href)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function buildProfileUrlFromApiRow(apiRow) {
  if (!apiRow || typeof apiRow !== "object") return "";
  const resumeId = apiRow.resumeId;
  if (resumeId === null || resumeId === undefined || resumeId === "") return "";
  const encodedId = encodeURIComponent(String(resumeId));
  return `${JOB5156_PROFILE_URL_PREFIX}${encodedId}`;
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

function installReloadHelper() {
  try {
    if (globalThis.trReloadExtension) return;
    globalThis.trReloadExtension = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          action: "reloadExtension",
        });
        console.log("🎯 [DEV] Reload requested", response);
      } catch (error) {
        console.warn("🎯 [DEV] Reload failed:", error);
      }
    };
    console.log(
      '🎯 [DEV] Use trReloadExtension() in the DevTools "Content scripts" context to reload the extension',
    );
  } catch (error) {
    console.warn("🎯 [DEV] Failed to install reload helper:", error);
  }
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

/**
 * Extract data from a single resume card
 * @param {Element} card - The resume card DOM element
 * @returns {Object} - Extracted resume data
 */
function extractSingleResume(card, apiRow = null) {
  const getText = (selector, root = card) => {
    const el = root.querySelector(selector);
    return el ? el.textContent.trim() : "";
  };

  const pickText = (selectors) => {
    for (const selector of selectors) {
      const text = getText(selector);
      if (text) return text;
    }
    return "";
  };

  // Extract basic info (age, experience, education, location)
  const basicInfoContainer =
    card.querySelector(SELECTORS.basicInfoRow) ||
    card.querySelector(".list-content__li__down-left-center");
  const locationFromCard =
    getText(SELECTORS.locationItem, basicInfoContainer || card) ||
    getText(SELECTORS.locationFallbackItem, basicInfoContainer || card);
  const basicInfoSpans = basicInfoContainer
    ? basicInfoContainer.querySelectorAll(
        `${SELECTORS.basicInfoItem}, div:nth-child(2) span, .basic-line span`,
      )
    : [];

  const basicInfo = Array.from(basicInfoSpans).map(
    (span) => span.textContent || "",
  );
  const { age, experience, education, location } = parseJob5156BasicInfoItems(
    basicInfo,
    locationFromCard,
  );

  // Extract top row (job intention, salary)
  const topRow =
    card.querySelector(SELECTORS.topRowText) ||
    card.querySelector(SELECTORS.topRow);
  const topRowText = topRow
    ? topRow.textContent.trim().replace(/\s+/g, " ")
    : "";
  const topRowClean = topRowText
    .split("人才洞察")[0]
    .replace(/·\s*$/, "")
    .trim();

  let expectedSalary = "";
  const salaryMatch = topRowClean.match(
    /(\d[\d-]*\s*元\/月|\d[\d-]*\s*元|面议)/,
  );
  if (salaryMatch) expectedSalary = salaryMatch[0].replace(/\s+/g, "");

  let jobIntention = topRowClean.replace(/^求职意向[:：]?\s*/, "");
  jobIntention = jobIntention.replace(/（通勤距离[^）]*）/g, "").trim();
  if (expectedSalary) {
    jobIntention = jobIntention
      .replace(expectedSalary, "")
      .replace(/[·\s]+$/g, "")
      .trim();
  }

  const selfIntro = pickText([
    SELECTORS.selfIntro,
    ".basic-keywords",
    ".basic-keywords span",
  ]);

  // Extract work history
  const workHistoryContainer =
    card.querySelector(SELECTORS.workHistory) ||
    card.querySelector(".list-content__li__down-right-center");
  let workItems = [];
  let educationItems = [];
  if (workHistoryContainer) {
    const primary = workHistoryContainer.querySelectorAll(SELECTORS.workItem);
    if (primary.length > 0) {
      workItems = Array.from(primary);
      educationItems = Array.from(
        workHistoryContainer.querySelectorAll(".school-item"),
      );
    } else {
      workItems = Array.from(
        workHistoryContainer.querySelectorAll('div[class*="history"]'),
      );
    }
  }

  const seenWorkHistory = new Set();
  const workHistory = workItems
    .map((item) => buildJob5156WorkHistoryItem(item))
    .filter((item) => item && item.raw.length > 5)
    .filter((item) => {
      if (!item || seenWorkHistory.has(item.raw)) return false;
      seenWorkHistory.add(item.raw);
      return true;
    });

  const seenEducation = new Set();
  const profileEducation = educationItems
    .map((item) => buildJob5156EducationItem(item))
    .filter(
      (item) =>
        item &&
        [item.institution, item.qualification, item.endDate].some(Boolean),
    )
    .filter((item) => {
      const signature = [
        item.institution || "",
        item.qualification || "",
        item.endDate || "",
      ].join("|");
      if (seenEducation.has(signature)) return false;
      seenEducation.add(signature);
      return true;
    });

  return {
    name: getText(SELECTORS.name),
    profileUrl: extractProfileUrl(card, apiRow),
    activityStatus: getText(SELECTORS.activityStatus),
    age,
    experience,
    education,
    location,
    jobIntention,
    expectedSalary,
    selfIntro,
    workHistory,
    profileEducation:
      profileEducation.length > 0 ? profileEducation : undefined,
    extractedAt: new Date().toISOString(),
    source: JOB5156_HOST,
  };
}

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
  const url = new URL(window.location.href);
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
        ? `${window.location.hostname.toLowerCase()}:profile:${profileId}`
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
      source: window.location.hostname.toLowerCase(),
      searchProfileId:
        typeof requestInput?.searchId === "string" ? requestInput.searchId : "",
      language: typeof language === "string" ? language : "",
      pageNumber: currentPage,
    };
  });
}

/**
 * Extract resumes from seek talent-search (SearchProfilesByNaturalLanguage) list-page snapshot.
 * Mirrors the output shape of extractSeekResumes() exactly so downstream submit/identity/storage
 * code is unchanged.
 *
 * Node shape is TalentSearchProfileResultV2 — see dev-docs/seek-talent-search-graphql-recon.txt.
 *
 * externalId precedence: talent-search nodes have profileGuid (UUID) but NO numeric profileId.
 * We use profileGuid as the primary identifier. If the node had both a numeric profileId and a
 * profileGuid (not observed on talent-search, but defensively handled), we prefer profileGuid
 * to match the V3 profile request semantics (input.profileGuid: UUID).
 */
function extractSeekTalentSearchResumes() {
  const candidates = Array.isArray(apiSnapshot.seekTalentSearch)
    ? apiSnapshot.seekTalentSearch
    : [];
  const request = getSeekTalentSearchRequest();
  const requestInput = request?.variables?.input;
  const language = request?.variables?.language;
  const url = new URL(window.location.href);
  const currentPage =
    typeof requestInput?.pageNumber === "number"
      ? requestInput.pageNumber
      : normalizeOptionalPositiveInt(url.searchParams.get("pageNumber")) || 1;

  return candidates
    .map((node, index) => {
      // profileGuid (UUID) is the primary identity for talentsearch
      const profileGuid =
        typeof node?.profileGuid === "string" && node.profileGuid
          ? node.profileGuid
          : "";
      // Relay "id" — numeric-looking string, used as fallback
      const relayId =
        typeof node?.id === "string" && node.id ? node.id : "";
      // For talentsearch, profileId = profileGuid (UUID); numeric profileId
      // may become available after V3 detail enrichment
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
          ? `${window.location.hostname.toLowerCase()}:profile:${profileId}`
          : "",
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        profileUrl: buildSeekNameSearchUrl([firstName, lastName].filter(Boolean).join(" "), url.searchParams.get("market") || undefined, currentJobTitle),
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
        source: window.location.hostname.toLowerCase(),
        searchProfileId: "",
        language: typeof language === "string" ? language : "",
        pageNumber: currentPage,
      };
    })
    .filter(Boolean);
}

/**
 * Get pagination info
 * @returns {Object} - Current page, total pages, total items
 */
function getSeekCardCount() {
  return document.querySelectorAll(
    'a[href*="/talentsearch/profile/"][href*="profilePosition="]',
  ).length;
}

function getSeekPaginationInfo() {
  const isTalentSearch = getCurrentSeekMode() === "talentsearch";
  const currentPage =
    normalizeOptionalPositiveInt(
      new URL(window.location.href).searchParams.get("pageNumber"),
    ) || 1;
  const pagination = document.querySelector(
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

function getPaginationInfo() {
  const sourceKey = getCurrentSourceKey();
  if (sourceKey === SOURCE_KEYS.SEEK) {
    return getSeekPaginationInfo();
  }

  if (isJob51DetailPage()) {
    return {
      currentPage: 1,
      totalPages: 1,
      totalItems: isJob51DetailReady() ? 1 : 0,
      hasNextPage: false,
    };
  }

  if (sourceKey === SOURCE_KEYS.JOB51) {
    // 51job eHire uses infinite scroll, not Element UI pagination.
    // Derive current page from the captured API request's page_index.
    const req = apiSnapshot.job51LastSearchRequest;
    const currentPage =
      normalizeOptionalPositiveInt(
        req?.page_index ?? req?.pageIndex ?? req?.pageno,
      ) || 1;
    const pageSize =
      normalizeOptionalPositiveInt(
        req?.page_size ?? req?.pageSize ?? req?.pagesize,
      ) || 50;
    const total =
      typeof apiSnapshot.job51Total === "number" && apiSnapshot.job51Total > 0
        ? apiSnapshot.job51Total
        : 0;
    const hasData =
      Array.isArray(apiSnapshot.job51SearchRows) &&
      apiSnapshot.job51SearchRows.length > 0;
    let totalPages = currentPage;
    if (total > 0) {
      totalPages = Math.ceil(total / pageSize);
    } else if (hasData) {
      totalPages = currentPage + 1;
    }
    return {
      currentPage,
      totalPages,
      totalItems: total,
      hasNextPage: total > 0 ? currentPage < totalPages : (hasData && currentPage < totalPages),
    };
  }

  if (isJob5156DetailPage()) {
    return {
      currentPage: 1,
      totalPages: 1,
      totalItems: isJob5156DetailReady() ? 1 : 0,
      hasNextPage: false,
    };
  }

  const pagination = document.querySelector(SELECTORS.pagination);
  if (!pagination)
    return { currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false };

  const totalText = pagination.textContent || "";
  const totalMatch = totalText.match(/共\s*([\d,，]+)\s*条/);
  const totalItems = totalMatch
    ? Number.parseInt(String(totalMatch[1]).replace(/[，,]/g, ""), 10) || 0
    : 0;

  const activePage = pagination.querySelector(
    ".is-active, .active, .el-pager li.active",
  );
  const currentPage = activePage
    ? Number.parseInt(activePage.textContent || "", 10) || 1
    : 1;

  const pagerItems = Array.from(pagination.querySelectorAll(".el-pager li"));
  const pageNumbers = pagerItems
    .map((item) => Number.parseInt(item.textContent || "", 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const totalPagesFromPager =
    pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;
  const totalPagesFromTotal = totalItems > 0 ? Math.ceil(totalItems / 20) : 0;
  const totalPages = Math.max(
    totalPagesFromTotal,
    totalPagesFromPager,
    currentPage,
  );

  return {
    currentPage,
    totalPages,
    totalItems,
    hasNextPage: totalPages > currentPage,
  };
}

function getSeekNextPageLink() {
  const pagination = document.querySelector(SELECTORS.seekPagination);
  if (!pagination) return null;
  const links = Array.from(pagination.querySelectorAll("a"));
  const nextLink = links.find((node) =>
    /next/i.test((node.textContent || "").trim()),
  );
  return asHTMLElement(nextLink || null);
}

function getSeekTalentSearchNextPageLink() {
  const pagination = document.querySelector(SELECTORS.seekTalentSearchPagination);
  if (!pagination) return null;
  // Talent search pager exposes a[rel="next"] per recon; fall back to last anchor.
  const explicit = pagination.querySelector('a[rel="next"]');
  if (explicit) return asHTMLElement(explicit);
  const links = Array.from(pagination.querySelectorAll("a"));
  const labeled = links.find((node) =>
    /next/i.test((node.getAttribute("aria-label") || node.textContent || "").trim()),
  );
  return asHTMLElement(labeled || null);
}

function getSeekNextPageLinkForMode() {
  if (getCurrentSeekMode() === "talentsearch") {
    return getSeekTalentSearchNextPageLink();
  }
  return getSeekNextPageLink();
}



function getNextPageButtonState() {
  const sourceKey = getCurrentSourceKey();
  if (sourceKey === SOURCE_KEYS.SEEK) {
    const nextBtn = getSeekNextPageLinkForMode();
    if (!nextBtn) {
      return {
        exists: false,
      };
    }
    return {
      exists: true,
      text: nextBtn.textContent || "",
      href: nextBtn.getAttribute("href") || "",
      className: nextBtn.className || "",
      disabledAttr: nextBtn.getAttribute("disabled") || "",
      ariaDisabled: nextBtn.getAttribute("aria-disabled") || "",
      isDisabledClass: nextBtn.classList.contains("disabled"),
      isIsDisabledClass: nextBtn.classList.contains("is-disabled"),
    };
  }
  if (sourceKey === SOURCE_KEYS.JOB51) {
    const pagination = getPaginationInfo();
    return {
      exists: pagination.hasNextPage,
      source: "51job-api",
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
    };
  }
  const nextBtn = document.querySelector(SELECTORS.nextPageBtn);
  if (!nextBtn) {
    return {
      exists: false,
    };
  }
  return {
    exists: true,
    text: nextBtn.textContent || "",
    href: nextBtn.getAttribute("href") || "",
    className: nextBtn.className || "",
    disabledAttr: nextBtn.getAttribute("disabled") || "",
    ariaDisabled: nextBtn.getAttribute("aria-disabled") || "",
    isDisabledClass: nextBtn.classList.contains("disabled"),
    isIsDisabledClass: nextBtn.classList.contains("is-disabled"),
  };
}
function setAutoSyncAttributes(status, count, pagesProcessed) {
  try {
    document.documentElement.setAttribute("data-tr-auto-sync", status);
    if (typeof count === "number" && Number.isFinite(count)) {
      document.documentElement.setAttribute(
        "data-tr-auto-sync-count",
        String(count),
      );
    } else {
      document.documentElement.removeAttribute("data-tr-auto-sync-count");
    }
    if (typeof pagesProcessed === "number" && Number.isFinite(pagesProcessed)) {
      document.documentElement.setAttribute(
        "data-tr-auto-sync-pages",
        String(pagesProcessed),
      );
    } else {
      document.documentElement.removeAttribute("data-tr-auto-sync-pages");
    }
  } catch {
    // ignore
  }

  if (status && status !== "skipped") {
    persistLatestAutoSyncSummary();
  }
}

/**
 * @param {{
 *   limit?: number | null;
 *   totalSubmitted?: number | null;
 *   selectedCount?: number | null;
 *   ageHint?: string;
 * }} [options]
 */
function buildAutoSyncProgressHint({
  limit,
  totalSubmitted,
  selectedCount = null,
  ageHint = "",
} = {}) {
  const progressHint =
    limit > 0
      ? `已采集 ${Math.min(totalSubmitted, limit)}/${limit}`
      : `已采集 ${totalSubmitted}`;
  const selectedHint = buildAutoSyncSelectedCountHint({ selectedCount });

  return `${progressHint}${selectedHint}${ageHint}`;
}

/**
 * @param {{
 *   selectedCount?: number | null;
 *   prefix?: string;
 * }} [options]
 */
function buildAutoSyncSelectedCountHint({
  selectedCount = null,
  prefix = " · ",
} = {}) {
  return typeof selectedCount === "number" && Number.isFinite(selectedCount)
    ? `${prefix}本页选中 ${selectedCount} 份`
    : "";
}

/**
 * @param {{
 *   totalInserted?: number | null;
 *   totalUpdated?: number | null;
 *   pagesVisited?: number | null;
 *   selectedCount?: number | null;
 * }} [options]
 */
function buildAutoSyncCompletionHint({
  totalInserted = 0,
  totalUpdated = 0,
  pagesVisited = 0,
  selectedCount = null,
} = {}) {
  return `${totalInserted} 新增, ${totalUpdated} 更新, 共 ${pagesVisited} 页${buildAutoSyncSelectedCountHint(
    {
      selectedCount,
    },
  )}`;
}

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
    ? Array.from(document.querySelectorAll('[data-role="heading"]'))
    : null;

  const enriched = [];
  for (const resume of resumes) {
    enriched.push(await enrichSingleSeekResumeWithDetail(resume, cachedHeadings));
  }
  return enriched;
}

function waitForPagination({ timeoutMs = 8000 } = {}) {
  if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const isSeek = getCurrentSourceKey() === SOURCE_KEYS.SEEK;
      const seekTalentSearch = isSeek && getCurrentSeekMode() === "talentsearch";
      const pagination = document.querySelector(
        isSeek
          ? (seekTalentSearch
              ? SELECTORS.seekTalentSearchPagination
              : SELECTORS.seekPagination)
          : SELECTORS.pagination,
      );
      const nextBtn = isSeek
        ? getSeekNextPageLinkForMode()
        : document.querySelector(SELECTORS.nextPageBtn);
      if (pagination && nextBtn) {
        done = true;
        cleanup();
        resolve(true);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error("Timed out waiting for pagination controls"));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    check();
  });
}

/**
 * @param {{ expectedPage?: number; timeoutMs?: number }} options
 */
function waitForPageTransition(options = {}) {
  const { expectedPage, timeoutMs = 15000 } = options;
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(expectedPage) || expectedPage < 1) {
      reject(new Error("Invalid expected page"));
      return;
    }

    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const pagination = getPaginationInfo();
      if (pagination.currentPage === expectedPage) {
        done = true;
        cleanup();
        resolve(pagination.currentPage);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error(`Timed out waiting for page ${expectedPage}`));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    check();
  });
}


function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}



/**
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function asHTMLElement(element) {
  return element instanceof HTMLElement ? element : null;
}

/**
 * @param {ParentNode | null | undefined} container
 * @param {string} text
 * @returns {HTMLElement | null}
 */

/**
 * @param {string} blockSelector
 * @param {{ timeoutMs?: number, itemSelector?: string }} [options]
 * @returns {Promise<{ block: Element, items: Element[] }>}
 */





function setInputValue(input, value) {
  const inputWindow = input?.ownerDocument?.defaultView || window;
  const inputCtor =
    inputWindow.HTMLInputElement ||
    globalThis.HTMLInputElement;
  const descriptor = inputCtor
    ? Object.getOwnPropertyDescriptor(inputCtor.prototype, "value")
    : null;
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new inputWindow.Event("input", { bubbles: true }));
  input.dispatchEvent(new inputWindow.Event("change", { bubbles: true }));
}

function fireMouseEvent(target, type) {
  try {
    const targetWindow = target?.ownerDocument?.defaultView || window;
    target.dispatchEvent(
      new targetWindow.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: targetWindow,
      }),
    );
  } catch {
    // ignore
  }
}

function activateElement(target) {
  if (!target) {
    return;
  }
  ["mouseenter", "mouseover", "mousedown", "mouseup"].forEach((type) =>
    fireMouseEvent(target, type),
  );
  target.click?.();
}

function findVueParentByName(node, componentName, { maxDepth = 8 } = {}) {
  let vm = node?.__vue__ || null;
  for (let depth = 0; vm && depth < maxDepth; depth += 1) {
    if (vm?.$options?.name === componentName) {
      return vm;
    }
    vm = vm?.$parent || null;
  }
  return null;
}




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

function isLoggedIn() {
  return !document.querySelector('.login-btn, [href*="login"]');
}

function buildPersistedAutoSyncSummary(status = getExternalAccessorStatus()) {
  const autoSync = typeof status?.autoSync === "string" ? status.autoSync : "";
  if (!autoSync || autoSync === "skipped") {
    return null;
  }

  return {
    autoSync,
    autoSyncCount:
      typeof status?.autoSyncCount === "number" ? status.autoSyncCount : 0,
    autoSyncPages:
      typeof status?.autoSyncPages === "number" ? status.autoSyncPages : 0,
    autoSyncTargetPageStart: status?.autoSyncTargetPageStart ?? null,
    autoSyncTargetPageEnd: status?.autoSyncTargetPageEnd ?? null,
    autoSyncEffectivePageSize: status?.autoSyncEffectivePageSize ?? null,
    autoSyncSelectedCount: status?.autoSyncSelectedCount ?? null,
    autoSyncRemainingCapacity: status?.autoSyncRemainingCapacity ?? null,
    autoSyncStopReason: status?.autoSyncStopReason ?? null,
    sourceKey:
      typeof status?.sourceKey === "string"
        ? status.sourceKey
        : getCurrentSourceKey(),
    sourceUrl: window.location.href,
    summarySource: "stored",
    persistedAt: new Date().toISOString(),
  };
}

function persistLatestAutoSyncSummary() {
  try {
    if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.set) return;
    const summary = buildPersistedAutoSyncSummary();
    if (!summary) return;
    const sourceKey =
      typeof summary.sourceKey === "string" && summary.sourceKey
        ? summary.sourceKey
        : SOURCE_KEYS.UNKNOWN;

    const fingerprint = JSON.stringify({
      autoSync: summary.autoSync,
      autoSyncCount: summary.autoSyncCount,
      autoSyncPages: summary.autoSyncPages,
      autoSyncTargetPageStart: summary.autoSyncTargetPageStart,
      autoSyncTargetPageEnd: summary.autoSyncTargetPageEnd,
      autoSyncEffectivePageSize: summary.autoSyncEffectivePageSize,
      autoSyncSelectedCount: summary.autoSyncSelectedCount,
      autoSyncRemainingCapacity: summary.autoSyncRemainingCapacity,
      autoSyncStopReason: summary.autoSyncStopReason,
      sourceKey: summary.sourceKey,
      sourceUrl: summary.sourceUrl,
      summarySource: summary.summarySource,
    });

    if (
      summary.autoSync === "running" &&
      lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] === fingerprint
    ) {
      return;
    }

    lastPersistedAutoSyncSummaryFingerprintBySource[sourceKey] = fingerprint;
    chrome.storage.local.get(
      { [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY]: {} },
      (items) => {
        const existingSummaries =
          items?.[LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY];
        const nextSummaries =
          existingSummaries &&
          typeof existingSummaries === "object" &&
          !Array.isArray(existingSummaries)
            ? { ...existingSummaries }
            : {};
        nextSummaries[sourceKey] = summary;
        chrome.storage.local.set({
          [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY]: nextSummaries,
        });
      },
    );
  } catch (error) {
    console.warn(
      "🎯 [Auto Sync] Failed to persist latest auto sync summary:",
      error,
    );
  }
}

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
