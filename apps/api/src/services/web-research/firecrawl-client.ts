/**
 * Firecrawl /v1/scrape HTTP client pinned to the CN proxy with zh-CN
 * languages (CN is the core market), plus a safe wrapper that returns
 * {error} instead of throwing for the steward's per-source isolation.
 */
import { isRecord } from "@trends/shared";

export interface FirecrawlScrapeConfig {
  firecrawlApiKey: string;
  firecrawlBaseUrl: string;
  timeoutMs: number;
}

export interface FirecrawlScrapeResult {
  url: string;
  markdown: string;
  title?: string;
  statusCode?: number;
}

export type FirecrawlScrape = (url: string) => Promise<FirecrawlScrapeResult>;

export type SafeFirecrawlScrape = (
  url: string,
) => Promise<FirecrawlScrapeResult | { error: string }>;

export function createFirecrawlScrape(
  config: FirecrawlScrapeConfig,
): FirecrawlScrape {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.firecrawlBaseUrl}/v1/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          languages: ["zh-CN"],
          proxyLocation: "cn",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Firecrawl scrape failed: HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || payload.success !== true) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "unknown error";
        throw new Error(`Firecrawl scrape failed: ${message}`);
      }
      const data = payload.data;
      if (!isRecord(data) || typeof data.markdown !== "string") {
        throw new Error("Firecrawl scrape response has no markdown");
      }
      return {
        url: typeof data.url === "string" ? data.url : url,
        markdown: data.markdown,
        ...(typeof data.title === "string" ? { title: data.title } : {}),
        ...(typeof data.statusCode === "number"
          ? { statusCode: data.statusCode }
          : {}),
      };
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") {
        throw new Error(`Firecrawl scrape timed out after ${config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createSafeFirecrawlScrape(
  config: FirecrawlScrapeConfig,
): SafeFirecrawlScrape {
  const scrape = createFirecrawlScrape(config);
  return async (url) => {
    try {
      return await scrape(url);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}
