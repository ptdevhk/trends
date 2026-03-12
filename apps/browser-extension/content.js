/**
 * 智通直聘 Resume Collector - Content Script
 * Extracts resume data from hr.job5156.com/search page
 */

// CSS Selectors based on DOM analysis
const SELECTORS = {
  listContainer: '.el-checkbox-group.resume-search-item-list-content-block',
  resumeCard: '.list-content__li_part',
  name: '.item-title-part1 a.name, a.name',
  activityStatus: '.date-type-diff-text-block',
  basicInfoRow: '.basic-line',
  basicInfoItem: '.basic-line__text',
  locationItem: '.resume-search-item-search-addre__span',
  locationFallbackItem: '.text-truncate.text-center',
  selfIntro: '.basic-keywords',
  topRow: '.list-content__li__up-block',
  topRowText: '.up-block__look-text',
  workHistory: '.work-block',
  workItem: '.work-item, .school-item',
  pagination: '.el-pagination',
  nextPageBtn: '.el-pagination .btn-next',
  searchInput: '.el-autocomplete input.el-input__inner',
  searchButton: '.resume-search-item-search-input-block__input-button',
  // Area selector (location filter modal)
  areaTrigger: '.resume-search-item-search-addre',
  areaModal: '.area-selector-item-block',
  areaProvinceBlock: '.area-selector-item-block__content__down__blcok:first-child',
  areaCityBlock: '.area-selector-item-block__content__down__blcok:nth-child(2)',
  areaDistrictBlock: '.area-selector-item-block__content__down__blcok:nth-child(3)',
  areaItem: '.down__blcok__select',
  areaDistrictItem: '.down__block__big-select__block',
  areaConfirmBtn: '.area-selector-item-block__footer .button-block.blue',
  areaCancelBtn: '.area-selector-item-block__footer .button-block:not(.blue)',
  areaSelectedCount: '.content__up__number__select'
};

const AUTO_EXPORT_PARAM = 'tr_auto_export';
const AUTO_SYNC_PARAM = 'tr_auto_sync';
const AUTO_LIMIT_PARAM = 'tr_limit';
const AUTO_MAX_PAGES_PARAM = 'tr_max_pages';
const AUTO_MIN_AGE_PARAM = 'tr_min_age';
const AUTO_MAX_AGE_PARAM = 'tr_max_age';
const AUTO_SEARCH_PARAM = 'keyword';
const AUTO_LOCATION_PARAM = 'location';
const AUTO_KEYWORD_MODE_PARAM = 'tr_kw_mode';
const SAMPLE_NAME_PARAM = 'tr_sample_name';
const JOB5156_HOST = 'hr.job5156.com';
const SEEK_HOST_SUFFIX = '.employer.seek.com';
const JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`;
const SOURCE_KEYS = {
  JOB5156: 'job5156',
  SEEK: 'seek',
  UNKNOWN: 'unknown'
};
const SEEK_PROFILE_TYPE = 'seek';
const KEYWORD_MODE_CONCAT = 'concat';
const KEYWORD_MODE_SPACED = 'spaced';
let autoExportTriggered = false;
let autoSyncTriggered = false;
let autoSyncCancelled = false;
const API_CAPTURE_SOURCE = 'tr-resume-api';
const EXTERNAL_ACCESS_KEY = '__TR_RESUME_DATA__';
const PAGE_BRIDGE_REQUEST_EVENT = 'trResumeBridgeRequest';
const PAGE_BRIDGE_RESPONSE_EVENT = 'trResumeBridgeResponse';
const PAGE_BRIDGE_REQUEST_ATTR = 'data-tr-resume-bridge-request';
const PAGE_BRIDGE_RESPONSE_ATTR = 'data-tr-resume-bridge-response';

const apiSnapshot = {
  searchRows: null,
  attachInfo: null,
  chatInfo: null,
  insightInfo: null,
  seekRecommendedCandidates: null,
  seekProfile: null,
  seekRequest: null,
  lastUpdatedAt: null,
  lastSearchAt: null,
  lastUrl: null,
  lastSourceKey: null,
  lastOperationName: null
};

function sanitizeSampleName(value) {
  if (!value) return '';
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80);
}

/**
 * Normalize keyword for consistent handling
 * - Full-width space (U+3000) → half-width space (U+0020)
 * - Multiple spaces → single space
 * - Trim leading/trailing
 */
function normalizeKeyword(keyword) {
  if (!keyword) return '';
  return keyword
    .replace(/[\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeywordMode(mode) {
  return mode === KEYWORD_MODE_SPACED ? KEYWORD_MODE_SPACED : KEYWORD_MODE_CONCAT;
}

function normalizeCollectionLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeOptionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseAgeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withSuffix = trimmed.match(/(\d+)\s*岁/u);
  if (withSuffix && withSuffix[1]) {
    const parsed = Number.parseInt(withSuffix[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const plainNumber = trimmed.match(/^(\d{1,3})$/u);
  if (plainNumber && plainNumber[1]) {
    const parsed = Number.parseInt(plainNumber[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function getAgeRangeFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const minAge = normalizeOptionalPositiveInt(params.get(AUTO_MIN_AGE_PARAM));
  const maxAge = normalizeOptionalPositiveInt(params.get(AUTO_MAX_AGE_PARAM));
  const enabled = minAge !== null || maxAge !== null;
  return {
    enabled,
    minAge: minAge !== null ? minAge : undefined,
    maxAge: maxAge !== null ? maxAge : undefined,
  };
}

function filterResumesByAgeRange(resumes) {
  const range = getAgeRangeFromUrl();
  if (!range.enabled) return resumes;

  const minAge = range.minAge;
  const maxAge = range.maxAge;

  return resumes.filter((resume) => {
    const age = parseAgeNumber(resume?.age);
    if (age === null) return false;
    if (typeof minAge === 'number' && age < minAge) return false;
    if (typeof maxAge === 'number' && age > maxAge) return false;
    return true;
  });
}

const PROVINCE_TOKENS = new Set([
  '北京', '天津', '上海', '重庆',
  '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东',
  '河南', '湖北', '湖南', '广东', '海南',
  '四川', '贵州', '云南', '陕西', '甘肃', '青海',
  '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆',
  '香港', '澳门'
]);

function normalizeProvinceToken(value) {
  if (!value) return '';
  return value
    .trim()
    .replace(/特别行政区$/g, '')
    .replace(/壮族自治区$/g, '')
    .replace(/回族自治区$/g, '')
    .replace(/维吾尔自治区$/g, '')
    .replace(/自治区$/g, '')
    .replace(/省$/g, '')
    .replace(/市$/g, '');
}

function isProvinceToken(value) {
  const normalized = normalizeProvinceToken(value);
  return normalized ? PROVINCE_TOKENS.has(normalized) : false;
}

async function getKeywordMode() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ keywordMode: KEYWORD_MODE_CONCAT }, (items) => {
        resolve(normalizeKeywordMode(items?.keywordMode));
      });
    } catch (error) {
      console.warn('🎯 [Auto Search] Failed to read keyword mode from storage:', error);
      resolve(KEYWORD_MODE_CONCAT);
    }
  });
}

async function getCollectionLimits() {
  const params = new URLSearchParams(window.location.search || '');
  const hasLimitParam = params.has(AUTO_LIMIT_PARAM);
  const hasMaxPagesParam = params.has(AUTO_MAX_PAGES_PARAM);
  const paramLimit = normalizeCollectionLimit(params.get(AUTO_LIMIT_PARAM));
  const paramMaxPages = normalizeCollectionLimit(params.get(AUTO_MAX_PAGES_PARAM));

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ collectLimit: 0, maxPages: 0 }, (items) => {
        resolve({
          limit: hasLimitParam ? paramLimit : normalizeCollectionLimit(items?.collectLimit),
          maxPages: hasMaxPagesParam ? paramMaxPages : normalizeCollectionLimit(items?.maxPages)
        });
      });
    } catch (error) {
      console.warn('🎯 [Auto Sync] Failed to read collection limits from storage:', error);
      resolve({
        limit: hasLimitParam ? paramLimit : 0,
        maxPages: hasMaxPagesParam ? paramMaxPages : 0
      });
    }
  });
}

function buildExportFilename() {
  const params = new URLSearchParams(window.location.search || '');
  const rawSampleName = params.get(SAMPLE_NAME_PARAM) || '';
  const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, '');
  const timestamp = new Date().toISOString().slice(0, 10);

  if (sampleName) return `${sampleName}.json`;

  const rawKeyword = params.get(AUTO_SEARCH_PARAM) || '';
  const keyword = sanitizeSampleName(normalizeKeyword(rawKeyword));
  if (keyword) return `sample-${keyword}-${timestamp}.json`;

  return `resumes_${timestamp}_${makeRandomId()}.json`;
}

function buildExportMetadata(resumes) {
  const url = new URL(window.location.href);
  const keyword = normalizeKeyword(url.searchParams.get(AUTO_SEARCH_PARAM) || '');
  const location = (url.searchParams.get(AUTO_LOCATION_PARAM) || '').trim();
  const locationArray = location ? location.split(/[\s,]+/).filter(Boolean) : [];
  const rawSampleName = url.searchParams.get(SAMPLE_NAME_PARAM) || '';
  const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, '');

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

  let generatedBy = 'browser-extension';
  try {
    const version = chrome?.runtime?.getManifest?.().version;
    if (version) generatedBy = `browser-extension@${version}`;
  } catch {
    // ignore
  }

  const pagination = getPaginationInfo();
  const reproductionParams = new URLSearchParams();
  reproductionParams.set(AUTO_EXPORT_PARAM, 'json');
  if (sampleName) reproductionParams.set(SAMPLE_NAME_PARAM, sampleName);

  return {
    sourceUrl: url.toString(),
    searchCriteria: {
      keyword,
      location: locationArray.length > 0 ? locationArray : '',
      filters: Object.keys(filters).length ? filters : {}
    },
    generatedAt: new Date().toISOString(),
    generatedBy,
    totalPages: pagination.totalPages,
    totalResumes: resumes.length,
    reproduction: `Navigate to sourceUrl, then add ?${reproductionParams.toString()}`
  };
}

function getCurrentSourceKey() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === JOB5156_HOST) return SOURCE_KEYS.JOB5156;
  if (hostname.endsWith(SEEK_HOST_SUFFIX)) return SOURCE_KEYS.SEEK;
  return SOURCE_KEYS.UNKNOWN;
}

function getApiSnapshotCount() {
  if (Array.isArray(apiSnapshot.searchRows)) {
    return apiSnapshot.searchRows.length;
  }
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    return getSeekSnapshotCount();
  }
  return 0;
}

function isSeekProfilePage() {
  return window.location.pathname.includes('/talentsearch/profile/');
}

function hasSeekProfileSnapshot() {
  return !!(apiSnapshot.seekProfile && typeof apiSnapshot.seekProfile === 'object');
}

function hasSeekListSnapshot() {
  return Array.isArray(apiSnapshot.seekRecommendedCandidates);
}

function getSeekSnapshotCount() {
  if (isSeekProfilePage()) {
    return hasSeekProfileSnapshot() ? 1 : 0;
  }
  return hasSeekListSnapshot() ? apiSnapshot.seekRecommendedCandidates.length : 0;
}

function isSeekSnapshotReady() {
  return getSeekSnapshotCount() > 0;
}

function isExtractionReady() {
  return getCurrentSourceKey() === SOURCE_KEYS.SEEK
    ? isSeekSnapshotReady()
    : document.querySelector(SELECTORS.listContainer) !== null;
}

function getSeekCandidateIdentity(candidate) {
  const profileId = candidate?.profileId != null ? String(candidate.profileId) : '';
  return {
    profileId,
    profileType: typeof candidate?.profileType === 'string' ? candidate.profileType : SEEK_PROFILE_TYPE
  };
}

function buildSeekProfileUrl(profileId) {
  return profileId ? `https://${window.location.hostname.toLowerCase()}/candidates/${encodeURIComponent(profileId)}` : '';
}

function formatSeekExpectedSalary(expectedSalary) {
  if (!expectedSalary || typeof expectedSalary !== 'object') return '';

  const amounts = Array.isArray(expectedSalary.amount) ? expectedSalary.amount : [];
  const preferredFrequencies = ['MONTHLY', 'ANNUAL', 'HOURLY'];
  const amount = preferredFrequencies
    .map((frequency) => amounts.find((entry) => entry?.frequency === frequency))
    .find(Boolean) || amounts[0];

  if (!amount || typeof amount !== 'object') return '';

  const value = typeof amount.value === 'number' ? amount.value : Number(amount.value);
  const formattedValue = Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
    : '';
  const currency = typeof expectedSalary.currency === 'string' ? expectedSalary.currency.trim() : '';
  const period = amount.frequency === 'ANNUAL'
    ? '/year'
    : amount.frequency === 'HOURLY'
      ? '/hour'
      : amount.frequency === 'DAILY'
        ? '/day'
        : '/month';

  const prefix = [currency, formattedValue].filter(Boolean).join(' ');
  return prefix ? `${prefix}${period}` : '';
}

function buildSeekWorkHistoryItem(item) {
  if (!item || typeof item !== 'object') return null;

  const companyName = typeof item.companyName === 'string' ? item.companyName.trim() : '';
  const jobTitle = typeof item.jobTitle === 'string' ? item.jobTitle.trim() : '';
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  const startDate = typeof item.startDate === 'string' ? item.startDate.trim() : '';
  const endDate = typeof item.endDate === 'string' ? item.endDate.trim() : '';
  const durationLabel = typeof item.durationLabel === 'string' ? item.durationLabel.trim() : '';
  const raw = [jobTitle, companyName, durationLabel].filter(Boolean).join(' · ');

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
  if (!item || typeof item !== 'object') return null;

  const institution = typeof item.institutionName === 'string' ? item.institutionName.trim() : '';
  const qualification = typeof item.qualificationName === 'string' ? item.qualificationName.trim() : '';
  const completionYear = Number.isFinite(item.completionYear) ? String(item.completionYear) : '';
  const completionMonth = Number.isFinite(item.completionMonth) && item.completionMonth > 0
    ? String(item.completionMonth).padStart(2, '0')
    : '';
  const endDate = completionYear
    ? (completionMonth ? `${completionYear}-${completionMonth}` : completionYear)
    : '';

  if (!institution && !qualification && !endDate) return null;

  return {
    institution: institution || undefined,
    qualification: qualification || undefined,
    endDate: endDate || undefined,
  };
}

function extractSeekProfileResume() {
  const profile = apiSnapshot.seekProfile;
  if (!profile || typeof profile !== 'object') return [];

  const requestInput = apiSnapshot.seekRequest?.variables?.input;
  const language = apiSnapshot.seekRequest?.variables?.language;
  const { profileId, profileType } = getSeekCandidateIdentity(profile);
  const firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
  const lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
  const currentJobTitle = typeof profile.currentJobTitle === 'string' ? profile.currentJobTitle.trim() : '';
  const currentLocation = typeof profile.currentLocation === 'string' ? profile.currentLocation.trim() : '';
  const lastModifiedDate = typeof profile.lastModifiedDate === 'string' ? profile.lastModifiedDate : '';
  const workHistory = Array.isArray(profile.workHistories)
    ? profile.workHistories.map((item) => buildSeekWorkHistoryItem(item)).filter(Boolean)
    : [];
  const profileEducation = Array.isArray(profile.profileEducation)
    ? profile.profileEducation.map((item) => buildSeekProfileEducationItem(item)).filter(Boolean)
    : [];
  const licences = Array.isArray(profile.licences)
    ? profile.licences
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const name = typeof item.name === 'string' ? item.name.trim() : '';
          const authority = typeof item.issuingOrganisationName === 'string' ? item.issuingOrganisationName.trim() : '';
          if (!name && !authority) return null;
          return {
            name,
            authority: authority || undefined,
          };
        })
        .filter(Boolean)
    : [];
  const skills = Array.isArray(profile.skills)
    ? profile.skills.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const languages = Array.isArray(profile.languages)
    ? profile.languages.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const resumeSnippet = typeof profile.resumeSnippet === 'string' ? profile.resumeSnippet.trim() : '';
  const currentIndustry = typeof profile.currentIndustry === 'string' ? profile.currentIndustry.trim() : '';
  const currentSubindustry = typeof profile.currentSubindustry === 'string' ? profile.currentSubindustry.trim() : '';
  const rightToWork = typeof profile.rightToWork?.label === 'string' ? profile.rightToWork.label.trim() : '';
  const education = profileEducation[0]?.qualification || '';
  const pageNumber = normalizeOptionalPositiveInt(new URL(window.location.href).searchParams.get('pageNumber')) || 1;

  return [{
    profileId,
    profileType,
    externalId: profileId ? `${window.location.hostname.toLowerCase()}:profile:${profileId}` : '',
    name: [firstName, lastName].filter(Boolean).join(' ').trim(),
    profileUrl: buildSeekProfileUrl(profileId),
    activityStatus: lastModifiedDate,
    age: '',
    experience: '',
    education,
    location: currentLocation,
    jobIntention: currentJobTitle,
    expectedSalary: formatSeekExpectedSalary(profile.salary?.expected),
    selfIntro: resumeSnippet,
    workHistory,
    profileEducation: profileEducation.length > 0 ? profileEducation : undefined,
    skills: skills.length > 0 ? skills : undefined,
    languages: languages.length > 0 ? languages : undefined,
    licences: licences.length > 0 ? licences : undefined,
    resumeSnippet: resumeSnippet || undefined,
    currentIndustry: currentIndustry || undefined,
    currentSubindustry: currentSubindustry || undefined,
    rightToWork: rightToWork || undefined,
    noticePeriodDays: Number.isFinite(profile.noticePeriodDays) ? profile.noticePeriodDays : undefined,
    extractedAt: new Date().toISOString(),
    pageIndex: 1,
    source: window.location.hostname.toLowerCase(),
    searchProfileId: typeof requestInput?.searchId === 'string' ? requestInput.searchId : '',
    language: typeof language === 'string' ? language : '',
    pageNumber,
  }];
}

function buildSeekCollectionContext() {
  const requestInput = apiSnapshot.seekRequest?.variables?.input;
  const language = apiSnapshot.seekRequest?.variables?.language;
  const url = new URL(window.location.href);
  const pageNumberFromUrl = normalizeOptionalPositiveInt(url.searchParams.get('pageNumber'));
  const jobIdFromUrl = normalizeOptionalPositiveInt(url.searchParams.get('jobId'));
  const captureMode = isSeekProfilePage() && apiSnapshot.seekProfile ? 'graphql-profile' : 'graphql-list';
  const defaultOperation = captureMode === 'graphql-profile'
    ? 'GetTalentSearchProfileCompleteV2'
    : 'GetTalentSearchRecommendedCandidates';

  return {
    captureMode,
    operation: apiSnapshot.lastOperationName || defaultOperation,
    jobId: requestInput?.jobId != null
      ? String(requestInput.jobId)
      : jobIdFromUrl != null
        ? String(jobIdFromUrl)
        : undefined,
    searchId: typeof requestInput?.searchId === 'string' ? requestInput.searchId : undefined,
    pageNumber: typeof requestInput?.page === 'number' ? requestInput.page : pageNumberFromUrl ?? undefined,
    language: typeof language === 'string' ? language : undefined,
    profileType: SEEK_PROFILE_TYPE,
  };
}

function buildSubmitMetadata() {
  const url = new URL(window.location.href);
  const sourceKey = getCurrentSourceKey();
  const keyword = normalizeKeyword(url.searchParams.get(AUTO_SEARCH_PARAM) || '');
  const locationRaw = (url.searchParams.get(AUTO_LOCATION_PARAM) || '').trim();
  const location = locationRaw ? locationRaw.split(/[\s,]+/).filter(Boolean).join(',') : '';

  url.searchParams.delete(AUTO_EXPORT_PARAM);
  url.searchParams.delete(AUTO_SYNC_PARAM);
  url.searchParams.delete(AUTO_LIMIT_PARAM);
  url.searchParams.delete(AUTO_MAX_PAGES_PARAM);
  url.searchParams.delete(SAMPLE_NAME_PARAM);

  let generatedBy = 'browser-extension';
  try {
    const version = chrome?.runtime?.getManifest?.().version;
    if (version) generatedBy = `browser-extension@${version}`;
  } catch {
    // ignore
  }

  const metadata = {
    sourceKey,
    sourceHost: url.hostname.toLowerCase(),
    sourceUrl: url.toString(),
    generatedBy,
  };

  if (keyword) metadata.keyword = keyword;
  if (location) metadata.location = location;
  if (sourceKey === SOURCE_KEYS.SEEK) {
    metadata.collectionContext = buildSeekCollectionContext();
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
    normalized === '' ||
    normalized === '#' ||
    normalized.startsWith('javascript:') ||
    normalized === 'about:blank'
  );
}

function toAbsoluteHttpUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (isPlaceholderProfileUrl(url.href)) return '';
    return url.href;
  } catch {
    return '';
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
  if (!pathname || typeof pathname !== 'string') return '';

  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
  if (oldRouteMatch && oldRouteMatch[1]) {
    return decodeURIComponentSafe(oldRouteMatch[1]);
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
  if (viewRouteMatch && viewRouteMatch[1]) {
    return decodeURIComponentSafe(viewRouteMatch[1]);
  }

  return '';
}

function normalizeJob5156ProfileUrlForExport(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

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
  if (!apiRow || typeof apiRow !== 'object') return '';
  const resumeId = apiRow.resumeId;
  if (resumeId === null || resumeId === undefined || resumeId === '') return '';
  const encodedId = encodeURIComponent(String(resumeId));
  return `${JOB5156_PROFILE_URL_PREFIX}${encodedId}`;
}

function getSeekPayloadData(payload, kind) {
  if (!payload) return null;

  if (Array.isArray(payload)) {
    const entry = payload.find((item) => {
      const data = item?.data;
      if (!data || typeof data !== 'object') return false;
      if (kind === 'seekRecommendedCandidates') {
        return !!(data.talentSearchRecommendedCandidatesV2 || data.getTalentSearchRecommendedCandidates);
      }
      if (kind === 'seekProfile') {
        return !!(data.talentSearchProfileV2 || data.talentSearchProfileCompleteV2 || data.getTalentSearchProfileCompleteV2);
      }
      return false;
    });
    return entry?.data || null;
  }

  if (payload && typeof payload === 'object') {
    return payload.data && typeof payload.data === 'object' ? payload.data : payload;
  }

  return null;
}

function extractProfileUrl(card, apiRow) {
  const nameLink = card.querySelector(SELECTORS.name);
  if (!nameLink) return buildProfileUrlFromApiRow(apiRow);

  const candidates = [
    nameLink.getAttribute('href'),
    nameLink.getAttribute('data-href'),
    nameLink.getAttribute('data-url'),
    nameLink.getAttribute('data-link'),
    nameLink.href,
  ];

  for (const candidate of candidates) {
    const normalized = toAbsoluteHttpUrl(candidate);
    if (normalized) return normalizeJob5156ProfileUrlForExport(normalized);
  }

  return buildProfileUrlFromApiRow(apiRow);
}

function updateApiSnapshot(message) {
  const { kind, payload, url, sourceKey, operationName, request } = message;
  apiSnapshot.lastUpdatedAt = new Date().toISOString();
  if (url) apiSnapshot.lastUrl = url;
  apiSnapshot.lastSourceKey = sourceKey || null;
  apiSnapshot.lastOperationName = operationName || null;

  try {
    document.documentElement.setAttribute('data-tr-api-last', kind);
    document.documentElement.setAttribute('data-tr-api-updated', apiSnapshot.lastUpdatedAt);
    if (sourceKey) {
      document.documentElement.setAttribute('data-tr-source-key', sourceKey);
    }
  } catch {
    // ignore
  }

  if (kind === 'search') {
    const rows = payload?.data?.resumePage?.rows;
    if (Array.isArray(rows)) {
      apiSnapshot.searchRows = rows;
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute('data-tr-api-rows', String(getApiSnapshotCount()));
      } catch {
        // ignore
      }
    }
    return;
  }
  if (kind === 'attach') {
    apiSnapshot.attachInfo = payload?.data?.attachResumeInfo || null;
    return;
  }
  if (kind === 'chat') {
    apiSnapshot.chatInfo = payload?.data?.chatInfo || null;
    return;
  }
  if (kind === 'insight') {
    apiSnapshot.insightInfo = payload?.data?.talentInsightInfo || payload?.data || null;
    return;
  }
  if (kind === 'seekRecommendedCandidates') {
    const data = getSeekPayloadData(payload, kind);
    const candidates = data?.talentSearchRecommendedCandidatesV2?.items
      || data?.getTalentSearchRecommendedCandidates?.candidates;
    if (Array.isArray(candidates)) {
      apiSnapshot.seekRecommendedCandidates = candidates;
      apiSnapshot.seekProfile = null;
      apiSnapshot.seekRequest = request || null;
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute('data-tr-api-rows', String(getApiSnapshotCount()));
      } catch {
        // ignore
      }
    }
    return;
  }
  if (kind === 'seekProfile') {
    const data = getSeekPayloadData(payload, kind);
    apiSnapshot.seekProfile = data?.talentSearchProfileV2
      || data?.talentSearchProfileCompleteV2
      || data?.getTalentSearchProfileCompleteV2
      || data
      || null;
    apiSnapshot.seekRecommendedCandidates = null;
    apiSnapshot.seekRequest = request || apiSnapshot.seekRequest || null;
    try {
      document.documentElement.setAttribute('data-tr-api-rows', String(getApiSnapshotCount()));
    } catch {
      // ignore
    }
    return;
  }
}

function installApiHook() {
  try {
    if (document.documentElement.hasAttribute('data-tr-resume-hook')) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.async = true;
    script.setAttribute('data-tr-resume-hook', 'true');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    document.documentElement.setAttribute('data-tr-resume-hook', 'true');
  } catch (error) {
    console.warn('Failed to install API hook:', error);
  }
}

function installReloadHelper() {
  try {
    if (globalThis.trReloadExtension) return;
    globalThis.trReloadExtension = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'reloadExtension' });
        console.log('🎯 [DEV] Reload requested', response);
      } catch (error) {
        console.warn('🎯 [DEV] Reload failed:', error);
      }
    };
    console.log('🎯 [DEV] Use trReloadExtension() in the DevTools "Content scripts" context to reload the extension');
  } catch (error) {
    console.warn('🎯 [DEV] Failed to install reload helper:', error);
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== API_CAPTURE_SOURCE) return;
  updateApiSnapshot(msg);
});

window.addEventListener(PAGE_BRIDGE_REQUEST_EVENT, async () => {
  const requestPayload = document.documentElement.getAttribute(PAGE_BRIDGE_REQUEST_ATTR);
  if (!requestPayload) return;

  let response = {
    id: null,
    ok: false,
    error: 'Invalid bridge request',
    value: undefined
  };

  try {
    const request = JSON.parse(requestPayload);
    const requestId = request?.id ?? null;
    const method = typeof request?.method === 'string' ? request.method : '';
    const args = Array.isArray(request?.args) ? request.args : [];

    response.id = requestId;

    switch (method) {
      case 'extract':
        response = { id: requestId, ok: true, error: '', value: extractResumes() };
        break;
      case 'extractRaw':
        response = { id: requestId, ok: true, error: '', value: extractResumesRaw(args[0]) };
        break;
      case 'getApiSnapshot':
        response = { id: requestId, ok: true, error: '', value: apiSnapshot };
        break;
      case 'getPaginationInfo':
        response = { id: requestId, ok: true, error: '', value: getPaginationInfo() };
        break;
      case 'isReady':
        response = { id: requestId, ok: true, error: '', value: isExtractionReady() };
        break;
      case 'isLoggedIn':
        response = { id: requestId, ok: true, error: '', value: isLoggedIn() };
        break;
      case 'status':
        response = { id: requestId, ok: true, error: '', value: window[EXTERNAL_ACCESS_KEY]?.status?.() };
        break;
      case 'syncToServer':
        response = { id: requestId, ok: true, error: '', value: await syncCurrentPageToServer(args[0]) };
        break;
      case 'goToNextPage':
        response = { id: requestId, ok: true, error: '', value: goToNextPageInternal() };
        break;
      default:
        response = {
          id: requestId,
          ok: false,
          error: method ? `Unsupported bridge method: ${method}` : 'Missing bridge method',
          value: undefined
        };
        break;
    }
  } catch (error) {
    response = {
      ...response,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  document.documentElement.setAttribute(PAGE_BRIDGE_RESPONSE_ATTR, JSON.stringify(response));
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
    return el ? el.textContent.trim() : '';
  };

  const pickText = (selectors) => {
    for (const selector of selectors) {
      const text = getText(selector);
      if (text) return text;
    }
    return '';
  };

  // Extract basic info (age, experience, education, location)
  const basicInfoContainer = card.querySelector(SELECTORS.basicInfoRow)
    || card.querySelector('.list-content__li__down-left-center');
  const locationFromCard = getText(SELECTORS.locationItem, basicInfoContainer || card)
    || getText(SELECTORS.locationFallbackItem, basicInfoContainer || card);
  const basicInfoSpans = basicInfoContainer
    ? basicInfoContainer.querySelectorAll(
      `${SELECTORS.basicInfoItem}, div:nth-child(2) span, .basic-line span`
    )
    : [];

  const basicInfo = Array.from(basicInfoSpans)
    .map((span) => span.textContent.trim())
    .filter(Boolean);

  let age = '';
  let experience = '';
  let education = '';
  let location = '';
  if (basicInfo.length >= 4) {
    [age, experience, education, location] = basicInfo;
  } else {
    basicInfo.forEach((item) => {
      if (item.includes('岁')) age = item;
      else if (item.includes('年') && !item.includes('元')) experience = item;
      else if (/(中专|高中|大专|本科|硕|博|研究生|MBA|EMBA)/.test(item)) education = item;
      else if (!item.includes('元')) location = item;
    });
  }
  if (locationFromCard) location = locationFromCard;

  // Extract top row (job intention, salary)
  const topRow = card.querySelector(SELECTORS.topRowText) || card.querySelector(SELECTORS.topRow);
  const topRowText = topRow ? topRow.textContent.trim().replace(/\s+/g, ' ') : '';
  const topRowClean = topRowText
    .split('人才洞察')[0]
    .replace(/·\s*$/, '')
    .trim();

  let expectedSalary = '';
  const salaryMatch = topRowClean.match(/(\d[\d-]*\s*元\/月|\d[\d-]*\s*元|面议)/);
  if (salaryMatch) expectedSalary = salaryMatch[0].replace(/\s+/g, '');

  let jobIntention = topRowClean.replace(/^求职意向[:：]?\s*/, '');
  jobIntention = jobIntention.replace(/（通勤距离[^）]*）/g, '').trim();
  if (expectedSalary) {
    jobIntention = jobIntention.replace(expectedSalary, '').replace(/[·\s]+$/g, '').trim();
  }

  const selfIntro = pickText([SELECTORS.selfIntro, '.basic-keywords', '.basic-keywords span']);

  // Extract work history
  const workHistoryContainer = card.querySelector(SELECTORS.workHistory)
    || card.querySelector('.list-content__li__down-right-center');
  let workItems = [];
  if (workHistoryContainer) {
    const primary = workHistoryContainer.querySelectorAll(SELECTORS.workItem);
    if (primary.length > 0) {
      workItems = Array.from(primary);
    } else {
      workItems = Array.from(workHistoryContainer.querySelectorAll('div[class*="history"]'));
    }
  }

  const seen = new Set();
  const workHistory = workItems
    .map((item) => item.textContent.trim())
    .filter((text) => text && text.length > 5)
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .map((text) => ({ raw: text }));

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
    extractedAt: new Date().toISOString(),
    source: JOB5156_HOST,
  };
}

/**
 * Extract all resumes from current page
 * @returns {Array} - Array of resume objects
 */
function extractSeekResumes() {
  const candidates = Array.isArray(apiSnapshot.seekRecommendedCandidates) ? apiSnapshot.seekRecommendedCandidates : [];
  const requestInput = apiSnapshot.seekRequest?.variables?.input;
  const language = apiSnapshot.seekRequest?.variables?.language;
  const currentPage = typeof requestInput?.page === 'number'
    ? requestInput.page
    : normalizeOptionalPositiveInt(new URL(window.location.href).searchParams.get('pageNumber')) || 1;

  return candidates.map((candidate, index) => {
    const { profileId, profileType } = getSeekCandidateIdentity(candidate);
    const firstName = typeof candidate?.firstName === 'string' ? candidate.firstName.trim() : '';
    const lastName = typeof candidate?.lastName === 'string' ? candidate.lastName.trim() : '';
    const currentJobTitle = typeof candidate?.currentJobTitle === 'string' ? candidate.currentJobTitle.trim() : '';
    const currentLocation = typeof candidate?.currentLocation === 'string' ? candidate.currentLocation.trim() : '';
    const lastModifiedDate = typeof candidate?.lastModifiedDate === 'string' ? candidate.lastModifiedDate : '';
    const salary = candidate?.salary;
    const salaryParts = [salary?.minLabel, salary?.maxLabel].filter((value) => typeof value === 'string' && value.trim());
    const workHistory = Array.isArray(candidate?.workHistories)
      ? candidate.workHistories
          .map((item) => {
            const title = typeof item?.jobTitle === 'string' ? item.jobTitle.trim() : '';
            const company = typeof item?.companyName === 'string' ? item.companyName.trim() : '';
            const raw = [title, company].filter(Boolean).join(' · ');
            return raw ? { raw } : null;
          })
          .filter(Boolean)
      : [];

    return {
      profileId,
      profileType,
      externalId: profileId ? `${window.location.hostname.toLowerCase()}:profile:${profileId}` : '',
      name: [firstName, lastName].filter(Boolean).join(' ').trim(),
      profileUrl: profileId ? `https://${window.location.hostname.toLowerCase()}/candidates/${encodeURIComponent(profileId)}` : '',
      activityStatus: lastModifiedDate,
      age: '',
      experience: '',
      education: '',
      location: currentLocation,
      jobIntention: currentJobTitle,
      expectedSalary: salaryParts.join(' - '),
      selfIntro: '',
      workHistory,
      extractedAt: new Date().toISOString(),
      pageIndex: index + 1,
      source: window.location.hostname.toLowerCase(),
      searchProfileId: typeof requestInput?.searchId === 'string' ? requestInput.searchId : '',
      language: typeof language === 'string' ? language : '',
      pageNumber: currentPage,
    };
  });
}

function extractResumes() {
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    if (isSeekProfilePage()) {
      if (hasSeekProfileSnapshot()) {
        return extractSeekProfileResume();
      }
      return [];
    }
    if (hasSeekListSnapshot()) {
      return extractSeekResumes();
    }
  }

  const cards = document.querySelectorAll(SELECTORS.resumeCard);
  const resumes = [];

  cards.forEach((card, index) => {
    try {
      const apiRow = getApiRowForIndex(index);
      const resume = extractSingleResume(card, apiRow);
      resume.pageIndex = index + 1;
      if (apiRow) {
        resume.resumeId = apiRow.resumeId ?? '';
        resume.perUserId = apiRow.perUserId ?? '';
      }
      resumes.push(resume);
    } catch (error) {
      console.error(`Error extracting resume ${index}:`, error);
    }
  });

  return filterResumesByAgeRange(resumes);
}

/**
 * Extract raw HTML/text from resume cards (no predefined schema).
 * @param {Object} [options]
 * @param {boolean} [options.includePage=false] - Include full page HTML
 * @returns {Object} - Raw payload
 */
function extractResumesRaw(options = {}) {
  const includePage = !!(options && typeof options === 'object' && options.includePage);

  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    const seekProfile = isSeekProfilePage() && hasSeekProfileSnapshot() ? apiSnapshot.seekProfile : null;
    const seekProfileIdentity = seekProfile ? getSeekCandidateIdentity(seekProfile) : null;
    const candidates = !seekProfile && hasSeekListSnapshot() ? apiSnapshot.seekRecommendedCandidates : [];
    const cards = seekProfile
      ? [{
          index: 1,
          profileId: seekProfileIdentity?.profileId || '',
          profileType: seekProfileIdentity?.profileType || SEEK_PROFILE_TYPE,
          text: JSON.stringify(seekProfile, null, 2),
        }]
      : candidates.map((candidate, index) => {
          const { profileId, profileType } = getSeekCandidateIdentity(candidate);
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
          request: apiSnapshot.seekRequest,
        }
      };

      if (includePage) {
        payload.pageHtml = document.documentElement.outerHTML;
      }

      return payload;
    }
  }

  const cards = document.querySelectorAll(SELECTORS.resumeCard);
  const items = Array.from(cards).map((card, index) => {
    const el = /** @type {HTMLElement} */ (card);
    return {
      index: index + 1,
      resumeId: getApiRowForIndex(index)?.resumeId ?? '',
      perUserId: getApiRowForIndex(index)?.perUserId ?? '',
      html: el.outerHTML,
      text: el.innerText
    };
  });

  const payload = {
    url: window.location.href,
    extractedAt: new Date().toISOString(),
    count: items.length,
    cards: items,
    api: {
      lastSearchAt: apiSnapshot.lastSearchAt,
      lastUpdatedAt: apiSnapshot.lastUpdatedAt,
      searchRowCount: Array.isArray(apiSnapshot.searchRows) ? apiSnapshot.searchRows.length : 0
    }
  };

  if (includePage) {
    payload.pageHtml = document.documentElement.outerHTML;
  }

  return payload;
}

function normalizeCardText(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function rawToMarkdown(rawPayload) {
  const lines = [];
  lines.push('# Resume Dump (Raw)');
  lines.push('');
  lines.push(`- URL: ${rawPayload.url}`);
  lines.push(`- Extracted: ${rawPayload.extractedAt}`);
  lines.push(`- Count: ${rawPayload.count}`);
  lines.push('');

  rawPayload.cards.forEach((card, idx) => {
    const indexLabel = String(idx + 1).padStart(2, '0');
    lines.push(`## Card ${indexLabel}`);
    if (card.resumeId || card.perUserId) {
      lines.push(`- resumeId: ${card.resumeId || ''}`);
      lines.push(`- perUserId: ${card.perUserId || ''}`);
      lines.push('');
    }
    lines.push('```text');
    const normalized = normalizeCardText(card.text);
    lines.push(normalized || '(empty)');
    lines.push('```');
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Convert resumes to CSV format
 * @param {Array} resumes - Array of resume objects
 * @returns {string} - CSV string
 */
function resumesToCSV(resumes) {
  if (resumes.length === 0) return '';

  const headers = ['序号', 'resumeId', 'perUserId', '姓名', '年龄', '工作经验', '学历', '所在地', '自我评价', '期望薪资', '活跃状态', '求职意向', '简历链接', '提取时间'];
  const rows = resumes.map((r, i) => [
    i + 1,
    r.resumeId || '',
    r.perUserId || '',
    r.name,
    r.age,
    r.experience,
    r.education,
    r.location,
    r.selfIntro,
    r.expectedSalary,
    r.activityStatus,
    r.jobIntention?.replace(/,/g, ';').substring(0, 100),
    r.profileUrl,
    r.extractedAt
  ].map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','));

  return [headers.join(','), ...rows].join('\n');
}

function makeRandomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().split('-')[0];
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
    action: 'downloadFile',
    content: content,
    filename: filename,
    mimeType: mimeType,
    saveAs: !!saveAs,
  });
  if (response?.success) return response;
  throw new Error(response?.error || 'Download failed');
}

/**
 * Get pagination info
 * @returns {Object} - Current page, total pages, total items
 */
function getSeekCardCount() {
  return document.querySelectorAll('a[href*="/talentsearch/profile/"][href*="profilePosition="]').length;
}

function getSeekPaginationInfo() {
  const currentPage = normalizeOptionalPositiveInt(new URL(window.location.href).searchParams.get('pageNumber')) || 1;
  const pagination = document.querySelector('nav[aria-label="Pagination of results"]');
  if (!pagination) {
    return { currentPage, totalPages: currentPage, totalItems: 0, hasNextPage: false };
  }

  const links = Array.from(pagination.querySelectorAll('a'));
  const pageNumbers = links
    .map((item) => {
      const label = item.getAttribute('aria-label') || '';
      const text = item.textContent || '';
      const match = label.match(/page\s+(\d+)/i) || text.trim().match(/^(\d+)$/);
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  const hasNextPage = links.some((item) => /next/i.test((item.textContent || '').trim()));
  const totalPages = Math.max(pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0, currentPage);

  return { currentPage, totalPages, totalItems: 0, hasNextPage };
}

function getPaginationInfo() {
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    return getSeekPaginationInfo();
  }

  const pagination = document.querySelector(SELECTORS.pagination);
  if (!pagination) return { currentPage: 1, totalPages: 1, totalItems: 0, hasNextPage: false };

  const totalText = pagination.textContent || '';
  const totalMatch = totalText.match(/共\s*([\d,，]+)\s*条/);
  const totalItems = totalMatch
    ? Number.parseInt(String(totalMatch[1]).replace(/[，,]/g, ''), 10) || 0
    : 0;

  const activePage = pagination.querySelector('.is-active, .active, .el-pager li.active');
  const currentPage = activePage
    ? Number.parseInt(activePage.textContent || '', 10) || 1
    : 1;

  const pagerItems = Array.from(pagination.querySelectorAll('.el-pager li'));
  const pageNumbers = pagerItems
    .map((item) => Number.parseInt(item.textContent || '', 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const totalPagesFromPager = pageNumbers.length > 0 ? Math.max(...pageNumbers) : 0;
  const totalPagesFromTotal = totalItems > 0 ? Math.ceil(totalItems / 20) : 0;
  const totalPages = Math.max(totalPagesFromTotal, totalPagesFromPager, currentPage);

  return { currentPage, totalPages, totalItems, hasNextPage: totalPages > currentPage };
}

function goToNextPageInternal() {
  const nextBtn = /** @type {HTMLElement | null} */ (document.querySelector(SELECTORS.nextPageBtn));
  if (!nextBtn) return false;
  if (
    nextBtn.hasAttribute('disabled')
    || nextBtn.classList.contains('is-disabled')
    || nextBtn.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }
  nextBtn.click();
  return true;
}

function getNextPageButtonState() {
  const nextBtn = document.querySelector(SELECTORS.nextPageBtn);
  if (!nextBtn) {
    return {
      exists: false
    };
  }
  return {
    exists: true,
    className: nextBtn.className || '',
    disabledAttr: nextBtn.getAttribute('disabled') || '',
    ariaDisabled: nextBtn.getAttribute('aria-disabled') || '',
    isDisabledClass: nextBtn.classList.contains('disabled'),
    isIsDisabledClass: nextBtn.classList.contains('is-disabled')
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
    rawIncludePage: false
  };

  if (mode === '1' || mode === 'true') {
    config.downloadMarkdown = true;
    return config;
  }
  if (mode === 'console' || mode === 'log') {
    config.logStructured = true;
    return config;
  }
  if (mode === 'csv') {
    config.downloadCsv = true;
    return config;
  }
  if (mode === 'json') {
    config.downloadJson = true;
    return config;
  }
  if (mode === 'both' || mode === 'all') {
    config.downloadCsv = true;
    config.downloadJson = mode === 'all';
    config.logStructured = true;
    return config;
  }
  if (mode === 'raw') {
    config.logRaw = true;
    return config;
  }
  if (mode === 'raw_json' || mode === 'rawjson') {
    config.downloadRawJson = true;
    return config;
  }
  if (mode === 'md' || mode === 'markdown') {
    config.downloadMarkdown = true;
    return config;
  }

  const tokens = mode
    .split(/[,+|]/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === 'console' || token === 'log') config.logStructured = true;
    if (token === 'csv') config.downloadCsv = true;
    if (token === 'json') config.downloadJson = true;
    if (token === 'raw') config.logRaw = true;
    if (token === 'rawjson' || token === 'raw_json') config.downloadRawJson = true;
    if (token === 'md' || token === 'markdown') config.downloadMarkdown = true;
    if (token === 'page' || token === 'rawpage') config.rawIncludePage = true;
    if (token === 'saveas') config.saveAs = true;
  }

  if (!config.logStructured && !config.logRaw && !config.downloadCsv && !config.downloadJson && !config.downloadRawJson && !config.downloadMarkdown) {
    config.downloadMarkdown = true;
  }

  return config;
}

function getAutoExportConfig() {
  const params = new URLSearchParams(window.location.search || '');
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
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getAutoSyncEnabled() {
  const params = new URLSearchParams(window.location.search || '');
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
    document.documentElement.setAttribute('data-tr-auto-sync', status);
    if (typeof count === 'number' && Number.isFinite(count)) {
      document.documentElement.setAttribute('data-tr-auto-sync-count', String(count));
    } else {
      document.documentElement.removeAttribute('data-tr-auto-sync-count');
    }
    if (typeof pagesProcessed === 'number' && Number.isFinite(pagesProcessed)) {
      document.documentElement.setAttribute('data-tr-auto-sync-pages', String(pagesProcessed));
    } else {
      document.documentElement.removeAttribute('data-tr-auto-sync-pages');
    }
  } catch {
    // ignore
  }
}

const SyncStatusWidget = (() => {
  const WIDGET_ID = 'tr-sync-status-widget';
  const DEFAULT_AUTO_DISMISS_MS = 5000;
  const HIDE_DELAY_MS = 220;
  let widgetEl = null;
  let dismissTimer = null;
  let hideTimer = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

    widgetEl = document.createElement('div');
    widgetEl.id = WIDGET_ID;
    widgetEl.className = 'tr-sync-widget';
    widgetEl.setAttribute('role', 'status');
    widgetEl.setAttribute('aria-live', 'polite');
    widgetEl.setAttribute('aria-atomic', 'true');
    const mountTarget = document.body || document.documentElement;
    mountTarget.appendChild(widgetEl);
    return widgetEl;
  }

  function renderIcon(state) {
    if (state === 'progress') {
      return '<span class="tr-sync-widget__spinner" aria-hidden="true"></span>';
    }
    if (state === 'success') {
      return '<span aria-hidden="true">✓</span>';
    }
    return '<span aria-hidden="true">!</span>';
  }

  function openOptionsPage() {
    try {
      void chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch((error) => {
        console.warn('🎯 [Auto Sync] Failed to open options page:', error);
      });
    } catch (error) {
      console.warn('🎯 [Auto Sync] Failed to request options page:', error);
    }
  }

  function show({ state = 'progress', message = '', hint = '', autoDismiss = false } = {}) {
    const normalizedState = state === 'success' || state === 'error' ? state : 'progress';
    const safeMessage = escapeHtml(message);
    const safeHint = escapeHtml(hint);
    const widget = ensureWidget();
    clearTimers();

    widget.className = `tr-sync-widget tr-sync-widget--${normalizedState}`;
    widget.classList.remove('tr-sync-widget--hidden');
    widget.innerHTML = `
      <div class="tr-sync-widget__icon">${renderIcon(normalizedState)}</div>
      <div class="tr-sync-widget__content">
        <div class="tr-sync-widget__message">${safeMessage}</div>
        ${safeHint ? `<div class="tr-sync-widget__hint">${safeHint}</div>` : ''}
      </div>
      ${normalizedState === 'progress'
        ? '<button type="button" class="tr-sync-widget__cancel" aria-label="取消同步">取消</button>'
        : normalizedState === 'error'
          ? '<button type="button" class="tr-sync-widget__close" aria-label="关闭提示">×</button>'
          : ''}
    `;

    widget.onclick = null;
    if (normalizedState === 'progress') {
      const cancelBtn = widget.querySelector('.tr-sync-widget__cancel');
      cancelBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        autoSyncCancelled = true;
        cancelBtn.setAttribute('disabled', 'true');
        cancelBtn.textContent = '取消中...';
      });
    }
    if (normalizedState === 'error') {
      widget.onclick = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.tr-sync-widget__close')) return;
        openOptionsPage();
      };

      const closeBtn = widget.querySelector('.tr-sync-widget__close');
      closeBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        hide();
      });
    }

    const dismissMs = typeof autoDismiss === 'number'
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
    widgetEl.classList.add('tr-sync-widget--hidden');
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
    hide
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
        reject(new Error('Timed out waiting for resume cards'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 500);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

function waitForApiRows({ timeoutMs = 5000, minCount = 1 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const count = getApiSnapshotCount();
      if (count >= minCount) {
        done = true;
        cleanup();
        resolve(count);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error('Timed out waiting for API rows'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

async function waitForExtractionData({ timeoutMs = 30000, minCount = 1 } = {}) {
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
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
  if (getCurrentSourceKey() === SOURCE_KEYS.SEEK) {
    apiSnapshot.seekRecommendedCandidates = null;
    apiSnapshot.seekRequest = null;
  }
}

function waitForPagination({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const pagination = document.querySelector(SELECTORS.pagination);
      const nextBtn = document.querySelector(SELECTORS.nextPageBtn);
      if (pagination && nextBtn) {
        done = true;
        cleanup();
        resolve(true);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error('Timed out waiting for pagination controls'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
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
      reject(new Error('Invalid expected page'));
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
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
  });
}

function waitForSearchElements({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const input = document.querySelector(SELECTORS.searchInput);
      const button = document.querySelector(SELECTORS.searchButton);
      if (input && button) {
        done = true;
        cleanup();
        resolve({ input, button });
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error('Timed out waiting for search controls'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

function isElementVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
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
        reject(new Error('Timed out waiting for area selector modal'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
  });
}

function getAreaItemText(item) {
  if (!item) return '';
  const source = item.querySelector('span') || item;
  const clone = source.cloneNode(true);
  clone.querySelectorAll('.select-num').forEach((node) => node.remove());
  return (clone.textContent || '')
    // Remove icon-font glyphs that are rendered as private-use unicode chars.
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const target = text.replace(/\s+/g, ' ').trim();
  const itemSelector = `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;
  const items = container.querySelectorAll(itemSelector);
  for (const item of items) {
    if (getAreaItemText(item) === target) return asHTMLElement(item);
  }
  return null;
}

/**
 * @param {string} blockSelector
 * @param {{ timeoutMs?: number, itemSelector?: string }} [options]
 * @returns {Promise<{ block: Element, items: Element[] }>}
 */
function waitForAreaItems(blockSelector, { timeoutMs = 5000, itemSelector } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;
    const targetSelector = itemSelector || `${SELECTORS.areaItem}, ${SELECTORS.areaDistrictItem}`;

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
        reject(new Error(`Timed out waiting for area items in ${blockSelector}`));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
  });
}

function waitForAreaTrigger({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      if (done) return;
      const trigger = asHTMLElement(document.querySelector(SELECTORS.areaTrigger));
      if (trigger && isElementVisible(trigger)) {
        done = true;
        cleanup();
        resolve(trigger);
      } else if (Date.now() > deadline) {
        done = true;
        cleanup();
        reject(new Error('Timed out waiting for area trigger'));
      }
    };

    const cleanup = () => {
      clearInterval(intervalId);
      observer.disconnect();
    };

    const intervalId = setInterval(check, 300);
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check();
  });
}

function setAutoSearchAttributes(status, keyword) {
  try {
    document.documentElement.setAttribute('data-tr-auto-search', status);
    if (keyword) {
      document.documentElement.setAttribute('data-tr-search-keyword', keyword);
    } else {
      document.documentElement.removeAttribute('data-tr-search-keyword');
    }
  } catch {
    // ignore
  }
}

function setAutoLocationAttributes(status, location) {
  try {
    document.documentElement.setAttribute('data-tr-auto-location', status);
    if (location) {
      document.documentElement.setAttribute('data-tr-location-value', location);
    } else {
      document.documentElement.removeAttribute('data-tr-location-value');
    }
  } catch {
    // ignore
  }
}

function setAutoAgeAttributes(status, minAge, maxAge) {
  try {
    document.documentElement.setAttribute('data-tr-auto-age', status);
    const normalizedMin = typeof minAge === 'number' && Number.isFinite(minAge) ? Math.trunc(minAge) : null;
    const normalizedMax = typeof maxAge === 'number' && Number.isFinite(maxAge) ? Math.trunc(maxAge) : null;
    if (normalizedMin !== null || normalizedMax !== null) {
      document.documentElement.setAttribute(
        'data-tr-age-range',
        `${normalizedMin !== null ? normalizedMin : ''}-${normalizedMax !== null ? normalizedMax : ''}`
      );
    } else {
      document.documentElement.removeAttribute('data-tr-age-range');
    }
  } catch {
    // ignore
  }
}

function setInputValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fireMouseEvent(target, type) {
  try {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  } catch {
    // ignore
  }
}

function findAgeFilterBlock() {
  const titles = document.querySelectorAll('.base-input-block__title__text');
  const label = Array.from(titles).find((node) => (node.textContent || '').replace(/\s+/g, '').trim() === '年龄');
  return label ? label.closest('.base-input-block') : null;
}

function openAgeFilterDropdown(ageBlock) {
  const title = ageBlock.querySelector('.base-input-block__title') || ageBlock;
  ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach((type) => fireMouseEvent(title, type));
}

async function waitForAgeFilterDropdown(ageBlock, { timeoutMs = 4000 } = {}) {
  const selectBox = ageBlock.querySelector('.base-input-block__select_box');
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
  const buttons = Array.from(selectBox.querySelectorAll('button'));
  const confirmButton = buttons.find((button) => {
    const text = (button.textContent || '').replace(/\s+/g, '').trim();
    return text === '确定' || text === '確定';
  });
  const cancelButton = buttons.find((button) => {
    const text = (button.textContent || '').replace(/\s+/g, '').trim();
    return text === '取消';
  });

  return { minInput, maxInput, confirmButton, cancelButton };
}

async function autoApplyAgeFilterFromUrl() {
  const range = getAgeRangeFromUrl();
  if (!range.enabled) {
    setAutoAgeAttributes('skipped');
    return;
  }

  const minAge = range.minAge;
  const maxAge = range.maxAge;
  if (typeof minAge === 'number' && typeof maxAge === 'number' && minAge > maxAge) {
    setAutoAgeAttributes('failed', minAge, maxAge);
    console.warn('🎯 [Auto Age] Invalid age range (minAge > maxAge):', { minAge, maxAge });
    return;
  }

  const ageBlock = findAgeFilterBlock();
  if (!ageBlock) {
    setAutoAgeAttributes('failed', minAge, maxAge);
    console.warn('🎯 [Auto Age] Age filter control not found; skipping native age filter apply.');
    return;
  }

  const selectBox = await waitForAgeFilterDropdown(ageBlock, { timeoutMs: 5000 });
  if (!selectBox) {
    setAutoAgeAttributes('failed', minAge, maxAge);
    console.warn('🎯 [Auto Age] Failed to open age filter dropdown.');
    return;
  }

  const { minInput, maxInput, confirmButton, cancelButton } = resolveAgeFilterActions(selectBox);
  if (!minInput || !maxInput || !confirmButton) {
    setAutoAgeAttributes('failed', minAge, maxAge);
    if (cancelButton) {
      cancelButton.click();
    }
    console.warn('🎯 [Auto Age] Age filter inputs/buttons not found; skipping native age filter apply.');
    return;
  }

  setInputValue(minInput, typeof minAge === 'number' ? String(minAge) : '');
  setInputValue(maxInput, typeof maxAge === 'number' ? String(maxAge) : '');
  confirmButton.click();
  setAutoAgeAttributes('done', minAge, maxAge);

  try {
    await waitForExtractionData({ timeoutMs: 15000 });
  } catch (error) {
    console.warn('🎯 [Auto Age] Applied age filter, but waiting for results timed out:', error);
  }
}

async function autoSelectLocation() {
  const params = new URLSearchParams(window.location.search || '');
  const locationRaw = (params.get(AUTO_LOCATION_PARAM) || '').trim();
  const parsedLocations = Array.from(
    new Set(
      locationRaw
        .split(/[\s,，、]+/)
        .map((location) => location.trim())
        .filter(Boolean)
    )
  ).slice(0, 10);

  if (parsedLocations.length === 0) {
    setAutoLocationAttributes('skipped', '');
    return;
  }

  console.log('🎯 [Auto Location] Selecting locations:', parsedLocations);

  let modal = document.querySelector(SELECTORS.areaModal);
  if (!isElementVisible(modal)) {
    let trigger;
    try {
      trigger = await waitForAreaTrigger({});
    } catch {
      setAutoLocationAttributes('failed', locationRaw);
      console.warn('🎯 [Auto Location] Trigger not found');
      return;
    }
    trigger.click();
    try {
      modal = await waitForAreaModal({});
    } catch (error) {
      setAutoLocationAttributes('failed', locationRaw);
      console.warn('🎯 [Auto Location] Area selector not ready:', error);
      return;
    }
  }

  const provinceBlock = modal.querySelector(SELECTORS.areaProvinceBlock);
  const confirmBtn = asHTMLElement(modal.querySelector(SELECTORS.areaConfirmBtn));
  const cancelBtn = asHTMLElement(modal.querySelector(SELECTORS.areaCancelBtn));
  if (!provinceBlock || !confirmBtn || !cancelBtn) {
    setAutoLocationAttributes('failed', locationRaw);
    console.warn('🎯 [Auto Location] Missing modal controls');
    return;
  }
  const locationsToSelect = parsedLocations.filter((location, index) => {
    const next = parsedLocations[index + 1];
    return !(next && isProvinceToken(location) && !isProvinceToken(next));
  });

  const selectAllDistrictAndConfirm = async (loc) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const { block: districtBlock } = await waitForAreaItems(SELECTORS.areaDistrictBlock, {
      itemSelector: SELECTORS.areaDistrictItem,
      timeoutMs: 5000
    });
    const districtItems = Array.from(districtBlock.querySelectorAll(SELECTORS.areaDistrictItem));
    const selectAllDistrict = findAreaItemByText(districtBlock, `全${loc}`)
      || asHTMLElement(districtItems.find((item) => getAreaItemText(item).startsWith('全')) || null);
    if (!selectAllDistrict) return false;
    selectAllDistrict.click();
    return true;
  };

  const tryCityFlow = async (loc) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const { block: cityBlock } = await waitForAreaItems(SELECTORS.areaCityBlock, {
      itemSelector: SELECTORS.areaItem,
      timeoutMs: 5000
    });
    const cityMatch = findAreaItemByText(cityBlock, loc);
    if (!cityMatch) return false;
    cityMatch.click();

    if (cityMatch.textContent.trim().startsWith('全')) {
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
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        const { block: cityBlock } = await waitForAreaItems(SELECTORS.areaCityBlock, {
          itemSelector: SELECTORS.areaItem,
          timeoutMs: 5000
        });
        const cityItems = Array.from(cityBlock.querySelectorAll(SELECTORS.areaItem));
        const selectAllCity = findAreaItemByText(cityBlock, `全${location}`)
          || findAreaItemByText(cityBlock, location)
          || asHTMLElement(cityItems.find((item) => getAreaItemText(item).startsWith('全')) || null);
        if (selectAllCity) {
          selectAllCity.click();
          if (selectAllCity.textContent.trim().startsWith('全')) {
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
      const hotCities = findAreaItemByText(provinceBlock, '热门城市');
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
      const provinceItems = Array.from(provinceBlock.querySelectorAll(SELECTORS.areaItem));
      for (const province of provinceItems) {
        const hotCities = findAreaItemByText(provinceBlock, '热门城市');
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
      console.warn('🎯 [Auto Location] Location not found:', location);
    }
  }

  // Final confirmation step
  if (successLocations.length > 0) {
    confirmBtn.click();
    setAutoLocationAttributes('done', successLocations.join(','));
  } else {
    cancelBtn.click();
    setAutoLocationAttributes('failed', locationRaw);
  }
}

async function autoSearchFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const urlKeywordMode = params.get(AUTO_KEYWORD_MODE_PARAM);
  const keywordMode = normalizeKeywordMode(urlKeywordMode || await getKeywordMode());
  let keyword = normalizeKeyword(params.get(AUTO_SEARCH_PARAM) || '');
  if (keyword && keywordMode !== KEYWORD_MODE_SPACED) {
    keyword = keyword.replace(/\s+/g, '');
  }
  if (!keyword) {
    setAutoSearchAttributes('skipped', '');
    return;
  }

  let input;
  let button;
  try {
    ({ input, button } = await waitForSearchElements());
  } catch (error) {
    console.warn('🎯 [Auto Search] Search controls not ready:', error);
    setAutoSearchAttributes('skipped', keyword);
    return;
  }

  let currentValue = normalizeKeyword(input.value || '');
  if (keywordMode !== KEYWORD_MODE_SPACED) {
    currentValue = currentValue.replace(/\s+/g, '');
  }
  if (currentValue === keyword) {
    setAutoSearchAttributes('skipped', keyword);
    return;
  }

  console.log('🎯 [Auto Search] Searching for:', keyword, `(mode=${keywordMode})`);
  setInputValue(input, keyword);
  button.click();
  setAutoSearchAttributes('done', keyword);

  try {
    const count = await waitForExtractionData({});
    console.log('🎯 [Auto Search] Done, found', count, 'results');
  } catch (error) {
    console.warn('🎯 [Auto Search] Search triggered, waiting for results timed out:', error);
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
      console.log('🎯 [Auto Export] Extracted resumes', {
        count: resumes.length,
        resumes
      });
    }

    try {
      document.documentElement.setAttribute('data-tr-auto-export', 'done');
      document.documentElement.setAttribute('data-tr-auto-export-count', String(resumes.length));
    } catch {
      // ignore
    }

    let rawPayload = null;
    if (config.logRaw || config.downloadRawJson || config.downloadMarkdown || config.rawIncludePage) {
      rawPayload = extractResumesRaw({ includePage: config.rawIncludePage });
      if (config.logRaw) {
        console.log('🎯 [Auto Export] Raw resumes', rawPayload);
      }
      if (config.downloadRawJson) {
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `resumes_raw_${timestamp}_${makeRandomId()}.json`;
        await downloadFile(JSON.stringify(rawPayload, null, 2), filename, 'application/json', config.saveAs);
        console.log('🎯 [Auto Export] Raw JSON download triggered:', filename);
      }
      if (config.downloadMarkdown) {
        const markdown = rawToMarkdown(rawPayload);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `resumes_md_${timestamp}_${makeRandomId()}.md`;
        await downloadFile(markdown, filename, 'text/markdown', config.saveAs);
        console.log('🎯 [Auto Export] Markdown download triggered:', filename);
      }
    }

    if (config.downloadCsv) {
      const csv = resumesToCSV(resumes);
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `resumes_${timestamp}_${makeRandomId()}.csv`;
      await downloadFile(csv, filename, 'text/csv', config.saveAs);
      console.log('🎯 [Auto Export] CSV download triggered:', filename);
    }

    if (config.downloadJson) {
      const metadata = buildExportMetadata(resumes);
      const payload = { metadata, data: resumes };
      const json = JSON.stringify(payload, null, 2);
      const filename = buildExportFilename();
      await downloadFile(json, filename, 'application/json', config.saveAs);
      console.log('🎯 [Auto Export] JSON download triggered:', filename);
    }
  } catch (error) {
    console.warn('🎯 [Auto Export] Failed:', error);
  }
}

async function syncCurrentPageToServer(resumesOverride) {
  const resumes = Array.isArray(resumesOverride) ? resumesOverride : extractResumes();
  const metadata = buildSubmitMetadata();
  return chrome.runtime.sendMessage({ action: 'syncToServer', metadata, resumes });
}

function resolveAutoSyncErrorStatus(errorLike) {
  const rawError = typeof errorLike === 'string'
    ? errorLike
    : (errorLike?.error || errorLike?.message || String(errorLike || ''));
  const message = String(rawError).trim() || 'Unknown error';
  const lowerMessage = message.toLowerCase();

  if (message === 'Server token not configured') {
    return {
      message: 'Token 未配置',
      hint: '点击此提示打开扩展设置并填写 Token'
    };
  }

  if (message.includes('401') || lowerMessage.includes('unauthorized')) {
    return {
      message: '认证失败 - Token 无效或已过期',
      hint: '点击此提示打开扩展设置并更新 Token'
    };
  }

  if (message === 'Server URL not configured') {
    return {
      message: '服务器地址未配置',
      hint: '点击此提示打开扩展设置并填写服务器地址'
    };
  }

  if (
    lowerMessage.includes('failed to fetch')
    || lowerMessage.includes('networkerror')
    || lowerMessage.includes('network error')
    || lowerMessage.includes('err_network')
    || lowerMessage.includes('load failed')
    || lowerMessage.includes('connection')
  ) {
    return {
      message: '无法连接服务器',
      hint: '请检查网络连接和服务器状态后重试'
    };
  }

  return {
    message: `同步失败: ${message}`,
    hint: '点击此提示打开扩展设置排查问题'
  };
}

async function runAutoSyncIfEnabled() {
  if (autoSyncTriggered) return;
  const enabled = getAutoSyncEnabled();
  if (!enabled) {
    setAutoSyncAttributes('skipped');
    return;
  }

  const { limit, maxPages } = await getCollectionLimits();

  autoSyncTriggered = true;
  autoSyncCancelled = false;
  setAutoSyncAttributes('running', 0, 0);
  try {
    document.documentElement.setAttribute('data-tr-auto-sync-limit', String(limit));
    document.documentElement.setAttribute('data-tr-auto-sync-max-pages', String(maxPages));
  } catch {
    // ignore
  }
  SyncStatusWidget.show({
    state: 'progress',
    message: '正在同步简历到服务器...',
    hint: `数量上限: ${limit > 0 ? limit : '不限'} · 页数上限: ${maxPages > 0 ? maxPages : '不限'}`
  });

  try {
    let totalSubmitted = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let pagesVisited = 0;
    let stopReason = 'completed';

    while (true) {
      if (autoSyncCancelled) {
        stopReason = 'cancelled';
        break;
      }

      const paginationBefore = getPaginationInfo();
      const currentPage = paginationBefore.currentPage;
      const totalPages = paginationBefore.totalPages;

      await waitForExtractionData({});

      pagesVisited += 1;

      const remainingCapacity = limit > 0 ? Math.max(limit - totalSubmitted, 0) : 0;
      if (limit > 0 && remainingCapacity <= 0) {
        stopReason = 'limit-reached';
        break;
      }

      let resumes = extractResumes();
      if (limit > 0 && resumes.length > remainingCapacity) {
        resumes = resumes.slice(0, remainingCapacity);
      }
      if (resumes.length <= 0) {
        const progressHint = limit > 0
          ? `已采集 ${Math.min(totalSubmitted, limit)}/${limit}`
          : `已采集 ${totalSubmitted}`;
        const ageRange = getAgeRangeFromUrl();
        const ageHint = ageRange.enabled
          ? ` · 年龄: ${typeof ageRange.minAge === 'number' ? ageRange.minAge : '—'}-${typeof ageRange.maxAge === 'number' ? ageRange.maxAge : '—'}`
          : '';

        SyncStatusWidget.show({
          state: 'progress',
          message: `第 ${currentPage}/${Math.max(totalPages, currentPage)} 页无符合条件的简历，继续...`,
          hint: `${progressHint}${ageHint}`
        });
        setAutoSyncAttributes('running', totalSubmitted, pagesVisited);

        if (autoSyncCancelled) {
          stopReason = 'cancelled';
          break;
        }
        if (maxPages > 0 && pagesVisited >= maxPages) {
          stopReason = 'max-pages-reached';
          break;
        }

        const paginationAfter = getPaginationInfo();
        try {
          await waitForPagination({ timeoutMs: 8000 });
        } catch {
          // Some layouts render pagination late or omit it on single-page results.
        }
        const nextPage = paginationAfter.currentPage + 1;
        try {
          document.documentElement.setAttribute('data-tr-auto-sync-next-state', JSON.stringify(getNextPageButtonState()));
        } catch {
          // ignore
        }
        clearCapturedResultsForNextPage();
        const moved = goToNextPageInternal();
        if (!moved) {
          stopReason = 'no-next-page';
          break;
        }
        await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const progressHint = limit > 0
        ? `已采集 ${Math.min(totalSubmitted, limit)}/${limit}`
        : `已采集 ${totalSubmitted}`;
      SyncStatusWidget.show({
        state: 'progress',
        message: `正在同步第 ${currentPage}/${Math.max(totalPages, currentPage)} 页 (${resumes.length} 份)...`,
        hint: progressHint
      });

      const response = await syncCurrentPageToServer(resumes);
      if (!response?.success) {
        throw response?.error || response || 'Auto sync failed';
      }

      const submitted = typeof response.submitted === 'number' ? response.submitted : resumes.length;
      const inserted = typeof response.inserted === 'number' ? response.inserted : 0;
      const updated = typeof response.updated === 'number' ? response.updated : 0;
      totalSubmitted += submitted;
      totalInserted += inserted;
      totalUpdated += updated;
      setAutoSyncAttributes('running', totalSubmitted, pagesVisited);

      if (autoSyncCancelled) {
        stopReason = 'cancelled';
        break;
      }
      if (limit > 0 && totalSubmitted >= limit) {
        stopReason = 'limit-reached';
        break;
      }
      if (maxPages > 0 && pagesVisited >= maxPages) {
        stopReason = 'max-pages-reached';
        break;
      }

      const paginationAfter = getPaginationInfo();
      try {
        await waitForPagination({ timeoutMs: 8000 });
      } catch {
        // Some layouts render pagination late or omit it on single-page results.
      }
      const nextPage = paginationAfter.currentPage + 1;
      try {
        document.documentElement.setAttribute('data-tr-auto-sync-next-state', JSON.stringify(getNextPageButtonState()));
      } catch {
        // ignore
      }
      clearCapturedResultsForNextPage();
      const moved = goToNextPageInternal();
      if (!moved) {
        stopReason = 'no-next-page';
        break;
      }
      await waitForPageTransition({ expectedPage: nextPage, timeoutMs: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    try {
      document.documentElement.setAttribute('data-tr-auto-sync-stop-reason', stopReason);
    } catch {
      // ignore
    }

    if (autoSyncCancelled) {
      SyncStatusWidget.show({
        state: 'success',
        message: `同步已取消，已同步 ${totalSubmitted} 份简历`,
        hint: `${totalInserted} 新增, ${totalUpdated} 更新, 共 ${pagesVisited} 页`,
        autoDismiss: true
      });
      setAutoSyncAttributes('cancelled', totalSubmitted, pagesVisited);
      return;
    }

    SyncStatusWidget.show({
      state: 'success',
      message: `已同步 ${totalSubmitted} 份简历 (${totalInserted} 新增, ${totalUpdated} 更新), 共 ${pagesVisited} 页`,
      autoDismiss: true
    });
    setAutoSyncAttributes('done', totalSubmitted, pagesVisited);
  } catch (error) {
    console.warn('🎯 [Auto Sync] Failed:', error);
    const status = resolveAutoSyncErrorStatus(error);
    SyncStatusWidget.show({
      state: 'error',
      message: status.message,
      hint: status.hint
    });
    setAutoSyncAttributes('failed');
    try {
      document.documentElement.setAttribute('data-tr-auto-sync-stop-reason', 'failed');
    } catch {
      // ignore
    }
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCurrentPage') {
    const resumes = extractResumes();
    const pagination = getPaginationInfo();
    const metadata = buildSubmitMetadata();
    sendResponse({
      success: true,
      data: resumes,
      count: resumes.length,
      pagination,
      metadata
    });
  }
  else if (request.action === 'downloadCSV') {
    const resumes = extractResumes();
    const csv = resumesToCSV(resumes);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `resumes_${timestamp}_${makeRandomId()}.csv`;
    const saveAs = !!request.saveAs;

    // Download via background script (chrome.downloads API preserves filenames)
    downloadFile(csv, filename, 'text/csv', saveAs)
      .then(() => sendResponse({ success: true, count: resumes.length, filename }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }
  else if (request.action === 'downloadJSON') {
    const resumes = extractResumes();
    const metadata = buildExportMetadata(resumes);
    const payload = { metadata, data: resumes };
    const json = JSON.stringify(payload, null, 2);
    const filename = buildExportFilename();
    const saveAs = !!request.saveAs;

    // Download via background script (chrome.downloads API preserves filenames)
    downloadFile(json, filename, 'application/json', saveAs)
      .then(() => sendResponse({ success: true, count: resumes.length, filename }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }
  else if (request.action === 'getPaginationInfo') {
    sendResponse(getPaginationInfo());
  }
  else if (request.action === 'ping') {
    sendResponse({ success: true, message: 'Content script loaded' });
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

function getExternalAccessorStatus() {
  const version = getExtensionVersion();
  const pagination = getPaginationInfo();
  const ageRange = getAgeRangeFromUrl();
  const sourceKey = getCurrentSourceKey();
  const apiSnapshotCount = getApiSnapshotCount();
  const cardCount = sourceKey === SOURCE_KEYS.SEEK
    ? Math.max(apiSnapshotCount, getSeekCardCount())
    : document.querySelectorAll(SELECTORS.resumeCard).length;
  const autoSearch = document.documentElement.getAttribute('data-tr-auto-search') || '';
  const autoLocation = document.documentElement.getAttribute('data-tr-auto-location') || '';
  const autoExport = document.documentElement.getAttribute('data-tr-auto-export') || '';
  const autoSync = document.documentElement.getAttribute('data-tr-auto-sync') || '';
  const autoSyncCountRaw = document.documentElement.getAttribute('data-tr-auto-sync-count') || '';
  const autoSyncPagesRaw = document.documentElement.getAttribute('data-tr-auto-sync-pages') || '';
  const autoSyncCount = Number.parseInt(autoSyncCountRaw, 10);
  const autoSyncPages = Number.parseInt(autoSyncPagesRaw, 10);

  return {
    extensionLoaded: true,
    extensionVersion: version,
    sourceKey,
    apiSnapshotCount,
    domReady: isExtractionReady(),
    loggedIn: isLoggedIn(),
    ageRange: ageRange.enabled
      ? {
          minAge: typeof ageRange.minAge === 'number' ? ageRange.minAge : null,
          maxAge: typeof ageRange.maxAge === 'number' ? ageRange.maxAge : null,
        }
      : null,
    cardCount,
    autoSearch,
    autoLocation,
    autoExport,
    autoSync,
    autoSyncCount: Number.isFinite(autoSyncCount) ? autoSyncCount : 0,
    autoSyncPages: Number.isFinite(autoSyncPages) ? autoSyncPages : 0,
    pagination,
    lastOperationName: apiSnapshot.lastOperationName,
    timestamp: new Date().toISOString()
  };
}

function installExternalAccessor() {
  try {
    const version = getExtensionVersion();
    window[EXTERNAL_ACCESS_KEY] = {
      extract: () => extractResumes(),
      extractRaw: (options) => extractResumesRaw(options),
      getApiSnapshot: () => apiSnapshot,
      getPaginationInfo: () => getPaginationInfo(),
      isReady: () => isExtractionReady(),
      isLoggedIn: () => isLoggedIn(),
      status: () => getExternalAccessorStatus(),
      syncToServer: () => syncCurrentPageToServer(),
      version,
      goToNextPage: () => goToNextPageInternal()
    };
  } catch (error) {
    console.warn('🎯 [External Access] Failed to install accessor:', error);
  }
}

// Inject indicator that extension is active
console.log('🎯 智通直聘 Resume Collector loaded');
installApiHook();
installReloadHelper();
installExternalAccessor();
autoSelectLocation()
  .catch((error) => console.warn('🎯 [Auto Location] Failed:', error))
  .then(() => autoSearchFromUrl())
  .catch((error) => console.warn('🎯 [Auto Search] Failed:', error))
  .then(() => autoApplyAgeFilterFromUrl())
  .catch((error) => console.warn('🎯 [Auto Age] Failed:', error))
  .finally(() => {
    void (async () => {
      await runAutoExportIfEnabled();
      await runAutoSyncIfEnabled();
    })();
  });
