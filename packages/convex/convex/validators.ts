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
    // Accepts both the canonical envelope shape and the legacy bare-array form.
    tagEnvelope: v.optional(v.union(
        v.object({
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
        }),
        v.array(v.object({
            tag: v.string(),
            source: v.string(),
            confidence: v.number(),
            version: v.number(),
            evidence: v.optional(v.array(v.string())),
        })),
    )),
    ruleScores: v.record(v.string(), v.number()),
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

// --- RelatedExpContext (P1: context-derived evidence ceiling) ---
// Carries search/JD context from the dispatch call site to normalizeAnalysisResult
// so the evidence ceiling evaluator can compute evidenceBandMax without domain
// knowledge being hardcoded in the scoring layer.

export const relatedExpContextValidator = v.object({
    /** "sales" | "technical" | "any" — role type required by the JD/search profile */
    roleFilterType: v.optional(v.string()),
    /** Minimum domain-role years required (from search profile or JD) */
    minRoleYears: v.optional(v.number()),
    /** "CN" | "MY" — market context for market-specific scoring floors */
    market: v.optional(v.string()),
    /** Output locale for AI prompts — "zh" | "en" */
    locale: v.optional(v.string()),
});

// --- RelatedExpEvidence (P1: stored result of the evidence ceiling evaluation) ---

export const relatedExpEvidenceValidator = v.object({
    /** 100 | 65 | 45 | 30 */
    evidenceBandMax: v.number(),
    /** "full" | "partial" | "weak" | "none" */
    coverage: v.string(),
    /** Reasons the ceiling was applied (empty when full coverage) */
    missingReasons: v.array(v.string()),
    /** min(llmRaw, recommendationMax, evidenceBandMax) */
    effectiveRaw: v.number(),
    llmRaw: v.number(),
    recommendationMax: v.number(),
    contextHash: v.string(),
    rubricVersion: v.string(),
});

// --- Analysis result (resumes.analyses values) ---

export const analysisResultValidator = v.object({
    score: v.number(),
    summary: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    recommendation: v.optional(v.string()),
    breakdown: v.optional(v.record(v.string(), v.number())),
    keyFactors: v.optional(v.array(v.object({
        factor: v.string(),
        weight: v.optional(v.number()),
        value: v.string(),
    }))),
    jobDescriptionId: v.optional(v.string()),
    promptVersion: v.optional(v.number()),
    locale: v.optional(v.string()),
    queryLocation: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
    /** P1: stored evidence ceiling result for audit/display */
    relatedExpEvidence: v.optional(relatedExpEvidenceValidator),
});

// --- Resume analysis (resumes.analysis — summary/highlights required) ---

export const resumeAnalysisValidator = v.object({
    score: v.number(),
    summary: v.string(),
    highlights: v.array(v.string()),
    recommendation: v.string(),
    breakdown: v.optional(v.record(v.string(), v.number())),
    jobDescriptionId: v.optional(v.string()),
    promptVersion: v.optional(v.number()),
    locale: v.optional(v.string()),
    queryLocation: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
    /** P1: stored evidence ceiling result for audit/display */
    relatedExpEvidence: v.optional(relatedExpEvidenceValidator),
});

// --- ResumeFilters (screening_sessions.config.filters, search_history.filters) ---

export const resumeFiltersValidator = v.optional(v.object({
    minExperience: v.optional(v.number()),
    maxExperience: v.optional(v.number()),
    education: v.optional(v.array(v.string())),
    skills: v.optional(v.array(v.string())),
    locations: v.optional(v.array(v.string())),
    minSalary: v.optional(v.number()),
    maxSalary: v.optional(v.number()),
    minRoleYears: v.optional(v.number()),
    roleFilterType: v.optional(v.string()),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    sources: v.optional(v.array(v.string())),
    status: v.optional(v.array(v.union(
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
        v.literal("withdrawn"),
    ))),
    minMatchScore: v.optional(v.number()),
    recommendation: v.optional(v.array(v.union(
        v.literal("strong_match"),
        v.literal("match"),
        v.literal("potential"),
        v.literal("no_match"),
    ))),
    sortBy: v.optional(v.union(
        v.literal("score"),
        v.literal("name"),
        v.literal("experience"),
        v.literal("extractedAt"),
    )),
    sortOrder: v.optional(v.union(
        v.literal("asc"),
        v.literal("desc"),
    )),
}));

// --- Shared JSON value validator (replaces v.any() for typed JSON fields) ---

const jsonPrimitive = v.union(v.string(), v.number(), v.boolean(), v.null());
const jsonL1 = v.union(jsonPrimitive, v.array(jsonPrimitive), v.record(v.string(), jsonPrimitive));
const jsonL2 = v.union(jsonPrimitive, v.array(jsonL1), v.record(v.string(), jsonL1));
const jsonL3 = v.union(jsonPrimitive, v.array(jsonL2), v.record(v.string(), jsonL2));
const jsonL4 = v.union(jsonPrimitive, v.array(jsonL3), v.record(v.string(), jsonL3));
const jsonL5 = v.union(jsonPrimitive, v.array(jsonL4), v.record(v.string(), jsonL4));
const jsonL6 = v.union(jsonPrimitive, v.array(jsonL5), v.record(v.string(), jsonL5));
const jsonL7 = v.union(jsonPrimitive, v.array(jsonL6), v.record(v.string(), jsonL6));
const jsonL8 = v.union(jsonPrimitive, v.array(jsonL7), v.record(v.string(), jsonL7));

/** Accepts any JSON-safe value up to 8 levels of nesting (string|number|boolean|null leaves). */
export const jsonValueValidator = v.union(jsonPrimitive, v.array(jsonL8), v.record(v.string(), jsonL8));

/** Accepts a record<string, JSON> — for content, profile, and similar semi-structured fields. */
export const jsonRecordValidator = v.record(v.string(), jsonL8);

// --- Matching rules (analyze args) ---

const primitiveValueValidator = v.union(v.string(), v.number(), v.boolean());
export const matchingRulesValidator = v.optional(v.union(v.string(), v.record(v.string(), primitiveValueValidator), v.array(primitiveValueValidator)));
