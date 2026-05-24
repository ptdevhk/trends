/**
 * Integration tests using convex-test for embeddings.ts functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 * Internal functions (internalQuery/internalMutation) are accessed via internal API reference.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import { internal } from "../_generated/api.js";
import schema from "../schema.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import { rrfMerge } from "../embeddings.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("embeddings (convex-test)", () => {
  describe("storeEmbedding (internal)", () => {
    it("creates new embedding and links to resume", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "ext-1",
          identityKey: "id-1",
          content: {},
          hash: "abc123",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Test resume text",
        });
      });

      const embeddingId = await t.mutation(internal.embeddings.storeEmbedding, {
        resumeId,
        embedding: new Array(1536).fill(0.1),
        model: "text-embedding-3-small",
        sourceKey: "seek",
      });

      expect(embeddingId).toBeDefined();

      // Verify back-link on resume
      const resume = await t.run(async (ctx) => {
        return ctx.db.get(resumeId);
      });
      expect(resume?.embeddingId).toBe(embeddingId);

      // Verify embedding document
      const embedding = await t.run(async (ctx) => {
        return ctx.db.get(embeddingId);
      }) as Doc<"resume_embeddings"> | null;
      expect(embedding?.resumeId).toBe(resumeId);
      expect(embedding?.model).toBe("text-embedding-3-small");
      expect(embedding?.sourceKey).toBe("seek");
    });

    it("replaces existing embedding on upsert", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "ext-2",
          content: {},
          hash: "def456",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Another resume",
        });
      });

      const firstId = await t.mutation(internal.embeddings.storeEmbedding, {
        resumeId,
        embedding: new Array(1536).fill(0.2),
        model: "text-embedding-3-small",
      });

      const secondId = await t.mutation(internal.embeddings.storeEmbedding, {
        resumeId,
        embedding: new Array(1536).fill(0.3),
        model: "text-embedding-3-small-v2",
      });

      // Should update in-place, not create a new row
      expect(secondId).toBe(firstId);

      const embedding = await t.run(async (ctx) => {
        return ctx.db.get(firstId);
      }) as Doc<"resume_embeddings"> | null;
      expect(embedding?.model).toBe("text-embedding-3-small-v2");
    });
  });

  describe("getResumeForEmbedding (internal)", () => {
    it("returns resume by id", async () => {
      const t = convexTest(schema, modules);

      const resumeId = await t.run(async (ctx) => {
        return ctx.db.insert("resumes", {
          externalId: "ext-3",
          content: { name: "Test User" },
          hash: "ghi789",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Test user resume",
        });
      });

      const resume = await t.query(internal.embeddings.getResumeForEmbedding, {
        resumeId,
      });
      expect(resume).not.toBeNull();
      expect(resume!.externalId).toBe("ext-3");
    });

    it("returns null for non-existent resume", async () => {
      const t = convexTest(schema, modules);

      // Create and delete a resume to get a valid-looking ID that doesn't exist
      const tempId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("resumes", {
          externalId: "temp-delete",
          content: {},
          hash: "temp",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
        await ctx.db.delete(id);
        return id;
      });

      const resume = await t.query(internal.embeddings.getResumeForEmbedding, {
        resumeId: tempId,
      });
      expect(resume).toBeNull();
    });
  });

  describe("getResumesWithoutEmbeddings (internal)", () => {
    it("returns resumes without embeddingId", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("resumes", {
          externalId: "no-emb-1",
          content: {},
          hash: "no1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "No embedding",
        });
      });

      const result = await t.query(internal.embeddings.getResumesWithoutEmbeddings, {
        numItems: 10,
      });

      expect(result.resumes.length).toBeGreaterThanOrEqual(1);
      expect(result.resumes.every((r: any) => r.embeddingId === undefined)).toBe(true);
    });
  });

  describe("getEmbeddingsByIds (internal)", () => {
    it("returns embeddings for given ids", async () => {
      const t = convexTest(schema, modules);

      const { resumeId, embeddingId } = await t.run(async (ctx) => {
        const resumeId = await ctx.db.insert("resumes", {
          externalId: "ext-emb-1",
          content: {},
          hash: "emb1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Resume with embedding",
        });
        const embeddingId = await ctx.db.insert("resume_embeddings", {
          resumeId,
          embedding: new Array(1536).fill(0.5),
          model: "text-embedding-3-small",
          sourceKey: "seek",
          generatedAt: Date.now(),
        });
        await ctx.db.patch(resumeId, { embeddingId });
        return { resumeId, embeddingId };
      });

      const results = await t.query(internal.embeddings.getEmbeddingsByIds, {
        embeddingIds: [embeddingId],
      });
      expect(results.length).toBe(1);
      expect(results[0].resumeId).toBe(resumeId);
    });

    it("filters out null results for non-existent ids", async () => {
      const t = convexTest(schema, modules);

      // Create and delete an embedding to get a valid-looking ID that doesn't exist
      const tempId = await t.run(async (ctx) => {
        const resumeId = await ctx.db.insert("resumes", {
          externalId: "temp-emb-del",
          content: {},
          hash: "temb",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
        });
        const embId = await ctx.db.insert("resume_embeddings", {
          resumeId,
          embedding: new Array(1536).fill(0),
          model: "test",
          generatedAt: Date.now(),
        });
        await ctx.db.delete(embId);
        return embId;
      });

      const results = await t.query(internal.embeddings.getEmbeddingsByIds, {
        embeddingIds: [tempId],
      });
      expect(results.length).toBe(0);
    });
  });

  describe("getEmbeddingStats (public)", () => {
    it("returns empty stats when no embeddings exist", async () => {
      const t = convexTest(schema, modules);

      const stats = await t.query(api.embeddings.getEmbeddingStats, {});
      expect(stats.hasEmbeddings).toBe(false);
      expect(stats.latestModel).toBeNull();
    });

    it("returns stats when embeddings exist", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        const resumeId = await ctx.db.insert("resumes", {
          externalId: "ext-stats",
          content: {},
          hash: "stats1",
          tags: [],
          crawledAt: Date.now(),
          source: "test",
          searchText: "Stats resume",
        });
        const embeddingId = await ctx.db.insert("resume_embeddings", {
          resumeId,
          embedding: new Array(1536).fill(0.7),
          model: "text-embedding-3-small",
          generatedAt: Date.now(),
        });
        await ctx.db.patch(resumeId, { embeddingId });
      });

      const stats = await t.query(api.embeddings.getEmbeddingStats, {});
      expect(stats.hasEmbeddings).toBe(true);
      expect(stats.latestModel).toBe("text-embedding-3-small");
      expect(stats.latestGeneratedAt).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for RRF merge logic (pure function, no Convex needed)
// ---------------------------------------------------------------------------

describe("rrfMerge (unit)", () => {
  it("merges BM25 and vector results with RRF scoring", () => {
    const bm25Results = [
      { id: "r1", data: { name: "Alice" } },
      { id: "r2", data: { name: "Bob" } },
      { id: "r3", data: { name: "Carol" } },
    ];
    const vectorResults = [
      { id: "r2" },  // Also in BM25 (rank 2) → gets both scores
      { id: "r4" },  // Vector-only → gets only semantic score
      { id: "r1" },  // Also in BM25 (rank 1) → gets both scores
    ];

    const result = rrfMerge({
      bm25Results,
      vectorResults,
      bm25Weight: 0.5,
      semanticWeight: 0.5,
    });

    expect(result.bm25Count).toBe(3);
    expect(result.vectorCount).toBe(3);
    expect(result.merged.length).toBe(4); // r1, r2, r3, r4

    // r1 and r2 should rank highest (both BM25 + vector contributions)
    const topIds = result.merged.slice(0, 2).map((r) => r.id);
    expect(topIds).toContain("r1");
    expect(topIds).toContain("r2");
  });

  it("returns BM25 order when no vector results", () => {
    const bm25Results = [
      { id: "r1", data: { name: "Alice" } },
      { id: "r2", data: { name: "Bob" } },
    ];

    const result = rrfMerge({
      bm25Results,
      vectorResults: [],
      bm25Weight: 0.5,
      semanticWeight: 0.5,
    });

    expect(result.merged.length).toBe(2);
    expect(result.merged[0].id).toBe("r1");
    expect(result.merged[1].id).toBe("r2");
  });

  it("returns vector order when no BM25 results", () => {
    const vectorResults = [
      { id: "r1" },
      { id: "r2" },
    ];

    const result = rrfMerge({
      bm25Results: [],
      vectorResults,
      bm25Weight: 0.5,
      semanticWeight: 0.5,
    });

    expect(result.merged.length).toBe(2);
    expect(result.merged[0].id).toBe("r1");
    expect(result.merged[0].data).toEqual({}); // No BM25 data
  });

  it("applies weight asymmetry correctly", () => {
    const bm25Results = [
      { id: "r1", data: {} },
    ];
    const vectorResults = [
      { id: "r2" },
    ];

    // With 100% BM25 weight, r1 should score higher
    const bm25Heavy = rrfMerge({
      bm25Results,
      vectorResults: [{ id: "r2" }],
      bm25Weight: 1.0,
      semanticWeight: 0.0,
    });
    expect(bm25Heavy.merged[0].id).toBe("r1");

    // With 100% semantic weight, r2 should score higher
    const semanticHeavy = rrfMerge({
      bm25Results,
      vectorResults: [{ id: "r2" }],
      bm25Weight: 0.0,
      semanticWeight: 1.0,
    });
    expect(semanticHeavy.merged[0].id).toBe("r2");
  });

  it("deduplicates when same ID appears in both lists", () => {
    const bm25Results = [
      { id: "r1", data: { source: "bm25" } },
    ];
    const vectorResults = [
      { id: "r1" },  // Same resume in both
    ];

    const result = rrfMerge({
      bm25Results,
      vectorResults,
      bm25Weight: 0.5,
      semanticWeight: 0.5,
    });

    expect(result.merged.length).toBe(1);
    expect(result.merged[0].id).toBe("r1");
    // Data comes from BM25 (primary source)
    expect(result.merged[0].data).toEqual({ source: "bm25" });
  });
});
