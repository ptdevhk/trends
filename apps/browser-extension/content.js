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
      resumes.push(resume);
    } catch (error) {
      console.error(`Error extracting resume ${index}:`, error);
    }
  });

  return resumes;
}

/**
 * Convert resumes to CSV format
 * @param {Array} resumes - Array of resume objects
 * @returns {string} - CSV string
 */
function resumesToCSV(resumes) {
  if (resumes.length === 0) return '';

  const headers = ['序号', '姓名', '年龄', '工作经验', '学历', '所在地', '期望薪资', '活跃状态', '求职意向', '简历链接', '提取时间'];
  const rows = resumes.map((r, i) => [
    i + 1,
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
