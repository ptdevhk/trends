import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AuthEventStorage } from "./auth-event-storage.js";
import { getResumeScreeningDb, resetResumeScreeningDb } from "./database.js";

describe("auth_events schema", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("creates auth_events table with correct columns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-schema-"));
    const db = getResumeScreeningDb(root);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toContain("auth_events");

    const columns = db.prepare("PRAGMA table_info(auth_events)").all() as Array<{ name: string }>;
    const columnNames = columns.map((col) => col.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("type");
    expect(columnNames).toContain("user_id");
    expect(columnNames).toContain("provider");
    expect(columnNames).toContain("workspace_slug");
    expect(columnNames).toContain("session_id");
    expect(columnNames).toContain("reason");
    expect(columnNames).toContain("metadata_json");
    expect(columnNames).toContain("ip_hash");
    expect(columnNames).toContain("user_agent");
    expect(columnNames).toContain("created_at");
  });

  it("creates indexes for common query patterns", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-idx-"));
    const db = getResumeScreeningDb(root);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'auth_events'")
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((idx) => idx.name);
    expect(indexNames).toContain("idx_auth_events_created_at");
    expect(indexNames).toContain("idx_auth_events_workspace");
    expect(indexNames).toContain("idx_auth_events_type");
    expect(indexNames).toContain("idx_auth_events_user");
  });
});

describe("AuthEventStorage", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("appends an event and retrieves it by listRecent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-append-"));
    const storage = new AuthEventStorage(root);

    storage.append({
      type: "login_success",
      userId: "user-1",
      provider: "local",
      workspaceSlug: "hr",
      sessionId: "session-1",
      reason: "credentials_valid",
      metadata: { username: "hr-admin" },
    });

    const events = storage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("login_success");
    expect(events[0].userId).toBe("user-1");
    expect(events[0].provider).toBe("local");
    expect(events[0].workspaceSlug).toBe("hr");
    expect(events[0].sessionId).toBe("session-1");
    expect(events[0].reason).toBe("credentials_valid");
    expect(events[0].metadata).toEqual({ username: "hr-admin" });
    expect(events[0].id).toBeDefined();
    expect(events[0].createdAt).toBeDefined();
  });

  it("appends events with nullable fields", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-null-"));
    const storage = new AuthEventStorage(root);

    storage.append({
      type: "login_failure",
      reason: "invalid_password",
    });

    const events = storage.listRecent({ limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("login_failure");
    expect(events[0].userId).toBeUndefined();
    expect(events[0].provider).toBeUndefined();
    expect(events[0].workspaceSlug).toBeUndefined();
    expect(events[0].sessionId).toBeUndefined();
    expect(events[0].reason).toBe("invalid_password");
    expect(events[0].metadata).toBeUndefined();
    expect(events[0].ipHash).toBeUndefined();
    expect(events[0].userAgent).toBeUndefined();
  });

  it("returns events ordered by created_at DESC", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-order-"));
    const storage = new AuthEventStorage(root);

    storage.append({ type: "login_success", userId: "u1" });
    storage.append({ type: "login_failure", userId: "u2" });
    storage.append({ type: "logout", userId: "u1" });

    const events = storage.listRecent({ limit: 10 });
    expect(events).toHaveLength(3);
    // Most recent first
    expect(events[0].type).toBe("logout");
    expect(events[1].type).toBe("login_failure");
    expect(events[2].type).toBe("login_success");
  });

  it("filters events by type", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-filter-type-"));
    const storage = new AuthEventStorage(root);

    storage.append({ type: "login_success", userId: "u1" });
    storage.append({ type: "login_failure", userId: "u2" });
    storage.append({ type: "login_success", userId: "u3" });

    const events = storage.listRecent({ limit: 10, type: "login_success" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "login_success")).toBe(true);
  });

  it("filters events by workspaceSlug", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-filter-ws-"));
    const storage = new AuthEventStorage(root);

    storage.append({ type: "login_success", workspaceSlug: "hr" });
    storage.append({ type: "login_success", workspaceSlug: "dev" });
    storage.append({ type: "login_failure", workspaceSlug: "hr" });

    const events = storage.listRecent({ limit: 10, workspaceSlug: "hr" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.workspaceSlug === "hr")).toBe(true);
  });

  it("filters events by userId", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-filter-user-"));
    const storage = new AuthEventStorage(root);

    storage.append({ type: "login_success", userId: "u1" });
    storage.append({ type: "login_success", userId: "u2" });
    storage.append({ type: "logout", userId: "u1" });

    const events = storage.listRecent({ limit: 10, userId: "u1" });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.userId === "u1")).toBe(true);
  });

  it("respects limit", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-limit-"));
    const storage = new AuthEventStorage(root);

    for (let i = 0; i < 5; i++) {
      storage.append({ type: "login_success", userId: `u${i}` });
    }

    const events = storage.listRecent({ limit: 3 });
    expect(events).toHaveLength(3);
  });

  it("truncates user-agent to 256 characters", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-ua-"));
    const storage = new AuthEventStorage(root);

    const longUA = "A".repeat(500);
    storage.append({ type: "login_success", userAgent: longUA });

    const events = storage.listRecent({ limit: 10 });
    expect(events[0].userAgent).toHaveLength(256);
  });

  it("normalizes metadata to JSON string", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-events-meta-"));
    const storage = new AuthEventStorage(root);

    storage.append({
      type: "login_failure",
      metadata: { username: "test", reason: "bad_password", count: 3 },
    });

    const events = storage.listRecent({ limit: 10 });
    expect(events[0].metadata).toEqual({ username: "test", reason: "bad_password", count: 3 });
  });

  it("round-trips new admin user-management event types", () => {
    const root = mkdtempSync(path.join(tmpdir(), "events-admin-"));
    const events = new AuthEventStorage(root);
    for (const type of [
      "user_created",
      "user_disabled",
      "user_enabled",
      "membership_granted_by_admin",
      "membership_revoked_by_admin",
    ] as const) {
      events.append({ type, userId: "uuid-x", workspaceSlug: "dev", metadata: { operatorId: "uuid-op" } });
    }
    const recent = events.listRecent({ limit: 10 });
    expect(recent.map((e) => e.type).sort()).toEqual([
      "membership_granted_by_admin",
      "membership_revoked_by_admin",
      "user_created",
      "user_disabled",
      "user_enabled",
    ]);
  });
});
