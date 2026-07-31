import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
    ingestDataValidator,
    collectionTaskResultsValidator,
    resumeFiltersValidator,
    analysisResultValidator,
    resumeAnalysisValidator,
    jsonRecordValidator,
    jsonValueValidator,
    relatedExpContextValidator,
    verifiedIndustryEvidenceSummaryValidator,
} from "./validators.js";

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
            maxSalary: v.optional(v.number()),
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
        idempotencyKey: v.optional(v.string()),
        lastStatus: v.optional(v.string()), // Real-time status message (e.g. "Scraping page 2")
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()), // Timestamp
        completedAt: v.optional(v.number()), // Timestamp
    })
        .index("by_status", ["status"])
        .index("by_worker", ["workerId"])
        .index("by_idempotency_status", ["idempotencyKey", "status"])
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
        content: jsonRecordValidator, // JSON payload from crawler
        hash: v.string(), // Content hash for change detection
        tags: v.array(v.string()), // e.g. search profile IDs
        crawledAt: v.number(),
        source: v.string(), // e.g. "hr.job5156.com"

        // AI Analysis
        analysis: v.optional(resumeAnalysisValidator),

        // AI Analysis Cache (Multi-JD + source-aware support)
        // Key: `source:<sourceKey>|analysis:<jobDescriptionId>` when the resume source is known,
        //       otherwise the legacy bare `jobDescriptionId` / `default` key.
        // Value: Analysis object (the payload keeps bare jobDescriptionId for compatibility)
        analyses: v.optional(v.record(v.string(), analysisResultValidator)),

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

        // Workspace scoping (defense-in-depth for mutations)
        workspaceSlug: v.optional(v.string()),

        // Pre-computed Ingest Data (M3)
        ingestData: v.optional(ingestDataValidator),

        // Link to vector embedding for semantic search
        embeddingId: v.optional(v.id("resume_embeddings")),
        // Flag for incremental embedding backfill — indexed to avoid full-table scan
        needsEmbedding: v.optional(v.boolean()),
    })
        .index("by_externalId", ["externalId"])
        .index("by_identityKey", ["identityKey"])
        .index("by_hash", ["hash"])
        .index("by_crawledAt", ["crawledAt"])
        .index("by_primaryRuleScore", ["primaryRuleScore"])
        .index("by_sourceKey", ["sourceKey"])
        .index("by_needsEmbedding", ["needsEmbedding"]),

    // Optional: Search Profiles (if we want to store user configs)
    search_profiles: defineTable({
        name: v.string(),
        profileId: v.optional(v.string()),
        criteria: v.object({
            keywords: v.array(v.string()),
            locations: v.array(v.string()),
        }),
        profile: v.optional(jsonRecordValidator),
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
        dispatchMode: v.optional(v.union(v.literal("search"), v.literal("exact"))),
        workspaceSlug: v.optional(v.string()),
        targetResumeIds: v.optional(v.array(v.id("resumes"))),
        // Optional so historic exact-task documents remain decodable. New exact
        // tasks persist one immutable source/locale/key identity per target.
        targetAnalysisIdentities: v.optional(v.array(v.object({
            resumeId: v.id("resumes"),
            sourceKey: v.string(),
            locale: v.string(),
            expectedAnalysisKey: v.string(),
        }))),
        dispatchedAt: v.optional(v.number()),
        config: v.object({
            jobDescriptionId: v.optional(v.string()),
            jobDescriptionTitle: v.optional(v.string()),
            jobDescriptionContent: v.optional(v.string()),
            keywords: v.optional(v.array(v.string())),
            location: v.optional(v.string()),
            promptVersion: v.optional(v.number()),
            sample: v.optional(v.string()),
            resumeCount: v.number(),
            /** P1: context for evidence ceiling evaluator — optional, omitted on legacy tasks */
            relatedExpContext: v.optional(relatedExpContextValidator),
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
        .index("by_job_key_status", ["jobKey", "status"])
        .index("by_workspace", ["workspaceSlug"]),

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
            breakdown: v.optional(v.record(v.string(), v.number())),
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
                    companyKey: v.optional(v.string()),
                    jobTitle: v.optional(v.string()),
                    years: v.number(),
                    industryVerified: v.boolean(),
                    verdictRevisionId: v.optional(v.string()),
                    workEntryFingerprint: v.optional(v.string()),
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
            filters: resumeFiltersValidator,
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
        filters: resumeFiltersValidator,
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
        configValue: jsonValueValidator,
        updatedAt: v.number(),
    })
        .index("by_workspace_key", ["workspaceSlug", "configKey"])
        .index("by_workspace", ["workspaceSlug"]),

    system_settings: defineTable({
        key: v.string(),
        value: jsonValueValidator,
        reason: v.optional(v.string()),
        updatedAt: v.number(),
        updatedBy: v.string(),
    })
        .index("by_key", ["key"]),

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
            v.literal("shortlisted"),
            v.literal("rejected"),
            v.literal("contacted"),
            v.literal("interviewing"),
            v.literal("interviewed_pass"),
            v.literal("interviewed_reject"),
            v.literal("appeal_submitted"),
            v.literal("human_review"),
            v.literal("upheld"),
            v.literal("reversed"),
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
        searchTextRefreshed: v.optional(v.number()),
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
        searchTextHash: v.optional(v.string()), // SHA-256 of normalized searchText for staleness detection
    })
        .index("by_resumeId", ["resumeId"])
        .index("by_generatedAt", ["generatedAt"])
        .vectorIndex("by_embedding", {
            vectorField: "embedding",
            dimensions: 1536,
            filterFields: ["sourceKey"],
        }),

    // Resume Digests — lightweight hot table for keyword/filter candidate discovery
    resume_digests: defineTable({
        resumeId: v.id("resumes"),
        identityKey: v.optional(v.string()),
        externalId: v.optional(v.string()),
        source: v.optional(v.string()),
        sourceKey: v.optional(v.string()),
        searchText: v.optional(v.string()),
        isArchived: v.optional(v.boolean()),
        archivedAt: v.optional(v.number()),
        primaryRuleScore: v.optional(v.number()),
        crawledAt: v.optional(v.number()),
        age: v.optional(v.number()),
        locationText: v.optional(v.string()),
        educationLevel: v.optional(v.string()),
        salaryMin: v.optional(v.number()),
        salaryMax: v.optional(v.number()),
        experienceYears: v.optional(v.number()),
        roleTypes: v.optional(v.array(v.string())),
        roleYearsByType: v.optional(v.record(v.string(), v.number())),
        evidenceProjectionVersion: v.optional(v.number()),
        verifiedIndustryEvidenceSummaries: v.optional(
            v.array(verifiedIndustryEvidenceSummaryValidator),
        ),
        industryEvidenceCatalogState: v.optional(v.union(
            v.literal("ready"),
            v.literal("degraded"),
        )),
        industryEvidenceStale: v.optional(v.boolean()),
        // Phase 3 display fields — denormalized from default analysis for zero-join list/search
        displayScore: v.optional(v.number()),
        displayRecommendation: v.optional(v.string()),
        displayBreakdown: v.optional(v.record(v.string(), v.number())),
        displaySummary: v.optional(v.string()),
        displayConfirmedScore: v.optional(v.number()),
        displayConfirmedAt: v.optional(v.number()),
        updatedAt: v.number(),
    })
        .index("by_resumeId", ["resumeId"])
        .index("by_identityKey", ["identityKey"])
        .index("by_sourceKey", ["sourceKey"])
        .index("by_crawledAt", ["crawledAt"])
        .index("by_primaryRuleScore", ["primaryRuleScore"])
        .searchIndex("search_body", {
            searchField: "searchText",
            filterFields: ["isArchived", "sourceKey"],
        }),

    // Cold analysis storage — full AI analysis blobs (highlights, concerns,
    // keyFactors, relatedExpEvidence) split out of resumes to avoid 22KB/doc
    // hydration overhead on the hot list/search path. The detail/expanded view
    // fetches from here on demand. The list/search path reads scalar display
    // fields from resume_digests instead.
    //
    // Soft-clear semantics (added Phase 3 completion bundle):
    //   status: "active" — visible to detail view (projectResumeDetailDoc)
    //   status: "archived" — invisible to detail view, retained for audit/undo
    // clearAnalyses flips active → archived instead of hard-deleting. Matches
    // repo precedent (resumes.isArchived, candidate_status.status).
    resume_analyses: defineTable({
        resumeId: v.id("resumes"),
        analysis: v.optional(resumeAnalysisValidator),
        analyses: v.optional(v.record(v.string(), analysisResultValidator)),
        status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
        archivedAt: v.optional(v.number()),
        updatedAt: v.number(),
    })
        .index("by_resume", ["resumeId"]),

    // Hot status overlay — workspace-scoped candidate status for server-side
    // filtering. Separate from resume_digests (which is resume-scoped) to
    // preserve independent workspace statuses for the same identity.
    resume_digest_statuses: defineTable({
        resumeId: v.id("resumes"),
        identityKey: v.string(),
        workspaceSlug: v.string(),
        status: v.union(
            v.literal("new"),
            v.literal("shortlisted"),
            v.literal("rejected"),
            v.literal("contacted"),
            v.literal("interviewing"),
            v.literal("interviewed_pass"),
            v.literal("interviewed_reject"),
            v.literal("appeal_submitted"),
            v.literal("human_review"),
            v.literal("upheld"),
            v.literal("reversed"),
            v.literal("offer"),
            v.literal("hired"),
            v.literal("withdrawn")
        ),
        updatedAt: v.number(),
    })
        .index("by_workspace_status", ["workspaceSlug", "status"])
        .index("by_workspace_identity", ["workspaceSlug", "identityKey"])
        .index("by_resume", ["resumeId"]),

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

        // Anomaly/Drift Flags (EU AI Act Article 12 monitoring)
        anomalyFlags: v.optional(v.object({
            statisticalParityViolation: v.optional(v.boolean()),
            disparateImpactViolation: v.optional(v.boolean()),
            scoreDriftDetected: v.optional(v.boolean()),
            psiValue: v.optional(v.number()),
            flagReason: v.optional(v.string()),
        })),

        // Actor Identity (EU AI Act Art. 12 — traceability to specific operator)
        actorId: v.optional(v.string()),
        actorRole: v.optional(v.union(
            v.literal("admin"),
            v.literal("operator"),
            v.literal("system"),
        )),

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

    // K3: shared company registry (immutable companyKey; policy is separate)
    companies: defineTable({
        companyKey: v.string(),
        status: v.union(
            v.literal("provisional"),
            v.literal("confirmed"),
            v.literal("merged"),
        ),
        displayName: v.string(),
        nameCn: v.optional(v.string()),
        nameEn: v.optional(v.string()),
        mergedIntoCompanyKey: v.optional(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
        createdBy: v.optional(v.string()),
    })
        .index("by_company_key", ["companyKey"])
        .index("by_status", ["status"]),

    company_aliases: defineTable({
        companyKey: v.string(),
        aliasNormalized: v.string(),
        aliasDisplay: v.string(),
        source: v.union(
            v.literal("seed"),
            v.literal("operator"),
            v.literal("observed"),
        ),
        createdAt: v.number(),
    })
        .index("by_alias", ["aliasNormalized"])
        .index("by_company", ["companyKey"]),

    // Append-only company policy revisions (most recent revision per scope wins)
    company_policy_revisions: defineTable({
        companyKey: v.string(),
        scopeType: v.union(
            v.literal("workspace"),
            v.literal("market"),
            v.literal("global"),
        ),
        scopeId: v.string(),
        revision: v.number(),
        visibility: v.optional(v.union(v.literal("default"), v.literal("hide"))),
        workflow: v.optional(v.union(v.literal("default"), v.literal("blocked"))),
        rankingEffect: v.optional(v.union(
            v.literal("none"),
            v.literal("band_known_good"),
            v.literal("band_known_bad"),
            v.literal("boost"),
            v.literal("demote"),
        )),
        reasonCodes: v.optional(v.array(v.string())),
        summary: v.optional(v.string()),
        createdAt: v.number(),
        createdBy: v.optional(v.string()),
    })
        .index("by_scope_company", ["scopeType", "scopeId", "companyKey"])
        .index("by_company", ["companyKey"])
        .index("by_scope", ["scopeType", "scopeId"]),

    // Reviewed company-industry profiles (mutable overlay on top of companyKey).
    // Populated by attended bootstrap import or operator review. Runtime consumes
    // only rows with verificationLevel="verified" for the 行业验证 badge and
    // verified-only role-years gate.
    company_industry_profiles: defineTable({
        companyKey: v.string(),
        industryClass: v.union(
            v.literal("cnc"),
            v.literal("automation"),
            v.literal("metrology"),
            v.literal("industrial"),
            v.literal("non_industry"),
            v.literal("unknown"),
        ),
        verificationLevel: v.union(
            v.literal("verified"),
            v.literal("candidate"),
            v.literal("rejected"),
        ),
        officialDomain: v.optional(v.string()),
        evidenceSource: v.union(
            v.literal("seed"),
            v.literal("manual"),
            v.literal("worker_web"),
        ),
        summary: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        sourceDomain: v.optional(v.string()),
        sourceType: v.optional(v.string()),
        msicCode: v.optional(v.string()),
        msicDescription: v.optional(v.string()),
        fetchedAt: v.optional(v.number()),
        currentRevisionId: v.optional(v.string()),
        reviewedAt: v.optional(v.number()),
        reviewedBy: v.optional(v.string()),
        sourceCount: v.optional(v.number()),
        freshnessState: v.optional(v.union(
            v.literal("fresh"),
            v.literal("refresh_due"),
            v.literal("checking"),
            v.literal("changed"),
            v.literal("unavailable"),
            v.literal("conflict"),
        )),
        nextReviewAt: v.optional(v.number()),
        catalogVersion: v.optional(v.number()),
        compatibilityState: v.optional(v.union(
            v.literal("legacy_seed"),
            v.literal("reviewed"),
            v.literal("strict_reviewed"),
        )),
        updatedAt: v.number(),
        updatedBy: v.optional(v.string()),
    })
        .index("by_company_key", ["companyKey"])
        .index("by_verification", ["verificationLevel"])
        .index("by_industry_class", ["industryClass"])
        .index("by_current_revision", ["currentRevisionId"])
        .index("by_next_review", ["nextReviewAt"])
        .index("by_freshness", ["freshnessState", "nextReviewAt"]),

    company_industry_evidence_sources: defineTable({
        sourceId: v.string(),
        companyKey: v.optional(v.string()),
        proposalId: v.optional(v.string()),
        url: v.string(),
        sourceDomain: v.string(),
        sourceType: v.union(
            v.literal("official_site"),
            v.literal("registry"),
            v.literal("taxonomy"),
            v.literal("oem_partner"),
            v.literal("trade_body"),
            v.literal("directory"),
            v.literal("reporting"),
            v.literal("other"),
            v.literal("search_result"),
        ),
        trustTier: v.union(
            v.literal("primary"),
            v.literal("authoritative"),
            v.literal("corroborating"),
            v.literal("discovery"),
        ),
        title: v.optional(v.string()),
        evidenceExcerpt: v.optional(v.string()),
        fetchedAt: v.optional(v.number()),
        lastSuccessfulFetchAt: v.optional(v.number()),
        contentFingerprint: v.optional(v.string()),
        fetchStatus: v.union(
            v.literal("pending"),
            v.literal("fetched"),
            v.literal("failed"),
            v.literal("unavailable"),
        ),
        suggestedIndustryClass: v.optional(v.union(
            v.literal("cnc"),
            v.literal("automation"),
            v.literal("metrology"),
            v.literal("industrial"),
            v.literal("non_industry"),
            v.literal("unknown"),
        )),
        workerConfidence: v.optional(v.number()),
        reviewStatus: v.union(
            v.literal("unreviewed"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("disputed"),
        ),
        reviewedAt: v.optional(v.number()),
        reviewedBy: v.optional(v.string()),
        reviewerNote: v.optional(v.string()),
        sourceState: v.union(
            v.literal("active"),
            v.literal("superseded"),
            v.literal("unavailable"),
            v.literal("disputed"),
        ),
        supersededBySourceId: v.optional(v.string()),
        relevanceDemoted: v.optional(v.boolean()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_source_id", ["sourceId"])
        .index("by_company_review", ["companyKey", "reviewStatus"])
        .index("by_proposal", ["proposalId"])
        .index("by_domain", ["sourceDomain"])
        .index("by_fetch_status", ["fetchStatus", "lastSuccessfulFetchAt"]),

    company_industry_evidence_checks: defineTable({
        checkId: v.string(),
        sourceId: v.string(),
        companyKey: v.string(),
        verdictRevisionId: v.string(),
        proposalId: v.optional(v.string()),
        checkedAt: v.number(),
        outcome: v.union(
            v.literal("unchanged"),
            v.literal("changed"),
            v.literal("unavailable"),
            v.literal("conflict"),
        ),
        observedUrl: v.optional(v.string()),
        observedDomain: v.optional(v.string()),
        observedTitle: v.optional(v.string()),
        observedExcerpt: v.optional(v.string()),
        observedContentFingerprint: v.optional(v.string()),
        fetchStatus: v.union(
            v.literal("fetched"),
            v.literal("failed"),
            v.literal("unavailable"),
        ),
        httpStatus: v.optional(v.number()),
        errorCode: v.optional(v.string()),
        materialChangeSummary: v.optional(v.string()),
        nextReviewAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_check_id", ["checkId"])
        .index("by_source_checked", ["sourceId", "checkedAt"])
        .index("by_company_checked", ["companyKey", "checkedAt"])
        .index("by_proposal", ["proposalId"]),

    company_industry_review_proposals: defineTable({
        proposalId: v.string(),
        companyKey: v.optional(v.string()),
        normalizedEmployerSurface: v.optional(v.string()),
        triggerReasons: v.array(v.string()),
        priority: v.number(),
        sampleReferences: v.optional(v.array(v.object({
            workspaceSlug: v.string(),
            resumeIdentity: v.string(),
            workEntryFingerprint: v.optional(v.string()),
        }))),
        currentRevisionId: v.optional(v.string()),
        suggestedIndustryClass: v.optional(v.union(
            v.literal("cnc"),
            v.literal("automation"),
            v.literal("metrology"),
            v.literal("industrial"),
            v.literal("non_industry"),
            v.literal("unknown"),
        )),
        suggestedVerificationLevel: v.optional(v.union(
            v.literal("verified"),
            v.literal("candidate"),
            v.literal("rejected"),
        )),
        materialChangeSummary: v.optional(v.string()),
        status: v.union(
            v.literal("new"),
            v.literal("researching"),
            v.literal("ready_for_review"),
            v.literal("needs_more_evidence"),
            v.literal("approved"),
            v.literal("rejected"),
            v.literal("superseded"),
        ),
        requestedBy: v.optional(v.string()),
        researchStartedAt: v.optional(v.number()),
        readyForReviewAt: v.optional(v.number()),
        reviewedAt: v.optional(v.number()),
        reviewedBy: v.optional(v.string()),
        reviewNote: v.optional(v.string()),
        approvedRevisionId: v.optional(v.string()),
        recomputeRunId: v.optional(v.string()),
        applicationState: v.optional(v.union(
            v.literal("recompute_pending"),
            v.literal("recompute_running"),
            v.literal("applied"),
            v.literal("partial_failure"),
            v.literal("superseded"),
        )),
        appliedRevisionId: v.optional(v.string()),
        appliedAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_proposal_id", ["proposalId"])
        .index("by_company_status", ["companyKey", "status"])
        .index("by_surface_status", ["normalizedEmployerSurface", "status"])
        .index("by_status_priority", ["status", "priority"]),

    company_industry_refresh_requests: defineTable({
        requestId: v.string(),
        proposalId: v.string(),
        companyKey: v.string(),
        verdictRevisionId: v.string(),
        workspaceSlug: v.string(),
        requesterId: v.string(),
        reasonCode: v.union(
            v.literal("stale"),
            v.literal("incomplete"),
            v.literal("incorrect"),
            v.literal("other"),
        ),
        note: v.optional(v.string()),
        resumeIdentity: v.optional(v.string()),
        workEntryFingerprint: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_request_id", ["requestId"])
        .index("by_proposal_created", ["proposalId", "createdAt"])
        .index("by_company_created", ["companyKey", "createdAt"])
        .index("by_workspace_created", ["workspaceSlug", "createdAt"]),

    company_industry_verdict_revisions: defineTable({
        revisionId: v.string(),
        companyKey: v.string(),
        industryClass: v.union(
            v.literal("cnc"),
            v.literal("automation"),
            v.literal("metrology"),
            v.literal("industrial"),
            v.literal("non_industry"),
            v.literal("unknown"),
        ),
        verificationLevel: v.union(
            v.literal("verified"),
            v.literal("rejected"),
        ),
        approvedSourceIds: v.array(v.string()),
        evidenceSummary: v.string(),
        reviewedBy: v.string(),
        reviewedAt: v.number(),
        decisionReason: v.string(),
        taxonomyVersion: v.string(),
        ruleVersion: v.optional(v.string()),
        reviewAttestation: v.optional(v.object({
            schemaVersion: v.literal("industry-review-attestation.v1"),
            inputFingerprint: v.string(),
            decisionMode: v.union(v.literal("standard"), v.literal("risk_override")),
            acknowledgedRiskFlags: v.array(v.union(
                v.literal("canonical_mapping_missing"),
                v.literal("only_discovery_sources"),
                v.literal("source_conflict"),
                v.literal("weak_industry_signal"),
                v.literal("cnc_claim_inferred"),
                v.literal("stale_or_failed_source"),
                v.literal("low_source_diversity"),
                v.literal("worker_unreachable"),
                v.literal("recompute_pending"),
            )),
            cncEvidenceAcknowledged: v.boolean(),
            acknowledgementReason: v.string(),
        })),
        supersedesRevisionId: v.optional(v.string()),
        proposalId: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_revision_id", ["revisionId"])
        .index("by_company_created", ["companyKey", "createdAt"])
        .index("by_superseded_revision", ["supersedesRevisionId"]),

    company_resume_links: defineTable({
        workspaceSlug: v.string(),
        companyKey: v.string(),
        resumeId: v.id("resumes"),
        resumeIdentity: v.string(),
        matchedEmployerSurfaces: v.array(v.string()),
        workEntryFingerprints: v.array(v.string()),
        currentVerdictRevisionId: v.optional(v.string()),
        updatedAt: v.number(),
    })
        .index("by_company", ["companyKey"])
        .index("by_workspace_company", ["workspaceSlug", "companyKey"])
        .index("by_resume", ["resumeId"]),

    company_industry_recompute_runs: defineTable({
        runId: v.string(),
        workspaceSlug: v.string(),
        companyKey: v.string(),
        targetRevisionId: v.string(),
        proposalId: v.optional(v.string()),
        requestedBy: v.optional(v.string()),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("waiting"),
            v.literal("completed"),
            v.literal("partial_failed"),
            v.literal("failed"),
            v.literal("superseded"),
        ),
        attempt: v.number(),
        cursor: v.optional(v.string()),
        sourceDone: v.boolean(),
        pageCount: v.number(),
        affectedCount: v.number(),
        alreadyCurrentCount: v.number(),
        scheduledCount: v.number(),
        readyCount: v.number(),
        failureCount: v.number(),
        batchCount: v.number(),
        failures: v.array(v.object({
            resumeId: v.optional(v.string()),
            stage: v.string(),
            message: v.string(),
            occurredAt: v.number(),
        })),
        lastError: v.optional(v.string()),
        supersededByRevisionId: v.optional(v.string()),
        createdAt: v.number(),
        startedAt: v.optional(v.number()),
        completedAt: v.optional(v.number()),
        updatedAt: v.number(),
    })
        .index("by_run_id", ["runId"])
        .index("by_workspace_company_revision", [
            "workspaceSlug",
            "companyKey",
            "targetRevisionId",
        ])
        .index("by_workspace_company_updated", [
            "workspaceSlug",
            "companyKey",
            "updatedAt",
        ])
        .index("by_status_updated", ["status", "updatedAt"]),

    company_industry_recompute_batches: defineTable({
        batchId: v.string(),
        runId: v.string(),
        pageNumber: v.number(),
        status: v.union(
            v.literal("planned"),
            v.literal("dispatched"),
            v.literal("completed"),
            v.literal("partial_failed"),
            v.literal("failed"),
        ),
        resumeIds: v.array(v.id("resumes")),
        dispatchedAt: v.optional(v.number()),
        expectedSkillsVersion: v.optional(v.number()),
        readyCount: v.optional(v.number()),
        failureCount: v.optional(v.number()),
        failures: v.optional(v.array(v.object({
            resumeId: v.optional(v.string()),
            stage: v.string(),
            message: v.string(),
        }))),
        createdAt: v.number(),
        updatedAt: v.number(),
    })
        .index("by_batch_id", ["batchId"])
        .index("by_run", ["runId"])
        .index("by_run_status", ["runId", "status"]),

    // Research Eng: native news items (full distill; no SQLite product path)
    news_items: defineTable({
        sourceId: v.string(),
        platform: v.string(),
        externalId: v.optional(v.string()),
        title: v.string(),
        url: v.optional(v.string()),
        rank: v.optional(v.number()),
        publishedAt: v.optional(v.number()),
        capturedAt: v.number(),
        rawSnippet: v.optional(v.string()),
        contentHash: v.string(),
    })
        .index("by_captured_at", ["capturedAt"])
        .index("by_content_hash", ["contentHash"])
        .index("by_platform_captured", ["platform", "capturedAt"]),

    // Research Eng: company-linked signals with nested evidence
    research_signals: defineTable({
        companyKey: v.string(),
        kind: v.union(
            v.literal("company_mention"),
            v.literal("hiring_signal"),
            v.literal("market_move"),
            v.literal("sales_trigger"),
        ),
        title: v.string(),
        summary: v.optional(v.string()),
        evidence: v.object({
            newsItemId: v.optional(v.id("news_items")),
            title: v.string(),
            url: v.optional(v.string()),
            platform: v.string(),
            seenAt: v.number(),
            snippet: v.optional(v.string()),
        }),
        score: v.optional(v.number()),
        capturedAt: v.number(),
        ingestRunId: v.optional(v.string()),
    })
        .index("by_company_captured", ["companyKey", "capturedAt"])
        .index("by_kind_captured", ["kind", "capturedAt"]),

    // Research Eng: ingest run audit rows
    research_ingest_runs: defineTable({
        runId: v.string(),
        startedAt: v.number(),
        finishedAt: v.optional(v.number()),
        status: v.union(
            v.literal("running"),
            v.literal("success"),
            v.literal("failed"),
        ),
        enabledPlatforms: v.array(v.string()),
        newsInserted: v.optional(v.number()),
        newsUpdated: v.optional(v.number()),
        signalsInserted: v.optional(v.number()),
        unresolvedMentions: v.optional(v.number()),
        error: v.optional(v.string()),
    })
        .index("by_run_id", ["runId"])
        .index("by_started_at", ["startedAt"]),

    // Research Eng: durable parity / kill-switch ledger
    research_parity_runs: defineTable({
        parityRunId: v.string(),
        evaluatedAt: v.number(),
        windowStart: v.number(),
        windowEnd: v.number(),
        enabledPlatforms: v.array(v.string()),
        nativeTotal: v.number(),
        shadowTotal: v.number(),
        aggregateRatio: v.number(),
        platformBreakdown: v.array(
            v.object({
                platform: v.string(),
                nativeCount: v.number(),
                shadowCount: v.number(),
                ratio: v.number(),
                zeroWithShadow: v.boolean(),
            }),
        ),
        goldenCompanyResults: v.array(
            v.object({
                companyKey: v.string(),
                signalCount: v.number(),
                pass: v.boolean(),
            }),
        ),
        nativeNonEmpty: v.boolean(),
        green: v.boolean(),
        greenStreak: v.number(),
    })
        .index("by_parity_run_id", ["parityRunId"])
        .index("by_evaluated_at", ["evaluatedAt"]),

    // Web research provider quota ledger (monthly credit cap, R4 free-tier lock)
    web_research_quota: defineTable({
        provider: v.string(),          // e.g. "duckduckgo" | "tavily" | "brave"
        month: v.string(),             // "YYYY-MM" UTC
        used: v.number(),
        cap: v.number(),
        updatedAt: v.number(),
    })
        .index("by_provider_month", ["provider", "month"]),

    // Industry evidence maintenance run registry: one row per maintenance execution
    // (schedule / restore / approval / manual trigger). Mirrors the recompute-run
    // architecture; the worker writes here during maintenance, the API/UI read it.
    industry_maintenance_runs: defineTable({
        runId: v.string(),
        workspaceSlug: v.string(),
        triggerSource: v.union(
            v.literal("schedule"),
            v.literal("restore"),
            v.literal("approval"),
            v.literal("manual"),
        ),
        triggerContext: v.optional(v.string()),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("skipped"),
        ),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
        counts: v.optional(v.any()),
        failureMessage: v.optional(v.string()),
        operatorSummary: v.optional(v.string()),
    })
        .index("by_status", ["status"])
        .index("by_workspace_time", ["workspaceSlug", "startedAt"]),

    // Per-proposal debug ledger: one row per proposal action inside a maintenance
    // run. Answers "why did/didn't employer X surface?" without terminal-log spelunking.
    industry_maintenance_ledger: defineTable({
        runId: v.string(),
        proposalId: v.string(),
        companyKey: v.optional(v.string()),
        action: v.union(
            v.literal("researched"),
            v.literal("ready"),
            v.literal("demoted"),
            v.literal("recycled"),
            v.literal("needs_more_evidence"),
            v.literal("freshness_ok"),
            v.literal("freshness_refreshed"),
            v.literal("error"),
        ),
        reason: v.string(),
        detail: v.optional(v.any()),
    })
        .index("by_run", ["runId"])
        .index("by_proposal", ["proposalId"]),

    // Admin-managed industry data entries (companies / keywords / brands /
    // demoted URLs). Payloads mirror the industry-data YAML/JSON files; the
    // admin UI writes here, readers project back to the file shape.
    industry_data_entries: defineTable({
        entryType: v.union(
            v.literal("company"),
            v.literal("keyword"),
            v.literal("brand"),
            v.literal("url"),
        ),
        entryId: v.string(),
        data: v.any(),
        sortOrder: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
        updatedBy: v.string(),
    })
        .index("by_type", ["entryType"])
        .index("by_entry_id", ["entryId"]),

    // Append-only change log for industry data admin edits: one row per
    // create / update / delete with before/after snapshots so changes are
    // reviewable and attributable to a git commit (gitSha backfilled after
    // the file-commit step).
    industry_data_change_log: defineTable({
        changeId: v.string(),
        entryType: v.string(),
        entryId: v.string(),
        action: v.union(
            v.literal("create"),
            v.literal("update"),
            v.literal("delete"),
        ),
        actor: v.string(),
        before: v.optional(v.any()),
        after: v.optional(v.any()),
        companyKey: v.optional(v.string()),
        gitSha: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_entry", ["entryType", "entryId"])
        .index("by_created", ["createdAt"])
        .index("by_company_key", ["companyKey"]),
});
