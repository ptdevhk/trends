/**
 * 智通直聘 Resume Collector - Popup Script
 * v1.0.0 - Adds download diagnostics + Save As option
 */

// DOM Elements
const statusBar = /** @type {HTMLElement} */ (document.getElementById('status-bar'));
const statusText = /** @type {HTMLElement} */ (document.getElementById('status-text'));
const pageCurrent = /** @type {HTMLElement} */ (document.getElementById('page-current'));
const pageTotal = /** @type {HTMLElement} */ (document.getElementById('page-total'));
const totalItems = /** @type {HTMLElement} */ (document.getElementById('total-items'));
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

// State
let extractedData = [];
let lastDiagnosticDownloadId = null;
let serverConfigured = false;
let configuredServerUrl = '';

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

/**
 * Send message to content script
 */
async function sendToContent(action, data = {}) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number') {
        throw new Error('No active tab');
    }

    if (!tab.url?.includes('hr.job5156.com')) {
        throw new Error('请在 hr.job5156.com/search 页面使用');
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

function getExtensionGeneratedBy() {
    let generatedBy = 'browser-extension';
    try {
        const version = chrome?.runtime?.getManifest?.().version;
        if (version) generatedBy = `browser-extension@${version}`;
    } catch {
        // ignore
    }
    return generatedBy;
}

async function getActiveTabUrl() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) throw new Error('No active tab URL');
    if (!tab.url.includes('hr.job5156.com')) {
        throw new Error('请在 hr.job5156.com/search 页面使用');
    }
    return tab.url;
}

function buildSubmitMetadata(sourceUrl) {
    const metadata = {
        sourceUrl,
        generatedBy: getExtensionGeneratedBy(),
    };

    try {
        const url = new URL(sourceUrl);
        const keyword = (url.searchParams.get('keyword') || '').trim();
        const location = (url.searchParams.get('location') || '').trim();
        if (keyword) metadata.keyword = keyword;
        if (location) metadata.location = location;
    } catch {
        // ignore
    }

    return metadata;
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
        pageCurrent.textContent = info.currentPage || '-';
        pageTotal.textContent = info.totalPages || '-';
        totalItems.textContent = info.totalItems || '-';
    } catch (error) {
        console.error('Pagination error:', error);
    }
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
        const sourceUrl = await getActiveTabUrl();
        const metadata = buildSubmitMetadata(sourceUrl);

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
            extractedData = response.data;
            showStatus(`✅ 成功提取 ${response.count} 条简历`, 'success');
            showPreview(extractedData);

            if (response.pagination) {
                pageCurrent.textContent = response.pagination.currentPage || '-';
                pageTotal.textContent = response.pagination.totalPages || '-';
                totalItems.textContent = response.pagination.totalItems || '-';
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
    updatePaginationInfo();
    refreshServerConfig();

    if (optSaveAs) {
        chrome.storage.local.get({ saveAs: false }, (items) => {
            optSaveAs.checked = !!items.saveAs;
        });
        optSaveAs.addEventListener('change', () => {
            chrome.storage.local.set({ saveAs: !!optSaveAs.checked });
        });
    }

    sendToContent('ping').catch(() => {
        showStatus('请刷新 hr.job5156.com 页面', 'error');
    });
});
