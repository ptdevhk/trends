import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AuthEventStorage } from "../../apps/api/src/services/auth-event-storage.js";
import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import {
  executeProviderMembershipCommand,
  parseProviderMembershipArgs,
} from "./manage-provider-membership.js";

describe("manage-provider-membership CLI", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("parses list-identities JSON command", () => {
    expect(parseProviderMembershipArgs([
      "list-identities",
      "--provider",
      "casdoor",
      "--output",
      "json",
    ])).toEqual({
      action: "list-identities",
      provider: "casdoor",
      output: "json",
      dryRun: false,
    });
  });

  it("parses preapprove dry-run command", () => {
    expect(parseProviderMembershipArgs([
      "preapprove",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      "hr",
      "--role",
      "user",
      "--operator-id",
      "ops@example.com",
      "--dry-run",
      "--output",
      "json",
    ])).toEqual({
      action: "preapprove",
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "ops@example.com",
      output: "json",
      dryRun: true,
    });
  });

  it("parses revoke dry-run command", () => {
    expect(parseProviderMembershipArgs([
      "revoke",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      "hr",
      "--operator-id",
      "ops@example.com",
      "--dry-run",
      "--output",
      "json",
    ])).toEqual({
      action: "revoke",
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      operatorId: "ops@example.com",
      output: "json",
      dryRun: true,
    });
  });

  it("parses list-preapprovals JSON command", () => {
    expect(parseProviderMembershipArgs([
      "list-preapprovals",
      "--provider",
      "casdoor",
      "--workspace",
      "hr",
      "--output",
      "json",
    ])).toEqual({
      action: "list-preapprovals",
      provider: "casdoor",
      workspaceSlug: "hr",
      output: "json",
      dryRun: false,
    });
  });

  it("rejects missing required mutating command fields", () => {
    expect(() => parseProviderMembershipArgs([
      "preapprove",
      "--provider",
      "casdoor",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      "hr",
      "--role",
      "user",
      "--operator-id",
      "ops@example.com",
    ])).toThrow(/provider-subject/);

    expect(() => parseProviderMembershipArgs([
      "revoke",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--operator-id",
      "ops@example.com",
    ])).toThrow(/workspace/);
  });

  it("returns dry-run output without touching storage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-dry-"));
    const result = executeProviderMembershipCommand(
      parseProviderMembershipArgs([
        "preapprove",
        "--provider",
        "casdoor",
        "--provider-subject",
        "sub-1",
        "--provider-tenant",
        "tenant-1",
        "--workspace",
        "hr",
        "--role",
        "user",
        "--operator-id",
        "ops@example.com",
        "--dry-run",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    );

    expect(result).toEqual({
      success: true,
      dryRun: true,
      action: "preapprove",
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "ops@example.com",
    });

    const storage = new AuthStorage(root);
    expect(storage.listProviderMembershipPreapprovals({ provider: "casdoor" })).toEqual([]);
  });

  it("lists provider identities without raw profile payloads", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-list-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: user.email,
      displayName: user.displayName,
      rawProfile: {
        token: "secret-token",
        password: "secret-password",
        profile: "rawProfile",
      },
    });

    const result = executeProviderMembershipCommand(
      parseProviderMembershipArgs([
        "list-identities",
        "--provider",
        "casdoor",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    );

    expect(result).toEqual({
      success: true,
      action: "list-identities",
      identities: [
        {
          provider: "casdoor",
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          userId: user.id,
          email: "casdoor@example.com",
          displayName: "Casdoor User",
          updatedAt: expect.any(String),
        },
      ],
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/rawProfile|secret|token|password/);
  });

  it("preapproves existing linked identities and is idempotent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-preapprove-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: user.email,
      displayName: user.displayName,
    });

    const command = parseProviderMembershipArgs([
      "preapprove",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      "hr",
      "--role",
      "user",
      "--operator-id",
      "ops@example.com",
      "--output",
      "json",
    ]);

    const first = executeProviderMembershipCommand(command, { projectRoot: root });
    const second = executeProviderMembershipCommand(command, { projectRoot: root });

    expect(first).toMatchObject({
      success: true,
      action: "preapprove",
      preapproval: {
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        role: "user",
        active: true,
      },
      appliedMemberships: [
        { userId: user.id, workspaceSlug: "hr", role: "user" },
      ],
    });
    expect(second).toMatchObject({
      success: true,
      action: "preapprove",
      appliedMemberships: [
        { userId: user.id, workspaceSlug: "hr", role: "user" },
      ],
    });
    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "hr", role: "user" },
    ]);
    expect(new AuthEventStorage(root).listRecent({ limit: 10 })).toHaveLength(1);
  });

  it("lists preapprovals filtered by provider and workspace", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-preapprovals-"));
    const storage = new AuthStorage(root);
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "admin",
      operatorId: "ops@example.com",
    });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-2",
      providerTenant: "tenant-1",
      workspaceSlug: "dev",
      role: "user",
      operatorId: "ops@example.com",
    });

    const result = executeProviderMembershipCommand(
      parseProviderMembershipArgs([
        "list-preapprovals",
        "--provider",
        "casdoor",
        "--workspace",
        "hr",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    );

    expect(result).toMatchObject({
      success: true,
      action: "list-preapprovals",
      preapprovals: [
        {
          provider: "casdoor",
          providerSubject: "sub-1",
          providerTenant: "tenant-1",
          workspaceSlug: "hr",
          role: "admin",
          operatorId: "ops@example.com",
          active: true,
        },
      ],
    });
  });

  it("revokes provider-derived memberships without deleting unrelated manual memberships", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-revoke-"));
    const storage = new AuthStorage(root);
    const user = storage.createUser({
      email: "casdoor@example.com",
      displayName: "Casdoor User",
    });
    storage.linkIdentity({
      userId: user.id,
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      email: user.email,
      displayName: user.displayName,
    });
    storage.upsertMembership({ userId: user.id, workspaceSlug: "dev", role: "admin" });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "ops@example.com",
    });

    const result = executeProviderMembershipCommand(
      parseProviderMembershipArgs([
        "revoke",
        "--provider",
        "casdoor",
        "--provider-subject",
        "sub-1",
        "--provider-tenant",
        "tenant-1",
        "--workspace",
        "hr",
        "--operator-id",
        "ops@example.com",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    );

    expect(result).toMatchObject({
      success: true,
      action: "revoke",
      revoked: {
        provider: "casdoor",
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "hr",
        active: false,
      },
    });
    expect(storage.listMemberships(user.id)).toEqual([
      { userId: user.id, workspaceSlug: "dev", role: "admin" },
    ]);
    expect(new AuthEventStorage(root).listRecent({ limit: 10 })).toMatchObject([
      { type: "workspace_membership_revoked", workspaceSlug: "hr" },
      { type: "workspace_membership_granted", workspaceSlug: "hr" },
    ]);
  });
});
