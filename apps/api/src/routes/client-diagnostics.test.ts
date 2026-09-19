import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import clientDiagnosticsRoutes from "./client-diagnostics";
import { workspaceMiddleware } from "../middleware/workspace";
import { ClientDiagnosticsLogger } from "../services/client-diagnostics-logger";
import { parseJsonBody } from "../test-utils";

function createTestApp() {
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.route("/api/client-diagnostics", clientDiagnosticsRoutes);
  return app;
}

describe("POST /api/client-diagnostics/report", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a convex websocket degraded event", async () => {
    const logSpy = vi
      .spyOn(ClientDiagnosticsLogger.prototype, "logEvent")
      .mockImplementation(() => {});
    const app = createTestApp();
    const response = await app.request("/api/client-diagnostics/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        kind: "convex_ws_degraded",
        pathname: "/hr/resumes",
        hasEverConnected: true,
        connectionRetries: 3,
        visibility: "visible",
      }),
    });
    expect(response.status).toBe(200);
    const body = await parseJsonBody<{ success: boolean }>(response);
    expect(body.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "convex_ws_degraded",
        pathname: "/hr/resumes",
        workspace: "hr",
        hasEverConnected: true,
        connectionRetries: 3,
      }),
    );
  });

  it("logs a Convex query timeout", async () => {
    const logSpy = vi
      .spyOn(ClientDiagnosticsLogger.prototype, "logEvent")
      .mockImplementation(() => {});
    const app = createTestApp();
    const response = await app.request("/api/client-diagnostics/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        kind: "convex_query_timeout",
        pathname: "/hr/resumes",
        hasEverConnected: true,
        connectionRetries: 0,
      }),
    });
    expect(response.status).toBe(200);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "convex_query_timeout" }),
    );
  });

  it("rejects unknown kinds", async () => {
    const app = createTestApp();
    const response = await app.request("/api/client-diagnostics/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        kind: "other",
        pathname: "/hr/resumes",
        hasEverConnected: false,
        connectionRetries: 0,
      }),
    });
    expect(response.status).toBe(400);
  });
});
