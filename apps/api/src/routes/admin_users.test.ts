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

describe("assertSystemAdmin shared helper", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("returns 403 from a non-dev workspace even when caller is admin there", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "system-admin-gate-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const hrAdmin = await seedLocalUser(storage, { username: "hr-only-admin", workspace: "hr", role: "admin" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/reset-password", {
      method: "POST",
      headers: authHeaders("hr", session),
      body: JSON.stringify({ username: "anyone" }),
    });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/users", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("creates user with local identity, returns temp password, audits event", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-user-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({
        username: "new-hr-user",
        email: "new@x.com",
        displayName: "New HR",
        initialMembership: { workspaceSlug: "hr", role: "user" },
      }),
    });

    expect(res.status).toBe(201);
    const body = await parseJsonBody<{ success: true; user: { id: string }; temporaryPassword: string }>(res);
    expect(body.success).toBe(true);
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // Verify identity + membership + password were persisted
    const identity = storage.findIdentity("local", "new-hr-user", "local");
    expect(identity?.userId).toBe(body.user.id);
    const memberships = storage.listMemberships(body.user.id);
    expect(memberships).toEqual(expect.arrayContaining([
      { userId: body.user.id, workspaceSlug: "new-hr-user", role: "user" },
      { userId: body.user.id, workspaceSlug: "hr", role: "user" },
    ]));
    expect(memberships).toHaveLength(2);
    // Login with returned temp password should succeed (verifies hash round-trip)
    const cred = storage.findPasswordCredential(body.user.id);
    expect(cred).not.toBeNull();
    expect(await verifyPassword(body.temporaryPassword, cred!)).toBe(true);

    // Audit
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events.some((e) => e.type === "user_created" && e.userId === body.user.id)).toBe(true);
    expect(events.filter((e) => e.type === "membership_granted_by_admin" && e.userId === body.user.id).length).toBeGreaterThanOrEqual(2);
  });

  it("returns 409 when local username already exists", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-user-409-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    await seedLocalUser(storage, { username: "taken" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "taken" }),
    });
    expect(res.status).toBe(409);
  });

  it("always creates a personal user seat when system memberships are omitted", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-user-personal-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "orphan" }),
    });
    expect(res.status).toBe(201);
    const body = await parseJsonBody<{ user: { id: string } }>(res);
    expect(storage.listMemberships(body.user.id)).toEqual([
      { userId: body.user.id, workspaceSlug: "orphan", role: "user" },
    ]);
  });

  it("rejects reserved usernames that cannot own a personal seat", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-user-reserved-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ username: "hr" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 from hr workspace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "create-user-403-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const hrAdmin = await seedLocalUser(storage, { workspace: "hr", role: "admin" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders("hr", session),
      body: JSON.stringify({ username: "someone" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/users/:id/disable", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("disables target, revokes all their sessions, audits", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "disable-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const adminSession = sessions.createSession(devAdmin.user.id);
    const targetSession = sessions.createSession(target.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request(`/api/admin/users/${target.user.id}/disable`, {
      method: "POST",
      headers: authHeaders("dev", adminSession),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; sessionsRevoked: number }>(res);
    expect(body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    // Re-resolving the target session should now fail (status filter in findUser -> null)
    expect(sessions.resolveSession(targetSession.token)).toBeNull();
    expect(eventStorage.listRecent({ limit: 5 }).some((e) => e.type === "user_disabled" && e.userId === target.user.id)).toBe(true);
  });

  it("rejects self-disable with 400", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "disable-self-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request(`/api/admin/users/${devAdmin.user.id}/disable`, {
      method: "POST",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when userId unknown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "disable-404-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users/does-not-exist/disable", {
      method: "POST",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/users/:id/enable", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("re-enables a disabled user", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "enable-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target" });
    storage.setUserStatus(target.user.id, "disabled");
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request(`/api/admin/users/${target.user.id}/enable`, {
      method: "POST",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(200);
    expect(storage.findUser(target.user.id)?.status).toBe("active");
    expect(eventStorage.listRecent({ limit: 5 }).some((e) => e.type === "user_enabled" && e.userId === target.user.id)).toBe(true);
  });
});

describe("GET /api/admin/users", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "list-users-401-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const app = createTestApp(storage, eventStorage);
    const res = await app.request("/api/admin/users", {
      method: "GET",
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 from hr workspace even with admin role there", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "list-users-403-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const hrAdmin = await seedLocalUser(storage, { workspace: "hr", role: "admin" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);
    const res = await app.request("/api/admin/users", {
      method: "GET",
      headers: authHeaders("hr", session),
    });
    expect(res.status).toBe(403);
  });

  it("lists all users with identities and memberships when called by dev-admin", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "list-users-200-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    await seedLocalUser(storage, { username: "hr-1", email: "hr1@x.com", workspace: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users", {
      method: "GET",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{
      success: true;
      users: Array<{
        id: string;
        email?: string;
        status: string;
        identities: Array<{ provider: string; providerSubject: string; providerTenant: string | null }>;
        memberships: Array<{ workspaceSlug: string; role: string }>;
      }>;
    }>(res);
    expect(body.success).toBe(true);
    expect(body.users).toHaveLength(2);

    // Verify returned records carry populated identities/memberships (not just empty arrays)
    const hr1 = body.users.find((u) => u.email === "hr1@x.com");
    expect(hr1).toBeDefined();
    expect(hr1!.memberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ workspaceSlug: "hr", role: "user" })]),
    );
    expect(hr1!.identities).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "local", providerSubject: "hr-1" })]),
    );
  });
});

describe("POST /api/admin/users/:id/memberships", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("adds a new membership and audits", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "add-mem-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "target", workspace: "dev", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request(`/api/admin/users/${target.user.id}/memberships`, {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ workspaceSlug: "hr", role: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; created: boolean }>(res);
    expect(body.created).toBe(true);
    expect(storage.listMemberships(target.user.id)).toEqual(
      expect.arrayContaining([
        { userId: target.user.id, workspaceSlug: "hr", role: "admin" },
      ]),
    );
    // Audit event recorded
    const events = eventStorage.listRecent({ limit: 10 });
    const evt = events.find((e) => e.type === "membership_granted_by_admin" && e.userId === target.user.id);
    expect(evt).toBeDefined();
    expect(evt!.metadata?.operatorId).toBe(devAdmin.user.id);
    expect(evt!.metadata?.role).toBe("admin");
  });

  it("upserts existing membership row when role changes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "upsert-role-change-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    // Seed target already has dev/user membership
    const target = await seedLocalUser(storage, { username: "target", workspace: "dev", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Upsert the dev membership from user -> admin
    const res = await app.request(`/api/admin/users/${target.user.id}/memberships`, {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ workspaceSlug: "dev", role: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; created: boolean }>(res);
    expect(body.created).toBe(false);
    // Role was updated
    const memberships = storage.listMemberships(target.user.id);
    const devMem = memberships.find((m) => m.workspaceSlug === "dev");
    expect(devMem?.role).toBe("admin");
  });

  it("returns 404 when userId unknown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "add-mem-404-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users/does-not-exist/memberships", {
      method: "POST",
      headers: authHeaders("dev", session),
      body: JSON.stringify({ workspaceSlug: "hr", role: "user" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/users/:id/memberships/:slug", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("blocks self-removal of dev/admin with 400", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "self-demote-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request(`/api/admin/users/${devAdmin.user.id}/memberships/dev`, {
      method: "DELETE",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(400);
    const body = await parseJsonBody<{ success: false; error: string }>(res);
    expect(body.error).toContain("Cannot remove");
  });

  it("returns deleted=true when row removed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "delete-mem-ok-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const hrUser = await seedLocalUser(storage, { username: "hr-user", workspace: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Confirm hr membership exists
    expect(storage.listMemberships(hrUser.user.id)).toEqual(
      expect.arrayContaining([{ userId: hrUser.user.id, workspaceSlug: "hr", role: "user" }]),
    );

    const res = await app.request(`/api/admin/users/${hrUser.user.id}/memberships/hr`, {
      method: "DELETE",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; deleted: boolean }>(res);
    expect(body.deleted).toBe(true);

    // Membership row removed
    expect(storage.listMemberships(hrUser.user.id)).toEqual([]);

    // Audit event recorded
    const events = eventStorage.listRecent({ limit: 10 });
    const evt = events.find((e) => e.type === "membership_revoked_by_admin" && e.userId === hrUser.user.id);
    expect(evt).toBeDefined();
    expect(evt!.metadata?.operatorId).toBe(devAdmin.user.id);
  });

  it("returns deleted=false when row absent", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "delete-mem-absent-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    // Seed user with dev membership only (no hr membership)
    const devUser = await seedLocalUser(storage, { username: "dev-only", workspace: "dev", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Confirm no hr membership
    expect(storage.listMemberships(devUser.user.id).some((m) => m.workspaceSlug === "hr")).toBe(false);

    const res = await app.request(`/api/admin/users/${devUser.user.id}/memberships/hr`, {
      method: "DELETE",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; deleted: boolean }>(res);
    expect(body.deleted).toBe(false);

    // No audit event for no-op delete
    const events = eventStorage.listRecent({ limit: 10 });
    expect(events.some((e) => e.type === "membership_revoked_by_admin" && e.userId === devUser.user.id)).toBe(false);
  });

  it("returns 404 when userId unknown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "delete-mem-404-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users/does-not-exist/memberships/hr", {
      method: "DELETE",
      headers: authHeaders("dev", session),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/users/:id/auth-events", () => {
  afterEach(() => {
    resetResumeScreeningDb();
    vi.restoreAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "auth-events-401-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users/some-user-id/auth-events", {
      method: "GET",
      headers: { "X-Workspace-Slug": "dev" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 from hr workspace even with admin role there", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "auth-events-403-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const hrAdmin = await seedLocalUser(storage, { workspace: "hr", role: "admin" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const session = sessions.createSession(hrAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    const res = await app.request("/api/admin/users/some-user-id/auth-events", {
      method: "GET",
      headers: authHeaders("hr", session),
    });
    expect(res.status).toBe(403);
  });

  it("returns events filtered to the target user", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "auth-events-200-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "audit-target", workspace: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const adminSession = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Seed events for the target user
    eventStorage.append({ type: "user_disabled", userId: target.user.id, metadata: { operatorId: devAdmin.user.id } });
    eventStorage.append({ type: "user_enabled", userId: target.user.id, metadata: { operatorId: devAdmin.user.id } });
    // Seed an event for a different user (should not appear)
    eventStorage.append({ type: "user_disabled", userId: devAdmin.user.id, metadata: { operatorId: devAdmin.user.id } });

    const res = await app.request(`/api/admin/users/${target.user.id}/auth-events`, {
      method: "GET",
      headers: authHeaders("dev", adminSession),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; events: Array<{ type: string; userId?: string }> }>(res);
    expect(body.success).toBe(true);
    expect(body.events).toHaveLength(2);
    expect(body.events.every((e) => e.userId === target.user.id)).toBe(true);
  });

  it("honors the limit query parameter", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "auth-events-limit-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);
    const devAdmin = await seedDevAdmin(storage);
    const target = await seedLocalUser(storage, { username: "limit-target", workspace: "hr", role: "user" });
    const sessions = new AuthSessionService(storage, { ttlSeconds: 3600 });
    const adminSession = sessions.createSession(devAdmin.user.id);
    const app = createTestApp(storage, eventStorage);

    // Append 3 events for the target user
    eventStorage.append({ type: "user_disabled", userId: target.user.id });
    eventStorage.append({ type: "user_enabled", userId: target.user.id });
    eventStorage.append({ type: "membership_granted_by_admin", userId: target.user.id, workspaceSlug: "dev" });

    const res = await app.request(`/api/admin/users/${target.user.id}/auth-events?limit=2`, {
      method: "GET",
      headers: authHeaders("dev", adminSession),
    });
    expect(res.status).toBe(200);
    const body = await parseJsonBody<{ success: true; events: unknown[] }>(res);
    expect(body.success).toBe(true);
    expect(body.events).toHaveLength(2);
  });
});
