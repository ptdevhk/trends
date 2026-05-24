/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPageBridge, type PageBridgeDeps } from "../page-bridge.js";

function createMockDeps(overrides: Partial<PageBridgeDeps> = {}): PageBridgeDeps {
  return {
    doc: document,
    win: window as PageBridgeDeps["win"],
    extractResumes: vi.fn(() => [{ name: "Alice" }]),
    extractResumesRaw: vi.fn(() => [{ raw: true }]),
    collectSnapshotPayload: vi.fn(async () => ({ snapshot: true })),
    getApiSnapshot: vi.fn(() => ({ api: true })),
    getPaginationInfo: vi.fn(() => ({ page: 1, total: 10 })),
    isExtractionReady: vi.fn(() => true),
    isLoggedIn: vi.fn(() => true),
    syncCurrentPageToServer: vi.fn(async () => ({ synced: true })),
    goToNextPageInternal: vi.fn(() => ({ next: true })),
    ...overrides,
  };
}

function dispatchBridgeRequest(payload: Record<string, unknown>) {
  document.documentElement.setAttribute(
    "data-tr-resume-bridge-request",
    JSON.stringify(payload),
  );
  window.dispatchEvent(new CustomEvent("trResumeBridgeRequest"));
}

function getLastBridgeResponse(): Record<string, unknown> | null {
  const raw = document.documentElement.getAttribute("data-tr-resume-bridge-response");
  if (!raw) return null;
  return JSON.parse(raw);
}

describe("createPageBridge", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-tr-resume-bridge-request");
    document.documentElement.removeAttribute("data-tr-resume-bridge-response");
  });

  it("dispatches listener and responds to extract method", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 1, method: "extract", args: [] });

    const response = getLastBridgeResponse();
    expect(response).not.toBeNull();
    expect(response!.id).toBe(1);
    expect(response!.ok).toBe(true);
    expect(response!.error).toBe("");
    expect(deps.extractResumes).toHaveBeenCalled();
  });

  it("responds to extractRaw method with args[0] as mode", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 2, method: "extractRaw", args: ["full"] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.extractResumesRaw).toHaveBeenCalledWith("full");
  });

  it("responds to collect method with await", async () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 3, method: "collect", args: [{ deep: true }] });

    // collectSnapshotPayload is async — wait for microtask
    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.collectSnapshotPayload).toHaveBeenCalledWith({ deep: true });
  });

  it("responds to isReady method", () => {
    const deps = createMockDeps({ isExtractionReady: vi.fn(() => false) });
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 4, method: "isReady", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(response!.value).toBe(false);
  });

  it("responds to isLoggedIn method", () => {
    const deps = createMockDeps({ isLoggedIn: vi.fn(() => true) });
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 5, method: "isLoggedIn", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(response!.value).toBe(true);
  });

  it("responds to status method via external access key", () => {
    const mockStatus = vi.fn(() => ({ page: 3, total: 100 }));
    const deps = createMockDeps();
    (deps.win as unknown as Record<string, unknown>)["__TR_RESUME_DATA__"] = { status: mockStatus };
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 6, method: "status", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(response!.value).toEqual({ page: 3, total: 100 });
    expect(mockStatus).toHaveBeenCalled();
  });

  it("responds to syncToServer method with await", async () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 7, method: "syncToServer", args: [{ force: true }] });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.syncCurrentPageToServer).toHaveBeenCalledWith({ force: true });
  });

  it("responds to goToNextPage method", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 8, method: "goToNextPage", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.goToNextPageInternal).toHaveBeenCalled();
  });

  it("responds to getApiSnapshot method", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 9, method: "getApiSnapshot", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.getApiSnapshot).toHaveBeenCalled();
  });

  it("responds to getPaginationInfo method", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 10, method: "getPaginationInfo", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(true);
    expect(deps.getPaginationInfo).toHaveBeenCalled();
  });

  it("returns error for unsupported method", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 11, method: "unknownMethod", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(false);
    expect(response!.error).toContain("Unsupported bridge method: unknownMethod");
  });

  it("returns error when method is missing", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 12, args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(false);
    expect(response!.error).toContain("Missing bridge method");
  });

  it("returns error when request attribute is missing", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    // Dispatch event without setting request attribute
    window.dispatchEvent(new CustomEvent("trResumeBridgeRequest"));

    // No response should be set
    const raw = document.documentElement.getAttribute("data-tr-resume-bridge-response");
    expect(raw).toBeNull();
  });

  it("catches and reports handler errors", () => {
    const deps = createMockDeps({
      extractResumes: vi.fn(() => {
        throw new Error("extraction failed");
      }),
    });
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ id: 13, method: "extract", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.ok).toBe(false);
    expect(response!.error).toBe("extraction failed");
    expect(response!.id).toBe(13);
  });

  it("uses null id when request has no id field", () => {
    const deps = createMockDeps();
    const bridge = createPageBridge(deps);
    bridge.installPageBridgeListener();

    dispatchBridgeRequest({ method: "isReady", args: [] });

    const response = getLastBridgeResponse();
    expect(response!.id).toBeNull();
    expect(response!.ok).toBe(true);
  });
});
