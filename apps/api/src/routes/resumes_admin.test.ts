import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesAdminRoutes from "./resumes_admin";
import { createAuthMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import type { AuthStorage } from "../services/auth-storage";
import { config } from "../services/config";
import { resetResumeScreeningDb } from "../services/database";
import { parseJsonBody } from "../test-utils";
import { createAuthHeaders } from "./test-auth-helpers";

vi.mock("../services/notification-service", () => ({
  notificationService: {
    sendFeishuText: vi.fn().mockResolvedValue({ code: 0, msg: "ok" }),
    sendWechatWorkMarkdown: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" }),
    sendEmail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
  },
}));

let defaultAuthHeaders: Record<string, string> = {};

function createTestApp(storage?: AuthStorage) {
  const auth = storage ? undefined : createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
  const authStorage = storage ?? auth!.storage;
  defaultAuthHeaders = auth?.headers ?? defaultAuthHeaders;
  const middleware = createAuthMiddleware({ storage: authStorage, ttlSeconds: 3600 });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/", resumesAdminRoutes);
  return app;
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function convexError(errorMessage: string): Response {
  return new Response(
    JSON.stringify({ status: "error", errorMessage }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("resumes_admin", () => {
  const jsonHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...defaultAuthHeaders,
    "Content-Type": "application/json",
    ...extra,
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetResumeScreeningDb();
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
      const payload = await parseJsonBody(response);
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
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return convexSuccess({ cleared: 42, hasMore: false, cursor: null });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/hard-reset-reingest", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ dryRun: true }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.wouldClear).toBe(42);
      expect(payload.phase).toBe("dry_run");
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("/api/mutation");
      expect(requests[0].body).toMatchObject({
        path: "resumes_mutations:hardResetIngestData",
        args: { batchSize: 50, dryRun: true },
      });
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

  describe("POST /api/resumes/exact-reingest", () => {
    const resolvedTargets = [
      {
        referenceResumeId: "old-2",
        currentResumeId: "current-2",
        profileResumeId: "100002",
        profileUrl: "https://example.com/candidates/2?resumeId=100002",
        externalId: "external-2",
        source: "example.com",
        canonicalIdentityKey: "profileUrl:example.com/candidates/2?resumeid=100002",
      },
      {
        referenceResumeId: "old-1",
        currentResumeId: "current-1",
        profileResumeId: "100001",
        externalId: "external-1",
        source: "example.com",
        canonicalIdentityKey: "externalId:external-1",
      },
      {
        referenceResumeId: "old-2-duplicate",
        currentResumeId: "current-2",
        profileResumeId: "100002",
        externalId: "external-2",
        source: "example.com",
        canonicalIdentityKey: "profileUrl:example.com/candidates/2?resumeid=100002",
      },
    ];

    it("resolves and previews targets without dispatching a mutation", async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return convexSuccess({
          requested: 3,
          resolved: 2,
          resumeIds: ["current-2", "current-1"],
          targets: resolvedTargets,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/exact-reingest", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          dryRun: true,
          targets: [
            { referenceResumeId: "old-2", profileResumeId: "100002" },
            { referenceResumeId: "old-1", externalId: "external-1" },
            { referenceResumeId: "old-2-duplicate", currentResumeId: "current-2" },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(await parseJsonBody(response)).toEqual(expect.objectContaining({
        success: true,
        dryRun: true,
        manifestVersion: 1,
        expectedSkillsVersion: expect.any(Number),
        requested: 3,
        resolved: 2,
        scheduled: 0,
        batches: 0,
        resumeIds: ["current-2", "current-1"],
        targets: resolvedTargets,
      }));
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("/api/action");
      expect(requests[0].body).toEqual({
        path: "ingest_agent:resolveExactReingestTargets",
        args: {
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
          targets: [
            { referenceResumeId: "old-2", profileResumeId: "100002" },
            { referenceResumeId: "old-1", externalId: "external-1" },
            { referenceResumeId: "old-2-duplicate", currentResumeId: "current-2" },
          ],
        },
      });
    });

    it("dispatches only the fully resolved deduplicated ID set", async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = {
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        };
        requests.push(request);
        if (request.body.path === "ingest_agent:resolveExactReingestTargets") {
          return convexSuccess({
            requested: 3,
            resolved: 2,
            resumeIds: ["current-2", "current-1"],
            targets: resolvedTargets,
          });
        }
        return convexSuccess({
          requested: 2,
          resolved: 2,
          scheduled: 2,
          batches: 1,
          resumeIds: ["current-2", "current-1"],
          dispatchedAt: 1_750_000_000_000,
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/exact-reingest", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          targets: [
            { referenceResumeId: "old-2", profileResumeId: "100002" },
            { referenceResumeId: "old-1", externalId: "external-1" },
            { referenceResumeId: "old-2-duplicate", currentResumeId: "current-2" },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(await parseJsonBody(response)).toEqual(expect.objectContaining({
        success: true,
        dryRun: false,
        requested: 3,
        resolved: 2,
        scheduled: 2,
        batches: 1,
        dispatchedAt: 1_750_000_000_000,
        resumeIds: ["current-2", "current-1"],
        targets: resolvedTargets,
      }));
      expect(requests).toHaveLength(2);
      expect(requests[1].url).toContain("/api/mutation");
      expect(requests[1].body).toEqual({
        path: "ingest_agent:scheduleExactReingest",
        args: {
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
          resumeIds: ["current-2", "current-1"],
        },
      });
    });

    it("returns a validation error without scheduling when selectors conflict", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        convexError("Exact re-ingest target 1 selectors conflict: profileUrl and externalId resolve to different resumes"),
      );

      const app = createTestApp();
      const response = await app.request("/api/resumes/exact-reingest", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          targets: [{ profileUrl: "https://example.com/a", externalId: "external-b" }],
          dryRun: false,
        }),
      });

      expect(response.status).toBe(400);
      expect((await parseJsonBody(response)).error).toMatch(/selectors conflict/i);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("rejects non-admin access", async () => {
      const app = createTestApp();
      const response = await app.request("/api/resumes/exact-reingest", {
        method: "POST",
        headers: jsonHeaders({ "X-Workspace-Slug": "hr" }),
        body: JSON.stringify({ targets: [{ externalId: "external-1" }], dryRun: true }),
      });

      expect(response.status).toBe(403);
    });

    it("returns authenticated target readiness evidence", async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return convexSuccess({
          allReady: false,
          ready: 1,
          pending: 1,
          invalid: 0,
          checkedAt: 1_750_000_000_100,
          dispatchedAt: 1_750_000_000_000,
          expectedSkillsVersion: 3,
          targets: [
            {
              currentResumeId: "current-2",
              state: "ready",
              computedAt: 1_750_000_000_050,
              skillsVersion: 3,
              phase2FieldsPresent: true,
              reasons: [],
            },
            {
              currentResumeId: "current-1",
              state: "pending",
              computedAt: 1_749_999_999_999,
              skillsVersion: 2,
              phase2FieldsPresent: false,
              reasons: ["computed_before_dispatch", "skills_version_mismatch", "phase_2_fields_missing"],
            },
          ],
        });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/exact-reingest/readiness", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          resumeIds: ["current-2", "current-1"],
          dispatchedAt: 1_750_000_000_000,
          expectedSkillsVersion: 3,
        }),
      });

      expect(response.status).toBe(200);
      expect(await parseJsonBody(response)).toEqual(expect.objectContaining({
        success: true,
        allReady: false,
        ready: 1,
        pending: 1,
        invalid: 0,
      }));
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("/api/query");
      expect(requests[0].body).toEqual({
        path: "ingest_agent:getExactReingestReadiness",
        args: {
          workspaceSlug: "dev",
          writeSecret: config.auth.convexWriteSecret,
          resumeIds: ["current-2", "current-1"],
          dispatchedAt: 1_750_000_000_000,
          expectedSkillsVersion: 3,
        },
      });
    });
  });

  describe("POST /api/resumes/clear-analyses", () => {
    it("dry-run with jobDescriptionId returns targeted estimate", async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return convexSuccess({ cleared: 5, hasMore: false });
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/clear-analyses", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          jobDescriptionId: "jd-1",
          resumeIds: ["resume-1"],
          dryRun: true,
        }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody(response);
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.jobDescriptionId).toBe("jd-1");
      expect(payload.targeted).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toContain("/api/mutation");
      expect(requests[0].body).toMatchObject({
        path: "resumes_mutations:clearAnalyses",
        args: {
          batchSize: 50,
          jobDescriptionId: "jd-1",
          resumeIds: ["resume-1"],
          dryRun: true,
        },
      });
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
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      const pages = [
        {
          tableName: "collection_tasks",
          count: 50,
          nextTableIndex: 0,
          cursor: "collection-tasks-next",
          done: false,
        },
        {
          tableName: "collection_tasks",
          count: 10,
          nextTableIndex: 1,
          cursor: null,
          done: false,
        },
        {
          tableName: "resume_digests",
          count: 2,
          nextTableIndex: 11,
          cursor: null,
          done: true,
        },
      ];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(init?.body as string) as Record<string, unknown>,
        });
        return convexSuccess(pages[requests.length - 1]);
      });

      const app = createTestApp();
      const response = await app.request("/api/resumes/reset-database", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ dryRun: true }),
      });

      expect(response.status).toBe(200);
      const payload = await parseJsonBody<{ success: boolean; dryRun: boolean; wouldDelete: Record<string, unknown> }>(response);
      expect(payload.success).toBe(true);
      expect(payload.dryRun).toBe(true);
      expect(payload.wouldDelete.collection_tasks).toBe(60);
      expect(payload.wouldDelete.resume_digests).toBe(2);
      expect(requests).toHaveLength(3);
      expect(requests[0].url).toContain("/api/query");
      expect(requests[0].body).toMatchObject({
        path: "resume_tasks:previewResetDatabase",
        args: { tableIndex: 0 },
      });
      expect(requests[1].body).toMatchObject({
        path: "resume_tasks:previewResetDatabase",
        args: { tableIndex: 0, cursor: "collection-tasks-next" },
      });
      expect(requests[2].body).toMatchObject({
        path: "resume_tasks:previewResetDatabase",
        args: { tableIndex: 1 },
      });
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
      const payload = await parseJsonBody(response);
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
      const payload = await parseJsonBody(response);
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
      const payload = await parseJsonBody(response);
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
      const payload = await parseJsonBody(response);
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
      const payload = await parseJsonBody(response);
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
      const payload = await parseJsonBody<{ success: boolean; notified: boolean; channels: Record<string, unknown>[] }>(response);
      expect(payload.success).toBe(true);
      expect(payload.notified).toBe(true);
      expect(payload.channels).toHaveLength(1);
      expect(payload.channels[0].channel).toBe("feishu");
      expect(payload.channels[0].success).toBe(true);
    });
  });
});
