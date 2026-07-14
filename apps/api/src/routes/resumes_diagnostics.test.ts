import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesDiagnosticsRoutes from "./resumes_diagnostics";
import { workspaceMiddleware } from "../middleware/workspace";
import { createAuthContext } from "./test-auth-helpers";
import { parseJsonBody } from "../test-utils";
import { config } from "../services/config";
import { getCurrentResumeAiPromptVersion } from "@trends/shared";

const PROMPT_VERSION = getCurrentResumeAiPromptVersion();

function createTestApp(
  authContext = createAuthContext({ workspaceSlug: "dev", role: "admin" }),
) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", async (c, next) => {
    c.set("auth", authContext);
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

describe("resumes_diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/resumes/analysis-tasks", () => {
    it("returns task list", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess([
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
        ]),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/analysis-tasks");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; tasks: { _id: string; status: string }[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.tasks).toHaveLength(2);
      expect(payload.tasks[0]._id).toBe("task-1");
      expect(payload.tasks[0].status).toBe("completed");
      expect(payload.tasks[1].status).toBe("processing");
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

    it("rejects non-admin access without querying Convex", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const response = await createTestApp(
        createAuthContext({ workspaceSlug: "dev", role: "user" }),
      ).request("/api/resumes/analysis-tasks/task-exact-1");

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

  describe("GET /api/resumes/skills-version", () => {
    it("returns version number", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/skills-version");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; version: number }>(response);
      expect(payload.success).toBe(true);
      expect(typeof payload.version).toBe("number");
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
          hasMore: false,
          cursor: null,
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/field-coverage");

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: unknown; scanned: number; missingSearchText: number }>(response);
      expect(payload.success).toBe(true);
      expect(payload.scanned).toBe(200);
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
