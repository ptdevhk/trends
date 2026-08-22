/**
 * Tests for firecrawl-client.ts — Firecrawl /v1/scrape client (CN proxy,
 * zh-CN languages) plus the safe wrapper used by the steward service.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createFirecrawlScrape,
  createSafeFirecrawlScrape,
  type FirecrawlScrapeConfig,
} from "./firecrawl-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeConfig(overrides: Partial<FirecrawlScrapeConfig> = {}): FirecrawlScrapeConfig {
  return {
    firecrawlApiKey: "test-key",
    firecrawlBaseUrl: "http://fc.test",
    timeoutMs: 15000,
    ...overrides,
  };
}

describe("createFirecrawlScrape", () => {
  it("posts a Bearer-authenticated CN-proxied scrape request and returns the page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            url: "https://b2b.example.com/futai",
            markdown: "# 富泰精机\n\n主营数控机床加工",
            title: "富泰精机 - B2B",
            statusCode: 200,
          },
        }),
        { status: 200 },
      ),
    );

    const scrape = createFirecrawlScrape(makeConfig());
    const result = await scrape("https://b2b.example.com/futai");

    expect(fetchMock).toHaveBeenCalledWith("http://fc.test/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        url: "https://b2b.example.com/futai",
        formats: ["markdown"],
        languages: ["zh-CN"],
        proxyLocation: "cn",
      }),
      signal: expect.any(AbortSignal) as unknown,
    });
    expect(result.markdown).toContain("富泰精机");
    expect(result.title).toBe("富泰精机 - B2B");
    expect(result.statusCode).toBe(200);
  });

  it("throws when the API reports success:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "rate limited" }), { status: 200 }),
    );
    const scrape = createFirecrawlScrape(makeConfig());
    await expect(scrape("https://b2b.example.com/futai")).rejects.toThrow(/rate limited/);
  });

  it("throws a mapped error on non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("too many", { status: 429 }));
    const scrape = createFirecrawlScrape(makeConfig());
    await expect(scrape("https://b2b.example.com/futai")).rejects.toThrow(
      "Firecrawl scrape failed: HTTP 429",
    );
  });

  it("throws when the response has no markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { url: "https://x.example.com" } }), {
        status: 200,
      }),
    );
    const scrape = createFirecrawlScrape(makeConfig());
    await expect(scrape("https://x.example.com")).rejects.toThrow(/markdown/);
  });
});

describe("createSafeFirecrawlScrape", () => {
  it("returns {error} instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const safeScrape = createSafeFirecrawlScrape(makeConfig());
    const result = await safeScrape("https://b2b.example.com/futai");
    expect("error" in result && typeof result.error === "string").toBe(true);
  });

  it("passes through successful scrapes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { url: "https://b2b.example.com/futai", markdown: "ok", title: "T" },
        }),
        { status: 200 },
      ),
    );
    const safeScrape = createSafeFirecrawlScrape(makeConfig());
    const result = await safeScrape("https://b2b.example.com/futai");
    expect("markdown" in result && result.markdown).toBe("ok");
  });
});
