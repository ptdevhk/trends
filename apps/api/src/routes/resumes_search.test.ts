import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesSearchRoutes from "./resumes_search";
import { workspaceMiddleware } from "../middleware/workspace";
import { ResumeService } from "../services/resume-service";
import type { AuthContext } from "../services/auth-types";
import { parseJsonBody } from "../test-utils";
import { createAuthContext } from "./test-auth-helpers";

function createTestApp(authContext: AuthContext | null = null) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  if (authContext) {
    app.use("*", async (c, next) => {
      c.set("auth", authContext);
      await next();
    });
  }
  app.route("/", resumesSearchRoutes);
  return app;
}

describe("resumes_search", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/resumes/samples", () => {
    it("lists available samples", async () => {
      vi.spyOn(ResumeService.prototype, "listSampleFiles").mockReturnValue([
        { name: "sample-initial", filename: "sample-initial.json", size: 123, updatedAt: "2026-04-01" },
      ]);

      const app = createTestApp();
      const response = await app.request("/api/resumes/samples");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; samples: { name: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.samples).toHaveLength(1);
      expect(payload.samples[0].name).toBe("sample-initial");
    });
  });

  describe("GET /api/resumes/keyword-expansion", () => {
    it("returns expanded terms for a keyword", async () => {
      vi.spyOn(ResumeService.prototype, "expandSearchQuery").mockReturnValue({
        groups: [],
        mode: "AND",
        flatTerms: ["CNC", "数控"],
        originalKeyword: "cnc",
        sourceMapping: {},
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/keyword-expansion?q=cnc");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown> }>(response);
      expect(payload.success).toBe(true);
      expect(payload.summary.keyword).toBe("cnc");
      expect(payload.summary.expandedTo).toContain("CNC");
      expect(payload.summary.mode).toBe("AND");
    });
  });
});

describe("ResumesQuerySchema semantic search params", () => {
  it("allows anonymous resume list requests for the hr workspace", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(response.status).toBe(200);
  });

  it("rejects anonymous resume list requests without an hr workspace header", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes");

    expect(response.status).toBe(401);
  });

  it("rejects anonymous resume list requests for the dev workspace", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects resume list requests from users outside the selected workspace", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" }));
    const response = await app.request("/api/resumes", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(403);
  });

  it("accepts enableSemantic parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "dev", role: "user" }));
    const response = await app.request("/api/resumes?enableSemantic=true");

    expect(response.status).toBe(200);
  });

  it("accepts semanticWeight parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "dev", role: "user" }));
    const response = await app.request("/api/resumes?semanticWeight=0.7");

    expect(response.status).toBe(200);
  });

  it("accepts semanticLimit parameter", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [],
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "dev", role: "user" }));
    const response = await app.request("/api/resumes?semanticLimit=100");

    expect(response.status).toBe(200);
  });

  it("rejects semanticWeight outside 0-1 range", async () => {
    const app = createTestApp(createAuthContext({ workspaceSlug: "dev", role: "user" }));
    const response = await app.request("/api/resumes?semanticWeight=2.0");

    expect(response.status).toBe(400);
  });

  it("rejects semanticLimit above 256", async () => {
    const app = createTestApp(createAuthContext({ workspaceSlug: "dev", role: "user" }));
    const response = await app.request("/api/resumes?semanticLimit=500");

    expect(response.status).toBe(400);
  });
});

describe("source=sample role-filter parity", () => {
  const sampleItems = [
    {
      name: "Unverified Sales",
      profileUrl: "https://example.com/unverified-sales",
      activityStatus: "Active",
      age: "28",
      experience: "7 years",
      education: "Bachelor",
      location: "Shenzhen",
      selfIntro: "",
      jobIntention: "Sales",
      expectedSalary: "",
      workHistory: [],
      ingestData: {
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["电话销售"],
            signalCount: 1,
            occurrences: 1,
            years: 6.75,
            roleRelevantYears: 6.75,
            industryVerifiedRelevantYears: 0,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                companyName: "Example Trading",
                jobTitle: "电话销售",
                years: 6.75,
                industryVerified: false,
                directRoleMatch: true,
                matchedSignals: ["电话销售"],
              },
            ],
          },
        ],
      },
      extractedAt: "2026-03-20T00:00:00.000Z",
    },
    {
      name: "Verified Sales",
      profileUrl: "https://example.com/verified-sales",
      activityStatus: "Active",
      age: "30",
      experience: "6 years",
      education: "Bachelor",
      location: "Shenzhen",
      selfIntro: "",
      jobIntention: "Sales",
      expectedSalary: "",
      workHistory: [],
      ingestData: {
        roleSignals: [
          {
            type: "sales",
            matchedSignals: ["销售工程师"],
            signalCount: 1,
            occurrences: 1,
            years: 3,
            roleRelevantYears: 6,
            industryVerifiedRelevantYears: 3,
            verifyIn: "workHistory",
            matchedWorkEntries: [
              {
                companyName: "Example Machine Tools",
                jobTitle: "销售工程师",
                years: 3,
                industryVerified: true,
                directRoleMatch: true,
                matchedSignals: ["销售工程师"],
              },
            ],
          },
        ],
      },
      extractedAt: "2026-03-20T00:00:00.000Z",
    },
  ];

  it("passes roleFilterType and minRoleYears to filterResumes", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: sampleItems,
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });
    vi.spyOn(ResumeService.prototype, "expandSearchQuery").mockReturnValue(undefined as any);
    vi.spyOn(ResumeService.prototype, "searchResumes").mockImplementation((items) =>
      items.map((item, index) => ({ ...item, relevanceScore: index }))
    );
    const filterSpy = vi.spyOn(ResumeService.prototype, "filterResumes").mockImplementation((items) => items);

    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" }));
    const response = await app.request("/api/resumes?source=sample&minRoleYears=1&roleFilterType=sales", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(response.status).toBe(200);
    expect(filterSpy.mock.calls[0][1]).toMatchObject({
      roleFilterType: "sales",
      minRoleYears: 1,
    });
  });

  it("normalizes legacy roleType alias to roleFilterType in filterResumes", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: sampleItems,
      sample: { name: "sample-initial", filename: "sample-initial.json", size: 0, updatedAt: "2026-04-01" },
      metadata: undefined,
      indexes: new Map(),
    });
    vi.spyOn(ResumeService.prototype, "expandSearchQuery").mockReturnValue(undefined as any);
    vi.spyOn(ResumeService.prototype, "searchResumes").mockImplementation((items) =>
      items.map((item, index) => ({ ...item, relevanceScore: index }))
    );
    const filterSpy = vi.spyOn(ResumeService.prototype, "filterResumes").mockImplementation((items) => items);

    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" }));
    const response = await app.request("/api/resumes?source=sample&minRoleYears=1&roleType=sales", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(response.status).toBe(200);
    expect(filterSpy.mock.calls[0][1]).toMatchObject({
      roleFilterType: "sales",
      minRoleYears: 1,
    });
  });
});
