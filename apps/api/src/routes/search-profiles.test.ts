import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";

// Mock @trends/shared to control getWorkspaceSearchProfileTemplates
vi.mock("@trends/shared", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@trends/shared")>();
    return {
        ...actual,
        getWorkspaceSearchProfileTemplates: vi.fn().mockReturnValue([]),
    };
});

import * as shared from "@trends/shared";

type ConvexCall = {
    type: "query" | "mutation";
    pathName: string;
    args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
    const requestUrl = typeof input === "string"
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;

    const type: ConvexCall["type"] = requestUrl.includes("/api/query") ? "query" : "mutation";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (!isRecord(body)) {
        throw new Error("Missing convex request body");
    }

    const pathName = typeof body.path === "string" ? body.path : "";
    const args = isRecord(body.args) ? body.args : {};
    if (!pathName) {
        throw new Error("Missing convex path in request body");
    }

    return { type, pathName, args };
}

function convexSuccess(value: unknown): Response {
    return new Response(
        JSON.stringify({ status: "success", value }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    );
}

describe("search-profiles legacy adoption", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...originalEnv };
    });

    function mockConvexListAndUpdate(listRecords: unknown[]) {
        const calls: ConvexCall[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const call = parseConvexCall(input, init);
            calls.push(call);

            if (call.pathName === "search_profiles:list") {
                return convexSuccess(listRecords);
            }
            if (call.pathName === "search_profiles:update") {
                const args = call.args;
                const profile = isRecord(args.profile) ? args.profile : {};
                const listRecord = listRecords[0];
                const base = isRecord(listRecord) ? listRecord : {};
                return convexSuccess({
                    ...base,
                    profile: {
                        ...(isRecord(base.profile) ? base.profile : {}),
                        ...profile,
                    },
                });
            }
            throw new Error(`Unexpected convex path: ${call.pathName}`);
        });
        return calls;
    }

    function updatePayloads(calls: ConvexCall[]) {
        return calls
            .filter((c) => c.pathName === "search_profiles:update")
            .map((c) => c.args.profile as Record<string, unknown>);
    }

    it("adopts legacy unstamped profiles unconditionally (no flag required)", async () => {
        delete process.env.SEARCH_PROFILES_RESEED_ON_DRIFT;

        const legacyConvexRecord = {
            _id: "storage-id-1",
            profileId: "test-legacy-profile",
            name: "Test Legacy Profile",
            profile: {
                id: "test-legacy-profile",
                filters: { minExperience: 1 },
            },
            criteria: {
                keywords: ["CNC", "Sales"],
                locations: ["China"],
            },
        };

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([{
            profile: {
                id: "test-legacy-profile",
                name: "Test Legacy Profile",
                status: "active" as const,
                location: "China",
                keywords: ["CNC", "Sales"],
                filters: { minRoleYears: 1, roleFilterType: "sales" },
            },
        }]);

        const calls = mockConvexListAndUpdate([legacyConvexRecord]);
        const response = await createApp().request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "dev" },
        });

        expect(response.status).toBe(200);
        const payloads = updatePayloads(calls);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]!.seedSource).toBe("config/search-profiles");
        expect(typeof payloads[0]!.templateHash).toBe("string");
        expect((payloads[0]!.templateHash as string).length).toBeGreaterThan(0);
    });

    it("does not adopt already-stamped profiles (normal drift path)", async () => {
        process.env.SEARCH_PROFILES_RESEED_ON_DRIFT = "true";

        const template = {
            profile: {
                id: "test-stamped-profile",
                name: "Test Stamped Profile",
                status: "active" as const,
                location: "China",
                keywords: ["CNC", "Sales"],
                filters: { minRoleYears: 1, roleFilterType: "sales" },
            },
        };
        const realHash = shared.computeTemplateHash(template.profile);

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([template]);
        const calls = mockConvexListAndUpdate([{
            _id: "storage-id-2",
            profileId: "test-stamped-profile",
            name: "Test Stamped Profile",
            profile: {
                id: "test-stamped-profile",
                seedSource: "config/search-profiles",
                templateHash: realHash,
                filters: { minRoleYears: 1, roleFilterType: "sales" },
            },
            criteria: {
                keywords: ["CNC", "Sales"],
                locations: ["China"],
            },
        }]);

        const response = await createApp().request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "dev" },
        });

        expect(response.status).toBe(200);
        expect(updatePayloads(calls)).toHaveLength(0);
    });

    it("refreshes half-stamped MY profiles from YAML (does not stamp hash onto stale filters)", async () => {
        delete process.env.SEARCH_PROFILES_RESEED_ON_DRIFT;

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([{
            profile: {
                id: "seek-malaysia-talent-search",
                name: "SEEK Malaysia CNC Sales — Talent Search",
                status: "active" as const,
                location: "Malaysia",
                keywords: ["CNC", "Sales"],
                filters: { minRoleYears: 1, roleFilterType: "sales", locations: ["Malaysia"] },
            },
        }]);

        // seedSource set, templateHash missing, filters still pre-roleFilterType
        const calls = mockConvexListAndUpdate([{
            _id: "storage-half-1",
            profileId: "seek-malaysia-talent-search",
            name: "SEEK Malaysia CNC Sales — Talent Search",
            profile: {
                id: "seek-malaysia-talent-search",
                seedSource: "config/search-profiles",
                filters: { minRoleYears: 1, locations: ["Malaysia"] },
            },
            criteria: {
                keywords: ["CNC", "Sales"],
                locations: ["Malaysia"],
            },
        }]);

        const response = await createApp().request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "hr" },
        });

        expect(response.status).toBe(200);
        const payloads = updatePayloads(calls);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]!.seedSource).toBe("config/search-profiles");
        expect(typeof payloads[0]!.templateHash).toBe("string");
        const filters = payloads[0]!.filters as Record<string, unknown>;
        expect(filters.roleFilterType).toBe("sales");
        expect(filters.minRoleYears).toBe(1);
    });

    it("backfills missing roleFilterType on stamped MY profiles without full reseed flag", async () => {
        delete process.env.SEARCH_PROFILES_RESEED_ON_DRIFT;

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([{
            profile: {
                id: "seek-malaysia-sales",
                name: "SEEK Malaysia CNC Sales",
                status: "active" as const,
                location: "Malaysia",
                keywords: ["CNC", "Sales"],
                filters: { minRoleYears: 1, roleFilterType: "sales", locations: ["Malaysia"] },
            },
        }]);

        // Fully stamped but lacks roleFilterType — additive backfill only
        const calls = mockConvexListAndUpdate([{
            _id: "storage-my-sales",
            profileId: "seek-malaysia-sales",
            name: "SEEK Malaysia CNC Sales",
            profile: {
                id: "seek-malaysia-sales",
                seedSource: "config/search-profiles",
                templateHash: "old-hash-without-role",
                filters: { minRoleYears: 1, locations: ["Malaysia"], maxAge: 45 },
            },
            criteria: {
                keywords: ["CNC", "Sales"],
                locations: ["Malaysia"],
            },
        }]);

        const response = await createApp().request("/api/search-profiles", {
            headers: { "X-Workspace-Slug": "hr" },
        });

        expect(response.status).toBe(200);
        const body = await response.json() as {
            success: boolean;
            profiles: Array<{ id: string; filters?: { roleFilterType?: string; minRoleYears?: number } }>;
        };
        expect(body.success).toBe(true);

        const payloads = updatePayloads(calls);
        expect(payloads).toHaveLength(1);
        const filters = payloads[0]!.filters as Record<string, unknown>;
        expect(filters.roleFilterType).toBe("sales");
        expect(filters.minRoleYears).toBe(1);
        expect(filters.maxAge).toBe(45);
    });
});
