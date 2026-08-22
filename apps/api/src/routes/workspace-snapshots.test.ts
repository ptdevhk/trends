import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { createApp } from "../app";
import { resetResumeScreeningDb } from "../services/database";
import { createAuthHeaders } from "./test-auth-helpers";

const TEST_CONVEX_WRITE_SECRET = "test-workspace-snapshots-secret";

type ConvexCall = {
  type: "query" | "mutation";
  pathName: string;
  args: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): ConvexCall {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  const type: ConvexCall["type"] = requestUrl.includes("/api/query") ? "query" : "mutation";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body)) {
    throw new Error("Missing convex request body");
  }
  const pathName = typeof body.path === "string" ? body.path : "";
  const args = isRecord(body.args) ? body.args : {};
  if (!pathName) {
    throw new Error("Missing convex path in request body");
  }
  return { type, pathName, args };
}

function convexSuccess(value: unknown): Response {
  return new Response(
    JSON.stringify({ status: "success", value }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function convexError(message: string): Response {
  return new Response(
    JSON.stringify({ status: "error", errorMessage: message }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const ENVELOPE_TABLES = {
  candidateStatus: [{ identityKey: "c-1", status: "hired", updatedAt: 1 }],
  candidateBlocks: [],
  searchProfiles: [],
  workspaceConfig: [],
};

describe("workspace snapshot routes", () => {
  beforeEach(() => {
    vi.stubEnv("CONVEX_WRITE_SECRET", TEST_CONVEX_WRITE_SECRET);
    vi.stubEnv("CONVEX_URL", "http://127.0.0.1:3210");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetResumeScreeningDb();
  });

  it("rejects export without a session without querying Convex", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess({ tables: ENVELOPE_TABLES });
    });

    const app = createApp();
    const response = await app.request("/api/workspace/export", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects export for non-admin roles", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess({ tables: ENVELOPE_TABLES });
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "user" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/export", { headers: auth.headers });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("exports the hr-ops envelope for the authenticated workspace", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess({ tables: ENVELOPE_TABLES });
    });

    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/export", { headers: auth.headers });
    const payload = await response.json() as {
      success: boolean;
      schemaVersion?: number;
      profile?: string;
      workspaceSlug?: string;
      tables?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.profile).toBe("hr-ops");
    expect(payload.workspaceSlug).toBe("hr");
    expect(payload.tables).toEqual(ENVELOPE_TABLES);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: "query",
      pathName: "workspace_snapshots:exportWorkspaceSnapshot",
      args: { workspaceSlug: "hr", profile: "hr-ops" },
    });
  });

  it("exports the full profile when requested", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess({ tables: ENVELOPE_TABLES });
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/export?profile=full", { headers: auth.headers });

    expect(response.status).toBe(200);
    expect(calls[0]?.args.profile).toBe("full");
  });

  it("rejects a workspace override on export", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess({ tables: ENVELOPE_TABLES });
    });

    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/export", {
      headers: { ...auth.headers, "X-Workspace-Slug": "dev" },
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("imports an envelope as admin with the write secret attached", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      calls.push(call);
      return convexSuccess({
        schemaVersion: 1,
        profile: "hr-ops",
        workspaceSlug: "dev",
        mode: "merge",
        applied: { candidateStatus: 1, candidateBlocks: 0, searchProfiles: 0, workspaceConfig: 0 },
        deleted: { candidateStatus: 0, candidateBlocks: 0, searchProfiles: 0, workspaceConfig: 0 },
      });
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/import", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        profile: "hr-ops",
        mode: "merge",
        tables: ENVELOPE_TABLES,
      }),
    });
    const payload = await response.json() as { success: boolean; applied?: unknown };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: "mutation",
      pathName: "workspace_snapshots:importWorkspaceSnapshot",
      args: {
        workspaceSlug: "dev",
        profile: "hr-ops",
        mode: "merge",
      },
    });
  });

  it("rejects an unsupported schemaVersion before touching Convex", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess({});
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/import", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 99,
        profile: "hr-ops",
        mode: "replace",
        tables: ENVELOPE_TABLES,
      }),
    });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Unsupported snapshot schemaVersion 99");
    expect(calls).toHaveLength(0);
  });

  it("surfaces Convex refusal errors as 400 with the message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init);
      if (call.type === "mutation") {
        return convexError('workspace_config import refused: secret-like configKey "api_token"');
      }
      return convexSuccess({});
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/import", {
      method: "POST",
      headers: { ...auth.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "full",
        mode: "merge",
        tables: {
          candidateStatus: [],
          candidateBlocks: [],
          searchProfiles: [],
          workspaceConfig: [{ configKey: "api_token", configValue: "x", updatedAt: 1 }],
        },
      }),
    });
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("secret-like configKey");
  });

  it("rejects import for non-admin roles", async () => {
    const calls: ConvexCall[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(parseConvexCall(input, init));
      return convexSuccess({});
    });

    const auth = createAuthHeaders({ workspaceSlug: "dev", role: "reviewer" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/workspace/import", {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ profile: "hr-ops", mode: "merge", tables: ENVELOPE_TABLES }),
    });

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
