import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { resolveConvexUrl } from "../resume-import-service.js";
vi.mock("../resume-import-service.js", () => ({
  resolveConvexUrl: vi.fn(),
}));

import {
  callConvexAction,
  callConvexMutation,
  callConvexQuery,
  isConvexPaginatedQueryPage,
} from "../convex-utils.js";

const mockedResolveConvexUrl = resolveConvexUrl as ReturnType<typeof vi.fn>;

describe("convex-utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveConvexUrl.mockReturnValue("https://happy-otter-123.convex.cloud");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe("callConvexQuery", () => {
    it("sends POST to /api/query with path and args", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", value: { result: "ok" } }),
      });

      const result = await callConvexQuery("listResumes", { limit: 10 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://happy-otter-123.convex.cloud/api/query");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.headers["Accept"]).toBe("application/json");
      const body = JSON.parse(init.body);
      expect(body.path).toBe("listResumes");
      expect(body.args).toEqual({ limit: 10 });
      expect(result).toEqual({ result: "ok" });
    });

    it("strips trailing slash from Convex URL", async () => {
      mockedResolveConvexUrl.mockReturnValue("https://happy-otter-123.convex.cloud/");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", value: null }),
      });

      await callConvexQuery("ping", {});

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://happy-otter-123.convex.cloud/api/query");
    });

    it("throws on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        callConvexQuery("listResumes", {}),
      ).rejects.toThrow("Convex query failed (500): Internal Server Error");
    });

    it("throws on non-success status in payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "error", errorMessage: "path not found" }),
      });

      await expect(
        callConvexQuery("nonexistent", {}),
      ).rejects.toThrow("path not found");
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(
        callConvexQuery("listResumes", {}),
      ).rejects.toThrow("fetch failed");
    });
  });

  describe("callConvexMutation", () => {
    it("sends POST to /api/mutation with path and args", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", value: { id: "abc123" } }),
      });

      const result = await callConvexMutation("createResume", { name: "test" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://happy-otter-123.convex.cloud/api/mutation");
      expect(result).toEqual({ id: "abc123" });
    });

    it("throws on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

      await expect(
        callConvexMutation("createResume", {}),
      ).rejects.toThrow("Convex mutation failed (403): Forbidden");
    });

    it("throws on non-success status with fallback error message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "error" }),
      });

      await expect(
        callConvexMutation("badMutation", {}),
      ).rejects.toThrow("Convex mutation failed for badMutation");
    });
  });

  describe("callConvexAction", () => {
    it("sends POST to /api/action with path and args", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "success", value: { done: true } }),
      });

      const result = await callConvexAction("computeScore", { resumeId: "r1" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://happy-otter-123.convex.cloud/api/action");
      expect(result).toEqual({ done: true });
    });

    it("throws on non-ok HTTP response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      });

      await expect(
        callConvexAction("computeScore", {}),
      ).rejects.toThrow("Convex action failed (429): Too Many Requests");
    });

    it("throws on non-success status in payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "error", errorMessage: "rate limited" }),
      });

      await expect(
        callConvexAction("computeScore", {}),
      ).rejects.toThrow("rate limited");
    });
  });

  describe("isConvexPaginatedQueryPage", () => {
    it("returns true for valid paginated query page", () => {
      const result = isConvexPaginatedQueryPage({
        page: [{ id: "r1" }, { id: "r2" }],
        continueCursor: "cursor123",
        isDone: false,
      });

      expect(result).toBe(true);
    });

    it("returns true for done page with empty array", () => {
      const result = isConvexPaginatedQueryPage({
        page: [],
        continueCursor: "cursor456",
        isDone: true,
      });

      expect(result).toBe(true);
    });

    it("returns false for null", () => {
      expect(isConvexPaginatedQueryPage(null)).toBe(false);
    });

    it("returns false for non-object values", () => {
      expect(isConvexPaginatedQueryPage("string")).toBe(false);
      expect(isConvexPaginatedQueryPage(42)).toBe(false);
      expect(isConvexPaginatedQueryPage(undefined)).toBe(false);
    });

    it("returns false for arrays", () => {
      expect(isConvexPaginatedQueryPage([1, 2, 3])).toBe(false);
    });

    it("returns false when page is not an array", () => {
      expect(isConvexPaginatedQueryPage({
        page: "not-an-array",
        continueCursor: "cursor",
        isDone: false,
      })).toBe(false);
    });

    it("returns false when continueCursor is not a string", () => {
      expect(isConvexPaginatedQueryPage({
        page: [],
        continueCursor: 123,
        isDone: false,
      })).toBe(false);
    });

    it("returns false when isDone is not a boolean", () => {
      expect(isConvexPaginatedQueryPage({
        page: [],
        continueCursor: "cursor",
        isDone: "yes",
      })).toBe(false);
    });
  });
});
