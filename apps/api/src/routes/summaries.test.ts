import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summaries-route-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    [
      "---",
      "version: 1",
      'updated_at: "2026-03-26"',
      "---",
      "",
      "## Company Patterns",
      "",
      "### fanuc",
      "- aliases: FANUC, 发那科",
      "- tier: 1",
      "",
    ].join("\n"),
    "utf8"
  );
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: RequestInfo | URL, init?: RequestInit): {
  pathName: string;
  args: Record<string, unknown>;
} {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  if (!requestUrl.includes("/api/query")) {
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

async function loadSummaryModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../app");
  const { SessionManager } = await import("../services/session-manager");
  const { ActionStorage } = await import("../services/action-storage");
  const { ReviewPacketStorage } = await import("../services/review-packet-storage");
  const { resetResumeScreeningDb } = await import("../services/database");
  return {
    createApp,
    SessionManager,
    ActionStorage,
    ReviewPacketStorage,
    resetResumeScreeningDb,
  };
}

describe("summary preview route", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PROJECT_ROOT;
    if (root) {
      const { resetResumeScreeningDb } = await import("../services/database");
      resetResumeScreeningDb();
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("builds a preview from workspace-scoped actions and Convex summary queries", async () => {
    root = createFixtureRoot();
    const {
      createApp,
      SessionManager,
      ActionStorage,
      ReviewPacketStorage,
    } = await loadSummaryModules(root);

    const sessionManager = new SessionManager(root);
    const actionStorage = new ActionStorage(root);
    const reviewPacketStorage = new ReviewPacketStorage(root);
    const session = sessionManager.createSession({ workspaceSlug: "hr" });
    reviewPacketStorage.createRun({
      id: "packet-1",
      workspaceSlug: "hr",
      source: "convex",
      format: "csv",
      totalCount: 0,
      items: [],
    });

    actionStorage.saveAction({ sessionId: session.id, resumeId: "resume-1", actionType: "shortlist" });
    actionStorage.saveAction({ sessionId: session.id, resumeId: "resume-2", actionType: "contact" });
    actionStorage.saveAction({ sessionId: "review-packet:packet-1", resumeId: "resume-3", actionType: "reject" });

    const calls: Array<{ pathName: string; args: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);

      if (call.pathName === "resumes:getSummaryWindow") {
        return convexSuccess({
          total: 4,
          bySource: [
            { key: "seek", count: 2 },
            { key: "job5156", count: 2 },
          ],
        });
      }

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([
          { status: "interviewing", updatedAt: Date.now() - 60_000 },
          { status: "offer", updatedAt: Date.now() - 120_000 },
          { status: "offer", updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 },
        ]);
      }

      if (call.pathName === "resume_tasks:getSummaryWindow") {
        return convexSuccess({
          total: 2,
          byStatus: [
            { key: "completed", count: 1 },
            { key: "failed", count: 1 },
          ],
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/summaries/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        period: "daily",
        endAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      report: {
        workspaceSlug: string;
        totals: Record<string, number>;
        breakdowns: {
          actionsByType: Array<{ key: string; count: number }>;
        };
      };
      markdown: string;
    };

    expect(payload.success).toBe(true);
    expect(payload.report.workspaceSlug).toBe("hr");
    expect(payload.report.totals).toMatchObject({
      newResumes: 4,
      candidateStatusUpdates: 2,
      shortlistActions: 1,
      rejectActions: 1,
      contactActions: 1,
      collectionTasksCompleted: 1,
      collectionTasksFailed: 1,
    });
    expect(payload.report.breakdowns.actionsByType).toEqual([
      { key: "contact", label: "Contact", count: 1 },
      { key: "reject", label: "Reject", count: 1 },
      { key: "shortlist", label: "Shortlist", count: 1 },
    ]);
    expect(payload.markdown).toContain("# Daily Ops Summary");
    expect(calls.map((call) => call.pathName)).toEqual([
      "resumes:getSummaryWindow",
      "candidate_status:list",
      "resume_tasks:getSummaryWindow",
    ]);
    expect(calls[1]?.args.workspaceSlug).toBe("hr");
  });
});
