import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { ingestDataValidator, collectionTaskResultsValidator } from "./validators.js";

export default defineSchema({
    // Tasks for resume collection
    collection_tasks: defineTable({
        config: v.object({
            keyword: v.string(),
            location: v.string(),
            limit: v.number(),
            maxPages: v.optional(v.number()),
            minAge: v.optional(v.number()),
            maxAge: v.optional(v.number()),
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
        results: v.optional(collectionTaskResultsValidator),
        workerId: v.optional(v.string()), // ID of the worker processing this task
        lastStatus: v.optional(v.string()), // Real-time status message (e.g. "Scraping page 2")
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()), // Timestamp
        completedAt: v.optional(v.number()), // Timestamp
    })
        .index("by_status", ["status"])
        .index("by_worker", ["workerId"])
        .index("by_completedAt", ["completedAt"]),

    collection_workers: defineTable({
        workerId: v.string(),
        state: v.union(
            v.literal("idle"),
            v.literal("processing"),
            v.literal("error")
        ),
        lastHeartbeatAt: v.number(),
        activeTaskId: v.optional(v.id("collection_tasks")),
        lastError: v.optional(v.string()),
    })
        .index("by_workerId", ["workerId"])
        .index("by_lastHeartbeatAt", ["lastHeartbeatAt"]),

    // Resumes repository (deduplicated)
    resumes: defineTable({
        externalId: v.string(), // e.g. from job site
        identityKey: v.optional(v.string()),
        age: v.optional(v.number()),
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
            promptVersion: v.optional(v.number()),
            locale: v.optional(v.string()),
            queryLocation: v.optional(v.string()),
            analyzedAt: v.optional(v.number()),
        })),

        // AI Analysis Cache (Multi-JD + source-aware support)
        // Key: `source:<sourceKey>|analysis:<jobDescriptionId>` when the resume source is known,
        //       otherwise the legacy bare `jobDescriptionId` / `default` key.
        // Value: Analysis object (the payload keeps bare jobDescriptionId for compatibility)
        analyses: v.optional(v.any()),

        // AI Confirm Score (cost-gated L4 batch confirm pass)
        confirmedScore: v.optional(v.number()),
        confirmedAt: v.optional(v.number()),

        // Full Text Search Field (Populated via mutation)
        searchText: v.optional(v.string()),

        // Internal: set by force-reindex to guarantee a document write that
        // triggers search index refresh even when searchText is unchanged.
        searchRefreshEpoch: v.optional(v.number()),

        primaryRuleScore: v.optional(v.number()),

        isArchived: v.optional(v.boolean()),
        archivedAt: v.optional(v.number()),

        sourceKey: v.optional(v.string()),

        // Pre-computed Ingest Data (M3)
        ingestData: v.optional(ingestDataValidator),

        // Link to vector embedding for semantic search
        embeddingId: v.optional(v.id("resume_embeddings")),
    })
        .index("by_externalId", ["externalId"])
        .index("by_identityKey", ["identityKey"])
        .index("by_hash", ["hash"])
        .index("by_crawledAt", ["crawledAt"])
        .index("by_primaryRuleScore", ["primaryRuleScore"])
        .index("by_sourceKey", ["sourceKey"])
        .searchIndex("search_body", {
            searchField: "searchText",
            filterFields: ["isArchived"],
        }),

    // Optional: Search Profiles (if we want to store user configs)
    search_profiles: defineTable({
        name: v.string(),
        profileId: v.optional(v.string()),
        criteria: v.object({
            keywords: v.array(v.string()),
            locations: v.array(v.string()),
        }),
        profile: v.optional(v.any()),
        lastRunAt: v.optional(v.number()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        workspaceSlug: v.optional(v.string()),
        templateHash: v.optional(v.string()),
    }).index("by_workspace", ["workspaceSlug"]),

    // Custom Job Descriptions
    job_descriptions: defineTable({
        title: v.string(),
        slug: v.optional(v.string()), // Filesystem identifier for system JDs (e.g., "lathe-sales")
        content: v.string(), // Markdown requirements
        type: v.string(), // 'system' | 'custom'
        userId: v.optional(v.string()), // For future multi-user
        workspaceSlug: v.optional(v.string()),
        enabled: v.boolean(),
        lastModified: v.number(),
        location: v.optional(v.string()),
        industryTags: v.optional(v.array(v.string())),
        customKeywords: v.optional(v.array(v.string())),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
    })
        .index("by_slug", ["slug"])
        .index("by_workspace", ["workspaceSlug"])
        .index("by_type", ["type"])
        .index("by_type_workspace", ["type", "workspaceSlug"]),

    analysis_tasks: defineTable({
        idempotencyKey: v.optional(v.string()),
        jobKey: v.optional(v.string()),
        config: v.object({
            jobDescriptionId: v.optional(v.string()),
            jobDescriptionTitle: v.optional(v.string()),
            jobDescriptionContent: v.optional(v.string()),
            keywords: v.optional(v.array(v.string())),
            location: v.optional(v.string()),
            promptVersion: v.optional(v.number()),
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
    })
        .index("by_status", ["status"])
        .index("by_idempotency_status", ["idempotencyKey", "status"])
        .index("by_job_key_status", ["jobKey", "status"]),

    ai_tagging_results: defineTable({
        resumeId: v.id("resumes"),
        identityKey: v.optional(v.string()),
        workspaceSlug: v.string(),

        profileKey: v.string(),
        evidenceHash: v.string(),
        promptVersion: v.string(),
        model: v.string(),
        idempotencyKey: v.string(),
        workId: v.optional(v.string()),

        status: v.union(
            v.literal("pending"),
            v.literal("processing"),
            v.literal("completed"),
            v.literal("failed")
        ),

        baseline: v.optional(v.object({
            jobDescriptionId: v.optional(v.string()),
            ruleScore: v.number(),
            breakdown: v.optional(v.any()),
            roleSignals: v.optional(v.array(v.object({
                type: v.string(),
                matchedSignals: v.array(v.string()),
                signalCount: v.number(),
                occurrences: v.number(),
                years: v.number(),
                industryVerifiedYears: v.optional(v.number()),
                roleRelevantYears: v.optional(v.number()),
                industryVerifiedRelevantYears: v.optional(v.number()),
                matchedWorkEntries: v.optional(v.array(v.object({
                    companyName: v.optional(v.string()),
                    jobTitle: v.optional(v.string()),
                    years: v.number(),
                    industryVerified: v.boolean(),
                    matchedSignals: v.array(v.string()),
                    directRoleMatch: v.optional(v.boolean()),
                }))),
                verifyIn: v.string(),
            }))),
            skillsVersion: v.optional(v.number()),
            computedAt: v.number(),
        })),

        result: v.optional(v.object({
            roleFit: v.string(),
            recommendation: v.string(),
            confidence: v.number(),
            tags: v.array(v.string()),
            evidenceLines: v.array(v.string()),
        })),

        metrics: v.optional(v.object({
            latencyMs: v.optional(v.number()),
            tokensIn: v.optional(v.number()),
            tokensOut: v.optional(v.number()),
            costUsd: v.optional(v.number()),
            attempts: v.optional(v.number()),
        })),

        error: v.optional(v.string()),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_resume_profile", ["resumeId", "profileKey"])
        .index("by_idempotency", ["idempotencyKey"])
        .index("by_profile_status", ["profileKey", "status"])
        .index("by_workspace_profile", ["workspaceSlug", "profileKey"])
        .index("by_workspace_profile_status", ["workspaceSlug", "profileKey", "status"])
        .index("by_workspace_idempotency", ["workspaceSlug", "idempotencyKey"]),

    // Persistent User Sessions
    screening_sessions: defineTable({
        sessionKey: v.string(), // Fingerprint or anonymous ID
        status: v.union(v.literal("active"), v.literal("archived")),
        config: v.object({
            location: v.string(),
            keywords: v.array(v.string()),
            jobDescriptionId: v.optional(v.string()),
            collectionSource: v.optional(v.object({
                type: v.union(v.literal("job5156"), v.literal("51job"), v.literal("seek")),
                exactUrl: v.optional(v.string()),
            })),
            filters: v.optional(v.any()), // Stores ResumeFilters object
        }),
        reviewedResumeIds: v.array(v.string()), // IDs of resumes seen/acted upon
        workspaceSlug: v.optional(v.string()),
        lastActive: v.number(),
    })
        .index("by_sessionKey", ["sessionKey"])
        .index("by_status", ["status"])
        .index("by_workspace", ["workspaceSlug"])
        .index("by_sessionKey_status", ["sessionKey", "status"])
        .index("by_sessionKey_workspace", ["sessionKey", "workspaceSlug"]),

    search_history: defineTable({
        sessionKey: v.string(),
        title: v.string(),
        location: v.string(),
        keywords: v.array(v.string()),
        jobDescriptionId: v.optional(v.string()),
        collectionSource: v.optional(v.object({
            type: v.union(v.literal("job5156"), v.literal("51job"), v.literal("seek")),
            exactUrl: v.optional(v.string()),
        })),
        filters: v.optional(v.any()),
        selectedTags: v.optional(v.array(v.string())),
        selectedCompanies: v.optional(v.array(v.string())),
        selectedExperienceLevel: v.optional(v.string()),
        collectionTaskId: v.optional(v.string()),
        analysisTaskId: v.optional(v.string()),
        notes: v.optional(v.string()),
        workspaceSlug: v.optional(v.string()),
        createdAt: v.number(),
        lastOpenedAt: v.optional(v.number()),
    })
        .index("by_workspace", ["workspaceSlug"])
        .index("by_sessionKey", ["sessionKey"])
        .index("by_sessionKey_workspace", ["sessionKey", "workspaceSlug"]),

    industry_db_cohorts: defineTable({
        searchHistoryId: v.id("search_history"),
        workspaceSlug: v.string(),
        computedAt: v.number(),
        size: v.number(),
        min: v.optional(v.number()),
        max: v.optional(v.number()),
        p50: v.optional(v.number()),
        p80: v.number(),
        mean: v.optional(v.number()),
        stddev: v.optional(v.number()),
        histogram50: v.array(v.number()),
    })
        .index("by_searchHistoryId", ["searchHistoryId"])
        .index("by_workspace", ["workspaceSlug"]),

    ai_summary_cache: defineTable({
        urlHash: v.string(),
        workspaceSlug: v.string(),
        query: v.string(),
        facets: v.optional(v.string()),
        resultCount: v.number(),
        resultSetHash: v.string(),
        summary: v.string(),
        model: v.string(),
        generatedAt: v.number(),
        expiresAt: v.number(),
    })
        .index("by_workspace_url_hash", ["workspaceSlug", "urlHash"])
        .index("by_expires_at", ["expiresAt"]),

    taxonomy_clusters: defineTable({
        workspaceSlug: v.string(),
        name: v.string(),
        slug: v.string(),
        parentSlug: v.optional(v.string()),
        tags: v.array(v.string()),
        source: v.union(v.literal("human"), v.literal("ai"), v.literal("merged")),
        confidence: v.optional(v.number()),
        status: v.union(v.literal("active"), v.literal("draft"), v.literal("archived")),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_workspace", ["workspaceSlug"])
        .index("by_workspace_slug", ["workspaceSlug", "slug"])
        .index("by_workspace_status", ["workspaceSlug", "status"]),

    workspace_config: defineTable({
        workspaceSlug: v.string(),
        configKey: v.string(),
        configValue: v.any(),
        updatedAt: v.number(),
    })
        .index("by_workspace_key", ["workspaceSlug", "configKey"])
        .index("by_workspace", ["workspaceSlug"]),

    candidate_blocks: defineTable({
        identityKey: v.string(),
        workspaceSlug: v.string(),
        reason: v.optional(v.string()),
        blockedBy: v.optional(v.string()),
        blockedAt: v.number(),
    })
        .index("by_workspace_identity", ["workspaceSlug", "identityKey"])
        .index("by_workspace", ["workspaceSlug"]),

    candidate_status: defineTable({
        identityKey: v.string(),
        workspaceSlug: v.string(),
        status: v.union(
            v.literal("new"),
            v.literal("contacted"),
            v.literal("interviewing"),
            v.literal("interviewed_pass"),
            v.literal("interviewed_reject"),
            v.literal("offer"),
            v.literal("hired"),
            v.literal("withdrawn")
        ),
        notes: v.optional(v.string()),
        updatedBy: v.optional(v.string()),
        updatedAt: v.number(),
        history: v.optional(v.array(v.object({
            status: v.string(),
            updatedAt: v.number(),
            notes: v.optional(v.string()),
        }))),
    })
        .index("by_workspace_identity", ["workspaceSlug", "identityKey"])
        .index("by_workspace_status", ["workspaceSlug", "status"]),

    sync_events: defineTable({
        source: v.string(),
        status: v.union(v.literal("success"), v.literal("error")),
        submitted: v.number(),
        inserted: v.number(),
        updated: v.number(),
        unchanged: v.number(),
        error: v.optional(v.string()),
        timestamp: v.number(),
    }).index("by_timestamp", ["timestamp"]),

    // Search alert subscriptions — notify when new resumes match criteria
    search_alerts: defineTable({
        workspaceSlug: v.string(),
        searchProfileId: v.string(),
        name: v.string(),
        keywords: v.optional(v.array(v.string())),
        minScore: v.number(),
        enabled: v.boolean(),
        lastNotifiedAt: v.optional(v.number()),
        createdBy: v.optional(v.string()),
    })
        .index("by_workspace", ["workspaceSlug"])
        .index("by_workspace_enabled", ["workspaceSlug", "enabled"])
        .index("by_search_profile", ["searchProfileId"]),

    // LLM Cost Tracking — per-workspace daily budget for batch AI confirm
    llm_cost_tracking: defineTable({
        workspaceId: v.string(),
        period: v.string(), // "YYYY-MM-DD"
        inputTokens: v.number(),
        outputTokens: v.number(),
        confirmCount: v.number(),
        updatedAt: v.number(),
    })
        .index("by_workspace_period", ["workspaceId", "period"]),

    // Resume Embeddings — vector representations for semantic search
    resume_embeddings: defineTable({
        resumeId: v.id("resumes"),
        embedding: v.array(v.float64()),
        model: v.string(), // e.g. "text-embedding-3-small"
        sourceKey: v.optional(v.string()),
        generatedAt: v.number(),
    })
        .index("by_resumeId", ["resumeId"])
        .vectorIndex("by_embedding", {
            vectorField: "embedding",
            dimensions: 1536,
            filterFields: ["sourceKey"],
        }),

    // Analysis Audit Log — EU AI Act compliance (Annex III §4a high-risk)
    analysis_audit_log: defineTable({
        resumeId: v.id("resumes"),
        identityKey: v.optional(v.string()),
        workspaceSlug: v.string(),

        // Decision Context
        decisionType: v.union(
            v.literal("score"),
            v.literal("tag"),
            v.literal("rank"),
            v.literal("filter"),
            v.literal("confirm"),
        ),
        actionRef: v.string(),

        // Input Snapshot
        inputSnapshot: v.object({
            jobDescriptionId: v.optional(v.string()),
            profileKey: v.optional(v.string()),
            promptVersion: v.optional(v.string()),
            fieldUsagePolicyVersion: v.optional(v.number()),
            scrubbedFields: v.optional(v.array(v.string())),
            searchKeywords: v.optional(v.array(v.string())),
            searchLocation: v.optional(v.string()),
        }),

        // Model Metadata
        modelMeta: v.object({
            model: v.string(),
            provider: v.string(),
            apiBase: v.optional(v.string()),
            promptTokens: v.optional(v.number()),
            completionTokens: v.optional(v.number()),
            latencyMs: v.optional(v.number()),
        }),

        // Output
        output: v.object({
            score: v.optional(v.number()),
            recommendation: v.optional(v.string()),
            roleFit: v.optional(v.string()),
            confidence: v.optional(v.number()),
            tags: v.optional(v.array(v.string())),
        }),

        // Protected Attribute Hashes (SHA-256 of bracket values, NOT raw PII)
        protectedAttributeHashes: v.optional(v.object({
            ageBracketHash: v.optional(v.string()),
            genderHash: v.optional(v.string()),
            locationHash: v.optional(v.string()),
            sourceHash: v.optional(v.string()),
        })),

        // Explanation (Right to Explanation — GDPR Art. 22)
        explanation: v.optional(v.object({
            summary: v.string(),
            keyFactors: v.array(v.object({
                factor: v.string(),
                weight: v.optional(v.number()),
                value: v.string(),
            })),
            modelReasoning: v.optional(v.string()),
        })),

        // Outcome Tracking
        outcome: v.optional(v.union(
            v.literal("pending"),
            v.literal("accepted"),
            v.literal("overridden"),
            v.literal("appealed"),
        )),
        outcomeSetBy: v.optional(v.string()),
        outcomeSetAt: v.optional(v.number()),

        // Timestamps
        decidedAt: v.number(),
        reviewedAt: v.optional(v.number()),
        expiresAt: v.number(), // GDPR retention limit
    })
        .index("by_resume", ["resumeId"])
        .index("by_workspace", ["workspaceSlug"])
        .index("by_workspace_decision", ["workspaceSlug", "decisionType"])
        .index("by_workspace_outcome", ["workspaceSlug", "outcome"])
        .index("by_expires_at", ["expiresAt"]),
});
