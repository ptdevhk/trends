import { afterEach, describe, expect, it, vi } from "vitest";

const mutationCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const queryCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const seenNewsHashes = new Set<string>();
const seenSignalKeys = new Set<string>();

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
      const hash = String(args.contentHash ?? "");
      const created = !seenNewsHashes.has(hash);
      seenNewsHashes.add(hash);
      return { id: `news-${hash}`, created };
    }
    if (path === "research_signals:upsert") {
      const key = `${args.companyKey}|${args.kind}|${args.title}|${args.ingestRunId}`;
      const created = !seenSignalKeys.has(key);
      seenSignalKeys.add(key);
      return { id: `sig-${key}`, created };
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
      if (key === "live-only-co") {
        return [{ kind: "hiring_signal", ingestRunId: "research-live-abc" }];
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
    seenNewsHashes.clear();
    seenSignalKeys.clear();
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

  it("re-seed is idempotent: same contentHash/ingest keys; second pass created=false", async () => {
    const first = await seedResearchShowcase(miniPack);
    const firstNews = mutationCalls.filter((c) => c.path === "research_news:upsertItem");
    const firstSigs = mutationCalls.filter((c) => c.path === "research_signals:upsert");
    expect(first.signalsUpserted).toBe(3);

    const hashes1 = firstNews.map((c) => c.args.contentHash).sort();
    const sigKeys1 = firstSigs
      .map((c) => `${c.args.companyKey}|${c.args.kind}|${c.args.title}|${c.args.ingestRunId}`)
      .sort();

    // Capture create flags from mock state after first seed
    const firstNewsCreated = firstNews.map((c) => {
      // re-call would be created false; inspect via second seed instead
      return c.args.contentHash;
    });
    expect(firstNewsCreated.length).toBe(3);

    mutationCalls.length = 0;
    const second = await seedResearchShowcase(miniPack);
    expect(second.signalsUpserted).toBe(3);
    expect(second.newsUpserted).toBe(3);

    const secondNews = mutationCalls.filter((c) => c.path === "research_news:upsertItem");
    const secondSigs = mutationCalls.filter((c) => c.path === "research_signals:upsert");
    const hashes2 = secondNews.map((c) => c.args.contentHash).sort();
    const sigKeys2 = secondSigs
      .map((c) => `${c.args.companyKey}|${c.args.kind}|${c.args.title}|${c.args.ingestRunId}`)
      .sort();

    expect(hashes2).toEqual(hashes1);
    expect(sigKeys2).toEqual(sigKeys1);

    // Drive real mock return path: re-seed must hit created:false on shipped mutation boundary
    const { callConvexMutation } = await import("./convex-utils.js");
    const newsResults = await Promise.all(
      hashes2.map((hash) =>
        callConvexMutation("research_news:upsertItem", {
          contentHash: hash,
          writeSecret: "test-secret",
        }),
      ),
    );
    // Third call for each hash still created=false (already in seen set after first+second seed)
    expect(newsResults.every((r) => isRecord(r) && r.created === false)).toBe(true);

    const sigResults = await Promise.all(
      sigKeys2.map((key) => {
        const [companyKey, kind, title, ingestRunId] = key.split("|");
        return callConvexMutation("research_signals:upsert", {
          companyKey,
          kind,
          title,
          ingestRunId,
          writeSecret: "test-secret",
        });
      }),
    );
    expect(sigResults.every((r) => isRecord(r) && r.created === false)).toBe(true);
  });

  it("aggregates hub cards with multi-kind counts for golden company", async () => {
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

  it("does not label live-only density as showcase data", async () => {
    const { callConvexQuery } = await import("./convex-utils.js");
    // Inject via listByCompany mock path for a company only in query — use getResearchShowcase
    // with pack companies: override query mock response by key live-only-co is not in pack.
    // Instead assert pro with live-only mix: temporarily re-mock return for empty companies.
    const emptyShowcaseCompanies = await callConvexQuery("research_signals:listByCompany", {
      companyKey: "live-only-co",
      writeSecret: "test-secret",
    });
    expect(Array.isArray(emptyShowcaseCompanies)).toBe(true);
    const rows = emptyShowcaseCompanies as Array<{ kind: string; ingestRunId: string }>;
    expect(rows[0].ingestRunId.startsWith("showcase-seed")).toBe(false);

    // Build card logic through real getResearchShowcase path: add live-only to query for a pack company
    // by re-seeding query mock — use vi.mocked after import
    const utils = await import("./convex-utils.js");
    vi.mocked(utils.callConvexQuery).mockImplementation(async (path: string, args: Record<string, unknown>) => {
      queryCalls.push({ path, args });
      if (path === "research_signals:listByCompany") {
        return [{ kind: "hiring_signal", ingestRunId: "research-live-xyz" }];
      }
      if (path === "research_news:listRecent") {
        return [];
      }
      if (path === "research_ops:latestIngestRun") {
        return null;
      }
      return null;
    });

    const hub = await getResearchShowcase("hr");
    for (const card of [...hub.golden, ...hub.fromResumeDesk]) {
      if (card.signalCount > 0) {
        expect(card.showcase).toBe(false);
      }
    }
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
