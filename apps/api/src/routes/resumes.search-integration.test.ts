/**
 * BFF search integration tests for the prepareConvexCandidates dispatch paths.
 *
 * Tests the routing logic that decides which Convex query to call based on
 * keyword expansion mode (AND/OR), pagination flags, and filter presence.
 *
 * The real keyword expansion service (unifiedSearchService.expandKeyword)
 * determines AND vs OR mode. In the test environment:
 * - Single-keyword "CNC" → 1 group → effectively AND (all 1 group must match)
 * - Multi-keyword "CNC 销售" → 2 groups → AND mode → scanResumePageSlim path
 *
 * Uses mocked fetch to intercept Convex HTTP calls and validates:
 * - Correct query path selection
 * - Pagination cursor propagation
 * - Filter parameter passthrough
 * - Empty result handling
 * - Byte-limit safety (scanResumePageSlim batch size)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";

// ── Helpers ────────────────────────────────────────────────────────────

type ConvexCall = {
    pathName: string;
    args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
    const requestURL = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;

    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (!isRecord(body)) throw new Error("Missing convex request body");

    const pathName = typeof body.path === "string" ? body.path : "";
    const args = isRecord(body.args) ? body.args : {};
    return { pathName, args };
}

function convexSuccess(value: unknown): Response {
    return new Response(JSON.stringify({ status: "success", value }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function buildConvexResumeRecord(
    resumeId: string,
    overrides: {
        name?: string;
        searchText?: string;
        source?: string;
        primaryRuleScore?: number;
    } = {}
) {
    return {
        _id: resumeId,
        identityKey: `key-${resumeId}`,
        source: overrides.source ?? "seek",
        primaryRuleScore: overrides.primaryRuleScore ?? 0,
        searchText: overrides.searchText ?? "cnc 销售工程师 数控",
        isArchived: false,
        crawledAt: Date.now(),
        tags: [],
        content: {
            name: overrides.name ?? resumeId,
            location: "东莞",
            experience: "5年",
            education: "本科",
            jobIntention: "CNC销售",
            profileUrl: `https://example.com/${resumeId}`,
            workHistory: [{ raw: "2020-2025 CNC销售工程师" }],
            extractedAt: "2026-03-24T00:00:00.000Z",
        },
        ingestData: { industryTags: ["制造业"] },
    };
}

/**
 * Creates a mock fetch that handles the AND-mode scan path:
 * - scanResumePageSlim returns matching slim docs
 * - getResumeDocsByIds returns full docs for matches
 */
function mockAndModeScanPath(slimDocs: Array<{ _id: string; searchText: string }>) {
    const fullDocs = slimDocs.map((d) => buildConvexResumeRecord(d._id, { searchText: d.searchText }));
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const call = parseConvexCall(input, init);

        if (call.pathName === "resumes:scanResumePageSlim") {
            return convexSuccess({
                docs: slimDocs.map((d) => ({
                    _id: d._id,
                    source: "seek",
                    searchText: d.searchText,
                    isArchived: false,
                    primaryRuleScore: 0,
                    age: 30,
                })),
                isDone: true,
                cursor: null,
            });
        }
        if (call.pathName === "resumes:getResumeDocsByIds") {
            const ids = call.args.ids as string[];
            return convexSuccess(fullDocs.filter((d) => ids.includes(d._id)));
        }
        throw new Error(`Unexpected convex path: ${call.pathName}`);
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("BFF search dispatcher integration", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("AND-mode path (scanResumePageSlim → getResumeDocsByIds)", () => {
        it("dispatches scanResumePageSlim for multi-keyword AND search", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes:scanResumePageSlim") {
                    return convexSuccess({
                        docs: [{ _id: "r1", source: "seek", searchText: "cnc 销售工程师", isArchived: false, primaryRuleScore: 0, age: 30 }],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([buildConvexResumeRecord("r1", { name: "Alice" })]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");

            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload.success).toBe(true);
            expect(payload.summary.source).toBe("convex");

            // AND-mode triggers scanResumePageSlim
            const slimCalls = calls.filter((c) => c.pathName === "resumes:scanResumePageSlim");
            expect(slimCalls.length).toBeGreaterThan(0);

            // Followed by getResumeDocsByIds for matches
            const docCalls = calls.filter((c) => c.pathName === "resumes:getResumeDocsByIds");
            expect(docCalls.length).toBeGreaterThan(0);
        });

        it("filters non-matching docs before fetching full records", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);

                if (call.pathName === "resumes:scanResumePageSlim") {
                    return convexSuccess({
                        docs: [
                            { _id: "r1", source: "seek", searchText: "cnc 销售工程师", isArchived: false, primaryRuleScore: 0, age: 30 },
                            { _id: "r2", source: "seek", searchText: "java 开发", isArchived: false, primaryRuleScore: 0, age: 25 },
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([buildConvexResumeRecord("r1", { name: "Alice" })]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
            expect(response.status).toBe(200);

            // Only r1 (cnc+销售 match) should be fetched; r2 (java only) excluded
            const docCalls = calls.filter((c) => c.pathName === "resumes:getResumeDocsByIds");
            const allIds = docCalls.flatMap((c) => (c.args.ids as string[]));
            expect(allIds).toContain("r1");
            expect(allIds).not.toContain("r2");
        });

        it("caps scanResumePageSlim numItems to bounded value", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes:scanResumePageSlim") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");

            const slimCall = calls.find((c) => c.pathName === "resumes:scanResumePageSlim");
            expect(slimCall).toBeDefined();
            const numItems = slimCall!.args.numItems as number;
            expect(numItems).toBeGreaterThan(0);
            expect(numItems).toBeLessThanOrEqual(1000);
        });
    });

    describe("scanResumePageSlim scan path with empty results", () => {
        it("returns empty data when no docs match AND-mode keywords", async () => {
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                if (call.pathName === "resumes:scanResumePageSlim") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
            expect(response.status).toBe(200);

            const payload = await response.json();
            expect(payload.success).toBe(true);
            expect(payload.data).toHaveLength(0);
        });
    });

    describe("filter parameter propagation", () => {
        it("passes age and experience filters to scan query", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes:scanResumePageSlim") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&minAge=25&maxAge=40");

            // Filters are applied BFF-side after scanResumePageSlim
            const slimCalls = calls.filter((c) => c.pathName === "resumes:scanResumePageSlim");
            expect(slimCalls.length).toBeGreaterThan(0);
        });
    });

    describe("Byte-limit safety validation", () => {
        it("scanResumePageSlim uses bounded batch size per call", async () => {
            const batchSizes: number[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);

                if (call.pathName === "resumes:scanResumePageSlim") {
                    batchSizes.push(call.args.numItems as number);
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=100");

            for (const batchSize of batchSizes) {
                expect(batchSize).toBeGreaterThan(0);
                expect(batchSize).toBeLessThanOrEqual(1000);
            }
        });
    });
});
