import { describe, expect, it } from "vitest";
import { createTest } from "./test-helpers.js";
import { api, internal } from "../convex/_generated/api.js";

describe("system_settings", () => {
    it("returns the default resume work-history limit when no row exists", async () => {
        const t = createTest();
        const result = await t.query(api.system_settings.getResumeWorkHistoryLimit, {});
        expect(result).toBe(3);
    });

    it("sets and returns a validated resume work-history limit", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.setResumeWorkHistoryLimit, {
            limit: 5,
            updatedBy: "admin@example.com",
        });

        expect(await t.query(api.system_settings.getResumeWorkHistoryLimit, {})).toBe(5);
        expect(await t.query(api.system_settings.get, { key: "resumeWorkHistoryLimit" })).toBe(5);
    });

    it.each([0, 11, 2.5])("rejects invalid resume work-history limit %s", async (limit) => {
        const t = createTest();
        await expect(t.mutation(api.system_settings.setResumeWorkHistoryLimit, {
            limit,
            updatedBy: "admin@example.com",
        })).rejects.toThrow("between 1 and 10");
    });

    it("falls back to three when a raw stored value is invalid", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.set, {
            key: "resumeWorkHistoryLimit",
            value: 99,
            updatedBy: "legacy-script",
        });

        expect(await t.query(api.system_settings.getResumeWorkHistoryLimit, {})).toBe(3);
    });

    it("isMaintenanceMode returns false when no row exists", async () => {
        const t = createTest();
        const result = await t.query(api.system_settings.isMaintenanceMode, {});
        expect(result).toBe(false);
    });

    it("isMaintenanceMode returns true after set", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.set, {
            key: "maintenanceMode",
            value: true,
            updatedBy: "test",
            reason: "testing",
        });
        const result = await t.query(api.system_settings.isMaintenanceMode, {});
        expect(result).toBe(true);
    });

    it("get returns null for missing key", async () => {
        const t = createTest();
        const result = await t.query(api.system_settings.get, { key: "nonexistent" });
        expect(result).toBeNull();
    });

    it("set then get round-trips the value", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.set, {
            key: "maintenanceMode",
            value: true,
            updatedBy: "restore-script",
        });
        const result = await t.query(api.system_settings.get, { key: "maintenanceMode" });
        expect(result).toBe(true);
    });
});

describe("cron maintenance guard", () => {
    it("ai_summary_cache.cleanupExpired skips when maintenance mode active", async () => {
        const t = createTest();
        const now = Date.now();

        // Insert an expired summary that would normally be cleaned up
        await t.run(async (ctx) => {
            await ctx.db.insert("ai_summary_cache", {
                urlHash: "hash-guard",
                workspaceSlug: "ws-guard",
                query: "test",
                resultCount: 1,
                resultSetHash: "rsh-guard",
                summary: "Should survive",
                model: "gpt-4",
                generatedAt: now - 7200_000,
                expiresAt: now - 1000, // expired
            });
        });

        // Enable maintenance mode
        await t.mutation(api.system_settings.set, {
            key: "maintenanceMode",
            value: true,
            updatedBy: "test",
        });

        // Run the cron handler — it should skip without deleting anything
        const before = await t.query(api.ai_summary_cache.count, {});
        await t.mutation(internal.ai_summary_cache.cleanupExpired, { now });
        const after = await t.query(api.ai_summary_cache.count, {});

        expect(after).toBe(before); // unchanged — cron skipped
    });
});
