import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

// Mock the Convex helper so we don't need a live backend.
vi.mock("../services/convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
}));

import systemRoutes from "./system.js";
import { callConvexQuery } from "../services/convex-utils.js";

const mockedCallConvexQuery = vi.mocked(callConvexQuery);

describe("GET /api/system/maintenance", () => {
  beforeEach(() => {
    mockedCallConvexQuery.mockReset();
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
