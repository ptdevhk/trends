/**
 * Integration tests for research_signals — nested evidence contract.
 */
import { createTest } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

describe("research_signals (convex-test)", () => {
  it("stores signal evidence as a nested object", async () => {
    const t = createTest();
    const seenAt = Date.now();
    const result = await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "pro-technic-machinery",
      kind: "sales_trigger",
      title: "宝力机械扩产",
      evidence: {
        title: "宝力机械扩产",
        platform: "weibo",
        seenAt,
        snippet: "扩产公告",
      },
      capturedAt: seenAt,
    });
    expect(result.created).toBe(true);

    const rows = await t.query(api.research_signals.listByCompany, {
      writeSecret: WRITE_SECRET,
      companyKey: "pro-technic-machinery",
    });
    expect(rows).toHaveLength(1);
    const signal = rows[0];
    expect(signal.kind).toBe("sales_trigger");
    // Nested evidence object — not flattened fields on the row
    expect(signal.evidence).toEqual({
      title: "宝力机械扩产",
      platform: "weibo",
      seenAt,
      snippet: "扩产公告",
    });
    expect((signal as Record<string, unknown>).platform).toBeUndefined();
    expect((signal as Record<string, unknown>).seenAt).toBeUndefined();
  });

  it("lists signals for a company and filters by kind", async () => {
    const t = createTest();
    const now = Date.now();
    await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      kind: "hiring_signal",
      title: "招聘工程师",
      evidence: { title: "招聘工程师", platform: "rss", seenAt: now },
      capturedAt: now,
    });
    await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      kind: "market_move",
      title: "融资新闻",
      evidence: { title: "融资新闻", platform: "rss", seenAt: now + 1 },
      capturedAt: now + 1,
    });

    const all = await t.query(api.research_signals.listByCompany, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
    });
    expect(all).toHaveLength(2);

    const hiring = await t.query(api.research_signals.listByCompany, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      kind: "hiring_signal",
    });
    expect(hiring).toHaveLength(1);
    expect(hiring[0].kind).toBe("hiring_signal");
  });

  it("dedupes by companyKey+kind+ingestRunId for showcase seed re-upsert", async () => {
    const t = createTest();
    const first = await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "pro-technic-machinery",
      kind: "hiring_signal",
      title: "Old title",
      evidence: { title: "Old title", platform: "showcase", seenAt: 100 },
      capturedAt: 100,
      ingestRunId: "showcase-seed-v1",
    });
    expect(first.created).toBe(true);

    const second = await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "pro-technic-machinery",
      kind: "hiring_signal",
      title: "New title",
      evidence: { title: "New title", platform: "showcase", seenAt: 999 },
      capturedAt: 999,
      ingestRunId: "showcase-seed-v1",
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const rows = await t.query(api.research_signals.listByCompany, {
      writeSecret: WRITE_SECRET,
      companyKey: "pro-technic-machinery",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("New title");
  });

  it("deleteByCompanyIngestRunPrefix removes only matching showcase rows", async () => {
    const t = createTest();
    await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      kind: "hiring_signal",
      title: "seed",
      evidence: { title: "seed", platform: "showcase", seenAt: 1 },
      capturedAt: 1,
      ingestRunId: "showcase-seed-v1",
    });
    await t.mutation(api.research_signals.upsert, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      kind: "market_move",
      title: "live",
      evidence: { title: "live", platform: "weibo", seenAt: 2 },
      capturedAt: 2,
      ingestRunId: "research-live-1",
    });
    const del = await t.mutation(api.research_signals.deleteByCompanyIngestRunPrefix, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
      ingestRunIdPrefix: "showcase-seed",
    });
    expect(del.deleted).toBe(1);
    const rows = await t.query(api.research_signals.listByCompany, {
      writeSecret: WRITE_SECRET,
      companyKey: "polywell",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("market_move");
  });
});
