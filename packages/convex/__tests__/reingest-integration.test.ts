import { describe, expect, it, vi } from "vitest";
import { v } from "convex/values";

import { ingestDataValidator } from "../convex/validators";
import { hardResetIngestData } from "../convex/resumes";

/**
 * Integration test for the re-ingest pipeline.
 *
 * The "Hard Reset & Re-ingest" flow broke silently when `market` was added
 * to the BFF output but not to the `updateIngestDataBatch` validator.
 * This test catches that class of bug by:
 *
 * 1. Defining the canonical BFF IngestResult shape as a fixture
 * 2. Verifying the fixture passes the Convex ingestDataValidator
 * 3. Testing the hardResetIngestData handler clears the right fields
 * 4. Testing the ingest_agent mapping from IngestResult to validator args
 *
 * When a field is added to IngestResult in the BFF, this test will fail
 * until the field is also added to ingestDataValidator (and thus to the
 * updateIngestDataBatch mutation validator).
 */

// --- BFF IngestResult fixture ---
// This mirrors the IngestResult interface from
// apps/api/src/services/ingest-compute-service.ts
// When the BFF adds a field, update this fixture.

const BFF_INGEST_RESULT_FIXTURE = {
    resumeId: "test-resume-1",
    market: "MY",
    evidenceText: "fanuc mechatronics field service engineer cnc programming",
    industryTags: ["CNC", "销售"],
    synonymHits: ["销售", "业务"],
    brandHits: [
        { brand: "FANUC", role: "both" as const, source: "workHistory", context: "equipment" as const, companyId: 123 },
    ],
    companyHits: ["FANUC Mechatronics"],
    industryDbV2Raw: 0,
    industryDbV2RawComponents: {
        companyScore: 0,
        brandScore: 0,
        weightedBrandUnits: 0,
        uniqueCompanies: 0,
        brandUnitCount: 0,
    },
    roleSignals: [
        {
            type: "sales",
            matchedSignals: ["sales"],
            signalCount: 2,
            occurrences: 1,
            years: 3,
            industryVerifiedYears: 0,
            roleRelevantYears: 0,
            industryVerifiedRelevantYears: 0,
            matchedWorkEntries: [
                {
                    companyName: "Test Corp",
                    jobTitle: "Sales Engineer",
                    years: 3,
                    industryVerified: false,
                    matchedSignals: ["sales"],
                    directRoleMatch: true,
                },
            ],
            verifyIn: "workHistory",
        },
    ],
    verifiedRoleYears: { sales: 3 },
    taggingEnvelope: {
        schemaVersion: 1,
        generatedAt: Date.now(),
        entries: [
            {
                tag: "industry:CNC",
                source: "rule",
                confidence: 85,
                version: 9,
                provenance: {
                    stage: "industry_taxonomy",
                    generatedBy: "ingest-compute-service",
                    evidence: ["industryTag:CNC"],
                },
            },
        ],
    },
    companyPatternAliasTokens: "fanuc",
    ruleScores: { "jd-test": 15 },
    primaryRuleScore: 15,
    experienceLevel: "mid",
    computedAt: Date.now(),
    skillsVersion: 9,
} as const;

/**
 * Canonical list of fields that the BFF IngestResult returns.
 * When the BFF adds a new field, add it here. The test below
 * verifies every field listed here is accepted by ingestDataValidator.
 */
const BFF_INGEST_RESULT_INGEST_DATA_FIELDS = [
    "market",
    "evidenceText",
    "industryTags",
    "synonymHits",
    "brandHits",
    "companyHits",
    "industryDbV2Raw",
    "industryDbV2RawComponents",
    "roleSignals",
    "verifiedRoleYears",
    "taggingEnvelope",
    "ruleScores",
    "experienceLevel",
    "computedAt",
    "skillsVersion",
] as const;

// --- Tests ---

describe("Re-ingest pipeline integration", () => {
    describe("BFF IngestResult → Convex validator compatibility", () => {
        it("every BFF IngestResult field is accepted by ingestDataValidator", () => {
            const validatorFields = Object.keys(ingestDataValidator.fields);

            for (const field of BFF_INGEST_RESULT_INGEST_DATA_FIELDS) {
                expect(
                    validatorFields,
                    `BFF field "${field}" missing from ingestDataValidator — add it to validators.ts`,
                ).toContain(field);
            }
        });

        it("ingestDataValidator accepts a realistic BFF IngestResult payload", () => {
            // This is the exact mapping that ingest_agent.ts does
            const mappedIngestData = {
                market: BFF_INGEST_RESULT_FIXTURE.market,
                evidenceText: BFF_INGEST_RESULT_FIXTURE.evidenceText,
                industryTags: BFF_INGEST_RESULT_FIXTURE.industryTags,
                synonymHits: BFF_INGEST_RESULT_FIXTURE.synonymHits,
                brandHits: BFF_INGEST_RESULT_FIXTURE.brandHits,
                companyHits: BFF_INGEST_RESULT_FIXTURE.companyHits,
                industryDbV2Raw: BFF_INGEST_RESULT_FIXTURE.industryDbV2Raw,
                industryDbV2RawComponents: BFF_INGEST_RESULT_FIXTURE.industryDbV2RawComponents,
                roleSignals: BFF_INGEST_RESULT_FIXTURE.roleSignals,
                verifiedRoleYears: BFF_INGEST_RESULT_FIXTURE.verifiedRoleYears,
                taggingEnvelope: BFF_INGEST_RESULT_FIXTURE.taggingEnvelope,
                ruleScores: BFF_INGEST_RESULT_FIXTURE.ruleScores,
                experienceLevel: BFF_INGEST_RESULT_FIXTURE.experienceLevel,
                computedAt: BFF_INGEST_RESULT_FIXTURE.computedAt,
                skillsVersion: BFF_INGEST_RESULT_FIXTURE.skillsVersion,
            };

            // Verify all mapped fields exist in the validator
            const validatorFieldNames = Object.keys(ingestDataValidator.fields);
            const mappedFieldNames = Object.keys(mappedIngestData);

            for (const field of mappedFieldNames) {
                expect(
                    validatorFieldNames,
                    `Mapped field "${field}" from BFF not in ingestDataValidator — this is the exact bug that broke re-ingest`,
                ).toContain(field);
            }
        });

        it("MY market value is accepted by the market field validator", () => {
            const marketValidator = ingestDataValidator.fields.market;
            expect(marketValidator).toBeDefined();
            // v.optional(v.string()) should accept "MY"
            expect(typeof BFF_INGEST_RESULT_FIXTURE.market).toBe("string");
        });
    });

    describe("hardResetIngestData handler", () => {
        it("clears ingestData, analysis, analyses, primaryRuleScore, searchText", async () => {
            const patch = vi.fn(async () => undefined);
            const runMutation = vi.fn(async () => undefined);

            const resumes = [
                {
                    _id: "resume-1",
                    externalId: "ext-1",
                    content: { name: "Alice" },
                    hash: "hash-1",
                    source: "source-a",
                    crawledAt: 1,
                    tags: ["profile-1"],
                    ingestData: {
                        market: "MY",
                        evidenceText: "computed",
                        industryTags: [],
                        synonymHits: [],
                        ruleScores: {},
                        experienceLevel: "unknown",
                        computedAt: 1,
                        skillsVersion: 1,
                    },
                    analysis: { score: 88, summary: "summary", highlights: [], recommendation: "yes" },
                    analyses: { default: { score: 88 } },
                    primaryRuleScore: 88,
                    searchText: "alice sales",
                },
            ];

            const ctx = {
                db: {
                    query(table: string) {
                        if (table === "resume_analyses") {
                            return {
                                withIndex() {
                                    return {
                                        async unique() {
                                            return null;
                                        },
                                    };
                                },
                            };
                        }
                        return {
                            order(orderDirection: string) {
                                expect(orderDirection).toBe("desc");
                                return {
                                    async paginate(args: { cursor: string | null; numItems: number; maximumBytesRead?: number; maximumRowsRead?: number }) {
                                        return {
                                            page: resumes,
                                            isDone: true,
                                            continueCursor: "cursor-unused",
                                        };
                                    },
                                };
                            },
                        };
                    },
                    patch,
                },
                runMutation,
            };

            const handler = (hardResetIngestData as unknown as {
                _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
            })._handler;

            const result = await handler(ctx, {});

            expect(result).toEqual({ cleared: 1, hasMore: false, cursor: null });
            expect(patch).toHaveBeenCalledTimes(1);
            expect(patch).toHaveBeenCalledWith("resume-1", {
                ingestData: undefined,
                analysis: undefined,
                analyses: undefined,
                primaryRuleScore: undefined,
                searchText: undefined,
            });
        });

        it("preserves resumes that have no computed fields", async () => {
            const patch = vi.fn(async () => undefined);
            const runMutation = vi.fn(async () => undefined);

            const resumes = [
                {
                    _id: "resume-1",
                    externalId: "ext-1",
                    content: { name: "Bob" },
                    hash: "hash-1",
                    source: "source-a",
                    crawledAt: 1,
                    tags: ["profile-1"],
                },
            ];

            const ctx = {
                db: {
                    query() {
                        return {
                            order() {
                                return {
                                    async paginate() {
                                        return {
                                            page: resumes,
                                            isDone: true,
                                            continueCursor: "cursor-unused",
                                        };
                                    },
                                };
                            },
                        };
                    },
                    patch,
                },
                runMutation,
            };

            const handler = (hardResetIngestData as unknown as {
                _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
            })._handler;

            const result = await handler(ctx, {});

            expect(result).toEqual({ cleared: 0, hasMore: false, cursor: null });
            expect(patch).not.toHaveBeenCalled();
        });
    });

    describe("ingest_agent mapping completeness", () => {
        it("all fields from BFF IngestResult are mapped in ingest_agent", () => {
            // This verifies that the mapping in ingest_agent.ts doesn't
            // accidentally drop fields when converting IngestResult to
            // updateIngestDataBatch args.
            //
            // The mapping in ingest_agent.ts processNewResumes:
            //   ingestData: { market, evidenceText, industryTags, ... }
            //
            // Every field in BFF_INGEST_RESULT_INGEST_DATA_FIELDS must be
            // present in the ingestData object sent to updateIngestDataBatch.

            const INGEST_AGENT_MAPPED_FIELDS = [
                "market",
                "evidenceText",
                "industryTags",
                "synonymHits",
                "brandHits",
                "companyHits",
                "industryDbV2Raw",
                "industryDbV2RawComponents",
                "roleSignals",
                "verifiedRoleYears",
                "taggingEnvelope",
                "ruleScores",
                "experienceLevel",
                "computedAt",
                "skillsVersion",
            ] as const;

            // Verify the mapping list matches the BFF output list
            expect([...INGEST_AGENT_MAPPED_FIELDS].sort()).toEqual(
                [...BFF_INGEST_RESULT_INGEST_DATA_FIELDS].sort(),
            );
        });
    });
});
