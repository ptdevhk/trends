import { afterEach, describe, expect, it, vi } from "vitest";

// Maintenance middleware is unit-tested separately; route tests bypass it.
vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { config } from "../services/config";
import { parseJsonBody } from "../test-utils";
import { createAuthContext } from "./test-auth-helpers";

type ConvexCall = {
  pathName: string;
  args: Record<string, unknown>;
  endpoint: "query" | "mutation";
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

  const endpoint: "query" | "mutation" | null = requestUrl.includes("/api/query")
    ? "query"
    : requestUrl.includes("/api/mutation")
      ? "mutation"
      : null;

  if (!endpoint) {
    throw new Error(`Unexpected request URL: ${requestUrl}`);
  }

  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }

  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
  }

  return { endpoint, pathName, args };
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
    },
  );
}

describe("resume backup and reset routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backs up portable resume payloads with source-specific tags", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.endpoint === "query" && call.pathName === "candidate_status:listPage") {
        expect(call.args).toEqual({
          workspaceSlug: "dev",
          paginationOpts: { cursor: null, numItems: 500 },
          writeSecret: config.auth.convexWriteSecret,
        });
        return convexSuccess({ page: [], continueCursor: "status:done", isDone: true });
      }

      if (call.endpoint === "query" && call.pathName === "resumes:listForBackup") {
        expect(call.args).toEqual({
          paginationOpts: {
            cursor: null,
            numItems: 50,
          },
          resumeIds: ["1001"],
          sourceHosts: ["hr.job5156.com"],
        });
        return convexSuccess({
          page: [
            {
              _id: "resume-1",
              identityKey: "profileUrl:hr.job5156.com/api/com/resume/1001",
              externalId: "hr.job5156.com:resume:1001",
              source: "hr.job5156.com",
              tags: ["sales", "job5156"],
              crawledAt: 200,
              primaryRuleScore: 93,
              searchText: "alice sales dongguan",
              isArchived: true,
              archivedAt: 1763942400000,
              ingestData: {
                industryTags: ["machine tools"],
              },
              analysis: {
                score: 86,
                summary: "Strong sales fit",
                highlights: ["CNC sales"],
                recommendation: "match",
              },
              analyses: {
                "source:job5156|analysis:lathe-sales": {
                  score: 86,
                },
              },
              content: {
                resumeId: "1001",
                name: "Alice",
                profileUrl: "https://hr.job5156.com/resume/view/1001",
                activityStatus: "Active",
                age: "30",
                experience: "5 years",
                education: "Bachelor",
                location: "Dongguan",
                jobIntention: "Sales",
                expectedSalary: "10k-20k",
                selfIntro: "Intro",
                workHistory: [{ raw: "Test work history" }],
                extractedAt: "2026-03-17T00:00:00.000Z",
              },
            },
          ],
          continueCursor: "cursor:done",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }) });
    const response = await app.request("/api/resumes/backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        resumeIds: ["1001"],
        sourceHosts: ["hr.job5156.com"],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="resume-backup-.+\.json"$/);
    const payload = await parseJsonBody<{ metadata: Record<string, unknown>; resumes: unknown[] }>(response);
    expect(payload.metadata.generatedBy).toBe("trends-api backup");
    expect(payload.metadata.totalResumes).toBe(1);
    expect(payload.resumes).toHaveLength(1);
    expect(payload.resumes[0]).toEqual(expect.objectContaining({
      resumeId: "1001",
      externalId: "hr.job5156.com:resume:1001",
      sourceHost: "hr.job5156.com",
      tags: ["sales", "job5156"],
      profileUrl: "https://hr.job5156.com/resume/view/1001",
      restoreState: {
        crawledAt: 200,
        isArchived: true,
        archivedAt: 1763942400000,
        primaryRuleScore: 93,
        searchText: "alice sales dongguan",
        ingestData: {
          industryTags: ["machine tools"],
        },
        analysis: {
          score: 86,
          summary: "Strong sales fit",
          highlights: ["CNC sales"],
          recommendation: "match",
        },
        analyses: {
          "source:job5156|analysis:lathe-sales": {
            score: 86,
          },
        },
      },
    }));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.pathName).toBe("resumes:listForBackup");
  });

  it("continues paginating resume backup pages until done", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.endpoint === "query" && call.pathName === "candidate_status:listPage") {
        const paginationOpts = isRecord(call.args.paginationOpts) ? call.args.paginationOpts : {};
        expect(call.args.writeSecret).toBe(config.auth.convexWriteSecret);
        if (paginationOpts.cursor === null) {
          return convexSuccess({
            page: [{
              _id: "status-1",
              identityKey: "resume-1",
              workspaceSlug: "dev",
              status: "new",
              updatedAt: 1,
              history: [],
            }],
            continueCursor: "status:page-2",
            isDone: false,
          });
        }
        return convexSuccess({
          page: [{
            _id: "status-2",
            identityKey: "candidate-2",
            workspaceSlug: "dev",
            status: "shortlisted",
            notes: "Second page",
            updatedAt: 2,
            history: [],
          }, {
            _id: "status-orphan",
            identityKey: "candidate-not-in-backup",
            workspaceSlug: "dev",
            status: "rejected",
            updatedAt: 3,
            history: [],
          }],
          continueCursor: "status:done",
          isDone: true,
        });
      }

      if (call.endpoint === "query" && call.pathName === "resumes:listForBackup") {
        if (calls.length === 1) {
          expect(call.args).toEqual({
            paginationOpts: {
              cursor: null,
              numItems: 50,
            },
            limit: 2,
          });
          return convexSuccess({
            page: [
              {
                _id: "resume-1",
                identityKey: "candidate-1",
                externalId: "hr.job5156.com:resume:1001",
                source: "hr.job5156.com",
                tags: ["sales"],
                crawledAt: 200,
                content: {
                  resumeId: "1001",
                  name: "Alice",
                  profileUrl: "https://hr.job5156.com/resume/view/1001",
                  activityStatus: "Active",
                  age: "30",
                  experience: "5 years",
                  education: "Bachelor",
                  location: "Dongguan",
                  jobIntention: "Sales",
                  expectedSalary: "10k-20k",
                  selfIntro: "Intro",
                  workHistory: [{ raw: "Test work history" }],
                  extractedAt: "2026-03-17T00:00:00.000Z",
                },
              },
            ],
            continueCursor: "cursor:page-2",
            isDone: false,
          });
        }

        expect(call.args).toEqual({
          paginationOpts: {
            cursor: "cursor:page-2",
            numItems: 50,
          },
          limit: 2,
        });
        return convexSuccess({
          page: [
            {
              _id: "resume-2",
              identityKey: "candidate-2",
              externalId: "hk.employer.seek.com:profile:2002",
              source: "hk.employer.seek.com",
              tags: ["seek"],
              crawledAt: 100,
              content: {
                profileId: "2002",
                profileType: "seek",
                name: "Bob",
                profileUrl: "https://hk.employer.seek.com/candidates/2002",
                activityStatus: "Active",
                age: "31",
                experience: "6 years",
                education: "Bachelor",
                location: "Kuala Lumpur",
                jobIntention: "Sales Engineer",
                expectedSalary: "8k-12k",
                selfIntro: "Intro",
                workHistory: [{ raw: "Test work history" }],
                extractedAt: "2026-03-17T00:00:00.000Z",
              },
            },
          ],
          continueCursor: "cursor:done",
          isDone: true,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }) });
    const response = await app.request("/api/resumes/backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 2 }),
    });

    expect(response.status).toBe(200);
    const payload = await parseJsonBody<{
      metadata: Record<string, unknown>;
      resumes: { name: string }[];
      candidateStatus: Array<{ identityKey: string }>;
    }>(response);
    expect(payload.metadata.totalResumes).toBe(2);
    expect(payload.resumes.map((item) => item.name)).toEqual(["Alice", "Bob"]);
    expect(payload.candidateStatus.map((item) => item.identityKey)).toEqual(["candidate-1", "candidate-2"]);
    expect(calls).toHaveLength(4);
  });

  it("blocks resume backup for non-admin workspaces", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp({ authContext: createAuthContext({ workspaceSlug: "hr", role: "user" }) });

    const response = await app.request("/api/resumes/backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: "Admin access required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resets resume records through Convex", async () => {
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.endpoint === "mutation" && call.pathName === "resume_tasks:resetDatabase") {
        return convexSuccess({
          success: true,
          count: 12,
          partial: false,
          deleted: {
            resumes: 4,
            analysis_tasks: 3,
          },
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }) });
    const response = await app.request("/api/resumes/reset", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "dev",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      count: 12,
      partial: false,
      deleted: {
        resumes: 4,
        analysis_tasks: 3,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathName).toBe("resume_tasks:resetDatabase");
  });
});
