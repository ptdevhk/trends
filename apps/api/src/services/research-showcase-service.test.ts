import { afterEach, describe, expect, it, vi } from "vitest";

const mutationCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const queryCalls: Array<{ path: string; args: Record<string, unknown> }> = [];

vi.mock("./convex-utils.js", () => ({
  callConvexMutation: vi.fn(async (path: string, args: Record<string, unknown>) => {
    mutationCalls.push({ path, args });
    if (path === "companies:upsert") {
      return { companyKey: args.companyKey, created: true };
    }
    if (path === "companies:addAlias") {
      return { created: true };
    }
    if (path === "research_news:upsertItem") {
      return { id: "news1", created: true };
    }
    if (path === "research_signals:upsert") {
      return { id: "sig1", created: true };
    }
    return {};
  }),
  callConvexQuery: vi.fn(async (path: string, args: Record<string, unknown>) => {
    queryCalls.push({ path, args });
    if (path === "research_signals:listByCompany") {
      const key = String(args.companyKey ?? "");
      if (key === "pro-technic-machinery") {
        return [
          { kind: "hiring_signal", ingestRunId: "showcase-seed-v1" },
          { kind: "sales_trigger", ingestRunId: "showcase-seed-v1" },
          { kind: "market_move", ingestRunId: "showcase-seed-v1" },
        ];
      }
      return [];
    }
    if (path === "research_news:listRecent") {
      return [
        {
          _id: "n1",
          sourceId: "showcase",
          platform: "showcase",
          title: "pulse title",
          contentHash: "h",
          capturedAt: 1,
        },
      ];
    }
    if (path === "research_ops:latestIngestRun") {
      return { runId: "r1", status: "success" };
    }
    return null;
  }),
}));

vi.mock("./config.js", () => ({
  config: { auth: { convexWriteSecret: "test-secret" } },
}));

import { getResearchShowcase, seedResearchShowcase } from "./research-showcase-service.js";
import type { ResearchShowcasePack } from "./research-showcase-pack.js";

const miniPack: ResearchShowcasePack = {
  version: "v1",
  seedIngestRunId: "showcase-seed-v1",
  golden: [
    {
      companyKey: "pro-technic-machinery",
      displayName: "Pro-Technic",
      aliases: ["宝力机械"],
      signals: [
        { kind: "hiring_signal", title: "Hire", snippet: "h" },
        { kind: "sales_trigger", title: "Sales", snippet: "s" },
      ],
    },
  ],
  fromResumeDesk: [
    {
      companyKey: "globalfoundries",
      displayName: "GlobalFoundries",
      aliases: ["GlobalFoundries"],
      signals: [{ kind: "hiring_signal", title: "GF hire" }],
    },
  ],
};

describe("research-showcase-service", () => {
  afterEach(() => {
    mutationCalls.length = 0;
    queryCalls.length = 0;
    vi.clearAllMocks();
  });

  it("seeds companies, news, and nested signals with stable contentHash and ingestRunId", async () => {
    const result = await seedResearchShowcase(miniPack);
    expect(result.seedIngestRunId).toBe("showcase-seed-v1");
    expect(result.companiesUpserted).toBe(2);
    expect(result.signalsUpserted).toBe(3);
    expect(result.newsUpserted).toBe(3);

    const newsHashes = mutationCalls
      .filter((c) => c.path === "research_news:upsertItem")
      .map((c) => c.args.contentHash);
    expect(newsHashes).toContain("showcase:v1:pro-technic-machinery:hiring_signal");
    expect(newsHashes).toContain("showcase:v1:globalfoundries:hiring_signal");

    const signalArgs = mutationCalls.filter((c) => c.path === "research_signals:upsert");
    expect(signalArgs.length).toBe(3);
    for (const call of signalArgs) {
      expect(call.args.ingestRunId).toBe("showcase-seed-v1");
      expect(call.args.evidence).toMatchObject({
        platform: "showcase",
        title: expect.any(String),
      });
      expect(call.args.writeSecret).toBe("test-secret");
    }

    expect(mutationCalls.some((c) => c.path === "companies:upsert")).toBe(true);
    expect(mutationCalls.some((c) => c.path === "companies:addAlias")).toBe(true);
  });

  it("aggregates hub cards with multi-kind counts for golden company", async () => {
    // Force pack via seed path's getShowcase uses load from disk — call card path through getResearchShowcase
    // by stubbing getShowcasePack is harder; instead verify listByCompany query is used and counts map.
    const showcase = await getResearchShowcase("hr");
    expect(showcase.golden.length).toBeGreaterThanOrEqual(1);
    const pro = showcase.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro).toBeTruthy();
    expect(pro!.signalCount).toBeGreaterThanOrEqual(3);
    expect(pro!.kindCounts.hiring_signal).toBeGreaterThanOrEqual(1);
    expect(pro!.href).toBe("/hr/research/pro-technic-machinery?persona=hr");
    expect(pro!.showcase).toBe(true);
    expect(showcase.fromResumeDesk.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(showcase.pulse)).toBe(true);
    expect(showcase.meta.seedIngestRunId).toBe("showcase-seed-v1");
  });
});
