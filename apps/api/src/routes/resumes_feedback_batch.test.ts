import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import resumesFeedbackBatchRoutes from "./resumes_feedback_batch.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { ActionStorage } from "../services/action-storage.js";
import type { AuthStorage } from "../services/auth-storage.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { createAuthHeaders } from "./test-auth-helpers.js";
import { parseJsonBody } from "../test-utils.js";
import { callConvexQuery } from "../services/convex-utils.js";

vi.mock("../services/convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
}));

function createTestApp(options: { storage?: AuthStorage } = {}) {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  const middleware = createAuthMiddleware({
    storage: options.storage,
    ttlSeconds: 3600,
  });
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/", resumesFeedbackBatchRoutes);
  return app;
}

describe("resume feedback batch routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(callConvexQuery).mockReset();
    resetResumeScreeningDb();
  });

  it("rejects anonymous batch feedback imports", async () => {
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction");
    const app = createTestApp();

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        items: [{ resumeId: "r1", name: "Alice", comments: "Good" }],
      }),
    });

    expect(response.status).toBe(401);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("imports notes, skips empty comments, and reports missing resume ids without failing the batch", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const validResumeId = "k976q0n1pse4dsfker1sk15rz9897m8v";
    const missingResumeId = "k97bhpvr61nghwfev4wn16qeps897y61";
    const emptyCommentResumeId = "k97bbw6m3f8jaz5hrk7ahc59q5897kqh";
    vi.mocked(callConvexQuery).mockResolvedValue([
      { resumeId: validResumeId, resume: { name: "Alice" } },
      { resumeId: emptyCommentResumeId, resume: { name: "Carol" } },
    ]);
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction").mockImplementation((params) => ({
      id: params.resumeId === validResumeId ? 101 : 102,
      userId: params.userId,
      sessionId: params.sessionId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData: params.actionData,
      createdAt: "2026-07-09T00:00:00+08:00",
    }));
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          { resumeId: validResumeId, name: "Alice", comments: "半导体，行业不匹配" },
          { resumeId: missingResumeId, name: "Missing", comments: "宝力离职销售" },
          { resumeId: emptyCommentResumeId, name: "Carol", comments: "   " },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(callConvexQuery).toHaveBeenCalledWith("resumes:getByIdsForExport", {
      resumeIds: [validResumeId, missingResumeId],
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      userId: auth.userId,
      resumeId: validResumeId,
      actionType: "note",
      actionData: {
        text: "半导体，行业不匹配",
        context: "hr_feedback",
        sourceName: "Alice",
        importedAt: expect.any(String),
      },
    });

    const body = await parseJsonBody<{
      success: boolean;
      total: number;
      imported: number;
      skipped: number;
      notFound: string[];
      results: Array<{ resumeId: string; status: string }>;
    }>(response);
    expect(body).toMatchObject({
      success: true,
      total: 3,
      imported: 1,
      skipped: 1,
      notFound: [missingResumeId],
      results: [
        { resumeId: validResumeId, status: "imported" },
        { resumeId: missingResumeId, status: "notFound" },
        { resumeId: emptyCommentResumeId, status: "skipped" },
      ],
    });
  });

  it("treats malformed resume ids as not found without sending them to Convex", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const validResumeId = "k976q0n1pse4dsfker1sk15rz9897m8v";
    vi.mocked(callConvexQuery).mockResolvedValue([
      { resumeId: validResumeId, resume: { name: "Alice" } },
    ]);
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction").mockImplementation((params) => ({
      id: 201,
      userId: params.userId,
      sessionId: params.sessionId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData: params.actionData,
      createdAt: "2026-07-09T00:00:00+08:00",
    }));
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          { resumeId: validResumeId, name: "Alice", comments: "Good" },
          { resumeId: "8874439", name: "External", comments: "External id pasted" },
          { resumeId: "missing-with-empty-comment", name: "Empty", comments: "   " },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(callConvexQuery).toHaveBeenCalledWith("resumes:getByIdsForExport", {
      resumeIds: [validResumeId],
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);

    const body = await parseJsonBody<{
      success: boolean;
      imported: number;
      skipped: number;
      notFound: string[];
      results: Array<{ resumeId: string; status: string; reason?: string }>;
    }>(response);
    expect(body).toMatchObject({
      success: true,
      imported: 1,
      skipped: 1,
      notFound: ["8874439"],
      results: [
        { resumeId: validResumeId, status: "imported" },
        { resumeId: "8874439", status: "notFound", reason: "resume_not_found" },
        { resumeId: "missing-with-empty-comment", status: "skipped", reason: "empty_comments" },
      ],
    });
  });
});
