/**
 * Integration tests for research_news Convex mutations/queries.
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

describe("research_news (convex-test)", () => {
  it("rejects writes without write secret", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.research_news.upsertItem, {
        sourceId: "weibo",
        platform: "weibo",
        title: "x",
        contentHash: "h0",
        capturedAt: Date.now(),
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("does not duplicate a news item when contentHash repeats", async () => {
    const t = createTest();
    const args = {
      writeSecret: WRITE_SECRET,
      sourceId: "weibo",
      platform: "weibo",
      title: "宝力机械获订单",
      contentHash: "h1",
      capturedAt: Date.now(),
    };
    const first = await t.mutation(api.research_news.upsertItem, args);
    expect(first.created).toBe(true);
    const second = await t.mutation(api.research_news.upsertItem, {
      ...args,
      title: "宝力机械获订单（更新）",
      capturedAt: Date.now() + 1000,
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const rows = await t.query(api.research_news.listRecent, {
      writeSecret: WRITE_SECRET,
      limit: 10,
    });
    expect(rows.filter((r) => r.contentHash === "h1")).toHaveLength(1);
    // First-seen capturedAt preserved; title refreshed
    const row = rows.find((r) => r.contentHash === "h1")!;
    expect(row.capturedAt).toBe(args.capturedAt);
    expect(row.title).toBe("宝力机械获订单（更新）");
  });

  it("lists recent news ordered by capturedAt desc", async () => {
    const t = createTest();
    const base = Date.now();
    await t.mutation(api.research_news.upsertItem, {
      writeSecret: WRITE_SECRET,
      sourceId: "weibo",
      platform: "weibo",
      title: "older",
      contentHash: "older",
      capturedAt: base,
    });
    await t.mutation(api.research_news.upsertItem, {
      writeSecret: WRITE_SECRET,
      sourceId: "rss",
      platform: "rss",
      title: "newer",
      contentHash: "newer",
      capturedAt: base + 5000,
    });
    const rows = await t.query(api.research_news.listRecent, {
      writeSecret: WRITE_SECRET,
      limit: 10,
    });
    expect(rows[0].contentHash).toBe("newer");
    expect(rows[1].contentHash).toBe("older");
  });
});
