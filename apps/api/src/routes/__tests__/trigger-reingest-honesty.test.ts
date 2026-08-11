import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthContext } from "../test-auth-helpers";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-reingest-honesty-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
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
    "utf8",
  );
  return root;
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function loadModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../../app");
  return { createApp };
}

function createAdminApp(createApp: Awaited<ReturnType<typeof loadModules>>["createApp"]) {
  return createApp({ authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }) });
}

describe("trigger-reingest honesty (F4/F5)", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PROJECT_ROOT;
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("passes scannedRows and hasMore through to the route response", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    // Fresh Response per call: BFF middleware (maintenance guard, verified
    // catalog bridge) also fetches Convex before the route handler runs.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      convexSuccess({
        scheduled: 2,
        batches: 1,
        currentVersion: 1,
        currentIngestComputeEpoch: 1,
        hasMore: true,
        cursor: "cursor:next",
        mode: "compute",
        dryRun: true,
        scannedRows: 75,
        skillsStaleCount: 30,
        computeStaleCount: 30,
        matchedCount: 30,
      }),
    );

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/trigger-reingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 200, mode: "compute", dryRun: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      scannedRows: 75,
      hasMore: true,
      cursor: "cursor:next",
      dryRun: true,
      computeStaleCount: 30,
    });
  });

  it("returns an explicit fallback hint instead of a bare 500 when the action fails", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    // Only the re-ingest action fails; middleware queries (maintenance flag,
    // verified catalog) succeed so the route is reached without retry noise.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { path?: string };
      if (body.path === "migrations:reIngestStaleSkillsVersion") {
        return new Response(
          JSON.stringify({ status: "error", error: { message: "too many system operations" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return convexSuccess({ ok: true });
    });

    const app = createAdminApp(createApp);
    const response = await app.request("/api/resumes/trigger-reingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 200 }),
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toContain("fallback");
    expect(payload.error).toContain("scheduleExactReingest");
  }, 20000);

  it("doctor reports the real scanned window, not the requested scanLimit, and states when the window is incomplete", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      convexSuccess({
        scheduled: 0,
        batches: 0,
        currentVersion: 1,
        currentIngestComputeEpoch: 3,
        hasMore: true,
        cursor: "cursor:next",
        mode: "compute",
        dryRun: true,
        scannedRows: 200,
        skillsStaleCount: 0,
        computeStaleCount: 200,
        matchedCount: 200,
      }),
    );

    const app = createAdminApp(createApp);
    const response = await app.request(
      "/api/resumes/search-freshness?scanLimit=500&skipGolden=true",
      { headers: { "X-Workspace-Slug": "dev" } },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      lag: {
        scanned: number;
        scanComplete: boolean;
        computeStale: number;
        missingEpoch: number;
      };
      messages: string[];
    };
    // Honest window: 200 rows actually scanned, NOT the requested 500.
    expect(payload.lag.scanned).toBe(200);
    expect(payload.lag.scanComplete).toBe(false);
    expect(payload.lag.computeStale).toBe(200);
    expect(payload.lag.missingEpoch).toBe(200);
    expect(payload.messages.join(" ")).toContain("scan window INCOMPLETE");
  });

  it("doctor marks a complete scan as complete", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadModules(root);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      convexSuccess({
        scheduled: 0,
        batches: 0,
        currentVersion: 1,
        currentIngestComputeEpoch: 3,
        hasMore: false,
        cursor: null,
        mode: "compute",
        dryRun: true,
        scannedRows: 40,
        skillsStaleCount: 0,
        computeStaleCount: 0,
        matchedCount: 0,
      }),
    );

    const app = createAdminApp(createApp);
    const response = await app.request(
      "/api/resumes/search-freshness?scanLimit=500&skipGolden=true",
      { headers: { "X-Workspace-Slug": "dev" } },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      lag: { scanned: number; scanComplete: boolean };
      messages: string[];
    };
    expect(payload.lag.scanned).toBe(40);
    expect(payload.lag.scanComplete).toBe(true);
    expect(payload.messages.join(" ")).toContain("scan window complete");
  });
});
