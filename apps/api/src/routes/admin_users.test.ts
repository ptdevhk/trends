import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthMiddleware } from "../middleware/auth.js";
import { workspaceMiddleware } from "../middleware/workspace.js";
import { AuthSessionService } from "../services/auth-session-service.js";
import { AuthEventStorage } from "../services/auth-event-storage.js";
import { AuthStorage } from "../services/auth-storage.js";
import { config } from "../services/config.js";
import { resetResumeScreeningDb } from "../services/database.js";
import { hashPassword, verifyPassword } from "../services/local-password-provider.js";
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();
    expect(body.error).toContain("No local password identity found");
    expect(body.error).toContain("ghost-user");
  });

  it("returns 404 when target identity is Casdoor-only (not local)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-casdoor-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();
    expect(body.error).toContain("No local password identity found");
  });

  it("returns 403 when caller is hr-admin (non-dev workspace)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-hradmin-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(storage.db);
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();

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
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();
    const updated = storage.findPasswordCredential(target.user.id);

    expect(await verifyPassword(body.temporaryPassword, updated!)).toBe(true);
    expect(await verifyPassword("old-pass-123", updated!)).toBe(false);
  });

  it("returns 400 when dev-admin attempts to reset own password", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "admin-reset-self-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(storage.db);
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
    const body = await res.json();
    expect(body.error).toMatch(/change-password/i);
    // No reset happened
    const events = eventStorage.listRecent({ limit: 50 });
    expect(events.some((e) => e.type === "password_reset_completed")).toBe(false);
  });
});
