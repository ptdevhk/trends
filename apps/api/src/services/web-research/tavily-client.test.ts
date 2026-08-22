/**
 * Tests for tavily-client.ts — Tavily /search HTTP client with
 * AbortController timeout, error mapping, and response validation.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { createTavilySearch, type TavilySearchConfig } from "./tavily-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeConfig(overrides: Partial<TavilySearchConfig> = {}): TavilySearchConfig {
  return {
    tavilyApiKey: "test-key",
    tavilyBaseUrl: "http://tv.test",
    timeoutMs: 15000,
    ...overrides,
  };
}

describe("createTavilySearch", () => {
  it("posts the expected payload and returns parsed results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          query: "富泰精机 主营 行业",
          results: [
            {
              title: "富泰精机官网",
              url: "https://www.futai.com/",
              content: "富泰精机 数控 机床",
              score: 0.95,
            },
          ],
          responseTime: 120,
        }),
        { status: 200 },
      ),
    );

    const search = createTavilySearch(makeConfig());
    const result = await search("富泰精机 主营 行业");

    expect(fetchMock).toHaveBeenCalledWith("http://tv.test/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: "test-key",
        query: "富泰精机 主营 行业",
        search_depth: "basic",
        max_results: 10,
        include_answer: false,
      }),
      signal: expect.any(AbortSignal) as unknown,
    });
    expect(result.query).toBe("富泰精机 主营 行业");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: "富泰精机官网",
      url: "https://www.futai.com/",
      content: "富泰精机 数控 机床",
    });
    expect(result.responseTime).toBe(120);
  });

  it("throws a mapped error on non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const search = createTavilySearch(makeConfig());
    await expect(search("富泰精机 主营 行业")).rejects.toThrow("Tavily search failed: HTTP 401");
  });

  it("throws a timeout error when the request is aborted", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const search = createTavilySearch(makeConfig({ timeoutMs: 15000 }));
    const promise = search("富泰精机 主营 行业");
    // Attach the rejection handler before the timer fires so the rejection is
    // consumed by the assertion rather than surfacing as unhandled.
    const assertion = expect(promise).rejects.toThrow("Tavily search timed out after 15000ms");
    await vi.advanceTimersByTimeAsync(16000);
    await assertion;
    vi.useRealTimers();
  });

  it("throws when the response has no results array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ query: "q" }), { status: 200 }),
    );
    const search = createTavilySearch(makeConfig());
    await expect(search("q")).rejects.toThrow(/results/);
  });
});
