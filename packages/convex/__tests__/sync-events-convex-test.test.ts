/**
 * Integration tests using convex-test for sync_events.ts functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api } from "../convex/_generated/api.js";


describe("sync_events (convex-test)", () => {
  describe("recordError", () => {
    it("inserts an error event", async () => {
      const t = createTest();

      await t.mutation(api.sync_events.recordError, {
        source: "51job",
        error: "Network timeout",
      });

      const latest = await t.query(api.sync_events.getLatest, {});
      expect(latest).not.toBeNull();
      expect(latest!.source).toBe("51job");
      expect(latest!.status).toBe("error");
      expect(latest!.error).toBe("Network timeout");
    });
  });

  describe("getLatest", () => {
    it("returns null when no events exist", async () => {
      const t = createTest();
      const result = await t.query(api.sync_events.getLatest, {});
      expect(result).toBeNull();
    });

    it("returns the most recent event", async () => {
      const t = createTest();

      await t.run(async (ctx) => {
        await ctx.db.insert("sync_events", {
          source: "51job",
          status: "success",
          submitted: 10,
          inserted: 5,
          updated: 3,
          unchanged: 2,
          timestamp: 1000,
        });
        await ctx.db.insert("sync_events", {
          source: "seek",
          status: "success",
          submitted: 20,
          inserted: 8,
          updated: 6,
          unchanged: 6,
          timestamp: 2000,
        });
      });

      const latest = await t.query(api.sync_events.getLatest, {});
      expect(latest).not.toBeNull();
      expect(latest!.source).toBe("seek");
    });
  });

  describe("cleanup", () => {
    let dateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Lock Date.now to a fixed value for deterministic cleanup cutoff
      dateSpy = vi.spyOn(Date, "now").mockReturnValue(10_000_000);
    });

    afterEach(() => {
      dateSpy.mockRestore();
    });

    it("deletes stale events older than 1 hour", async () => {
      const t = createTest();
      const STALE_EVENT_MS = 3_600_000;

      await t.run(async (ctx) => {
        // Stale event (older than 1 hour)
        await ctx.db.insert("sync_events", {
          source: "51job",
          status: "success",
          submitted: 1,
          inserted: 0,
          updated: 0,
          unchanged: 1,
          timestamp: 10_000_000 - STALE_EVENT_MS - 1000,
        });
        // Recent event (within 1 hour)
        await ctx.db.insert("sync_events", {
          source: "seek",
          status: "success",
          submitted: 5,
          inserted: 2,
          updated: 2,
          unchanged: 1,
          timestamp: 10_000_000 - STALE_EVENT_MS + 1000,
        });
      });

      const result = await t.mutation(api.sync_events.cleanup, {});
      expect(result.deleted).toBe(1);

      const latest = await t.query(api.sync_events.getLatest, {});
      expect(latest).not.toBeNull();
      expect(latest!.source).toBe("seek");
    });

    it("returns zero deleted when no stale events", async () => {
      const t = createTest();

      await t.run(async (ctx) => {
        await ctx.db.insert("sync_events", {
          source: "51job",
          status: "success",
          submitted: 1,
          inserted: 0,
          updated: 0,
          unchanged: 1,
          timestamp: 10_000_000 - 1000,
        });
      });

      const result = await t.mutation(api.sync_events.cleanup, {});
      expect(result.deleted).toBe(0);
    });

    it("respects MAX_CLEANUP_BATCH limit", async () => {
      const t = createTest();
      const STALE_EVENT_MS = 3_600_000;
      const staleTs = 10_000_000 - STALE_EVENT_MS - 1000;

      // Insert 25 stale events (exceeds MAX_CLEANUP_BATCH=20)
      await t.run(async (ctx) => {
        for (let i = 0; i < 25; i++) {
          await ctx.db.insert("sync_events", {
            source: `source-${i}`,
            status: "success",
            submitted: 0,
            inserted: 0,
            updated: 0,
            unchanged: 0,
            timestamp: staleTs + i,
          });
        }
      });

      const result = await t.mutation(api.sync_events.cleanup, {});
      expect(result.deleted).toBe(20);
    });
  });
});
