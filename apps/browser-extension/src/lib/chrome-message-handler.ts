export interface ChromeMessageHandlerDeps {
  extractResumes: () => unknown[];
  getPaginationInfo: () => unknown;
  buildSubmitMetadata: () => unknown;
  resumesToCSV: (resumes: unknown[]) => string;
  makeRandomId: () => string;
  downloadFile: (content: string, filename: string, mimeType: string, saveAs: boolean) => Promise<void>;
  buildExportMetadata: (resumes: unknown[]) => unknown;
  buildExportFilename: () => string;
  getExternalAccessorStatus: () => Record<string, unknown>;
}

export function createChromeMessageHandler(deps: ChromeMessageHandlerDeps) {
  const {
    extractResumes,
    getPaginationInfo,
    buildSubmitMetadata,
    resumesToCSV,
    makeRandomId,
    downloadFile,
    buildExportMetadata,
    buildExportFilename,
    getExternalAccessorStatus,
  } = deps;

  function installChromeMessageListener() {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
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
  }

  return { installChromeMessageListener };
}
