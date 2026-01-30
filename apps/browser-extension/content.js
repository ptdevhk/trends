/**
 * 智通直聘 Resume Collector - Content Script
 * Extracts resume data from hr.job5156.com/search page
 */

// CSS Selectors based on DOM analysis
const SELECTORS = {
  listContainer: '.el-checkbox-group.resume-search-item-list-content-block',
  resumeCard: '.list-content__li_part',
  name: 'a.name',
  activityStatus: '.date-type-diff-text-block',
  basicInfoRow: '.list-content__li__down-left-center',
  topRow: '.list-content__li__up-block',
  workHistory: '.list-content__li__down-right-center',
  pagination: '.el-pagination',
  nextPageBtn: '.el-pagination .btn-next'
};

const AUTO_EXPORT_PARAM = 'tr_auto_export';
let autoExportTriggered = false;
const API_CAPTURE_SOURCE = 'tr-resume-api';

const apiSnapshot = {
  searchRows: null,
  attachInfo: null,
  chatInfo: null,
  insightInfo: null,
  lastUpdatedAt: null,
  lastSearchAt: null,
  lastUrl: null
};

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
    globalThis.trReloadExtension = () => {
      try {
        chrome.runtime.sendMessage({ action: 'reloadExtension' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('🎯 [DEV] Reload failed:', chrome.runtime.lastError.message);
            return;
          }
          console.log('🎯 [DEV] Reload requested', response);
        });
      } catch (error) {
        console.warn('🎯 [DEV] Reload failed:', error);
      }
    };
    console.log('🎯 [DEV] Use trReloadExtension() in the DevTools \"Content scripts\" context to reload the extension');
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
  const getText = (selector) => {
    const el = card.querySelector(selector);
    return el ? el.textContent.trim() : '';
  };

  const getLink = (selector) => {
    const el = card.querySelector(selector);
    return el ? el.href : '';
  };

  // Extract basic info (age, experience, education, location)
  const basicInfoContainer = card.querySelector(SELECTORS.basicInfoRow);
  const basicInfoSpans = basicInfoContainer
    ? basicInfoContainer.querySelectorAll('div:nth-child(2) span, .basic-line span')
    : [];

  const basicInfo = Array.from(basicInfoSpans).map(s => s.textContent.trim()).filter(Boolean);

  // Parse basic info - typical format: ["37岁", "12年", "初中及以下", "东莞万江区"]
  let age = '', experience = '', education = '', location = '';
  basicInfo.forEach(item => {
    if (item.includes('岁')) age = item;
    else if (item.includes('年') && !item.includes('元')) experience = item;
    else if (item.includes('中') || item.includes('大专') || item.includes('本科') || item.includes('硕') || item.includes('博')) education = item;
    else if (!item.includes('元')) location = item;
  });

  // Extract top row (job intention, salary)
  const topRow = card.querySelector(SELECTORS.topRow);
  const topRowText = topRow ? topRow.textContent.trim() : '';

  // Extract salary from top row
  let expectedSalary = '';
  const salaryMatch = topRowText.match(/\d+-?\d*元\/月/);
  if (salaryMatch) {
    expectedSalary = salaryMatch[0];
  }

  // Extract work history
  const workHistoryContainer = card.querySelector(SELECTORS.workHistory);
  const workItems = workHistoryContainer
    ? workHistoryContainer.querySelectorAll('.flex, .work-item, div[class*="history"]')
    : [];

  const workHistory = [];
  workItems.forEach(item => {
    const text = item.textContent.trim();
    // Parse work history entries
    if (text && text.length > 5) {
      workHistory.push({ raw: text });
    }
  });

  return {
    name: getText(SELECTORS.name),
    profileUrl: getLink(SELECTORS.name),
    activityStatus: getText(SELECTORS.activityStatus),
    age,
    experience,
    education,
    location,
    jobIntention: topRowText.split('求职意向')[1]?.split('元/月')[0]?.trim() || topRowText.substring(0, 100),
    expectedSalary,
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

  const headers = ['序号', 'resumeId', 'perUserId', '姓名', '年龄', '工作经验', '学历', '所在地', '期望薪资', '活跃状态', '求职意向', '简历链接', '提取时间'];
  const rows = resumes.map((r, i) => [
    i + 1,
    r.resumeId || '',
    r.perUserId || '',
    r.name,
    r.age,
    r.experience,
    r.education,
    r.location,
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
      const json = JSON.stringify(resumes, null, 2);
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `resumes_${timestamp}_${makeRandomId()}.json`;
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
    const json = JSON.stringify(resumes, null, 2);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `resumes_${timestamp}_${makeRandomId()}.json`;
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

// Inject indicator that extension is active
console.log('🎯 智通直聘 Resume Collector loaded');
installApiHook();
installReloadHelper();
runAutoExportIfEnabled();
