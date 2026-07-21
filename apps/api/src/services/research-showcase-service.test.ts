import { afterEach, describe, expect, it, vi } from "vitest";

type StoredSignal = {
  companyKey: string;
  kind: string;
  title: string;
  ingestRunId?: string;
};

const mutationCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const queryCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
/** In-memory store simulating Convex research_signals for real seed→GET path */
const signalStore: StoredSignal[] = [];
const seenNewsHashes = new Set<string>();

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
    if (path === "research_signals:deleteByCompanyIngestRunPrefix") {
      const companyKey = String(args.companyKey ?? "").toLowerCase();
      const prefix = String(args.ingestRunIdPrefix ?? "");
      let deleted = 0;
      for (let i = signalStore.length - 1; i >= 0; i -= 1) {
        const row = signalStore[i]!;
        if (
          row.companyKey === companyKey &&
          typeof row.ingestRunId === "string" &&
          row.ingestRunId.startsWith(prefix)
        ) {
          signalStore.splice(i, 1);
          deleted += 1;
        }
      }
      return { deleted };
    }
    if (path === "research_signals:upsert") {
      const companyKey = String(args.companyKey ?? "").toLowerCase();
      const kind = String(args.kind ?? "");
      const title = String(args.title ?? "");
      const ingestRunId = typeof args.ingestRunId === "string" ? args.ingestRunId : undefined;
      // Match Convex soft-dedupe: company + kind + ingestRunId
      const existing = signalStore.find(
        (row) =>
          row.companyKey === companyKey &&
          row.kind === kind &&
          (ingestRunId ? row.ingestRunId === ingestRunId : true),
      );
      if (existing) {
        existing.title = title;
        existing.ingestRunId = ingestRunId;
        return { id: `sig-${companyKey}-${kind}`, created: false };
      }
      signalStore.push({ companyKey, kind, title, ingestRunId });
      return { id: `sig-${companyKey}-${kind}-new`, created: true };
    }
    return {};
  }),
  callConvexQuery: vi.fn(async (path: string, args: Record<string, unknown>) => {
    queryCalls.push({ path, args });
    if (path === "research_signals:listByCompany") {
      const key = String(args.companyKey ?? "").toLowerCase();
      return signalStore
        .filter((row) => row.companyKey === key)
        .map((row) => ({
          kind: row.kind,
          title: row.title,
          ingestRunId: row.ingestRunId,
        }));
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
        { kind: "market_move", title: "Market", snippet: "m" },
        { kind: "company_mention", title: "Mention", snippet: "c" },
      ],
    },
  ],
  fromResumeDesk: [
    {
      companyKey: "globalfoundries",
      displayName: "GlobalFoundries",
      aliases: ["GlobalFoundries"],
      signals: [
        { kind: "hiring_signal", title: "GF hire" },
        { kind: "market_move", title: "GF market" },
        { kind: "company_mention", title: "GF mention" },
      ],
    },
  ],
};

describe("research-showcase-service", () => {
  afterEach(() => {
    mutationCalls.length = 0;
    queryCalls.length = 0;
    signalStore.length = 0;
    seenNewsHashes.clear();
    vi.clearAllMocks();
  });

  it("seeds companies, news, and nested signals with stable contentHash and ingestRunId", async () => {
    const result = await seedResearchShowcase(miniPack);
    expect(result.seedIngestRunId).toBe("showcase-seed-v1");
    expect(result.companiesUpserted).toBe(2);
    expect(result.signalsUpserted).toBe(7);
    expect(result.newsUpserted).toBe(7);

    const newsHashes = mutationCalls
      .filter((c) => c.path === "research_news:upsertItem")
      .map((c) => c.args.contentHash);
    expect(newsHashes).toContain("showcase:v1:pro-technic-machinery:hiring_signal");
    expect(newsHashes).toContain("showcase:v1:globalfoundries:hiring_signal");

    const signalArgs = mutationCalls.filter((c) => c.path === "research_signals:upsert");
    expect(signalArgs.length).toBe(7);
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

  it("seed then seed then GET keeps pack-sized kindCounts (1 per kind) via real seed path", async () => {
    // Pre-pollute store with live row + old showcase dup — seed must clear showcase-seed and not count live
    signalStore.push(
      {
        companyKey: "pro-technic-machinery",
        kind: "hiring_signal",
        title: "live noise",
        ingestRunId: "research-live-xyz",
      },
      {
        companyKey: "pro-technic-machinery",
        kind: "hiring_signal",
        title: "old showcase",
        ingestRunId: "showcase-seed-v1",
      },
    );

    await seedResearchShowcase(miniPack);
    const hub1 = await getResearchShowcase("hr");
    const pro1 = hub1.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro1).toBeTruthy();
    expect(pro1!.showcase).toBe(true);
    expect(pro1!.signalCount).toBe(4);
    expect(pro1!.kindCounts).toEqual({
      hiring_signal: 1,
      sales_trigger: 1,
      market_move: 1,
      company_mention: 1,
    });
    // Live noise must not inflate counts
    expect(pro1!.kindCounts.hiring_signal).toBe(1);

    await seedResearchShowcase(miniPack);
    const hub2 = await getResearchShowcase("hr");
    const pro2 = hub2.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro2).toBeTruthy();
    expect(pro2!.signalCount).toBe(pro1!.signalCount);
    expect(pro2!.kindCounts).toEqual(pro1!.kindCounts);
    expect(Object.values(pro2!.kindCounts).every((n) => n === 1)).toBe(true);

    const gf = hub2.fromResumeDesk.find((c) => c.companyKey === "globalfoundries");
    expect(gf?.signalCount).toBe(3);
    expect(gf?.showcase).toBe(true);
    expect(Object.values(gf!.kindCounts).every((n) => n === 1)).toBe(true);
  });

  it("re-seed clears showcase-seed prefix then re-upserts same pack", async () => {
    await seedResearchShowcase(miniPack);
    const firstDeletes = mutationCalls.filter(
      (c) => c.path === "research_signals:deleteByCompanyIngestRunPrefix",
    );
    expect(firstDeletes.length).toBe(2);

    mutationCalls.length = 0;
    await seedResearchShowcase(miniPack);
    const secondDeletes = mutationCalls.filter(
      (c) => c.path === "research_signals:deleteByCompanyIngestRunPrefix",
    );
    const secondSigs = mutationCalls.filter((c) => c.path === "research_signals:upsert");
    expect(secondDeletes.length).toBe(2);
    expect(secondSigs.length).toBe(7);
  });

  it("does not label or count live-only density as showcase", async () => {
    signalStore.push({
      companyKey: "pro-technic-machinery",
      kind: "hiring_signal",
      title: "live only",
      ingestRunId: "research-live-xyz",
    });
    const hub = await getResearchShowcase("hr");
    const pro = hub.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro).toBeTruthy();
    // Live-only: no showcase-seed rows
    expect(pro!.signalCount).toBe(0);
    expect(pro!.showcase).toBe(false);
    expect(pro!.kindCounts).toEqual({});
  });
});
