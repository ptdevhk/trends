import { describe, expect, it } from "vitest";
import { parseUatCliArgs, ROLES, generateUatSummary } from "./run-multi-role-uat";

describe("run-multi-role-uat CLI parser", () => {
    it("parses default options with no flags", () => {
        const options = parseUatCliArgs([]);
        expect(options.port).toBe(9222);
        expect(options.baseUrl).toBe("http://localhost:5173");
        expect(options.standalone).toBe(false);
        expect(options.headless).toBe(false);
        expect(options.roles).toEqual(["hr-demo", "demo-admin", "uat-reviewer"]);
        expect(options.locale).toBeUndefined();
    });

    it("parses custom port, baseUrl, standalone, and headless flags", () => {
        const options = parseUatCliArgs([
            "--port", "9333",
            "--base-url", "http://localhost:3000",
            "--standalone",
            "--headless",
        ]);
        expect(options.port).toBe(9333);
        expect(options.baseUrl).toBe("http://localhost:3000");
        expect(options.standalone).toBe(true);
        expect(options.headless).toBe(true);
    });

    it("filters to a specific role when --role is provided", () => {
        const options = parseUatCliArgs(["--role", "hr-demo"]);
        expect(options.roles).toEqual(["hr-demo"]);
    });

    it("supports comma-separated roles", () => {
        const options = parseUatCliArgs(["--roles", "hr-demo,demo-admin"]);
        expect(options.roles).toEqual(["hr-demo", "demo-admin"]);
    });

    it("parses locale flag", () => {
        const options = parseUatCliArgs(["--locale", "zh-Hans"]);
        expect(options.locale).toBe("zh-Hans");
    });
});

describe("ROLES definition", () => {
    it("contains configurations for all 3 supported personas", () => {
        expect(ROLES["hr-demo"]).toBeDefined();
        expect(ROLES["demo-admin"]).toBeDefined();
        expect(ROLES["uat-reviewer"]).toBeDefined();
        expect(ROLES["hr-demo"].username).toBe("hr-demo");
        expect(ROLES["demo-admin"].username).toBe("demo-admin");
        expect(ROLES["uat-reviewer"].username).toBe("uat-reviewer");
    });

    it("specifies primary target routes for each role", () => {
        expect(ROLES["hr-demo"].targetRoutes).toContain("/hr/resumes");
        expect(ROLES["demo-admin"].targetRoutes).toContain("/dev/settings/policies");
        expect(ROLES["demo-admin"].targetRoutes).toContain("/admin/system/settings/industry-verification");
        expect(ROLES["uat-reviewer"].targetRoutes).toContain("/dev/system/settings/industry-verification");
    });
});

describe("generateUatSummary", () => {
    it("aggregates role results into a formatted report structure", () => {
        const results = [
            {
                role: "hr-demo" as const,
                passed: true,
                durationMs: 1200,
                stepsExecuted: ["login", "search-resumes", "negative-admin-gate"],
                cwv: { ttfb: 150, lcp: 1200, cls: 0.05, fcp: 400 },
                consoleErrors: [],
            },
            {
                role: "demo-admin" as const,
                passed: true,
                durationMs: 1800,
                stepsExecuted: ["login", "policies-page", "industry-verification"],
                cwv: { ttfb: 180, lcp: 1400, cls: 0.02, fcp: 450 },
                consoleErrors: [],
            },
        ];

        const summary = generateUatSummary(results);
        expect(summary.totalRoles).toBe(2);
        expect(summary.passedRoles).toBe(2);
        expect(summary.failedRoles).toBe(0);
        expect(summary.allPassed).toBe(true);
        expect(summary.details).toHaveLength(2);
    });

    it("flags allPassed as false if any role failed", () => {
        const results = [
            {
                role: "hr-demo" as const,
                passed: false,
                durationMs: 1200,
                error: "Timeout waiting for search results",
                stepsExecuted: ["login"],
                cwv: { ttfb: null, lcp: null, cls: null, fcp: null },
                consoleErrors: [{ type: "error", text: "500 Internal Error" }],
            },
        ];

        const summary = generateUatSummary(results);
        expect(summary.totalRoles).toBe(1);
        expect(summary.passedRoles).toBe(0);
        expect(summary.failedRoles).toBe(1);
        expect(summary.allPassed).toBe(false);
    });
});
