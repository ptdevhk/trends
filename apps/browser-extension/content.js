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
const AUTO_SEARCH_PARAM = 'keyword';
const AUTO_LOCATION_PARAM = 'location';
const SAMPLE_NAME_PARAM = 'tr_sample_name';
let autoExportTriggered = false;
const API_CAPTURE_SOURCE = 'tr-resume-api';
const EXTERNAL_ACCESS_KEY = '__TR_RESUME_DATA__';

const apiSnapshot = {
  searchRows: null,
  attachInfo: null,
  chatInfo: null,
  insightInfo: null,
  lastUpdatedAt: null,
  lastSearchAt: null,
  lastUrl: null
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
  const rawSampleName = url.searchParams.get(SAMPLE_NAME_PARAM) || '';
  const sampleName = sanitizeSampleName(rawSampleName).replace(/\.json$/i, '');

  url.searchParams.delete(AUTO_EXPORT_PARAM);
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
      location,
      filters: Object.keys(filters).length ? filters : {}
    },
    generatedAt: new Date().toISOString(),
    generatedBy,
    totalPages: pagination.totalPages,
    totalResumes: resumes.length,
    reproduction: `Navigate to sourceUrl, then add ?${reproductionParams.toString()}`
  };
}

function getApiRowForIndex(index) {
  if (!Array.isArray(apiSnapshot.searchRows)) return null;
  return apiSnapshot.searchRows[index] || null;
}

function updateApiSnapshot(kind, payload, url) {
  apiSnapshot.lastUpdatedAt = new Date().toISOString();
  if (url) apiSnapshot.lastUrl = url;

  try {
    document.documentElement.setAttribute('data-tr-api-last', kind);
    document.documentElement.setAttribute('data-tr-api-updated', apiSnapshot.lastUpdatedAt);
  } catch {
    // ignore
  }

  if (kind === 'search') {
    const rows = payload?.data?.resumePage?.rows;
    if (Array.isArray(rows)) {
      apiSnapshot.searchRows = rows;
      apiSnapshot.lastSearchAt = apiSnapshot.lastUpdatedAt;
      try {
        document.documentElement.setAttribute('data-tr-api-rows', String(rows.length));
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
  updateApiSnapshot(msg.kind, msg.payload, msg.url);
});

/**
 * Extract data from a single resume card
 * @param {Element} card - The resume card DOM element
 * @returns {Object} - Extracted resume data
 */
function extractSingleResume(card) {
  const getText = (selector, root = card) => {
    const el = root.querySelector(selector);
    return el ? el.textContent.trim() : '';
  };

  const getLink = (selector, root = card) => {
    const el = root.querySelector(selector);
    return el ? el.href : '';
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
    profileUrl: getLink(SELECTORS.name),
    activityStatus: getText(SELECTORS.activityStatus),
    age,
    experience,
    education,
    location,
    jobIntention,
    expectedSalary,
    selfIntro,
    workHistory,
    extractedAt: new Date().toISOString()
  };
}

/**
 * Extract all resumes from current page
 * @returns {Array} - Array of resume objects
 */
function extractResumes() {
  const cards = document.querySelectorAll(SELECTORS.resumeCard);
  const resumes = [];

  cards.forEach((card, index) => {
    try {
      const resume = extractSingleResume(card);
      resume.pageIndex = index + 1;
      const apiRow = getApiRowForIndex(index);
      if (apiRow) {
        resume.resumeId = apiRow.resumeId ?? '';
        resume.perUserId = apiRow.perUserId ?? '';
      }
      resumes.push(resume);
    } catch (error) {
      console.error(`Error extracting resume ${index}:`, error);
    }
  });

  return resumes;
}

/**
 * Extract raw HTML/text from resume cards (no predefined schema).
 * @param {Object} [options]
 * @param {boolean} [options.includePage=false] - Include full page HTML
 * @returns {Object} - Raw payload
 */
function extractResumesRaw({ includePage = false } = {}) {
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
function getPaginationInfo() {
  const pagination = document.querySelector(SELECTORS.pagination);
  if (!pagination) return { currentPage: 1, totalPages: 1, totalItems: 0 };

  const totalText = pagination.textContent || '';
  const totalMatch = totalText.match(/共\s*(\d+)\s*条/);
  const totalItems = totalMatch ? parseInt(totalMatch[1]) : 0;

  const activePage = pagination.querySelector('.is-active, .active, .el-pager li.active');
  const currentPage = activePage ? parseInt(activePage.textContent) : 1;

  const totalPages = Math.ceil(totalItems / 20); // 20 items per page

  return { currentPage, totalPages, totalItems };
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
      const count = Array.isArray(apiSnapshot.searchRows) ? apiSnapshot.searchRows.length : 0;
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

async function autoSelectLocation() {
  const params = new URLSearchParams(window.location.search || '');
  const location = (params.get(AUTO_LOCATION_PARAM) || '').trim();
  if (!location) {
    setAutoLocationAttributes('skipped', '');
    return;
  }

  console.log('🎯 [Auto Location] Selecting location:', location);

  let modal = document.querySelector(SELECTORS.areaModal);
  if (!isElementVisible(modal)) {
    let trigger;
    try {
      trigger = await waitForAreaTrigger({});
    } catch {
      setAutoLocationAttributes('failed', location);
      console.warn('🎯 [Auto Location] Trigger not found');
      return;
    }
    trigger.click();
    try {
      modal = await waitForAreaModal({});
    } catch (error) {
      setAutoLocationAttributes('failed', location);
      console.warn('🎯 [Auto Location] Area selector not ready:', error);
      return;
    }
  }

  const provinceBlock = modal.querySelector(SELECTORS.areaProvinceBlock);
  const confirmBtn = asHTMLElement(modal.querySelector(SELECTORS.areaConfirmBtn));
  const cancelBtn = asHTMLElement(modal.querySelector(SELECTORS.areaCancelBtn));
  if (!provinceBlock || !confirmBtn || !cancelBtn) {
    setAutoLocationAttributes('failed', location);
    console.warn('🎯 [Auto Location] Missing modal controls');
    return;
  }

  const selectAllDistrictAndConfirm = async () => {
    const { block: districtBlock } = await waitForAreaItems(SELECTORS.areaDistrictBlock, {
      itemSelector: SELECTORS.areaDistrictItem,
      timeoutMs: 5000
    });
    const selectAllDistrict = findAreaItemByText(districtBlock, `全${location}`)
      || districtBlock.querySelector(SELECTORS.areaDistrictItem);
    if (!selectAllDistrict) return false;
    selectAllDistrict.click();
    confirmBtn.click();
    setAutoLocationAttributes('done', location);
    return true;
  };

  const provinceMatch = findAreaItemByText(provinceBlock, location);
  if (provinceMatch) {
    provinceMatch.click();
    try {
      const { block: cityBlock } = await waitForAreaItems(SELECTORS.areaCityBlock, {
        itemSelector: SELECTORS.areaItem,
        timeoutMs: 5000
      });
      const selectAllCity = findAreaItemByText(cityBlock, location)
        || cityBlock.querySelector(SELECTORS.areaItem);
      if (selectAllCity) selectAllCity.click();
      if (await selectAllDistrictAndConfirm()) return;
    } catch {
      // Continue to city-level fallback.
    }
  }

  const tryCityFlow = async () => {
    const { block: cityBlock } = await waitForAreaItems(SELECTORS.areaCityBlock, {
      itemSelector: SELECTORS.areaItem,
      timeoutMs: 5000
    });
    const cityMatch = findAreaItemByText(cityBlock, location);
    if (!cityMatch) return false;
    cityMatch.click();
    return selectAllDistrictAndConfirm();
  };

  const hotCities = findAreaItemByText(provinceBlock, '热门城市');
  if (hotCities) {
    hotCities.click();
    try {
      if (await tryCityFlow()) return;
    } catch {
      // Continue to province scan fallback.
    }
  }

  const provinceItems = Array.from(provinceBlock.querySelectorAll(SELECTORS.areaItem));
  for (const province of provinceItems) {
    if (hotCities && province === hotCities) continue;
    const provinceEl = asHTMLElement(province);
    if (!provinceEl) continue;
    provinceEl.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      if (await tryCityFlow()) return;
    } catch {
      // Continue scanning other provinces.
    }
  }

  cancelBtn.click();
  setAutoLocationAttributes('failed', location);
  console.warn('🎯 [Auto Location] Location not found:', location);
}

async function autoSearchFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const keyword = normalizeKeyword(params.get(AUTO_SEARCH_PARAM) || '');
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

  const currentValue = normalizeKeyword(input.value || '');
  if (currentValue === keyword) {
    setAutoSearchAttributes('skipped', keyword);
    return;
  }

  console.log('🎯 [Auto Search] Searching for:', keyword);
  setInputValue(input, keyword);
  button.click();
  setAutoSearchAttributes('done', keyword);

  try {
    const count = await waitForResumeCards({});
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
    await waitForResumeCards({});
    try {
      await waitForApiRows({});
    } catch {
      // API rows are optional; continue with DOM-only extraction
    }
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

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCurrentPage') {
    const resumes = extractResumes();
    const pagination = getPaginationInfo();
    sendResponse({
      success: true,
      data: resumes,
      count: resumes.length,
      pagination
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
    return chrome?.runtime?.getManifest?.().version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isLoggedIn() {
  return !document.querySelector('.login-btn, [href*="login"]');
}

function installExternalAccessor() {
  try {
    const version = getExtensionVersion();
    window[EXTERNAL_ACCESS_KEY] = {
      extract: () => extractResumes(),
      extractRaw: (options) => extractResumesRaw(options),
      getApiSnapshot: () => apiSnapshot,
      getPaginationInfo: () => getPaginationInfo(),
      isReady: () => document.querySelector(SELECTORS.listContainer) !== null,
      isLoggedIn: () => isLoggedIn(),
      status: () => {
        const pagination = getPaginationInfo();
        const cardCount = document.querySelectorAll(SELECTORS.resumeCard).length;
        const autoSearch = document.documentElement.getAttribute('data-tr-auto-search') || '';
        const autoLocation = document.documentElement.getAttribute('data-tr-auto-location') || '';
        const autoExport = document.documentElement.getAttribute('data-tr-auto-export') || '';
        return {
          extensionLoaded: true,
          extensionVersion: version,
          apiSnapshotCount: Array.isArray(apiSnapshot.searchRows) ? apiSnapshot.searchRows.length : 0,
          domReady: document.querySelector(SELECTORS.listContainer) !== null,
          loggedIn: isLoggedIn(),
          cardCount,
          autoSearch,
          autoLocation,
          autoExport,
          pagination,
          timestamp: new Date().toISOString()
        };
      },
      version
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
  .finally(() => {
    runAutoExportIfEnabled();
  });
