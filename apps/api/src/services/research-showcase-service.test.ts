import { afterEach, describe, expect, it, vi } from "vitest";

type StoredSignal = {
  companyKey: string;
  kind: string;
  title: string;
  ingestRunId?: string;
  _id: string;
};

const mutationCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const queryCalls: Array<{ path: string; args: Record<string, unknown> }> = [];
const signalStore: StoredSignal[] = [];
const seenNewsHashes = new Set<string>();
let idSeq = 0;

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
      const existing = signalStore.find(
        (row) =>
          row.companyKey === companyKey &&
          row.kind === kind &&
          (ingestRunId ? row.ingestRunId === ingestRunId : true),
      );
      if (existing) {
        existing.title = title;
        existing.ingestRunId = ingestRunId;
        return { id: existing._id, created: false };
      }
      idSeq += 1;
      const _id = `sig-${idSeq}`;
      signalStore.push({ companyKey, kind, title, ingestRunId, _id });
      return { id: _id, created: true };
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
          _id: row._id,
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
      companyKey: "makino",
      displayName: "牧野 / MAKINO",
      nameCn: "牧野",
      nameEn: "MAKINO",
      aliases: ["牧野", "MAKINO"],
      signals: [
        { kind: "hiring_signal", title: "牧野招聘" },
        { kind: "market_move", title: "牧野市场" },
        { kind: "company_mention", title: "牧野提及" },
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
    idSeq = 0;
    vi.clearAllMocks();
  });

  it("seeds companies, news, and nested signals with stable contentHash and ingestRunId", async () => {
    const result = await seedResearchShowcase(miniPack);
    expect(result.seedIngestRunId).toBe("showcase-seed-v1");
    expect(result.companiesUpserted).toBe(2);
    expect(result.signalsUpserted).toBe(7);
    expect(result.signalsCreated).toBe(7);
    expect(result.newsUpserted).toBe(7);
    expect(result.newsCreated).toBe(7);

    const newsHashes = mutationCalls
      .filter((c) => c.path === "research_news:upsertItem")
      .map((c) => c.args.contentHash);
    expect(newsHashes).toContain("showcase:v1:pro-technic-machinery:hiring_signal");
    expect(newsHashes).toContain("showcase:v1:makino:hiring_signal");

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
  });

  it("seed×2 then GET: second seed creates 0 signals; hub kindCounts stay pack-sized", async () => {
    // Pre-pollute with live noise (must not inflate hub or block seed)
    signalStore.push({
      companyKey: "pro-technic-machinery",
      kind: "hiring_signal",
      title: "live noise",
      ingestRunId: "research-live-xyz",
      _id: "live-1",
    });

    const first = await seedResearchShowcase(miniPack);
    expect(first.signalsCreated).toBe(7);
    expect(first.newsCreated).toBe(7);

    const hub1 = await getResearchShowcase("hr");
    const pro1 = hub1.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro1).toBeTruthy();
    expect(pro1!.showcase).toBe(true);
    expect(pro1!.signalCount).toBe(4);
    expect(Object.values(pro1!.kindCounts).every((n) => n === 1)).toBe(true);
    expect(pro1!.kindCounts).toEqual({
      hiring_signal: 1,
      sales_trigger: 1,
      market_move: 1,
      company_mention: 1,
    });

    const second = await seedResearchShowcase(miniPack);
    // Pure re-seed: soft-dedupe returns created:false for every pack signal
    expect(second.signalsCreated).toBe(0);
    expect(second.newsCreated).toBe(0);
    expect(second.signalsUpserted).toBe(7);

    const hub2 = await getResearchShowcase("hr");
    const pro2 = hub2.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro2!.signalCount).toBe(pro1!.signalCount);
    expect(pro2!.kindCounts).toEqual(pro1!.kindCounts);
    expect(Object.values(pro2!.kindCounts).every((n) => n === 1)).toBe(true);

    const mk = hub2.fromResumeDesk.find((c) => c.companyKey === "makino");
    expect(mk?.signalCount).toBe(3);
    expect(mk?.showcase).toBe(true);
    expect(Object.values(mk!.kindCounts).every((n) => n === 1)).toBe(true);
  });

  it("repairs historical duplicate showcase-seed rows then leaves kindCounts at 1", async () => {
    // Simulate pre-fix dups: two showcase-seed hiring rows
    signalStore.push(
      {
        companyKey: "pro-technic-machinery",
        kind: "hiring_signal",
        title: "old A",
        ingestRunId: "showcase-seed-v1",
        _id: "dup-a",
      },
      {
        companyKey: "pro-technic-machinery",
        kind: "hiring_signal",
        title: "old B",
        ingestRunId: "showcase-seed-v1",
        _id: "dup-b",
      },
    );

    const result = await seedResearchShowcase(miniPack);
    // Soft-dedupe collapses first dup on upsert; repair may wipe+reapply if still >1
    const hub = await getResearchShowcase("hr");
    const pro = hub.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro!.kindCounts.hiring_signal).toBe(1);
    expect(pro!.signalCount).toBe(4);
    expect(result.seedIngestRunId).toBe("showcase-seed-v1");
  });

  it("does not label or count live-only density as showcase", async () => {
    signalStore.push({
      companyKey: "pro-technic-machinery",
      kind: "hiring_signal",
      title: "live only",
      ingestRunId: "research-live-xyz",
      _id: "live-only",
    });
    const hub = await getResearchShowcase("hr");
    const pro = hub.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro!.signalCount).toBe(0);
    expect(pro!.showcase).toBe(false);
    expect(pro!.kindCounts).toEqual({});
  });
});
