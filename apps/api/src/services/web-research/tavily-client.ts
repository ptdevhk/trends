/**
 * Tavily /search HTTP client with AbortController timeout, HTTP error
 * mapping, and response validation. One call costs one research credit.
 */
import { isRecord } from "@trends/shared";
import type { TavilyLikeResult } from "./steward-utils.js";

export interface TavilySearchConfig {
  tavilyApiKey: string;
  tavilyBaseUrl: string;
  timeoutMs: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyLikeResult[];
  responseTime?: number;
}

export type TavilySearch = (query: string) => Promise<TavilySearchResponse>;

export function createTavilySearch(config: TavilySearchConfig): TavilySearch {
  return async (query) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.tavilyBaseUrl}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.tavilyApiKey,
          query,
          search_depth: "basic",
          max_results: 10,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Tavily search failed: HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new Error("Tavily search response has no results array");
      }
      return {
        query: typeof payload.query === "string" ? payload.query : query,
        results: payload.results as TavilyLikeResult[],
        ...(typeof payload.responseTime === "number"
          ? { responseTime: payload.responseTime }
          : {}),
      };
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") {
        throw new Error(`Tavily search timed out after ${config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
