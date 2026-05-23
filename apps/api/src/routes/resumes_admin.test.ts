import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesAdminRoutes from "./resumes_admin";
import { workspaceMiddleware } from "../middleware/workspace";

function createTestApp() {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.route("/", resumesAdminRoutes);
  return app;
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("resumes_admin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("admin access gating", () => {
    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        headers: { "X-Workspace-Slug": "hr" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.error).toContain("Admin access");
    });
  });

  describe("POST /api/resumes/hard-reset-reingest", () => {
    it("dry-run returns wouldClear count", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({ cleared: 42, hasMore: false, cursor: null }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.wouldClear).toBe(42);
      expect(payload.phase).toBe("dry_run");
    });

    it("rejects invalid body", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        body: JSON.stringify({ dryRun: "not-a-boolean" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/resumes/clear-analyses", () => {
    it("dry-run with jobDescriptionId returns targeted estimate", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({ cleared: 5, hasMore: false }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/clear-analyses", {
        method: "POST",
        body: JSON.stringify({ jobDescriptionId: "jd-1", dryRun: true }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.jobDescriptionId).toBe("jd-1");
      expect(payload.targeted).toBe(true);
    });

    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/clear-analyses", {
        method: "POST",
        headers: { "X-Workspace-Slug": "hr" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/resumes/reset-database", () => {
    it("dry-run returns wouldDelete counts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({ success: true, count: 100, partial: false, deleted: { resumes: 100 } }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/reset-database", {
        method: "POST",
        body: JSON.stringify({ dryRun: true }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.wouldDelete.resumes).toBe(100);
    });
  });

  describe("POST /api/resumes/archive", () => {
    it("archives resumes", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({
          requested: 2,
          archived: 2,
          alreadyArchived: 0,
          missingResumeIds: [],
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/archive", {
        method: "POST",
        body: JSON.stringify({ resumeIds: ["r1", "r2"], action: "archive" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.archived).toBe(2);
      expect(payload.requested).toBe(2);
    });

    it("unarchives resumes", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({
          requested: 1,
          unarchived: 1,
          notArchived: 0,
          missingResumeIds: [],
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/archive", {
        method: "POST",
        body: JSON.stringify({ resumeIds: ["r1"], action: "unarchive" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.unarchived).toBe(1);
    });

    it("rejects invalid action", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/archive", {
        method: "POST",
        body: JSON.stringify({ resumeIds: ["r1"], action: "delete" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/archive", {
        method: "POST",
        headers: { "X-Workspace-Slug": "hr" },
        body: JSON.stringify({ resumeIds: ["r1"], action: "archive" }),
      });

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/resumes/ingest-compute", () => {
    it("returns computed results", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/ingest-compute", {
        method: "POST",
        body: JSON.stringify({
          resumes: [{ resumeId: "r1", content: { name: "Alice" }, sourceKey: "seek" }],
        }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.results).toBeDefined();
    });

    it("rejects invalid body", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/ingest-compute", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
    });
  });
});
