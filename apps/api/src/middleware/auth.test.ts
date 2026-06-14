import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { listWorkspaceSlugs } from "@trends/shared";

import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
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

  it("does not let an admin workspace membership access the dev workspace", async () => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(createAuthContext("admin", "admin"), middleware.requireWorkspaceUser);

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

  it.each(listWorkspaceSlugs())("allows a matching member for registered workspace %s", async (slug) => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(createAuthContext("user", slug), middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": slug },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ actorId: "user-1" });
  });

  it("rejects invalid workspace slugs before the auth gate runs", async () => {
    const middleware = createAuthMiddleware();
    const app = createGateApp(createAuthContext("user", "hr"), middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "prod" },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Invalid workspace slug"),
    });
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

  it("denies a user-role member of the dev workspace admin routes (membership-gated, not workspace-identity-gated)", async () => {
    // Regression guard: the deleted workspace.ts requireAdmin gated on the
    // static-registry accessLevel (workspace identity), not on per-user role.
    // The membership requireAdmin must gate on the user's membership role, so
    // a dev-workspace user-role member is denied even though the workspace
    // exists in the registry. This test pins the invariant so a future
    // static-access pattern cannot silently reintroduce the bypass.
    const middleware = createAuthMiddleware();
    const devUserApp = createGateApp(createAuthContext("user", "dev"), middleware.requireAdmin);
    const devAdminApp = createGateApp(createAuthContext("admin", "dev"), middleware.requireAdmin);

    const devUserRes = await devUserApp.request("/protected", {
      headers: { "X-Workspace-Slug": "dev" },
    });
    const devAdminRes = await devAdminApp.request("/protected", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(devUserRes.status).toBe(403);
    expect(devAdminRes.status).toBe(200);
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

describe("auth middleware event logging", () => {
  it("logs workspace_access_denied when workspace membership is missing", async () => {
    resetResumeScreeningDb();
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-mw-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
    const app = createGateApp(createAuthContext("user", "hr"), middleware.requireWorkspaceUser);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "dev" },
    });

    expect(res.status).toBe(403);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("workspace_access_denied");
    expect(events[0].userId).toBe("user-1");
    expect(events[0].workspaceSlug).toBe("dev");
  });

  it("logs admin_access_denied when admin membership is missing", async () => {
    resetResumeScreeningDb();
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-mw-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
    const app = createGateApp(createAuthContext("user", "hr"), middleware.requireAdmin);

    const res = await app.request("/protected", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(res.status).toBe(403);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("admin_access_denied");
    expect(events[0].userId).toBe("user-1");
    expect(events[0].workspaceSlug).toBe("hr");
  });

  it("logs csrf_reject when CSRF token is missing", async () => {
    resetResumeScreeningDb();
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-mw-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const user = storage.createUser({ email: "hr@example.com", displayName: "HR" });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });

    const app = new Hono();
    app.use("*", workspaceMiddleware);
    app.use("*", middleware.optionalAuth);
    app.use("*", middleware.requireWorkspaceUser);
    app.use("*", middleware.requireCsrf);
    app.post("/mutate", (c) => c.json({ ok: true }));

    const res = await app.request("/mutate", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(res.status).toBe(403);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("csrf_reject");
    expect(events[0].userId).toBe(user.id);
  });
});
