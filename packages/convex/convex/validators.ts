import { v } from "convex/values";

/**
 * Shared validator definitions for Convex schema shapes that are also used
 * in mutation/action args. Single source of truth — schema.ts and mutation
 * validators import from here to prevent drift.
 */

// --- ingestData (resumes table) ---

export const ingestDataValidator = v.object({
    market: v.optional(v.string()),
    evidenceText: v.optional(v.string()),
    industryTags: v.array(v.string()),
    synonymHits: v.array(v.string()),
    brandHits: v.optional(v.array(v.object({
        brand: v.string(),
        role: v.string(),
        source: v.string(),
        context: v.string(),
        companyId: v.optional(v.number()),
    }))),
    companyHits: v.optional(v.array(v.string())),
    industryDbV2Raw: v.optional(v.number()),
    industryDbV2RawComponents: v.optional(v.object({
        companyScore: v.number(),
        brandScore: v.number(),
        weightedBrandUnits: v.number(),
        uniqueCompanies: v.number(),
        brandUnitCount: v.number(),
    })),
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
    taggingEnvelope: v.optional(v.object({
        schemaVersion: v.number(),
        generatedAt: v.number(),
        entries: v.array(v.object({
            tag: v.string(),
            source: v.string(),
            confidence: v.number(),
            version: v.number(),
            provenance: v.object({
                stage: v.string(),
                generatedBy: v.string(),
                evidence: v.array(v.string()),
            }),
        })),
    })),
    // Legacy field: migrated to taggingEnvelope; retained for documents not yet migrated.
    tagEnvelope: v.optional(v.any()),
    ruleScores: v.any(),
    experienceLevel: v.string(),
    computedAt: v.number(),
    skillsVersion: v.number(),
    verifiedRoleYears: v.optional(v.record(v.string(), v.number())),
});

// --- collection_tasks.results ---

export const collectionTaskResultsValidator = v.object({
    extracted: v.number(),
    submitted: v.number(),
    deduped: v.number(),
    identityDeduped: v.optional(v.number()),
    identityMatched: v.optional(v.number()),
    legacyExternalIdMatched: v.optional(v.number()),
    inserted: v.number(),
    updated: v.number(),
    unchanged: v.number(),
    autoAnalyzed: v.optional(v.number()),
    autoAnalysisTaskId: v.optional(v.string()),
});
