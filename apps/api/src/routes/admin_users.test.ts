import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthMiddleware } from "../middleware/auth.js";
import {
  __resetLoginRateLimiterForTests,
  recordLoginFailure,
  LOGIN_MAX_FAILURES,
  checkLoginAttempt,
} from "../middleware/login-rate-limit.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { hashPassword, verifyPassword } from "../services/local-password-provider.js";
import { parseJsonBody } from "../test-utils";
import { createAdminUserRoutes } from "./admin_users.js";

async function seedLocalUser(storage: AuthStorage, overrides: { username?: string; password?: string; email?: string; workspace?: string; role?: "user" | "admin" } = {}) {
  const username = overrides.username ?? "hr-admin";
  const user = storage.createUser({ email: overrides.email ?? "hr@example.com", displayName: "HR Admin" });
  storage.linkIdentity({
    userId: user.id,
    provider: "local",
    providerSubject: username,
    providerTenant: "local",
    email: user.email,
    displayName: user.displayName,
  });
  storage.upsertMembership({ userId: user.id, workspaceSlug: overrides.workspace ?? "hr", role: overrides.role ?? "admin" });
  storage.savePasswordCredential({
    userId: user.id,
    ...(await hashPassword(overrides.password ?? "secret-pass")),
    mustChangePassword: false,
  });
  return { user, username, password: overrides.password ?? "secret-pass" };
}

async function seedDevAdmin(storage: AuthStorage) {
  return seedLocalUser(storage, {
    username: "dev-admin-user",
    password: "dev-admin-pass",
    email: "dev@example.com",
    workspace: "dev",
    role: "admin",
  });
}

function createTestApp(
  storage: AuthStorage,
  eventStorage: AuthEventStorage,
  options: { adminResetEnabled?: boolean } = {},
) {
  const adminResetEnabled = options.adminResetEnabled ?? true;
  const middleware = createAuthMiddleware({ storage, ttlSeconds: 3600, eventStorage });
  const app = new OpenAPIHono();
  app.use("*", workspaceMiddleware);
  app.use("*", middleware.optionalAuth);
  app.use("/api/*", middleware.requireCsrf);
  app.route("/", createAdminUserRoutes({
    storage,
    eventStorage,
    adminResetEnabled,
    authMiddleware: middleware,
  }));
  return app;
}

function authHeaders(workspace: string, session: { token: string; csrfToken: string }) {
  return {
    "Content-Type": "application/json",
    "X-Workspace-Slug": workspace,
    "X-CSRF-Token": session.csrfToken,
    Cookie: `${config.auth.sessionCookieName}=${session.token}`,
  };
}

describe("POST /api/admin/reset-password", () => {
  let originalAdminReset: boolean | undefined;

  beforeEach(() => {
    originalAdminReset = (config.auth as { adminResetEnabled?: boolean }).adminResetEnabled;
  });

  afterEach(() => {
    (config.auth as { adminResetEnabled?: boolean }).adminResetEnabled = originalAdminReset;
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("returns 404 when AUTH_ADMIN_RESET_ENABLED is false", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-off-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    await seedLocalUser(storage, { username: "target-user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage, { adminResetEnabled: false });

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "target-user" }),
    });

    expect(res.status).toBe(404);
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "password_reset_completed")).toBe(false);
  });

  it("resets password, revokes sessions, and records event when dev-admin resets a local user", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target-user", password: "old-pass" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const targetSession1 = sessions.createSession(target.user.id);
    const targetSession2 = sessions.createSession(target.user.id);
    const adminSession = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", adminSession),
      body: JSON.stringify({ username: "target-user" }),
    });

    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: unknown; temporaryPassword: string }>(res);
    expect(body.success).toBe(true);
    expect(body.temporaryPassword).toEqual(expect.any(String));
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    // Credential rotated
    const updated = storage.findPasswordCredential(target.user.id);
    expect(updated).not.toBeNull();
    expect(await verifyPassword(body.temporaryPassword, updated!)).toBe(true);
    expect(await verifyPassword("old-pass", updated!)).toBe(false);

    // All target sessions revoked
    expect(sessions.resolveSession(targetSession1.token)).toBeNull();
    expect(sessions.resolveSession(targetSession2.token)).toBeNull();
    // Admin session untouched
    expect(sessions.resolveSession(adminSession.token)).not.toBeNull();

    // Event recorded
    const events = eventStorage.listRecent({ limit: 50 });
    const resetEvent = events.find((e) => e.type === "password_reset_completed");
    expect(resetEvent).toBeDefined();
    expect(resetEvent!.userId).toBe(target.user.id);
    expect(resetEvent!.metadata?.resetByUserId).toBe(devAdmin.user.id);
    expect(resetEvent!.metadata?.provider).toBe("local");
  });

  it("returns 404 with precise message when username has no local identity", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-noid-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "ghost-user" }),
    });

    expect(res.status).toBe(404);
    const body = await parseJsonBody(res);
    expect(body.error).toContain("No local password identity found");
    expect(body.error).toContain("ghost-user");
  });

  it("returns 404 when target identity is Casdoor-only (not local)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-casdoor-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    // Seed a Casdoor-only identity (no local provider identity)
    const casdoorUser = storage.createUser({ email: "casdoor@example.com", displayName: "Casdoor User" });
    storage.linkIdentity({
      userId: casdoorUser.id,
      provider: "casdoor",
      providerSubject: "casdoor-subject",
      providerTenant: "https://casdoor.example.com",
      email: casdoorUser.email,
      displayName: casdoorUser.displayName,
    });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "casdoor-subject" }),
    });

    expect(res.status).toBe(404);
    const body = await parseJsonBody(res);
    expect(body.error).toContain("No local password identity found");
  });

  it("returns 403 when caller is hr-admin (non-dev workspace)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-hradmin-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const hrAdmin = await seedLocalUser(storage, { username: "hr-admin", workspace: "hr", role: "admin" });
    await seedLocalUser(storage, { username: "target-user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("hr", session),
      body: JSON.stringify({ username: "target-user" }),
    });

    expect(res.status).toBe(403);
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "password_reset_completed")).toBe(false);
  });

  it("returns 403 when caller is dev-user (non-admin role)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-devuser-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devUser = await seedLocalUser(storage, { username: "dev-user", workspace: "dev", role: "user" });
    await seedLocalUser(storage, { username: "target-user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devUser.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "target-user" }),
    });

    expect(res.status).toBe(403);
  });

  it("returns 401 when caller is unauthenticated", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-unauth-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    await seedLocalUser(storage, { username: "target-user" });
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Slug": "dev" },
      body: JSON.stringify({ username: "target-user" }),
    });

    expect(res.status).toBe(401);
  });

  it("does not leak the temporary password in event metadata", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-noleak-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target-user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "target-user" }),
    });
    const body = await parseJsonBody<{ temporaryPassword: string }>(res);

    const events = eventStorage.listRecent({ limit: 50 });
    const resetEvent = events.find((e) => e.type === "password_reset_completed");
    expect(resetEvent).toBeDefined();
    const metadataKeys = Object.keys(resetEvent!.metadata ?? {});
    expect(metadataKeys.sort()).toEqual(["provider", "resetByUserId"]);
    // The temp password must not appear anywhere in metadata values
    const metadataJson = JSON.stringify(resetEvent!.metadata ?? {});
    expect(metadataJson).not.toContain(body.temporaryPassword);
  });

  it("rotates the credential so the old password fails and the temp password works", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-rotate-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target-user", password: "old-pass-123" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "target-user" }),
    });
    const body = await parseJsonBody<{ temporaryPassword: string }>(res);
    const updated = storage.findPasswordCredential(target.user.id);

    expect(await verifyPassword(body.temporaryPassword, updated!)).toBe(true);
    expect(await verifyPassword("old-pass-123", updated!)).toBe(false);
  });

  it("returns 400 when dev-admin attempts to reset own password", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-self-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "dev-admin-user" }),
    });

    expect(res.status).toBe(400);
    const body = await parseJsonBody(res);
    expect(body.error).toMatch(/change-password/i);
    // No reset happened
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "password_reset_completed")).toBe(false);
  });
});

describe("POST /api/admin/auth/unlock", () => {
  beforeEach(() => {
    __resetLoginRateLimiterForTests();
  });

  afterEach(() => {
    __resetLoginRateLimiterForTests();
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("returns 401 when caller has no session", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-401-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "dev",
        "X-CSRF-Token": "irrelevant-no-session",
      },
      body: JSON.stringify({ username: "victim" }),
    });

    expect([401, 403]).toContain(res.status);
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "login_lockout_cleared")).toBe(false);
  });

  it("returns 403 when caller is not in the dev workspace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-403-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    // hr-admin is admin in 'hr', not 'dev' — must be denied at the workspace gate.
    const hrAdmin = await seedLocalUser(storage, { username: "hr-admin", workspace: "hr", role: "admin" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: authHeaders("hr", session),
      body: JSON.stringify({ username: "victim" }),
    });

    expect(res.status).toBe(403);
  });

  it("clears lockout for a locked username and emits an audit event", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Drive a real lockout via the public API so the test exercises the same
    // path production hits — fake state via __resetLoginRateLimiterForTests
    // would not assert that the unlock actually maps to the keyed entries.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      recordLoginFailure("locked-user", "203.0.113.7");
    }
    expect(checkLoginAttempt("locked-user", "203.0.113.7").allowed).toBe(false);

    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "locked-user" }),
    });

    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: unknown; cleared: boolean; removedCount: number }>(res);
    expect(body.success).toBe(true);
    expect(body.cleared).toBe(true);
    expect(body.removedCount).toBe(1);

    // Lockout actually cleared.
    expect(checkLoginAttempt("locked-user", "203.0.113.7").allowed).toBe(true);

    // Audit event recorded with admin attribution.
    const events = eventStorage.listRecent({ limit: 50 });
    const evt = events.find((e) => e.type === "login_lockout_cleared");
    expect(evt).toBeDefined();
    expect(evt!.workspaceSlug).toBe("dev");
    expect(evt!.metadata?.targetUsername).toBe("locked-user");
    expect(evt!.metadata?.clearedByUserId).toBe(devAdmin.user.id);
    expect(evt!.metadata?.cleared).toBe(true);
    expect(evt!.metadata?.removedCount).toBe(1);
  });

  it("clears every IP-keyed entry for the username (multi-NAT recovery)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-multi-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Same user fat-fingered from laptop AND phone hotspot — two keyed entries.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) recordLoginFailure("dual-locked", "1.1.1.1");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) recordLoginFailure("dual-locked", "2.2.2.2");

    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "dual-locked" }),
    });

    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ removedCount: number }>(res);
    expect(body.removedCount).toBe(2);
    expect(checkLoginAttempt("dual-locked", "1.1.1.1").allowed).toBe(true);
    expect(checkLoginAttempt("dual-locked", "2.2.2.2").allowed).toBe(true);
  });

  it("returns success with cleared=false when the username has no active lockout", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-noop-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "never-locked" }),
    });

    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ cleared: boolean; removedCount: number }>(res);
    expect(body.cleared).toBe(false);
    expect(body.removedCount).toBe(0);

    // Audit event still emitted — operators need to see "unlock attempted, no-op".
    const events = eventStorage.listRecent({ limit: 50 });
    const evt = events.find((e) => e.type === "login_lockout_cleared");
    expect(evt).toBeDefined();
    expect(evt!.metadata?.cleared).toBe(false);
    expect(evt!.metadata?.removedCount).toBe(0);
  });

  it("normalises the username (case-insensitive, trimmed) when matching keys", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-unlock-norm-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Lockout was recorded as "alice" (the rate-limiter normalises on input).
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) recordLoginFailure("alice", "9.9.9.9");

    // Admin types "  ALICE  " — should still match.
    const res = await app.request("/api/admin/auth/unlock", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "  ALICE  " }),
    });

    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ cleared: boolean }>(res);
    expect(body.cleared).toBe(true);
    expect(checkLoginAttempt("alice", "9.9.9.9").allowed).toBe(true);
  });
});
