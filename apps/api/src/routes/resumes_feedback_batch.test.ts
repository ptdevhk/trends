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
import { config } from "../services/config.js";
import { callConvexMutation, callConvexQuery } from "../services/convex-utils.js";

vi.mock("../services/convex-utils.js", () => ({
  callConvexMutation: vi.fn(),
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
    vi.mocked(callConvexMutation).mockReset();
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
    vi.mocked(callConvexMutation).mockResolvedValue({
      requested: 2,
      applied: 1,
      unchanged: 0,
      notFound: 1,
      skipped: 0,
      results: [
        { resumeId: validResumeId, identityKey: "profileUrl:alice", outcome: "applied" },
        { resumeId: missingResumeId, outcome: "notFound", reason: "resume_not_found" },
      ],
    });
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
    expect(callConvexMutation).toHaveBeenCalledWith("candidate_status:importNotesBatch", {
      workspaceSlug: "hr",
      items: [
        { resumeId: validResumeId, comments: "半导体，行业不匹配" },
        { resumeId: missingResumeId, comments: "宝力离职销售" },
      ],
      updatedBy: auth.userId,
      writeSecret: config.auth.convexWriteSecret,
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      userId: auth.userId,
      resumeId: validResumeId,
      actionType: "note",
      actionData: {
        text: "半导体，行业不匹配",
        context: "hr_feedback",
        workspaceSlug: "hr",
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

  it("passes raw resume ids to Convex and maps per-row not-found outcomes", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const validResumeId = "k976q0n1pse4dsfker1sk15rz9897m8v";
    vi.mocked(callConvexMutation).mockResolvedValue({
      requested: 2,
      applied: 1,
      unchanged: 0,
      notFound: 1,
      skipped: 0,
      results: [
        { resumeId: validResumeId, identityKey: "profileUrl:alice", outcome: "applied" },
        { resumeId: "8874439", outcome: "notFound", reason: "resume_not_found" },
      ],
    });
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
    expect(callConvexMutation).toHaveBeenCalledWith("candidate_status:importNotesBatch", {
      workspaceSlug: "hr",
      items: [
        { resumeId: validResumeId, comments: "Good" },
        { resumeId: "8874439", comments: "External id pasted" },
      ],
      updatedBy: auth.userId,
      writeSecret: config.auth.convexWriteSecret,
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

  it("uses the last nonempty duplicate while preserving original row outcomes", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const resumeId = "k976q0n1pse4dsfker1sk15rz9897m8v";
    vi.mocked(callConvexMutation).mockResolvedValue({
      requested: 1,
      applied: 1,
      unchanged: 0,
      notFound: 0,
      skipped: 0,
      results: [{ resumeId, identityKey: "profileUrl:alice", outcome: "applied" }],
    });
    vi.mocked(callConvexQuery).mockResolvedValue([{ resumeId, resume: { name: "Alice" } }]);
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction").mockImplementation((params) => ({
      id: 301,
      userId: params.userId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData: params.actionData,
      createdAt: "2026-07-09T00:00:00+08:00",
    }));
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { resumeId, name: "First", comments: "First note" },
          { resumeId, name: "Final", comments: "Final note" },
          { resumeId, name: "Empty", comments: "   " },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(callConvexMutation).toHaveBeenCalledWith("candidate_status:importNotesBatch", expect.objectContaining({
      items: [{ resumeId, comments: "Final note" }],
    }));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      resumeId,
      actionData: expect.objectContaining({ text: "Final note", sourceName: "Final" }),
    }));
    const body = await parseJsonBody<{
      imported: number;
      skipped: number;
      results: Array<{ status: string; reason?: string; comments: string }>;
    }>(response);
    expect(body).toMatchObject({ imported: 1, skipped: 2 });
    expect(body.results).toEqual([
      expect.objectContaining({ status: "skipped", reason: "superseded_by_later_duplicate", comments: "First note" }),
      expect.objectContaining({ status: "imported", comments: "Final note" }),
      expect.objectContaining({ status: "skipped", reason: "empty_comments", comments: "" }),
    ]);
  });

  it("chunks unique note imports at 100 items", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const items = Array.from({ length: 101 }, (_, index) => ({
      resumeId: `k${String(index).padStart(31, "0")}`,
      name: `Candidate ${index}`,
      comments: `Note ${index}`,
    }));
    vi.mocked(callConvexMutation).mockImplementation(async (_pathName, args) => {
      const batch = args.items as Array<{ resumeId: string }>;
      return {
        requested: batch.length,
        applied: batch.length,
        unchanged: 0,
        notFound: 0,
        skipped: 0,
        results: batch.map((item) => ({
          resumeId: item.resumeId,
          identityKey: `identity:${item.resumeId}`,
          outcome: "applied",
        })),
      };
    });
    vi.mocked(callConvexQuery).mockResolvedValue(items.map((item) => ({
      resumeId: item.resumeId,
      resume: { name: item.name },
    })));
    vi.spyOn(ActionStorage.prototype, "saveAction").mockImplementation((params) => ({
      id: Number(params.resumeId.slice(1)) + 1,
      userId: params.userId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData: params.actionData,
      createdAt: "2026-07-09T00:00:00+08:00",
    }));
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    expect(response.status).toBe(200);
    expect(callConvexMutation).toHaveBeenCalledTimes(2);
    expect((vi.mocked(callConvexMutation).mock.calls[0][1].items as unknown[])).toHaveLength(100);
    expect((vi.mocked(callConvexMutation).mock.calls[1][1].items as unknown[])).toHaveLength(1);
    for (const [, args] of vi.mocked(callConvexMutation).mock.calls) {
      expect(args).toMatchObject({
        workspaceSlug: "hr",
        updatedBy: auth.userId,
        writeSecret: config.auth.convexWriteSecret,
      });
    }
    const body = await parseJsonBody<{ imported: number; results: unknown[] }>(response);
    expect(body.imported).toBe(101);
    expect(body.results).toHaveLength(101);
  });

  it("does not create another SQLite action when the durable note is unchanged", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const resumeId = "k976q0n1pse4dsfker1sk15rz9897m8v";
    vi.mocked(callConvexMutation).mockResolvedValue({
      requested: 1,
      applied: 0,
      unchanged: 1,
      notFound: 0,
      skipped: 0,
      results: [{ resumeId, identityKey: "profileUrl:alice", outcome: "unchanged" }],
    });
    vi.mocked(callConvexQuery).mockResolvedValue([{ resumeId, resume: { name: "Alice" } }]);
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction");
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ resumeId, comments: "Same note" }] }),
    });

    expect(response.status).toBe(200);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      imported: 0,
      skipped: 1,
      results: [{ resumeId, status: "skipped", reason: "unchanged" }],
    });
  });

  it("writes no SQLite action when the durable Convex mutation fails", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const events: string[] = [];
    vi.mocked(callConvexMutation).mockImplementation(async () => {
      events.push("convex-failed");
      throw new Error("Convex unavailable");
    });
    vi.mocked(callConvexQuery).mockResolvedValue([{
      resumeId: "k976q0n1pse4dsfker1sk15rz9897m8v",
      resume: { name: "Alice" },
    }]);
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction").mockImplementation((params) => {
      events.push("sqlite");
      return {
        id: 401,
        userId: params.userId,
        resumeId: params.resumeId,
        actionType: params.actionType,
        actionData: params.actionData,
        createdAt: "2026-07-09T00:00:00+08:00",
      };
    });
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ resumeId: "k976q0n1pse4dsfker1sk15rz9897m8v", comments: "Durable first" }],
      }),
    });

    expect(response.status).toBe(500);
    expect(events).toEqual(["convex-failed"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("defers every SQLite action until all Convex chunks succeed", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const items = Array.from({ length: 101 }, (_, index) => ({
      resumeId: `k${String(index).padStart(31, "0")}`,
      comments: `Note ${index}`,
    }));
    vi.mocked(callConvexMutation)
      .mockImplementationOnce(async (_pathName, args) => {
        const batch = args.items as Array<{ resumeId: string }>;
        return {
          requested: batch.length,
          applied: batch.length,
          unchanged: 0,
          notFound: 0,
          skipped: 0,
          results: batch.map((item) => ({
            resumeId: item.resumeId,
            identityKey: `identity:${item.resumeId}`,
            outcome: "applied",
          })),
        };
      })
      .mockRejectedValueOnce(new Error("second chunk failed"));
    const saveSpy = vi.spyOn(ActionStorage.prototype, "saveAction");
    const app = createTestApp({ storage: auth.storage });

    const response = await app.request("/api/resumes/feedback-batch", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    expect(response.status).toBe(500);
    expect(callConvexMutation).toHaveBeenCalledTimes(2);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
