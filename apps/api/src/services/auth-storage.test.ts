import { mkdtempSync, mkdirSync as fsMkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { AuthEventStorage } from "./auth-event-storage.js";
import { AuthStorage } from "./auth-storage.js";
import { getResumeScreeningDb, resetResumeScreeningDb } from "./database.js";

describe("auth sqlite schema", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("creates auth tables and indexes in resume_screening.db", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-db-"));
    const db = getResumeScreeningDb(root);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "users",
        "auth_identities",
        "auth_password_credentials",
        "auth_sessions",
        "auth_oidc_states",
        "workspace_memberships",
        "auth_provider_membership_preapprovals",
        "auth_provider_membership_grants",
      ]),
    );
  });

  it("does not carry dead auth columns on the users table", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-dead-cols-"));
    const db = getResumeScreeningDb(root);

    const columns = db
      .prepare("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;
    const columnNames = columns.map((row) => row.name);

    // Removed per ADR D1/D3 — authorization is membership-derived, "team" is
    // a URL alias only, and last_active_at was never updated post-creation.
    expect(columnNames).not.toContain("role");
    expect(columnNames).not.toContain("team_id");
    expect(columnNames).not.toContain("last_active_at");
  });

  it("drops dead auth columns when migrating an existing users table", () => {
    // Simulate a restored prod DB that still has the legacy columns.
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-migrate-"));
    const outputDir = path.join(root, "output");
    fsMkdirSync(outputDir, { recursive: true });
    const rawDb = new Database(path.join(outputDir, "resume_screening.db"));
    rawDb.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        display_name TEXT,
        status TEXT DEFAULT 'active',
        role TEXT DEFAULT 'recruiter',
        team_id TEXT,
        created_at TEXT NOT NULL,
        last_active_at TEXT,
        settings TEXT
      );
    `);
    rawDb.close();

    // initSchema runs via getResumeScreeningDb and must idempotently drop the
    // dead columns.
    const db = getResumeScreeningDb(root);
    const columns = db
      .prepare("PRAGMA table_info(users)")
      .all() as Array<{ name: string }>;
    const columnNames = columns.map((row) => row.name);

    expect(columnNames).not.toContain("role");
    expect(columnNames).not.toContain("team_id");
    expect(columnNames).not.toContain("last_active_at");
  });

  it("creates a user, local identity, and workspace membership", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-storage-"));
    const storage = new AuthStorage(root);

    const user = storage.createUser({
      email: "hr@example.com",
      displayName: "HR User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "local",
      providerSubject: "hr-admin",
      providerTenant: "local",
    });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "admin" });

    expect(storage.findIdentity("local", "hr-admin", "local")?.userId).toBe(user.id);
    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "admin" },
    ]);
  });

  it("consumes OIDC state only once", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-oidc-state-"));
    const storage = new AuthStorage(root);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    storage.saveOidcState({
      state: "state-123",
      provider: "casdoor",
      codeVerifier: "verifier-123",
      nonce: "nonce-123",
      redirectTo: "/resumes",
      expiresAt,
    });

    expect(storage.consumeOidcState("state-123")).toEqual({
      state: "state-123",
      provider: "casdoor",
      codeVerifier: "verifier-123",
      nonce: "nonce-123",
      redirectTo: "/resumes",
      expiresAt,
    });
    expect(storage.consumeOidcState("state-123")).toBeNull();
  });

  it("applies and revokes explicit Casdoor membership preapprovals with audit events", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-preapproval-"));
    const storage = new AuthStorage(root);
    const eventStorage = new AuthEventStorage(root);

    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "operator@example.com",
    });

    const user = storage.createUser({
      email: "wecom-user@example.com",
      displayName: "WeCom User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      email: user.email,
      displayName: user.displayName,
    });

    expect(storage.applyProviderMembershipPreapprovals({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      userId: user.id,
    })).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);
    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);
    expect(storage.listMemberships(user.id)).not.toContainEqual({
      userId: user.id,
      workspaceSlug: "dev",
      role: "admin",
    });

    storage.revokeProviderMembershipPreapproval({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      operatorId: "operator@example.com",
    });

    expect(storage.listMemberships(user.id)).toEqual([]);
    expect(eventStorage.listRecent({ limit: 10 })).toMatchObject([
      {
        type: "workspace_membership_revoked",
        provider: "casdoor",
        userId: user.id,
        workspaceSlug: "hr",
        metadata: {
          operatorId: "operator@example.com",
          providerSubject: "casdoor-user-1",
          providerTenant: "https://casdoor.example.com",
          role: "user",
        },
      },
      {
        type: "workspace_membership_granted",
        provider: "casdoor",
        userId: user.id,
        workspaceSlug: "hr",
        metadata: {
          operatorId: "operator@example.com",
          providerSubject: "casdoor-user-1",
          providerTenant: "https://casdoor.example.com",
          role: "user",
        },
      },
    ]);
  });

  it("preserves same-workspace manual memberships when provider-derived access is revoked", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-manual-same-workspace-"));
    const storage = new AuthStorage(root);

    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "operator@example.com",
    });

    const user = storage.createUser({
      email: "wecom-user@example.com",
      displayName: "WeCom User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      email: user.email,
      displayName: user.displayName,
    });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "user" });

    expect(storage.applyProviderMembershipPreapprovals({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      userId: user.id,
    })).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);

    storage.revokeProviderMembershipPreapproval({
      provider: "casdoor",
      providerSubject: "casdoor-user-1",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      operatorId: "operator@example.com",
    });

    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);
    expect(storage.listProviderMembershipGrants({
      provider: "casdoor",
      workspaceSlug: "hr",
      includeRevoked: true,
    })).toMatchObject([
      {
        providerSubject: "casdoor-user-1",
        providerTenant: "https://casdoor.example.com",
        workspaceSlug: "hr",
        active: false,
      },
    ]);
  });

  it("grants immediately when a Casdoor preapproval matches an existing identity", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-casdoor-existing-preapproval-"));
    const storage = new AuthStorage(root);

    const user = storage.createUser({
      email: "linked-user@example.com",
      displayName: "Linked User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "casdoor-existing-user",
      providerTenant: "https://casdoor.example.com",
      email: user.email,
      displayName: user.displayName,
    });

    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "casdoor-existing-user",
      providerTenant: "https://casdoor.example.com",
      workspaceSlug: "hr",
      role: "admin",
      operatorId: "operator@example.com",
    });

    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "admin" },
    ]);
  });
});

describe("auth session revocation by user", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("listSessionsByUser returns all non-revoked sessions for a user", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-session-list-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({ email: "u@example.com", displayName: "U" });

    storage.createSession({
      userId: user.id,
      tokenHash: "hash-1",
      csrfTokenHash: "csrf-1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    storage.createSession({
      userId: user.id,
      tokenHash: "hash-2",
      csrfTokenHash: "csrf-2",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const sessions = storage.listSessionsByUser(user.id);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.tokenHash).sort()).toEqual(["hash-1", "hash-2"]);
  });

  it("revokeAllSessionsByUser revokes every session for the user", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-session-revoke-all-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({ email: "u@example.com", displayName: "U" });

    storage.createSession({
      userId: user.id,
      tokenHash: "hash-1",
      csrfTokenHash: "csrf-1",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    storage.createSession({
      userId: user.id,
      tokenHash: "hash-2",
      csrfTokenHash: "csrf-2",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const revoked = storage.revokeAllSessionsByUser(user.id);
    expect(revoked).toBe(2);
    expect(storage.listSessionsByUser(user.id)).toHaveLength(0);
  });

  it("revokeAllSessionsByUser preserves an excepted token hash", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-session-except-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({ email: "u@example.com", displayName: "U" });

    storage.createSession({
      userId: user.id,
      tokenHash: "keep-me",
      csrfTokenHash: "csrf-keep",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    storage.createSession({
      userId: user.id,
      tokenHash: "revoke-me",
      csrfTokenHash: "csrf-revoke",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const revoked = storage.revokeAllSessionsByUser(user.id, "keep-me");
    expect(revoked).toBe(1);
    const remaining = storage.listSessionsByUser(user.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.tokenHash).toBe("keep-me");
  });

  it("revokeAllSessionsByUser does not touch other users' sessions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-session-isolation-"));
    const storage = new AuthStorage(root);
    const userA = storage.createUser({ email: "a@example.com", displayName: "A" });
    const userB = storage.createUser({ email: "b@example.com", displayName: "B" });

    storage.createSession({
      userId: userA.id,
      tokenHash: "hash-a",
      csrfTokenHash: "csrf-a",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    storage.createSession({
      userId: userB.id,
      tokenHash: "hash-b",
      csrfTokenHash: "csrf-b",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    storage.revokeAllSessionsByUser(userA.id);
    expect(storage.listSessionsByUser(userA.id)).toHaveLength(0);
    expect(storage.listSessionsByUser(userB.id)).toHaveLength(1);
  });
});
