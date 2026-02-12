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
            autoAnalyze: v.optional(v.boolean()),
            analysisTopN: v.optional(v.number()),
        }),
        status: v.union(
            v.literal("pending"),
            v.literal("processing"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        progress: v.object({
            current: v.number(),
            total: v.number(),
            page: v.number(),
        }),
        results: v.optional(v.object({
            extracted: v.number(),
            submitted: v.number(),
            deduped: v.number(),
            inserted: v.number(),
            updated: v.number(),
            unchanged: v.number(),
            autoAnalyzed: v.optional(v.number()),
            autoAnalysisTaskId: v.optional(v.string()),
        })),
        workerId: v.optional(v.string()), // ID of the worker processing this task
        lastStatus: v.optional(v.string()), // Real-time status message (e.g. "Scraping page 2")
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

        // AI Analysis Cache (Multi-JD Support)
        // Key: jobDescriptionId (or 'default')
        // Value: Analysis object
        analyses: v.optional(v.any()),

        // Full Text Search Field (Populated via mutation)
        searchText: v.optional(v.string()),
    })
        .index("by_externalId", ["externalId"])
        .index("by_hash", ["hash"])
        .searchIndex("search_body", {
            searchField: "searchText",
        }),

    // Optional: Search Profiles (if we want to store user configs)
    search_profiles: defineTable({
        name: v.string(),
        criteria: v.object({
            keywords: v.array(v.string()),
            locations: v.array(v.string()),
        }),
        lastRunAt: v.optional(v.number()),
    }),

    // Custom Job Descriptions
    job_descriptions: defineTable({
        title: v.string(),
        content: v.string(), // Markdown requirements
        type: v.string(), // 'system' | 'custom'
        userId: v.optional(v.string()), // For future multi-user
        enabled: v.boolean(),
        lastModified: v.number(),
    }),

    analysis_tasks: defineTable({
        config: v.object({
            jobDescriptionId: v.optional(v.string()),
            jobDescriptionTitle: v.optional(v.string()),
            jobDescriptionContent: v.optional(v.string()),
            keywords: v.optional(v.array(v.string())),
            sample: v.optional(v.string()),
            resumeCount: v.number(),
        }),
        status: v.union(
            v.literal("pending"),
            v.literal("processing"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        progress: v.object({
            current: v.number(),
            total: v.number(),
            skipped: v.number(),
        }),
        results: v.optional(v.object({
            analyzed: v.number(),
            skipped: v.number(),
            failed: v.number(),
            avgScore: v.number(),
            highScoreCount: v.number(),
        })),
        lastStatus: v.optional(v.string()),
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),
});
