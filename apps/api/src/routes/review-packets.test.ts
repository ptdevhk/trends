import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Papa from "papaparse";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResumeItem } from "../types/resume";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-packets-route-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    [
      "---",
      "version: 1",
      'updated_at: "2026-03-20"',
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

function buildSampleResume(overrides: Partial<ResumeItem> & { resumeId: string; name: string }): ResumeItem {
  return {
    resumeId: overrides.resumeId,
    name: overrides.name,
    profileUrl: overrides.profileUrl ?? `https://example.com/${overrides.resumeId}`,
    activityStatus: overrides.activityStatus ?? "Active",
    age: overrides.age ?? "30",
    experience: overrides.experience ?? "5 years",
    education: overrides.education ?? "Bachelor",
    location: overrides.location ?? "Dongguan",
    selfIntro: overrides.selfIntro ?? "Test intro",
    jobIntention: overrides.jobIntention ?? "Sales Engineer",
    expectedSalary: overrides.expectedSalary ?? "10k-20k",
    workHistory: overrides.workHistory ?? [{ raw: "Test work history" }],
    extractedAt: overrides.extractedAt ?? "2026-03-01T00:00:00.000Z",
    ingestData: overrides.ingestData,
    perUserId: overrides.perUserId,
    profileId: overrides.profileId,
    profileType: overrides.profileType,
    externalId: overrides.externalId,
    profileEducation: overrides.profileEducation,
    skills: overrides.skills,
    languages: overrides.languages,
    licences: overrides.licences,
    resumeSnippet: overrides.resumeSnippet,
    currentIndustry: overrides.currentIndustry,
    currentSubindustry: overrides.currentSubindustry,
    rightToWork: overrides.rightToWork,
    digitalIdentity: overrides.digitalIdentity,
    noticePeriodDays: overrides.noticePeriodDays,
  };
}

async function loadReviewPacketModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../app");
  const { ResumeService } = await import("../services/resume-service");
  const { ReviewPacketStorage } = await import("../services/review-packet-storage");
  const { ActionStorage } = await import("../services/action-storage");
  const { resetResumeScreeningDb } = await import("../services/database");
  const { notificationService } = await import("../services/notification-service");
  return {
    createApp,
    ResumeService,
    ReviewPacketStorage,
    ActionStorage,
    resetResumeScreeningDb,
    notificationService,
  };
}

describe("review packet routes", () => {
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

  it("creates a tracked packet run and downloads HR-friendly packet headers", async () => {
    root = createFixtureRoot();
    const { createApp, ResumeService, ReviewPacketStorage } = await loadReviewPacketModules(root);

    vi.spyOn(ResumeService.prototype, "loadSample").mockReturnValue({
      items: [
        buildSampleResume({ resumeId: "resume-a", name: "Alice" }),
        buildSampleResume({ resumeId: "resume-b", name: "Bob" }),
      ],
      sample: {
        name: "sample-test",
        filename: "sample-test.json",
        updatedAt: "2026-03-01T00:00:00.000Z",
        size: 1,
      },
      metadata: undefined,
      indexes: new Map(),
    });

    const app = createApp();
    const response = await app.request("/api/resumes/review-packets/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({
        format: "csv",
        source: "sample",
        sample: "sample-test",
        jobDescriptionId: "lathe-sales",
        entries: [
          { resumeId: "resume-b", status: "contacted", userComment: "Call Bob" },
          { resumeId: "resume-a", status: "new" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      run: { id: string; jobDescriptionId?: string };
      downloadPath: string;
    };

    expect(payload.success).toBe(true);
    expect(payload.run.jobDescriptionId).toBe("lathe-sales");

    const storage = new ReviewPacketStorage(root);
    const stored = storage.getRun(payload.run.id, "dev");
    expect(stored?.items.map((item) => item.resumeId)).toEqual(["resume-b", "resume-a"]);

    const download = await app.request(`${payload.downloadPath}?workspaceSlug=dev`);
    expect(download.status).toBe(200);
    const parsed = Papa.parse<Record<string, string>>(await download.text(), { header: true });
    expect(parsed.meta.fields).toContain("Resume ID");
    expect(parsed.meta.fields).toContain("Packet Run ID");
    expect(parsed.meta.fields?.slice(-4)).toEqual(["Status", "Action", "User Comment", "Reference Note"]);
    expect(parsed.data[0]?.["Resume ID"]).toBe("resume-b");
    expect(parsed.data[0]?.["Packet Run ID"]).toBe(payload.run.id);
    expect(parsed.data[0]?.["User Comment"]).toBe("Call Bob");
  });

  it("imports feedback into candidate status and actions using stored packet membership", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage, ActionStorage } = await loadReviewPacketModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "packet-import",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      packetFilename: "packet-import.xlsx",
      exportedAt: "2026-03-20T09:00:00+08:00",
      items: [
        {
          resumeId: "resume-1",
          identityKey: "profileUrl:my.employer.seek.com/candidates/503033454",
          profileUrl: "https://my.employer.seek.com/candidates/503033454",
          source: "my.employer.seek.com",
          name: "Alice",
        },
      ],
    });

    const calls: Array<{ pathName: string; args: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      calls.push({
        pathName: typeof body.path === "string" ? body.path : "",
        args: typeof body.args === "object" && body.args ? body.args as Record<string, unknown> : {},
      });
      return new Response(JSON.stringify({ status: "success", value: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const formData = new FormData();
    formData.append("file", new File([
      [
        "Resume ID,Name,Status,Action,Notes",
        "resume-1,Alice Zhang,interviewed_pass,shortlist,Strong manager fit",
      ].join("\n"),
    ], "reviewed.csv", { type: "text/csv" }));

    const app = createApp();
    const response = await app.request("/api/resumes/review-packets/packet-import/feedback-import", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "dev",
      },
      body: formData,
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      summary: { statusUpdates: number; actionUpdates: number; nameMismatchCount: number };
      warnings: string[];
    };
    expect(payload.success).toBe(true);
    expect(payload.summary.statusUpdates).toBe(1);
    expect(payload.summary.actionUpdates).toBe(1);
    expect(payload.summary.nameMismatchCount).toBe(1);
    expect(payload.warnings.some((warning) => warning.includes("edited Name"))).toBe(true);

    expect(calls[0]).toMatchObject({
      pathName: "candidate_status:upsert",
      args: {
        workspaceSlug: "dev",
        identityKey: "profileUrl:my.employer.seek.com/candidates/503033454",
        status: "interviewed_pass",
        notes: "Strong manager fit",
      },
    });

    const actionStorage = new ActionStorage(root);
    const actions = actionStorage.getLatestActionsForSession("review-packet:packet-import");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.resumeId).toBe("resume-1");
    expect(actions[0]?.actionType).toBe("shortlist");
  });

  it("previews and sends WeChat summaries from packet stats plus packet-scoped actions", async () => {
    root = createFixtureRoot();
    const {
      createApp,
      ReviewPacketStorage,
      ActionStorage,
      notificationService,
    } = await loadReviewPacketModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "packet-summary",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 2,
      packetFilename: "packet-summary.xlsx",
      exportedAt: "2026-03-20T09:00:00+08:00",
      feedbackImportedAt: "2026-03-20T10:00:00+08:00",
      items: [
        { resumeId: "resume-1", identityKey: "id-1", name: "Alice" },
        { resumeId: "resume-2", identityKey: "id-2", name: "Bob" },
      ],
      stats: {
        import: {
          importedAt: "2026-03-20T10:00:00+08:00",
          fileName: "reviewed.xlsx",
          totalRows: 2,
          matchedRows: 2,
          importedRows: 2,
          reviewedCount: 2,
          statusUpdates: 2,
          actionUpdates: 1,
          noteUpdates: 1,
          invalidRows: 0,
          duplicateRows: 0,
          warningCount: 1,
          matchedByProfileUrlCount: 0,
          nameMismatchCount: 1,
          reviewedResumeIds: ["resume-1", "resume-2"],
          warnings: ["Name edited"],
        },
      },
    });

    const actionStorage = new ActionStorage(root);
    actionStorage.saveAction({
      sessionId: "review-packet:packet-summary",
      resumeId: "resume-1",
      actionType: "shortlist",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (body.path === "candidate_status:list") {
        return new Response(JSON.stringify({
          status: "success",
          value: [
            { identityKey: "id-1", status: "interviewed_pass" },
            { identityKey: "id-2", status: "offer" },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch in summary test: ${JSON.stringify(body)}`);
    });

    const sendSpy = vi.spyOn(notificationService, "sendWechatWorkMarkdown").mockResolvedValue({
      errcode: 0,
      errmsg: "ok",
    });

    const app = createApp();
    const preview = await app.request("/api/resumes/review-packets/packet-summary/summary-preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({}),
    });

    expect(preview.status).toBe(200);
    const previewPayload = await preview.json() as {
      success: boolean;
      content: string;
      data: { reviewedCount: number; pendingCount: number; warningCount: number };
    };
    expect(previewPayload.success).toBe(true);
    expect(previewPayload.data.reviewedCount).toBe(2);
    expect(previewPayload.data.pendingCount).toBe(0);
    expect(previewPayload.data.warningCount).toBe(1);
    expect(previewPayload.content).toContain("# Review Packet packet-summary");

    const send = await app.request("/api/resumes/review-packets/packet-summary/summary-send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({}),
    });

    expect(send.status).toBe(200);
    const sendPayload = await send.json() as {
      success: boolean;
      channel: string;
      run: { status: string };
    };
    expect(sendPayload.success).toBe(true);
    expect(sendPayload.channel).toBe("wechat_work");
    expect(sendPayload.run.status).toBe("summary_sent");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
