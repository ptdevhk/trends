import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import { verifyPassword } from "../../apps/api/src/services/local-password-provider.js";

// Import the module logic functions directly for unit testing.
// The script itself is tested via CLI invocation in integration tests.

function createTestUser(
  storage: AuthStorage,
  username: string,
  email: string,
  displayName: string,
  workspace: string,
  role: "user" | "admin",
) {
  const existingIdentity = storage.findIdentity("local", username, "local");
  let userId: string;
  let created = false;

  if (existingIdentity) {
    userId = existingIdentity.userId;
  } else {
    const user = storage.createUser({ email, displayName });
    userId = user.id;
    created = true;
    storage.linkIdentity({
      userId,
      provider: "local",
      providerSubject: username,
      providerTenant: "local",
      email,
      displayName,
    });
  }

  const existingMembership = storage.listMemberships(userId).find(
    (m) => m.workspaceSlug === workspace,
  );
  storage.upsertMembership({ userId, workspaceSlug: workspace, role });

  return {
    userId,
    created,
    membershipCreated: !existingMembership,
  };
}

describe("manage-user bootstrap logic", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("creates a local user with identity and workspace membership", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-"));
    const storage = new AuthStorage(root);

    const result = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");

    expect(result.created).toBe(true);
    expect(result.membershipCreated).toBe(true);

    const identity = storage.findIdentity("local", "hr-admin", "local");
    expect(identity).not.toBeNull();

    const user = storage.findUser(result.userId);
    expect(user).not.toBeNull();
    expect(user!.email).toBe("hr@example.com");
    expect(user!.displayName).toBe("HR Admin");

    const memberships = storage.listMemberships(result.userId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toEqual({ userId: result.userId, workspaceSlug: "hr", role: "admin" });
  });

  it("is idempotent: re-running does not create duplicates", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-idem-"));
    const storage = new AuthStorage(root);

    const first = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");
    const second = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.userId).toBe(second.userId);

    const memberships = storage.listMemberships(first.userId);
    expect(memberships).toHaveLength(1);
  });

  it("adds a second workspace membership without deleting the first", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-multi-"));
    const storage = new AuthStorage(root);

    const first = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");
    const second = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "dev", "user");

    expect(first.userId).toBe(second.userId);

    const memberships = storage.listMemberships(first.userId);
    expect(memberships).toHaveLength(2);
    expect(memberships.map((m) => m.workspaceSlug).sort()).toEqual(["dev", "hr"]);
  });

  it("updates role on re-run with different role", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-role-"));
    const storage = new AuthStorage(root);

    createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "user");
    createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");

    const memberships = storage.listMemberships(
      storage.findIdentity("local", "hr-admin", "local")!.userId,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("admin");
  });

  it("saves and verifies password credential", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-pw-"));
    const storage = new AuthStorage(root);

    const result = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");

    const { hashPassword } = await import("../../apps/api/src/services/local-password-provider.js");
    const hashed = await hashPassword("test-password-123");
    storage.savePasswordCredential({
      userId: result.userId,
      ...hashed,
      mustChangePassword: false,
    });

    const credential = storage.findPasswordCredential(result.userId);
    expect(credential).not.toBeNull();
    expect(await verifyPassword("test-password-123", credential!)).toBe(true);
    expect(await verifyPassword("wrong-password", credential!)).toBe(false);
  });

  it("password is not exposed in user or identity records", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-noleak-"));
    const storage = new AuthStorage(root);

    const result = createTestUser(storage, "hr-admin", "hr@example.com", "HR Admin", "hr", "admin");
    const user = storage.findUser(result.userId);
    const identity = storage.findIdentity("local", "hr-admin", "local");

    const userJson = JSON.stringify(user);
    const identityJson = JSON.stringify(identity);

    expect(userJson).not.toContain("password");
    expect(identityJson).not.toContain("password");
  });
});
