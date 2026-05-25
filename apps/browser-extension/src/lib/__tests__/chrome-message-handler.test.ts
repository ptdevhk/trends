/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChromeMessageHandler, type ChromeMessageHandlerDeps } from "../chrome-message-handler.js";

function createMockDeps(overrides: Partial<ChromeMessageHandlerDeps> = {}): ChromeMessageHandlerDeps {
  return {
    extractResumes: vi.fn(() => [{ name: "Alice" }]),
    getPaginationInfo: vi.fn(() => ({ page: 1, total: 10 })),
    buildSubmitMetadata: vi.fn(() => ({ source: "test" })),
    resumesToCSV: vi.fn(() => "name\nAlice"),
    makeRandomId: vi.fn(() => "abc123"),
    downloadFile: vi.fn(async () => {}),
    buildExportMetadata: vi.fn(() => ({ exportMeta: true })),
    buildExportFilename: vi.fn(() => "resumes_test.json"),
    getExternalAccessorStatus: vi.fn(() => ({ status: "ready" })),
    ...overrides,
  };
}

function sendMessage(action: string, extra: Record<string, unknown> = {}) {
  const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  if (!listener) throw new Error("No listener registered");
  const sendResponse = vi.fn();
  const result = listener({ action, ...extra }, {}, sendResponse);
  return { sendResponse, returnResult: result };
}

describe("createChromeMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    });
  });

  it("returns object with installChromeMessageListener function", () => {
    const handler = createChromeMessageHandler(createMockDeps());
    expect(typeof handler.installChromeMessageListener).toBe("function");
  });

  it("registers a listener when installChromeMessageListener is called", () => {
    const handler = createChromeMessageHandler(createMockDeps());
    handler.installChromeMessageListener();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it("handles extractCurrentPage action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("extractCurrentPage");
    expect(deps.extractResumes).toHaveBeenCalled();
    expect(deps.getPaginationInfo).toHaveBeenCalled();
    expect(deps.buildSubmitMetadata).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      data: [{ name: "Alice" }],
      count: 1,
      pagination: { page: 1, total: 10 },
      metadata: { source: "test" },
    });
  });

  it("handles downloadCSV action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse, returnResult } = sendMessage("downloadCSV", { saveAs: true });
    expect(deps.resumesToCSV).toHaveBeenCalledWith([{ name: "Alice" }]);
    expect(deps.makeRandomId).toHaveBeenCalled();
    expect(deps.downloadFile).toHaveBeenCalledWith("name\nAlice", expect.stringMatching(/^resumes_\d{4}-\d{2}-\d{2}_abc123\.csv$/), "text/csv", true);
    expect(returnResult).toBe(true); // async channel kept open
  });

  it("resolves downloadCSV sendResponse on success", async () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("downloadCSV");
    // Allow microtask to flush
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true, count: 1, filename: expect.stringMatching(/^resumes_\d{4}-\d{2}-\d{2}_abc123\.csv$/) });
    });
  });

  it("resolves downloadCSV sendResponse on failure", async () => {
    const deps = createMockDeps({
      downloadFile: vi.fn(async () => { throw new Error("disk full"); }),
    });
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("downloadCSV");
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "disk full" });
    });
  });

  it("handles downloadJSON action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse, returnResult } = sendMessage("downloadJSON", { saveAs: false });
    expect(deps.buildExportMetadata).toHaveBeenCalledWith([{ name: "Alice" }]);
    expect(deps.buildExportFilename).toHaveBeenCalled();
    expect(returnResult).toBe(true); // async channel kept open
  });

  it("resolves downloadJSON sendResponse on success", async () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("downloadJSON");
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true, count: 1, filename: "resumes_test.json" });
    });
  });

  it("resolves downloadJSON sendResponse on failure", async () => {
    const deps = createMockDeps({
      downloadFile: vi.fn(async () => { throw new Error("network error"); }),
    });
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("downloadJSON");
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: "network error" });
    });
  });

  it("handles getPaginationInfo action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("getPaginationInfo");
    expect(deps.getPaginationInfo).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ page: 1, total: 10 });
  });

  it("handles getRuntimeStatus action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("getRuntimeStatus");
    expect(deps.getExternalAccessorStatus).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true, status: { status: "ready" } });
  });

  it("handles ping action", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { sendResponse } = sendMessage("ping");
    expect(sendResponse).toHaveBeenCalledWith({ success: true, message: "Content script loaded" });
  });

  it("returns true for unknown actions to keep channel open", () => {
    const deps = createMockDeps();
    const handler = createChromeMessageHandler(deps);
    handler.installChromeMessageListener();

    const { returnResult } = sendMessage("unknownAction");
    expect(returnResult).toBe(true);
  });
});
