/**
 * Integration tests using convex-test for candidate_blocks.ts CRUD functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
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

describe("candidate_blocks (convex-test)", () => {
  describe("list", () => {
    it("returns empty array when no blocks exist", async () => {
      const t = createTest();
      const result = await t.query(api.candidate_blocks.list, {});
      expect(result).toEqual([]);
    });

    it("returns blocks filtered by workspaceSlug", async () => {
      const t = createTest();

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
      const t = createTest();

      const result = await t.query(api.candidate_blocks.list, {});
      expect(result).toEqual([]);
    });
  });

  describe("getByIdentity", () => {
    it("returns null for non-existent identity", async () => {
      const t = createTest();
      const result = await t.query(api.candidate_blocks.getByIdentity, {
        identityKey: "nonexistent",
      });
      expect(result).toBeNull();
    });

    it("returns block by identity key", async () => {
      const t = createTest();

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
      const t = createTest();
      const result = await t.query(api.candidate_blocks.getByIdentity, {
        identityKey: "  ",
      });
      expect(result).toBeNull();
    });
  });

  describe("upsert", () => {
    it("inserts a new block", async () => {
      const t = createTest();

      const id = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-new",
        reason: "fraud",
        writeSecret: WRITE_SECRET,
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
      const t = createTest();

      const id1 = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-dup",
        reason: "first",
        writeSecret: WRITE_SECRET,
      });

      const id2 = await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-dup",
        reason: "second",
        blockedBy: "admin",
        writeSecret: WRITE_SECRET,
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
      const t = createTest();
      await expect(
        t.mutation(api.candidate_blocks.upsert, {
          identityKey: "  ",
          writeSecret: WRITE_SECRET,
        }),
      ).rejects.toThrow("identityKey is required");
    });
  });

  describe("updateReason", () => {
    it("updates reason for existing block", async () => {
      const t = createTest();

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
        reason: "old",
        writeSecret: WRITE_SECRET,
      });

      const updated = await t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
        reason: "new reason",
        writeSecret: WRITE_SECRET,
      });
      expect(updated).toBe(true);

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-upd",
      });
      expect(block!.reason).toBe("new reason");
    });

    it("returns false for non-existent block", async () => {
      const t = createTest();
      const updated = await t.mutation(api.candidate_blocks.updateReason, {
        workspaceSlug: "ws1",
        identityKey: "nonexistent",
        reason: "test",
        writeSecret: WRITE_SECRET,
      });
      expect(updated).toBe(false);
    });
  });

  describe("bulkUpsert", () => {
    it("inserts multiple blocks", async () => {
      const t = createTest();

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-a", "user-b", "user-c"],
        reason: "bulk",
        writeSecret: WRITE_SECRET,
      });

      expect(result.total).toBe(3);
      expect(result.inserted).toBe(3);
      expect(result.updated).toBe(0);
    });

    it("deduplicates identity keys", async () => {
      const t = createTest();

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-x", "user-x", "user-y"],
        reason: "dedup",
        writeSecret: WRITE_SECRET,
      });

      expect(result.total).toBe(2);
      expect(result.inserted).toBe(2);
    });

    it("updates existing and inserts new blocks", async () => {
      const t = createTest();

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-exist",
        reason: "original",
        writeSecret: WRITE_SECRET,
      });

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-exist", "user-new"],
        reason: "bulk",
        writeSecret: WRITE_SECRET,
      });

      expect(result.total).toBe(2);
      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(1);
    });

    it("filters out empty identity keys", async () => {
      const t = createTest();

      const result = await t.mutation(api.candidate_blocks.bulkUpsert, {
        workspaceSlug: "ws1",
        identityKeys: ["user-ok", "  ", ""],
        reason: "filter",
        writeSecret: WRITE_SECRET,
      });

      expect(result.total).toBe(1);
    });
  });

  describe("remove", () => {
    it("removes an existing block", async () => {
      const t = createTest();

      await t.mutation(api.candidate_blocks.upsert, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
        writeSecret: WRITE_SECRET,
      });

      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
        writeSecret: WRITE_SECRET,
      });
      expect(removed).toBe(true);

      const block = await t.query(api.candidate_blocks.getByIdentity, {
        workspaceSlug: "ws1",
        identityKey: "user-del",
      });
      expect(block).toBeNull();
    });

    it("returns false for non-existent block", async () => {
      const t = createTest();
      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "nonexistent",
        writeSecret: WRITE_SECRET,
      });
      expect(removed).toBe(false);
    });

    it("returns false for empty identityKey", async () => {
      const t = createTest();
      const removed = await t.mutation(api.candidate_blocks.remove, {
        workspaceSlug: "ws1",
        identityKey: "  ",
        writeSecret: WRITE_SECRET,
      });
      expect(removed).toBe(false);
    });
  });
});
