import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "summaries-route-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "notifications"), { recursive: true });
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
  fs.writeFileSync(
    path.join(root, "config", "notifications", "summary-daily.md"),
    [
      "---",
      'subject: "{{summaryTitle}} {{workspaceSlug}}"',
      "---",
      "",
      "# {{summaryTitle}}",
      "",
      "- Workspace: {{workspaceSlug}}",
      "- Period: {{period}}",
      "- Generated: {{generatedAt}}",
      "",
      "{{#if scopes.sharedIngest}}",
      "## Shared Ingest Totals",
      "- New resumes: {{scopes.sharedIngest.totals.newResumes}}",
      "- Collection tasks completed: {{scopes.sharedIngest.totals.collectionTasksCompleted}}",
      "- Collection tasks failed: {{scopes.sharedIngest.totals.collectionTasksFailed}}",
      "{{/if}}",
      "",
      "{{#if scopes.workspaceActivity}}",
      "## Workspace Activity",
      "- Candidate status updates: {{scopes.workspaceActivity.totals.candidateStatusUpdates}}",
      "- Shortlist actions: {{scopes.workspaceActivity.totals.shortlistActions}}",
      "- Reject actions: {{scopes.workspaceActivity.totals.rejectActions}}",
      "- Contact actions: {{scopes.workspaceActivity.totals.contactActions}}",
      "{{/if}}",
      "",
      "{{#if scopes.workspaceActivity.breakdowns.actionsByType}}",
      "## Candidate Actions",
      "{{#each scopes.workspaceActivity.breakdowns.actionsByType}}",
      "- {{this.label}}: {{this.count}}",
      "{{/each}}",
      "{{/if}}",
      "",
      "{{#if comparison}}",
      "## Previous Period Comparison",
      "- Previous Window Start: {{comparison.previousWindow.startAt}}",
      "- Previous Window End: {{comparison.previousWindow.endAt}}",
      "{{/if}}",
      "",
      "_Generated at {{timestamp}}_",
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
  const { summaryTelegramBridge } = await import("../services/summaries/summary-telegram-bridge");
  const { resetResumeScreeningDb } = await import("../services/database");
  return {
    createApp,
    SessionManager,
    ActionStorage,
    ReviewPacketStorage,
    summaryTelegramBridge,
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
        comparison?: {
          previousWindow: {
            startAt: string;
            endAt: string;
          };
          totalsDelta: {
            sharedIngest: {
              newResumes: number;
            };
          };
        };
        totals: Record<string, number>;
        scopes?: {
          sharedIngest: {
            totals: Record<string, number>;
          };
          workspaceActivity: {
            totals: Record<string, number>;
            breakdowns: {
              actionsByType: Array<{ key: string; count: number }>;
            };
          };
        };
        breakdowns: {
          actionsByType: Array<{ key: string; count: number }>;
        };
      };
      markdown: string;
      run: {
        period: string;
        status: string;
        triggerSource: string;
        dryRun: boolean;
      };
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
    expect(payload.report.scopes?.sharedIngest.totals).toMatchObject({
      newResumes: 4,
      collectionTasksCompleted: 1,
      collectionTasksFailed: 1,
    });
    expect(payload.report.scopes?.workspaceActivity.totals).toMatchObject({
      candidateStatusUpdates: 2,
      shortlistActions: 1,
      rejectActions: 1,
      contactActions: 1,
    });
    expect(payload.report.breakdowns.actionsByType).toEqual([
      { key: "contact", label: "Contact", count: 1 },
      { key: "reject", label: "Reject", count: 1 },
      { key: "shortlist", label: "Shortlist", count: 1 },
    ]);
    expect(payload.report.scopes?.workspaceActivity.breakdowns.actionsByType).toEqual([
      { key: "contact", label: "Contact", count: 1 },
      { key: "reject", label: "Reject", count: 1 },
      { key: "shortlist", label: "Shortlist", count: 1 },
    ]);
    expect(payload.markdown).toContain("## Shared Ingest Totals");
    expect(payload.markdown).toContain("## Workspace Activity");
    expect(payload.markdown).toContain("## Previous Period Comparison");
    expect(payload.report.comparison?.totalsDelta.sharedIngest.newResumes).toBe(0);
    expect(payload.run).toMatchObject({
      period: "daily",
      status: "previewed",
      triggerSource: "api_preview",
      dryRun: true,
    });
    expect(calls).toHaveLength(6);
    expect(calls.filter((call) => call.pathName === "resumes:getSummaryWindow")).toHaveLength(2);
    expect(calls.filter((call) => call.pathName === "candidate_status:list")).toHaveLength(2);
    expect(calls.filter((call) => call.pathName === "resume_tasks:getSummaryWindow")).toHaveLength(2);
    expect(
      calls
        .filter((call) => call.pathName === "candidate_status:list")
        .every((call) => call.args.workspaceSlug === "hr"),
    ).toBe(true);
  });

  it("supports summary run dry-runs without sending", async () => {
    root = createFixtureRoot();
    const {
      createApp,
      SessionManager,
      ActionStorage,
    } = await loadSummaryModules(root);

    const sessionManager = new SessionManager(root);
    const actionStorage = new ActionStorage(root);
    const session = sessionManager.createSession({ workspaceSlug: "hr" });
    actionStorage.saveAction({ sessionId: session.id, resumeId: "resume-1", actionType: "shortlist" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getSummaryWindow") {
        return convexSuccess({ total: 1, bySource: [{ key: "seek", count: 1 }] });
      }
      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }
      if (call.pathName === "resume_tasks:getSummaryWindow") {
        return convexSuccess({ total: 0, byStatus: [] });
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/summaries/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        period: "daily",
        channel: "wechat_work",
        dryRun: true,
        endAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      dryRun: boolean;
      templateId: string;
      subject?: string;
      content: string;
      delivery?: unknown;
      run: {
        status: string;
        triggerSource: string;
        dryRun: boolean;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.dryRun).toBe(true);
    expect(payload.templateId).toBe("summary-daily");
    expect(payload.subject).toBe("Daily Ops Summary hr");
    expect(payload.content).toContain("## Shared Ingest Totals");
    expect(payload.content).toContain("## Workspace Activity");
    expect(payload.content).toContain("## Previous Period Comparison");
    expect(payload.delivery).toBeUndefined();
    expect(payload.run).toMatchObject({
      status: "dry_run",
      triggerSource: "api_manual",
      dryRun: true,
    });
  });

  it("routes telegram summary sends through the bridge", async () => {
    root = createFixtureRoot();
    const {
      createApp,
      SessionManager,
      ActionStorage,
      summaryTelegramBridge,
    } = await loadSummaryModules(root);

    const sessionManager = new SessionManager(root);
    const actionStorage = new ActionStorage(root);
    const session = sessionManager.createSession({ workspaceSlug: "hr" });
    actionStorage.saveAction({ sessionId: session.id, resumeId: "resume-1", actionType: "contact" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getSummaryWindow") {
        return convexSuccess({ total: 2, bySource: [{ key: "job5156", count: 2 }] });
      }
      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }
      if (call.pathName === "resume_tasks:getSummaryWindow") {
        return convexSuccess({ total: 1, byStatus: [{ key: "completed", count: 1 }] });
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const sendSpy = vi.spyOn(summaryTelegramBridge, "send").mockResolvedValue({
      ok: true,
      channel: "telegram",
      accountsConfigured: 1,
      accountsSelected: 1,
      accountsAttempted: 1,
      accountsSent: 1,
      batchCountPerAccount: 2,
      totalBatches: 2,
      batchSizes: [3800, 240],
      maxBytesPerBatch: 4000,
      usedOverrideBotToken: false,
      usedOverrideChatId: false,
      accounts: [
        {
          index: 1,
          chatIdHint: "***1234",
          attempted: true,
          sent: true,
          batchesPlanned: 2,
        },
      ],
    });

    const app = createApp();
    const response = await app.request("/api/summaries/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        period: "daily",
        channel: "telegram",
        endAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      channel: string;
      dryRun: boolean;
      delivery: {
        ok: boolean;
        channel: string;
        accountsConfigured: number;
        accountsSelected: number;
        accountsAttempted: number;
        accountsSent: number;
        batchCountPerAccount: number;
        totalBatches: number;
        batchSizes: number[];
        maxBytesPerBatch: number;
        usedOverrideBotToken: boolean;
        usedOverrideChatId: boolean;
        accounts: Array<{
          index: number;
          chatIdHint: string;
          attempted: boolean;
          sent: boolean;
          batchesPlanned: number;
        }>;
      };
      report: {
        scopes?: {
          sharedIngest: {
            totals: {
              newResumes: number;
            };
          };
          workspaceActivity: {
            totals: {
              contactActions: number;
            };
          };
        };
      };
      run: {
        status: string;
        triggerSource: string;
        dryRun: boolean;
      };
    };
    expect(payload.success).toBe(true);
    expect(payload.channel).toBe("telegram");
    expect(payload.dryRun).toBe(false);
    expect(payload.delivery).toEqual({
      ok: true,
      channel: "telegram",
      accountsConfigured: 1,
      accountsSelected: 1,
      accountsAttempted: 1,
      accountsSent: 1,
      batchCountPerAccount: 2,
      totalBatches: 2,
      batchSizes: [3800, 240],
      maxBytesPerBatch: 4000,
      usedOverrideBotToken: false,
      usedOverrideChatId: false,
      accounts: [
        {
          index: 1,
          chatIdHint: "***1234",
          attempted: true,
          sent: true,
          batchesPlanned: 2,
        },
      ],
    });
    expect(payload.report.scopes?.sharedIngest.totals.newResumes).toBe(2);
    expect(payload.report.scopes?.workspaceActivity.totals.contactActions).toBe(1);
    expect(payload.run).toMatchObject({
      status: "sent",
      triggerSource: "api_manual",
      dryRun: false,
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0].content).toContain("# Daily Ops Summary");
  });

  it("supports weekly previews and persists the weekly run period", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadSummaryModules(root);

    const currentWeekStart = Date.parse("2026-03-22T16:00:00.000Z");
    const previousWeekStart = Date.parse("2026-03-15T16:00:00.000Z");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getSummaryWindow") {
        if (call.args.fromTimestamp === currentWeekStart) {
          return convexSuccess({ total: 7, bySource: [{ key: "seek", count: 7 }] });
        }
        if (call.args.fromTimestamp === previousWeekStart) {
          return convexSuccess({ total: 3, bySource: [{ key: "job5156", count: 3 }] });
        }
      }

      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }

      if (call.pathName === "resume_tasks:getSummaryWindow") {
        if (call.args.fromTimestamp === currentWeekStart) {
          return convexSuccess({
            total: 2,
            byStatus: [
              { key: "completed", count: 1 },
              { key: "failed", count: 1 },
            ],
          });
        }
        if (call.args.fromTimestamp === previousWeekStart) {
          return convexSuccess({
            total: 1,
            byStatus: [{ key: "completed", count: 1 }],
          });
        }
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
        period: "weekly",
        endAt: "2026-03-26T04:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      report: {
        period: string;
        window: {
          startAt: string;
          endAt: string;
          timezone: string;
        };
        comparison?: {
          previousWindow: {
            startAt: string;
            endAt: string;
            timezone: string;
          };
          totalsDelta: {
            sharedIngest: {
              newResumes: number;
              collectionTasksCompleted: number;
              collectionTasksFailed: number;
            };
          };
        };
      };
      markdown: string;
      run: {
        period: string;
      };
    };

    expect(payload.report.period).toBe("weekly");
    expect(payload.report.window).toEqual({
      startAt: "2026-03-23T00:00:00+08:00",
      endAt: "2026-03-30T00:00:00+08:00",
      timezone: "Asia/Hong_Kong",
    });
    expect(payload.report.comparison).toMatchObject({
      previousWindow: {
        startAt: "2026-03-16T00:00:00+08:00",
        endAt: "2026-03-23T00:00:00+08:00",
        timezone: "Asia/Hong_Kong",
      },
      totalsDelta: {
        sharedIngest: {
          newResumes: 4,
          collectionTasksCompleted: 0,
          collectionTasksFailed: 1,
        },
      },
    });
    expect(payload.markdown).toContain("# Weekly Ops Summary");
    expect(payload.run.period).toBe("weekly");
  });

  it("lists and fetches persisted summary runs for the active workspace", async () => {
    root = createFixtureRoot();
    const {
      createApp,
      SessionManager,
      ActionStorage,
    } = await loadSummaryModules(root);

    const sessionManager = new SessionManager(root);
    const actionStorage = new ActionStorage(root);
    const hrSession = sessionManager.createSession({ workspaceSlug: "hr" });
    const otherSession = sessionManager.createSession({ workspaceSlug: "dev" });
    actionStorage.saveAction({ sessionId: hrSession.id, resumeId: "resume-1", actionType: "shortlist" });
    actionStorage.saveAction({ sessionId: otherSession.id, resumeId: "resume-9", actionType: "reject" });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.pathName === "resumes:getSummaryWindow") {
        return convexSuccess({ total: 1, bySource: [{ key: "seek", count: 1 }] });
      }
      if (call.pathName === "candidate_status:list") {
        return convexSuccess([]);
      }
      if (call.pathName === "resume_tasks:getSummaryWindow") {
        return convexSuccess({ total: 0, byStatus: [] });
      }
      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const previewResponse = await app.request("/api/summaries/preview", {
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
    const previewPayload = await previewResponse.json() as {
      run: { id: string };
    };

    const runResponse = await app.request("/api/summaries/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        period: "daily",
        channel: "telegram",
        dryRun: true,
        endAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    const runPayload = await runResponse.json() as {
      run: { id: string };
    };

    await app.request("/api/summaries/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        period: "daily",
        endAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });

    const listResponse = await app.request("/api/summaries/runs?limit=10", {
      method: "GET",
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json() as {
      success: boolean;
      items: Array<{ id: string; workspaceSlug: string; status: string }>;
    };
    expect(listPayload.success).toBe(true);
    expect(listPayload.items).toHaveLength(2);
    expect(listPayload.items.map((item) => item.id).sort()).toEqual([
      previewPayload.run.id,
      runPayload.run.id,
    ].sort());
    expect(listPayload.items.every((item) => item.workspaceSlug === "hr")).toBe(true);
    expect(listPayload.items.every((item) => item.period === "daily")).toBe(true);

    const detailResponse = await app.request(`/api/summaries/runs/${runPayload.run.id}`, {
      method: "GET",
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });
    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json() as {
      success: boolean;
      item: { id: string; status: string; workspaceSlug: string };
    };
    expect(detailPayload).toMatchObject({
      success: true,
      item: {
        id: runPayload.run.id,
        status: "dry_run",
        workspaceSlug: "hr",
      },
    });

    const missingResponse = await app.request(`/api/summaries/runs/${previewPayload.run.id}`, {
      method: "GET",
      headers: {
        "X-Workspace-Slug": "dev",
      },
    });
    expect(missingResponse.status).toBe(404);
  });
});
