import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/maintenance.js", () => ({
  maintenanceGuard: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

const enqueueMock = vi.hoisted(() => vi.fn());

vi.mock("../services/industry-maintenance-pipeline-service.js", () => ({
  enqueueIndustryMaintenance: enqueueMock,
}));

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

describe("industry-data-admin routes", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    enqueueMock.mockResolvedValue({ runId: "run-1", coalesced: false });
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
    const body = await response.json();
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
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      runId: "run-1",
      coalesced: false,
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
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.imported).toBe("number");
    expect(body.imported).toBeGreaterThan(0);
  });
});
