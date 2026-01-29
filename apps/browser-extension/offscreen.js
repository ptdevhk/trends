/**
 * 智通直聘 Resume Collector - Offscreen Document Script
 * Handles blob URL creation for file downloads
 * v1.0.0
 *
 * This offscreen document provides DOM access for creating blob URLs,
 * which is not possible in service workers (background.js).
 */

console.log('🎯 [OFFSCREEN] Offscreen document loaded');

// Store blob URLs for cleanup
const blobUrls = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('🎯 [OFFSCREEN] Received message:', message.action);

    if (message.action === 'createBlobUrl') {
        try {
            const { content, mimeType, downloadId } = message;

            // Create blob with the content
            const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);

            console.log('🎯 [OFFSCREEN] Created blob URL:', blobUrl.substring(0, 50) + '...');

            // Store for potential cleanup
            if (downloadId) {
                blobUrls.set(downloadId, blobUrl);
            }

            sendResponse({ success: true, blobUrl });
        } catch (error) {
            console.error('🎯 [OFFSCREEN] Error creating blob URL:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    if (message.action === 'revokeBlobUrl') {
        try {
            const { blobUrl, downloadId } = message;

            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
                console.log('🎯 [OFFSCREEN] Revoked blob URL');
            }

            if (downloadId && blobUrls.has(downloadId)) {
                URL.revokeObjectURL(blobUrls.get(downloadId));
                blobUrls.delete(downloadId);
            }

            sendResponse({ success: true });
        } catch (error) {
            console.error('🎯 [OFFSCREEN] Error revoking blob URL:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    return false;
});
