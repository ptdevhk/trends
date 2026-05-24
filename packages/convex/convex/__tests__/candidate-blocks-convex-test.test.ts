/**
 * Integration tests using convex-test for candidate_blocks.ts CRUD functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("candidate_blocks (convex-test)", () => {
  describe("list", () => {
    it("returns empty array when no blocks exist", async () => {
      const t = convexTest(schema, modules);
      const result = await t.query(api.candidate_blocks.list, {});
      expect(result).toEqual([]);
    });

    it("returns blocks filtered by workspaceSlug", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("candidate_blocks", {
          workspaceSlug: "ws1",
          identityKey: "id1",
          blockedAt: Date.now(),
        });
        await ctx.db.insert("candidate_blocks", {
          workspaceSlug: "ws2",
          identityKey: "id2",
          blockedAt: Date.now(),
        });
      });

      const result = await t.query(api.candidate_blocks.list, {
        workspaceSlug: "ws1",
      });
      expect(result).toHaveLength(1);
      expect(result[0].identityKey).toBe("id1");
    });

    it("defaults workspaceSlug when not provided", async () => {
      const t = convexTest(schema, modules);

      const result = await t.query(api.candidate_blocks.list, {});
      expect(result).toEqual([]);
    });
  });

  describe("getByIdentity", () => {
    it("returns null for non-existent identity", async () => {
      const t = convexTest(schema, modules);
      const result = await t.query(api.candidate_blocks.getByIdentity, {
        identityKey: "nonexistent",
      });
      expect(result).toBeNull();
    });

    it("returns block by identity key", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("candidate_blocks", {
          workspaceSlug: "ws1",
          identityKey: "user-123",
          reason: "spam",
          blockedAt: Date.now(),
        });
      });

      const result = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-123",
      });
      expect(result).not.toBeNull();
      expect(result!.identityKey).toBe("user-123");
      expect(result!.reason).toBe("spam");
    });

    it("returns null for empty identityKey", async () => {
      const t = convexTest(schema, modules);
      const result = await t.query(api.candidate_blocks.getByIdentity, {
        identityKey: "  ",
      });
      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("inserts a new block", async () => {
      const t = convexTest(schema, modules);

      const id = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-new",
        reason: "fraud",
      });

      expect(id).toBeDefined();

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-new",
      });
      expect(block).not.toBeNull();
      expect(block!.reason).toBe("fraud");
    });

    it("updates existing block on second upsert", async () => {
      const t = convexTest(schema, modules);

      const id1 = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-dup",
        reason: "first",
      });

      const id2 = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-dup",
        reason: "second",
        blockedBy: "admin",
      });

      expect(id2).toBe(id1);

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-dup",
      });
      expect(block!.reason).toBe("second");
      expect(block!.blockedBy).toBe("admin");
    });

    it("throws for empty identityKey", async () => {
      const t = convexTest(schema, modules);
      await expect(
        t.mutation(api.candidate_blocks.upsert, {
          identityKey: "  ",
        }),
      ).rejects.toThrow("identityKey is required");
    });
  });

  describe("updateReason", () => {
    it("updates reason for existing block", async () => {
      const t = convexTest(schema, modules);

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
        reason: "old",
      });

      const updated = await t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
        reason: "new reason",
      });
      expect(updated).toBe(true);

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
      });
      expect(block!.reason).toBe("new reason");
    });

    it("returns false for non-existent block", async () => {
      const t = convexTest(schema, modules);
      const updated = await t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "ws1",
        identityKey: "nonexistent",
        reason: "test",
      });
      expect(updated).toBe(false);
    });
  });

  describe("bulkUpsert", () => {
    it("inserts multiple blocks", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-a", "user-b", "user-c"],
        reason: "bulk",
      });

      expect(result.total).toBe(3);
      expect(result.inserted).toBe(3);
      expect(result.updated).toBe(0);
    });

    it("deduplicates identity keys", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-x", "user-x", "user-y"],
        reason: "dedup",
      });

      expect(result.total).toBe(2);
      expect(result.inserted).toBe(2);
    });

    it("updates existing and inserts new blocks", async () => {
      const t = convexTest(schema, modules);

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-exist",
        reason: "original",
      });

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-exist", "user-new"],
        reason: "bulk",
      });

      expect(result.total).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(1);
    });

    it("filters out empty identity keys", async () => {
      const t = convexTest(schema, modules);

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-ok", "  ", ""],
        reason: "filter",
      });

      expect(result.total).toBe(1);
    });
  });

  describe("remove", () => {
    it("removes an existing block", async () => {
      const t = convexTest(schema, modules);

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
      });

      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
      });
      expect(removed).toBe(true);

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
      });
      expect(block).toBeNull();
    });

    it("returns false for non-existent block", async () => {
      const t = convexTest(schema, modules);
      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "nonexistent",
      });
      expect(removed).toBe(false);
    });

    it("returns false for empty identityKey", async () => {
      const t = convexTest(schema, modules);
      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "  ",
      });
      expect(removed).toBe(false);
    });
  });
});
