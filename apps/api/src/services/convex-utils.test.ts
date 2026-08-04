/**
 * Tests for convex-utils.ts — BFF-side Convex HTTP API helpers.
 *
 * Covers isConvexPaginatedQueryPage type guard and callConvexQuery/Mutation/Action
 * with mocked fetch for HTTP success and error paths.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  isConvexPaginatedQueryPage,
  callConvexQuery,
  callConvexMutation,
  callConvexAction,
} from "../services/convex-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isConvexPaginatedQueryPage
// ---------------------------------------------------------------------------

describe("isConvexPaginatedQueryPage", () => {
  it("returns true for valid paginated query page", () => {
    expect(isConvexPaginatedQueryPage({
      page: [{ _id: "r1" }],
      continueCursor: "abc123",
      isDone: false,
    })).toBe(true);
  });

  it("returns true for done page with empty results", () => {
    expect(isConvexPaginatedQueryPage({
      page: [],
      continueCursor: "",
      isDone: true,
    })).toBe(true);
  });

  it("returns false for non-record input", () => {
    expect(isConvexPaginatedQueryPage(null)).toBe(false);
    expect(isConvexPaginatedQueryPage("string")).toBe(false);
    expect(isConvexPaginatedQueryPage(undefined)).toBe(false);
  });

  it("returns false when page is not an array", () => {
    expect(isConvexPaginatedQueryPage({
      page: "not array",
      continueCursor: "abc",
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
      continueCursor: "",
      isDone: "yes",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// callConvexQuery
// ---------------------------------------------------------------------------

describe("callConvexQuery", () => {
  it("returns value on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", value: { items: [1, 2, 3] } }),
    }));

    const result = await callConvexQuery("resumes:list", { limit: 10 });
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "server error",
    }));

    await expect(callConvexQuery("resumes:list", {})).rejects.toThrow("Convex query returned 500");
  });

  it("throws on Convex API error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error", errorMessage: "Invalid query" }),
    }));

    await expect(callConvexQuery("resumes:list", {})).rejects.toThrow("Invalid query");
  });
});

// ---------------------------------------------------------------------------
// callConvexMutation
// ---------------------------------------------------------------------------

describe("callConvexMutation", () => {
  it("returns value on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", value: { id: "abc" } }),
    }));

    const result = await callConvexMutation("resumes:create", { name: "test" });
    expect(result).toEqual({ id: "abc" });
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "bad request",
    }));

    await expect(callConvexMutation("resumes:create", {})).rejects.toThrow("Convex mutation failed (400)");
  });
});

// ---------------------------------------------------------------------------
// callConvexAction
// ---------------------------------------------------------------------------

describe("callConvexAction", () => {
  it("returns value on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", value: { score: 85 } }),
    }));

    const result = await callConvexAction("analyze:analyzeResume", { resumeId: "r1" });
    expect(result).toEqual({ score: 85 });
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "gateway timeout",
    }));

    await expect(callConvexAction("analyze:analyzeResume", {})).rejects.toThrow("Convex action returned 502");
  });

  it("throws with default message when no errorMessage provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "error" }),
    }));

    await expect(callConvexAction("analyze:analyzeResume", {})).rejects.toThrow("Convex action failed for analyze:analyzeResume");
  });
});

// ---------------------------------------------------------------------------
// Retry on transient 5xx / connection errors
// ---------------------------------------------------------------------------

describe("fetchWithRetry (via callConvexQuery)", () => {
  it("retries on 5xx and succeeds on second attempt", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error", text: async () => "server error" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", value: "ok" }) });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callConvexQuery("resumes:list", {});
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on connection reset (fetch throws) and succeeds on retry", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", value: "ok" }) });
    vi.stubGlobal("fetch", mockFetch);

    const result = await callConvexQuery("resumes:list", {});
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx responses", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "bad request",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callConvexQuery("resumes:list", {})).rejects.toThrow("Convex query failed (400)");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 retries on persistent 5xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () => "unavailable",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(callConvexQuery("resumes:list", {})).rejects.toThrow("Convex query returned 503");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
