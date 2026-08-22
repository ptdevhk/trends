import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildKeywordAnalysisId,
  getCurrentResumeAiPromptVersion,
} from "@trends/shared";

// The verified-employer catalog singleton fires background Convex fetches
// (`companies:listVerifiedIndustryEmployerAliases`) on service construction
// and during industry-scoped keyword expansion. These route tests assert
// exact fetch/call sequences for the search pipeline, so the catalog must
// degrade to the empty (synonyms-only) state. Bridge behavior itself is
// covered by unified-search-service.test.ts with injected fakes.
vi.mock("../services/verified-employer-catalog-service.js", () => ({
  verifiedEmployerCatalog: {
    getVerifiedEmployers: () => [],
    warm: () => Promise.resolve(),
    refresh: () => Promise.resolve([]),
  },
}));

// The maintenance middleware queries Convex on every write method; route
// tests assert exact fetch sequences, so it is bypassed here (it is
// unit-tested separately in middleware/maintenance.test.ts).
vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { MatchStorage, type StoredMatch } from "../services/match-storage";
import { ResumeService } from "../services/resume-service";
import { SessionManager } from "../services/session-manager";
import { logger } from "../services/logger";
import { config } from "../services/config";
import { parseJsonBody } from "../test-utils";
import { createAuthContext } from "./test-auth-helpers";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseErrorResponse(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.error !== "string") {
    throw new Error("Expected an error response body");
  }
  return body.error;
}

function parseConvexCall(
  input: Request | string | URL,
  init?: RequestInit,
  expectedEndpoint?: "/api/query" | "/api/mutation" | "/api/action",
): ConvexCall {
  const requestURL = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const endpoint = expectedEndpoint ?? (
    requestURL.includes("/api/action") ? "/api/action"
    : requestURL.includes("/api/mutation") ? "/api/mutation"
    : "/api/query"
  );

  if (!requestURL.includes(endpoint)) {
    throw new Error(`Unexpected request URL: ${requestURL}`);
  }

  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path");
  }

  return { pathName, args };
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      value,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

function convexFailure(errorMessage: string): Response {
  return new Response(
    JSON.stringify({
      status: "error",
      errorMessage,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

function buildResolvedExactTarget(
  currentResumeId: string,
  referenceResumeId: string,
) {
  return {
    referenceResumeId,
    currentResumeId,
    profileResumeId: currentResumeId.replace("current-", "profile-"),
    profileUrl: `https://example.com/candidates/${currentResumeId}`,
    externalId: `external-${currentResumeId}`,
    source: "seek",
    canonicalIdentityKey: `profileUrl:example.com/candidates/${currentResumeId}`,
    outcome: "resolved" as const,
    selectors: [{ kind: "currentResumeId" as const, value: currentResumeId }],
  };
}

function createTestApp(
  authContext: ReturnType<typeof createAuthContext> | null = createAuthContext({ workspaceSlug: "dev", role: "admin" }),
) {
  return createApp({
    authContext: authContext ?? undefined,
  });
}

function buildConvexResumeRecord(
  resumeId: string,
  overrides: {
    name?: string;
    location?: string;
    identityKey?: string;
    source?: string;
    primaryRuleScore?: number;
    ingestData?: Record<string, unknown>;
  } = {}
) {
  return {
    _id: resumeId,
    identityKey: overrides.identityKey,
    source: overrides.source ?? "seek",
    primaryRuleScore: overrides.primaryRuleScore ?? 0,
    content: {
      name: overrides.name ?? resumeId,
      location: overrides.location ?? "东莞",
      experience: "5 years",
      education: "Bachelor",
      jobIntention: "Sales Engineer",
      profileUrl: `https://example.com/${resumeId}`,
      workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
      extractedAt: "2026-03-24T00:00:00.000Z",
    },
    ingestData: overrides.ingestData,
  };
}

function buildConvexExportResumeRecord(
  resumeId: string,
  overrides: {
    name?: string;
    location?: string;
    source?: string;
    ingestData?: Record<string, unknown>;
  } = {}
) {
  return {
    resumeId,
    resume: {
      name: overrides.name ?? resumeId,
      location: overrides.location ?? "东莞",
      experience: "5 years",
      education: "Bachelor",
      jobIntention: "Sales Engineer",
      profileUrl: `https://example.com/${resumeId}`,
      workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
      extractedAt: "2026-03-24T00:00:00.000Z",
      source: overrides.source ?? "seek",
      ingestData: overrides.ingestData,
    },
  };
}

function buildStoredMatch(
  resumeId: string,
  overrides: {
    id?: number;
    jobDescriptionId?: string;
    score?: number;
    recommendation?: StoredMatch["recommendation"];
  } = {}
): StoredMatch {
  return {
    id: overrides.id ?? 1,
    resumeId,
    jobDescriptionId: overrides.jobDescriptionId ?? "jd-1",
    score: overrides.score ?? 80,
    recommendation: overrides.recommendation ?? "match",
    highlights: [],
    concerns: [],
    summary: "",
    scoreSource: "ai",
    matchedAt: "2026-03-24T00:00:00.000Z",
  };
}

describe("resume routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns sample-backed resume detail with full work history", async () => {
    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [
        {
          name: "Alice",
          profileUrl: "https://example.com/alice",
          source: "ehire.51job.com",
          activityStatus: "Active today",
          age: "32岁",
          experience: "8年",
          education: "本科",
          location: "东莞",
          selfIntro: "熟悉CNC设备销售与客户跟进。",
          jobIntention: "销售经理",
          expectedSalary: "20K",
          workHistory: [
            {
              raw: "2021-03 ~ 至今 Example Co. Sales Manager",
              companyName: "Example Co.",
              jobTitle: "Sales Manager",
              description: "Managed CNC accounts.",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
          extractedAt: "2026-04-02T00:00:00.000Z",
          resumeId: "sample-resume-1",
          externalId: "sample-resume-1",
        },
      ],
      sample: {
        name: "sample-initial",
        filename: "sample-initial.json",
        updatedAt: "2026-04-02T00:00:00.000Z",
        size: 123,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/sample-resume-1?source=sample");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        source: "sample",
        sample: expect.objectContaining({ name: "sample-initial" }),
        data: expect.objectContaining({
          resumeId: "sample-resume-1",
          name: "Alice",
          workHistory: [
            expect.objectContaining({
              companyName: "Example Co.",
              description: "Managed CNC accounts.",
            }),
          ],
        }),
      }),
    );
  });

  it("returns convex-backed resume detail with full work history", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName !== "resumes:getResumeDetail") {
        if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
        if (call.pathName === "companies:list") { return convexSuccess([]); }
        if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
        if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }
      expect(call.args).toEqual({ resumeId: "resume-live-1" });
      return convexSuccess({
        _id: "resume-live-1",
        source: "seek",
        content: {
          name: "Alice",
          profileUrl: "https://example.com/alice",
          activityStatus: "Active today",
          age: "32岁",
          experience: "8年",
          education: "本科",
          location: "东莞",
          selfIntro: "熟悉CNC设备销售与客户跟进。",
          jobIntention: "销售经理",
          expectedSalary: "20K",
          workHistory: [
            {
              raw: "2021-03 ~ 至今 Example Co. Sales Manager",
              companyName: "Example Co.",
              jobTitle: "Sales Manager",
              description: "Managed CNC accounts.",
              startDate: "2021-03",
              endDate: "至今",
            },
          ],
          extractedAt: "2026-04-02T00:00:00.000Z",
          resumeId: "resume-live-1",
          externalId: "resume-live-1",
        },
        ingestData: {
          companyHits: ["fanuc"],
        },
      });
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/resume-live-1?source=convex");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        source: "convex",
        data: expect.objectContaining({
          resumeId: "resume-live-1",
          name: "Alice",
          source: "seek",
          workHistory: [
            expect.objectContaining({
              companyName: "Example Co.",
              description: "Managed CNC accounts.",
            }),
          ],
          ingestData: expect.objectContaining({
            companyHits: ["fanuc"],
          }),
        }),
      }),
    );
  });

  it("resolves exact industry-review targets for a dev system admin", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      expect(call.pathName).toBe("companies:resolveIndustryReviewTargetsForResume");
      expect(call.args).toEqual(expect.objectContaining({
        resumeId: "resume-live-1",
        workspaceSlug: "dev",
      }));
      return convexSuccess({
        targets: [
          {
            workEntryKey: "work-entry-vision",
            employerLabel: "Vision Machine Tools",
            availability: "target_available",
            proposalId: "industry-maintenance-vision",
            status: "new",
          },
          {
            workEntryKey: "work-entry-unlinked",
            employerLabel: "Unlinked CNC Employer",
            availability: "not_linked",
          },
        ],
      });
    });

    const response = await createTestApp().request(
      "/api/resumes/resume-live-1/industry-review-targets",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        targets: [
          {
            workEntryKey: "work-entry-vision",
            employerLabel: "Vision Machine Tools",
            availability: "target_available",
            proposalId: "industry-maintenance-vision",
            status: "new",
          },
          {
            workEntryKey: "work-entry-unlinked",
            employerLabel: "Unlinked CNC Employer",
            availability: "not_linked",
          },
        ],
      },
    });
  });

  it("does not expose industry-review targets outside the dev system workspace", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" }));

    const response = await app.request(
      "/api/resumes/resume-live-1/industry-review-targets",
      { headers: { "X-Workspace-Slug": "hr" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Admin access required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns convex-backed live query results and expansion metadata", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumeDigestPage
      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        // Phase 1: slim projection — only searchText and basic fields
        return convexSuccess({
          docs: cursor
            ? []
            : [
                {
                  _id: "d1",
                  resumeId: "resume-live-1",
                  source: "seek",
                  sourceKey: "seek",
                  primaryRuleScore: 44,
                  searchText: "CNC 数值控制 销售 engineer fanuc",
                  isArchived: false,
                },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            _id: "resume-live-1",
            source: "seek",
            primaryRuleScore: 44,
            searchText: "CNC 数值控制 销售 engineer fanuc",
            isArchived: false,
            content: {
              name: "Alice",
              location: "东莞",
              experience: "5 years",
              education: "Bachelor",
              jobIntention: "Sales",
              profileUrl: "https://example.com/alice",
              workHistory: [{ raw: "2020-2025 CNC 销售工程师" }],
            },
            ingestData: {
              companyHits: ["fanuc"],
              brandHits: [],
              roleSignals: [],
            },
          },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&q=CNC%20%E9%94%80%E5%94%AE&limit=5");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: unknown[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary.source).toBe("convex");
    expect(payload.summary.keywordGroups).toEqual(
      expect.arrayContaining([expect.objectContaining({ original: "cnc" })])
    );
    expect(payload.data[0]).toEqual(
      expect.objectContaining({
        resumeId: "resume-live-1",
        name: "Alice",
        location: "东莞",
      })
    );
    // List-view projection: the raw searchText blob is dropped from the
    // response (the web list never consumes it; provenance is computed
    // server-side), shrinking the CN list payload by ~12%.
    expect(payload.data[0]).not.toHaveProperty("searchText");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumeDigestPage",
    }));
  });

  it("excludes workspace blocked candidates from convex statusCounts by default", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        return convexSuccess({
          docs: [
            { _id: "d1", resumeId: "resume-visible-new", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d2", resumeId: "resume-blocked-new", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d3", resumeId: "resume-visible-rejected", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d4", resumeId: "k172rcvmvqj4hhn98r74r3brps82v28b", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
          ],
          isDone: true,
          cursor: null,
        });
      }

      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            ...buildConvexResumeRecord("resume-visible-new", {
              identityKey: "ik-visible-new",
              name: "Visible New",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("resume-blocked-new", {
              identityKey: "ik-blocked-new",
              name: "Blocked New",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("resume-visible-rejected", {
              identityKey: "ik-visible-rejected",
              name: "Visible Rejected",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("k172rcvmvqj4hhn98r74r3brps82v28b", {
              identityKey: "ik-interviewed-pass",
              name: "周先生",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
        ]);
      }

      if (call.pathName === "candidate_status:list") {
        expect(call.args).toEqual(expect.objectContaining({ workspaceSlug: "hr" }));
        return convexSuccess([
          { identityKey: "ik-visible-rejected", status: "rejected" },
          { identityKey: "ik-interviewed-pass", status: "interviewed_pass" },
        ]);
      }

      if (call.pathName === "candidate_blocks:list") {
        expect(call.args).toEqual(expect.objectContaining({ workspaceSlug: "hr" }));
        return convexSuccess([
          { identityKey: "ik-blocked-new" },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" }));
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=5", {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ summary: Record<string, unknown> }>(response);
    expect(payload.summary.statusCounts).toMatchObject({
      new: 1,
      shortlisted: 0,
      rejected: 1,
      interviewed_pass: 1,
    });
    expect(calls.some((call) => call.pathName === "candidate_blocks:list")).toBe(true);
  });

  it("filters convex resume results by requested candidate status", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        return convexSuccess({
          docs: [
            { _id: "d1", resumeId: "resume-visible-new", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d2", resumeId: "resume-blocked-new", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d3", resumeId: "resume-visible-rejected", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
            { _id: "d4", resumeId: "k172rcvmvqj4hhn98r74r3brps82v28b", source: "seek", sourceKey: "seek", searchText: "cnc sales", isArchived: false },
          ],
          isDone: true,
          cursor: null,
        });
      }

      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            ...buildConvexResumeRecord("resume-visible-new", {
              identityKey: "ik-visible-new",
              name: "Visible New",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("resume-blocked-new", {
              identityKey: "ik-blocked-new",
              name: "Blocked New",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("resume-visible-rejected", {
              identityKey: "ik-visible-rejected",
              name: "Visible Rejected",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
          {
            ...buildConvexResumeRecord("k172rcvmvqj4hhn98r74r3brps82v28b", {
              identityKey: "ik-interviewed-pass",
              name: "周先生",
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
        ]);
      }

      if (call.pathName === "candidate_status:list") {
        expect(call.args).toEqual(expect.objectContaining({ workspaceSlug: "hr" }));
        return convexSuccess([
          { identityKey: "ik-visible-rejected", status: "rejected" },
          { identityKey: "ik-interviewed-pass", status: "interviewed_pass" },
        ]);
      }

      if (call.pathName === "candidate_blocks:list") {
        expect(call.args).toEqual(expect.objectContaining({ workspaceSlug: "hr" }));
        return convexSuccess([
          { identityKey: "ik-blocked-new" },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" }));
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=5&status=new", {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ summary: Record<string, unknown>; data: unknown[] }>(response);
    expect(payload.summary.total).toBe(1);
    expect(payload.summary.returned).toBe(1);
    expect(payload.summary.statusCounts).toMatchObject({
      new: 1,
      shortlisted: 0,
      rejected: 1,
      interviewed_pass: 1,
    });
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toEqual(expect.objectContaining({ name: "Visible New" }));
    expect(calls.some((call) => call.pathName === "candidate_blocks:list")).toBe(true);
  });

  it("omits operational statusCounts for anonymous hr convex search", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-1", {
              identityKey: "ik-live-1",
              name: "Anonymous Visible",
            }),
          ],
          total: 1,
        });
      }

      if (call.pathName === "candidate_status:list" || call.pathName === "candidate_blocks:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp(null);
    const response = await app.request("/api/resumes?source=convex&limit=1", {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ summary: Record<string, unknown> }>(response);
    expect(payload.summary.statusCounts).toBeUndefined();
    expect(calls.filter((call) => call.pathName === "resumes:listWithIngestDataPage")).toEqual([
      expect.objectContaining({
        pathName: "resumes:listWithIngestDataPage",
      }),
    ]);
    expect(calls.some((call) => call.pathName === "candidate_status:list")).toBe(false);
    expect(calls.some((call) => call.pathName === "candidate_blocks:list")).toBe(false);
  });

  it("allows anonymous hr convex search with BFF AND-mode filters", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        return convexSuccess({
          docs: [
            {
              _id: "d1",
              resumeId: "resume-live-1",
              source: "seek",
              sourceKey: "seek",
              searchText: "cnc sales",
              locationText: "China",
              roleSignals: [{ type: "sales", years: 3 }],
              isArchived: false,
            },
          ],
          isDone: true,
          cursor: null,
        });
      }

      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            ...buildConvexResumeRecord("resume-live-1", {
              identityKey: "ik-live-1",
              name: "Anonymous Search Result",
              location: "China",
              ingestData: {
                roleSignals: [
                  {
                    type: "sales",
                    matchedSignals: ["sales"],
                    years: 3,
                    industryVerifiedYears: 3,
                    signalCount: 1,
                    occurrences: 1,
                    verifyIn: "workHistory",
                  },
                ],
              },
            }),
            searchText: "cnc sales",
            isArchived: false,
          },
        ]);
      }

      if (call.pathName === "candidate_status:list" || call.pathName === "candidate_blocks:list") {
        throw new Error(`Anonymous search should not load operational overlays: ${call.pathName}`);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp(null);
    const response = await app.request(
      "/api/resumes?q=cnc%20sales&source=convex&paged=true&minRoleYears=1&roleFilterType=sales&locations=China",
      {
        headers: {
          "X-Workspace-Slug": "hr",
        },
      },
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown> }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary.statusCounts).toBeUndefined();
    const searchPaths = calls
      .map((call) => call.pathName)
      .filter(
        (path) => path === "resumes_search:scanResumeDigestPage" || path === "resumes_search:getResumeDocsByIds",
      );
    expect(searchPaths).toEqual([
      "resumes_search:scanResumeDigestPage",
      "resumes_search:getResumeDocsByIds",
    ]);
  });

  it("rejects anonymous dev convex search with BFF AND-mode filters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Convex should not be called"));

    const app = createTestApp(null);
    const response = await app.request(
      "/api/resumes?q=cnc%20sales&source=convex&paged=true&minRoleYears=1&roleFilterType=sales&locations=China",
      {
        headers: {
          "X-Workspace-Slug": "dev",
        },
      },
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the static skills-version route from being shadowed by resume detail lookup", async () => {
    const app = createTestApp();
    const response = await app.request("/api/resumes/skills-version");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        version: expect.any(Number),
      }),
    );
  });

  it("lists diagnostics rows with archived and source-key filters", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_diagnostics:listArchivedDiagnostics") {
        expect(call.args).toEqual(expect.objectContaining({
          sourceKeys: ["51job-manual", "seek"],
        }));
        return convexSuccess({
          page: [
            {
              resumeId: "resume-archived-1",
              externalId: "external-1",
              source: "51job-manual",
              sourceKey: "51job-manual",
              name: "张三",
              jobIntention: "销售工程师",
              location: "东莞",
              archivedAt: 1_700_000_000_000,
              isArchived: true,
            },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes/diagnostics?archived=true&sourceKey=51job-manual&sourceKey=seek&limit=25"
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      summary: expect.objectContaining({
        archived: true,
        limit: 25,
      }),
      data: [
        expect.objectContaining({
          resumeId: "resume-archived-1",
          sourceKey: "51job-manual",
        }),
      ],
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_diagnostics:listArchivedDiagnostics",
    }));
  });

  it("returns read-only convex query scores with debug metadata", async () => {
    const createSessionSpy = vi.spyOn(SessionManager.prototype, "createSession");
    const saveMatchesSpy = vi.spyOn(MatchStorage.prototype, "saveMatches");
    const createRunSpy = vi.spyOn(MatchStorage.prototype, "createMatchRun");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          {
            resumeId: "resume-convex-1",
            resume: {
              name: "Zhang Sales",
              location: "东莞",
              experience: "8 years",
              education: "Bachelor",
              jobIntention: "Sales Engineer",
              profileUrl: "https://example.com/zhang",
              workHistory: [
                { raw: "2018-2026 CNC 销售工程师", companyName: "Fanuc", jobTitle: "销售工程师" },
              ],
              ingestData: {
                companyHits: ["fanuc"],
                brandHits: [
                  {
                    brand: "fanuc",
                    role: "both",
                    source: "workHistory",
                    context: "employer",
                  },
                ],
                roleSignals: [
                  {
                    type: "sales",
                    matchedSignals: ["销售工程师", "销售"],
                    signalCount: 2,
                    occurrences: 2,
                    years: 8,
                    industryVerifiedYears: 8,
                    verifyIn: "workHistory",
                    matchedWorkEntries: [
                      {
                        companyName: "Fanuc",
                        jobTitle: "销售工程师",
                        years: 8,
                        industryVerified: true,
                        matchedSignals: ["销售工程师", "销售"],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "convex",
        persist: false,
        mode: "rules_only",
        keywords: ["CNC", "销售"],
        location: "东莞",
        resumeIds: ["resume-convex-1"],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ query: Record<string, unknown>; results: unknown[] }>(response);
    expect(payload.query).toEqual(
      expect.objectContaining({
        source: "convex",
        persisted: false,
      })
    );
    expect(payload.query.inferredRequiredRoles).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "sales", verifyIn: "workHistory" })])
    );
    expect(payload.results[0]).toEqual(
      expect.objectContaining({
        resumeId: "resume-convex-1",
        debug: expect.objectContaining({
          companyHits: ["fanuc"],
          roleSignals: expect.arrayContaining([expect.objectContaining({ type: "sales" })]),
          brandHits: expect.arrayContaining([expect.objectContaining({ brand: "fanuc" })]),
        }),
      })
    );
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(saveMatchesSpy).not.toHaveBeenCalled();
    expect(createRunSpy).not.toHaveBeenCalled();
  });

  it("fetches a large enough convex list window before applying offset pagination", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", {
              name: "Carla",
              ingestData: {
                industryTags: ["industrial-machinery"],
                companyHits: ["fanuc"],
                roleSignals: [
                  {
                    type: "sales",
                    matchedSignals: ["销售工程师"],
                    years: 4,
                    industryVerifiedYears: 4,
                    signalCount: 1,
                    occurrences: 1,
                    verifyIn: "workHistory",
                  },
                ],
              },
            }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 4,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string; ingestData?: unknown }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(payload.data[0]?.ingestData).toEqual(expect.objectContaining({
      industryTags: ["industrial-machinery"],
      companyHits: ["fanuc"],
      roleSignals: expect.arrayContaining([expect.objectContaining({ type: "sales" })]),
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2 }),
    }));
  });

  it("fetches a large enough convex search window before applying offset pagination", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumeDigestPage
      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "d1", resumeId: "resume-live-1", source: "seek", sourceKey: "seek", searchText: "cnc sales engineer", isArchived: false },
                { _id: "d2", resumeId: "resume-live-2", source: "seek", sourceKey: "seek", searchText: "cnc sales manager", isArchived: false },
                { _id: "d3", resumeId: "resume-live-3", source: "seek", sourceKey: "seek", searchText: "cnc sales director", isArchived: false },
                { _id: "d4", resumeId: "resume-live-4", source: "seek", sourceKey: "seek", searchText: "cnc sales vp", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...buildConvexResumeRecord("resume-live-1", { name: "Alice" }), searchText: "cnc sales engineer", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-2", { name: "Bob" }), searchText: "cnc sales manager", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }), searchText: "cnc sales director", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-4", { name: "Dylan" }), searchText: "cnc sales vp", isArchived: false },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&offset=2");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumeDigestPage",
    }));
  });

  it("keeps source pagination when a keyword search uses a non-score sort", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumeDigestPage
      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "d3", resumeId: "resume-live-3", source: "seek", sourceKey: "seek", searchText: "cnc sales director", isArchived: false },
                { _id: "d4", resumeId: "resume-live-4", source: "seek", sourceKey: "seek", searchText: "cnc sales vp", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }), searchText: "cnc sales director", isArchived: false },
          { ...buildConvexResumeRecord("resume-live-4", { name: "Dylan" }), searchText: "cnc sales vp", isArchived: false },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&offset=2&sortBy=name&sortOrder=desc");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody(response);
    expect(payload.success).toBe(true);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumeDigestPage",
    }));
  });

  it("keeps filtered keyword searches on the paged convex route for sparse seek lanes", async () => {
    const calls: ConvexCall[] = [];
    const keeKimLoong = buildConvexResumeRecord("resume-live-5", {
      name: "Kee Kim Loong",
      source: "hk.employer.seek.com",
      ingestData: {
        industryTags: ["机械", "销售"],
        companyHits: [],
        brandHits: [],
        roleSignals: [
          { type: "sales", matchedSignals: ["sales", "sales engineer"] },
          { type: "engineer", matchedSignals: ["engineer"] },
        ],
      },
    });
    keeKimLoong.content = {
      ...keeKimLoong.content,
      location: "Kuala Lumpur, MY",
    };
    const johnsonLeeWeiTao = buildConvexResumeRecord("resume-live-6", {
      name: "Johnson Lee Wei Tao",
      source: "hk.employer.seek.com",
      ingestData: {
        industryTags: ["销售"],
        companyHits: [],
        brandHits: [],
        roleSignals: [
          { type: "sales", matchedSignals: ["sales", "sales engineer", "account"] },
          { type: "engineer", matchedSignals: ["engineer", "design"] },
        ],
      },
    });
    johnsonLeeWeiTao.content = {
      ...johnsonLeeWeiTao.content,
      location: "Kuala Lumpur, MY",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumeDigestPage
      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                { _id: "d5", resumeId: "resume-live-5", source: "hk.employer.seek.com", sourceKey: "hk.employer.seek.com", searchText: "machine tools precision machinery sales engineer", isArchived: false },
                { _id: "d6", resumeId: "resume-live-6", source: "hk.employer.seek.com", sourceKey: "hk.employer.seek.com", searchText: "precision machinery sales engineer account design", isArchived: false },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          { ...keeKimLoong, searchText: "machine tools precision machinery sales engineer", isArchived: false },
          { ...johnsonLeeWeiTao, searchText: "precision machinery sales engineer account design", isArchived: false },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes?source=convex&q=%22machine%20tools%22&locations=Kuala%20Lumpur%20MY&jobDescriptionId=seek-malaysia-sales&limit=5"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
      query: "\"machine tools\"",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual([
      "Kee Kim Loong",
      "Johnson Lee Wei Tao",
    ]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:scanResumeDigestPage",
    }));
  });

  it("pushes required keywords into paged convex keyword searches", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      // AND-mode queries use two-phase scan: phase 1 via scanResumeDigestPage
      if (call.pathName === "resumes_search:scanResumeDigestPage") {
        const cursor = typeof call.args.cursor === "string" ? call.args.cursor : null;
        return convexSuccess({
          docs: cursor
            ? []
            : [
                {
                  _id: "d3",
                  resumeId: "resume-live-3",
                  source: "seek",
                  sourceKey: "seek",
                  searchText: "cnc sales machine tools",
                  isArchived: false,
                },
              ],
          isDone: !cursor,
          cursor: cursor ? null : "next-page",
        });
      }

      // Phase 2: fetch full docs by IDs
      if (call.pathName === "resumes_search:getResumeDocsByIds") {
        return convexSuccess([
          {
            ...buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            searchText: "cnc sales machine tools",
            isArchived: false,
          },
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&q=cnc%20sales&limit=2&requiredKeywords=machine%20tools,CNC");

    expect(response.status).toBe(200);
    // AND-mode now uses scanResumeDigestPage instead of the action
    expect(calls.some((c) => c.pathName === "resumes_search:scanResumeDigestPage")).toBe(true);
    // Required keywords are applied as local filters in BFF AND-mode path
    const payload = await parseJsonBody(response);
    expect(payload.success).toBe(true);
  });

  it("keeps source pagination when resume filters are pushed into the convex page query", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 2,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&locations=%E4%B8%9C%E8%8E%9E&requiredKeywords=CNC");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Dylan"]);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2, locations: ["东莞"], requiredKeywords: ["cnc"] }),
    }));
  });

  it("keeps source pagination when a non-score sort is pushed into the convex page query", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:listWithIngestDataPage") {
        return convexSuccess({
          results: [
            buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
            buildConvexResumeRecord("resume-live-4", { name: "Dylan" }),
          ],
          total: 4,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&sortBy=experience");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody(response);
    expect(payload.success).toBe(true);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:listWithIngestDataPage",
      args: expect.objectContaining({ limit: 2, offset: 2, sortBy: "experience", sortOrder: "asc" }),
    }));
  });

  it("pages score-sorted convex results through filtered match storage when local resume filters are present", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
          buildStoredMatch("resume-live-2", { id: 2, score: 90 }),
          buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
        ],
        total: 3,
      });
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "candidate_blocks:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-3", { name: "Carla" }),
          buildConvexExportResumeRecord("resume-live-2", {
            name: "Bob",
            location: "深圳",
          }),
          buildConvexExportResumeRecord("resume-live-1", { name: "Alice" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&locations=%E4%B8%9C%E8%8E%9E"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      limit: 250,
      offset: 0,
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
    const policyLoadPaths = new Set([
      "companies:listVerifiedIndustryEmployerAliases",
      "companies:list",
      "companies:listPoliciesForScope",
      "candidate_policy_overrides:list",
    ]);
    expect(calls.filter((call) => !policyLoadPaths.has(call.pathName))).toEqual([
      expect.objectContaining({
        pathName: "resumes:getByIdsForExport",
        args: expect.objectContaining({
          resumeIds: ["resume-live-1", "resume-live-2", "resume-live-3"],
        }),
      }),
      expect.objectContaining({
        pathName: "candidate_status:list",
        args: expect.objectContaining({
          workspaceSlug: "dev",
        }),
      }),
      expect.objectContaining({
        pathName: "candidate_blocks:list",
        args: expect.objectContaining({
          workspaceSlug: "dev",
        }),
      }),
    ]);
    expect(calls.some((call) => call.pathName === "resumes:listWithIngestData")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("pages score-sorted keyword convex results through exact keyword scan pages when local resume filters are present", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
        buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales&locations=%E4%B8%9C%E8%8E%9E"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
        locations: ["东莞"],
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("pages bounded score-sorted keyword convex results through exact keyword scan pages without source-side resume filters", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-1", { id: 1, score: 96 }),
        buildStoredMatch("resume-live-3", { id: 3, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=1&offset=1&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 1,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("scans oversized score-sorted keyword searches through exact cursor pages without fallback overfetch", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockReturnValue([
        buildStoredMatch("resume-live-3", { id: 3, score: 96 }),
        buildStoredMatch("resume-live-1", { id: 1, score: 81 }),
      ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? [
                { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
              ]
            : [
                { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "sales", source: "searchText" }] },
              ],
          continueCursor: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? ""
            : "scan-2",
          isDone: Boolean(call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"),
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Alice"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
    expect(calls[1]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: "scan-2", numItems: 250 }),
      }),
    }));
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionPage")).toBe(false);
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansion")).toBe(false);
  });

  it("keeps the best-scoring duplicate identity when oversized keyword scans merge exact cursor pages", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockImplementation((resumeIds) => {
        const ordered = Array.isArray(resumeIds) ? resumeIds : [];
        return ordered.flatMap((resumeId) => {
          if (resumeId === "resume-live-1") {
            return [buildStoredMatch("resume-live-1", { id: 1, score: 70 })];
          }
          if (resumeId === "resume-live-2") {
            return [buildStoredMatch("resume-live-2", { id: 2, score: 95 })];
          }
          if (resumeId === "resume-live-3") {
            return [buildStoredMatch("resume-live-3", { id: 3, score: 81 })];
          }
          return [];
        });
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPage") {
        return convexSuccess({
          expansion: {
            original: "cnc sales",
            expanded: ["cnc", "sales"],
            groups: [
              { original: "cnc", variants: ["cnc"] },
              { original: "sales", variants: ["sales"] },
            ],
            mode: "AND",
          },
          total: 2501,
          results: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice Older",
                identityKey: "dup-1",
                primaryRuleScore: 99,
              }),
              provenance: [{ term: "sales", source: "searchText" }],
            },
          ],
        });
      }

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? [
                {
                  resume: buildConvexResumeRecord("resume-live-2", {
                    name: "Alice Better",
                    identityKey: "dup-1",
                    primaryRuleScore: 10,
                  }),
                  provenance: [{ term: "cnc", source: "searchText" }],
                },
                {
                  resume: buildConvexResumeRecord("resume-live-3", {
                    name: "Carla",
                    identityKey: "dup-2",
                    primaryRuleScore: 40,
                  }),
                  provenance: [{ term: "cnc", source: "searchText" }],
                },
              ]
            : [
                {
                  resume: buildConvexResumeRecord("resume-live-1", {
                    name: "Alice Older",
                    identityKey: "dup-1",
                    primaryRuleScore: 99,
                  }),
                  provenance: [{ term: "sales", source: "searchText" }],
                },
              ],
          continueCursor: call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"
            ? ""
            : "scan-2",
          isDone: Boolean(call.args.paginationOpts && isRecord(call.args.paginationOpts) && call.args.paginationOpts.cursor === "scan-2"),
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&sortBy=score&jobDescriptionId=jd-1&q=cnc%20sales");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice Better", "Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-2", "resume-live-3"], "jd-1");
    expect(calls.some((call) => call.pathName === "resumes_search:searchWithTagExpansionScanPage")).toBe(true);
  });

  it("keeps explicit non-score keyword sorts when match filters require keyword scan pagination", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockImplementation((resumeIds) => {
        const ordered = Array.isArray(resumeIds) ? resumeIds : [];
        return ordered.flatMap((resumeId) => {
          if (resumeId === "resume-live-1") {
            return [buildStoredMatch("resume-live-1", { id: 1, score: 88 })];
          }
          if (resumeId === "resume-live-2") {
            return [buildStoredMatch("resume-live-2", { id: 2, score: 74 })];
          }
          if (resumeId === "resume-live-3") {
            return [buildStoredMatch("resume-live-3", { id: 3, score: 91 })];
          }
          return [];
        });
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice", location: "东莞" }), provenance: [{ term: "sales", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-2", { name: "Bob", location: "东莞", primaryRuleScore: 10 }), provenance: [{ term: "cnc", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla", location: "东莞" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&q=cnc%20sales&minMatchScore=70&sortBy=name&sortOrder=desc"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 3,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Bob"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-2", "resume-live-3"], "jd-1");
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionScanPage",
      args: expect.objectContaining({
        paginationOpts: expect.objectContaining({ cursor: null, numItems: 250 }),
      }),
    }));
  });

  it("pages score-sorted convex results through match storage and preserves explicit-id order", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-3", { id: 3, score: 96 }),
          buildStoredMatch("resume-live-1", { id: 1, score: 81 }),
        ],
        total: 4,
      });
    const getMatchesByResumeIdsSpy = vi.spyOn(MatchStorage.prototype, "getMatchesByResumeIds");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-1", { name: "Alice" }),
          buildConvexExportResumeRecord("resume-live-3", { name: "Carla" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&offset=2&sortBy=score&jobDescriptionId=jd-1");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 4,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Carla", "Alice"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      limit: 2,
      offset: 2,
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-3", "resume-live-1"] }),
    }));
  });

  it("pages minMatchScore convex filtering through match storage", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-2", { id: 2, score: 88 }),
          buildStoredMatch("resume-live-4", { id: 4, score: 75 }),
        ],
        total: 2,
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-4", { name: "Dylan" }),
          buildConvexExportResumeRecord("resume-live-2", { name: "Bob" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&minMatchScore=70");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Bob", "Dylan"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      minScore: 70,
      sortOrder: "desc",
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-2", "resume-live-4"] }),
    }));
  });

  it("applies minScore filter on the default convex search path (F5)", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-1", { id: 1, score: 88 }),
          buildStoredMatch("resume-live-2", { id: 2, score: 75 }),
          buildStoredMatch("resume-live-3", { id: 3, score: 91 }),
        ],
        total: 3,
      });
    const getMatchesByResumeIdsSpy = vi.spyOn(MatchStorage.prototype, "getMatchesByResumeIds");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "candidate_blocks:list") {
        return convexSuccess({ page: [], continueCursor: null, isDone: true });
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-1", { name: "Alice" }),
          buildConvexExportResumeRecord("resume-live-2", { name: "Bob" }),
          buildConvexExportResumeRecord("resume-live-3", { name: "Carla" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=5&minMatchScore=80&jobDescriptionId=jd-1");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    // The match-storage page is mocked WITHOUT SQL-side minScore filtering, so
    // the route itself must drop the sub-80 match (F5).
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice", "Carla"]);
    expect(payload.summary).toEqual(expect.objectContaining({
      returned: 2,
      source: "convex",
    }));
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      minScore: 80,
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
    expect(calls.some((call) => call.pathName === "resumes:getByIdsForExport")).toBe(true);
  });

  it("keys score-sort and recommendation match lookups by resumeId when id derivation differs (key-space F5 follow-up)", async () => {
    // Regression guard for the pre-existing key-space mismatch: the fallback
    // working-set recommendation filter and score sort must look up matchMap by
    // the Convex _id (candidate.resumeId), not by resolveResumeId(item) — those
    // can differ when the content's platform resumeId (a short source id) is
    // not the Convex document id. This exercises the non-pre-paged fallback
    // path (no keyword, match filters present → prepareConvexCandidates path).
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("convex-id-1", { id: 1, score: 96, recommendation: "match" }),
          buildStoredMatch("convex-id-2", { id: 2, score: 81, recommendation: "match" }),
          buildStoredMatch("convex-id-3", { id: 3, score: 74, recommendation: "potential" }),
        ],
        total: 3,
      });
    const getMatchesByResumeIdsSpy = vi.spyOn(MatchStorage.prototype, "getMatchesByResumeIds");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "candidate_blocks:list") {
        return convexSuccess({ page: [], continueCursor: null, isDone: true });
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("convex-id-1", { name: "Alice" }),
          buildConvexExportResumeRecord("convex-id-2", { name: "Bob" }),
          buildConvexExportResumeRecord("convex-id-3", { name: "Carla" }),
        ]);
      }

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            // Content platform resumeId ("13467969") differs from the Convex _id
            // ("convex-id-1") — exactly the divergence that broke the old
            // item.id-based match lookups.
            { resume: buildConvexResumeRecord("convex-id-1", { name: "Alice" }), provenance: [] },
            { resume: buildConvexResumeRecord("convex-id-2", { name: "Bob" }), provenance: [] },
            { resume: buildConvexResumeRecord("convex-id-3", { name: "Carla" }), provenance: [] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    // recommendation=match should drop "potential" (score 74) Carla; score-sort
    // should order Alice (96) before Bob (81). If lookups used the fallback id
    // (which resolves to profileUrl here), matchMap lookups would miss and all
    // rows would be dropped / sorted as -1.
    const response = await app.request(
      "/api/resumes?source=convex&limit=5&jobDescriptionId=jd-1&recommendation=match&sortBy=score"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice", "Bob"]);
    // The pre-paged match-storage path is used (recommendation + score-sort),
    // so getMatchesPageForJob runs; getMatchesByResumeIds is NOT called on the
    // pre-paged path.
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      recommendation: ["match"],
      sortOrder: "desc",
    }));
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
  });

  it("applies minScore filter on the convex keyword path (F5)", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesByResumeIds")
      .mockImplementation((resumeIds) =>
        resumeIds.flatMap((resumeId) => {
          const score = resumeId === "resume-live-1" ? 88 : resumeId === "resume-live-2" ? 75 : resumeId === "resume-live-3" ? 91 : undefined;
          return score !== undefined ? [buildStoredMatch(resumeId, { score })] : [];
        })
      );

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "candidate_blocks:list") {
        return convexSuccess({ page: [], continueCursor: null, isDone: true });
      }

      if (call.pathName === "resumes_search:searchWithTagExpansionScanPage") {
        return convexSuccess({
          page: [
            { resume: buildConvexResumeRecord("resume-live-1", { name: "Alice" }), provenance: [{ term: "cnc", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-2", { name: "Bob" }), provenance: [{ term: "cnc", source: "searchText" }] },
            { resume: buildConvexResumeRecord("resume-live-3", { name: "Carla" }), provenance: [{ term: "cnc", source: "searchText" }] },
          ],
          continueCursor: "",
          isDone: true,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=5&minMatchScore=80&q=CNC&jobDescriptionId=jd-1");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice", "Carla"]);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).toHaveBeenCalledWith(["resume-live-1", "resume-live-2", "resume-live-3"], "jd-1");
  });

  it("treats minScore as a no-op without a JD on the convex path (F5 documented limitation)", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi.spyOn(MatchStorage.prototype, "getMatchesPageForJob");
    const getMatchesByResumeIdsSpy = vi.spyOn(MatchStorage.prototype, "getMatchesByResumeIds");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "candidate_blocks:list") {
        return convexSuccess({ page: [], continueCursor: null, isDone: true });
      }

      if (call.pathName === "resumes:listWithIngestData") {
        return convexSuccess([
          buildConvexResumeRecord("resume-live-1", { name: "Alice" }),
          buildConvexResumeRecord("resume-live-2", { name: "Bob" }),
          buildConvexResumeRecord("resume-live-3", { name: "Carla" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes?source=convex&limit=5&minMatchScore=80");

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    // Without a JD there are no match scores, so minScore cannot filter —
    // documented as expected behavior (F5).
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Alice", "Bob", "Carla"]);
    expect(getMatchesPageSpy).not.toHaveBeenCalled();
    expect(getMatchesByResumeIdsSpy).not.toHaveBeenCalled();
  });

  it("pages recommendation-filtered convex results through match storage", async () => {
    const calls: ConvexCall[] = [];
    const getMatchesPageSpy = vi
      .spyOn(MatchStorage.prototype, "getMatchesPageForJob")
      .mockReturnValue({
        matches: [
          buildStoredMatch("resume-live-5", {
            id: 5,
            score: 93,
            recommendation: "strong_match",
          }),
          buildStoredMatch("resume-live-6", {
            id: 6,
            score: 84,
            recommendation: "match",
          }),
        ],
        total: 2,
      });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resumes:getByIdsForExport") {
        return convexSuccess([
          buildConvexExportResumeRecord("resume-live-6", { name: "Fiona" }),
          buildConvexExportResumeRecord("resume-live-5", { name: "Evelyn" }),
        ]);
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request(
      "/api/resumes?source=convex&limit=2&jobDescriptionId=jd-1&recommendation=strong_match,match"
    );

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { name: string }[] }>(response);
    expect(payload.success).toBe(true);
    expect(payload.summary).toEqual(expect.objectContaining({
      total: 2,
      returned: 2,
      source: "convex",
    }));
    expect(payload.data.map((item: { name: string }) => item.name)).toEqual(["Evelyn", "Fiona"]);
    expect(getMatchesPageSpy).toHaveBeenCalledWith(expect.objectContaining({
      jobDescriptionId: "jd-1",
      recommendation: ["strong_match", "match"],
      sortOrder: "desc",
    }));
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes:getByIdsForExport",
      args: expect.objectContaining({ resumeIds: ["resume-live-5", "resume-live-6"] }),
    }));
  });

  it("sends analyze location filters to the paginated convex query as locations", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPaginated") {
        expect(call.args).toEqual(expect.objectContaining({
          query: "cnc 销售",
          locations: ["China"],
        }));
        expect(call.args).not.toHaveProperty("location");
        return convexSuccess({
          page: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice",
                location: "China",
              }),
              provenance: [{ term: "销售", source: "searchText" }],
            },
          ],
          continuationCursor: null,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "CNC 销售",
        location: "China",
        dryRun: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      dryRun: true,
      resumeCount: 1,
      config: expect.objectContaining({
        location: "China",
      }),
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({
      pathName: "resumes_search:searchWithTagExpansionPaginated",
    }));
  });

  it("sends related experience context to convex analysis dispatch", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes_search:searchWithTagExpansionPaginated") {
        return convexSuccess({
          page: [
            {
              resume: buildConvexResumeRecord("resume-live-1", {
                name: "Alice",
                location: "China",
              }),
              provenance: [{ term: "销售", source: "searchText" }],
            },
          ],
          continuationCursor: null,
        });
      }

      if (call.pathName === "analysis_tasks:dispatch") {
        expect(call.args).toEqual(expect.objectContaining({
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
          keywords: ["cnc", "销售"],
          resumeIds: ["resume-live-1"],
          relatedExpContext: {
            roleFilterType: "sales",
            minRoleYears: 1,
            market: "CN",
          },
        }));
        return convexSuccess({
          queued: true,
          taskId: "task-related-exp",
          dispatchedAt: 1_750_000_000_000,
          reused: false,
        });
      }

      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "CNC 销售",
        limit: 500,
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      taskId: "task-related-exp",
      resumeCount: 1,
    }));
    expect(calls.map((call) => call.pathName)).toEqual([
      "resumes_search:searchWithTagExpansionPaginated",
      "analysis_tasks:dispatch",
    ]);
  });

  it("maps a search-mode maintenance refusal to HTTP 503", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      if (call.pathName === "resumes_search:searchWithTagExpansionPaginated") {
        return convexSuccess({
          page: [{ resume: buildConvexResumeRecord("resume-live-1") }],
          continuationCursor: null,
        });
      }
      if (call.pathName === "analysis_tasks:dispatch") {
        return convexSuccess({ queued: false, reason: "maintenance" });
      }
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "CNC 销售" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: "Analysis dispatch is unavailable during maintenance",
    });
    expect(calls.map((call) => call.pathName)).toEqual([
      "resumes_search:searchWithTagExpansionPaginated",
      "analysis_tasks:dispatch",
    ]);
  });

  it("rejects exact analysis without query or job description before Convex calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: [{ currentResumeId: "current-1" }],
        dryRun: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await parseErrorResponse(response)).toBe("Either query or jobDescriptionId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exact dry run resolves stable targets without search or dispatch", async () => {
    const promptVersion = getCurrentResumeAiPromptVersion();
    const expectedAnalysisId = buildKeywordAnalysisId(["cnc", "销售"], {
      location: "China",
      promptVersion,
    });
    const resolvedTargets = [
      buildResolvedExactTarget("current-2", "old-2"),
      buildResolvedExactTarget("current-1", "old-1"),
      buildResolvedExactTarget("current-2", "old-2-duplicate"),
    ];
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      expect(call.pathName).toBe("ingest_agent:resolveExactReingestTargets");
      expect(call.args).toEqual(expect.objectContaining({
        workspaceSlug: "dev",
        targets: [
          { referenceResumeId: "old-2", currentResumeId: "current-2" },
          { referenceResumeId: "old-1", externalId: "external-current-1" },
          { referenceResumeId: "old-2-duplicate", currentResumeId: "current-2" },
        ],
      }));
      expect(call.args.writeSecret).toEqual(expect.any(String));
      return convexSuccess({
        requested: 3,
        resolved: 2,
        resumeIds: ["current-2", "current-1"],
        targets: resolvedTargets,
      });
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        location: "China",
        limit: 1,
        dryRun: true,
        targets: [
          { referenceResumeId: "old-2", currentResumeId: "current-2" },
          { referenceResumeId: "old-1", externalId: "external-current-1" },
          { referenceResumeId: "old-2-duplicate", currentResumeId: "current-2" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      mode: "exact",
      dryRun: true,
      resumeCount: 2,
      requestedCount: 3,
      resolvedCount: 2,
      resumeIds: ["current-2", "current-1"],
      targets: resolvedTargets,
      expectedAnalysis: {
        jobDescriptionId: expectedAnalysisId,
        promptVersion,
      },
      config: {
        keywords: ["cnc", "销售"],
        location: "China",
      },
    });
    expect(calls).toHaveLength(1);
  });

  it("exact live analysis resolves manifest targets and direct IDs before dispatch", async () => {
    const promptVersion = getCurrentResumeAiPromptVersion();
    const resolvedTargets = [
      buildResolvedExactTarget("current-1", "old-1"),
      buildResolvedExactTarget("current-2", "direct-current-2"),
    ];
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "system_settings:isMaintenanceMode") {
        return convexSuccess(false);
      }
      calls.push(call);
      if (call.pathName === "ingest_agent:resolveExactReingestTargets") {
        expect(call.args.targets).toEqual([
          { referenceResumeId: "old-1", externalId: "external-current-1" },
          { currentResumeId: "current-2" },
        ]);
        return convexSuccess({
          requested: 2,
          resolved: 2,
          resumeIds: ["current-1", "current-2"],
          targets: resolvedTargets,
        });
      }
      if (call.pathName === "analysis_tasks:dispatchExact") {
        expect(call.args).toEqual(expect.objectContaining({
          workspaceSlug: "dev",
          keywords: ["cnc", "销售"],
          promptVersion,
          resumeIds: ["current-1", "current-2"],
          writeSecret: expect.any(String),
        }));
        return convexSuccess({
          queued: true,
          taskId: "task-exact-1",
          dispatchedAt: 1_750_000_000_001,
          reused: false,
          resumeIds: ["current-1", "current-2"],
        });
      }
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ referenceResumeId: "old-1", externalId: "external-current-1" }],
        resumeIds: ["current-2"],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      mode: "exact",
      dryRun: false,
      taskId: "task-exact-1",
      dispatchedAt: 1_750_000_000_001,
      reused: false,
      resumeCount: 2,
      requestedCount: 2,
      resolvedCount: 2,
      resumeIds: ["current-1", "current-2"],
      targets: resolvedTargets,
    }));
    expect(calls.map((call) => call.pathName)).toEqual([
      "ingest_agent:resolveExactReingestTargets",
      "analysis_tasks:dispatchExact",
    ]);
  });

  it("returns persisted task order for reversed same-set reuse without reordering target metadata", async () => {
    const callerOrderedTargets = [
      buildResolvedExactTarget("current-2", "old-2"),
      buildResolvedExactTarget("current-1", "old-1"),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "system_settings:isMaintenanceMode") {
        return convexSuccess(false);
      }
      if (call.pathName === "ingest_agent:resolveExactReingestTargets") {
        return convexSuccess({
          requested: 2,
          resolved: 2,
          resumeIds: ["current-2", "current-1"],
          targets: callerOrderedTargets,
        });
      }
      if (call.pathName === "analysis_tasks:dispatchExact") {
        expect(call.args.resumeIds).toEqual(["current-2", "current-1"]);
        return convexSuccess({
          queued: true,
          taskId: "task-exact-existing",
          dispatchedAt: 1_750_000_000_001,
          reused: true,
          resumeIds: ["current-1", "current-2"],
        });
      }
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [
          { referenceResumeId: "old-2", currentResumeId: "current-2" },
          { referenceResumeId: "old-1", currentResumeId: "current-1" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      mode: "exact",
      taskId: "task-exact-existing",
      reused: true,
      resumeIds: ["current-1", "current-2"],
      targets: callerOrderedTargets,
    }));
  });

  it.each([
    "selector externalId did not match any resume",
    "selectors conflict and resolve to different resumes",
    "selector profileResumeId matched multiple resumes",
    "resolved to archived resume current-1",
    "resolved to workspace hr, not dev",
  ])("fails exact analysis closed for resolver error: %s", async (resolverError) => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      expect(call.pathName).toBe("ingest_agent:resolveExactReingestTargets");
      return convexFailure(`Exact re-ingest target 1 ${resolverError}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ externalId: "external-current-1" }],
      }),
    });

    expect(response.status).toBe(400);
    expect(await parseErrorResponse(response)).toContain(resolverError);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["education", ["bachelor"]],
    ["skills", ["CNC"]],
    ["requiredKeywords", ["machine tools"]],
    ["locations", ["Dongguan"]],
    ["minSalary", 5_000],
    ["maxSalary", 15_000],
    ["minExperience", 1],
    ["maxExperience", 10],
  ])("rejects exact analysis selection-only filter %s", async (field, value) => {
    const convexCalls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "system_settings:isMaintenanceMode") {
        return convexSuccess(false);
      }
      convexCalls.push(call);
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });
    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ currentResumeId: "current-1" }],
        [field]: value,
      }),
    });

    expect(response.status).toBe(400);
    expect(await parseErrorResponse(response)).toContain(`not supported in exact mode: ${field}`);
    expect(convexCalls).toHaveLength(0);
  });

  it("rejects exact JD-only dry run when the JD cannot be loaded", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobDescriptionId: "missing-exact-jd",
        targets: [{ currentResumeId: "current-1" }],
        dryRun: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await parseErrorResponse(response)).toContain("could not be loaded and no query was provided");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects 501 combined exact targets before calling Convex", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: Array.from({ length: 500 }, (_, index) => ({
          currentResumeId: `current-${index}`,
        })),
        resumeIds: ["current-overflow"],
        dryRun: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent exact resolution envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess({
      requested: 2,
      resolved: 1,
      resumeIds: ["current-1"],
      targets: [buildResolvedExactTarget("current-1", "old-1")],
    }));

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ currentResumeId: "current-1" }],
        dryRun: true,
      }),
    });

    expect(response.status).toBe(500);
    expect(await parseErrorResponse(response)).toContain("inconsistent target counts");
  });

  it("rejects an inconsistent exact dispatch envelope", async () => {
    const resolvedTarget = buildResolvedExactTarget("current-1", "old-1");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "ingest_agent:resolveExactReingestTargets") {
        return convexSuccess({
          requested: 1,
          resolved: 1,
          resumeIds: ["current-1"],
          targets: [resolvedTarget],
        });
      }
      if (call.pathName === "analysis_tasks:dispatchExact") {
        return convexSuccess({
          queued: true,
          taskId: "",
          dispatchedAt: 1_750_000_000_001,
          reused: false,
        });
      }
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ currentResumeId: "current-1" }],
      }),
    });

    expect(response.status).toBe(500);
    expect(await parseErrorResponse(response)).toContain("inconsistent response");
  });

  it.each([
    ["missing", undefined],
    ["wrong-count", ["current-1", "current-2"]],
    ["wrong-set", ["current-other"]],
    ["duplicate", ["current-1", "current-1"]],
  ])("rejects exact dispatch %s persisted resume IDs", async (_label, persistedResumeIds) => {
    const resolvedTarget = buildResolvedExactTarget("current-1", "old-1");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "ingest_agent:resolveExactReingestTargets") {
        return convexSuccess({
          requested: 1,
          resolved: 1,
          resumeIds: ["current-1"],
          targets: [resolvedTarget],
        });
      }
      if (call.pathName === "analysis_tasks:dispatchExact") {
        return convexSuccess({
          queued: true,
          taskId: "task-exact-1",
          dispatchedAt: 1_750_000_000_001,
          reused: false,
          ...(persistedResumeIds ? { resumeIds: persistedResumeIds } : {}),
        });
      }
      if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
      if (call.pathName === "companies:list") { return convexSuccess([]); }
      if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
      if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const response = await createTestApp().request("/api/resumes/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "CNC 销售",
        targets: [{ currentResumeId: "current-1" }],
      }),
    });

    expect(response.status).toBe(500);
    expect(await parseErrorResponse(response)).toContain("inconsistent persisted resume IDs");
  });

  it("omits a null cursor on the first dry-run clear-analyses mutation call", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "/api/mutation");
      calls.push(call);

      if (call.pathName !== "resumes_mutations:clearAnalyses") {
        if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
        if (call.pathName === "companies:list") { return convexSuccess([]); }
        if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
        if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }

      if (calls.length === 1) {
        expect(call.args).toEqual(expect.objectContaining({
          batchSize: 50,
        }));
        expect(call.args).not.toHaveProperty("cursor");
        return convexSuccess({ cleared: 2, hasMore: true, cursor: "cursor-2" });
      }

      expect(call.args).toEqual(expect.objectContaining({
        batchSize: 50,
        cursor: "cursor-2",
      }));
      return convexSuccess({ cleared: 1, hasMore: false, cursor: null });
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/clear-analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dryRun: true,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      dryRun: true,
      cleared: 0,
      wouldClear: 3,
      targeted: false,
    }));
    expect(calls).toHaveLength(2);
  });

  it("omits a null cursor on the first clear-analyses mutation call", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "/api/mutation");
      calls.push(call);

      if (call.pathName !== "resumes_mutations:clearAnalyses") {
        if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
        if (call.pathName === "companies:list") { return convexSuccess([]); }
        if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
        if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
      }

      if (calls.length === 1) {
        expect(call.args).toEqual(expect.objectContaining({
          batchSize: 50,
        }));
        expect(call.args).not.toHaveProperty("cursor");
        return convexSuccess({ cleared: 2, hasMore: true, cursor: "cursor-2" });
      }

      expect(call.args).toEqual(expect.objectContaining({
        batchSize: 50,
        cursor: "cursor-2",
      }));
      return convexSuccess({ cleared: 1, hasMore: false, cursor: null });
    });

    const app = createTestApp();
    const response = await app.request("/api/resumes/clear-analyses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(expect.objectContaining({
      success: true,
      cleared: 3,
      batches: 2,
      targeted: false,
    }));
    expect(calls).toHaveLength(2);
  });

  it("rejects convex or read-only match-stream requests", async () => {
    const app = createTestApp();

    const convexResponse = await app.request("/api/resumes/match-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "convex",
        keywords: ["CNC"],
      }),
    });
    expect(convexResponse.status).toBe(400);

    const readOnlyResponse = await app.request("/api/resumes/match-stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        persist: false,
        keywords: ["CNC"],
      }),
    });
    expect(readOnlyResponse.status).toBe(400);
  });

  describe("POST /api/resumes/explanation", () => {
    it("returns explanation from Convex when available", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName !== "audit:getExplanationForCandidate") {
          if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
        if (call.pathName === "companies:list") { return convexSuccess([]); }
        if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
        if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
        }
        expect(call.args).toEqual({ resumeId: "r1", workspaceSlug: "ws1" });
        return convexSuccess({
          summary: "Candidate scored 85/100 for CNC operator role.",
          keyFactors: [
            { factor: "skill_alignment", value: "5 years CNC experience" },
            { factor: "experience", value: "8 years total" },
          ],
          decidedAt: 1748200000000,
          decisionType: "score",
          scrubbedFields: ["age", "gender"],
          protectedAttributesExcluded: true,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; data: { summary?: string; keyFactors: unknown[]; scrubbedFields?: unknown[]; protectedAttributesExcluded?: unknown } }>(response);
      expect(payload.success).toBe(true);
      expect(payload.data.summary).toBe("Candidate scored 85/100 for CNC operator role.");
      expect(payload.data.keyFactors.length).toBe(2);
      expect(payload.data.scrubbedFields).toEqual(["age", "gender"]);
      expect(payload.data.protectedAttributesExcluded).toBe(true);
    });

    it("returns null data when no explanation exists", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        parseConvexCall(input, init);
        return convexSuccess(null);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r2", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
      expect(payload.data).toBeNull();
    });

    it("returns null data when Convex rejects an invalid resume id", async () => {
      const loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        expect(call.pathName).toBe("audit:getExplanationForCandidate");
        expect(call.args).toEqual({ resumeId: "seek-profile-001", workspaceSlug: "dev" });
        return new Response(
          JSON.stringify({
            status: "error",
            errorMessage: 'Value does not match validator. Path: .resumeId Validator: v.id("resumes")',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "seek-profile-001", workspaceSlug: "dev" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
      expect(payload.data).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        "Candidate explanation requested with a non-Convex resume id",
        { route: "resumes" },
      );
    });

    it("returns 400 when resumeId is missing", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(false);
    });

    it("returns 400 when workspaceSlug is missing", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1" }),
      });

      expect(response.status).toBe(400);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(false);
    });

    it("returns 500 when Convex call fails", async () => {
      const loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ status: "error", errorMessage: "Not found" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: "r1", workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(500);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        "Failed to load candidate explanation",
        expect.any(Error),
        { route: "resumes" },
      );
    });
  });

  describe("POST /api/resumes/audit-logs", () => {
    it("returns audit logs for a workspace", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        if (call.pathName !== "audit:getAuditLogByWorkspace") {
          if (call.pathName === "companies:listVerifiedIndustryEmployerAliases") { return convexSuccess([]); }
        if (call.pathName === "companies:list") { return convexSuccess([]); }
        if (call.pathName === "companies:listPoliciesForScope") { return convexSuccess([]); }
        if (call.pathName === "candidate_policy_overrides:list") { return convexSuccess([]); }

        throw new Error(`Unexpected convex path: ${call.pathName}`);
        }
        expect(call.args.workspaceSlug).toBe("ws1");
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending", output: { score: 85 } },
          { _id: "al2", decisionType: "confirm", outcome: "pending", output: { score: 90 } },
        ]);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; data: unknown[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.data.length).toBe(2);
    });

    it("filters audit logs by decisionType", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        expect(call.args).toEqual({ workspaceSlug: "ws1", decisionType: "score" });
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending" },
        ]);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", decisionType: "score" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ data: unknown[] }>(response);
      expect(payload.data.length).toBe(1);
    });

    it("returns 400 when workspaceSlug is missing", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid decisionType", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", decisionType: "invalid" }),
      });

      expect(response.status).toBe(400);
    });

    it("filters audit logs by outcome", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init);
        expect(call.args).toEqual({ workspaceSlug: "ws1", outcome: "pending" });
        return convexSuccess([
          { _id: "al1", decisionType: "score", outcome: "pending" },
        ]);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", outcome: "pending" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ data: unknown[] }>(response);
      expect(payload.data.length).toBe(1);
    });

    it("returns 400 for invalid outcome", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "ws1", outcome: "invalid" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/resumes/audit-outcome", () => {
    it("sets audit outcome to accepted", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.pathName).toBe("audit:setAuditOutcome");
        expect(call.args).toEqual({ auditLogId: "al1", outcome: "accepted" });
        return convexSuccess(null);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "accepted" }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
    });

    it("sets audit outcome to overridden with setBy", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.args).toEqual({ auditLogId: "al1", outcome: "overridden", setBy: "reviewer@example.com" });
        return convexSuccess(null);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "overridden", setBy: "reviewer@example.com" }),
      });

      expect(response.status).toBe(200);
    });

    it("sets audit outcome to appealed", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const call = parseConvexCall(input, init, "/api/mutation");
        expect(call.args.outcome).toBe("appealed");
        return convexSuccess(null);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "appealed" }),
      });

      expect(response.status).toBe(200);
    });

    it("returns 400 when auditLogId is missing", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: "accepted" }),
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid outcome", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "invalid" }),
      });

      expect(response.status).toBe(400);
    });

    it("returns 500 when Convex call fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(JSON.stringify({ status: "error", errorMessage: "Not found" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/audit-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditLogId: "al1", outcome: "accepted" }),
      });

      expect(response.status).toBe(500);
    });
  });
});
