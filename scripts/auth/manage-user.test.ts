import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import { verifyPassword } from "../../apps/api/src/services/local-password-provider.js";

// Import the module logic functions directly for unit testing.
// The script itself is tested via CLI invocation in integration tests.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const manageUserScript = fileURLToPath(new URL("./manage-user.ts", import.meta.url));

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

  it("loads password-env from the project .env for direct dev CLI runs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-env-"));
    writeFileSync(path.join(root, ".env"), "AUTH_BOOTSTRAP_PASSWORD=demo-admin\n");

    const env = { ...process.env, PROJECT_ROOT: root };
    delete env.AUTH_BOOTSTRAP_PASSWORD;

    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        manageUserScript,
        "--username",
        "demo-admin",
        "--email",
        "demo-admin@example.com",
        "--display-name",
        "Demo Admin",
        "--workspace",
        "dev",
        "--role",
        "admin",
        "--replace-memberships",
        "--password-env",
        "AUTH_BOOTSTRAP_PASSWORD",
        "--output",
        "json",
      ],
      {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      },
    );

    expect(result.stderr).not.toContain("demo-admin");
    expect(result.stdout).not.toContain("demo-admin");
    expect(result.status).toBe(0);

    const output = JSON.parse(result.stdout) as { success: boolean; passwordSet: boolean };
    expect(output.success).toBe(true);
    expect(output.passwordSet).toBe(true);

    const storage = new AuthStorage(root);
    const identity = storage.findIdentity("local", "demo-admin", "local");
    expect(identity).not.toBeNull();

    const memberships = storage.listMemberships(identity!.userId);
    expect(memberships).toEqual([{ userId: identity!.userId, workspaceSlug: "dev", role: "admin" }]);

    const credential = storage.findPasswordCredential(identity!.userId);
    expect(credential).not.toBeNull();
    expect(await verifyPassword("demo-admin", credential!)).toBe(true);
  });

  it("does not load the project .env when explicitly disabled", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-no-env-"));
    writeFileSync(path.join(root, ".env"), "AUTH_BOOTSTRAP_PASSWORD=from-project-env\n");

    const env = { ...process.env, PROJECT_ROOT: root };
    delete env.AUTH_BOOTSTRAP_PASSWORD;

    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        manageUserScript,
        "--username",
        "demo-admin",
        "--workspace",
        "dev",
        "--role",
        "admin",
        "--no-load-project-env",
        "--password-env",
        "AUTH_BOOTSTRAP_PASSWORD",
        "--dry-run",
      ],
      {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("AUTH_BOOTSTRAP_PASSWORD is not set");
  });

  it("replaces legacy demo-admin workspace memberships when requested", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-manage-user-replace-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({
      email: "demo-admin@example.com",
      displayName: "Demo Admin",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "local",
      providerSubject: "demo-admin",
      providerTenant: "local",
      email: "demo-admin@example.com",
      displayName: "Demo Admin",
    });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "admin", role: "admin" });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "hr", role: "admin" });

    const result = spawnSync(
      "node",
      [
        "--import",
        "tsx",
        manageUserScript,
        "--username",
        "demo-admin",
        "--email",
        "demo-admin@example.com",
        "--display-name",
        "Demo Admin",
        "--workspace",
        "dev",
        "--role",
        "admin",
        "--replace-memberships",
        "--no-password",
        "--output",
        "json",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, PROJECT_ROOT: root },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { success: boolean; totalMemberships: number };
    expect(output.success).toBe(true);
    expect(output.totalMemberships).toBe(1);
    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "dev", role: "admin" },
    ]);
  });
});
