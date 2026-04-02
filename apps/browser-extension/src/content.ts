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
const JOB5156_DETAIL_FETCH_TIMEOUT_MS = 5000;
const JOB5156_DETAIL_FETCH_CONCURRENCY = 5;
const JOB51_DETAIL_FETCH_TIMEOUT_MS = 8000;
const JOB51_DETAIL_FETCH_CONCURRENCY = 2;
const DEFAULT_SEEK_PAGE_SIZE = 20;
const LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY = "latestAutoSyncSummaries";
const DEFAULT_COLLECTION_GUARDS = {
  job5156: "experience,jobIntention,selfIntro",
  "51job": "experience,jobIntention,selfIntro",
  seek: "experience,jobIntention,selfIntro",
};

const apiSnapshot = {
  searchRows: null,
  job51SearchRows: null,
  job51Total: null,
  job51AuthContext: null,
  job51DetailPayload: null,
  attachInfo: null,
  chatInfo: null,
  insightInfo: null,
  seekRecommendedCandidates: null,
  seekRecommendedRequest: null,
  seekProfile: null,
  seekProfileRequest: null,
  lastUpdatedAt: null,
  lastSearchAt: null,
  lastUrl: null,
  lastSourceKey: null,
  lastOperationName: null,
};

const lastPersistedAutoSyncSummaryFingerprintBySource = {};
let job51DetailBackfillChain = Promise.resolve();
let job51DetailBackfillRunId = 0;

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

const PROVINCE_TOKENS = new Set([
  "北京",
  "天津",
  "上海",
  "重庆",
  "河北",
  "山西",
  "辽宁",
  "吉林",
  "黑龙江",
  "江苏",
  "浙江",
  "安徽",
  "福建",
  "江西",
  "山东",
  "河南",
  "湖北",
  "湖南",
  "广东",
  "海南",
  "四川",
  "贵州",
  "云南",
  "陕西",
  "甘肃",
  "青海",
  "台湾",
  "内蒙古",
  "广西",
  "西藏",
  "宁夏",
  "新疆",
  "香港",
  "澳门",
]);

function normalizeProvinceToken(value) {
  if (!value) return "";
  return value
    .trim()
    .replace(/特别行政区$/g, "")
    .replace(/壮族自治区$/g, "")
    .replace(/回族自治区$/g, "")
    .replace(/维吾尔自治区$/g, "")
    .replace(/自治区$/g, "")
    .replace(/省$/g, "")
    .replace(/市$/g, "");
}

function isProvinceToken(value) {
  const normalized = normalizeProvinceToken(value);
  return normalized ? PROVINCE_TOKENS.has(normalized) : false;
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

function normalizeSeekLocationLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bmalaysia\b/g, "")
    .replace(/\bmy\b/g, "")
    .replace(/[，,、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function isJob5156DetailPage() {
  return (
    getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
    /^\/resume\/view\//i.test(window.location.pathname)
  );
}

function isJob51DetailPage() {
  return (
    getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
    /\/Revision\/talent\/resume\/detail/i.test(window.location.pathname)
  );
}

function isJob51DetailReady() {
  return isJob51DetailPage() && !!apiSnapshot.job51DetailPayload;
}

function normalizeJob51AuthContext(requestHeaders, request) {
  const headers =
    requestHeaders && typeof requestHeaders === "object" ? requestHeaders : {};
  const requestBody = request && typeof request === "object" ? request : {};
  const pick = (...keys) => {
    for (const key of keys) {
      const headerValue = headers[key] ?? headers[key.toLowerCase()];
      if (typeof headerValue === "string" && headerValue.trim()) {
        return headerValue.trim();
      }
      const requestValue = requestBody[key];
      if (typeof requestValue === "string" && requestValue.trim()) {
        return requestValue.trim();
      }
    }
    return "";
  };

  const accesstoken = pick("accesstoken", "access-token", "accessToken");
  const guid = pick("guid");
  const property = pick("property");
  const sign = pick("sign");

  if (!accesstoken && !guid && !property && !sign) {
    return null;
  }

  return {
    ...(accesstoken ? { accesstoken } : {}),
    ...(guid ? { guid } : {}),
    ...(property ? { property } : {}),
    ...(sign ? { sign } : {}),
  };
}

function getApiSnapshotCount() {
  if (Array.isArray(apiSnapshot.searchRows)) {
    return apiSnapshot.searchRows.length;
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
    if (isJob51DetailPage()) {
      return isJob51DetailReady() ? 1 : 0;
    }
    return Array.isArray(apiSnapshot.job51SearchRows)
      ? apiSnapshot.job51SearchRows.length
      : 0;
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    return getSeekSnapshotCount();
  }
  return 0;
}

function getJob51RawRows(payload) {
  const rows =
    payload?.data?.list ||
    payload?.data?.items ||
    payload?.data?.rows ||
    payload?.list ||
    payload?.items ||
    payload?.rows ||
    (Array.isArray(payload?.data) ? payload.data : null) ||
    (Array.isArray(payload) ? payload : null);
  return Array.isArray(rows) ? rows : null;
}

function getJob51TotalFromPayload(payload) {
  const total = payload?.data?.total ?? payload?.total;
  return typeof total === "number" && total >= 0 ? total : null;
}

function isLikelyJob51ResumeRow(row) {
  if (!row || typeof row !== "object") return false;
  const baseInfo =
    row.base_info && typeof row.base_info === "object" ? row.base_info : null;
  const jobIntention =
    row.job_intention && typeof row.job_intention === "object"
      ? row.job_intention
      : null;
  const recentWorkInfo =
    row.recent_work_info && typeof row.recent_work_info === "object"
      ? row.recent_work_info
      : null;
  const identityCandidates = [
    row.resumeId,
    row.resumeNo,
    row.resumekey,
    row.perUserId,
    row.userId,
    row.candidateId,
    row.memberId,
    row.userid,
    row.real_userid,
    baseInfo?.accountid,
  ];
  const hasIdentity = identityCandidates.some((value) => {
    if (value == null) return false;
    return String(value).trim().length > 0;
  });
  const nameCandidates = [
    row.name,
    row.userName,
    row.candidateName,
    row.fullName,
    baseInfo?.resume_name,
  ];
  const hasName = nameCandidates.some((value) => {
    if (value == null) return false;
    return normalizeJob51Text(String(value)).length > 0;
  });
  const detailCandidates = [
    row.workYear,
    row.workYears,
    row.experienceYears,
    row.experience,
    row.education,
    row.educationLevel,
    row.degree,
    row.eduLevel,
    row.location,
    row.workCity,
    row.city,
    row.workLocation,
    row.jobIntention,
    row.desiredJob,
    row.expectedPosition,
    row.targetJob,
    row.searchJob,
    baseInfo?.work_year_value,
    baseInfo?.top_degree_value,
    baseInfo?.area_value,
    jobIntention?.expect_work_function_value,
    jobIntention?.expect_job_area_value,
    recentWorkInfo?.recent_position,
  ];
  const hasDetail = detailCandidates.some((value) => {
    if (value == null) return false;
    return normalizeJob51Text(String(value)).length > 0;
  });

  return (hasIdentity && hasName) || (hasName && hasDetail);
}

function getJob51ResumeRows(payload) {
  const rows = getJob51RawRows(payload);
  return Array.isArray(rows) ? rows.filter(isLikelyJob51ResumeRow) : null;
}

function hasJob51SearchSnapshot() {
  if (!Array.isArray(apiSnapshot.job51SearchRows)) return false;
  return (
    apiSnapshot.job51SearchRows.length > 0 ||
    typeof apiSnapshot.job51Total === "number"
  );
}

function isJob51EmptySearchPromptVisible() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return false;
  const pageText = normalizeResumeText(document.body?.textContent || "");
  return pageText.includes("输入关键词搜索寻找匹配人才");
}

function isJob51RateLimitedPage() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return false;
  const pageText = normalizeResumeText(document.body?.textContent || "");
  return (
    pageText.includes("搜索访问太快") && pageText.includes("请60分钟后再试")
  );
}

function ensureJob51PageAllowed() {
  if (isJob51RateLimitedPage()) {
    throw new Error(JOB51_RATE_LIMIT_ERROR_MESSAGE);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJob51Cooldown() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return;
  SyncStatusWidget.show({
    state: "progress",
    message: "51job 冷却中，暂缓翻页",
    hint: `固定等待 ${Math.round(JOB51_PAGE_COOLDOWN_MS / 1000)} 秒，避免触发访问限制`,
  });
  await delay(JOB51_PAGE_COOLDOWN_MS);
}

function normalizeJob51FreshStart() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.JOB51) return;
  if (!getAutoSyncEnabled()) return;
  if (hasJob51SearchSnapshot()) return;
  const url = new URL(window.location.href);
  const pageIndex = normalizeOptionalPositiveInt(
    url.searchParams.get("pageIndex"),
  );
  if (!pageIndex || pageIndex <= 1) return;
  url.searchParams.delete("pageIndex");
  window.history.replaceState(window.history.state, "", url.toString());
}

function isSeekProfilePage() {
  return window.location.pathname.includes("/talentsearch/profile/");
}

function isSeekInlineProfileMode() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) {
    return false;
  }

  if (!window.location.pathname.includes("/candidates/recommended")) {
    return false;
  }

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

function getSeekSnapshotCount() {
  if (isSeekProfileMode()) {
    return hasSeekProfileSnapshot() ? 1 : 0;
  }
  return hasSeekListSnapshot()
    ? apiSnapshot.seekRecommendedCandidates.length
    : 0;
}

function isSeekSnapshotReady() {
  return getSeekSnapshotCount() > 0;
}

function getJob5156DetailRoot() {
  const candidates = [
    ".resume-detail",
    ".resume-detail-content",
    ".resume-detail-main",
    ".resume-view-content",
    ".resume-content",
    ".detail-content",
    ".main-content",
    '[class*="resume-detail"]',
    '[class*="resumeDetail"]',
    '[class*="resume-view"]',
    '[class*="resumeView"]',
    "main",
  ];

  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (
      el instanceof Element &&
      normalizeResumeText(el.textContent || "").length > 40
    ) {
      return el;
    }
  }

  return document.body;
}

function getJob5156DetailHeaderText(root = getJob5156DetailRoot()) {
  if (!(root instanceof Element)) return "";
  const header = root.querySelector(
    'h1, .name, .resume-name, .basic-name, [class*="name"]',
  );
  return normalizeResumeText(
    header?.textContent ||
      root.querySelector(
        '.basic-line, .resume-basic-info, [class*="basic"], .resume-view-item__block.resume-basic',
      )?.textContent ||
      "",
  );
}

function isJob5156DetailReady() {
  if (!isJob5156DetailPage()) return false;
  const resumeId = extractJob5156ResumeId(window.location.pathname);
  if (!resumeId) return false;
  const root = getJob5156DetailRoot();
  const rootText = normalizeResumeText(root?.textContent || "");
  return (
    root instanceof Element &&
    rootText.length > 80 &&
    getJob5156DetailHeaderText(root).length > 0
  );
}

function isJob5156DetailRootReady(root, pathname) {
  if (!(root instanceof Element)) return false;
  const resumeId = extractJob5156ResumeId(pathname || "");
  if (!resumeId) return false;
  const rootText = normalizeResumeText(root.textContent || "");
  return rootText.length > 80 && getJob5156DetailHeaderText(root).length > 0;
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

function getSeekRecommendedRequest() {
  return apiSnapshot.seekRecommendedRequest;
}

function getSeekProfileRequest() {
  return apiSnapshot.seekProfileRequest || apiSnapshot.seekRecommendedRequest;
}

function getSeekAutoSyncHelpers() {
  const helpers = globalThis.__TR_SEEK_AUTO_SYNC__;
  return helpers && typeof helpers === "object" ? helpers : null;
}

/**
 * @param {{
 *   requestedPageSize?: number | null;
 *   currentPageCandidateCount?: number | null;
 *   fallbackPageSize?: number | null;
 * }} [options]
 */
function resolveSeekAutoSyncPageSize(options = {}) {
  const {
    requestedPageSize,
    currentPageCandidateCount,
    fallbackPageSize = DEFAULT_SEEK_PAGE_SIZE,
  } = options;
  const helpers = getSeekAutoSyncHelpers();
  if (typeof helpers?.resolveSeekAutoSyncPageSize === "function") {
    return helpers.resolveSeekAutoSyncPageSize({
      requestedPageSize,
      currentPageCandidateCount,
      fallbackPageSize,
    });
  }

  return (
    normalizeOptionalPositiveInt(requestedPageSize) ||
    normalizeOptionalPositiveInt(currentPageCandidateCount) ||
    normalizeOptionalPositiveInt(fallbackPageSize) ||
    DEFAULT_SEEK_PAGE_SIZE
  );
}

/**
 * @param {{
 *   startPage?: number | null;
 *   limit?: number | null;
 *   maxPages?: number | null;
 *   requestedPageSize?: number | null;
 *   currentPageCandidateCount?: number | null;
 * }} [options]
 */
function resolveSeekAutoSyncPageWindow(options = {}) {
  const {
    startPage,
    limit,
    maxPages,
    requestedPageSize,
    currentPageCandidateCount,
  } = options;
  const helpers = getSeekAutoSyncHelpers();
  if (typeof helpers?.resolveSeekAutoSyncPageWindow === "function") {
    return helpers.resolveSeekAutoSyncPageWindow({
      startPage,
      limit,
      maxPages,
      requestedPageSize,
      currentPageCandidateCount,
      fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE,
    });
  }

  const normalizedStartPage = normalizeOptionalPositiveInt(startPage) || 1;
  const normalizedLimit = normalizeOptionalPositiveInt(limit);
  const normalizedMaxPages = normalizeOptionalPositiveInt(maxPages);
  const effectivePageSize = resolveSeekAutoSyncPageSize({
    requestedPageSize,
    currentPageCandidateCount,
    fallbackPageSize: DEFAULT_SEEK_PAGE_SIZE,
  });
  const limitPageCount = normalizedLimit
    ? Math.max(1, Math.ceil(normalizedLimit / effectivePageSize))
    : null;

  let allowedPageCount = null;
  if (limitPageCount && normalizedMaxPages) {
    allowedPageCount = Math.min(limitPageCount, normalizedMaxPages);
  } else if (limitPageCount) {
    allowedPageCount = limitPageCount;
  } else if (normalizedMaxPages) {
    allowedPageCount = normalizedMaxPages;
  }

  return {
    startPage: normalizedStartPage,
    targetPageEnd: allowedPageCount
      ? normalizedStartPage + allowedPageCount - 1
      : null,
    effectivePageSize,
    limitPageCount,
    maxPages: normalizedMaxPages,
    allowedPageCount,
  };
}

/**
 * @param {{ targetPageEnd?: number | null } | null | undefined} pageWindow
 * @param {number | null | undefined} currentPage
 */
function isSeekAutoSyncPageWindowReached(pageWindow, currentPage) {
  const helpers = getSeekAutoSyncHelpers();
  if (typeof helpers?.isSeekAutoSyncPageWindowReached === "function") {
    return helpers.isSeekAutoSyncPageWindowReached({
      currentPage,
      targetPageEnd: pageWindow?.targetPageEnd,
    });
  }

  const normalizedCurrentPage = normalizeOptionalPositiveInt(currentPage);
  const targetPageEnd = normalizeOptionalPositiveInt(pageWindow?.targetPageEnd);
  return !!(
    normalizedCurrentPage &&
    targetPageEnd &&
    normalizedCurrentPage >= targetPageEnd
  );
}

/**
 * @param {{
 *   limit?: number | null;
 *   totalSubmitted?: number | null;
 *   currentPageResumeCount?: number | null;
 * }} [options]
 */
function resolveSeekAutoSyncCurrentPageSelection(options = {}) {
  const helpers = getSeekAutoSyncHelpers();
  if (typeof helpers?.resolveSeekAutoSyncCurrentPageSelection === "function") {
    return helpers.resolveSeekAutoSyncCurrentPageSelection(options);
  }

  const normalizedLimit = normalizeOptionalPositiveInt(options.limit);
  const normalizedTotalSubmitted =
    normalizeOptionalPositiveInt(options.totalSubmitted) || 0;
  const normalizedCurrentPageResumeCount =
    normalizeOptionalPositiveInt(options.currentPageResumeCount) || 0;
  const remainingCapacity = normalizedLimit
    ? Math.max(normalizedLimit - normalizedTotalSubmitted, 0)
    : null;
  const selectedCount =
    remainingCapacity === null
      ? normalizedCurrentPageResumeCount
      : Math.min(normalizedCurrentPageResumeCount, remainingCapacity);

  return {
    remainingCapacity,
    selectedCount,
    hitLimitWithinPage:
      remainingCapacity !== null &&
      normalizedCurrentPageResumeCount > remainingCapacity,
    limitAlreadyReached: remainingCapacity !== null && remainingCapacity <= 0,
  };
}

function getSeekRequestedPageSize() {
  const requestInput = getSeekRecommendedRequest()?.variables?.input;
  return normalizeOptionalPositiveInt(requestInput?.size);
}

function getSeekCurrentCandidateCount() {
  return Array.isArray(apiSnapshot.seekRecommendedCandidates)
    ? apiSnapshot.seekRecommendedCandidates.length
    : 0;
}

/**
 * @param {{
 *   startPage?: number | null;
 *   targetPageEnd?: number | null;
 *   effectivePageSize?: number | null;
 * } | null | undefined} pageWindow
 */
function setSeekAutoSyncWindowAttributes(pageWindow) {
  const attrs = /** @type {Array<[string, number | null | undefined]>} */ ([
    ["data-tr-auto-sync-target-start", pageWindow?.startPage],
    ["data-tr-auto-sync-target-end", pageWindow?.targetPageEnd],
    ["data-tr-auto-sync-effective-page-size", pageWindow?.effectivePageSize],
  ]);

  try {
    for (const [name, value] of attrs) {
      if (typeof value === "number" && Number.isFinite(value)) {
        document.documentElement.setAttribute(name, String(value));
      } else {
        document.documentElement.removeAttribute(name);
      }
    }
  } catch {
    // ignore
  }

  persistLatestAutoSyncSummary();
}

/**
 * @param {{
 *   selectedCount?: number | null;
 *   remainingCapacity?: number | null;
 * } | null | undefined} selection
 */
function setSeekAutoSyncSelectionAttributes(selection) {
  const attrs = /** @type {Array<[string, number | null | undefined]>} */ ([
    ["data-tr-auto-sync-selected-count", selection?.selectedCount],
    ["data-tr-auto-sync-remaining-capacity", selection?.remainingCapacity],
  ]);

  try {
    for (const [name, value] of attrs) {
      if (typeof value === "number" && Number.isFinite(value)) {
        document.documentElement.setAttribute(name, String(value));
      } else {
        document.documentElement.removeAttribute(name);
      }
    }
  } catch {
    // ignore
  }

  persistLatestAutoSyncSummary();
}

function findSeekProfileTrigger(profileId) {
  if (!profileId) return null;

  const candidateLinks = Array.from(document.querySelectorAll("a[href]"));
  return (
    candidateLinks.find((link) => {
      const href = link.getAttribute("href") || "";
      return (
        href.includes(
          `/talentsearch/profile/${encodeURIComponent(profileId)}`,
        ) || href.includes(`openProfileId=${encodeURIComponent(profileId)}`)
      );
    }) || null
  );
}

function mergeSeekListResumeWithDetail(baseResume, detailResume) {
  if (!detailResume || typeof detailResume !== "object") {
    return baseResume;
  }

  return {
    ...baseResume,
    ...detailResume,
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

function buildJob5156DetailWorkHistoryItem(item) {
  if (!(item instanceof Element)) return null;

  if (
    item.classList.contains("resume-work__info") ||
    item.closest(".resume-work")
  ) {
    const row1 = item.querySelector(".resume-work__row-1");
    const row2 = item.querySelector(".resume-work__row-2");
    const row3 = item.querySelector(".resume-work__row-3");
    const row4 = item.querySelector(".resume-work__row-4");
    const companyName = normalizeResumeText(
      row1?.querySelector(".flex.flex-1 > span.pointer")?.textContent,
    );
    const jobTitle = normalizeResumeText(
      row1?.querySelector(".flex.flex-1 > span:not(.pointer):not(.cut)")
        ?.textContent,
    );
    const periodText = normalizeResumeText(
      row1?.querySelector(".time-diff")?.textContent,
    );
    const periodMatch = periodText.match(/^(.+?)(?:（(.+)）)?$/u);
    const dateRange = normalizeResumeText(periodMatch?.[1] || periodText);
    const durationLabel = normalizeResumeText(periodMatch?.[2] || "");
    const startDate = dateRange.includes("~")
      ? normalizeResumeText(dateRange.split("~")[0])
      : dateRange;
    const endDate = dateRange.includes("~")
      ? normalizeResumeText(dateRange.split("~").slice(1).join("~"))
      : "";
    const companyMeta = normalizeResumeText(row2?.textContent);
    const description = normalizeResumeText(
      row3?.querySelector("pre")?.textContent || row3?.textContent,
    );
    const reasonText = normalizeResumeText(row4?.textContent).replace(
      /^离职原因[:：]?\s*/u,
      "",
    );
    const raw = buildWorkHistoryRawParts([
      dateRange,
      durationLabel ? `(${durationLabel})` : "",
      companyName,
      jobTitle,
      companyMeta ? `公司信息：${companyMeta}` : "",
      description,
      reasonText ? `离职原因：${reasonText}` : "",
    ]);

    if (!raw && !description && !companyName && !jobTitle) return null;

    return {
      raw:
        raw ||
        description ||
        buildWorkHistoryRawParts([companyName, jobTitle, dateRange]),
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description:
        [description, reasonText ? `离职原因：${reasonText}` : ""]
          .filter(Boolean)
          .join("\n") || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  const getText = (selectors) => {
    for (const selector of selectors) {
      const value = normalizeResumeText(
        item.querySelector(selector)?.textContent,
      );
      if (value) return value;
    }
    return "";
  };

  const getOwnText = (selectors) => {
    for (const selector of selectors) {
      const node = item.querySelector(selector);
      if (!(node instanceof Element)) continue;
      const text = normalizeResumeText(
        Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent || "")
          .join(" "),
      );
      if (text) return text;
    }
    return "";
  };

  const getLines = (selectors) => {
    for (const selector of selectors) {
      const nodes = item.querySelectorAll(selector);
      const values = Array.from(nodes)
        .map((node) => normalizeResumeText(node.textContent))
        .filter(Boolean);
      if (values.length > 0) return values;
    }
    return [];
  };

  const periodText = getText([
    ".work-time",
    ".time",
    ".date",
    ".work-date",
    ".job-time",
    '[class*="work-time"]',
    '[class*="job-time"]',
  ]);
  const startDate = periodText.includes("~")
    ? normalizeResumeText(periodText.split("~")[0])
    : periodText;
  const endDate = periodText.includes("~")
    ? normalizeResumeText(periodText.split("~").slice(1).join("~"))
    : "";
  const durationLabel = getText([
    ".work-time-other",
    ".time-other",
    ".duration",
    '[class*="duration"]',
  ]);
  const companyName = getText([
    ".work-company",
    ".company-name",
    ".company",
    '[class*="company"]',
  ]);
  const jobTitle = getText([
    ".work-position",
    ".job-title",
    ".position-name",
    ".position",
    '[class*="position"]',
    '[class*="job-title"]',
  ]);
  const department = getText([
    ".work-department",
    ".department",
    '[class*="department"]',
  ]);
  const companyMeta = getText([
    ".company-other",
    ".company-info",
    ".company-meta",
    '[class*="company-other"]',
    '[class*="company-info"]',
  ]);
  const reasonText = getText([
    ".work-reason",
    ".leave-reason",
    '[class*="leave-reason"]',
    '[class*="reason"]',
  ]).replace(/^离职原因[:：]?\s*/u, "");
  const ownDescription = getOwnText([
    ".work-desc",
    ".work-detail",
    ".work-content",
    ".work-responsibility",
    ".work-duty",
    '[class*="work-desc"]',
    '[class*="responsibility"]',
    '[class*="duty"]',
  ]);
  const descriptionLines = getLines([
    ".work-desc p, .work-detail p, .work-content p, .work-responsibility p, .work-duty p",
    ".work-desc li, .work-detail li, .work-content li, .work-responsibility li, .work-duty li",
    '[class*="work-desc"] p, [class*="responsibility"] p, [class*="duty"] p',
    '[class*="work-desc"] li, [class*="responsibility"] li, [class*="duty"] li',
  ]);
  const description = [
    ownDescription,
    descriptionLines.length > 0 ? descriptionLines.join("\n") : "",
    department ? `部门：${department}` : "",
    companyMeta ? `公司信息：${companyMeta}` : "",
    reasonText ? `离职原因：${reasonText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = buildWorkHistoryRawParts([
    periodText,
    durationLabel,
    companyName,
    jobTitle,
    department ? `部门：${department}` : "",
    companyMeta ? `公司信息：${companyMeta}` : "",
    ownDescription,
    descriptionLines.join("；"),
    reasonText ? `离职原因：${reasonText}` : "",
  ]);

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

function collectSectionItemsByHeading(
  root,
  headingPattern,
  primarySelectors = [],
  fallbackSelectors = [],
) {
  return collectJob5156SectionItemsByHeading(
    root,
    headingPattern,
    primarySelectors,
    fallbackSelectors,
  );
}

function buildJob5156DetailResumeFromRoot(root, options = {}) {
  if (!(root instanceof Element)) return [];

  const {
    pathname,
    profileUrl: profileUrlInput,
    extractedAt,
  } = normalizeJob5156ExtractOptions(options);
  if (!isJob5156DetailRootReady(root, pathname)) return [];

  const readText = (selectors, scopedRoot = root) => {
    for (const selector of selectors) {
      const value = normalizeResumeText(
        scopedRoot.querySelector(selector)?.textContent,
      );
      if (value) return value;
    }
    return "";
  };
  const resumeId = extractJob5156ResumeId(pathname);
  const profileUrl = normalizeJob5156ProfileUrlForExport(profileUrlInput);
  const basicTextNodes = Array.from(
    root.querySelectorAll(
      '.basic-line__text, .basic-line span, .resume-basic-info span, [class*="basic"] span, .info-item, .label-value, .tag',
    ),
  ).map((node) => node.textContent || "");
  const filteredBasicTextNodes = basicTextNodes.filter(
    (item) => !/求职状态|沟通中|更新时间/.test(item),
  );
  const { age, experience, education, location } = parseJob5156BasicInfoItems(
    filteredBasicTextNodes,
  );

  const workItems = collectSectionItemsByHeading(
    root,
    /工作经历|工作经验|工作履历/u,
    [
      ".resume-work__info",
      ".work-item",
      ".work-block",
      '[class*="work-item"]',
      '[class*="work-block"]',
    ],
    [
      ":scope > li",
      ":scope > .item",
      ':scope > [class*="item"]',
    ],
  );
  const educationItems = collectSectionItemsByHeading(
    root,
    /教育经历|教育背景|学习经历/u,
    [
      ".resume-education__info",
      ".school-item",
      '[class*="education"]',
      '[class*="school"]',
    ],
    [
      ":scope > li",
      ":scope > .item",
      ':scope > [class*="item"]',
    ],
  );
  const seenWorkHistory = new Set();
  const workHistory = workItems
    .map((item) => buildJob5156DetailWorkHistoryItem(item))
    .filter((item) => item && isMeaningfulJob5156WorkHistoryEntry(item))
    .filter((item) => {
      const signature = [
        item.companyName || "",
        item.jobTitle || "",
        item.startDate || "",
        item.endDate || "",
        item.raw || "",
      ].join("|");
      if (seenWorkHistory.has(signature)) return false;
      seenWorkHistory.add(signature);
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

  const activityStatus = readText([
    ".date-type-diff-text-block",
    ".resume-status",
    ".active-status",
    '[class*="status"]',
  ]);
  const intentionSection = root.querySelector(
    ".resume-view-layout.resume-interview",
  );
  const intentionItems = Array.from(
    intentionSection?.querySelectorAll(".resume-interview-info") || [],
  );
  const jobIntention = intentionItems
    .map((item) =>
      normalizeResumeText(item.querySelector(".pos-name")?.textContent),
    )
    .filter(Boolean)
    .join(" / ");
  const expectedSalary = normalizeResumeText(
    intentionItems[0]?.textContent,
  ).replace(/^.+?\s(\d[^\s]*元\/[月天年]).*$/u, "$1");
  const selfIntro = normalizeResumeText(
    root.querySelector(
      ".resume-view-layout.resume-advantages .resume-advantages_skill pre",
    )?.textContent ||
      root.querySelector(
        ".resume-view-layout.resume-advantages .resume-advantages_skill",
      )?.textContent ||
      "",
  );
  const name = readText([
    ".resume-name",
    ".basic-name",
    ".name",
    ".resume-view-item__block.resume-basic",
    "h1",
  ]);

  return [
    {
      resumeId,
      name,
      profileUrl,
      activityStatus,
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
      extractedAt,
      source: JOB5156_HOST,
    },
  ];
}

function extractJob5156DetailResume() {
  if (!isJob5156DetailPage() || !isJob5156DetailReady()) return [];
  return buildJob5156DetailResumeFromRoot(getJob5156DetailRoot(), {
    pathname: window.location.pathname,
    profileUrl: window.location.href,
  });
}

function buildJob5156DetailWorkHistoryItemFromApi(item) {
  if (!item || typeof item !== "object") return null;

  const begin = normalizeResumeText(item.begin);
  const end = normalizeResumeText(item.end);
  const dateRange = [begin, end].filter(Boolean).join("~");
  const durationLabel = normalizeResumeText(item.timeDiff || item.timeDiff2);
  const companyName = normalizeResumeText(item.comName || item.comNameStr);
  const jobTitle = normalizeResumeText(item.jobNameStr || item.jobName);
  const department = normalizeResumeText(item.section);
  const companyMeta = buildWorkHistoryRawParts([
    normalizeResumeText(item.comCallingStr),
    normalizeResumeText(item.comScaleStr),
    normalizeResumeText(item.comTypeStr),
  ]);
  const description = normalizeResumeMultilineText(item.description);
  const reasonText = normalizeResumeText(item.leftreason);
  const startDate = begin || undefined;
  const endDate = end || undefined;
  const descriptionLines = [
    companyMeta ? `公司信息：${companyMeta}` : "",
    department ? `部门：${department}` : "",
    description,
    reasonText ? `离职原因：${reasonText}` : "",
  ].filter(Boolean);
  const raw = buildWorkHistoryRawParts([
    dateRange,
    durationLabel ? `(${durationLabel})` : "",
    companyName,
    jobTitle,
    ...descriptionLines,
  ]);

  if (!raw && !description && !companyName && !jobTitle) return null;

  return {
    raw:
      raw ||
      description ||
      buildWorkHistoryRawParts([companyName, jobTitle, dateRange]),
    companyName: companyName || undefined,
    jobTitle: jobTitle || undefined,
    description: descriptionLines.join("\n") || undefined,
    startDate,
    endDate,
  };
}

function buildJob5156EducationItemFromApi(item) {
  if (!item || typeof item !== "object") return null;

  const institution = normalizeResumeText(item.schoolName);
  const degree = normalizeResumeText(item.degreeStr);
  const speciality = normalizeResumeText(item.speciality);
  const qualification = buildWorkHistoryRawParts([degree, speciality]);
  const endDate = normalizeResumeText(
    [item.begin, item.end].filter(Boolean).join("~") || item.end,
  );
  const description = buildWorkHistoryRawParts([
    degree,
    speciality,
    endDate,
    institution,
  ]);

  if (!institution && !qualification && !endDate) return null;

  return {
    institution: institution || undefined,
    qualification: qualification || undefined,
    endDate: endDate || undefined,
    description: description || undefined,
  };
}

function normalizeJob5156ExtractOptions(options = {}) {
  return {
    pathname:
      typeof options.pathname === "string"
        ? options.pathname
        : window.location.pathname,
    profileUrl:
      typeof options.profileUrl === "string"
        ? options.profileUrl
        : window.location.href,
    extractedAt:
      typeof options.extractedAt === "string"
        ? options.extractedAt
        : new Date().toISOString(),
  };
}

function buildJob5156DetailResumeFromApiPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") return [];

  const { pathname, profileUrl, extractedAt } =
    normalizeJob5156ExtractOptions(options);
  const resumeId =
    extractJob5156ResumeId(pathname) || normalizeResumeText(payload.resumeId);
  const normalizedProfileUrl = normalizeJob5156ProfileUrlForExport(profileUrl);
  const resumeView =
    payload.resumeViewVo && typeof payload.resumeViewVo === "object"
      ? payload.resumeViewVo
      : null;
  const cnVo =
    resumeView?.cnVo && typeof resumeView.cnVo === "object"
      ? resumeView.cnVo
      : null;
  const basicInfo =
    cnVo?.basicInfoVo && typeof cnVo.basicInfoVo === "object"
      ? cnVo.basicInfoVo
      : null;
  const intentInfo =
    cnVo?.intentInfoVo && typeof cnVo.intentInfoVo === "object"
      ? cnVo.intentInfoVo
      : null;

  if (!resumeId || !cnVo || !basicInfo) return [];

  const workHistory = Array.isArray(cnVo.workInfoVoList)
    ? cnVo.workInfoVoList
        .map((item) => buildJob5156DetailWorkHistoryItemFromApi(item))
        .filter(Boolean)
    : [];
  const profileEducation = Array.isArray(cnVo.educationInfoVoList)
    ? cnVo.educationInfoVoList
        .map((item) => buildJob5156EducationItemFromApi(item))
        .filter(Boolean)
    : [];
  const locationParts = [
    normalizeResumeText(cnVo.liveProvince),
    normalizeResumeText(cnVo.liveCity),
    normalizeResumeText(cnVo.liveTown),
  ].filter(Boolean);
  const intentionParts = Array.isArray(payload.intentInfoVo2List)
    ? payload.intentInfoVo2List
        .map((item) => normalizeResumeText(item.jobNameStr || item.jobCodeStr))
        .filter(Boolean)
    : [];

  return [
    {
      resumeId,
      perUserId: normalizeResumeText(payload.perUserId || basicInfo.id),
      name: normalizeResumeText(payload.userName || basicInfo.userName),
      profileUrl: normalizedProfileUrl,
      activityStatus: normalizeResumeText(basicInfo.jobStateStr),
      age: normalizeResumeText(basicInfo.age ? `${basicInfo.age}岁` : ""),
      experience: normalizeResumeText(
        basicInfo.firstWorkingTimeStr || basicInfo.jobyearTypeStr,
      ),
      education: normalizeResumeText(
        basicInfo.degreeStr || cnVo.maxDegree?.degreeStr,
      ),
      location: normalizeResumeText(
        locationParts.join("") || basicInfo.locationStr,
      ),
      jobIntention: normalizeResumeText(
        intentionParts.join(",") ||
          (intentInfo?.jobLocationStr &&
            `${intentInfo.jobLocationStr}${intentInfo.jobCodeStr ? `${intentInfo.jobCodeStr}` : ""}`) ||
          intentInfo?.jobCodeStr,
      ),
      expectedSalary: normalizeResumeText(
        payload.salaryStr || intentInfo?.salaryStr,
      ),
      selfIntro: normalizeResumeText(intentInfo?.professionSkill),
      workHistory,
      profileEducation:
        profileEducation.length > 0 ? profileEducation : undefined,
      extractedAt,
      source: JOB5156_HOST,
    },
  ];
}

async function fetchJob5156ResumeDetail(profileUrl, pathname) {
  const resumePathname =
    typeof pathname === "string" && pathname
      ? pathname
      : new URL(profileUrl).pathname;
  const resumeId = extractJob5156ResumeId(resumePathname);
  if (!resumeId) return null;

  const url = new URL(
    `/api/com/resume/${encodeURIComponent(resumeId)}`,
    window.location.origin,
  );
  url.searchParams.set("t", String(Date.now()));
  url.searchParams.set("version", "1");
  url.searchParams.set("dataVersions", "");
  url.searchParams.set("modType", "search");
  url.searchParams.set("keyWord", "");
  url.searchParams.set("searchNo", "0");
  url.searchParams.set("searchNumber", "0");
  url.searchParams.set("searchPageNumber", "0");
  url.searchParams.set("index_number", "0");
  url.searchParams.set("isTopResume", "false");
  url.searchParams.set("isWindow", "true");
  url.searchParams.set("resumeId", resumeId);
  url.searchParams.set("indexNumber", "0");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    JOB5156_DETAIL_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url.toString(), {
      credentials: "include",
      headers: {
        Accept: "application/json",
        appType: "pc",
        pcVersion: "1.0.1",
        posTypeNewFlag: "true",
        version: "2.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const payload = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      payload.code !== 200 ||
      !payload.data
    )
      return null;
    return payload.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return null;
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function enrichSingleJob5156SearchResumeWithDetail(resume, extractedAt) {
  if (!resume || typeof resume !== "object") return null;

  const profileUrl = normalizeJob5156ProfileUrlForExport(
    resume.profileUrl || "",
  );
  const fallbackResume = {
    ...resume,
    profileUrl,
    extractedAt: resume.extractedAt || extractedAt,
  };

  if (!profileUrl) return fallbackResume;

  try {
    let detailResume = null;
    const pathname = new URL(profileUrl).pathname;
    const detailPayload = await fetchJob5156ResumeDetail(profileUrl, pathname);
    if (detailPayload) {
      detailResume =
        buildJob5156DetailResumeFromApiPayload(detailPayload, {
          pathname,
          profileUrl,
          extractedAt: fallbackResume.extractedAt,
        })[0] || null;
    }

    if (!detailResume) {
      const response = await fetch(profileUrl, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (response.ok) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        detailResume =
          buildJob5156DetailResumeFromRoot(doc.body, {
            pathname,
            profileUrl,
            extractedAt: fallbackResume.extractedAt,
          })[0] || null;
      }
    }

    if (!detailResume) return fallbackResume;

    return {
      ...fallbackResume,
      ...detailResume,
      workHistory: detailResume.workHistory || fallbackResume.workHistory || [],
      resumeId: detailResume.resumeId || fallbackResume.resumeId,
      perUserId: detailResume.perUserId || fallbackResume.perUserId,
      extractedAt: fallbackResume.extractedAt,
    };
  } catch (error) {
    console.warn(
      "🎯 [Auto Sync] Failed to enrich Job5156 detail resume:",
      profileUrl,
      error,
    );
    return fallbackResume;
  }
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

async function enrichJob5156SearchResumesWithDetail(resumes) {
  if (!Array.isArray(resumes) || resumes.length === 0) return [];

  const extractedAt = new Date().toISOString();
  const collectionGuards = await loadCollectionGuards();
  const guardFields = parseGuardFieldNames(collectionGuards?.job5156);
  const enriched = [];

  for (
    let start = 0;
    start < resumes.length;
    start += JOB5156_DETAIL_FETCH_CONCURRENCY
  ) {
    const batch = resumes.slice(
      start,
      start + JOB5156_DETAIL_FETCH_CONCURRENCY,
    );
    const batchResults = await Promise.all(
      batch.map((resume) =>
        enrichSingleJob5156SearchResumeWithDetail(resume, extractedAt),
      ),
    );

    enriched.push(
      ...batchResults
        .filter(Boolean)
        .map((resume) => applyCollectionGuards(resume, guardFields)),
    );
  }

  return enriched;
}

function isJob51RateLimitedErrorMessage(message) {
  const normalized = normalizeResumeText(String(message || ""));
  return (
    normalized.includes("搜索访问太快") ||
    normalized.includes("请60分钟后再试") ||
    normalized.includes("访问频率限制") ||
    normalized.includes("频率限制") ||
    normalized.toLowerCase().includes("rate limit")
  );
}

function isJob51RateLimitedPayload(payload) {
  if (!payload) return false;
  const candidates = [
    payload.error,
    payload.message,
    payload.msg,
    payload.detail,
    payload.data?.error,
    payload.data?.message,
    payload.data?.msg,
    payload.data?.detail,
  ];
  return candidates.some((value) => isJob51RateLimitedErrorMessage(value));
}

function isJob51DetailApiErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.result === "0" || payload.result === 0) return true;
  return (
    typeof payload.code === "string" &&
    payload.code.length > 0 &&
    payload.code !== "200" &&
    payload.code !== "0" &&
    typeof payload.msg === "string" &&
    payload.msg.length > 0
  );
}

async function collectJob51DetailFromBackground(resumeId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "collectJob51ResumeDetail",
      resumeId,
    });
    if (response?.success) {
      return {
        payload: response.data ?? response.payload ?? response.resume ?? null,
        rateLimited: false,
      };
    }
    const errorMessage = response?.error ? String(response.error) : "";
    return {
      payload: null,
      rateLimited: isJob51RateLimitedErrorMessage(errorMessage),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "");
    return {
      payload: null,
      rateLimited: isJob51RateLimitedErrorMessage(message),
    };
  }
}

async function fetch51JobResumeDetail(resumeId) {
  const normalizedResumeId = normalizeJob51Text(resumeId);
  if (!normalizedResumeId) {
    return { payload: null, rateLimited: false };
  }

  const authContext = apiSnapshot.job51AuthContext;
  const requestBody = {
    resume_id: normalizedResumeId,
    resumeId: normalizedResumeId,
    userid: normalizedResumeId,
    lan: "c",
    timestamp: Math.floor(Date.now() / 1000),
    ...(authContext?.property ? { property: authContext.property } : {}),
    ...(authContext?.sign ? { sign: authContext.sign } : {}),
  };

  if (authContext?.accesstoken || authContext?.guid || authContext?.property) {
    const headers = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      ...(authContext.accesstoken
        ? { accesstoken: authContext.accesstoken }
        : {}),
      ...(authContext.guid ? { guid: authContext.guid } : {}),
      ...(authContext.property ? { property: authContext.property } : {}),
    };
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      JOB51_DETAIL_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        "https://ehirej.51job.com/resumedtl/getresume",
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      if (response.status === 403) {
        return { payload: null, rateLimited: true };
      }

      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (isJob51RateLimitedPayload(payload)) {
          return { payload: null, rateLimited: true };
        }
        if (isJob51DetailApiErrorPayload(payload)) {
          console.warn(
            "🎯 [Auto Sync] Job51 detail API error, falling back to background:",
            normalizedResumeId,
            payload?.code,
            payload?.msg,
          );
        } else if (payload) {
          return { payload, rateLimited: false };
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "");
      if (isJob51RateLimitedErrorMessage(message)) {
        return { payload: null, rateLimited: true };
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        console.warn(
          "🎯 [Auto Sync] Direct Job51 detail fetch timed out:",
          normalizedResumeId,
        );
      } else {
        console.warn(
          "🎯 [Auto Sync] Direct Job51 detail fetch failed:",
          normalizedResumeId,
          error,
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  return collectJob51DetailFromBackground(normalizedResumeId);
}

async function enrich51JobSearchResumeWithDetail(resume, extractedAt) {
  if (!resume || typeof resume !== "object") {
    return {
      resume: null,
      enriched: false,
      rateLimited: false,
    };
  }

  const fallbackResume = {
    ...resume,
    extractedAt: resume.extractedAt || extractedAt,
  };
  const resumeId =
    normalizeJob51Text(resume.resumeId) ||
    normalizeJob51Text(resume.perUserId) ||
    "";

  if (!resumeId) {
    return {
      resume: fallbackResume,
      enriched: false,
      rateLimited: false,
    };
  }

  try {
    const detailResult = await fetch51JobResumeDetail(resumeId);
    if (!detailResult?.payload) {
      return {
        resume: fallbackResume,
        enriched: false,
        rateLimited: !!detailResult?.rateLimited,
      };
    }

    const detailResume =
      buildJob51DetailResumeFromPayload(detailResult.payload, {
        resumeId,
        profileUrl: fallbackResume.profileUrl || "",
      })[0] || null;

    if (!detailResume) {
      return {
        resume: fallbackResume,
        enriched: false,
        rateLimited: !!detailResult.rateLimited,
      };
    }

    return {
      resume: {
        ...fallbackResume,
        ...detailResume,
        name: detailResume.name || fallbackResume.name || "",
        age: detailResume.age || fallbackResume.age || "",
        experience: detailResume.experience || fallbackResume.experience || "",
        education: detailResume.education || fallbackResume.education || "",
        location: detailResume.location || fallbackResume.location || "",
        jobIntention:
          detailResume.jobIntention || fallbackResume.jobIntention || "",
        expectedSalary:
          detailResume.expectedSalary || fallbackResume.expectedSalary || "",
        activityStatus:
          detailResume.activityStatus || fallbackResume.activityStatus || "",
        selfIntro: detailResume.selfIntro || fallbackResume.selfIntro || "",
        resumeId: detailResume.resumeId || fallbackResume.resumeId,
        perUserId: detailResume.perUserId || fallbackResume.perUserId,
        externalId: detailResume.externalId || fallbackResume.externalId,
        profileUrl: detailResume.profileUrl || fallbackResume.profileUrl,
        extractedAt: fallbackResume.extractedAt,
        pageIndex: fallbackResume.pageIndex,
        pageNumber: fallbackResume.pageNumber,
        workHistory:
          Array.isArray(detailResume.workHistory) &&
          detailResume.workHistory.length > 0
            ? detailResume.workHistory
            : Array.isArray(fallbackResume.workHistory)
              ? fallbackResume.workHistory
              : [],
        projectExperience:
          Array.isArray(detailResume.projectExperience) &&
          detailResume.projectExperience.length > 0
            ? detailResume.projectExperience
            : Array.isArray(fallbackResume.projectExperience)
              ? fallbackResume.projectExperience
              : [],
        profileEducation:
          Array.isArray(detailResume.profileEducation) &&
          detailResume.profileEducation.length > 0
            ? detailResume.profileEducation
            : Array.isArray(fallbackResume.profileEducation)
              ? fallbackResume.profileEducation
              : [],
        skills:
          Array.isArray(detailResume.skills) && detailResume.skills.length > 0
            ? detailResume.skills
            : Array.isArray(fallbackResume.skills)
              ? fallbackResume.skills
              : [],
        licences:
          Array.isArray(detailResume.licences) &&
          detailResume.licences.length > 0
            ? detailResume.licences
            : Array.isArray(fallbackResume.licences)
              ? fallbackResume.licences
              : [],
      },
      enriched: true,
      rateLimited: !!detailResult.rateLimited,
    };
  } catch (error) {
    console.warn(
      "🎯 [Auto Sync] Failed to enrich Job51 detail resume:",
      resumeId,
      error,
    );
    return {
      resume: fallbackResume,
      enriched: false,
      rateLimited: false,
    };
  }
}

async function enrich51JobSearchResumesWithDetail(resumes, options = {}) {
  if (!Array.isArray(resumes) || resumes.length === 0) return [];

  const extractedAt = new Date().toISOString();
  const interBatchDelayMs =
    typeof options.interBatchDelayMs === "number" &&
    Number.isFinite(options.interBatchDelayMs)
      ? options.interBatchDelayMs
      : resolveCurrentJob51DetailFetchDelayMs();
  const collectionGuards = await loadCollectionGuards();
  const guardFields = parseGuardFieldNames(
    collectionGuards?.[SOURCE_KEYS.JOB51],
  );
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
        enriched.push(applyCollectionGuards(result.resume, guardFields));
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
  const useProfileMode = captureModeOverride
    ? captureModeOverride === "graphql-profile"
    : isSeekProfileMode();
  const request = useProfileMode
    ? getSeekProfileRequest()
    : getSeekRecommendedRequest();
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
    (useProfileMode && apiSnapshot.seekProfile
      ? "graphql-profile"
      : "graphql-list");
  const defaultOperation =
    captureMode === "graphql-profile"
      ? "GetTalentSearchProfileCompleteV2"
      : "GetTalentSearchRecommendedCandidates";

  return {
    captureMode,
    operation: apiSnapshot.lastOperationName || defaultOperation,
    jobId:
      requestInput?.jobId != null
        ? String(requestInput.jobId)
        : jobIdFromUrl != null
          ? String(jobIdFromUrl)
          : undefined,
    searchId:
      typeof requestInput?.searchId === "string"
        ? requestInput.searchId
        : undefined,
    pageNumber:
      typeof requestInput?.page === "number"
        ? requestInput.page
        : (pageNumberFromUrl ?? undefined),
    language: typeof language === "string" ? language : undefined,
    profileType: SEEK_PROFILE_TYPE,
  };
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

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractJob5156ResumeId(pathname) {
  if (!pathname || typeof pathname !== "string") return "";

  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
  if (oldRouteMatch && oldRouteMatch[1]) {
    return decodeURIComponentSafe(oldRouteMatch[1]);
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
  if (viewRouteMatch && viewRouteMatch[1]) {
    return decodeURIComponentSafe(viewRouteMatch[1]);
  }

  return "";
}

function normalizeJob5156ProfileUrlForExport(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const directResumeId = extractJob5156ResumeId(trimmed);
  if (directResumeId) {
    return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(directResumeId)}`;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.hostname.toLowerCase() !== JOB5156_HOST) {
      return parsed.href;
    }

    const resumeId = extractJob5156ResumeId(parsed.pathname);
    if (!resumeId) {
      return parsed.href;
    }

    return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`;
  } catch {
    return trimmed;
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
      if (kind === "seekProfile") {
        return !!(
          data.talentSearchProfileV2 ||
          data.talentSearchProfileCompleteV2 ||
          data.getTalentSearchProfileCompleteV2
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

function updateApiSnapshot(message) {
  const {
    kind,
    payload,
    url,
    sourceKey,
    operationName,
    request,
    requestHeaders,
  } = message;
  apiSnapshot.lastUpdatedAt = new Date().toISOString();
  if (url) apiSnapshot.lastUrl = url;
  apiSnapshot.lastSourceKey = sourceKey || null;
  apiSnapshot.lastOperationName = operationName || null;

  try {
    document.documentElement.setAttribute("data-tr-api-last", kind);
    document.documentElement.setAttribute(
      "data-tr-api-updated",
      apiSnapshot.lastUpdatedAt,
    );
    if (sourceKey) {
      document.documentElement.setAttribute("data-tr-source-key", sourceKey);
    }
  } catch {
    // ignore
  }

  if (kind === "search") {
    const rows = payload?.data?.resumePage?.rows;
    if (Array.isArray(rows)) {
      apiSnapshot.searchRows = rows;
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute(
          "data-tr-api-rows",
          String(getApiSnapshotCount()),
        );
      } catch {
        // ignore
      }
    }
    return;
  }
  if (kind === "job51search") {
    const authContext = normalizeJob51AuthContext(requestHeaders, request);
    if (authContext) {
      apiSnapshot.job51AuthContext = {
        ...(apiSnapshot.job51AuthContext || {}),
        ...authContext,
      };
    }
    const total = getJob51TotalFromPayload(payload);
    if (typeof total === "number") {
      apiSnapshot.job51Total = total;
    }
    const rows = getJob51ResumeRows(payload);
    const hasResultPayload = Array.isArray(rows) || typeof total === "number";
    if (hasResultPayload) {
      apiSnapshot.job51SearchRows = Array.isArray(rows) ? rows : [];
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute(
          "data-tr-api-rows",
          String(getApiSnapshotCount()),
        );
      } catch {
        // ignore
      }
    }
    return;
  }
  if (kind === "job51detail") {
    const authContext = normalizeJob51AuthContext(requestHeaders, request);
    if (authContext) {
      apiSnapshot.job51AuthContext = {
        ...(apiSnapshot.job51AuthContext || {}),
        ...authContext,
      };
    }
    apiSnapshot.job51DetailPayload = payload || null;
    try {
      document.documentElement.setAttribute(
        "data-tr-api-rows",
        String(getApiSnapshotCount()),
      );
    } catch {
      // ignore
    }
    return;
  }
  if (kind === "attach") {
    apiSnapshot.attachInfo = payload?.data?.attachResumeInfo || null;
    return;
  }
  if (kind === "chat") {
    apiSnapshot.chatInfo = payload?.data?.chatInfo || null;
    return;
  }
  if (kind === "insight") {
    apiSnapshot.insightInfo =
      payload?.data?.talentInsightInfo || payload?.data || null;
    return;
  }
  if (kind === "seekRecommendedCandidates") {
    const data = getSeekPayloadData(payload, kind);
    const candidates =
      data?.talentSearchRecommendedCandidatesV2?.items ||
      data?.getTalentSearchRecommendedCandidates?.candidates;
    if (Array.isArray(candidates)) {
      apiSnapshot.seekRecommendedCandidates = candidates;
      apiSnapshot.seekRecommendedRequest = request || null;
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute(
          "data-tr-api-rows",
          String(getApiSnapshotCount()),
        );
      } catch {
        // ignore
      }
    }
    return;
  }
  if (kind === "seekProfile") {
    const data = getSeekPayloadData(payload, kind);
    apiSnapshot.seekProfile =
      data?.talentSearchProfileV2 ||
      data?.talentSearchProfileCompleteV2 ||
      data?.getTalentSearchProfileCompleteV2 ||
      data ||
      null;
    apiSnapshot.seekProfileRequest =
      request ||
      apiSnapshot.seekProfileRequest ||
      apiSnapshot.seekRecommendedRequest ||
      null;
    try {
      document.documentElement.setAttribute(
        "data-tr-api-rows",
        String(getApiSnapshotCount()),
      );
    } catch {
      // ignore
    }
    return;
  }
}

function installApiHook() {
  try {
    if (document.documentElement.hasAttribute("data-tr-page-hook")) {
      document.documentElement.setAttribute("data-tr-resume-hook", "true");
      return;
    }
    if (document.documentElement.hasAttribute("data-tr-resume-hook")) return;
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-hook.js");
    script.async = false;
    script.setAttribute("data-tr-resume-hook", "true");
    script.onload = () => script.remove();
    const mountTarget = document.head || document.documentElement;
    mountTarget.prepend(script);
    document.documentElement.setAttribute("data-tr-resume-hook", "true");
  } catch (error) {
    console.warn("Failed to install API hook:", error);
  }
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

function extract51JobResumes() {
  if (!Array.isArray(apiSnapshot.job51SearchRows)) return [];
  return apiSnapshot.job51SearchRows.map((row, index) => {
    const str = (v) => (v != null ? String(v) : "");
    const baseInfo =
      row?.base_info && typeof row.base_info === "object" ? row.base_info : {};
    const jobIntentionInfo =
      row?.job_intention && typeof row.job_intention === "object"
        ? row.job_intention
        : {};
    const recentWorkInfo =
      row?.recent_work_info && typeof row.recent_work_info === "object"
        ? row.recent_work_info
        : {};
    const workList = Array.isArray(row?.work_list) ? row.work_list : [];
    const educationList = Array.isArray(row?.education_list)
      ? row.education_list
      : [];
    const latestWork =
      workList.find(
        (item) => item && typeof item === "object" && item.is_show,
      ) ||
      workList[0] ||
      {};
    const latestEducation =
      educationList.find(
        (item) => item && typeof item === "object" && item.degree_value,
      ) ||
      educationList[0] ||
      {};
    const uniqueSkillTags = Array.from(
      new Set(
        [
          ...(Array.isArray(row?.label_sorted_skill_tag_list)
            ? row.label_sorted_skill_tag_list
            : []),
          ...(Array.isArray(row?.label_list) ? row.label_list : []),
        ]
          .map((value) => normalizeJob51Text(value))
          .filter(Boolean),
      ),
    );
    const workHistory = workList
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const startDate = normalizeJob51Text(item.start_time);
        const endDate = normalizeJob51Text(item.end_time);
        const durationLabel = normalizeJob51Text(item.working_years);
        const companyName = normalizeJob51Text(item.company_name);
        const jobTitle = normalizeJob51Text(
          item.work_func_value || item.job_name,
        );
        const metaParts = [
          ...(Array.isArray(item.industry_tag) ? item.industry_tag : []),
          item.company_size_value,
          item.work_type_value,
        ]
          .map((value) => normalizeJob51Text(value))
          .filter(Boolean);
        if (
          !startDate &&
          !endDate &&
          !companyName &&
          !jobTitle &&
          metaParts.length === 0
        ) {
          return null;
        }
        return {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          durationLabel: durationLabel || undefined,
          companyName: companyName || undefined,
          jobTitle: jobTitle || undefined,
          description:
            metaParts.length > 0
              ? buildWorkHistoryRawParts(metaParts)
              : undefined,
        };
      })
      .filter(Boolean);
    const name = normalizeJob51Text(
      baseInfo.resume_name ||
        row?.name ||
        row?.userName ||
        row?.candidateName ||
        row?.fullName,
    );
    const ageValue = normalizeJob51Text(
      baseInfo.age || row?.age || row?.realAge,
    );
    const age = ageValue
      ? ageValue.includes("岁")
        ? ageValue
        : `${ageValue}岁`
      : "";
    const experience = normalizeJob51Text(
      baseInfo.work_year_value ||
        latestWork.working_years ||
        row?.workYear ||
        row?.workYears ||
        row?.experienceYears ||
        row?.experience,
    );
    const education = normalizeJob51Text(
      baseInfo.top_degree_value ||
        latestEducation.degree_value ||
        row?.education ||
        row?.educationLevel ||
        row?.degree ||
        row?.eduLevel,
    );
    const location = normalizeJob51Text(
      jobIntentionInfo.expect_job_area_value ||
        baseInfo.area_value ||
        row?.location ||
        row?.workCity ||
        row?.city ||
        row?.workLocation,
    );
    const jobIntention = normalizeJob51Text(
      jobIntentionInfo.expect_work_function_value ||
        latestWork.work_func_value ||
        latestWork.job_name ||
        recentWorkInfo.recent_position ||
        row?.jobIntention ||
        row?.desiredJob ||
        row?.expectedPosition ||
        row?.targetJob ||
        row?.searchJob,
    );
    const expectedSalary = normalizeJob51Text(
      jobIntentionInfo.new_expect_salary ||
        jobIntentionInfo.expect_salary ||
        row?.expectedSalary ||
        row?.desiredSalary ||
        row?.expectSalary ||
        row?.salaryExpect,
    );
    const activityStatus = normalizeJob51Text(
      row?.active_type ||
        row?.activityStatus ||
        row?.lastLoginTime ||
        row?.activeTime ||
        row?.refreshTime,
    );
    const selfIntro = normalizeJob51MultilineText(
      row?.resume_slicing ||
        row?.selfIntro ||
        row?.advantage ||
        row?.profile ||
        row?.highlight ||
        uniqueSkillTags.join("、"),
    );
    const resumeId = str(
      row?.userid ||
        row?.resumeId ||
        row?.resumeNo ||
        row?.resumekey ||
        row?.id,
    );
    const perUserId = str(
      baseInfo.accountid ||
        row?.real_userid ||
        row?.perUserId ||
        row?.userId ||
        row?.candidateId ||
        row?.memberId,
    );
    const externalId = resumeId || perUserId;
    const profileUrl = resumeId
      ? EHIRE_51JOB_PROFILE_URL_PREFIX + encodeURIComponent(resumeId)
      : normalizeJob51Text(row?.profileUrl || row?.resumeUrl);
    return {
      name,
      age,
      experience,
      education,
      location,
      jobIntention,
      expectedSalary,
      activityStatus,
      selfIntro,
      resumeId: resumeId || undefined,
      perUserId: perUserId || undefined,
      externalId: externalId || undefined,
      profileUrl: profileUrl || undefined,
      source: EHIRE_51JOB_HOST,
      workHistory,
      pageIndex: index + 1,
      rawData: row,
      extractedAt: new Date().toISOString(),
    };
  });
}

function extractJob51DetailResume() {
  if (!isJob51DetailPage() || !isJob51DetailReady()) return [];
  return filterCurrentResumesByAgeRange(
    buildJob51DetailResumeFromPayload(apiSnapshot.job51DetailPayload, {
      resumeId:
        new URL(window.location.href).searchParams.get("resumeId") || undefined,
      profileUrl: window.location.href,
    }),
  );
}

function extractResumes() {
  if (isJob51DetailPage()) {
    return filterCurrentResumesByAgeRange(extractJob51DetailResume());
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.JOB51) {
    return filterCurrentResumesByAgeRange(extract51JobResumes());
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    if (isSeekProfileMode()) {
      if (hasSeekProfileSnapshot()) {
        return extractSeekProfileResume();
      }
      return [];
    }
    if (hasSeekListSnapshot()) {
      return extractSeekResumes();
    }
  }

  if (isJob5156DetailPage()) {
    return filterCurrentResumesByAgeRange(extractJob5156DetailResume());
  }

  const cards = document.querySelectorAll(SELECTORS.resumeCard);
  const resumes = [];

  cards.forEach((card, index) => {
    try {
      const apiRow = getApiRowForIndex(index);
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

  return filterCurrentResumesByAgeRange(resumes);
}

/**
 * Extract raw HTML/text from resume cards (no predefined schema).
 * @param {Object} [options]
 * @param {boolean} [options.includePage=false] - Include full page HTML
 * @returns {Object} - Raw payload
 */
function extractResumesRaw(options = {}) {
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
    const candidates =
      !seekProfile && hasSeekListSnapshot()
        ? apiSnapshot.seekRecommendedCandidates
        : [];
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
          const { profileId, profileType } =
            getSeekCandidateIdentity(candidate);
          return {
            index: index + 1,
            profileId,
            profileType,
            text: JSON.stringify(candidate, null, 2),
          };
        });

    if (seekProfile || candidates.length > 0) {
      const payload = {
        url: window.location.href,
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
            : getSeekRecommendedRequest(),
        },
      };

      if (includePage) {
        payload.pageHtml = document.documentElement.outerHTML;
      }

      return payload;
    }
  }

  if (isJob51DetailPage() && isJob51DetailReady()) {
    const detailResumes = extractJob51DetailResume();
    const detailResume = detailResumes[0] || null;
    const payload = {
      url: window.location.href,
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
      payload.pageHtml = document.documentElement.outerHTML;
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
            resumeId: detailResumes[0]?.resumeId || "",
            perUserId: "",
            html: detailRoot?.outerHTML || "",
            text: detailRootElement?.innerText || detailRoot?.textContent || "",
          },
        ]
      : Array.from(document.querySelectorAll(SELECTORS.resumeCard)).map(
          (card, index) => {
            const el = /** @type {HTMLElement} */ (card);
            return {
              index: index + 1,
              resumeId: getApiRowForIndex(index)?.resumeId ?? "",
              perUserId: getApiRowForIndex(index)?.perUserId ?? "",
              html: el.outerHTML,
              text: el.innerText,
            };
          },
        );

  const payload = {
    url: window.location.href,
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
    payload.pageHtml = document.documentElement.outerHTML;
  }

  return payload;
}

function normalizeCardText(text) {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function rawToMarkdown(rawPayload) {
  const lines = [];
  lines.push("# Resume Dump (Raw)");
  lines.push("");
  lines.push(`- URL: ${rawPayload.url}`);
  lines.push(`- Extracted: ${rawPayload.extractedAt}`);
  lines.push(`- Count: ${rawPayload.count}`);
  lines.push("");

  rawPayload.cards.forEach((card, idx) => {
    const indexLabel = String(idx + 1).padStart(2, "0");
    lines.push(`## Card ${indexLabel}`);
    if (card.resumeId || card.perUserId) {
      lines.push(`- resumeId: ${card.resumeId || ""}`);
      lines.push(`- perUserId: ${card.perUserId || ""}`);
      lines.push("");
    }
    lines.push("```text");
    const normalized = normalizeCardText(card.text);
    lines.push(normalized || "(empty)");
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Convert resumes to CSV format
 * @param {Array} resumes - Array of resume objects
 * @returns {string} - CSV string
 */
function resumesToCSV(resumes) {
  if (resumes.length === 0) return "";

  const headers = [
    "序号",
    "resumeId",
    "perUserId",
    "姓名",
    "年龄",
    "工作经验",
    "学历",
    "所在地",
    "自我评价",
    "期望薪资",
    "活跃状态",
    "求职意向",
    "简历链接",
    "提取时间",
  ];
  const rows = resumes.map((r, i) =>
    [
      i + 1,
      r.resumeId || "",
      r.perUserId || "",
      r.name,
      r.age,
      r.experience,
      r.education,
      r.location,
      r.selfIntro,
      r.expectedSalary,
      r.activityStatus,
      r.jobIntention?.replace(/,/g, ";").substring(0, 100),
      r.profileUrl,
      r.extractedAt,
    ]
      .map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function makeRandomId() {
  try {
    if (globalThis.crypto?.randomUUID)
      return globalThis.crypto.randomUUID().split("-")[0];
  } catch {
    // ignore
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Download data as file via background script (chrome.downloads API)
 * Using background script ensures filenames are preserved on macOS
 * @param {string} content - File content
 * @param {string} filename - File name
 * @param {string} mimeType - MIME type
 * @param {boolean} saveAs - Whether to show "Save As" dialog
 * @returns {Promise<object>} - Download result
 */
async function downloadFile(content, filename, mimeType, saveAs = false) {
  const response = await chrome.runtime.sendMessage({
    action: "downloadFile",
    content: content,
    filename: filename,
    mimeType: mimeType,
    saveAs: !!saveAs,
  });
  if (response?.success) return response;
  throw new Error(response?.error || "Download failed");
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
  const currentPage =
    normalizeOptionalPositiveInt(
      new URL(window.location.href).searchParams.get("pageNumber"),
    ) || 1;
  const pagination = document.querySelector(
    'nav[aria-label="Pagination of results"]',
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
  const nextLink = getSeekNextPageLink();
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
    const pageParam =
      normalizeOptionalPositiveInt(
        new URL(window.location.href).searchParams.get("pageIndex"),
      ) || 1;
    const hasData =
      Array.isArray(apiSnapshot.job51SearchRows) &&
      apiSnapshot.job51SearchRows.length > 0;
    const total =
      typeof apiSnapshot.job51Total === "number" && apiSnapshot.job51Total > 0
        ? apiSnapshot.job51Total
        : 0;
    let totalPages = pageParam;
    if (total > 0) {
      totalPages = Math.ceil(total / 50);
    } else if (hasData) {
      totalPages = pageParam + 1;
    }
    return {
      currentPage: pageParam,
      totalPages,
      totalItems: total,
      hasNextPage: hasData && pageParam < totalPages,
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

function goToNextPageInternal() {
  const sourceKey = getCurrentSourceKey();
  if (sourceKey === SOURCE_KEYS.SEEK) {
    const nextBtn = getSeekNextPageLink();
    if (!nextBtn || isDisabledPaginationControl(nextBtn)) return false;
    nextBtn.click();
    return true;
  }
  if (sourceKey === SOURCE_KEYS.JOB51) {
    const url = new URL(window.location.href);
    const currentPage =
      normalizeOptionalPositiveInt(url.searchParams.get("pageIndex")) || 1;
    const nextPage = currentPage + 1;
    url.searchParams.set("pageIndex", String(nextPage));
    const trWindow = /** @type {Window & { __trJob51NextPage?: number }} */ (
      window
    );
    trWindow.__trJob51NextPage = nextPage;
    window.history.pushState(null, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    return true;
  }
  const nextBtn = asHTMLElement(document.querySelector(SELECTORS.nextPageBtn));
  if (!nextBtn || isDisabledPaginationControl(nextBtn)) return false;
  nextBtn.click();
  return true;
}

function getNextPageButtonState() {
  const sourceKey = getCurrentSourceKey();
  if (sourceKey === SOURCE_KEYS.SEEK) {
    const nextBtn = getSeekNextPageLink();
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

function parseAutoExportMode(value) {
  if (!value) return { enabled: false };
  const mode = String(value).trim().toLowerCase();
  if (!mode) return { enabled: false };

  const config = {
    enabled: true,
    logStructured: false,
    logRaw: false,
    downloadCsv: false,
    downloadJson: false,
    downloadRawJson: false,
    downloadMarkdown: false,
    saveAs: false,
    rawIncludePage: false,
  };

  if (mode === "1" || mode === "true") {
    config.downloadMarkdown = true;
    return config;
  }
  if (mode === "console" || mode === "log") {
    config.logStructured = true;
    return config;
  }
  if (mode === "csv") {
    config.downloadCsv = true;
    return config;
  }
  if (mode === "json") {
    config.downloadJson = true;
    return config;
  }
  if (mode === "both" || mode === "all") {
    config.downloadCsv = true;
    config.downloadJson = mode === "all";
    config.logStructured = true;
    return config;
  }
  if (mode === "raw") {
    config.logRaw = true;
    return config;
  }
  if (mode === "raw_json" || mode === "rawjson") {
    config.downloadRawJson = true;
    return config;
  }
  if (mode === "md" || mode === "markdown") {
    config.downloadMarkdown = true;
    return config;
  }

  const tokens = mode
    .split(/[,+|]/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === "console" || token === "log") config.logStructured = true;
    if (token === "csv") config.downloadCsv = true;
    if (token === "json") config.downloadJson = true;
    if (token === "raw") config.logRaw = true;
    if (token === "rawjson" || token === "raw_json")
      config.downloadRawJson = true;
    if (token === "md" || token === "markdown") config.downloadMarkdown = true;
    if (token === "page" || token === "rawpage") config.rawIncludePage = true;
    if (token === "saveas") config.saveAs = true;
  }

  if (
    !config.logStructured &&
    !config.logRaw &&
    !config.downloadCsv &&
    !config.downloadJson &&
    !config.downloadRawJson &&
    !config.downloadMarkdown
  ) {
    config.downloadMarkdown = true;
  }

  return config;
}

function getAutoExportConfig() {
  const params = new URLSearchParams(window.location.search || "");
  const paramValue = params.get(AUTO_EXPORT_PARAM);
  if (paramValue) return parseAutoExportMode(paramValue);

  try {
    const localValue = window.localStorage?.getItem(AUTO_EXPORT_PARAM);
    return parseAutoExportMode(localValue);
  } catch {
    return { enabled: false };
  }
}

function parseAutoSyncFlag(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function getAutoSyncEnabled() {
  const params = new URLSearchParams(window.location.search || "");
  if (params.has(AUTO_SYNC_PARAM)) {
    return parseAutoSyncFlag(params.get(AUTO_SYNC_PARAM));
  }

  try {
    const localValue = window.localStorage?.getItem(AUTO_SYNC_PARAM);
    return parseAutoSyncFlag(localValue);
  } catch {
    return false;
  }
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

function waitForResumeCards({ timeoutMs = 30000, minCount = 1 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const count = document.querySelectorAll(SELECTORS.resumeCard).length;
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
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    check();
  });
}

function waitForApiRows({ timeoutMs = 5000, minCount = 1 } = {}) {
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
    observer.observe(document.body || document.documentElement, {
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
  apiSnapshot.job51DetailPayload = null;
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    apiSnapshot.seekRecommendedCandidates = null;
    apiSnapshot.seekRecommendedRequest = null;
    apiSnapshot.seekProfile = null;
    apiSnapshot.seekProfileRequest = null;
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
      if (identity?.profileId === String(profileId)) {
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
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    check();
  });
}

async function enrichSingleSeekResumeWithDetail(resume) {
  const profileId =
    typeof resume?.profileId === "string" ? resume.profileId.trim() : "";
  if (!profileId) {
    return resume;
  }

  const trigger = findSeekProfileTrigger(profileId);
  if (!(trigger instanceof HTMLElement)) {
    return resume;
  }

  try {
    trigger.click();
    await waitForSeekProfileSnapshot(profileId, { timeoutMs: 12000 });
    const [detailResume] = extractSeekProfileResume();
    if (!detailResume || detailResume.profileId !== profileId) {
      return resume;
    }
    return mergeSeekListResumeWithDetail(resume, detailResume);
  } catch (error) {
    console.warn(
      "🎯 [Auto Sync] Failed to enrich Seek detail resume:",
      profileId,
      error,
    );
    return resume;
  }
}

async function enrichSeekRecommendedResumesWithDetail(resumes) {
  if (!Array.isArray(resumes) || resumes.length === 0) return [];
  if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return resumes;
  if (isSeekProfileMode()) return resumes;

  const enriched = [];
  for (const resume of resumes) {
    enriched.push(await enrichSingleSeekResumeWithDetail(resume));
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
      const pagination = document.querySelector(
        isSeek ? SELECTORS.seekPagination : SELECTORS.pagination,
      );
      const nextBtn = isSeek
        ? getSeekNextPageLink()
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

function waitForSearchElements({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const sourceKey = getCurrentSourceKey();
      const inputSel =
        sourceKey === SOURCE_KEYS.JOB51
          ? SELECTORS.job51SearchInput
          : SELECTORS.searchInput;
      const buttonSel =
        sourceKey === SOURCE_KEYS.JOB51
          ? SELECTORS.job51SearchButton
          : SELECTORS.searchButton;
      const input = document.querySelector(inputSel);
      const button = document.querySelector(buttonSel);
      if (input && button) {
        done = true;
        cleanup();
        resolve({ input, button });
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error("Timed out waiting for search controls"));
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

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function waitForAreaModal({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const modal = document.querySelector(SELECTORS.areaModal);
      if (modal && isElementVisible(modal)) {
        done = true;
        cleanup();
        resolve(modal);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error("Timed out waiting for area selector modal"));
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

function getAreaItemText(item) {
  if (!item) return "";
  const source = item.querySelector("span") || item;
  const clone = source.cloneNode(true);
  clone.querySelectorAll(".select-num").forEach((node) => node.remove());
  return (
    (clone.textContent || "")
      // Remove icon-font glyphs that are rendered as private-use unicode chars.
      .replace(/[\uE000-\uF8FF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
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
function findAreaItemByText(container, text) {
  if (!container || !text) return null;
  const target = text.replace(/\s+/g, " ").trim();
  const normalizedTarget = normalizeSeekLocationLabel(target);
  const itemSelector = `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;
  const items = container.querySelectorAll(itemSelector);
  let normalizedMatch = null;
  for (const item of items) {
    const itemText = getAreaItemText(item);
    if (itemText === target) return asHTMLElement(item);
    if (!normalizedMatch) {
      const normalizedItemText = normalizeSeekLocationLabel(itemText);
      if (
        normalizedTarget &&
        normalizedItemText &&
        (normalizedItemText === normalizedTarget ||
          normalizedItemText.includes(normalizedTarget) ||
          normalizedTarget.includes(normalizedItemText))
      ) {
        normalizedMatch = asHTMLElement(item);
      }
    }
  }
  return normalizedMatch;
}

/**
 * @param {string} blockSelector
 * @param {{ timeoutMs?: number, itemSelector?: string }} [options]
 * @returns {Promise<{ block: Element, items: Element[] }>}
 */
function waitForAreaItems(
  blockSelector,
  { timeoutMs = 5000, itemSelector } = {},
) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;
    const targetSelector =
      itemSelector || `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;

    const check = () => {
      if (done) return;
      const block = document.querySelector(blockSelector);
      const items = block ? block.querySelectorAll(targetSelector) : [];
      if (block && items.length > 0) {
        done = true;
        cleanup();
        resolve({ block, items: Array.from(items) });
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(
          new Error(`Timed out waiting for area items in ${blockSelector}`),
        );
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

function waitForAreaTrigger({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const trigger = asHTMLElement(
        document.querySelector(SELECTORS.areaTrigger),
      );
      if (trigger && isElementVisible(trigger)) {
        done = true;
        cleanup();
        resolve(trigger);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error("Timed out waiting for area trigger"));
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

function setAutoSearchAttributes(status, keyword) {
  try {
    document.documentElement.setAttribute("data-tr-auto-search", status);
    if (keyword) {
      document.documentElement.setAttribute("data-tr-search-keyword", keyword);
    } else {
      document.documentElement.removeAttribute("data-tr-search-keyword");
    }
  } catch {
    // ignore
  }
}

function setAutoLocationAttributes(status, location) {
  try {
    document.documentElement.setAttribute("data-tr-auto-location", status);
    if (location) {
      document.documentElement.setAttribute("data-tr-location-value", location);
    } else {
      document.documentElement.removeAttribute("data-tr-location-value");
    }
  } catch {
    // ignore
  }
}

function canSkipAutoLocationForSeekPage() {
  if (getCurrentSourceKey() !== SOURCE_KEYS.SEEK) return false;
  return window.location.pathname.includes("/candidates/recommended");
}

function setAutoAgeAttributes(status, minAge, maxAge) {
  try {
    document.documentElement.setAttribute("data-tr-auto-age", status);
    const normalizedMin =
      typeof minAge === "number" && Number.isFinite(minAge)
        ? Math.trunc(minAge)
        : null;
    const normalizedMax =
      typeof maxAge === "number" && Number.isFinite(maxAge)
        ? Math.trunc(maxAge)
        : null;
    if (normalizedMin !== null || normalizedMax !== null) {
      document.documentElement.setAttribute(
        "data-tr-age-range",
        `${normalizedMin !== null ? normalizedMin : ""}-${normalizedMax !== null ? normalizedMax : ""}`,
      );
    } else {
      document.documentElement.removeAttribute("data-tr-age-range");
    }
  } catch {
    // ignore
  }
}

function setInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fireMouseEvent(target, type) {
  try {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window }),
    );
  } catch {
    // ignore
  }
}

function findAgeFilterBlock() {
  const titles = document.querySelectorAll(".base-input-block__title__text");
  const label = Array.from(titles).find(
    (node) => (node.textContent || "").replace(/\s+/g, "").trim() === "年龄",
  );
  return label ? label.closest(".base-input-block") : null;
}

function openAgeFilterDropdown(ageBlock) {
  const title = ageBlock.querySelector(".base-input-block__title") || ageBlock;
  ["mouseenter", "mouseover", "mousedown", "mouseup", "click"].forEach((type) =>
    fireMouseEvent(title, type),
  );
}

async function waitForAgeFilterDropdown(ageBlock, { timeoutMs = 4000 } = {}) {
  const selectBox = ageBlock.querySelector(".base-input-block__select_box");
  if (!selectBox) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isElementVisible(selectBox)) {
      return selectBox;
    }
    openAgeFilterDropdown(ageBlock);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return isElementVisible(selectBox) ? selectBox : null;
}

function resolveAgeFilterActions(selectBox) {
  const minInput = selectBox.querySelector('input[placeholder="最低"]');
  const maxInput = selectBox.querySelector('input[placeholder="最高"]');
  const buttons = Array.from(selectBox.querySelectorAll("button"));
  const confirmButton = buttons.find((button) => {
    const text = (button.textContent || "").replace(/\s+/g, "").trim();
    return text === "确定" || text === "確定";
  });
  const cancelButton = buttons.find((button) => {
    const text = (button.textContent || "").replace(/\s+/g, "").trim();
    return text === "取消";
  });

  return { minInput, maxInput, confirmButton, cancelButton };
}

async function autoApplyAgeFilterFromUrl() {
  const sourceKey = getCurrentSourceKey();
  const range = getCurrentAgeRange();
  if (!range.enabled) {
    setAutoAgeAttributes("skipped");
    return;
  }

  const minAge = range.minAge;
  const maxAge = range.maxAge;
  if (
    typeof minAge === "number" &&
    typeof maxAge === "number" &&
    minAge > maxAge
  ) {
    setAutoAgeAttributes("failed", minAge, maxAge);
    console.warn("🎯 [Auto Age] Invalid age range (minAge > maxAge):", {
      minAge,
      maxAge,
    });
    return;
  }

  const ageBlock = findAgeFilterBlock();
  if (!ageBlock) {
    if (sourceKey === SOURCE_KEYS.JOB51) {
      setAutoAgeAttributes("filtered-only", minAge, maxAge);
      console.warn(
        "🎯 [Auto Age] 51job age filter control not found; relying on extracted resume filtering.",
      );
      return;
    }
    setAutoAgeAttributes("failed", minAge, maxAge);
    console.warn(
      "🎯 [Auto Age] Age filter control not found; skipping native age filter apply.",
    );
    return;
  }

  const selectBox = await waitForAgeFilterDropdown(ageBlock, {
    timeoutMs: 5000,
  });
  if (!selectBox) {
    if (sourceKey === SOURCE_KEYS.JOB51) {
      setAutoAgeAttributes("filtered-only", minAge, maxAge);
      console.warn(
        "🎯 [Auto Age] 51job age filter dropdown did not open; relying on extracted resume filtering.",
      );
      return;
    }
    setAutoAgeAttributes("failed", minAge, maxAge);
    console.warn("🎯 [Auto Age] Failed to open age filter dropdown.");
    return;
  }

  const { minInput, maxInput, confirmButton, cancelButton } =
    resolveAgeFilterActions(selectBox);
  if (!minInput || !maxInput || !confirmButton) {
    if (sourceKey === SOURCE_KEYS.JOB51) {
      setAutoAgeAttributes("filtered-only", minAge, maxAge);
      if (cancelButton) {
        cancelButton.click();
      }
      console.warn(
        "🎯 [Auto Age] 51job age filter inputs/buttons not found; relying on extracted resume filtering.",
      );
      return;
    }
    setAutoAgeAttributes("failed", minAge, maxAge);
    if (cancelButton) {
      cancelButton.click();
    }
    console.warn(
      "🎯 [Auto Age] Age filter inputs/buttons not found; skipping native age filter apply.",
    );
    return;
  }

  setInputValue(minInput, typeof minAge === "number" ? String(minAge) : "");
  setInputValue(maxInput, typeof maxAge === "number" ? String(maxAge) : "");
  confirmButton.click();
  setAutoAgeAttributes("done", minAge, maxAge);

  try {
    await waitForExtractionData({ timeoutMs: 15000 });
  } catch (error) {
    console.warn(
      "🎯 [Auto Age] Applied age filter, but waiting for results timed out:",
      error,
    );
  }
}

async function autoSelectLocation() {
  const params = new URLSearchParams(window.location.search || "");
  const locationRaw = (params.get(AUTO_LOCATION_PARAM) || "").trim();
  const parsedLocations = parseAutoLocationValues(locationRaw);

  if (parsedLocations.length === 0) {
    setAutoLocationAttributes("skipped", "");
    return;
  }

  console.log("🎯 [Auto Location] Selecting locations:", parsedLocations);

  let modal = document.querySelector(SELECTORS.areaModal);
  if (!isElementVisible(modal)) {
    let trigger;
    try {
      trigger = await waitForAreaTrigger({});
    } catch {
      if (canSkipAutoLocationForSeekPage()) {
        setAutoLocationAttributes("skipped", locationRaw);
        console.warn(
          "🎯 [Auto Location] Trigger not found; skipping on SEEK recommended page",
        );
      } else {
        setAutoLocationAttributes("failed", locationRaw);
        console.warn("🎯 [Auto Location] Trigger not found");
      }
      return;
    }
    trigger.click();
    try {
      modal = await waitForAreaModal({});
    } catch (error) {
      if (canSkipAutoLocationForSeekPage()) {
        setAutoLocationAttributes("skipped", locationRaw);
        console.warn(
          "🎯 [Auto Location] Area selector not ready; skipping on SEEK recommended page:",
          error,
        );
      } else {
        setAutoLocationAttributes("failed", locationRaw);
        console.warn("🎯 [Auto Location] Area selector not ready:", error);
      }
      return;
    }
  }

  const provinceBlock = modal.querySelector(SELECTORS.areaProvinceBlock);
  const confirmBtn = asHTMLElement(
    modal.querySelector(SELECTORS.areaConfirmBtn),
  );
  const cancelBtn = asHTMLElement(modal.querySelector(SELECTORS.areaCancelBtn));
  if (!provinceBlock || !confirmBtn || !cancelBtn) {
    if (canSkipAutoLocationForSeekPage()) {
      setAutoLocationAttributes("skipped", locationRaw);
      console.warn(
        "🎯 [Auto Location] Missing modal controls; skipping on SEEK recommended page",
      );
    } else {
      setAutoLocationAttributes("failed", locationRaw);
      console.warn("🎯 [Auto Location] Missing modal controls");
    }
    return;
  }
  const locationsToSelect = parsedLocations.filter((location, index) => {
    const next = parsedLocations[index + 1];
    return !(next && isProvinceToken(location) && !isProvinceToken(next));
  });

  const selectAllDistrictAndConfirm = async (loc) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { block: districtBlock } = await waitForAreaItems(
      SELECTORS.areaDistrictBlock,
      {
        itemSelector: SELECTORS.areaDistrictItem,
        timeoutMs: 5000,
      },
    );
    const districtItems = Array.from(
      districtBlock.querySelectorAll(SELECTORS.areaDistrictItem),
    );
    const selectAllDistrict =
      findAreaItemByText(districtBlock, `全${loc}`) ||
      asHTMLElement(
        districtItems.find((item) => getAreaItemText(item).startsWith("全")) ||
          null,
      );
    if (!selectAllDistrict) return false;
    selectAllDistrict.click();
    return true;
  };

  const tryCityFlow = async (loc) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { block: cityBlock } = await waitForAreaItems(
      SELECTORS.areaCityBlock,
      {
        itemSelector: SELECTORS.areaItem,
        timeoutMs: 5000,
      },
    );
    const cityMatch = findAreaItemByText(cityBlock, loc);
    if (!cityMatch) return false;
    cityMatch.click();

    if (cityMatch.textContent.trim().startsWith("全")) {
      return true;
    }

    return await selectAllDistrictAndConfirm(loc);
  };

  // Keep track of which locations we've successfully selected
  const successLocations = [];
  const failedLocations = [];

  for (const location of locationsToSelect) {
    let found = false;
    const provinceMatch = findAreaItemByText(provinceBlock, location);

    if (provinceMatch) {
      provinceMatch.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const { block: cityBlock } = await waitForAreaItems(
          SELECTORS.areaCityBlock,
          {
            itemSelector: SELECTORS.areaItem,
            timeoutMs: 5000,
          },
        );
        const cityItems = Array.from(
          cityBlock.querySelectorAll(SELECTORS.areaItem),
        );
        const selectAllCity =
          findAreaItemByText(cityBlock, `全${location}`) ||
          findAreaItemByText(cityBlock, location) ||
          asHTMLElement(
            cityItems.find((item) => getAreaItemText(item).startsWith("全")) ||
              null,
          );
        if (selectAllCity) {
          selectAllCity.click();
          if (selectAllCity.textContent.trim().startsWith("全")) {
            found = true;
          } else if (await selectAllDistrictAndConfirm(location)) {
            found = true;
          }
        }
      } catch {
        // Continue to city-level fallback.
      }
    }

    if (!found) {
      const hotCities = findAreaItemByText(provinceBlock, "热门城市");
      if (hotCities) {
        hotCities.click();
        try {
          if (await tryCityFlow(location)) {
            found = true;
          }
        } catch {
          // Continue to province scan fallback.
        }
      }
    }

    if (!found) {
      const provinceItems = Array.from(
        provinceBlock.querySelectorAll(SELECTORS.areaItem),
      );
      for (const province of provinceItems) {
        const hotCities = findAreaItemByText(provinceBlock, "热门城市");
        if (hotCities && province === hotCities) continue;
        const provinceEl = asHTMLElement(province);
        if (!provinceEl) continue;
        provinceEl.click();
        try {
          if (await tryCityFlow(location)) {
            found = true;
            break;
          }
        } catch {
          // Continue scanning other provinces.
        }
      }
    }

    if (found) {
      successLocations.push(location);
    } else {
      failedLocations.push(location);
      console.warn("🎯 [Auto Location] Location not found:", location);
    }
  }

  // Final confirmation step
  if (successLocations.length > 0) {
    confirmBtn.click();
    setAutoLocationAttributes("done", successLocations.join(","));
  } else {
    cancelBtn.click();
    if (canSkipAutoLocationForSeekPage()) {
      setAutoLocationAttributes("skipped", locationRaw);
    } else {
      setAutoLocationAttributes("failed", locationRaw);
    }
  }
}

async function autoSearchFromUrl() {
  const params = new URLSearchParams(window.location.search || "");
  const urlKeywordMode = params.get(AUTO_KEYWORD_MODE_PARAM);
  const keywordMode = normalizeKeywordMode(
    urlKeywordMode || (await getKeywordMode()),
  );
  normalizeJob51FreshStart();
  let keyword = normalizeKeyword(params.get(AUTO_SEARCH_PARAM) || "");
  if (keyword && keywordMode !== KEYWORD_MODE_SPACED) {
    keyword = keyword.replace(/\s+/g, "");
  }
  if (!keyword) {
    setAutoSearchAttributes("skipped", "");
    return;
  }

  let input;
  let button;
  try {
    ({ input, button } = await waitForSearchElements());
  } catch (error) {
    console.warn("🎯 [Auto Search] Search controls not ready:", error);
    setAutoSearchAttributes("skipped", keyword);
    return;
  }

  let currentValue = normalizeKeyword(input.value || "");
  if (keywordMode !== KEYWORD_MODE_SPACED) {
    currentValue = currentValue.replace(/\s+/g, "");
  }
  const shouldForceJob51Search =
    getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
    currentValue === keyword &&
    !hasJob51SearchSnapshot() &&
    isJob51EmptySearchPromptVisible();
  if (currentValue === keyword && !shouldForceJob51Search) {
    setAutoSearchAttributes("skipped", keyword);
    return;
  }

  console.log(
    "🎯 [Auto Search] Searching for:",
    keyword,
    `(mode=${keywordMode})`,
  );
  setInputValue(input, keyword);
  button.click();
  setAutoSearchAttributes("done", keyword);

  try {
    const count = await waitForExtractionData({});
    console.log("🎯 [Auto Search] Done, found", count, "results");
  } catch (error) {
    console.warn(
      "🎯 [Auto Search] Search triggered, waiting for results timed out:",
      error,
    );
  }
}

async function runAutoExportIfEnabled() {
  if (autoExportTriggered) return;
  const config = getAutoExportConfig();
  if (!config.enabled) return;
  autoExportTriggered = true;

  try {
    await waitForExtractionData({});
    const resumes = extractResumes();
    if (config.logStructured) {
      console.log("🎯 [Auto Export] Extracted resumes", {
        count: resumes.length,
        resumes,
      });
    }

    try {
      document.documentElement.setAttribute("data-tr-auto-export", "done");
      document.documentElement.setAttribute(
        "data-tr-auto-export-count",
        String(resumes.length),
      );
    } catch {
      // ignore
    }

    let rawPayload = null;
    if (
      config.logRaw ||
      config.downloadRawJson ||
      config.downloadMarkdown ||
      config.rawIncludePage
    ) {
      rawPayload = extractResumesRaw({ includePage: config.rawIncludePage });
      if (config.logRaw) {
        console.log("🎯 [Auto Export] Raw resumes", rawPayload);
      }
      if (config.downloadRawJson) {
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `resumes_raw_${timestamp}_${makeRandomId()}.json`;
        await downloadFile(
          JSON.stringify(rawPayload, null, 2),
          filename,
          "application/json",
          config.saveAs,
        );
        console.log("🎯 [Auto Export] Raw JSON download triggered:", filename);
      }
      if (config.downloadMarkdown) {
        const markdown = rawToMarkdown(rawPayload);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `resumes_md_${timestamp}_${makeRandomId()}.md`;
        await downloadFile(markdown, filename, "text/markdown", config.saveAs);
        console.log("🎯 [Auto Export] Markdown download triggered:", filename);
      }
    }

    if (config.downloadCsv) {
      const csv = resumesToCSV(resumes);
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `resumes_${timestamp}_${makeRandomId()}.csv`;
      await downloadFile(csv, filename, "text/csv", config.saveAs);
      console.log("🎯 [Auto Export] CSV download triggered:", filename);
    }

    if (config.downloadJson) {
      const metadata = buildExportMetadata(resumes);
      const payload = { metadata, data: resumes };
      const json = JSON.stringify(payload, null, 2);
      const filename = buildExportFilename();
      await downloadFile(json, filename, "application/json", config.saveAs);
      console.log("🎯 [Auto Export] JSON download triggered:", filename);
    }
  } catch (error) {
    console.warn("🎯 [Auto Export] Failed:", error);
  }
}

async function syncCurrentPageToServer(resumesOverride) {
  let resumes = Array.isArray(resumesOverride)
    ? resumesOverride
    : extractResumes();
  const shouldEnrichFromCurrentPage = !Array.isArray(resumesOverride);
  if (
    shouldEnrichFromCurrentPage &&
    getCurrentSourceKey() === SOURCE_KEYS.JOB51 &&
    !isJob51DetailPage() &&
    resumes.length > 0
  ) {
    resumes = await enrich51JobSearchResumesWithDetail(resumes);
  }
  if (
    shouldEnrichFromCurrentPage &&
    getCurrentSourceKey() === SOURCE_KEYS.JOB5156 &&
    !isJob5156DetailPage() &&
    resumes.length > 0
  ) {
    resumes = await enrichJob5156SearchResumesWithDetail(resumes);
  }
  if (
    shouldEnrichFromCurrentPage &&
    getCurrentSourceKey() === SOURCE_KEYS.SEEK &&
    !isSeekProfileMode() &&
    resumes.length > 0
  ) {
    resumes = await enrichSeekRecommendedResumesWithDetail(resumes);
  }
  const metadata = buildSubmitMetadata({
    seekCaptureMode:
      Array.isArray(resumesOverride) &&
      window.location.pathname.includes("/candidates/recommended")
        ? "graphql-list"
        : undefined,
  });
  return chrome.runtime.sendMessage({
    action: "syncToServer",
    metadata,
    resumes,
  });
}

function queueJob51DetailBackfill(resumes, context = {}) {
  if (!Array.isArray(resumes) || resumes.length === 0) {
    return Promise.resolve(null);
  }

  const runId =
    typeof context.runId === "number" && Number.isFinite(context.runId)
      ? context.runId
      : null;
  const isCancelled = () =>
    runId !== null && runId !== job51DetailBackfillRunId;

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

    const response = await syncCurrentPageToServer(enrichedResumes);
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

  const scheduled = job51DetailBackfillChain.catch(() => null).then(task);
  job51DetailBackfillChain = scheduled.catch((error) => {
    console.warn("51job detail backfill failed:", error);
    return null;
  });
  return scheduled;
}

function resolveAutoSyncErrorStatus(errorLike) {
  const rawError =
    typeof errorLike === "string"
      ? errorLike
      : errorLike?.error || errorLike?.message || String(errorLike || "");
  const message = String(rawError).trim() || "Unknown error";
  const lowerMessage = message.toLowerCase();

  if (
    message.includes("搜索访问太快") ||
    message.includes("60分钟后再试") ||
    message === JOB51_RATE_LIMIT_ERROR_MESSAGE
  ) {
    return {
      message: "51job 已触发访问限制",
      hint: "扩展已停止自动翻页。至少等待60分钟后重试，并保持小页数、小批量。",
    };
  }

  if (message === "Server token not configured") {
    return {
      message: "Token 未配置",
      hint: "点击此提示打开扩展设置并填写 Token",
    };
  }

  if (message.includes("401") || lowerMessage.includes("unauthorized")) {
    return {
      message: "认证失败 - Token 无效或已过期",
      hint: "点击此提示打开扩展设置并更新 Token",
    };
  }

  if (message === "Server URL not configured") {
    return {
      message: "服务器地址未配置",
      hint: "点击此提示打开扩展设置并填写服务器地址",
    };
  }

  if (
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("networkerror") ||
    lowerMessage.includes("network error") ||
    lowerMessage.includes("err_network") ||
    lowerMessage.includes("load failed") ||
    lowerMessage.includes("connection")
  ) {
    return {
      message: "无法连接服务器",
      hint: "请检查网络连接和服务器状态后重试",
    };
  }

  return {
    message: `同步失败: ${message}`,
    hint: "点击此提示打开扩展设置排查问题",
  };
}

function resolveAutoSyncStopReason(errorLike) {
  const rawError =
    typeof errorLike === "string"
      ? errorLike
      : errorLike?.error || errorLike?.message || String(errorLike || "");
  const message = String(rawError).trim();
  if (
    message.includes("搜索访问太快") ||
    message.includes("60分钟后再试") ||
    message === JOB51_RATE_LIMIT_ERROR_MESSAGE
  ) {
    return "job51-rate-limited";
  }
  return "failed";
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

      await waitForExtractionData({});
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
        resumes = await enrichSeekRecommendedResumesWithDetail(resumes);
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

function getExtensionVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || SOURCE_KEYS.UNKNOWN;
  } catch {
    return SOURCE_KEYS.UNKNOWN;
  }
}

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

/**
 * @param {{
 *   limit?: number;
 *   maxPages?: number;
 *   allowEmpty?: boolean;
 * } | null | undefined} [options]
 */
function normalizeSnapshotCollectOptions(options = {}) {
  /** @type {{ limit?: number; maxPages?: number; allowEmpty?: boolean }} */
  const normalizedOptions =
    typeof options === "object" && options ? options : {};
  return {
    limit: normalizeCollectionLimit(normalizedOptions.limit),
    maxPages: normalizeCollectionLimit(normalizedOptions.maxPages),
    allowEmpty: !!normalizedOptions.allowEmpty,
  };
}

/**
 * @param {{
 *   limit?: number;
 *   maxPages?: number;
 *   allowEmpty?: boolean;
 * } | null | undefined} [options]
 */
async function collectSnapshotPayload(options = {}) {
  const { limit, maxPages, allowEmpty } =
    normalizeSnapshotCollectOptions(options);
  const sourceKey = getCurrentSourceKey();
  const job51BackfillRunId =
    sourceKey === SOURCE_KEYS.JOB51 ? job51DetailBackfillRunId + 1 : null;

  if (sourceKey === SOURCE_KEYS.JOB51) {
    job51DetailBackfillRunId = job51BackfillRunId;
    job51DetailBackfillChain = Promise.resolve();
  }

  if (
    sourceKey !== SOURCE_KEYS.JOB5156 &&
    sourceKey !== SOURCE_KEYS.JOB51 &&
    sourceKey !== SOURCE_KEYS.SEEK
  ) {
    throw new Error(`Unsupported source for snapshot collection: ${sourceKey}`);
  }

  let collectedResumes = [];
  let pagesVisited = 0;
  let stopReason = "completed";
  let seekStartPage = null;
  let lastPageResumeCount = 0;
  let finalPagination = getPaginationInfo();

  while (true) {
    const paginationBefore = getPaginationInfo();
    const currentPage = paginationBefore.currentPage;
    const isSeekListPage =
      sourceKey === SOURCE_KEYS.SEEK && !isSeekProfileMode();
    if (isSeekListPage && seekStartPage === null) {
      seekStartPage = currentPage;
    }

    await waitForExtractionData({});
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

    const pageSelection = isSeekListPage
      ? resolveSeekAutoSyncCurrentPageSelection({
          limit,
          totalSubmitted: collectedResumes.length,
          currentPageResumeCount: getSeekCurrentCandidateCount(),
        })
      : {
          remainingCapacity:
            limit > 0 ? Math.max(limit - collectedResumes.length, 0) : null,
          selectedCount: null,
          hitLimitWithinPage: false,
          limitAlreadyReached:
            limit > 0
              ? Math.max(limit - collectedResumes.length, 0) <= 0
              : false,
        };

    if (pageSelection.limitAlreadyReached) {
      stopReason = "limit-reached";
      break;
    }

    let pageResumes = extractResumes();
    const hitLimitWithinPage = isSeekListPage
      ? pageSelection.hitLimitWithinPage
      : limit > 0 &&
        typeof pageSelection.remainingCapacity === "number" &&
        pageResumes.length > pageSelection.remainingCapacity;
    if (isSeekListPage && typeof pageSelection.selectedCount === "number") {
      pageResumes = pageResumes.slice(0, pageSelection.selectedCount);
    } else if (
      limit > 0 &&
      typeof pageSelection.remainingCapacity === "number" &&
      pageResumes.length > pageSelection.remainingCapacity
    ) {
      pageResumes = pageResumes.slice(0, pageSelection.remainingCapacity);
    }

    if (
      sourceKey === SOURCE_KEYS.JOB51 &&
      !isJob51DetailPage() &&
      pageResumes.length > 0
    ) {
      void queueJob51DetailBackfill(pageResumes, {
        currentPage,
        totalPages: Math.max(currentPage, paginationBefore.totalPages || 0),
        runId: job51BackfillRunId,
      });
    }
    if (
      sourceKey === SOURCE_KEYS.JOB5156 &&
      !isJob5156DetailPage() &&
      pageResumes.length > 0
    ) {
      pageResumes = await enrichJob5156SearchResumesWithDetail(pageResumes);
    }
    if (
      sourceKey === SOURCE_KEYS.SEEK &&
      !isSeekProfileMode() &&
      pageResumes.length > 0
    ) {
      pageResumes = await enrichSeekRecommendedResumesWithDetail(pageResumes);
    }

    lastPageResumeCount = pageResumes.length;
    if (pageResumes.length > 0) {
      collectedResumes.push(...pageResumes);
    }

    finalPagination = getPaginationInfo();

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
    if (!isSeekListPage && limit > 0 && collectedResumes.length >= limit) {
      stopReason = "limit-reached";
      break;
    }
    if (!isSeekListPage && maxPages > 0 && pagesVisited >= maxPages) {
      stopReason = "max-pages-reached";
      break;
    }

    if (
      !finalPagination.hasNextPage ||
      finalPagination.currentPage >= finalPagination.totalPages
    ) {
      stopReason = "no-next-page";
      break;
    }

    try {
      await waitForPagination({ timeoutMs: 8000 });
    } catch {
      // Some layouts render pagination late or omit it on single-page results.
    }

    const nextPage = finalPagination.currentPage + 1;
    clearCapturedResultsForNextPage();
    const moved = goToNextPageInternal();
    if (!moved) {
      stopReason = "no-next-page";
      break;
    }

    await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (collectedResumes.length <= 0 && !allowEmpty) {
    throw new Error(
      "No resumes extracted. Ensure you are logged in and results are loaded.",
    );
  }

  const metadata = buildSubmitMetadata();
  metadata.generatedAt = new Date().toISOString();
  metadata.totalPages = pagesVisited;
  metadata.totalResumes = collectedResumes.length;

  return {
    metadata,
    resumes: collectedResumes,
    summary: {
      sourceKey,
      sourceHost: metadata.sourceHost,
      count: collectedResumes.length,
      pagesVisited,
      stopReason,
      lastPageResumeCount,
      limit: limit > 0 ? limit : null,
      maxPages: maxPages > 0 ? maxPages : null,
      pagination: finalPagination,
    },
  };
}

function getExternalAccessorStatus() {
  const version = getExtensionVersion();
  const pagination = getPaginationInfo();
  const ageRange = getCurrentAgeRange();
  const sourceKey = getCurrentSourceKey();
  const apiSnapshotCount = getApiSnapshotCount();
  const cardCount =
    sourceKey === SOURCE_KEYS.SEEK
      ? Math.max(apiSnapshotCount, getSeekCardCount())
      : sourceKey === SOURCE_KEYS.JOB51
        ? apiSnapshotCount
        : isJob5156DetailPage()
          ? isJob5156DetailReady()
            ? 1
            : 0
          : document.querySelectorAll(SELECTORS.resumeCard).length;
  const autoSearch =
    document.documentElement.getAttribute("data-tr-auto-search") || "";
  const autoLocation =
    document.documentElement.getAttribute("data-tr-auto-location") || "";
  const autoAge =
    document.documentElement.getAttribute("data-tr-auto-age") || "";
  const autoExport =
    document.documentElement.getAttribute("data-tr-auto-export") || "";
  const autoSync =
    document.documentElement.getAttribute("data-tr-auto-sync") || "";
  const autoSyncCountRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-count") || "";
  const autoSyncPagesRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-pages") || "";
  const autoSyncTargetStartRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-target-start") ||
    "";
  const autoSyncTargetEndRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-target-end") || "";
  const autoSyncEffectivePageSizeRaw =
    document.documentElement.getAttribute(
      "data-tr-auto-sync-effective-page-size",
    ) || "";
  const autoSyncSelectedCountRaw =
    document.documentElement.getAttribute("data-tr-auto-sync-selected-count") ||
    "";
  const autoSyncRemainingCapacityRaw =
    document.documentElement.getAttribute(
      "data-tr-auto-sync-remaining-capacity",
    ) || "";
  const autoSyncStopReason =
    document.documentElement.getAttribute("data-tr-auto-sync-stop-reason") ||
    "";
  const autoSyncCount = Number.parseInt(autoSyncCountRaw, 10);
  const autoSyncPages = Number.parseInt(autoSyncPagesRaw, 10);
  const autoSyncTargetStart = Number.parseInt(autoSyncTargetStartRaw, 10);
  const autoSyncTargetEnd = Number.parseInt(autoSyncTargetEndRaw, 10);
  const autoSyncEffectivePageSize = Number.parseInt(
    autoSyncEffectivePageSizeRaw,
    10,
  );
  const autoSyncSelectedCount = Number.parseInt(autoSyncSelectedCountRaw, 10);
  const autoSyncRemainingCapacity = Number.parseInt(
    autoSyncRemainingCapacityRaw,
    10,
  );

  return {
    extensionLoaded: true,
    extensionVersion: version,
    sourceKey,
    apiSnapshotCount,
    domReady: isExtractionReady(),
    loggedIn: isLoggedIn(),
    ageRange: ageRange.enabled
      ? {
          minAge: typeof ageRange.minAge === "number" ? ageRange.minAge : null,
          maxAge: typeof ageRange.maxAge === "number" ? ageRange.maxAge : null,
        }
      : null,
    cardCount,
    autoSearch,
    autoLocation,
    autoAge,
    autoExport,
    autoSync,
    autoSyncCount: Number.isFinite(autoSyncCount) ? autoSyncCount : 0,
    autoSyncPages: Number.isFinite(autoSyncPages) ? autoSyncPages : 0,
    autoSyncTargetPageStart: Number.isFinite(autoSyncTargetStart)
      ? autoSyncTargetStart
      : null,
    autoSyncTargetPageEnd: Number.isFinite(autoSyncTargetEnd)
      ? autoSyncTargetEnd
      : null,
    autoSyncEffectivePageSize: Number.isFinite(autoSyncEffectivePageSize)
      ? autoSyncEffectivePageSize
      : null,
    autoSyncSelectedCount: Number.isFinite(autoSyncSelectedCount)
      ? autoSyncSelectedCount
      : null,
    autoSyncRemainingCapacity: Number.isFinite(autoSyncRemainingCapacity)
      ? autoSyncRemainingCapacity
      : null,
    autoSyncStopReason: autoSyncStopReason || null,
    pagination,
    lastOperationName: apiSnapshot.lastOperationName,
    timestamp: new Date().toISOString(),
  };
}

function installExternalAccessor() {
  try {
    const version = getExtensionVersion();
    window[EXTERNAL_ACCESS_KEY] = {
      extract: () => extractResumes(),
      extractRaw: (options) => extractResumesRaw(options),
      collect: (options) => collectSnapshotPayload(options),
      getApiSnapshot: () => apiSnapshot,
      getPaginationInfo: () => getPaginationInfo(),
      isReady: () => isExtractionReady(),
      isLoggedIn: () => isLoggedIn(),
      status: () => getExternalAccessorStatus(),
      syncToServer: () => syncCurrentPageToServer(),
      version,
      goToNextPage: () => goToNextPageInternal(),
    };
  } catch (error) {
    console.warn("🎯 [External Access] Failed to install accessor:", error);
  }
}

// Inject indicator that extension is active
console.log("🎯 智通直聘 Resume Collector loaded");
installApiHook();
installReloadHelper();
installExternalAccessor();
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
