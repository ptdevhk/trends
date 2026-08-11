import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

// Mock the Convex helper so we don't need a live backend.
vi.mock("../services/convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
  callConvexMutation: vi.fn(),
  callConvexAction: vi.fn(),
}));

import systemRoutes from "./system.js";
import { callConvexMutation, callConvexQuery } from "../services/convex-utils.js";
import { createApp } from "../app.js";
import { createAuthContext } from "./test-auth-helpers.js";

const mockedCallConvexQuery = vi.mocked(callConvexQuery);
const mockedCallConvexMutation = vi.mocked(callConvexMutation);

describe("GET /api/system/maintenance", () => {
  beforeEach(() => {
    mockedCallConvexQuery.mockReset();
    mockedCallConvexMutation.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns maintenanceMode=false when Convex reports off", async () => {
    mockedCallConvexQuery.mockResolvedValue(false);
    const res = await systemRoutes.request("/api/system/maintenance", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, maintenanceMode: false });
    expect(body).not.toHaveProperty("reason");
  });

  it("returns maintenanceMode=true when Convex reports on", async () => {
    mockedCallConvexQuery.mockResolvedValue(true);
    const res = await systemRoutes.request("/api/system/maintenance", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, maintenanceMode: true });
  });

  it("fails open with maintenanceMode=false when Convex throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockedCallConvexQuery.mockRejectedValue(new Error("convex down"));
    const res = await systemRoutes.request("/api/system/maintenance", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, maintenanceMode: false });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("resume work-history limit system routes", () => {
  beforeEach(() => {
    mockedCallConvexQuery.mockReset();
    mockedCallConvexMutation.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the effective global limit", async () => {
    mockedCallConvexQuery.mockResolvedValue(5);

    const response = await systemRoutes.request("/api/system/resume-work-history-limit");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      limit: 5,
      defaultLimit: 3,
      min: 1,
      max: 10,
    });
  });

  it("falls back to three when the setting read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedCallConvexQuery.mockRejectedValue(new Error("convex unavailable"));

    const response = await systemRoutes.request("/api/system/resume-work-history-limit");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ limit: 3, defaultLimit: 3 });
  });

  it("allows an admin to update the limit and records the actor", async () => {
    mockedCallConvexMutation.mockResolvedValue(4);
    const app = createApp({
      authContext: createAuthContext({ workspaceSlug: "dev", role: "admin", userId: "operator-1" }),
    });

    const response = await app.request("/api/system/resume-work-history-limit", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 4 }),
    });

    expect(response.status).toBe(200);
    expect(mockedCallConvexMutation).toHaveBeenCalledWith(
      "system_settings:setResumeWorkHistoryLimit",
      expect.objectContaining({ limit: 4, updatedBy: "operator-1" }),
    );
    expect(await response.json()).toMatchObject({ limit: 4, min: 1, max: 10 });
  });

  it("rejects updates from non-admin users", async () => {
    const app = createApp({
      authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
    });

    const response = await app.request("/api/system/resume-work-history-limit", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 4 }),
    });

    expect(response.status).toBe(403);
    expect(mockedCallConvexMutation).not.toHaveBeenCalled();
  });

  it("rejects values outside the configured range", async () => {
    const app = createApp({
      authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
    });

    const response = await app.request("/api/system/resume-work-history-limit", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
      },
      body: JSON.stringify({ limit: 11 }),
    });

    expect(response.status).toBe(400);
    expect(mockedCallConvexMutation).not.toHaveBeenCalled();
  });
});
