import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it } from "vitest";

import { createAuthMiddleware } from "../middleware/auth.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { hashPassword } from "../services/local-password-provider.js";
import { createAuthRoutes } from "./auth.js";

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

function createTestApp(storage: AuthStorage) {
  const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600 });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/", createAuthRoutes({ storage, ttlSeconds: 3600 }));
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
