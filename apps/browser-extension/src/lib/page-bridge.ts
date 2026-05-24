import {
  PAGE_BRIDGE_REQUEST_ATTR,
  PAGE_BRIDGE_REQUEST_EVENT,
  PAGE_BRIDGE_RESPONSE_ATTR,
  PAGE_BRIDGE_RESPONSE_EVENT,
  EXTERNAL_ACCESS_KEY,
} from "./content-constants";

export interface PageBridgeDeps {
  doc: Document;
  win: Window & { [EXTERNAL_ACCESS_KEY]?: { status?: () => unknown } };
  extractResumes: () => unknown;
  extractResumesRaw: (mode?: unknown) => unknown;
  collectSnapshotPayload: (options?: unknown) => Promise<unknown>;
  getApiSnapshot: () => unknown;
  getPaginationInfo: () => unknown;
  isExtractionReady: () => boolean;
  isLoggedIn: () => boolean;
  syncCurrentPageToServer: (resumes?: unknown) => Promise<unknown>;
  goToNextPageInternal: () => unknown;
}

export function createPageBridge(deps: PageBridgeDeps) {
  const {
    doc,
    win,
    extractResumes,
    extractResumesRaw,
    collectSnapshotPayload,
    getApiSnapshot,
    getPaginationInfo,
    isExtractionReady,
    isLoggedIn,
    syncCurrentPageToServer,
    goToNextPageInternal,
  } = deps;

  function installPageBridgeListener() {
    win.addEventListener(PAGE_BRIDGE_REQUEST_EVENT, async () => {
      const requestPayload = doc.documentElement.getAttribute(
        PAGE_BRIDGE_REQUEST_ATTR,
      );
      if (!requestPayload) return;

      let response = {
        id: null as unknown,
        ok: false,
        error: "Invalid bridge request",
        value: undefined as unknown,
      };

      try {
        const request = JSON.parse(requestPayload);
        const requestId = request?.id ?? null;
        const method =
          typeof request?.method === "string" ? request.method : "";
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
            response = {
              id: requestId,
              ok: true,
              error: "",
              value: getApiSnapshot(),
            };
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
            response = {
              id: requestId,
              ok: true,
              error: "",
              value: isLoggedIn(),
            };
            break;
          case "status":
            response = {
              id: requestId,
              ok: true,
              error: "",
              value: win[EXTERNAL_ACCESS_KEY]?.status?.(),
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

      doc.documentElement.setAttribute(
        PAGE_BRIDGE_RESPONSE_ATTR,
        JSON.stringify(response),
      );
      win.dispatchEvent(new CustomEvent(PAGE_BRIDGE_RESPONSE_EVENT));
    });
  }

  return { installPageBridgeListener };
}
