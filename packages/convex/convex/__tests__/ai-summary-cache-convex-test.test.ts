/**
 * Integration tests for ai_summary_cache.ts using convex-test.
 *
 * Covers: get, upsert (insert + update + dedup), cleanupExpired.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

// ---------------------------------------------------------------------------
// get + upsert
// ---------------------------------------------------------------------------

describe("ai_summary_cache: get + upsert", () => {
  const now = Date.now();

  it("returns null when no cached summary exists", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.ai_summary_cache.get, {
      workspaceSlug: "ws-cache",
      urlHash: "hash-none",
    });

    expect(result).toBeNull();
  });

  it("inserts and retrieves a cached summary", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.ai_summary_cache.upsert, {
      urlHash: "hash-abc",
      workspaceSlug: "ws-cache",
      query: "sales engineer",
      resultCount: 42,
      resultSetHash: "rsh-1",
      summary: "Found 42 matching candidates",
      model: "gpt-4",
      generatedAt: now,
      expiresAt: now + 3600_000,
    });

    const result = await t.query(api.ai_summary_cache.get, {
      workspaceSlug: "ws-cache",
      urlHash: "hash-abc",
    });

    expect(result).not.toBeNull();
    expect(result!.summary).toBe("Found 42 matching candidates");
    expect(result!.resultCount).toBe(42);
  });

  it("upserts — updates existing record", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.ai_summary_cache.upsert, {
      urlHash: "hash-upsert",
      workspaceSlug: "ws-cache",
      query: "engineer",
      resultCount: 10,
      resultSetHash: "rsh-v1",
      summary: "V1 summary",
      model: "gpt-4",
      generatedAt: now,
      expiresAt: now + 3600_000,
    });

    await t.mutation(api.ai_summary_cache.upsert, {
      urlHash: "hash-upsert",
      workspaceSlug: "ws-cache",
      query: "engineer",
      resultCount: 15,
      resultSetHash: "rsh-v2",
      summary: "V2 summary",
      model: "gpt-4",
      generatedAt: now + 1000,
      expiresAt: now + 7200_000,
    });

    const result = await t.query(api.ai_summary_cache.get, {
      workspaceSlug: "ws-cache",
      urlHash: "hash-upsert",
    });

    expect(result!.summary).toBe("V2 summary");
    expect(result!.resultCount).toBe(15);
  });

  it("deduplicates stale duplicate records", async () => {
    const t = convexTest(schema, modules);

    // Insert a record directly
    const id1 = await t.run(async (ctx) => {
      return ctx.db.insert("ai_summary_cache", {
        urlHash: "hash-dedup",
        workspaceSlug: "ws-cache",
        query: "test",
        resultCount: 5,
        resultSetHash: "rsh-old",
        summary: "Old summary",
        model: "gpt-3.5",
        generatedAt: now - 1000,
        expiresAt: now + 3600_000,
      });
    });

    // Insert a second duplicate
    await t.run(async (ctx) => {
      return ctx.db.insert("ai_summary_cache", {
        urlHash: "hash-dedup",
        workspaceSlug: "ws-cache",
        query: "test",
        resultCount: 7,
        resultSetHash: "rsh-new",
        summary: "New summary",
        model: "gpt-4",
        generatedAt: now,
        expiresAt: now + 3600_000,
      });
    });

    // Upsert should keep the newer record and delete the older duplicate
    await t.mutation(api.ai_summary_cache.upsert, {
      urlHash: "hash-dedup",
      workspaceSlug: "ws-cache",
      query: "test",
      resultCount: 8,
      resultSetHash: "rsh-final",
      summary: "Final summary",
      model: "gpt-4",
      generatedAt: now + 2000,
      expiresAt: now + 7200_000,
    });

    // Should only have one record
    const records = await t.run(async (ctx) =>
      ctx.db.query("ai_summary_cache").collect(),
    );
    const matching = records.filter((r) => r.urlHash === "hash-dedup");
    expect(matching).toHaveLength(1);
    expect(matching[0].summary).toBe("Final summary");
  });
});

// ---------------------------------------------------------------------------
// cleanupExpired
// ---------------------------------------------------------------------------

describe("ai_summary_cache: cleanupExpired", () => {
  it("deletes expired records", async () => {
    const t = convexTest(schema, modules);

    const now = Date.now();

    // Insert expired record
    await t.run(async (ctx) => {
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "hash-expired",
        workspaceSlug: "ws-cleanup",
        query: "old",
        resultCount: 1,
        resultSetHash: "rsh-exp",
        summary: "Expired",
        model: "gpt-3.5",
        generatedAt: now - 7200_000,
        expiresAt: now - 1000, // expired
      });
    });

    // Insert non-expired record
    await t.run(async (ctx) => {
      await ctx.db.insert("ai_summary_cache", {
        urlHash: "hash-valid",
        workspaceSlug: "ws-cleanup",
        query: "current",
        resultCount: 2,
        resultSetHash: "rsh-val",
        summary: "Still valid",
        model: "gpt-4",
        generatedAt: now,
        expiresAt: now + 3600_000, // not expired
      });
    });

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now,
    });

    expect(result.deleted).toBe(1);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("ai_summary_cache").collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0].urlHash).toBe("hash-valid");
  });

  it("returns zero when nothing is expired", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.ai_summary_cache.cleanupExpired, {
      now: Date.now(),
    });

    expect(result.deleted).toBe(0);
  });
});
