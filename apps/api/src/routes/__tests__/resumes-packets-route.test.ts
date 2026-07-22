import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Papa from "papaparse";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthContext } from "../test-auth-helpers";
import type { ResumeItem } from "../../types/resume";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resumes-packets-route-"));
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

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function loadModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../../app");
  const { ResumeService } = await import("../../services/resume-service");
  const { ReviewPacketStorage } = await import("../../services/review-packet-storage");
  const { ActionStorage } = await import("../../services/action-storage");
  const { resetResumeScreeningDb } = await import("../../services/database");
  const { notificationService } = await import("../../services/notification-service");
  const { workspaceConfigService } = await import("../../services/workspace-config-service");
  const { SearchEventLogger } = await import("../../services/search-event-logger");
  return {
    createApp,
    ResumeService,
    ReviewPacketStorage,
    ActionStorage,
    resetResumeScreeningDb,
    notificationService,
    workspaceConfigService,
    SearchEventLogger,
  };
}

function createAdminApp(createApp: Awaited<ReturnType<typeof loadModules>>["createApp"]) {
  return createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }) });
}

describe("resumes packets route", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PROJECT_ROOT;
    if (root) {
      const { resetResumeScreeningDb } = await import("../../services/database");
      resetResumeScreeningDb();
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  // -----------------------------------------------------------------------
  // List runs (GET /api/resumes/review-packets)
  // -----------------------------------------------------------------------

  it("returns empty list when no runs exist", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    const app = createAdminApp(createApp);

    const response = await app.request("/api/resumes/review-packets", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; items: unknown[] };
    expect(payload.success).toBe(true);
    expect(payload.items).toEqual([]);
  });

  it("returns runs in workspace", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "run-1",
      workspaceSlug: "dev",
      source: "convex",
      format: "csv",
      totalCount: 2,
      items: [],
    });
    storage.createRun({
      id: "run-2",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      items: [],
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; items: Array<{ id: string }> };
    expect(payload.success).toBe(true);
    expect(payload.items).toHaveLength(2);
    const ids = payload.items.map((item) => item.id);
    expect(ids).toContain("run-1");
    expect(ids).toContain("run-2");
  });

  it("respects limit query parameter", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({ id: "run-lim-1", workspaceSlug: "dev", source: "convex", format: "csv", totalCount: 1, items: [] });
    storage.createRun({ id: "run-lim-2", workspaceSlug: "dev", source: "convex", format: "csv", totalCount: 1, items: [] });
    storage.createRun({ id: "run-lim-3", workspaceSlug: "dev", source: "convex", format: "csv", totalCount: 1, items: [] });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets?limit=2", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; items: unknown[] };
    expect(payload.success).toBe(true);
    expect(payload.items).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Get single run (GET /api/resumes/review-packets/{runId})
  // -----------------------------------------------------------------------

  it("returns run when found", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "my-run",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 3,
      jobDescriptionId: "lathe-sales",
      items: [{ resumeId: "r1", identityKey: "k1" }],
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/my-run", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; run: { id: string; totalCount: number; jobDescriptionId?: string } };
    expect(payload.success).toBe(true);
    expect(payload.run.id).toBe("my-run");
    expect(payload.run.totalCount).toBe(3);
    expect(payload.run.jobDescriptionId).toBe("lathe-sales");
  });

  it("returns 404 when run not found", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    const app = createAdminApp(createApp);

    const response = await app.request("/api/resumes/review-packets/nonexistent", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(404);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("not found");
  });

  // -----------------------------------------------------------------------
  // Download (GET /api/resumes/review-packets/{runId}/download)
  // -----------------------------------------------------------------------

  it("returns CSV file with correct content-type for CSV format", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "csv-run",
      workspaceSlug: "dev",
      source: "convex",
      format: "csv",
      totalCount: 1,
      packetFilename: "review-packet-csv-run.csv",
      items: [{ resumeId: "r1", identityKey: "k1" }],
    });

    const packetDir = path.join(root, "output", "review-packets");
    fs.mkdirSync(packetDir, { recursive: true });
    fs.writeFileSync(path.join(packetDir, "review-packet-csv-run.csv"), "Resume ID,Name\nr1,Alice\n", "utf8");

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/csv-run/download?workspaceSlug=dev");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBeTruthy();

    const parsed = Papa.parse<Record<string, string>>(await response.text(), { header: true });
    expect(parsed.data[0]?.["Resume ID"]).toBe("r1");
    expect(parsed.data[0]?.Name).toBe("Alice");
  });

  it("returns XLSX file with correct content-type for XLSX format", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "xlsx-run",
      workspaceSlug: "dev",
      source: "convex",
      format: "xlsx",
      totalCount: 1,
      packetFilename: "review-packet-xlsx-run.xlsx",
      items: [{ resumeId: "r1", identityKey: "k1" }],
    });

    const packetDir = path.join(root, "output", "review-packets");
    fs.mkdirSync(packetDir, { recursive: true });
    fs.writeFileSync(path.join(packetDir, "review-packet-xlsx-run.xlsx"), "fake-xlsx-content");

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/xlsx-run/download?workspaceSlug=dev");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.xlsx"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBeTruthy();
  });

  it("returns 404 when download run not found", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    const app = createAdminApp(createApp);

    const response = await app.request("/api/resumes/review-packets/nonexistent/download?workspaceSlug=dev");

    expect(response.status).toBe(404);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("not found");
  });

  it("returns 404 when stored file is missing on disk", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "missing-file",
      workspaceSlug: "dev",
      source: "convex",
      format: "csv",
      totalCount: 1,
      items: [{ resumeId: "r1", identityKey: "k1" }],
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/missing-file/download?workspaceSlug=dev");

    expect(response.status).toBe(404);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("missing");
  });

  // -----------------------------------------------------------------------
  // Feedback import error cases (POST /api/resumes/review-packets/{runId}/feedback-import)
  // -----------------------------------------------------------------------

  it("returns 400 when no file provided in form data", async () => {
    root = createFixtureRoot();
    const { createApp, ReviewPacketStorage } = await loadModules(root);

    const storage = new ReviewPacketStorage(root);
    storage.createRun({
      id: "fb-no-file",
      workspaceSlug: "dev",
      source: "convex",
      format: "csv",
      totalCount: 1,
      items: [{ resumeId: "r1", identityKey: "k1" }],
    });

    const formData = new FormData();

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/fb-no-file/feedback-import", {
      method: "POST",
      headers: { "X-Workspace-Slug": "dev" },
      body: formData,
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 when feedback import run not found", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);

    const formData = new FormData();
    formData.append("file", new File(["Resume ID\nr1"], "test.csv", { type: "text/csv" }));

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/review-packets/nonexistent-fb/feedback-import", {
      method: "POST",
      headers: { "X-Workspace-Slug": "dev" },
      body: formData,
    });

    expect(response.status).toBe(404);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("not found");
  });

  // -----------------------------------------------------------------------
  // Learning feedback (POST /api/resumes/learning-feedback)
  // -----------------------------------------------------------------------

  it("returns 400 when observation is missing", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/learning-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
  });

  it("logs learning entry successfully", async () => {
    root = createFixtureRoot();
    const { createApp, workspaceConfigService } = await loadModules(root);

    vi.spyOn(workspaceConfigService, "appendLearningLogEntry").mockResolvedValue({
      date: "2026-05-25",
      observation: "Test observation",
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/learning-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ observation: "Test observation" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { success: boolean; entry: string };
    expect(payload.success).toBe(true);
    expect(payload.entry).toContain("2026-05-25");
    expect(payload.entry).toContain("Test observation");
  });

  it("triggers skills reingest when observation contains skill-related keywords", async () => {
    root = createFixtureRoot();
    const { createApp, workspaceConfigService } = await loadModules(root);

    vi.spyOn(workspaceConfigService, "appendLearningLogEntry").mockResolvedValue({
      date: "2026-05-25",
      observation: "synonym_suggestion: fenc -> fanuc",
    });

    // Mock fetch for the Convex action call made by triggerReingestStaleSkillsVersion
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input) => {
      return new Response(
        JSON.stringify({ status: "success", value: { scheduled: 5, batches: 2, currentVersion: 1, hasMore: false } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/learning-feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ observation: "synonym_suggestion: fenc -> fanuc" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      success: boolean;
      entry: string;
      bumpedVersion?: number;
      reingest?: { scheduled: number; batches: number; currentVersion: number; hasMore: boolean };
    };
    expect(payload.success).toBe(true);
    expect(payload.entry).toContain("synonym_suggestion:");
    expect(payload.bumpedVersion).toBe(1);
    expect(payload.reingest).toBeDefined();
    expect(payload.reingest!.scheduled).toBe(5);
    expect(payload.reingest!.batches).toBe(2);
  });

  it("threads a stale-reingest continuation cursor through the API", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    const actionBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.path === "migrations:reIngestStaleSkillsVersion") {
        actionBodies.push(body);
      }
      return convexSuccess({
        scheduled: 2,
        batches: 1,
        currentVersion: 1,
        currentIngestComputeEpoch: 1,
        hasMore: true,
        cursor: "cursor:next",
        mode: "any",
        dryRun: false,
        skillsStaleCount: 2,
        computeStaleCount: 2,
        matchedCount: 2,
      });
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/trigger-reingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 2, cursor: "cursor:start", mode: "any" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      scheduled: 2,
      hasMore: true,
      cursor: "cursor:next",
    });
    expect(actionBodies).toHaveLength(1);
    expect(actionBodies[0]).toMatchObject({
      path: "migrations:reIngestStaleSkillsVersion",
      args: { limit: 2, cursor: "cursor:start", mode: "any", dryRun: false },
    });
  });

  // -----------------------------------------------------------------------
  // Form-based export download (POST /api/resumes/export/download)
  // -----------------------------------------------------------------------

  it("exports via form-encoded payload (legacy download endpoint)", async () => {
    root = createFixtureRoot();
    const { createApp, ResumeService, workspaceConfigService } = await loadModules(root);

    // The legacy download endpoint shares buildResumeExportResponse with the
    // JSON export route, so it resolves the workspace export-fields config.
    // Mock it to no stored entry (default core column set, which includes
    // userComment) so the test is deterministic instead of depending on a
    // seeded local Convex backend.
    vi.spyOn(workspaceConfigService, "getExportFieldsConfig").mockResolvedValue(null);

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

    const formData = new FormData();
    formData.append(
      "payload",
      JSON.stringify({
        format: "csv",
        source: "sample",
        sample: "sample-test",
        entries: [
          { resumeId: "resume-b", status: "contacted", userComment: "Call Bob" },
          { resumeId: "resume-a", status: "new" },
        ],
      })
    );

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/export/download", {
      method: "POST",
      headers: { "X-Workspace-Slug": "dev" },
      body: formData,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="resumes-export-.+\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBeTruthy();

    const parsed = Papa.parse<Record<string, string>>(await response.text(), { header: true });
    expect(parsed.data[0]?.resumeId).toBe("resume-b");
    expect(parsed.data[0]?.name).toBe("Bob");
    expect(parsed.data[0]?.userComment).toBe("Call Bob");
    expect(parsed.data[1]?.resumeId).toBe("resume-a");
    expect(parsed.data[1]?.name).toBe("Alice");
  });
});
