import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

const enqueueMock = vi.hoisted(() => vi.fn());
const listTimelineMock = vi.hoisted(() => vi.fn());

vi.mock("../services/industry-maintenance-pipeline-service.js", () => ({
  enqueueIndustryMaintenance: enqueueMock,
}));

vi.mock("../services/industry-audit-service.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../services/industry-audit-service.js")
  >();
  return {
    ...actual,
    listTimeline: (...args: unknown[]) => listTimelineMock(...args),
  };
});

vi.mock("../services/industry-data-admin-service.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../services/industry-data-admin-service.js")
  >();
  return {
    ...actual,
    listEntries: vi.fn(async () => [
      {
        entryType: "brand",
        entryId: "brand-1",
        data: {
          id: 1,
          nameCn: "发那科",
          nameEn: "FANUC",
          type: "加工中心",
          origin: "international",
        },
      },
    ]),
    getSchedulePaused: vi.fn(async () => ({ paused: false })),
    setSchedulePaused: vi.fn(async (paused: boolean) => ({ paused })),
  };
});

import { createApp } from "../app";
import { createAuthHeaders } from "./test-auth-helpers";
import { parseJsonBody } from "../test-utils";

describe("industry-data-admin routes", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    enqueueMock.mockResolvedValue({ runId: "run-1", coalesced: false });
    listTimelineMock.mockReset();
    listTimelineMock.mockResolvedValue([
      {
        kind: "data_edit",
        at: 1000,
        summary: "create brand/brand-1 by admin",
        action: "create",
        companyKey: "acme",
      },
      {
        kind: "maintenance",
        at: 2000,
        summary: "ready: two sources",
        action: "ready",
        runId: "run-1",
        companyKey: "acme",
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requireAdmin rejects unauthenticated GET /api/industry-data/entries", async () => {
    const app = createApp();
    const response = await app.request("/api/industry-data/entries", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(response.status).toBe(401);
  });

  it("requireAdmin rejects non-admin GET /api/industry-data/entries", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/industry-data/entries", {
      headers: auth.headers,
    });
    expect(response.status).toBe(403);
  });

  it("lists entries for authenticated admin", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/industry-data/entries", {
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      success: boolean;
      entries: Array<{ entryId: string }>;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].entryId).toBe("brand-1");
  });

  it("scoped trigger calls enqueueIndustryMaintenance with triggerContext = companyKey", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request("/api/industry-data/trigger", {
      method: "POST",
      headers: {
        ...auth.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ companyKey: "lung-kee-metal" }),
    });
    expect(response.status).toBe(200);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      workspaceSlug: "hr",
      triggerSource: "manual",
      triggerContext: "lung-kee-metal",
    });
    const body = await parseJsonBody<{
      success: boolean;
      runId: string;
      coalesced: boolean;
    }>(response);
    expect(body).toMatchObject({
      success: true,
      runId: "run-1",
      coalesced: false,
    });
  });

  it("GET /audit passes workspaceSlug from request context into listTimeline", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });
    const response = await app.request(
      "/api/industry-data/audit?companyKey=acme&limit=20",
      { headers: auth.headers },
    );
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      success: boolean;
      items: Array<{ kind: string }>;
    }>(response);
    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { kind: string }) => i.kind).sort()).toEqual([
      "data_edit",
      "maintenance",
    ]);
    // Regression: workspaceSlug must flow from c.var.workspaceSlug so the
    // production defaultListLedger can call listIndustryMaintenanceRuns.
    expect(listTimelineMock).toHaveBeenCalledWith({
      companyKey: "acme",
      limit: 20,
      workspaceSlug: "hr",
    });
  });

  it("seed endpoint is admin-gated and returns { imported }", async () => {
    const auth = createAuthHeaders({ workspaceSlug: "hr", role: "admin" });
    const app = createApp({ authStorage: auth.storage });

    // Unauthenticated → 401
    const unauth = await app.request("/api/industry-data/seed", {
      method: "POST",
      headers: { "X-Workspace-Slug": "hr" },
    });
    expect(unauth.status).toBe(401);

    // Mock Convex upserts for seed path via global fetch
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ status: "success", value: { entryId: "x" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await app.request("/api/industry-data/seed", {
      method: "POST",
      headers: auth.headers,
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{
      success: boolean;
      imported: number;
    }>(response);
    expect(body.success).toBe(true);
    expect(typeof body.imported).toBe("number");
    expect(body.imported).toBeGreaterThan(0);
  });
});
