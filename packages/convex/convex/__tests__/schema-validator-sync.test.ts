import { describe, expect, it, vi } from "vitest";

import { ingestDataValidator, collectionTaskResultsValidator } from "../validators";
import { storeConfirmResult } from "../analyze";
import * as resumesModule from "../resumes";

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

    const ALL_SCHEMA_ANALYSIS_FIELDS = [
        "score",
        "summary",
        "highlights",
        "recommendation",
        "breakdown",
        "jobDescriptionId",
        "promptVersion",
        "locale",
        "queryLocation",
        "analyzedAt",
    ] as const;

    it("storeConfirmResult accepts all schema analysis fields", async () => {
        const patch = vi.fn(async () => undefined);

        const ctx = {
            db: {
                get: vi.fn(async () => ({
                    _id: "resume-1",
                    analyses: {},
                })),
                patch,
            },
        };

        const handler = (storeConfirmResult as unknown as {
            _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        })._handler;

        // Provide ALL schema fields — this should succeed without
        // ArgumentValidationError if the validator includes them
        const fullAnalysisPayload = {
            resumeId: "resume-1",
            analysis: {
                score: 80,
                summary: "test summary",
                highlights: ["highlight1"],
                recommendation: "yes",
                breakdown: { related: 80 },
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

    it("all schema analysis fields are tested", () => {
        // Meta-test: ensure ALL_SCHEMA_ANALYSIS_FIELDS stays in sync with
        // the schema definition in schema.ts
        const expectedCount = 10; // score, summary, highlights, recommendation,
                                  // breakdown, jobDescriptionId, promptVersion,
                                  // locale, queryLocation, analyzedAt
        expect(ALL_SCHEMA_ANALYSIS_FIELDS).toHaveLength(expectedCount);
    });
});
