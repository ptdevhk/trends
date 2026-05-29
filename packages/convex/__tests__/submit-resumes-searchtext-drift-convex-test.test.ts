/**
 * Convex-test coverage for searchText refresh tracking in submitResumes.
 *
 * Regression tests for the searchtext-rejected-count-drift investigation (2026-05-29):
 * When a hash-changed resume gets a new searchText, the sync_event must record
 * searchTextRefreshed > 0 so operators can correlate with candidate_status in SQLite.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

describe("resume_tasks: submitResumes — searchTextRefreshed tracking", () => {
    it("records searchTextRefreshed=0 when no resumes are hash-changed", async () => {
        const t = createTest();

        // First submission — all inserts, no hash changes
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                {
                    externalId: "ext-fresh",
                    content: { name: "New Candidate" },
                    hash: "hash-v1",
                    source: "51job.com",
                    tags: [],
                },
            ],
        });

        const event = await t.run(async (ctx) => {
            return ctx.db
                .query("sync_events")
                .withIndex("by_timestamp")
                .order("desc")
                .first();
        });

        expect(event).toBeDefined();
        expect(event!.inserted).toBe(1);
        expect(event!.updated).toBe(0);
        expect(event!.searchTextRefreshed).toBe(0);
    });

    it("records searchTextRefreshed=1 when a hash-changed resume gets a new searchText", async () => {
        const t = createTest();

        // Seed an existing resume without searchText
        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-existing",
                identityKey: "externalId:ext-existing",
                content: { name: "Existing Candidate" },
                hash: "hash-v1",
                source: "51job.com",
                tags: [],
                crawledAt: Date.now() - 10_000,
                // No searchText — will gain one on hash-changed update
            });
        });

        // Submit same resume with a different hash and enriched content (adds searchText)
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                {
                    externalId: "ext-existing",
                    content: { name: "Existing Candidate", skills: "CNC 数控" },
                    hash: "hash-v2",
                    source: "51job.com",
                    tags: [],
                },
            ],
        });

        const event = await t.run(async (ctx) => {
            return ctx.db
                .query("sync_events")
                .withIndex("by_timestamp")
                .order("desc")
                .first();
        });

        expect(event).toBeDefined();
        expect(event!.updated).toBe(1);
        expect(event!.searchTextRefreshed).toBe(1);
    });

    it("records correct searchTextRefreshed count across a mixed batch", async () => {
        const t = createTest();

        // Seed 2 existing resumes
        await t.run(async (ctx) => {
            await ctx.db.insert("resumes", {
                externalId: "ext-a",
                identityKey: "externalId:ext-a",
                content: { name: "Candidate A" },
                hash: "hash-a-v1",
                source: "51job.com",
                tags: [],
                crawledAt: Date.now() - 10_000,
            });
            await ctx.db.insert("resumes", {
                externalId: "ext-b",
                identityKey: "externalId:ext-b",
                content: { name: "Candidate B" },
                hash: "hash-b-v1",
                source: "51job.com",
                tags: [],
                crawledAt: Date.now() - 20_000,
                searchText: "cnc",
            });
        });

        // Submit batch: 1 new, ext-a hash-changed, ext-b hash-changed
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                {
                    externalId: "ext-new",
                    content: { name: "New Candidate" },
                    hash: "hash-new",
                    source: "51job.com",
                    tags: [],
                },
                {
                    externalId: "ext-a",
                    content: { name: "Candidate A", skills: "CNC" },
                    hash: "hash-a-v2",
                    source: "51job.com",
                    tags: [],
                },
                {
                    externalId: "ext-b",
                    content: { name: "Candidate B", skills: "数控 销售" },
                    hash: "hash-b-v2",
                    source: "51job.com",
                    tags: [],
                },
            ],
        });

        const event = await t.run(async (ctx) => {
            return ctx.db
                .query("sync_events")
                .withIndex("by_timestamp")
                .order("desc")
                .first();
        });

        expect(event).toBeDefined();
        expect(event!.inserted).toBe(1);
        expect(event!.updated).toBe(2);
        // Both ext-a and ext-b were hash-changed and got new searchText
        expect(event!.searchTextRefreshed).toBe(2);
    });
});
