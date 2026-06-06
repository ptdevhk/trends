import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it } from "vitest";

import { createAuthMiddleware } from "../middleware/auth.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { hashPassword } from "../services/local-password-provider.js";
import { createAuthRoutes } from "./auth.js";

// Helper to create app with event storage for event logging tests
function createTestAppWithEvents(storage: AuthStorage, eventStorage: AuthEventStorage) {
  const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.use("*", middleware.requireAdmin);
  app.route("/", createAuthRoutes({ storage, ttlSeconds: 3600, eventStorage }));
  return app;
}

async function seedLocalUser(storage: AuthStorage) {
  const user = storage.createUser({ email: "hr@example.com", displayName: "HR Admin" });
  storage.linkIdentity({
    userId: user.id,
    provider: "local",
    providerSubject: "hr-admin",
    providerTenant: "local",
    email: user.email,
    displayName: user.displayName,
  });
  storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "admin" });
  storage.savePasswordCredential({
    userId: user.id,
    ...(await hashPassword("secret-pass")),
    mustChangePassword: false,
  });
  return user;
}

function createTestApp(storage: AuthStorage, eventStorage?: AuthEventStorage) {
  const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/", createAuthRoutes({ storage, ttlSeconds: 3600, eventStorage }));
  return app;
}

function readCookie(response: Response, name: string): string {
  const setCookie = response.headers.get("Set-Cookie") ?? "";
  const match = setCookie.match(new RegExp(`${name}=([^;]*)`));
  expect(match).not.toBeNull();
  return `${name}=${match?.[1] ?? ""}`;
}

describe("auth routes", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("logs in local users and sets auth and csrf cookies", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-routes-"));
    const storage = new AuthStorage(root);
    await seedLocalUser(storage);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
      body: JSON.stringify({ username: "hr-admin", password: "secret-pass" }),
    });

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${config.auth.sessionCookieName}=`);
    expect(setCookie).toContain(`${config.auth.csrfCookieName}=`);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      csrfToken: expect.any(String),
      user: { email: "hr@example.com" },
    });
  });

  it("returns current user and active workspace role", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-routes-"));
    const storage = new AuthStorage(root);
    const user = await seedLocalUser(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/me", {
      headers: {
        "X-Workspace-Slug": "hr",
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      workspaceRole: "admin",
      user: { id: user.id, email: "hr@example.com" },
      memberships: [{ workspaceSlug: "hr", role: "admin" }],
    });
  });

  it("keeps casdoor login disabled when OIDC is not enabled", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-routes-"));
    const storage = new AuthStorage(root);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/casdoor/login");

    expect(response.status).toBe(404);
  });

  it("revokes the current session on logout", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-routes-"));
    const storage = new AuthStorage(root);
    const user = await seedLocalUser(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
        "X-CSRF-Token": session.csrfToken,
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(sessions.resolveSession(session.token)).toBeNull();
    expect(readCookie(response, config.auth.sessionCookieName)).toBe(`${config.auth.sessionCookieName}=`);
  });
});

describe("GET /api/auth/options", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("returns local password enabled and OIDC disabled by default", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-options-"));
    const storage = new AuthStorage(root);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/options", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      localPasswordEnabled: true,
      casdoorEnabled: false,
    });
  });

  it("does not leak OIDC client secret in options response", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-options-"));
    const storage = new AuthStorage(root);
    const app = createTestApp(storage);

    const response = await app.request("/api/auth/options", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    const body = await response.text();

    expect(body).not.toContain("clientSecret");
    expect(body).not.toContain("client_secret");
  });
});

describe("GET /api/auth/events", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("rejects unauthenticated requests", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-api-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const app = createTestAppWithEvents(storage, eventStorage);

    const response = await app.request("/api/auth/events", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(response.status).toBe(401);
  });

  it("rejects non-admin workspace users", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-api-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const user = storage.createUser({ email: "user@example.com", displayName: "User" });
    storage.linkIdentity({ userId: user.id, provider: "local", providerSubject: "regular-user", providerTenant: "local" });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "user" });
    storage.savePasswordCredential({
      userId: user.id,
      ...(await hashPassword("pass")),
      mustChangePassword: false,
    });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const app = createTestAppWithEvents(storage, eventStorage);

    const response = await app.request("/api/auth/events", {
      headers: {
        "X-Workspace-Slug": "hr",
        "X-CSRF-Token": session.csrfToken,
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(response.status).toBe(403);
  });

  it("returns recent events for workspace admins", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-api-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    await seedLocalUser(storage);

    // Seed some events
    eventStorage.append({ type: "login_success", userId: "u1", workspaceSlug: "hr" });
    eventStorage.append({ type: "login_failure", workspaceSlug: "hr" });

    const adminUser = storage.findUser(storage.findIdentity("local", "hr-admin", "local")!.userId)!;
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(adminUser.id);
    const app = createTestAppWithEvents(storage, eventStorage);

    const response = await app.request("/api/auth/events", {
      headers: {
        "X-Workspace-Slug": "hr",
        "X-CSRF-Token": session.csrfToken,
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.events).toHaveLength(2);
  });
});

describe("auth event logging", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("records login_success event on successful local login", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    await seedLocalUser(storage);
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
      body: JSON.stringify({ username: "hr-admin", password: "secret-pass" }),
    });

    expect(response.status).toBe(200);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("login_success");
    expect(events[0].provider).toBe("local");
    expect(events[0].workspaceSlug).toBe("hr");
  });

  it("records login_failure event on invalid credentials", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    await seedLocalUser(storage);
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
      body: JSON.stringify({ username: "hr-admin", password: "wrong-pass" }),
    });

    expect(response.status).toBe(401);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("login_failure");
    expect(events[0].reason).toBe("invalid_credentials");
  });

  it("records logout event when session exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const user = await seedLocalUser(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(user.id);
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/logout", {
      method: "POST",
      headers: {
        "X-Workspace-Slug": "hr",
        "X-CSRF-Token": session.csrfToken,
        Cookie: `${config.auth.sessionCookieName}=${session.token}`,
      },
    });

    expect(response.status).toBe(200);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("logout");
    expect(events[0].userId).toBe(user.id);
  });
});
