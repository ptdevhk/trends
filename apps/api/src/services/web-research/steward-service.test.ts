/**
 * Tests for steward-service.ts — target-by-target web research orchestration:
 * budget accounting, source classification, proposal/evidence writes, and
 * per-target error isolation.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadWebResearchConfig } from "./config.js";
import {
  researchTarget,
  runWebResearch,
  proposalIdForCompany,
  type WebResearchDeps,
  type ResearchTarget,
} from "./steward-service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeDeps(
  overrides: Partial<WebResearchDeps> & { env?: Record<string, string> } = {},
): WebResearchDeps {
  const env = {
    WEB_RESEARCH_ENABLED: "true",
    TAVILY_API_KEY: "test-key",
    FIRECRAWL_API_KEY: "test-key",
    ...(overrides.env ?? {}),
  };
  const { env: _env, ...rest } = overrides;
  return {
    config: loadWebResearchConfig(env),
    tavilySearch: vi.fn(async () => ({ query: "q", results: [] })),
    firecrawlScrape: vi.fn(async () => ({ url: "x", markdown: "scraped" })),
    upsertProposal: vi.fn(async (input: { proposalId: string }) => ({
      proposalId: input.proposalId,
      created: true,
    })),
    upsertEvidenceSource: vi.fn(async () => ({ sourceId: "s", created: true })),
    setResearchState: vi.fn(async () => ({})),
    now: vi.fn(() => 1_700_000_000_000),
    ...rest,
  };
}

const TARGET: ResearchTarget = { companyKey: "futai", names: ["富泰精机"] };

describe("proposalIdForCompany", () => {
  it("prefixes the company key", () => {
    expect(proposalIdForCompany("futai")).toBe("web-steward-futai");
  });
});

describe("researchTarget", () => {
  it("returns disabled without running queries when the feature is off", async () => {
    const deps = makeDeps({ env: { WEB_RESEARCH_ENABLED: "false" } });
    const result = await researchTarget(deps, TARGET);
    expect(result.outcome).toBe("disabled");
    expect(deps.tavilySearch).not.toHaveBeenCalled();
    expect(deps.upsertProposal).not.toHaveBeenCalled();
    expect(deps.upsertEvidenceSource).not.toHaveBeenCalled();
    expect(deps.setResearchState).not.toHaveBeenCalled();
  });

  it("returns skipped_budget with no writes when the budget cannot cover the queries", async () => {
    const deps = makeDeps({ env: { WEB_RESEARCH_CREDIT_BUDGET: "0" } });
    const result = await researchTarget(deps, TARGET);
    expect(result.outcome).toBe("skipped_budget");
    expect(deps.tavilySearch).not.toHaveBeenCalled();
    expect(deps.upsertProposal).not.toHaveBeenCalled();
  });

  it("returns no_sources when searches produce no usable candidates", async () => {
    const deps = makeDeps({
      tavilySearch: vi.fn(async () => ({
        query: "q",
        results: [
          { title: "百度", url: "https://baidu.com/s?wd=futai", content: "x", score: 0.5 },
        ],
      })),
    });
    const result = await researchTarget(deps, TARGET);
    expect(result.outcome).toBe("no_sources");
    expect(deps.upsertProposal).not.toHaveBeenCalled();
    expect(deps.upsertEvidenceSource).not.toHaveBeenCalled();
    expect(deps.setResearchState).not.toHaveBeenCalled();
  });

  it("writes proposal + classified sources + ready_for_review on the happy path", async () => {
    const deps = makeDeps({
      env: { WEB_RESEARCH_OFFICIAL_DOMAINS: "futai.com" },
      tavilySearch: vi.fn(async (query: string) => {
        if (query === "富泰精机 主营 行业") {
          return {
            query,
            results: [
              { title: "富泰精机官网", url: "https://www.futai.com/", content: "富泰精机 数控 加工" },
            ],
          };
        }
        return {
          query,
          results: [
            { title: "富泰精机 - B2B", url: "https://b2b.example.com/futai", content: "自动化设备" },
          ],
        };
      }),
      firecrawlScrape: vi.fn(async (url: string) => ({
        url,
        markdown: "富泰精机主营数控加工中心，数控机床年产能500台",
        title: "富泰精机 - B2B",
      })),
    });

    const result = await researchTarget(deps, TARGET);

    expect(result.outcome).toBe("drafted");
    expect(result.companyKey).toBe("futai");
    expect(result.proposalId).toBe("web-steward-futai");
    expect(result.queriesRun).toBe(2);
    expect(result.scrapesRun).toBe(1);
    expect(result.sources).toHaveLength(2);

    expect(deps.upsertProposal).toHaveBeenCalledWith({
      proposalId: "web-steward-futai",
      companyKey: "futai",
      triggerReasons: ["curated"],
      priority: 5,
      suggestedVerificationLevel: "candidate",
      suggestedIndustryClass: "cnc",
      materialChangeSummary:
        "Web steward: 2 candidate source(s) from 2 query(s); signal cnc @ 0.5",
      requestedBy: "web-steward",
    });

    expect(deps.upsertEvidenceSource).toHaveBeenCalledTimes(2);
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(1, {
      sourceId: "web-steward-futai-src-1",
      companyKey: "futai",
      proposalId: "web-steward-futai",
      url: "https://www.futai.com/",
      sourceType: "official_site",
      trustTier: "primary",
      title: "富泰精机官网",
      fetchStatus: "pending",
      suggestedIndustryClass: "cnc",
      workerConfidence: 0.5,
    });
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(2, {
      sourceId: "web-steward-futai-src-2",
      companyKey: "futai",
      proposalId: "web-steward-futai",
      url: "https://b2b.example.com/futai",
      sourceType: "directory",
      trustTier: "corroborating",
      title: "富泰精机 - B2B",
      fetchStatus: "fetched",
      fetchedAt: 1_700_000_000_000,
      suggestedIndustryClass: "cnc",
      workerConfidence: 1.0, // re-extracted from the scraped markdown (数控+机床 = 4/4)
      evidenceExcerpt: expect.stringContaining("数控") as unknown,
    });

    expect(deps.setResearchState).toHaveBeenCalledWith({
      proposalId: "web-steward-futai",
      status: "ready_for_review",
      suggestedVerificationLevel: "candidate",
      suggestedIndustryClass: "cnc",
      materialChangeSummary:
        "Web steward: 2 candidate source(s) from 2 query(s); signal cnc @ 0.5",
    });
  });

  it("targets evidence and state writes at the upsert-returned id when the company already has an open proposal", async () => {
    const deps = makeDeps({
      env: { WEB_RESEARCH_OFFICIAL_DOMAINS: "futai.com" },
      upsertProposal: vi.fn(async () => ({
        proposalId: "industry-maintenance-existing",
        created: false,
      })),
      tavilySearch: vi.fn(async (query: string) => {
        if (query === "富泰精机 主营 行业") {
          return {
            query,
            results: [
              { title: "富泰精机官网", url: "https://www.futai.com/", content: "富泰精机 数控 加工" },
            ],
          };
        }
        return {
          query,
          results: [
            { title: "富泰精机 - B2B", url: "https://b2b.example.com/futai", content: "自动化设备" },
          ],
        };
      }),
      firecrawlScrape: vi.fn(async (url: string) => ({
        url,
        markdown: "富泰精机主营数控加工中心，数控机床年产能500台",
      })),
    });

    const result = await researchTarget(deps, TARGET);

    expect(result.outcome).toBe("drafted");
    expect(result.proposalId).toBe("industry-maintenance-existing");
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceId: "industry-maintenance-existing-src-1",
        proposalId: "industry-maintenance-existing",
      }),
    );
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceId: "industry-maintenance-existing-src-2",
        proposalId: "industry-maintenance-existing",
      }),
    );
    expect(deps.setResearchState).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "industry-maintenance-existing" }),
    );
  });

  it("stops scraping mid-target when the budget is exhausted", async () => {
    const deps = makeDeps({
      env: { WEB_RESEARCH_CREDIT_BUDGET: "3" },
      tavilySearch: vi.fn(async (query: string) => ({
        query,
        results: [
          { title: "A", url: "https://a.example.com/futai", content: "富泰精机 数控" },
          { title: "B", url: "https://b.example.com/futai", content: "富泰精机 自动化" },
        ],
      })),
      firecrawlScrape: vi.fn(async (url: string) => ({
        url,
        markdown: "富泰精机 数控机床",
        title: "A",
      })),
    });

    const result = await researchTarget(deps, TARGET);

    expect(result.outcome).toBe("drafted");
    expect(result.scrapesRun).toBe(1);
    expect(result.sources).toHaveLength(2);
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceId: "web-steward-futai-src-1",
      url: "https://a.example.com/futai",
      sourceType: "directory",
      trustTier: "corroborating",
      fetchStatus: "fetched",
    }));
    expect(deps.upsertEvidenceSource).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sourceId: "web-steward-futai-src-2",
      url: "https://b.example.com/futai",
      sourceType: "search_result",
      trustTier: "discovery",
      fetchStatus: "pending",
    }));
    expect(deps.setResearchState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready_for_review" }),
    );
  });

  it("classifies a failed scrape as failed discovery evidence but still drafts", async () => {
    const deps = makeDeps({
      tavilySearch: vi.fn(async (query: string) => ({
        query,
        results: [{ title: "A", url: "https://a.example.com/futai", content: "富泰精机 数控" }],
      })),
      firecrawlScrape: vi.fn(async () => ({ error: "rate limited" })),
    });

    const result = await researchTarget(deps, TARGET);

    expect(result.outcome).toBe("drafted");
    expect(result.scrapesRun).toBe(1);
    expect(deps.upsertEvidenceSource).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "web-steward-futai-src-1",
      sourceType: "search_result",
      trustTier: "discovery",
      fetchStatus: "failed",
    }));
    expect(deps.setResearchState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready_for_review" }),
    );
  });

  it("returns error when every search fails", async () => {
    const deps = makeDeps({
      tavilySearch: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const result = await researchTarget(deps, TARGET);
    expect(result.outcome).toBe("error");
    expect(result.error).toMatch(/network down/);
    expect(deps.upsertProposal).not.toHaveBeenCalled();
  });
});

describe("runWebResearch", () => {
  it("continues past a failing target and reports all results", async () => {
    const deps = makeDeps({
      tavilySearch: vi
        .fn()
        .mockResolvedValueOnce({
          query: "q",
          results: [
            { title: "官网", url: "https://www.futai.com/", content: "数控" },
          ],
        })
        .mockRejectedValueOnce(new Error("boom"))
        .mockRejectedValue(new Error("boom")),
    });
    const results = await runWebResearch(deps, [
      TARGET,
      { companyKey: "badco", names: ["坏公司"] },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].outcome).toBe("drafted");
    expect(results[1].outcome).toBe("error");
    expect(results[1].error).toMatch(/boom/);
  });
});
