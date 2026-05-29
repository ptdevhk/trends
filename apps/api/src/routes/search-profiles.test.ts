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

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): ConvexCall {
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

    it("adopts legacy unstamped profiles when SEARCH_PROFILES_RESEED_ON_DRIFT=true", async () => {
        process.env.SEARCH_PROFILES_RESEED_ON_DRIFT = "true";

        const legacyConvexRecord = {
            _id: "storage-id-1",
            profileId: "test-legacy-profile",
            name: "Test Legacy Profile",
            profile: {
                id: "test-legacy-profile",
                filters: { minExperience: 1, minAge: 25, maxAge: 40 },
            },
            criteria: {
                keywords: ["CNC", "Sales"],
                locations: ["China"],
            },
        };

        const template = {
            profile: {
                id: "test-legacy-profile",
                name: "Test Legacy Profile",
                status: "active" as const,
                location: "China",
                keywords: ["CNC", "Sales"],
                filters: {
                    minRoleYears: 1,
                    roleFilterType: "sales",
                    minAge: 25,
                    maxAge: 40,
                    locations: ["China"],
                },
            },
        };

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([template]);

        const calls: ConvexCall[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const call = parseConvexCall(input, init);
            calls.push(call);

            if (call.pathName === "search_profiles:list") {
                return convexSuccess([legacyConvexRecord]);
            }
            if (call.pathName === "search_profiles:update") {
                // Return a valid record that toSearchProfile can parse
                return convexSuccess({
                    _id: "storage-id-1",
                    profileId: "test-legacy-profile",
                    name: "Test Legacy Profile",
                    profile: {
                        id: "test-legacy-profile",
                        seedSource: "config/search-profiles",
                        filters: { minRoleYears: 1, roleFilterType: "sales" },
                    },
                    criteria: { keywords: ["CNC", "Sales"], locations: ["China"] },
                });
            }
            throw new Error(`Unexpected convex path: ${call.pathName}`);
        });

        const app = createApp();
        const response = await app.request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "dev" },
        });

        expect(response.status).toBe(200);

        // Verify the adoption mutation was called
        const updateCalls = calls.filter((c) => c.pathName === "search_profiles:update");
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]!.args).toMatchObject({
            id: "storage-id-1",
            workspaceSlug: "dev",
        });

        // Verify the profile payload has seedSource and templateHash stamps
        const profilePayload = updateCalls[0]!.args.profile as Record<string, unknown>;
        expect(profilePayload.seedSource).toBe("config/search-profiles");
        expect(typeof profilePayload.templateHash).toBe("string");
        expect((profilePayload.templateHash as string).length).toBeGreaterThan(0);
    });

    it("skips legacy unstamped profiles when SEARCH_PROFILES_RESEED_ON_DRIFT is not set", async () => {
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

        const template = {
            profile: {
                id: "test-legacy-profile",
                name: "Test Legacy Profile",
                status: "active" as const,
                location: "China",
                keywords: ["CNC", "Sales"],
                filters: { minRoleYears: 1, roleFilterType: "sales" },
            },
        };

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([template]);

        const calls: ConvexCall[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const call = parseConvexCall(input, init);
            calls.push(call);

            if (call.pathName === "search_profiles:list") {
                return convexSuccess([legacyConvexRecord]);
            }
            throw new Error(`Unexpected convex path: ${call.pathName}`);
        });

        const app = createApp();
        const response = await app.request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "dev" },
        });

        expect(response.status).toBe(200);

        // No update mutation should be called
        const updateCalls = calls.filter((c) => c.pathName === "search_profiles:update");
        expect(updateCalls).toHaveLength(0);
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

        // Compute real hash so the stamped record matches
        const realHash = shared.computeTemplateHash(template.profile);

        const stampedConvexRecord = {
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
        };

        vi.mocked(shared.getWorkspaceSearchProfileTemplates).mockReturnValue([template]);

        const calls: ConvexCall[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
            const call = parseConvexCall(input, init);
            calls.push(call);

            if (call.pathName === "search_profiles:list") {
                return convexSuccess([stampedConvexRecord]);
            }
            throw new Error(`Unexpected convex path: ${call.pathName}`);
        });

        const app = createApp();
        const response = await app.request("/api/search-profiles/stats", {
            headers: { "X-Workspace-Slug": "dev" },
        });

        expect(response.status).toBe(200);

        // No update — stamped profile with matching hash has no drift
        const updateCalls = calls.filter((c) => c.pathName === "search_profiles:update");
        expect(updateCalls).toHaveLength(0);
    });
});
