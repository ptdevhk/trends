/**
 * 智通直聘 Resume Collector - Background Service Worker
 * Handles file downloads using Chrome Downloads API with Offscreen Documents
 * v1.0.0 - Adds download diagnostics + safer revoke timing
 *
 * Research: Data URLs ignore the filename parameter in chrome.downloads.download()
 * Solution: Use offscreen document to create blob URLs, which respect filenames
 * See: https://issues.chromium.org/issues/40706258
 */

console.log('🎯 [BG] Resume Collector background script loading...');

// Offscreen document URL
const OFFSCREEN_URL = 'offscreen.html';

// Track if we're creating the offscreen document (prevent race conditions)
let creatingOffscreen = null;

// Track blob URLs so we can revoke them after downloads complete.
const blobUrlsByDownloadId = new Map();

// Map download URL -> desired filename (used by onDeterminingFilename).
const desiredFilenameByUrl = new Map();

/**
 * Chrome downloads API does NOT allow writing to an absolute filesystem path.
 * It expects a filename relative to the browser's configured download directory.
 */
function sanitizeDownloadFilename(filename) {
    if (typeof filename !== 'string') return 'download.txt';
    let name = filename.trim();
    if (!name) return 'download.txt';

    // Normalize separators.
    name = name.replace(/\\/g, '/');

    // If the caller accidentally passed an absolute path, keep only the basename.
    if (name.startsWith('/') || /^[A-Za-z]:\//.test(name)) {
        name = name.split('/').pop() || 'download.txt';
    }

    // Prevent path traversal segments; allow safe subdirectories.
    const parts = name
        .split('/')
        .filter((p) => p && p !== '.' && p !== '..')
        .map((p) => p.replace(/[<>:"|?*\u0000-\u001F]/g, '-'));
    name = parts.join('/');

    // No leading slashes.
    name = name.replace(/^\/+/, '');

    return name || 'download.txt';
}

function getBasename(path) {
    const normalized = typeof path === 'string' ? path.replace(/\\/g, '/') : '';
    return normalized.split('/').pop() || '';
}

// Enforce safe filenames for downloads initiated by this extension (helps with macOS quirks).
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    try {
        if (downloadItem?.byExtensionId !== chrome.runtime.id) return;
        const desired = desiredFilenameByUrl.get(downloadItem.url);
        if (desired) desiredFilenameByUrl.delete(downloadItem.url);
        const base = sanitizeDownloadFilename(getBasename(desired || downloadItem.filename || 'download.txt'));
        suggest({ filename: base, conflictAction: 'uniquify' });
    } catch (error) {
        console.warn('🎯 [BG] onDeterminingFilename error:', error);
    }
});

// Revoke blob URLs when downloads finish. Revoking too early can cause "missing file" on macOS.
chrome.downloads.onChanged.addListener((delta) => {
    try {
        if (!delta?.state) return;
        if (delta.state.current !== 'complete' && delta.state.current !== 'interrupted') return;
        const blobUrl = blobUrlsByDownloadId.get(delta.id);
        if (!blobUrl) return;
        blobUrlsByDownloadId.delete(delta.id);
        sendToOffscreen({ action: 'revokeBlobUrl', blobUrl }).catch((err) =>
            console.warn('🎯 [BG] Failed to revoke blob URL on download change:', err)
        );
    } catch (error) {
        console.warn('🎯 [BG] onChanged error:', error);
    }
});

/**
 * Ensure offscreen document exists, create if needed
 */
async function ensureOffscreenDocument() {
    // Check if already exists (API availability varies by Chromium version).
    try {
        if (typeof chrome.runtime.getContexts === 'function') {
            const contexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
            });

            if (contexts.length > 0) {
                console.log('🎯 [BG] Offscreen document already exists');
                return;
            }
        }
    } catch (error) {
        console.warn('🎯 [BG] Failed to check offscreen context; will attempt create:', error);
    }

    if (!chrome.offscreen?.createDocument) {
        throw new Error('Offscreen documents are not supported in this browser version');
    }

    // If we're already creating one, wait for it
    if (creatingOffscreen) {
        console.log('🎯 [BG] Waiting for offscreen document creation...');
        await creatingOffscreen;
        return;
    }

    // Create the offscreen document
    console.log('🎯 [BG] Creating offscreen document...');
    creatingOffscreen = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Create blob URLs for file downloads with proper filenames'
    });

    try {
        await creatingOffscreen;
        console.log('🎯 [BG] Offscreen document created successfully');
    } catch (error) {
        // Some Chromium versions throw if an offscreen document already exists.
        const msg = error?.message ? String(error.message) : String(error);
        if (msg.includes('Only a single offscreen') || msg.includes('already exists')) {
            console.log('🎯 [BG] Offscreen document already exists (createDocument raced)');
            return;
        }
        throw error;
    } finally {
        creatingOffscreen = null;
    }
}

/**
 * Send message to offscreen document and wait for response
 */
async function sendToOffscreen(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response?.success) {
                resolve(response);
            } else {
                reject(new Error(response?.error || 'Unknown error from offscreen'));
            }
        });
    });
}

function downloadsSearch(query) {
    return new Promise((resolve) => {
        chrome.downloads.search(query, (items) => resolve(items || []));
    });
}

function permissionsContains(permissions) {
    return new Promise((resolve) => {
        if (!chrome.permissions?.contains) {
            resolve(null);
            return;
        }
        chrome.permissions.contains({ permissions }, (result) => resolve(!!result));
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDownload({ content, filename, mimeType, saveAs }) {
    const safeFilename = sanitizeDownloadFilename(filename);
    const safeMimeType = typeof mimeType === 'string' && mimeType.trim() ? mimeType.trim() : 'text/plain';
    const normalizedContent = typeof content === 'string' ? content : String(content ?? '');
    const shouldAddBom = safeMimeType === 'text/csv' || safeFilename.toLowerCase().endsWith('.csv');
    const fullContent = shouldAddBom ? '\ufeff' + normalizedContent : normalizedContent;

    let downloadUrl;
    let method = 'data';
    let blobUrlToRevoke = null;

    try {
        await ensureOffscreenDocument();
        const { blobUrl } = await sendToOffscreen({
            action: 'createBlobUrl',
            content: fullContent,
            mimeType: safeMimeType
        });
        downloadUrl = blobUrl;
        method = 'blob';
        blobUrlToRevoke = blobUrl;
    } catch (error) {
        console.warn('🎯 [BG] Blob URL path failed; falling back to data URL:', error);
        downloadUrl = `data:${safeMimeType};charset=utf-8,${encodeURIComponent(fullContent)}`;
    }

    // Ensure we can override filename reliably even if Chrome ignores the "filename" param.
    // Avoid storing large data URLs as keys.
    if (method === 'blob') desiredFilenameByUrl.set(downloadUrl, safeFilename);

    const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
            {
                url: downloadUrl,
                filename: safeFilename,
                saveAs: !!saveAs,
                conflictAction: 'uniquify'
            },
            (id) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(id);
            }
        );
    });

    if (method === 'blob' && blobUrlToRevoke) {
        blobUrlsByDownloadId.set(downloadId, blobUrlToRevoke);
    }

    return { downloadId, safeFilename, safeMimeType, method };
}

// Listen for messages from content script / popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request?.action;
    if (!action) return false;

    console.log('🎯 [BG] Received message:', request.action);

    if (request.action === 'downloadFile') {
        const { content, filename, mimeType, saveAs } = request;

        console.log('🎯 [BG] Download request:', { filename, mimeType, saveAs: !!saveAs, contentLength: content?.length });

        // Handle async operation
        (async () => {
            try {
                const { downloadId, safeFilename, method } = await startDownload({ content, filename, mimeType, saveAs });
                console.log('🎯 [BG] Download SUCCESS, ID:', downloadId, 'method:', method);
                sendResponse({ success: true, downloadId, filename: safeFilename, method });
            } catch (error) {
                console.error('🎯 [BG] Exception:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();

        return true; // Keep channel open for async response
    }

    if (request.action === 'diagnoseDownloads') {
        const saveAs = !!request.saveAs;
        (async () => {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const expectedFilename = `resumes_download_test_${timestamp}.txt`;
                const content = [
                    'Trends download test',
                    `time: ${new Date().toISOString()}`,
                    'If you can read this file, chrome.downloads is working.',
                    ''
                ].join('\n');

                const startedAt = Date.now();
                const { downloadId, safeFilename, method } = await startDownload({
                    content,
                    filename: expectedFilename,
                    mimeType: 'text/plain',
                    saveAs
                });

                // Poll download state briefly (keeps service worker alive while responding).
                let item = (await downloadsSearch({ id: downloadId }))[0] || null;
                const maxWaitMs = saveAs ? 60000 : 15000;
                while (item && item.state === 'in_progress' && Date.now() - startedAt < maxWaitMs) {
                    await sleep(300);
                    item = (await downloadsSearch({ id: downloadId }))[0] || null;
                }

                const actualBasename = item?.filename ? getBasename(item.filename) : '';
                const expectedBasename = getBasename(safeFilename);
                const filenameOk = !actualBasename || actualBasename === expectedBasename;

                const hints = [];
                hints.push('扩展不能写入 /Users/... 这类绝对路径；只能写到浏览器的默认下载目录。');
                if (method !== 'blob') {
                    hints.push('当前浏览器可能不支持 offscreen blob 下载；文件名更容易被忽略。建议升级 Chrome/Edge。');
                }
                if (saveAs) {
                    hints.push('你开启了“每次下载前选择位置”；如果取消保存，下载会失败或显示为中断。');
                } else {
                    hints.push('当前为静默下载：会保存到 Chrome 设置的默认下载位置。');
                    hints.push('如遇文件名变成随机 ID，建议在 chrome://settings/downloads 关闭“下载前询问每个文件的保存位置”。');
                }
                if (item?.state === 'interrupted') {
                    hints.push(`下载中断：${item.error || 'UNKNOWN'}`);
                    if (item.error === 'FILE_ACCESS_DENIED') {
                        hints.push('可能是 macOS 文件夹权限：系统设置 → 隐私与安全性 → 文件与文件夹，给 Chrome 允许访问“下载”。');
                    }
                }
                if (item?.state === 'complete' && item?.exists === false) {
                    hints.push('Chrome 显示下载完成但文件不存在：通常是被系统/安全软件拦截删除，或下载目录没有写入权限。');
                    hints.push('请在 chrome://downloads 点击“在 Finder 中显示”，看是否提示找不到文件。');
                }
                if (!filenameOk) {
                    hints.push(`文件名未按预期生效：期望 ${expectedBasename}，实际 ${actualBasename || '(unknown)'}`);
                }
                if (item?.state === 'in_progress' && !saveAs) {
                    hints.push('下载长时间 in_progress：可能被下载前询问/权限弹窗阻塞，或下载目录不可写。');
                }

                const permissions = {
                    downloads: await permissionsContains(['downloads']),
                    offscreen: await permissionsContains(['offscreen'])
                };
                const runtimeInfo = {
                    offscreenSupported: !!chrome.offscreen?.createDocument,
                    getContextsSupported: typeof chrome.runtime.getContexts === 'function'
                };

                sendResponse({
                    success: true,
                    result: {
                        downloadId,
                        method,
                        saveAs,
                        expectedFilename: expectedBasename,
                        permissions,
                        runtimeInfo,
                        downloadItem: item,
                        filenameOk,
                        hints
                    }
                });
            } catch (error) {
                console.error('🎯 [BG] Diagnose exception:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();

        return true;
    }

    return false;
});

console.log('🎯 [BG] Resume Collector background script v1.0.0 ready');
