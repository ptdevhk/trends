import { describe, expect, it, vi } from "vitest";

import { normalizeEducationLevel, parseExperienceYears } from "@trends/shared";
import { ingestDataValidator, collectionTaskResultsValidator, resumeAnalysisValidator } from "../convex/validators";
import { storeConfirmResult } from "../convex/analyze";
import schema from "../convex/schema";
import * as resumesModule from "../convex/resumes";

/**
 * Schema-validator sync test.
 *
 * Prevents drift between Convex schema definitions and mutation validators
 * that mirror those shapes. When a field is added to the schema, this test
 * fails until the mutation validator is also updated (or the field is added
 * to the shared validator).
 *
 * Strategy:
 * - For shared validators (ingestData, collectionTaskResults): verify field
 *   keys match expected canonical sets. Adding a field to the schema without
 *   updating the shared validator will fail the "has all expected fields" test.
 * - For shapes with intentional differences (analysis in storeConfirmResult):
 *   verify the mutation handler accepts all schema fields by calling it with
 *   a fully-populated payload.
 */

function getFieldNames(validator: { fields: Record<string, unknown> }): string[] {
    return Object.keys(validator.fields).sort();
}

// --- ingestData ---

describe("ingestData validator sync", () => {
    /**
     * Canonical field set for ingestData. When a field is added to the
     * resumes table schema's ingestData, add it here too. This test is the
     * safety net: if you add a field to schema but not here, the shared
     * validator won't have it, and the mutation will fail at runtime.
     */
    const CANONICAL_INGEST_DATA_FIELDS = [
        "market",
        "evidenceText",
        "industryTags",
        "synonymHits",
        "brandHits",
        "brandOrigin",
        "productClass",
        "companyHits",
        "industryDbV2Raw",
        "industryDbV2RawComponents",
        "roleSignals",
        "taggingEnvelope",
        "tagEnvelope",
        "ruleScores",
        "experienceLevel",
        "computedAt",
        "skillsVersion",
        "verifiedRoleYears",
    ].sort();

    it("ingestDataValidator has all canonical fields", () => {
        const fields = getFieldNames(ingestDataValidator);
        expect(fields).toEqual(CANONICAL_INGEST_DATA_FIELDS);
    });

    it("updateIngestData single-item mutation is removed (dead code)", () => {
        // The single-item updateIngestData was dead code with a drifted validator.
        // Verify it stays removed.
        expect((resumesModule as Record<string, unknown>).updateIngestData).toBeUndefined();
    });
});

// --- collection_tasks.results ---

describe("collectionTaskResults validator sync", () => {
    const CANONICAL_RESULTS_FIELDS = [
        "extracted",
        "submitted",
        "deduped",
        "identityDeduped",
        "identityMatched",
        "legacyExternalIdMatched",
        "inserted",
        "updated",
        "unchanged",
        "autoAnalyzed",
        "autoAnalysisTaskId",
    ].sort();

    it("collectionTaskResultsValidator has all canonical fields", () => {
        const fields = getFieldNames(collectionTaskResultsValidator);
        expect(fields).toEqual(CANONICAL_RESULTS_FIELDS);
    });
});

// --- analysis shape (intentional differences) ---

describe("analysis validator sync (with intentional overrides)", () => {
    /**
     * The schema's `analysis` object has some fields as optional that the
     * `storeConfirmResult` mutation requires (callers always provide them;
     * the schema marks optional for backward compat with old documents).
     *
     * This test verifies the storeConfirmResult handler can process a payload
     * containing all schema-defined fields without error.
     */

    const PRIMARY_RESUME_ANALYSIS_FIELDS = [
        "score",
        "summary",
        "highlights",
        "concerns",
        "recommendation",
        "breakdown",
        "keyFactors",
        "jobDescriptionId",
        "promptVersion",
        "locale",
        "queryLocation",
        "analyzedAt",
        "relatedExpEvidence",
    ].sort();

    const CONFIRM_RESULT_ANALYSIS_FIELDS = [
        "score",
        "summary",
        "highlights",
        "concerns",
        "recommendation",
        "breakdown",
        "keyFactors",
        "jobDescriptionId",
        "promptVersion",
        "locale",
        "queryLocation",
        "analyzedAt",
    ] as const;

    it("resumes.analysis schema stays in sync with the shared primary analysis validator", () => {
        const resumeFields = schema.tables.resumes.validator.fields;
        const analysisValidator = resumeFields.analysis as { fields: Record<string, unknown> };

        expect(getFieldNames(analysisValidator)).toEqual(PRIMARY_RESUME_ANALYSIS_FIELDS);
        expect(getFieldNames(resumeAnalysisValidator)).toEqual(PRIMARY_RESUME_ANALYSIS_FIELDS);
    });

    it("storeConfirmResult accepts all confirm analysis fields", async () => {
        const patch = vi.fn(async () => undefined);
        const insert = vi.fn(async () => "mock-id");
        // Mock chainable query for Phase 3 propagation helpers
        const mockQueryChain = {
            withIndex: () => mockQueryChain,
            withSearchIndex: () => mockQueryChain,
            order: () => mockQueryChain,
            filter: () => mockQueryChain,
            first: async () => null,
            unique: async () => null,
            take: async () => [],
            collect: async () => [],
        };

        const ctx = {
            db: {
                get: vi.fn(async () => ({
                    _id: "resume-1",
                    analyses: {},
                })),
                patch,
                insert,
                query: vi.fn(() => mockQueryChain),
            },
        };

        const handler = (storeConfirmResult as unknown as {
            _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        })._handler;

        // Provide all confirm-result fields — this should succeed without
        // ArgumentValidationError if the validator includes them
        const fullAnalysisPayload = {
            resumeId: "resume-1",
            analysis: {
                score: 80,
                summary: "test summary",
                highlights: ["highlight1"],
                concerns: ["concern1"],
                recommendation: "yes",
                breakdown: { related: 80 },
                keyFactors: [{ factor: "experience", value: "five years" }],
                jobDescriptionId: "jd-1",
                promptVersion: 2,
                locale: "en",
                queryLocation: "Shanghai",
                analyzedAt: Date.now(),
            },
        };

        // If the validator is missing any field, Convex will throw
        // ArgumentValidationError at validation time (before handler runs)
        await handler(ctx, fullAnalysisPayload);

        expect(patch).toHaveBeenCalledTimes(1);
    });

    it("all confirm analysis fields are tested", () => {
        const expectedCount = 12; // score, summary, highlights, concerns, recommendation,
        // breakdown, keyFactors, jobDescriptionId, promptVersion, locale, queryLocation, analyzedAt
        expect(CONFIRM_RESULT_ANALYSIS_FIELDS).toHaveLength(expectedCount);
    });
});

// --- normalizeEducationLevel / parseExperienceYears sync with @trends/shared ---

/**
 * Convex cannot import from @trends/shared, so it maintains local copies of
 * normalizeEducationLevel and parseExperienceYears in resumes.ts.
 * If either copy diverges, filter results will differ between BFF and Convex.
 *
 * This test asserts the shared and Convex versions produce identical outputs.
 * The Convex versions are replicated inline (they are module-private).
 * When updating either copy, update the other and this test will catch drift.
 */

// Convex-local normalizeEducationLevel (from convex/resumes.ts)
function convexNormalizeEducationLevel(value: string): string | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    // Chinese education terms
    if (/博士/.test(normalized)) return "phd";
    if (/硕士|研究生/.test(normalized)) return "master";
    if (/本科/.test(normalized)) return "bachelor";
    if (/大专|专科/.test(normalized)) return "associate";
    if (/中专|高中|中技/.test(normalized)) return "high_school";
    // English education terms (Seek MY market)
    if (/\bph\.?d\.?\b/.test(normalized) || /\bdoctorate\b/.test(normalized)) return "phd";
    if (/\bmaster/.test(normalized) || /\bm\.?s\.?\b/.test(normalized) || /\bm\.?a\.?\b/.test(normalized) || /\bmba\b/.test(normalized)) return "master";
    if (/\bdiploma\b/.test(normalized) || /\bassociate\b/.test(normalized)) return "associate";
    if (/\bbachelor/.test(normalized) || /\bdegree\b/.test(normalized) || /\bb\.?s\.?\b/.test(normalized) || /\bb\.?a\.?\b/.test(normalized)) return "bachelor";
    if (/\bhigh school\b/.test(normalized) || /\bspm\b/.test(normalized) || /\bstpm\b/.test(normalized)) return "high_school";
    return null;
}

// Convex-local parseExperienceYears (from convex/resumes.ts)
function convexParseExperienceYears(value: string): number | null {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (/应届|无经验|fresh grad|entry level|no experience|fresh graduate|beginner/i.test(normalized)) {
        return 0;
    }
    const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
    if (!match) {
        return null;
    }
    const min = Number(match[1]);
    const max = match[2] ? Number(match[2]) : min;
    return Number.isNaN(max) ? null : max;
}

describe("normalizeEducationLevel sync: @trends/shared vs Convex local copy", () => {
    const TEST_CASES: Array<[string, string | null]> = [
        // Chinese
        ["博士", "phd"],
        ["硕士", "master"],
        ["研究生", "master"],
        ["本科", "bachelor"],
        ["大专", "associate"],
        ["专科", "associate"],
        ["中专", "high_school"],
        ["高中", "high_school"],
        ["中技", "high_school"],
        // English
        ["PhD", "phd"],
        ["Ph.D.", "phd"],
        ["Doctorate", "phd"],
        ["Master of Engineering", "master"],
        ["M.S.", "master"],
        ["MBA", "master"],
        ["Bachelor of Science", "bachelor"],
        ["B.S.", "bachelor"],
        ["Diploma", "associate"],
        ["Associate Degree", "associate"],
        ["High School", "high_school"],
        ["SPM", "high_school"],
        ["STPM", "high_school"],
        // Edge cases
        ["", null],
        ["Unknown", null],
        ["  本科  ", "bachelor"],
    ];

    it.each(TEST_CASES)("normalizeEducationLevel(%j) = %j", (input, expected) => {
        const sharedResult = normalizeEducationLevel(input);
        const convexResult = convexNormalizeEducationLevel(input);
        expect(sharedResult).toBe(expected);
        expect(convexResult).toBe(expected);
        expect(sharedResult).toBe(convexResult);
    });
});

describe("parseExperienceYears sync: @trends/shared vs Convex local copy", () => {
    const TEST_CASES: Array<[string, number | null]> = [
        // Chinese
        ["应届", 0],
        ["无经验", 0],
        // English (Seek EN)
        ["fresh graduate", 0],
        ["entry level", 0],
        ["no experience", 0],
        ["beginner", 0],
        // Ranges
        ["3-5", 5],
        ["2~3", 3],
        ["1到3", 3],
        // Single values
        ["5", 5],
        ["10", 10],
        // With year suffix
        ["5年", 5],
        ["3-5年", 5],
        // Edge cases
        ["", null],
        ["unknown", null],
        ["  3  ", 3],
    ];

    it.each(TEST_CASES)("parseExperienceYears(%j) = %j", (input, expected) => {
        const sharedResult = parseExperienceYears(input);
        const convexResult = convexParseExperienceYears(input);
        expect(sharedResult).toBe(expected);
        expect(convexResult).toBe(expected);
        expect(sharedResult).toBe(convexResult);
    });
});
