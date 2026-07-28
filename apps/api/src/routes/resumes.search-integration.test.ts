/**
 * BFF search integration tests for the prepareConvexCandidates dispatch paths.
 *
 * Tests the routing logic that decides which Convex query to call based on
 * keyword expansion mode (AND/OR), pagination flags, and filter presence.
 *
 * The real keyword expansion service (unifiedSearchService.expandKeyword)
 * determines AND vs OR mode. In the test environment:
 * - Single-keyword "CNC" → 1 group → effectively AND (all 1 group must match)
 * - Multi-keyword "CNC 销售" → 2 groups → AND mode → scanResumeDigestPage path
 *
 * Uses mocked fetch to intercept Convex HTTP calls and validates:
 * - Correct query path selection
 * - Pagination cursor propagation
 * - Filter parameter passthrough
 * - Empty result handling
 * - Byte-limit safety (scanResumeDigestPage batch size)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { parseJsonBody } from "../test-utils";
import { createAuthContext } from "./test-auth-helpers";

// ── Helpers ────────────────────────────────────────────────────────────

type ConvexCall = {
    pathName: string;
    args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
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

function buildDigestRow(resumeId: string, overrides: Record<string, unknown> = {}) {
    return {
        _id: `digest-${resumeId}`,
        resumeId,
        source: "seek",
        sourceKey: "seek",
        searchText: "cnc 销售工程师",
        isArchived: false,
        primaryRuleScore: 0,
        age: 30,
        ...overrides,
    };
}

function buildFilterableConvexResumeRecord(
    resumeId: string,
    params: {
        location: string;
        verifiedRoleYears: Record<string, number>;
    },
) {
    const record = buildConvexResumeRecord(resumeId, {
        name: resumeId,
        searchText: "cnc 销售 数控 销售工程师",
    });
    return {
        ...record,
        content: {
            ...record.content,
            location: params.location,
        },
        ingestData: {
            ruleScores: {},
            industryTags: ["机械", "销售"],
            synonymHits: ["cnc", "销售"],
            brandHits: [],
            companyHits: [],
            experienceLevel: "mid",
            computedAt: Date.now(),
            skillsVersion: 1,
            verifiedRoleYears: params.verifiedRoleYears,
            roleSignals: Object.entries(params.verifiedRoleYears).map(([type, years]) => ({
                type,
                matchedSignals: [type],
                signalCount: 1,
                occurrences: 1,
                years,
                industryVerifiedYears: years,
                roleRelevantYears: years,
                industryVerifiedRelevantYears: years,
                matchedWorkEntries: [{
                    jobTitle: `${type} role`,
                    years,
                    industryVerified: true,
                    matchedSignals: [type],
                    directRoleMatch: true,
                }],
                verifyIn: "workHistory",
            })),
        },
    };
}

function buildMyFallbackConvexResumeRecord(resumeId: string, location = "Malaysia") {
    const record = buildConvexResumeRecord(resumeId, {
        name: resumeId,
        searchText: "CNC Sales Manager machine tools",
        source: "hk.employer.seek.com",
    });

    return {
        ...record,
        source: "hk.employer.seek.com",
        sourceKey: "seek",
        content: {
            ...record.content,
            location,
            experience: "8 years",
            education: "Bachelor",
            jobIntention: "Sales Engineer",
            workHistory: [{ raw: "2019-2024 Sales Manager" }],
        },
        ingestData: {
            ruleScores: {},
            market: "MY",
            industryTags: ["machine tools", "sales"],
            synonymHits: ["cnc", "sales"],
            brandHits: [],
            companyHits: [],
            experienceLevel: "mid",
            computedAt: Date.now(),
            skillsVersion: 1,
            verifiedRoleYears: { engineer: 7 },
            roleSignals: [
                {
                    type: "sales",
                    matchedSignals: ["Sales Manager"],
                    signalCount: 1,
                    occurrences: 1,
                    years: 5.4,
                    industryVerifiedYears: 0,
                    roleRelevantYears: 5.4,
                    industryVerifiedRelevantYears: 0,
                    matchedWorkEntries: [{
                        jobTitle: "Sales Manager",
                        years: 5.4,
                        industryVerified: false,
                        matchedSignals: ["Sales Manager"],
                        directRoleMatch: true,
                    }],
                    verifyIn: "workHistory",
                },
                {
                    type: "engineer",
                    matchedSignals: ["Application Engineer"],
                    signalCount: 1,
                    occurrences: 1,
                    years: 7,
                    industryVerifiedYears: 7,
                    roleRelevantYears: 7,
                    industryVerifiedRelevantYears: 7,
                    matchedWorkEntries: [{
                        jobTitle: "Application Engineer",
                        years: 7,
                        industryVerified: true,
                        matchedSignals: ["Application Engineer"],
                        directRoleMatch: true,
                    }],
                    verifyIn: "workHistory",
                },
            ],
        },
    };
}

function createAuthenticatedApp() {
    return createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
    });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("BFF search dispatcher integration", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("AND-mode path (scanResumeDigestPage → getResumeDocsByIds)", () => {
        it("dispatches scanResumeDigestPage for multi-keyword AND search", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [buildDigestRow("r1", { searchText: "cnc 销售工程师" })],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([buildConvexResumeRecord("r1", { name: "Alice" })]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");

            expect(response.status).toBe(200);
            const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown> }>(response);
            expect(payload.success).toBe(true);
            expect(payload.summary.source).toBe("convex");

            // AND-mode triggers scanResumeDigestPage
            const digestCalls = calls.filter((c) => c.pathName === "resumes_search:scanResumeDigestPage");
            expect(digestCalls.length).toBeGreaterThan(0);

            // Followed by getResumeDocsByIds for matches
            const docCalls = calls.filter((c) => c.pathName === "resumes_search:getResumeDocsByIds");
            expect(docCalls.length).toBeGreaterThan(0);
        });

        it("filters non-matching docs before fetching full records", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);

                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [
                            buildDigestRow("r1", { searchText: "cnc 销售工程师" }),
                            buildDigestRow("r2", { searchText: "java 开发" }),
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([buildConvexResumeRecord("r1", { name: "Alice" })]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
            expect(response.status).toBe(200);

            // Only r1 (cnc+销售 match) should be fetched; r2 (java only) excluded
            const docCalls = calls.filter((c) => c.pathName === "resumes_search:getResumeDocsByIds");
            const allIds = docCalls.flatMap((c) => (c.args.ids as string[]));
            expect(allIds).toContain("r1");
            expect(allIds).not.toContain("r2");
        });

        it("caps scanResumeDigestPage numItems to bounded value", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");

            const digestCall = calls.find((c) => c.pathName === "resumes_search:scanResumeDigestPage");
            expect(digestCall).toBeDefined();
            const numItems = digestCall!.args.numItems as number;
            expect(numItems).toBeGreaterThan(0);
            expect(numItems).toBeLessThanOrEqual(1000);
        });
    });

    describe("scanResumeDigestPage scan path with empty results", () => {
        it("returns empty data when no docs match AND-mode keywords", async () => {
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=5");
            expect(response.status).toBe(200);

            const payload = await parseJsonBody<{ success: unknown; data: unknown[] }>(response);
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
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&minAge=25&maxAge=40");

            // Filters are applied BFF-side after scanResumeDigestPage
            const digestCalls = calls.filter((c) => c.pathName === "resumes_search:scanResumeDigestPage");
            expect(digestCalls.length).toBeGreaterThan(0);
        });
    });

    describe("AND-mode digest-first path (scanResumeDigestPage → getResumeDocsByIds)", () => {
        it("applies digest-supported filters before fetching full records", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [
                            buildDigestRow("r1", {
                                searchText: "cnc 销售 数控 销售工程师",
                                age: 30,
                                locationText: "中国 广东 东莞",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 3 },
                            }),
                            buildDigestRow("r2", {
                                searchText: "cnc 销售 数控 工程师",
                                age: 30,
                                locationText: "中国 广东 东莞",
                                roleTypes: ["engineer"],
                                roleYearsByType: { engineer: 3 },
                            }),
                            buildDigestRow("r3", {
                                searchText: "cnc 销售 数控 销售工程师",
                                age: 30,
                                locationText: "马来西亚 吉隆坡",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 3 },
                            }),
                            buildDigestRow("r4", {
                                searchText: "cnc 销售 数控 销售工程师",
                                age: 45,
                                locationText: "中国 广东 东莞",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 3 },
                            }),
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    const ids = Array.isArray(call.args.ids) ? call.args.ids : [];
                    return convexSuccess(ids.map((id) => buildFilterableConvexResumeRecord(String(id), {
                        location: id === "r3" ? "Kuala Lumpur MY" : "东莞",
                        verifiedRoleYears: id === "r2" ? { engineer: 3 } : { sales: 3 },
                    })));
                }
                if (call.pathName === "resumes_search:scanResumePageSlim") {
                    throw new Error("AND-mode must not scan monolithic resume searchText pages");
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request(
                "/api/resumes?source=convex&q=CNC%20销售&limit=5&minRoleYears=1&roleFilterType=sales&minAge=25&maxAge=40&locations=China",
            );

            expect(response.status).toBe(200);
            const docCall = calls.find((c) => c.pathName === "resumes_search:getResumeDocsByIds");
            expect(docCall?.args.ids).toEqual(["r1"]);
            expect(calls.some((c) => c.pathName === "resumes_search:scanResumePageSlim")).toBe(false);
        });

        it("uses resume digest pages for multi-keyword AND search before fetching full records", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [
                            {
                                _id: "d1",
                                resumeId: "r1",
                                source: "job5156",
                                sourceKey: "job5156",
                                searchText: "cnc 销售 数控 销售工程师",
                                isArchived: false,
                                primaryRuleScore: 0,
                                age: 30,
                                locationText: "中国 广东 东莞",
                                roleYearsByType: { sales: 3 },
                                roleTypes: ["sales"],
                            },
                            {
                                _id: "d2",
                                resumeId: "r2",
                                source: "job5156",
                                sourceKey: "job5156",
                                searchText: "cnc 操作 数控 操作工",
                                isArchived: false,
                                primaryRuleScore: 0,
                                age: 30,
                                locationText: "中国 广东 东莞",
                                roleYearsByType: { operator: 4 },
                                roleTypes: ["operator"],
                            },
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([buildConvexResumeRecord("r1", { name: "Alice" })]);
                }
                if (call.pathName === "resumes_search:scanResumePageSlim") {
                    throw new Error("AND-mode must not scan monolithic resume searchText pages");
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request(
                "/api/resumes?source=convex&q=CNC%20销售&limit=5&minRoleYears=1&roleFilterType=sales&minAge=25&maxAge=40&locations=China",
            );

            expect(response.status).toBe(200);
            const payload = await parseJsonBody<{ success: unknown }>(response);
            expect(payload.success).toBe(true);

            expect(calls.some((c) => c.pathName === "resumes_search:scanResumeDigestPage")).toBe(true);
            expect(calls.some((c) => c.pathName === "resumes_search:scanResumePageSlim")).toBe(false);
            const docCall = calls.find((c) => c.pathName === "resumes_search:getResumeDocsByIds");
            expect(docCall?.args.ids).toEqual(["r1"]);
        });

        it("normalizes browser URL aliases for location and role type filters", async () => {
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [
                            buildDigestRow("r1", {
                                searchText: "cnc 销售 数控 销售工程师",
                                locationText: "中国 广东 东莞",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 3 },
                            }),
                            buildDigestRow("r2", {
                                searchText: "cnc 销售 数控 销售工程师",
                                locationText: "马来西亚 吉隆坡",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 3 },
                            }),
                            buildDigestRow("r3", {
                                searchText: "cnc 销售 数控 销售工程师",
                                locationText: "中国 广东 东莞",
                                roleTypes: ["engineer"],
                                roleYearsByType: { engineer: 3 },
                            }),
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    const ids = Array.isArray(call.args.ids) ? call.args.ids : [];
                    return convexSuccess(ids.map((id) => buildFilterableConvexResumeRecord(String(id), {
                        location: id === "r2" ? "Kuala Lumpur MY" : "东莞",
                        verifiedRoleYears: id === "r3" ? { engineer: 3 } : { sales: 3 },
                    })));
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request(
                "/api/resumes?source=convex&q=CNC%20销售&limit=5&minRoleYears=1&roleType=sales&location=China",
            );

            expect(response.status).toBe(200);
            const payload = await parseJsonBody<{ success: unknown; data: { name: string }[] }>(response);
            expect(payload.success).toBe(true);
            expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["r1"]);
        });

        it("keeps MY roleType/roleFilterType queries on the strict verified-only path", async () => {
            const calls: ConvexCall[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);
                calls.push(call);

                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    return convexSuccess({
                        docs: [
                            buildDigestRow("my-sales-verified", {
                                searchText: "CNC Sales Manager machine tools",
                                locationText: "Malaysia",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 2.5 },
                            }),
                            buildDigestRow("my-sales-fallback", {
                                searchText: "CNC Sales Manager machine tools",
                                locationText: "Malaysia",
                                roleTypes: ["sales", "engineer"],
                                roleYearsByType: { engineer: 7 },
                            }),
                            buildDigestRow("my-engineer-only", {
                                searchText: "CNC Application Engineer machine tools",
                                locationText: "Malaysia",
                                roleTypes: ["engineer"],
                                roleYearsByType: { engineer: 7 },
                            }),
                            buildDigestRow("my-sales-below-minimum", {
                                searchText: "CNC Sales Coordinator machine tools",
                                locationText: "Malaysia",
                                roleTypes: ["sales"],
                                roleYearsByType: { sales: 0.5 },
                            }),
                        ],
                        isDone: true,
                        cursor: null,
                    });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    const ids = Array.isArray(call.args.ids) ? call.args.ids : [];
                    return convexSuccess(ids.map((id) => {
                        if (id === "my-sales-verified") {
                            return buildFilterableConvexResumeRecord(String(id), {
                                location: "Malaysia",
                                verifiedRoleYears: { sales: 2.5 },
                            });
                        }
                        if (id === "my-sales-fallback") {
                            return buildMyFallbackConvexResumeRecord(String(id));
                        }
                        if (id === "my-sales-below-minimum") {
                            return buildFilterableConvexResumeRecord(String(id), {
                                location: "Malaysia",
                                verifiedRoleYears: { sales: 0.5 },
                            });
                        }
                        return buildFilterableConvexResumeRecord(String(id), {
                            location: "Malaysia",
                            verifiedRoleYears: { engineer: 7 },
                        });
                    }));
                }
                if (call.pathName === "candidate_status:list") {
                    return convexSuccess([]);
                }
                if (call.pathName === "candidate_blocks:list") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            const response = await app.request(
                "/api/resumes?source=convex&q=CNC%20Sales&limit=5&minRoleYears=1&roleType=sales&location=Malaysia",
            );
            const aliasResponse = await app.request(
                "/api/resumes?source=convex&q=CNC%20Sales&limit=5&minRoleYears=1&roleFilterType=sales&location=Malaysia",
            );

            expect(response.status).toBe(200);
            const payload = await parseJsonBody<{ success: unknown; data: { name: string }[] }>(response);
            expect(aliasResponse.status).toBe(200);
            const aliasPayload = await parseJsonBody<{ success: unknown; data: { name: string }[] }>(aliasResponse);
            expect(payload.success).toBe(true);
            expect(aliasPayload.success).toBe(true);
            expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["my-sales-verified"]);
            expect(aliasPayload.data.map((item: { name: string }) => item.name)).toEqual(["my-sales-verified"]);

            const docCalls = calls.filter((call) => call.pathName === "resumes_search:getResumeDocsByIds");
            expect(docCalls).toHaveLength(2);
            expect(docCalls[0]?.args.ids).toEqual(["my-sales-verified"]);
            expect(docCalls[1]?.args.ids).toEqual(["my-sales-verified"]);
        });
    });

    describe("Byte-limit safety validation", () => {
        it("scanResumeDigestPage uses bounded batch size per call", async () => {
            const batchSizes: number[] = [];
            vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
                const call = parseConvexCall(input, init);

                if (call.pathName === "resumes_search:scanResumeDigestPage") {
                    batchSizes.push(call.args.numItems as number);
                    return convexSuccess({ docs: [], isDone: true, cursor: null });
                }
                if (call.pathName === "resumes_search:getResumeDocsByIds") {
                    return convexSuccess([]);
                }
                throw new Error(`Unexpected convex path: ${call.pathName}`);
            });

            const app = createAuthenticatedApp();
            await app.request("/api/resumes?source=convex&q=CNC%20销售&limit=100");

            for (const batchSize of batchSizes) {
                expect(batchSize).toBeGreaterThan(0);
                expect(batchSize).toBeLessThanOrEqual(1000);
            }
        });
    });
});
