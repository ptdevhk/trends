/**
 * 智通直聘 Resume Collector - Popup Script
 * v1.0.0 - Adds download diagnostics + Save As option
 */

(() => {
// DOM Elements
const statusBar = /** @type {HTMLElement} */ (document.getElementById('status-bar'));
const statusText = /** @type {HTMLElement} */ (document.getElementById('status-text'));
const pageCurrent = /** @type {HTMLElement} */ (document.getElementById('page-current'));
const pageTotal = /** @type {HTMLElement} */ (document.getElementById('page-total'));
const totalItems = /** @type {HTMLElement} */ (document.getElementById('total-items'));
const autoSyncSummary = /** @type {HTMLElement} */ (document.getElementById('auto-sync-summary'));
const autoSyncState = /** @type {HTMLElement} */ (document.getElementById('auto-sync-state'));
const autoSyncMain = /** @type {HTMLElement} */ (document.getElementById('auto-sync-main'));
const autoSyncDetail = /** @type {HTMLElement} */ (document.getElementById('auto-sync-detail'));
const btnClearAutoSyncSummary = /** @type {HTMLButtonElement} */ (document.getElementById('btn-clear-auto-sync-summary'));
const btnExtract = /** @type {HTMLButtonElement} */ (document.getElementById('btn-extract'));
const btnCSV = /** @type {HTMLButtonElement} */ (document.getElementById('btn-csv'));
const btnJSON = /** @type {HTMLButtonElement} */ (document.getElementById('btn-json'));
const btnDiagnose = /** @type {HTMLButtonElement} */ (document.getElementById('btn-diagnose'));
const btnOpenDownloadSettings = /** @type {HTMLButtonElement} */ (document.getElementById('btn-open-download-settings'));
const btnShowLastDownload = /** @type {HTMLButtonElement} */ (document.getElementById('btn-show-last-download'));
const optSaveAs = /** @type {HTMLInputElement} */ (document.getElementById('opt-save-as'));
const preview = /** @type {HTMLElement} */ (document.getElementById('preview'));
const previewContent = /** @type {HTMLElement} */ (document.getElementById('preview-content'));
const diagnostics = /** @type {HTMLDialogElement} */ (document.getElementById('diagnostics'));
const diagnosticsOutput = /** @type {HTMLElement} */ (document.getElementById('diagnostics-output'));
const serverDot = /** @type {HTMLElement} */ (document.getElementById('server-dot'));
const serverStatus = /** @type {HTMLElement} */ (document.getElementById('server-status'));
const lnkConfigureServer = /** @type {HTMLAnchorElement} */ (document.getElementById('lnk-configure-server'));
const btnSync = /** @type {HTMLButtonElement} */ (document.getElementById('btn-sync'));
const syncResult = /** @type {HTMLElement} */ (document.getElementById('sync-result'));
const DEFAULT_SERVER_URL = 'https://trends.pt-mes.com';
const LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY = 'latestAutoSyncSummaries';
const LEGACY_LATEST_AUTO_SYNC_SUMMARY_STORAGE_KEY = 'latestAutoSyncSummary';

// State
let lastDiagnosticDownloadId = null;
let serverConfigured = false;
let configuredServerUrl = '';
let runtimeStatusIntervalId = null;

function getPopupAutoSyncSummaryHelpers() {
    const helpers = globalThis.__TR_POPUP_AUTO_SYNC_SUMMARY__;
    return helpers && typeof helpers === 'object' ? helpers : null;
}

function getTargetTabIdOverride() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const rawTabId = params.get('tabId') || '';
        const parsedTabId = Number.parseInt(rawTabId, 10);
        return Number.isFinite(parsedTabId) && parsedTabId >= 0 ? parsedTabId : null;
    } catch {
        return null;
    }
}

async function getTargetTab() {
    const targetTabId = getTargetTabIdOverride();
    return targetTabId !== null
        ? chrome.tabs.get(targetTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

function getSourceKeyFromTabUrl(url) {
    const value = typeof url === 'string' ? url : '';
    if (!value) return '';
    if (value.includes('hr.job5156.com')) return 'job5156';
    if (value.includes('.employer.seek.com')) return 'seek';
    return '';
}

async function getPreferredStoredSummarySourceKey() {
    try {
        const tab = await getTargetTab();
        return getSourceKeyFromTabUrl(tab?.url);
    } catch {
        return '';
    }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    statusBar.className = `status-bar ${type}`;
    statusText.textContent = message;
    statusBar.classList.remove('hidden');

    if (type === 'success') {
        setTimeout(() => {
            statusBar.classList.add('hidden');
        }, 3000);
    }
}

/**
 * Send message to background service worker
 */
async function sendToBackground(action, data = {}) {
    return chrome.runtime.sendMessage({ action, ...data });
}

function storageLocalGet(defaults) {
    return new Promise((resolve) => {
        chrome.storage.local.get(defaults, (items) => resolve(items || {}));
    });
}

function storageLocalRemove(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.remove(keys, () => resolve());
    });
}

/**
 * Send message to content script
 */
async function sendToContent(action, data = {}) {
    const tab = await getTargetTab();

    if (!tab || typeof tab.id !== 'number') {
        throw new Error('No active tab');
    }

    if (!tab.url?.includes('hr.job5156.com') && !tab.url?.includes('.employer.seek.com')) {
        throw new Error('请在 Job5156 或 Seek 招聘页面使用');
    }

    try {
        return await chrome.tabs.sendMessage(tab.id, { action, ...data });
    } catch {
        throw new Error('请刷新页面后重试');
    }
}

function normalizeServerUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw ? raw.replace(/\/+$/, '') : '';
}


function showDiagnostics(payload) {
    if (!diagnostics || !diagnosticsOutput) return;
    diagnosticsOutput.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    diagnostics.classList.remove('hidden');
    diagnostics.open = true;
}

/**
 * Update pagination info display
 */
async function updatePaginationInfo() {
    try {
        const info = await sendToContent('getPaginationInfo');
        renderPagination(info);
    } catch (error) {
        console.error('Pagination error:', error);
    }
}

function renderPagination(pagination = {}) {
    pageCurrent.textContent = pagination.currentPage || '-';
    pageTotal.textContent = pagination.totalPages || '-';
    totalItems.textContent = pagination.totalItems || '-';
}

function hideAutoSyncSummary() {
    if (!autoSyncSummary || !autoSyncState || !autoSyncMain || !autoSyncDetail) return;
    autoSyncSummary.classList.add('hidden');
    autoSyncState.textContent = '-';
    autoSyncState.className = 'auto-sync-summary__badge';
    autoSyncMain.textContent = '';
    autoSyncDetail.textContent = '';
    if (btnClearAutoSyncSummary) {
        btnClearAutoSyncSummary.classList.add('hidden');
        btnClearAutoSyncSummary.disabled = false;
    }
}

async function getStoredAutoSyncSummary() {
    try {
        const helpers = getPopupAutoSyncSummaryHelpers();
        if (typeof helpers?.pickStoredAutoSyncSummary !== 'function') {
            return null;
        }

        const preferredSourceKey = await getPreferredStoredSummarySourceKey();
        const items = await storageLocalGet({
            [LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY]: {},
            [LEGACY_LATEST_AUTO_SYNC_SUMMARY_STORAGE_KEY]: null
        });
        const storedSummaries = items?.[LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY];
        const legacySummary = items?.[LEGACY_LATEST_AUTO_SYNC_SUMMARY_STORAGE_KEY];
        const normalizedStoredSummaries = storedSummaries && typeof storedSummaries === 'object' && !Array.isArray(storedSummaries)
            ? { ...storedSummaries }
            : {};

        if (legacySummary && typeof legacySummary === 'object' && !Array.isArray(legacySummary)) {
            const legacySourceKey = typeof legacySummary.sourceKey === 'string' && legacySummary.sourceKey
                ? legacySummary.sourceKey
                : 'unknown';
            if (!normalizedStoredSummaries[legacySourceKey]) {
                normalizedStoredSummaries[legacySourceKey] = legacySummary;
            }
        }

        return helpers.pickStoredAutoSyncSummary({
            summariesBySource: normalizedStoredSummaries,
            preferredSourceKey,
        });
    } catch (error) {
        console.error('Stored auto sync summary error:', error);
        return null;
    }
}

function renderAutoSyncSummary(status) {
    if (!autoSyncSummary || !autoSyncState || !autoSyncMain || !autoSyncDetail) return;
    const helpers = getPopupAutoSyncSummaryHelpers();
    const summary = typeof helpers?.buildAutoSyncSummary === 'function'
        ? helpers.buildAutoSyncSummary(status)
        : null;
    if (!summary) {
        hideAutoSyncSummary();
        return;
    }

    autoSyncSummary.classList.remove('hidden');
    autoSyncState.textContent = summary.stateLabel;
    autoSyncState.className = `auto-sync-summary__badge state-${summary.autoSync}`;
    autoSyncMain.textContent = summary.mainText;
    autoSyncDetail.textContent = summary.detailText;
    autoSyncDetail.classList.toggle('hidden', !summary.detailText);
    if (btnClearAutoSyncSummary) {
        btnClearAutoSyncSummary.classList.toggle('hidden', status?.summarySource !== 'stored');
        btnClearAutoSyncSummary.disabled = false;
    }
}

async function handleClearStoredAutoSyncSummary() {
    if (btnClearAutoSyncSummary) {
        btnClearAutoSyncSummary.disabled = true;
    }

    try {
        await storageLocalRemove([
            LATEST_AUTO_SYNC_SUMMARIES_STORAGE_KEY,
            LEGACY_LATEST_AUTO_SYNC_SUMMARY_STORAGE_KEY,
        ]);
        hideAutoSyncSummary();
        showStatus('已清除自动同步记录', 'success');
    } catch (error) {
        showStatus(error?.message || '清除记录失败', 'error');
        if (btnClearAutoSyncSummary) {
            btnClearAutoSyncSummary.disabled = false;
        }
    }
}

async function refreshRuntimeStatus() {
    try {
        const response = await sendToContent('getRuntimeStatus');
        if (!response?.success || !response.status) {
            const storedSummary = await getStoredAutoSyncSummary();
            if (storedSummary) {
                renderAutoSyncSummary(storedSummary);
            } else {
                hideAutoSyncSummary();
            }
            await updatePaginationInfo();
            return;
        }

        const status = response.status;
        if (status.pagination) {
            renderPagination(status.pagination);
        } else {
            await updatePaginationInfo();
        }
        if (status.autoSync && status.autoSync !== 'skipped') {
            renderAutoSyncSummary(status);
            return;
        }

        const storedSummary = await getStoredAutoSyncSummary();
        if (storedSummary) {
            renderAutoSyncSummary(storedSummary);
        } else {
            hideAutoSyncSummary();
        }
    } catch (error) {
        const storedSummary = await getStoredAutoSyncSummary();
        if (storedSummary) {
            renderAutoSyncSummary(storedSummary);
        } else {
            hideAutoSyncSummary();
        }
        console.error('Runtime status error:', error);
    }
}

function startRuntimeStatusPolling() {
    if (runtimeStatusIntervalId !== null) return;
    runtimeStatusIntervalId = window.setInterval(() => {
        refreshRuntimeStatus();
    }, 1500);
}

async function refreshServerConfig() {
    try {
        const response = await sendToBackground('getServerConfig');
        if (!response?.success) {
            serverConfigured = false;
            configuredServerUrl = '';
        } else {
            configuredServerUrl = normalizeServerUrl(response.serverUrl || DEFAULT_SERVER_URL);
            serverConfigured = !!configuredServerUrl && !!response.tokenSet;
        }
    } catch {
        serverConfigured = false;
        configuredServerUrl = '';
    }

    if (serverDot) {
        serverDot.classList.toggle('configured', serverConfigured);
    }
    if (serverStatus) {
        if (serverConfigured) serverStatus.textContent = `Server: ${configuredServerUrl}`;
        else if (configuredServerUrl) serverStatus.textContent = 'Token 未配置';
        else serverStatus.textContent = 'Server 未配置';
    }
    if (btnSync) {
        btnSync.disabled = !serverConfigured;
    }
}

function showSyncResultText(text) {
    if (!syncResult) return;
    syncResult.textContent = text;
    syncResult.classList.remove('hidden');
}

async function handleSyncToServer() {
    if (!btnSync) return;

    btnSync.disabled = true;
    if (syncResult) syncResult.classList.add('hidden');
    showStatus('正在同步到服务器...', 'info');

    try {
        const extractResponse = await sendToContent('extractCurrentPage');
        if (!extractResponse?.success) {
            throw new Error('提取失败');
        }

        const resumes = Array.isArray(extractResponse.data) ? extractResponse.data : [];
        const metadata = extractResponse?.metadata && typeof extractResponse.metadata === 'object' && !Array.isArray(extractResponse.metadata)
            ? extractResponse.metadata
            : null;

        if (!metadata) {
            throw new Error('无法读取页面同步元数据，请刷新页面后重试');
        }

        const response = await sendToBackground('syncToServer', { metadata, resumes });
        if (!response?.success) {
            throw new Error(response?.error || '同步失败');
        }

        const inserted = typeof response.inserted === 'number' ? response.inserted : 0;
        const updated = typeof response.updated === 'number' ? response.updated : 0;
        const unchanged = typeof response.unchanged === 'number' ? response.unchanged : 0;
        const submitted = typeof response.submitted === 'number' ? response.submitted : inserted + updated + unchanged;

        showSyncResultText(`Synced: ${inserted} new, ${updated} updated, ${unchanged} unchanged (total ${submitted})`);
        showStatus('✅ 同步完成', 'success');
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        await refreshServerConfig();
    }
}

async function handleDiagnose() {
    if (btnDiagnose) btnDiagnose.disabled = true;
    showStatus('正在诊断下载...', 'info');

    try {
        const response = await sendToBackground('diagnoseDownloads', { saveAs: !!optSaveAs?.checked });
        if (!response?.success) {
            showDiagnostics(response);
            showStatus(response?.error || '诊断失败', 'error');
            return;
        }

        const result = response.result || {};
        showDiagnostics(result);
        lastDiagnosticDownloadId = typeof result.downloadId === 'number' ? result.downloadId : null;
        if (btnShowLastDownload) btnShowLastDownload.disabled = !lastDiagnosticDownloadId;

        const item = result.downloadItem;
        if (!item) {
            showStatus('诊断完成（未读取到下载条目）', 'info');
            return;
        }

        if (item.state === 'complete') {
            showStatus(`✅ 下载测试成功：${item.filename || result.expectedFilename}`, 'success');
        } else if (item.state === 'interrupted') {
            showStatus(`❌ 下载中断：${item.error || 'UNKNOWN'}`, 'error');
        } else {
            showStatus(`⏳ 下载状态：${item.state}`, 'info');
        }
    } catch (error) {
        showDiagnostics({ success: false, error: error.message });
        showStatus(error.message, 'error');
    } finally {
        if (btnDiagnose) btnDiagnose.disabled = false;
    }
}

function handleShowLastDownload() {
    if (!lastDiagnosticDownloadId) {
        showStatus('请先运行“诊断下载”', 'error');
        return;
    }
    if (!chrome.downloads?.show) {
        showStatus('当前浏览器不支持显示文件', 'error');
        return;
    }
    try {
        chrome.downloads.show(lastDiagnosticDownloadId);
        showStatus('已尝试在 Finder 中显示文件', 'info');
    } catch {
        showStatus('显示文件失败', 'error');
    }
}

async function handleOpenDownloadSettings() {
    try {
        await chrome.tabs.create({ url: 'chrome://settings/downloads' });
    } catch {
        showStatus('无法自动打开，请手动访问 chrome://settings/downloads', 'error');
    }
}

/**
 * Show preview of extracted data
 */
function showPreview(resumes) {
    if (resumes.length === 0) {
        preview.classList.add('hidden');
        return;
    }

    const previewItems = resumes.slice(0, 3).map(r => `
    <div class="preview-item">
      <div class="name">${r.name || '未知'}</div>
      <div class="info">${r.age || '-'} | ${r.experience || '-'} | ${r.education || '-'}</div>
    </div>
  `).join('');

    previewContent.innerHTML = previewItems;
    preview.classList.remove('hidden');
}

/**
 * Extract resumes from current page
 */
async function handleExtract() {
    btnExtract.disabled = true;
    showStatus('正在提取...', 'info');

    try {
        const response = await sendToContent('extractCurrentPage');

        if (response.success) {
            const resumes = Array.isArray(response.data) ? response.data : [];
            showStatus(`✅ 成功提取 ${response.count} 条简历`, 'success');
            showPreview(resumes);

            if (response.pagination) {
                renderPagination(response.pagination);
            }
        } else {
            showStatus('提取失败', 'error');
        }
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        btnExtract.disabled = false;
    }
}

/**
 * Export as CSV - triggers download in content script (web page context)
 */
async function handleExportCSV() {
    btnCSV.disabled = true;
    showStatus('正在导出 CSV...', 'info');

    try {
        // Tell content script to extract and download CSV
        const response = await sendToContent('downloadCSV', { saveAs: !!optSaveAs?.checked });

        if (response.success) {
            showStatus(`✅ 已导出 ${response.count} 条简历`, 'success');
        } else {
            showStatus('导出失败', 'error');
        }
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        btnCSV.disabled = false;
    }
}

/**
 * Export as JSON - triggers download in content script (web page context)
 */
async function handleExportJSON() {
    btnJSON.disabled = true;
    showStatus('正在导出 JSON...', 'info');

    try {
        // Tell content script to extract and download JSON
        const response = await sendToContent('downloadJSON', { saveAs: !!optSaveAs?.checked });

        if (response.success) {
            showStatus(`✅ 已导出 ${response.count} 条简历`, 'success');
        } else {
            showStatus('导出失败', 'error');
        }
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        btnJSON.disabled = false;
    }
}

// Event Listeners
btnExtract.addEventListener('click', handleExtract);
btnCSV.addEventListener('click', handleExportCSV);
btnJSON.addEventListener('click', handleExportJSON);
if (btnDiagnose) btnDiagnose.addEventListener('click', handleDiagnose);
if (btnOpenDownloadSettings) btnOpenDownloadSettings.addEventListener('click', handleOpenDownloadSettings);
if (btnShowLastDownload) btnShowLastDownload.addEventListener('click', handleShowLastDownload);
if (btnSync) btnSync.addEventListener('click', handleSyncToServer);
if (btnClearAutoSyncSummary) btnClearAutoSyncSummary.addEventListener('click', handleClearStoredAutoSyncSummary);
if (lnkConfigureServer) {
    lnkConfigureServer.addEventListener('click', (event) => {
        event.preventDefault();
        try {
            chrome.runtime.openOptionsPage();
        } catch {
            // ignore
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    refreshServerConfig();

    if (optSaveAs) {
        chrome.storage.local.get({ saveAs: false }, (items) => {
            optSaveAs.checked = !!items.saveAs;
        });
        optSaveAs.addEventListener('change', () => {
            chrome.storage.local.set({ saveAs: !!optSaveAs.checked });
        });
    }

    sendToContent('ping')
        .then(() => {
            refreshRuntimeStatus();
            startRuntimeStatusPolling();
        })
        .catch(async () => {
            const storedSummary = await getStoredAutoSyncSummary();
            if (storedSummary) {
                renderAutoSyncSummary(storedSummary);
            } else {
                hideAutoSyncSummary();
            }
            updatePaginationInfo();
            showStatus('请刷新 Job5156 或 Seek 页面', 'error');
        });
});

window.addEventListener('unload', () => {
    if (runtimeStatusIntervalId !== null) {
        window.clearInterval(runtimeStatusIntervalId);
        runtimeStatusIntervalId = null;
    }
});
})();
