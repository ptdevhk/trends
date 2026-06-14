import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuthMiddleware } from "../middleware/auth.js";
import { __resetLoginRateLimiterForTests } from "../middleware/login-rate-limit.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { AuthSessionService, hashSecret } from "../services/auth-session-service.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { getResumeScreeningDb, resetResumeScreeningDb } from "../services/database.js";
import { hashPassword } from "../services/local-password-provider.js";
import { CasdoorOidcProvider } from "../services/oidc-provider.js";
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

type AuthRouteOverrides = Omit<
  NonNullable<Parameters<typeof createAuthRoutes>[0]>,
  "storage" | "eventStorage" | "ttlSeconds"
>;

type AuthIdentityDetailsRow = {
  provider?: unknown;
  provider_subject?: unknown;
  provider_tenant?: unknown;
  raw_profile_json?: unknown;
};

function createTestApp(
  storage: AuthStorage,
  eventStorage?: AuthEventStorage,
  routeOverrides: AuthRouteOverrides = {},
) {
  const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.get("/api/test/workspace-gated", middleware.requireWorkspaceUser, (c) => {
    return c.json({ success: true as const });
  });
  app.route("/", createAuthRoutes({
    storage,
    ttlSeconds: 3600,
    eventStorage,
    ...routeOverrides,
  }));
  return app;
}

function createCasdoorProviderMock(input: {
  providerSubject: string;
  providerTenant?: string;
  email: string;
  displayName: string;
  rawProfile?: unknown;
}): CasdoorOidcProvider {
  const oidcProvider = new CasdoorOidcProvider({
    issuer: "https://casdoor.example.com",
    clientId: "trends",
    clientSecret: "secret",
    redirectUri: "http://localhost:3000/api/auth/casdoor/callback",
    scope: "openid profile email",
  });
  vi.spyOn(oidcProvider, "handleCallback").mockResolvedValue({
    provider: "casdoor",
    providerSubject: input.providerSubject,
    providerTenant: input.providerTenant ?? "https://casdoor.example.com",
    email: input.email,
    displayName: input.displayName,
    rawProfile: input.rawProfile ?? {
      sub: input.providerSubject,
      tenant: "wecom-tenant-1",
    },
  });
  return oidcProvider;
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
    __resetLoginRateLimiterForTests();
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

  it("creates a Casdoor session without workspace membership for unknown provider subjects", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-callback-"));
    const storage = new AuthStorage(root);
    storage.saveOidcState({
      state: "casdoor-state-1",
      provider: "casdoor",
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
      redirectTo: "/resumes",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const oidcProvider = createCasdoorProviderMock({
      providerSubject: "casdoor-user-1",
      email: "wecom-user@example.com",
      displayName: "WeCom User",
    });
    const app = createTestApp(storage, undefined, {
      oidcEnabled: true,
      oidcProvider,
    });

    const callback = await app.request("/api/auth/casdoor/callback?state=casdoor-state-1&code=ok", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("Location")).toBe("/resumes");
    const identity = storage.findIdentity(
      "casdoor",
      "casdoor-user-1",
      "https://casdoor.example.com",
    );
    expect(identity).not.toBeNull();
    if (!identity) {
      throw new Error("Casdoor identity was not linked");
    }
    expect(storage.listMemberships(identity.userId)).toEqual([]);
    const identityDetails = getResumeScreeningDb(root).prepare(`
      SELECT provider, provider_subject, provider_tenant, raw_profile_json
      FROM auth_identities
      WHERE user_id = ?
    `).get(identity.userId) as AuthIdentityDetailsRow | undefined;
    expect(identityDetails).toMatchObject({
      provider: "casdoor",
      provider_subject: "casdoor-user-1",
      provider_tenant: "https://casdoor.example.com",
    });
    expect(JSON.parse(String(identityDetails?.raw_profile_json))).toMatchObject({
      sub: "casdoor-user-1",
      tenant: "wecom-tenant-1",
    });

    const denied = await app.request("/api/test/workspace-gated", {
      headers: {
        "X-Workspace-Slug": "hr",
        Cookie: readCookie(callback, config.auth.sessionCookieName),
      },
    });

    expect(denied.status).toBe(403);
  });

  it("applies explicit Casdoor membership preapproval during callback", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-preapproved-callback-"));
    const storage = new AuthStorage(root);
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "casdoor-user-2",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "operator@example.com",
    });
    storage.saveOidcState({
      state: "casdoor-state-2",
      provider: "casdoor",
      codeVerifier: "verifier-2",
      nonce: "nonce-2",
      redirectTo: "/resumes",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const oidcProvider = createCasdoorProviderMock({
      providerSubject: "casdoor-user-2",
      email: "approved-user@example.com",
      displayName: "Approved WeCom User",
    });
    const app = createTestApp(storage, undefined, {
      oidcEnabled: true,
      oidcProvider,
    });

    const callback = await app.request("/api/auth/casdoor/callback?state=casdoor-state-2&code=ok", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(callback.status).toBe(302);
    const identity = storage.findIdentity(
      "casdoor",
      "casdoor-user-2",
      "https://casdoor.example.com",
    );
    expect(identity).not.toBeNull();
    if (!identity) {
      throw new Error("Casdoor identity was not linked");
    }
    expect(storage.listMemberships(identity.userId)).toEqual([
      { userId: identity.userId, workspaceSlug: "hr", role: "user" },
    ]);
    const sessionCookie = readCookie(callback, config.auth.sessionCookieName);

    const allowed = await app.request("/api/test/workspace-gated", {
      headers: {
        "X-Workspace-Slug": "hr",
        Cookie: sessionCookie,
      },
    });
    const deniedOtherWorkspace = await app.request("/api/test/workspace-gated", {
      headers: {
        "X-Workspace-Slug": "dev",
        Cookie: sessionCookie,
      },
    });

    expect(allowed.status).toBe(200);
    expect(deniedOtherWorkspace.status).toBe(403);
  });

  it("rejects disabled linked OIDC users and records a redacted callback failure", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-disabled-callback-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const disabledUser = storage.createUser({
      email: "disabled-user@example.com",
      displayName: "Disabled User",
    });
    storage.linkIdentity({
      userId: disabledUser.id,
      provider: "casdoor",
      providerSubject: "casdoor-disabled-user",
      providerTenant: "https://casdoor.example.com",
      email: disabledUser.email,
      displayName: disabledUser.displayName,
    });
    getResumeScreeningDb(root).prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(disabledUser.id);
    storage.saveOidcState({
      state: "casdoor-disabled-state",
      provider: "casdoor",
      codeVerifier: "verifier-disabled",
      nonce: "nonce-disabled",
      redirectTo: "/resumes",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const oidcProvider = createCasdoorProviderMock({
      providerSubject: "casdoor-disabled-user",
      email: "disabled-user@example.com",
      displayName: "Disabled User",
      rawProfile: {
        sub: "casdoor-disabled-user",
        access_token: "secret-access-token",
        rawProfile: "secret-profile",
      },
    });
    const app = createTestApp(storage, eventStorage, {
      oidcEnabled: true,
      oidcProvider,
    });

    const callback = await app.request("/api/auth/casdoor/callback?state=casdoor-disabled-state&code=secret-code", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(callback.status).toBe(403);
    await expect(callback.json()).resolves.toEqual({
      success: false,
      error: "OIDC user is disabled",
    });
    expect(callback.headers.get("Set-Cookie") ?? "").not.toContain(config.auth.sessionCookieName);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toEqual([
      expect.objectContaining({
        type: "login_failure",
        provider: "casdoor",
        userId: disabledUser.id,
        workspaceSlug: "hr",
        reason: "oidc_user_disabled",
        metadata: {
          providerSubject: "casdoor-disabled-user",
          providerTenant: "https://casdoor.example.com",
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret-code|secret-access-token|secret-profile|rawProfile/i);
  });

  it("does not reuse or grant access from a same-subject identity in another provider tenant", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-tenant-mismatch-"));
    const storage = new AuthStorage(root);
    const existingUser = storage.createUser({
      email: "existing-user@example.com",
      displayName: "Existing User",
    });
    storage.linkIdentity({
      userId: existingUser.id,
      provider: "casdoor",
      providerSubject: "casdoor-shared-subject",
      providerTenant: "https://old-casdoor.example.com",
      email: existingUser.email,
      displayName: existingUser.displayName,
    });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "casdoor-shared-subject",
      providerTenant: "https://old-casdoor.example.com",
      workspaceSlug: "hr",
      role: "admin",
      operatorId: "operator@example.com",
    });
    storage.saveOidcState({
      state: "casdoor-new-tenant-state",
      provider: "casdoor",
      codeVerifier: "verifier-new-tenant",
      nonce: "nonce-new-tenant",
      redirectTo: "/resumes",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const oidcProvider = createCasdoorProviderMock({
      providerSubject: "casdoor-shared-subject",
      providerTenant: "https://new-casdoor.example.com",
      email: "new-tenant-user@example.com",
      displayName: "New Tenant User",
    });
    const app = createTestApp(storage, undefined, {
      oidcEnabled: true,
      oidcProvider,
    });

    const callback = await app.request("/api/auth/casdoor/callback?state=casdoor-new-tenant-state&code=ok", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(callback.status).toBe(302);
    const newTenantIdentity = storage.findIdentity(
      "casdoor",
      "casdoor-shared-subject",
      "https://new-casdoor.example.com",
    );
    expect(newTenantIdentity).not.toBeNull();
    expect(newTenantIdentity?.userId).not.toBe(existingUser.id);
    expect(storage.listMemberships(newTenantIdentity?.userId ?? "")).toEqual([]);
    expect(storage.listMemberships(existingUser.id)).toEqual([
      { userId: existingUser.id, workspaceSlug: "hr", role: "admin" },
    ]);
  });

  it("records redacted audit events when OIDC callback state is invalid", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-invalid-state-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const oidcProvider = createCasdoorProviderMock({
      providerSubject: "casdoor-invalid-state-user",
      email: "invalid-state@example.com",
      displayName: "Invalid State User",
    });
    const app = createTestApp(storage, eventStorage, {
      oidcEnabled: true,
      oidcProvider,
    });

    const callback = await app.request("/api/auth/casdoor/callback?state=missing-state&code=secret-code", {
      headers: { "X-Workspace-Slug": "hr" },
    });

    expect(callback.status).toBe(400);
    expect(oidcProvider.handleCallback).not.toHaveBeenCalled();
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toEqual([
      expect.objectContaining({
        type: "oidc_state_invalid",
        provider: "casdoor",
        workspaceSlug: "hr",
        reason: "invalid_state",
        metadata: {
          statePresent: true,
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret-code");
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

  it("locks out login after 5 rapid failures for the same username from one IP", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-bruteforce-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(storage.db);
    await seedLocalUser(storage);
    const app = createTestApp(storage, eventStorage);

    const badBody = JSON.stringify({ username: "hr-admin", password: "wrong-pass" });
    const headers = {
      "Content-Type": "application/json",
      "X-Workspace-Slug": "hr",
      "X-Forwarded-For": "203.0.113.1",
    };

    // 5 rapid failures
    for (let i = 0; i < 5; i += 1) {
      const r = await app.request("/api/auth/login", { method: "POST", headers, body: badBody });
      expect(r.status).toBe(401);
    }

    // 6th attempt: locked out (429)
    const locked = await app.request("/api/auth/login", { method: "POST", headers, body: badBody });
    expect(locked.status).toBe(429);
    await expect(locked.json()).resolves.toMatchObject({ success: false, error: expect.stringContaining("lock") });

    // A login_throttled event is recorded
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "login_throttled")).toBe(true);
  });

  it("resets the failure counter after a successful login", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-reset-"));
    const storage = new AuthStorage(root);
    await seedLocalUser(storage);
    const app = createTestApp(storage);

    const headers = {
      "Content-Type": "application/json",
      "X-Workspace-Slug": "hr",
      "X-Forwarded-For": "203.0.113.2",
    };

    // 4 failures (under the 5-attempt threshold)
    for (let i = 0; i < 4; i += 1) {
      const r = await app.request("/api/auth/login", {
        method: "POST", headers,
        body: JSON.stringify({ username: "hr-admin", password: "wrong-pass" }),
      });
      expect(r.status).toBe(401);
    }

    // Successful login resets the counter
    const ok = await app.request("/api/auth/login", {
      method: "POST", headers,
      body: JSON.stringify({ username: "hr-admin", password: "secret-pass" }),
    });
    expect(ok.status).toBe(200);

    // 4 more failures should NOT lock out (counter was reset)
    for (let i = 0; i < 4; i += 1) {
      const r = await app.request("/api/auth/login", {
        method: "POST", headers,
        body: JSON.stringify({ username: "hr-admin", password: "wrong-pass" }),
      });
      expect(r.status).toBe(401);
    }
  });

  it("keys the limiter on username+IP independently (different IP not blocked)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-dualkey-"));
    const storage = new AuthStorage(root);
    await seedLocalUser(storage);
    const app = createTestApp(storage);

    // 5 failures for hr-admin from IP1
    for (let i = 0; i < 5; i += 1) {
      await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Slug": "hr",
          "X-Forwarded-For": "203.0.113.10",
        },
        body: JSON.stringify({ username: "hr-admin", password: "wrong-pass" }),
      });
    }

    // Same username from a different IP should still get a 401 (not locked)
    const fromIp2 = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
        "X-Forwarded-For": "203.0.113.20",
      },
      body: JSON.stringify({ username: "hr-admin", password: "wrong-pass" }),
    });
    expect(fromIp2.status).toBe(401);
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

describe("provider membership admin routes", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  function createSessionHeaders(storage: AuthStorage, userId: string, workspaceSlug = "hr") {
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(userId);
    return {
      "X-Workspace-Slug": workspaceSlug,
      "X-CSRF-Token": session.csrfToken,
      Cookie: `${config.auth.sessionCookieName}=${session.token}`,
    };
  }

  async function seedWorkspaceUser(
    storage: AuthStorage,
    input: { username: string; email: string; role: "user" | "admin" },
  ) {
    const user = storage.createUser({ email: input.email, displayName: input.username });
    storage.linkIdentity({
      userId: user.id,
      provider: "local",
      providerSubject: input.username,
      providerTenant: "local",
      email: user.email,
      displayName: user.displayName,
    });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: input.role });
    storage.savePasswordCredential({
      userId: user.id,
      ...(await hashPassword("secret-pass")),
      mustChangePassword: false,
    });
    return user;
  }

  it("rejects unauthenticated requests to every provider membership endpoint", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-unauth-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const app = createTestApp(storage, eventStorage);

    const list = await app.request("/api/auth/provider-memberships", {
      headers: { "X-Workspace-Slug": "hr" },
    });
    const preapprove = await app.request("/api/auth/provider-memberships/preapprove", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
      body: JSON.stringify({
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        role: "user",
      }),
    });
    const revoke = await app.request("/api/auth/provider-memberships/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "hr" },
      body: JSON.stringify({
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
      }),
    });

    expect(list.status).toBe(401);
    expect(preapprove.status).toBe(401);
    expect(revoke.status).toBe(401);
  });

  it("rejects non-admin workspace users", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-forbidden-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const user = await seedWorkspaceUser(storage, {
      username: "hr-user",
      email: "user@example.com",
      role: "user",
    });
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/provider-memberships", {
      headers: createSessionHeaders(storage, user.id),
    });

    expect(response.status).toBe(403);
  });

  it("lets admins list provider identities, preapprovals, grants, and auth events", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-list-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const admin = await seedWorkspaceUser(storage, {
      username: "hr-admin",
      email: "admin@example.com",
      role: "admin",
    });
    const providerUser = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: providerUser.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: providerUser.email,
      displayName: providerUser.displayName,
      rawProfile: { token: "secret-token" },
    });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: admin.id,
    });
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/provider-memberships?provider=casdoor", {
      headers: createSessionHeaders(storage, admin.id),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      identities: [
        {
          provider: "casdoor",
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          userId: providerUser.id,
          email: "casdoor@example.com",
          displayName: "Casdoor User",
        },
      ],
      preapprovals: [
        {
          provider: "casdoor",
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          workspaceSlug: "hr",
          role: "user",
          operatorId: admin.id,
          active: true,
        },
      ],
      grants: [
        {
          provider: "casdoor",
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          workspaceSlug: "hr",
          role: "user",
          userId: providerUser.id,
          active: true,
        },
      ],
      events: [
        {
          type: "workspace_membership_granted",
          provider: "casdoor",
          userId: providerUser.id,
          workspaceSlug: "hr",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });

  it("lets admins create provider preapprovals with authenticated actor attribution", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-preapprove-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const admin = await seedWorkspaceUser(storage, {
      username: "hr-admin",
      email: "admin@example.com",
      role: "admin",
    });
    const providerUser = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: providerUser.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: providerUser.email,
      displayName: providerUser.displayName,
      rawProfile: {
        access_token: "secret-access-token",
        rawProfile: "secret-profile",
      },
    });
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/provider-memberships/preapprove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createSessionHeaders(storage, admin.id),
      },
      body: JSON.stringify({
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        role: "admin",
        operatorId: "spoofed-operator",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      preapproval: {
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        role: "admin",
        operatorId: admin.id,
        active: true,
      },
      appliedMemberships: [
        { userId: providerUser.id, workspaceSlug: "hr", role: "admin" },
      ],
    });

    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "provider_membership_preapproved",
        userId: admin.id,
        provider: "casdoor",
        workspaceSlug: "hr",
        metadata: expect.objectContaining({
          action: "preapprove",
          operatorId: admin.id,
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          role: "admin",
        }),
      }),
    ]));
    expect(JSON.stringify(events)).not.toMatch(/secret-access-token|secret-profile|rawProfile/i);
  });

  it("lets admins revoke provider-derived access without deleting unrelated manual memberships", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-revoke-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const admin = await seedWorkspaceUser(storage, {
      username: "hr-admin",
      email: "admin@example.com",
      role: "admin",
    });
    const providerUser = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: providerUser.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: providerUser.email,
      displayName: providerUser.displayName,
    });
    storage.upsertMembership({ userId: providerUser.id, workspaceSlug: "dev", role: "admin" });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: admin.id,
    });
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/provider-memberships/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createSessionHeaders(storage, admin.id),
      },
      body: JSON.stringify({
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      revoked: {
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        active: false,
      },
    });
    expect(storage.listMemberships(providerUser.id)).toEqual([
      { userId: providerUser.id, workspaceSlug: "dev", role: "admin" },
    ]);
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "provider_membership_revoked",
        userId: admin.id,
        provider: "casdoor",
        workspaceSlug: "hr",
        metadata: expect.objectContaining({
          action: "revoke",
          operatorId: admin.id,
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          role: "user",
        }),
      }),
    ]));
  });

  it("lets admins revoke provider access without deleting same-workspace manual memberships", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-provider-admin-revoke-manual-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const admin = await seedWorkspaceUser(storage, {
      username: "hr-admin",
      email: "admin@example.com",
      role: "admin",
    });
    const providerUser = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: providerUser.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: providerUser.email,
      displayName: providerUser.displayName,
    });
    storage.upsertMembership({ userId: providerUser.id, workspaceSlug: "hr", role: "user" });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: admin.id,
    });
    const app = createTestApp(storage, eventStorage);

    const response = await app.request("/api/auth/provider-memberships/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createSessionHeaders(storage, admin.id),
      },
      body: JSON.stringify({
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      revoked: {
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        active: false,
      },
    });
    expect(storage.listMemberships(providerUser.id)).toEqual([
      { userId: providerUser.id, workspaceSlug: "hr", role: "user" },
    ]);
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
    const sessionCookie = readCookie(response, config.auth.sessionCookieName);
    const sessionToken = sessionCookie.split("=", 2)[1];
    const storedSession = storage.findSessionByTokenHash(hashSecret(sessionToken));
    if (!storedSession) {
      throw new Error("Expected successful login to create a stored session");
    }

    const events = eventStorage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("login_success");
    expect(events[0].provider).toBe("local");
    expect(events[0].workspaceSlug).toBe("hr");
    expect(events[0].sessionId).toBe(storedSession.id);
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
