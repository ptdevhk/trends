import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    // Tasks for resume collection
    collection_tasks: defineTable({
        config: v.object({
            keyword: v.string(),
            location: v.string(),
            limit: v.number(),
            maxPages: v.optional(v.number()),
        }),
        status: v.union(
            v.literal("pending"),
            v.literal("processing"),
            v.literal("completed"),
            v.literal("failed")
        ),
        progress: v.object({
            current: v.number(),
            total: v.number(),
            page: v.number(),
        }),
        workerId: v.optional(v.string()), // ID of the worker processing this task
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()), // Timestamp
        completedAt: v.optional(v.number()), // Timestamp
    })
        .index("by_status", ["status"])
        .index("by_worker", ["workerId"]),

    // Resumes repository (deduplicated)
    resumes: defineTable({
        externalId: v.string(), // e.g. from job site
        content: v.any(), // JSON payload from crawler
        hash: v.string(), // Content hash for change detection
        tags: v.array(v.string()), // e.g. search profile IDs
        crawledAt: v.number(),
        source: v.string(), // e.g. "hr.job5156.com"

        // AI Analysis
        analysis: v.optional(v.object({
            score: v.number(),
            summary: v.string(),
            highlights: v.array(v.string()),
            recommendation: v.string(),
            breakdown: v.optional(v.any()), // Stores detailed scores per category
            jobDescriptionId: v.optional(v.string()), // Tracks which JD was used for analysis
        })),
    })
        .index("by_externalId", ["externalId"])
        .index("by_hash", ["hash"]),

    // Optional: Search Profiles (if we want to store user configs)
    search_profiles: defineTable({
        name: v.string(),
        criteria: v.object({
            keywords: v.array(v.string()),
            locations: v.array(v.string()),
        }),
        lastRunAt: v.optional(v.number()),
    }),
});
