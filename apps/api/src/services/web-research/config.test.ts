/**
 * Tests for config.ts — env-driven WebResearchConfig loading with strict
 * key validation when the feature is enabled.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadWebResearchConfig } from "./config.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("loadWebResearchConfig defaults", () => {
  it("returns feature-disabled defaults from an empty env", () => {
    const config = loadWebResearchConfig({});
    expect(config.enabled).toBe(false);
    expect(config.tavilyBaseUrl).toBe("https://api.tavily.com");
    expect(config.firecrawlBaseUrl).toBe("https://api.firecrawl.dev");
    expect(config.creditBudget).toBe(100);
    expect(config.maxCandidates).toBe(10);
    expect(config.timeoutMs).toBe(15000);
    expect(config.officialDomains).toEqual([]);
  });

  it("does not require API keys when disabled", () => {
    expect(() => loadWebResearchConfig({})).not.toThrow();
  });
});

describe("loadWebResearchConfig env parsing", () => {
  it("parses every field from env", () => {
    const config = loadWebResearchConfig({
      WEB_RESEARCH_ENABLED: "true",
      TAVILY_API_KEY: "tavily-key",
      FIRECRAWL_API_KEY: "firecrawl-key",
      WEB_RESEARCH_TAVILY_BASE_URL: "http://tv.test",
      WEB_RESEARCH_FIRECRAWL_BASE_URL: "http://fc.test",
      WEB_RESEARCH_CREDIT_BUDGET: "50",
      WEB_RESEARCH_MAX_CANDIDATES: "5",
      WEB_RESEARCH_TIMEOUT_MS: "8000",
      WEB_RESEARCH_OFFICIAL_DOMAINS: "Futai.com,  www.example.com , CN",
    });
    expect(config.enabled).toBe(true);
    expect(config.tavilyApiKey).toBe("tavily-key");
    expect(config.firecrawlApiKey).toBe("firecrawl-key");
    expect(config.tavilyBaseUrl).toBe("http://tv.test");
    expect(config.firecrawlBaseUrl).toBe("http://fc.test");
    expect(config.creditBudget).toBe(50);
    expect(config.maxCandidates).toBe(5);
    expect(config.timeoutMs).toBe(8000);
    expect(config.officialDomains).toEqual(["futai.com", "www.example.com", "cn"]);
  });

  it("clamps numeric fields to their bounds", () => {
    const config = loadWebResearchConfig({
      WEB_RESEARCH_ENABLED: "true",
      TAVILY_API_KEY: "k",
      FIRECRAWL_API_KEY: "k",
      WEB_RESEARCH_CREDIT_BUDGET: "999999",
      WEB_RESEARCH_MAX_CANDIDATES: "0",
      WEB_RESEARCH_TIMEOUT_MS: "500",
    });
    expect(config.creditBudget).toBe(100000);
    expect(config.maxCandidates).toBe(1);
    expect(config.timeoutMs).toBe(1000);

    const upper = loadWebResearchConfig({
      WEB_RESEARCH_ENABLED: "true",
      TAVILY_API_KEY: "k",
      FIRECRAWL_API_KEY: "k",
      WEB_RESEARCH_MAX_CANDIDATES: "99",
      WEB_RESEARCH_TIMEOUT_MS: "999999",
    });
    expect(upper.maxCandidates).toBe(50);
    expect(upper.timeoutMs).toBe(120000);
  });

  it("falls back to defaults when numeric fields are not parseable", () => {
    const config = loadWebResearchConfig({
      WEB_RESEARCH_ENABLED: "true",
      TAVILY_API_KEY: "k",
      FIRECRAWL_API_KEY: "k",
      WEB_RESEARCH_CREDIT_BUDGET: "abc",
      WEB_RESEARCH_MAX_CANDIDATES: "",
      WEB_RESEARCH_TIMEOUT_MS: "12ms",
    });
    expect(config.creditBudget).toBe(100);
    expect(config.maxCandidates).toBe(10);
    expect(config.timeoutMs).toBe(15000);
  });
});

describe("loadWebResearchConfig strict-on-enabled", () => {
  it("throws when enabled but TAVILY_API_KEY is missing", () => {
    expect(() =>
      loadWebResearchConfig({
        WEB_RESEARCH_ENABLED: "true",
        FIRECRAWL_API_KEY: "k",
      }),
    ).toThrow(/TAVILY_API_KEY/);
  });

  it("throws when enabled but FIRECRAWL_API_KEY is missing", () => {
    expect(() =>
      loadWebResearchConfig({
        WEB_RESEARCH_ENABLED: "true",
        TAVILY_API_KEY: "k",
      }),
    ).toThrow(/FIRECRAWL_API_KEY/);
  });

  it("throws listing both keys when neither is present", () => {
    expect(() => loadWebResearchConfig({ WEB_RESEARCH_ENABLED: "true" })).toThrow(
      /TAVILY_API_KEY.*FIRECRAWL_API_KEY/,
    );
  });
});
