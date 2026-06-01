import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesAdminRoutes from "./resumes_admin";
import { workspaceMiddleware } from "../middleware/workspace";

vi.mock("../services/notification-service", () => ({
  notificationService: {
    sendFeishuText: vi.fn().mockResolvedValue({ code: 0, msg: "ok" }),
    sendWechatWorkMarkdown: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" }),
    sendEmail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
  },
}));

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
  const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    "Content-Type": "application/json",
    ...extra,
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("admin access gating", () => {
    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        headers: jsonHeaders({ "X-Workspace-Slug": "hr" }),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
      const payload = await response.json();
      expect(payload.error).toContain("Admin access");
    });
  });

  describe("POST /api/resumes/hard-reset-reingest", () => {
    it("first Convex call omits cursor key entirely (never sends cursor: null)", async () => {
      const capturedBodies: unknown[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
        const body = JSON.parse(init?.body as string ?? "{}");
        capturedBodies.push(body);
        return convexSuccess({ cleared: 0, hasMore: false });
      });

      const app = createTestApp();
      await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ dryRun: false }),
      });

      // The first Convex mutation call must NOT contain a cursor key at all
      expect(capturedBodies.length).toBeGreaterThan(0);
      const firstCallBody = capturedBodies[0] as Record<string, unknown>;
      // The body is the Convex action payload; the args should not have cursor: null
      const firstCallArgs = (firstCallBody.args ?? firstCallBody) as Record<string, unknown>;
      expect("cursor" in firstCallArgs).toBe(false);
    });

    it("dry-run returns wouldClear count", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({ cleared: 42, hasMore: false, cursor: null }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders({ "X-Workspace-Slug": "hr" }),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
        body: JSON.stringify({ resumeIds: ["r1"], action: "delete" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/archive", {
        method: "POST",
        headers: jsonHeaders({ "X-Workspace-Slug": "hr" }),
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
        headers: jsonHeaders(),
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
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.success).toBe(false);
    });
  });

  describe("POST /api/resumes/bias-anomaly-notify", () => {
    it("rejects non-admin access with 403", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/bias-anomaly-notify", {
        method: "POST",
        headers: jsonHeaders({ "X-Workspace-Slug": "hr" }),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(403);
    });

    it("returns 400 when workspaceSlug is missing", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/bias-anomaly-notify", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid channel", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/bias-anomaly-notify", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ workspaceSlug: "test-ws", channel: "slack" }),
      });

      expect(response.status).toBe(400);
    });

    it("returns notified:false when no active alerts", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess(null),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/bias-anomaly-notify", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ workspaceSlug: "test-ws" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.notified).toBe(false);
      expect(payload.reason).toContain("No active anomaly alerts");
    });

    it("sends notification via feishu when channel specified", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexSuccess({
          workspaceSlug: "test-ws",
          flags: ["disparate_impact_violation"],
          psiValue: 0.35,
          disparityRatio: 0.72,
          alertedAt: Date.now(),
        }),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/bias-anomaly-notify", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ workspaceSlug: "test-ws", channel: "feishu" }),
      });

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.success).toBe(true);
      expect(payload.notified).toBe(true);
      expect(payload.channels).toHaveLength(1);
      expect(payload.channels[0].channel).toBe("feishu");
      expect(payload.channels[0].success).toBe(true);
    });
  });
});
