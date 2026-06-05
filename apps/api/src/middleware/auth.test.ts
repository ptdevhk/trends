import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import type { AuthContext, WorkspaceRole } from "../services/auth-types.js";
import { hasWorkspaceRole } from "../services/auth-types.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { createAuthMiddleware, getAuthenticatedActorId } from "./auth.js";
import { workspaceMiddleware } from "./workspace.js";

function createAuthContext(role: WorkspaceRole, workspaceSlug = "hr"): AuthContext {
  return {
    user: {
      id: "user-1",
      email: "hr@example.com",
      displayName: "HR User",
      status: "active",
    },
    memberships: [{ userId: "user-1", workspaceSlug, role }],
    sessionId: "session-1",
    csrfToken: "csrf-hash",
  };
}

function createGateApp(
  auth: AuthContext | undefined,
  gate: ReturnType<typeof createAuthMiddleware>["requireWorkspaceUser"],
) {
  const app = new Hono();
  app.use("*", workspaceMiddleware);
  app.use("*", async (c, next) => {
    if (auth) {
      c.set("auth", auth);
    }
    await next();
  });
  app.use("*", gate);
  app.get("/protected", (c) => c.json({ actorId: getAuthenticatedActorId(c) }));
  return app;
}

describe("auth middleware role helpers", () => {
  it("requires membership in the selected workspace", () => {
    expect(hasWorkspaceRole([{ userId: "u1", workspaceSlug: "hr", role: "user" }], "hr", ["user", "admin"])).toBe(true);
    expect(hasWorkspaceRole([{ userId: "u1", workspaceSlug: "hr", role: "user" }], "dev", ["user", "admin"])).toBe(false);
    expect(hasWorkspaceRole([{ userId: "u1", workspaceSlug: "hr", role: "user" }], "hr", ["admin"])).toBe(false);
  });
});

describe("auth middleware gates", () => {
  it("rejects a protected route when auth is missing", async () => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(undefined, middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: "Authentication required",
    });
  });

  it("rejects a protected route when membership belongs to another workspace", async () => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(createAuthContext("user", "hr"), middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: "Workspace access required",
    });
  });

  it("allows a workspace user member on the selected workspace", async () => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(createAuthContext("user", "hr"), middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ actorId: "user-1" });
  });

  it("requires admin membership for admin routes", async () => {
    const middleware = createAuthMiddleware();
    const userApp = createGateApp(createAuthContext("user", "hr"), middleware.requireAdmin);
    const adminApp = createGateApp(createAuthContext("admin", "hr"), middleware.requireAdmin);

    const userRes = await userApp.request("/protected", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    const adminRes = await adminApp.request("/protected", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(userRes.status).toBe(403);
    await expect(userRes.json()).resolves.toMatchObject({
      success: false,
      error: "Admin access required",
    });
    expect(adminRes.status).toBe(200);
  });

  it("requires a valid CSRF header for mutating requests", async () => {
    resetResumeScreeningDb();
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-middleware-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({ email: "hr@example.com", displayName: "HR" });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600 });

    const app = new Hono();
    app.use("*", workspaceMiddleware);
    app.use("*", middleware.optionalAuth);
    app.use("*", middleware.requireWorkspaceUser);
    app.use("*", middleware.requireCsrf);
    app.post("/mutate", (c) => c.json({ actorId: getAuthenticatedActorId(c) }));

    const headers = {
      "X-Workspace-Slug": "hr",
      Cookie: `${config.auth.sessionCookieName}=${session.token}`,
    };
    const missingRes = await app.request("/mutate", { method: "POST", headers });
    const validRes = await app.request("/mutate", {
      method: "POST",
      headers: {
        ...headers,
        "X-CSRF-Token": session.csrfToken,
      },
    });

    expect(missingRes.status).toBe(403);
    await expect(missingRes.json()).resolves.toMatchObject({
      success: false,
      error: "CSRF token required",
    });
    expect(validRes.status).toBe(200);
    await expect(validRes.json()).resolves.toMatchObject({ actorId: user.id });
  });
});
