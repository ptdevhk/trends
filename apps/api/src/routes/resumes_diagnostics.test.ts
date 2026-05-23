import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesDiagnosticsRoutes from "./resumes_diagnostics";
import { workspaceMiddleware } from "../middleware/workspace";

function createTestApp() {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
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
      const payload = await response.json();
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
      const payload = await response.json();
      expect(payload.success).toBe(false);
      expect(payload.error).toContain("Convex timeout");
    });
  });

  describe("GET /api/resumes/skills-version", () => {
    it("returns version number", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/skills-version");

      expect(response.status).toBe(200);
      const payload = await response.json();
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
      const payload = await response.json();
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
      const payload = await response.json();
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
      const payload = await response.json();
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
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(calls[0].path).toBe("resumes:listArchivedDiagnostics");
    });
  });
});
