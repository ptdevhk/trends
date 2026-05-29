/**
 * Convex-test coverage for resumes.ts summary-window queries:
 * - getSummaryWindow: returns total + bySource breakdown for resumes in crawledAt window
 * - listNewForWindow: returns resume list for resumes in crawledAt window
 *
 * Regression tests for the listNewForWindow-broken investigation (2026-05-29):
 * both functions use the by_crawledAt index and must not filter on any status field.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const NOW = 1_780_000_000_000;
const ONE_HOUR = 3_600_000;

describe("resumes: getSummaryWindow", () => {
    it("returns zero total when no resumes exist in window", async () => {
        const t = createTest();
        const result = await t.query(api.resumes.getSummaryWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result.total).toBe(0);
        expect(result.bySource).toEqual([]);
    });

    it("counts resumes whose crawledAt falls within the window", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-in-window-1",
                content: { name: "Wang Xiansheng" },
                hash: "hash-1",
                tags: [],
                crawledAt: NOW - 100,
                source: "51job.com",
            });
            await ctx.db.insert("resumes", {
                externalId: "ext-in-window-2",
                content: { name: "Yang Nushi" },
                hash: "hash-2",
                tags: [],
                crawledAt: NOW - 200,
                source: "51job.com",
            });
            // Outside window — crawledAt too old
            await ctx.db.insert("resumes", {
                externalId: "ext-outside-window",
                content: { name: "Old Candidate" },
                hash: "hash-old",
                tags: [],
                crawledAt: NOW - ONE_HOUR - 1,
                source: "51job.com",
            });
        });

        const result = await t.query(api.resumes.getSummaryWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result.total).toBe(2);
        expect(result.bySource).toHaveLength(1);
        expect(result.bySource[0]).toEqual({ key: "51job.com", count: 2 });
    });

    it("excludes archived resumes from the count", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-active",
                content: {},
                hash: "hash-a",
                tags: [],
                crawledAt: NOW - 50,
                source: "seek.com",
            });
            await ctx.db.insert("resumes", {
                externalId: "ext-archived",
                content: {},
                hash: "hash-b",
                tags: [],
                crawledAt: NOW - 60,
                source: "seek.com",
                isArchived: true,
            });
        });

        const result = await t.query(api.resumes.getSummaryWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result.total).toBe(1);
    });

    it("groups by source in descending count order", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            for (let i = 1; i <= 3; i++) {
                await ctx.db.insert("resumes", {
                    externalId: `seek-${i}`,
                    content: {},
                    hash: `h-seek-${i}`,
                    tags: [],
                    crawledAt: NOW - i * 10,
                    source: "seek.com",
                });
            }
            await ctx.db.insert("resumes", {
                externalId: "51job-1",
                content: {},
                hash: "h-51job-1",
                tags: [],
                crawledAt: NOW - 100,
                source: "51job.com",
            });
        });

        const result = await t.query(api.resumes.getSummaryWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result.total).toBe(4);
        expect(result.bySource[0]!.key).toBe("seek.com");
        expect(result.bySource[0]!.count).toBe(3);
        expect(result.bySource[1]!.key).toBe("51job.com");
        expect(result.bySource[1]!.count).toBe(1);
    });
});

describe("resumes: listNewForWindow", () => {
    it("returns empty list when no resumes exist in window", async () => {
        const t = createTest();
        const result = await t.query(api.resumes.listNewForWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result).toEqual([]);
    });

    it("returns resumes whose crawledAt falls within the window", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-new-1",
                content: { name: "Wang Xiansheng", location: "Shanghai" },
                hash: "hash-new-1",
                tags: [],
                crawledAt: NOW - 100,
                source: "51job.com",
            });
            await ctx.db.insert("resumes", {
                externalId: "ext-new-2",
                content: { name: "Yang Nushi", experience: "5年" },
                hash: "hash-new-2",
                tags: [],
                crawledAt: NOW - 200,
                source: "51job.com",
            });
        });

        const result = await t.query(api.resumes.listNewForWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result).toHaveLength(2);
        expect(result.every((r) => r.crawledAt >= NOW - ONE_HOUR)).toBe(true);
        expect(result.some((r) => r.name === "Wang Xiansheng")).toBe(true);
        expect(result.some((r) => r.name === "Yang Nushi")).toBe(true);
    });

    it("does not filter on any status field — returns regardless of candidate status", async () => {
        // Regression test: previous investigation found count=0 despite known recent resumes.
        // The function must return ALL resumes in the crawledAt window, ignoring any
        // Convex-side status/candidateStatus field (which is never populated — workflow
        // status lives in SQLite candidate_status).
        const t = createTest();

        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-no-status",
                content: { name: "No Status Candidate" },
                hash: "hash-no-status",
                tags: [],
                crawledAt: NOW - 50,
                source: "51job.com",
                // No status field — simulates production resumes where status is null
            });
        });

        const result = await t.query(api.resumes.listNewForWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.source).toBe("51job.com");
    });

    it("excludes archived resumes", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-live",
                content: {},
                hash: "hash-live",
                tags: [],
                crawledAt: NOW - 50,
                source: "seek.com",
            });
            await ctx.db.insert("resumes", {
                externalId: "ext-archived",
                content: {},
                hash: "hash-arch",
                tags: [],
                crawledAt: NOW - 60,
                source: "seek.com",
                isArchived: true,
            });
        });

        const result = await t.query(api.resumes.listNewForWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
        });
        expect(result).toHaveLength(1);
        expect(result[0]!.resumeId).toBeDefined();
    });

    it("respects the limit parameter", async () => {
        const t = createTest();

        await t.run(async (ctx) => {
            for (let i = 0; i < 5; i++) {
                await ctx.db.insert("resumes", {
                    externalId: `ext-limit-${i}`,
                    content: {},
                    hash: `hash-limit-${i}`,
                    tags: [],
                    crawledAt: NOW - i * 10,
                    source: "seek.com",
                });
            }
        });

        const result = await t.query(api.resumes.listNewForWindow, {
            fromTimestamp: NOW - ONE_HOUR,
            toTimestamp: NOW,
            limit: 3,
        });
        expect(result).toHaveLength(3);
    });
});
