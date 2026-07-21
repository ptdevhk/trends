import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import resumesDiagnosticsRoutes from "./resumes_diagnostics";
import { workspaceMiddleware } from "../middleware/workspace";
import { createAuthContext } from "./test-auth-helpers";
import { parseJsonBody } from "../test-utils";
import { config } from "../services/config";
import { getCurrentResumeAiPromptVersion } from "@trends/shared";

const PROMPT_VERSION = getCurrentResumeAiPromptVersion();
const TEST_CONVEX_WRITE_SECRET = "test-resumes-diagnostics-secret";
const originalConvexWriteSecret = config.auth.convexWriteSecret;

function createTestApp(
  authContext: ReturnType<typeof createAuthContext> | null = createAuthContext({ workspaceSlug: "dev", role: "admin" }),
) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", async (c, next) => {
    if (authContext) {
      c.set("auth", authContext);
    }
    await next();
  });
  app.route("/", resumesDiagnosticsRoutes);
  return app;
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeDiagnosticsItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    resumeId: id,
    externalId: id,
    source: "seek",
    sourceKey: "seek",
    name: "Alice",
    jobIntention: "Engineer",
    location: "东莞",
    ...overrides,
  };
}

function exactTaskStatusPayload(overrides: Record<string, unknown> = {}) {
  return {
    task: {
      _id: "task-exact-1",
      _creationTime: 1_750_000_000_000,
      status: "completed",
      dispatchMode: "exact",
      workspaceSlug: "dev",
      targetResumeIds: ["resume-1"],
      dispatchedAt: 1_750_000_000_001,
      config: {
        jobDescriptionId: "jd-exact",
        promptVersion: PROMPT_VERSION,
        resumeCount: 1,
      },
      progress: { current: 1, total: 1, skipped: 0 },
    },
    verification: {
      allReady: true,
      ready: 1,
      pending: 0,
      invalid: 0,
      checkedAt: 1_750_000_000_100,
      dispatchedAt: 1_750_000_000_001,
      targets: [{
        currentResumeId: "resume-1",
        state: "ready",
        expectedAnalysisKey: "source:seek|locale:en|analysis:jd-exact",
        expectedJobDescriptionId: "jd-exact",
        expectedPromptVersion: PROMPT_VERSION,
        actualJobDescriptionId: "jd-exact",
        actualPromptVersion: PROMPT_VERSION,
        analyzedAt: 1_750_000_000_002,
        reasons: [],
      }],
    },
    ...overrides,
  };
}

function exactTaskAuditExportPayload(overrides: Record<string, unknown> = {}) {
  return {
    task: {
      taskId: "task-exact-1",
      status: "completed",
      dispatchMode: "exact",
      workspaceSlug: "dev",
      dispatchedAt: 1_750_000_000_001,
      completedAt: 1_750_000_000_100,
      expectedJobDescriptionId: "jd-exact",
      expectedPromptVersion: PROMPT_VERSION,
      targetCount: 1,
    },
    counts: {
      scanned: 1,
      exported: 1,
      targeted: 1,
      ready: 1,
    },
    page: [{
      currentResumeId: "resume-1",
      canonicalIdentityKey: "resumeId:profile-1",
      externalId: "external-1",
      profileResumeId: "profile-1",
      profileUrl: "https://example.com/candidates/1",
      source: "seek",
      sourceKey: "seek",
      workspaceSlug: "dev",
      name: "Alice",
      age: "31",
      location: "Kuala Lumpur",
      taskId: "task-exact-1",
      taskStatus: "completed",
      taskWorkspaceSlug: "dev",
      taskDispatchedAt: 1_750_000_000_001,
      taskCompletedAt: 1_750_000_000_100,
      expectedJobDescriptionId: "jd-exact",
      expectedPromptVersion: PROMPT_VERSION,
      expectedAnalysisKey: "source:seek|locale:en|analysis:jd-exact",
      exactCohortMember: true,
      analysisState: "ready",
      analysisReasons: [] as string[],
      currentAnalysisKey: "source:seek|locale:en|analysis:jd-exact",
      currentJobDescriptionId: "jd-exact",
      currentPromptVersion: PROMPT_VERSION,
      currentLocale: "en",
      currentQueryLocation: "Malaysia",
      currentAnalyzedAt: 1_750_000_000_002,
      finalAiScore: 79,
      currentRecommendation: "match",
      currentBreakdown: { related_exp: 78, industry_db: 40 },
      relatedExpAuditFactor: 78,
      relatedExpContribution: 39,
      industryDbContribution: 40,
      currentAISummary: "Persisted exact-task score",
      currentHighlights: ["CNC sales"],
      currentConcerns: ["Limited premium-brand coverage"],
      currentKeyFactors: [{ factor: "role", value: "sales", weight: 0.5 }],
      evidenceBandMax: 65,
      relatedExpCoverage: "partial",
      missingReasons: ["outcome_missing"],
      effectiveRelatedExp: 65,
      llmRelatedExp: 78,
      recommendationMax: 80,
      relatedExpContextHash: "context-hash",
      relatedExpRubricVersion: "rubric-v2",
      brandHits: [{
        brand: "fanuc",
        role: "equipment",
        source: "workHistory",
        context: "sales",
        origin: "international",
        productClass: "complete_machine",
      }],
      brandOrigin: "international",
      productClass: "complete_machine",
      companyHits: ["fanuc"],
      roleSignals: [{
        type: "sales",
        matchedSignals: ["sales manager"],
        signalCount: 1,
        occurrences: 1,
        years: 5,
        industryVerifiedYears: 5,
        matchedWorkEntries: [{
          companyName: "Fanuc MY",
          jobTitle: "Sales Manager",
          years: 5,
          industryVerified: true,
          matchedSignals: ["sales manager"],
          directRoleMatch: true,
        }],
        verifyIn: "workHistory",
      }],
      matchedWorkEntries: [{
        companyName: "Fanuc MY",
        jobTitle: "Sales Manager",
        years: 5,
        industryVerified: true,
        matchedSignals: ["sales manager"],
        directRoleMatch: true,
      }],
      evidenceText: "Five years of CNC sales evidence",
      market: "MY",
      ruleScores: { sales: 63, industry: 50 },
      ruleScore: 63,
    }],
    continueCursor: "next/cursor+1",
    isDone: false,
    ...overrides,
  };
}

const exactTaskAuditReadyOnlyEvidenceKeys = [
  "finalAiScore",
  "currentRecommendation",
  "currentBreakdown",
  "relatedExpAuditFactor",
  "relatedExpContribution",
  "industryDbContribution",
  "currentAISummary",
  "currentHighlights",
  "currentConcerns",
  "currentKeyFactors",
  "evidenceBandMax",
  "relatedExpCoverage",
  "missingReasons",
  "effectiveRelatedExp",
  "llmRelatedExp",
  "recommendationMax",
  "relatedExpContextHash",
  "relatedExpRubricVersion",
] as const;

function nonReadyExactTaskAuditExportPayload(
  analysisState: string,
  analysisReasons: string[],
) {
  const payload = exactTaskAuditExportPayload();
  const row = payload.page[0] as Record<string, unknown>;
  row.analysisState = analysisState;
  row.analysisReasons = analysisReasons;
  for (const key of exactTaskAuditReadyOnlyEvidenceKeys) {
    delete row[key];
  }
  payload.counts.ready = 0;
  return payload;
}

describe("resumes_diagnostics", () => {
  beforeEach(() => {
    config.auth.convexWriteSecret = TEST_CONVEX_WRITE_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.auth.convexWriteSecret = originalConvexWriteSecret;
  });

  describe("GET /api/resumes/analysis-tasks", () => {
    it("returns task list for the active workspace", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess([
          {
            _id: "task-1",
            status: "completed",
            _creationTime: 1715000000000,
            config: { jobDescriptionId: "jd-1", jobDescriptionTitle: "Engineer" },
            progress: { current: 100, total: 100, skipped: 0 },
            results: { analyzed: 50, avgScore: 75, highScoreCount: 10 },
          },
          {
            _id: "task-2",
            status: "processing",
            _creationTime: 1715000000001,
            config: { keywords: ["python"] },
            progress: { current: 30, total: 100, skipped: 2 },
          },
        ]);
      });

      const app = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" }));
      const response = await app.request("/api/resumes/analysis-tasks", {
        headers: { "X-Workspace-Slug": "hr" },
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; tasks: { _id: string; status: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.tasks).toHaveLength(2);
      expect(payload.tasks[0]._id).toBe("task-1");
      expect(payload.tasks[0].status).toBe("completed");
      expect(payload.tasks[1].status).toBe("processing");
      expect(calls).toEqual([{
        path: "analysis_tasks:list",
        args: {
          workspaceSlug: "hr",
          writeSecret: TEST_CONVEX_WRITE_SECRET,
        },
      }]);
    });

    it("dispatches a normal task with only server-derived authority", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess({
          queued: true,
          taskId: "task-dispatch-1",
          dispatchedAt: 1_750_000_000_000,
          reused: false,
        });
      });

      const response = await createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" })).request(
        "/api/resumes/analysis-tasks/dispatch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
          body: JSON.stringify({
            jobDescriptionId: "jd-1",
            jobDescriptionTitle: "Sales Engineer",
            jobDescriptionContent: "Machine-tool sales experience",
            keywords: ["sales"],
            location: "Malaysia",
            promptVersion: 7,
            sample: "hr-reviewed",
            relatedExpContext: { roleFilterType: "sales", minRoleYears: 3, market: "MY", locale: "en" },
            resumeIds: ["resume-1"],
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([{
        path: "analysis_tasks:dispatch",
        args: {
          workspaceSlug: "hr",
          writeSecret: TEST_CONVEX_WRITE_SECRET,
          jobDescriptionId: "jd-1",
          jobDescriptionTitle: "Sales Engineer",
          jobDescriptionContent: "Machine-tool sales experience",
          keywords: ["sales"],
          location: "Malaysia",
          promptVersion: 7,
          sample: "hr-reviewed",
          relatedExpContext: { roleFilterType: "sales", minRoleYears: 3, market: "MY", locale: "en" },
          resumeIds: ["resume-1"],
        },
      }]);
    });

    it("rejects browser-supplied task authority before Convex dispatch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" })).request(
        "/api/resumes/analysis-tasks/dispatch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
          body: JSON.stringify({
            keywords: ["sales"],
            resumeIds: ["resume-1"],
            workspaceSlug: "dev",
            writeSecret: "browser-secret",
          }),
        },
      );

      expect(response.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects dispatch for callers without membership on the active workspace", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      // Authenticated on hr, but request is for dev workspace.
      const response = await createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" })).request(
        "/api/resumes/analysis-tasks/dispatch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Workspace-Slug": "dev" },
          body: JSON.stringify({ keywords: ["sales"], resumeIds: ["resume-1"] }),
        },
      );

      expect(response.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("cancels a task with only server-derived authority", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess(null);
      });

      const response = await createTestApp(createAuthContext({ workspaceSlug: "hr", role: "admin" })).request(
        "/api/resumes/analysis-tasks/task-cancel-1",
        {
          method: "DELETE",
          headers: { "X-Workspace-Slug": "hr" },
        },
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([{
        path: "analysis_tasks:cancel",
        args: {
          taskId: "task-cancel-1",
          workspaceSlug: "hr",
          writeSecret: TEST_CONVEX_WRITE_SECRET,
        },
      }]);
    });

    it("allows workspace members with role user to cancel analysis tasks", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess({ success: true });
      });

      const response = await createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" })).request(
        "/api/resumes/analysis-tasks/task-cancel-1",
        {
          method: "DELETE",
          headers: { "X-Workspace-Slug": "hr" },
        },
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual([{
        path: "analysis_tasks:cancel",
        args: {
          taskId: "task-cancel-1",
          workspaceSlug: "hr",
          writeSecret: TEST_CONVEX_WRITE_SECRET,
        },
      }]);
    });

    it("rejects unauthenticated analysis-task access without querying Convex", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await createTestApp(null).request(
        "/api/resumes/analysis-tasks/task-cancel-1",
        {
          method: "DELETE",
          headers: { "X-Workspace-Slug": "hr" },
        },
      );

      expect(response.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows workspace members with role user to list and dispatch analysis tasks", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        if (body.path === "analysis_tasks:list") {
          return convexSuccess([]);
        }
        return convexSuccess({
          queued: true,
          taskId: "task-user-dispatch",
          dispatchedAt: 1_750_000_000_000,
          reused: false,
        });
      });

      const userApp = createTestApp(createAuthContext({ workspaceSlug: "hr", role: "user" }));
      const listResponse = await userApp.request("/api/resumes/analysis-tasks", {
        headers: { "X-Workspace-Slug": "hr" },
      });
      expect(listResponse.status).toBe(200);

      const dispatchResponse = await userApp.request("/api/resumes/analysis-tasks/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
        body: JSON.stringify({ keywords: ["sales"], resumeIds: ["resume-1"] }),
      });
      expect(dispatchResponse.status).toBe(200);
      expect(calls.some((call) => call.path === "analysis_tasks:list")).toBe(true);
      expect(calls.some((call) => call.path === "analysis_tasks:dispatch")).toBe(true);
    });

    it("returns 500 on Convex error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Convex timeout"));

      const app = createTestApp();
      const response = await app.request("/api/resumes/analysis-tasks");

      expect(response.status).toBe(500);
      const payload = await parseJsonBody<{ success: unknown; error: string }>(response);
      expect(payload.success).toBe(false);
      expect(payload.error).toContain("Convex timeout");
    });
  });

  describe("GET /api/resumes/analysis-tasks/:taskId", () => {
    it("queries one exact task by ID with workspace and server secret", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess(exactTaskStatusPayload());
      });

      const response = await createTestApp().request("/api/resumes/analysis-tasks/task-exact-1");

      expect(response.status).toBe(200);
      expect(await parseJsonBody(response)).toEqual({
        success: true,
        ...exactTaskStatusPayload(),
      });
      expect(calls).toEqual([{
        path: "analysis_tasks:getExactStatus",
        args: {
          taskId: "task-exact-1",
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
        },
      }]);
    });

    it("allows workspace members with role user to read exact task status", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess(exactTaskStatusPayload());
      });

      const response = await createTestApp(
        createAuthContext({ workspaceSlug: "dev", role: "user" }),
      ).request("/api/resumes/analysis-tasks/task-exact-1");

      expect(response.status).toBe(200);
      expect(calls).toEqual([{
        path: "analysis_tasks:getExactStatus",
        args: {
          taskId: "task-exact-1",
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
        },
      }]);
    });

    it("rejects exact-task reads without membership on the active workspace", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await createTestApp(
        createAuthContext({ workspaceSlug: "hr", role: "user" }),
      ).request("/api/resumes/analysis-tasks/task-exact-1", {
        headers: { "X-Workspace-Slug": "dev" },
      });

      expect(response.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns 404 when the exact task does not exist", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(null));

      const response = await createTestApp().request("/api/resumes/analysis-tasks/missing-task");

      expect(response.status).toBe(404);
      expect(await parseJsonBody(response)).toEqual({
        success: false,
        error: "Analysis task not found",
      });
    });

    it("rejects a malformed Convex verification target", async () => {
      const payload = exactTaskStatusPayload();
      payload.verification.targets[0].state = "unknown";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request("/api/resumes/analysis-tasks/task-exact-1");

      expect(response.status).toBe(500);
    });

    it("rejects internally inconsistent verification counts", async () => {
      const payload = exactTaskStatusPayload({
        verification: {
          ...exactTaskStatusPayload().verification,
          allReady: true,
          ready: 0,
          pending: 0,
          invalid: 0,
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request("/api/resumes/analysis-tasks/task-exact-1");

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent target counts");
    });
  });

  describe("GET /api/resumes/analysis-tasks/:taskId/audit-export", () => {
    it("requires an authenticated workspace admin before querying Convex", async () => {
      for (const authContext of [
        null,
        createAuthContext({ workspaceSlug: "dev", role: "user" }),
        createAuthContext({ workspaceSlug: "hr", role: "admin" }),
      ]) {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const response = await createTestApp(authContext).request(
          "/api/resumes/analysis-tasks/task-exact-1/audit-export",
        );
        expect(response.status).toBe(authContext === null ? 401 : 403);
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      }
    });

    it("decodes one exact task ID and forwards workspace, secret, cursor, and bounded limit only to the audit page query", async () => {
      const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          path: string;
          args: Record<string, unknown>;
        };
        calls.push(body);
        const payload = exactTaskAuditExportPayload();
        payload.task.taskId = "task/with space";
        payload.page[0].taskId = "task/with space";
        return convexSuccess(payload);
      });

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task%2Fwith%20space/audit-export?cursor=cursor%2Fwith%20%2B&limit=37",
      );

      expect(response.status).toBe(200);
      expect((await parseJsonBody<{ task: { taskId: string } }>(response)).task.taskId).toBe("task/with space");
      expect(calls).toEqual([{
        path: "analysis_tasks:getExactAuditExportPage",
        args: {
          taskId: "task/with space",
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
          cursor: "cursor/with +",
          limit: 37,
        },
      }]);
      expect(calls.some((call) => call.path === "analysis_tasks:list")).toBe(false);
      expect(calls.some((call) => call.path === "resumes:getByIdsForExport")).toBe(false);
    });

    it("uses a bounded default page size and rejects malformed query parameters before Convex", async () => {
      const calls: Array<{ args: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
          args: Record<string, unknown>;
        };
        calls.push(body);
        return convexSuccess(exactTaskAuditExportPayload());
      });

      const defaultResponse = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );
      expect(defaultResponse.status).toBe(200);
      expect(calls[0]?.args).toMatchObject({ limit: 200 });
      expect(calls[0]?.args).not.toHaveProperty("cursor");

      for (const query of ["limit=0", "limit=201", "limit=1.5", "cursor="]) {
        const callCount = calls.length;
        const response = await createTestApp().request(
          `/api/resumes/analysis-tasks/task-exact-1/audit-export?${query}`,
        );
        expect(response.status).toBe(400);
        expect(calls).toHaveLength(callCount);
      }
    });

    it("maps a missing exact task to 404", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(null));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/missing-task/audit-export",
      );

      expect(response.status).toBe(404);
      expect(await parseJsonBody(response)).toEqual({
        success: false,
        error: "Analysis task not found",
      });
    });

    it.each([
      "Analysis task task-exact-1 is not an exact dispatch",
      "Exact analysis task task-exact-1 must be completed for audit export",
      "Analysis task workspace hr does not match dev",
    ])("maps invalid task state to 409: %s", async (message) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
        JSON.stringify({ status: "error", errorMessage: message }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(409);
      expect((await parseJsonBody(response)).error).toContain(message);
    });

    it("rejects a malformed page row against the response schema", async () => {
      const payload = exactTaskAuditExportPayload();
      payload.page[0].analysisState = "unknown";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
    });

    it("rejects a ready row without its current analysis key", async () => {
      const payload = exactTaskAuditExportPayload();
      const row = payload.page[0] as Record<string, unknown>;
      delete row.currentAnalysisKey;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent");
    });

    it("rejects a non-ready row that carries score evidence", async () => {
      const payload = exactTaskAuditExportPayload();
      payload.page[0].analysisState = "cold_row_missing";
      payload.page[0].analysisReasons = ["cold_row_missing"];
      payload.counts.ready = 0;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent");
    });

    it.each([
      { label: "empty reason metadata", reasons: [] },
      { label: "contradictory reason metadata", reasons: ["prompt_version_mismatch"] },
    ])("rejects a non-ready row with $label", async ({ reasons }) => {
      const payload = nonReadyExactTaskAuditExportPayload(
        "job_description_mismatch",
        reasons,
      );
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent");
    });

    it.each([
      {
        analysisState: "cold_row_missing",
        reasons: ["cold_row_missing", "prompt_version_mismatch"],
      },
      {
        analysisState: "job_description_mismatch",
        reasons: ["job_description_mismatch", "job_description_mismatch"],
      },
      {
        analysisState: "job_description_mismatch",
        reasons: ["job_description_mismatch", "timestamp_missing", "not_newer_than_dispatch"],
      },
      {
        analysisState: "prompt_version_mismatch",
        reasons: ["prompt_version_mismatch", "job_description_mismatch"],
      },
    ])("rejects an impossible non-ready reason sequence", async ({ analysisState, reasons }) => {
      const payload = nonReadyExactTaskAuditExportPayload(analysisState, reasons);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent");
    });

    it("accepts an ordered multi-reason provenance mismatch", async () => {
      const payload = nonReadyExactTaskAuditExportPayload(
        "job_description_mismatch",
        [
          "job_description_mismatch",
          "prompt_version_mismatch",
          "not_newer_than_dispatch",
        ],
      );
      const row = payload.page[0] as Record<string, unknown>;
      row.currentJobDescriptionId = "jd-other";
      row.currentPromptVersion = PROMPT_VERSION - 1;
      row.currentAnalyzedAt = payload.task.dispatchedAt;
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(200);
    });

    it.each([
      "exported count",
      "targeted count",
      "ready count",
      "task metadata",
      "cursor",
    ])("rejects inconsistent %s", async (caseName) => {
      const payload = exactTaskAuditExportPayload();
      if (caseName === "exported count") {
        payload.counts.exported = 2;
      } else if (caseName === "targeted count") {
        payload.counts.targeted = 0;
      } else if (caseName === "ready count") {
        payload.counts.ready = 0;
      } else if (caseName === "task metadata") {
        payload.page[0].taskId = "task-other";
      } else {
        payload.continueCursor = "";
      }
      vi.spyOn(globalThis, "fetch").mockResolvedValue(convexSuccess(payload));

      const response = await createTestApp().request(
        "/api/resumes/analysis-tasks/task-exact-1/audit-export",
      );

      expect(response.status).toBe(500);
      expect((await parseJsonBody(response)).error).toContain("inconsistent");
    });
  });

  describe("GET /api/resumes/skills-version", () => {
    it("returns skills version and ingestComputeEpoch for admin", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/skills-version");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{
        success: unknown;
        version: number;
        ingestComputeEpoch: number;
      }>(response);
      expect(payload.success).toBe(true);
      expect(typeof payload.version).toBe("number");
      expect(typeof payload.ingestComputeEpoch).toBe("number");
      expect(payload.ingestComputeEpoch).toBeGreaterThanOrEqual(1);
    });

    it("accepts Convex write-secret worker auth without browser session", async () => {
      const app = createTestApp(null);
      const response = await app.request("/api/resumes/skills-version", {
        headers: { "X-Convex-Write-Secret": TEST_CONVEX_WRITE_SECRET },
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{
        success: unknown;
        version: number;
        ingestComputeEpoch: number;
      }>(response);
      expect(payload.success).toBe(true);
      expect(typeof payload.version).toBe("number");
      expect(payload.ingestComputeEpoch).toBeGreaterThanOrEqual(1);
    });

    it("rejects unauthenticated requests without write secret", async () => {
      const app = createTestApp(null);
      const response = await app.request("/api/resumes/skills-version");
      expect(response.status).toBeGreaterThanOrEqual(401);
    });
  });

  describe("GET /api/resumes/field-coverage", () => {
    it("returns aggregated stats for single page", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({
          scanned: 200,
          missingSearchText: 10,
          missingVerifiedRoleYears: 5,
          hasRoleSignals: 150,
          missingIngestComputeEpoch: 40,
          laggingIngestComputeEpoch: 2,
          hasMore: false,
          cursor: null,
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/field-coverage");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{
        success: unknown;
        scanned: number;
        missingSearchText: number;
        missingIngestComputeEpoch: number;
        laggingIngestComputeEpoch: number;
        currentIngestComputeEpoch: number;
      }>(response);
      expect(payload.success).toBe(true);
      expect(payload.scanned).toBe(200);
      expect(payload.missingIngestComputeEpoch).toBe(40);
      expect(payload.laggingIngestComputeEpoch).toBe(2);
      expect(payload.currentIngestComputeEpoch).toBeGreaterThanOrEqual(1);
      expect(payload.missingSearchText).toBe(10);
    });

    it("aggregates across multiple pages", async () => {
      let callCount = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return convexSuccess({
            scanned: 200,
            missingSearchText: 10,
            missingVerifiedRoleYears: 5,
            hasRoleSignals: 150,
            hasMore: true,
            cursor: "page2",
          });
        }
        return convexSuccess({
          scanned: 100,
          missingSearchText: 2,
          missingVerifiedRoleYears: 1,
          hasRoleSignals: 80,
          hasMore: false,
          cursor: null,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/field-coverage");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ scanned: number; missingSearchText: number }>(response);
      expect(payload.scanned).toBe(300);
      expect(payload.missingSearchText).toBe(12);
      expect(callCount).toBe(2);
    });
  });

  describe("GET /api/resumes/diagnostics", () => {
    it("returns diagnostics rows (non-archived)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({
          page: [makeDiagnosticsItem("diag-1")],
          continueCursor: "",
          isDone: true,
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/diagnostics");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; summary: Record<string, unknown>; data: { resumeId: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.summary.archived).toBe(false);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].resumeId).toBe("diag-1");
    });

    it("filters by archived=true and sourceKey", async () => {
      const calls: Array<{ path: string }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        calls.push({ path: body.path });
        return convexSuccess({
          page: [makeDiagnosticsItem("diag-2", { sourceKey: "seek" })],
          continueCursor: "",
          isDone: true,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/diagnostics?archived=true&sourceKey=seek");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown }>(response);
      expect(payload.success).toBe(true);
      expect(calls[0].path).toBe("resumes_diagnostics:listArchivedDiagnostics");
    });
  });

  describe("workspace access control", () => {
    it("rejects non-admin workspace with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/analysis-tasks", {
        headers: { "X-Workspace-Slug": "hr" },
      });

      expect(response.status).toBe(403);
    });
  });
});
