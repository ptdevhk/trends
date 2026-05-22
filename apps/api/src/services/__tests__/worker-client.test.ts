import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock config to avoid reading env vars
vi.mock("../config.js", () => ({
  config: { workerUrl: "http://localhost:8000" },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { workerClient } from "../worker-client.js";

describe("workerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- getHealth() ---

  describe("getHealth", () => {
    it("returns success with health data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok", timestamp: "2026-05-22", version: "1.0" }),
      });
      const result = await workerClient.getHealth();
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("ok");
    });

    it("returns error for non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ message: "worker crashed" }),
      });
      const result = await workerClient.getHealth();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("HTTP_500");
      expect(result.error?.message).toBe("worker crashed");
    });

    it("falls back to statusText when error JSON has no message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => { throw new Error("no json"); },
      });
      const result = await workerClient.getHealth();
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Not Found");
    });
  });

  // --- isHealthy() ---

  describe("isHealthy", () => {
    it("returns true when status is ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "ok", timestamp: "2026-05-22", version: "1.0" }),
      });
      expect(await workerClient.isHealthy()).toBe(true);
    });

    it("returns false when status is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "degraded", timestamp: "2026-05-22", version: "1.0" }),
      });
      expect(await workerClient.isHealthy()).toBe(false);
    });

    it("returns false when request fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      expect(await workerClient.isHealthy()).toBe(false);
    });
  });

  // --- getTrends() ---

  describe("getTrends", () => {
    it("builds URL with multiple platform params", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, total: 0, data: [] }),
      });
      await workerClient.getTrends({ platform: ["weibo", "zhihu"], limit: 10 });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("platform=weibo");
      expect(calledUrl).toContain("platform=zhihu");
      expect(calledUrl).toContain("limit=10");
    });

    it("handles single platform string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, total: 0, data: [] }),
      });
      await workerClient.getTrends({ platform: "weibo" });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("platform=weibo");
    });

    it("returns TIMEOUT error on abort", async () => {
      mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
      const result = await workerClient.getTrends({ limit: 10 });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("TIMEOUT");
    });

    it("returns NETWORK_ERROR on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const result = await workerClient.getTrends({});
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NETWORK_ERROR");
    });
  });

  // --- getTrendById() ---

  describe("getTrendById", () => {
    it("encodes the ID in the URL path", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { title: "test" } }),
      });
      await workerClient.getTrendById("trend/123", "2026-05-22");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("/trends/trend%2F123");
      expect(calledUrl).toContain("date=2026-05-22");
    });
  });

  // --- searchNews() ---

  describe("searchNews", () => {
    it("builds search URL with query and filters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, total: 0, total_found: 0, results: [], statistics: {} }),
      });
      await workerClient.searchNews({ q: "CNC", platform: ["weibo"], start_date: "2026-05-01", limit: 20 });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("q=CNC");
      expect(calledUrl).toContain("platform=weibo");
      expect(calledUrl).toContain("start_date=2026-05-01");
      expect(calledUrl).toContain("limit=20");
    });

    it("handles non-ok response with fallback statusText", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => { throw new Error("no json"); },
      });
      const result = await workerClient.searchNews({ q: "test" });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("HTTP_422");
    });
  });
});
