import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { formatWorkspaceSlugList, listWorkspaceSlugs } from "@trends/shared";

import { AuthEventStorage } from "../../apps/api/src/services/auth-event-storage.js";
import { AuthStorage } from "../../apps/api/src/services/auth-storage.js";
import { resetResumeScreeningDb } from "../../apps/api/src/services/database.js";
import {
  executeProviderMembershipCommand,
  parseProviderMembershipArgs,
} from "./manage-provider-membership.js";
import type { ProviderMembershipCommandResult } from "./manage-provider-membership.js";

type AuditExportTestResult = Extract<ProviderMembershipCommandResult, { action: "export-audit" }>;

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

  it.each(listWorkspaceSlugs())("accepts registered workspace %s in provider membership commands", (slug) => {
    expect(parseProviderMembershipArgs([
      "preapprove",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      slug,
      "--role",
      "user",
      "--operator-id",
      "ops@example.com",
      "--output",
      "json",
    ])).toMatchObject({
      action: "preapprove",
      workspaceSlug: slug,
    });

    expect(parseProviderMembershipArgs([
      "revoke",
      "--provider",
      "casdoor",
      "--provider-subject",
      "sub-1",
      "--provider-tenant",
      "tenant-1",
      "--workspace",
      slug,
      "--operator-id",
      "ops@example.com",
      "--output",
      "json",
    ])).toMatchObject({
      action: "revoke",
      workspaceSlug: slug,
    });
  });

  it("parses provider audit export filters", () => {
    expect(parseProviderMembershipArgs([
      "export-audit",
      "--provider",
      "casdoor",
      "--workspace",
      "hr",
      "--status",
      "revoked",
      "--from",
      "2026-01-01T00:00:00Z",
      "--to",
      "2026-12-31T23:59:59Z",
      "--output",
      "json",
    ])).toEqual({
      action: "export-audit",
      provider: "casdoor",
      workspaceSlug: "hr",
      status: "revoked",
      from: "2026-01-01T00:00:00Z",
      to: "2026-12-31T23:59:59Z",
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

  it("rejects unknown preapprove workspaces before mutating storage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-invalid-preapprove-"));

    expect(() => {
      const command = parseProviderMembershipArgs([
        "preapprove",
        "--provider",
        "casdoor",
        "--provider-subject",
        "sub-1",
        "--provider-tenant",
        "tenant-1",
        "--workspace",
        "prod",
        "--role",
        "user",
        "--operator-id",
        "ops@example.com",
        "--output",
        "json",
      ]);
      executeProviderMembershipCommand(command, { projectRoot: root });
    }).toThrow(`--workspace must be one of: ${formatWorkspaceSlugList()}`);

    const storage = new AuthStorage(root);
    expect(storage.listProviderMembershipPreapprovals({ provider: "casdoor", includeRevoked: true })).toEqual([]);
  });

  it("rejects unknown revoke workspaces before mutating storage", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-invalid-revoke-"));
    const storage = new AuthStorage(root);
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "prod",
      role: "user",
      operatorId: "ops@example.com",
    });

    expect(() => {
      const command = parseProviderMembershipArgs([
        "revoke",
        "--provider",
        "casdoor",
        "--provider-subject",
        "sub-1",
        "--provider-tenant",
        "tenant-1",
        "--workspace",
        "prod",
        "--operator-id",
        "ops@example.com",
        "--output",
        "json",
      ]);
      executeProviderMembershipCommand(command, { projectRoot: root });
    }).toThrow(/workspace/i);

    expect(storage.listProviderMembershipPreapprovals({
      provider: "casdoor",
      workspaceSlug: "prod",
      includeRevoked: true,
    })).toMatchObject([
      {
        providerSubject: "sub-1",
        providerTenant: "tenant-1",
        workspaceSlug: "prod",
        active: true,
      },
    ]);
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

  it("exports redacted provider membership audit evidence with related event ids", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-audit-"));
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
        access_token: "secret-access-token",
        authorization: "Bearer secret",
        password: "secret-password",
      },
    });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      role: "user",
      operatorId: "ops@example.com",
    });
    storage.preapproveProviderMembership({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "dev",
      role: "admin",
      operatorId: "ops@example.com",
    });
    storage.revokeProviderMembershipPreapproval({
      provider: "casdoor",
      providerSubject: "sub-1",
      providerTenant: "tenant-1",
      workspaceSlug: "hr",
      operatorId: "ops@example.com",
    });

    const result = executeProviderMembershipCommand(
      parseProviderMembershipArgs([
        "export-audit",
        "--provider",
        "casdoor",
        "--workspace",
        "hr",
        "--status",
        "revoked",
        "--from",
        "2000-01-01T00:00:00Z",
        "--to",
        "2999-12-31T23:59:59Z",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    ) as unknown as AuditExportTestResult;

    expect(result).toMatchObject({
      success: true,
      action: "export-audit",
      filters: {
        provider: "casdoor",
        workspaceSlug: "hr",
        status: "revoked",
        from: "2000-01-01T00:00:00Z",
        to: "2999-12-31T23:59:59Z",
      },
      audit: {
        identities: [
          {
            providerSubject: "sub-1",
            providerTenant: "tenant-1",
            userId: user.id,
          },
        ],
        preapprovals: [
          {
            providerSubject: "sub-1",
            providerTenant: "tenant-1",
            workspaceSlug: "hr",
            active: false,
          },
        ],
        grants: [
          {
            providerSubject: "sub-1",
            providerTenant: "tenant-1",
            workspaceSlug: "hr",
            active: false,
          },
        ],
      },
    });
    expect(result.audit.preapprovals[0]?.relatedAuthEventIds).toHaveLength(2);
    expect(result.audit.grants[0]?.relatedAuthEventIds).toEqual(result.audit.preapprovals[0]?.relatedAuthEventIds);
    expect(result.audit.events.map((event) => event.type)).toEqual([
      "workspace_membership_revoked",
      "workspace_membership_granted",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/rawProfile|access_token|authorization|secret-access-token|secret-password|Bearer secret/i);
  });

  it("filters provider membership audit export by date range", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-provider-membership-audit-date-"));
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
        "export-audit",
        "--provider",
        "casdoor",
        "--from",
        "2999-01-01T00:00:00Z",
        "--output",
        "json",
      ]),
      { projectRoot: root },
    ) as unknown as AuditExportTestResult;

    expect(result.audit).toEqual({
      identities: [],
      preapprovals: [],
      grants: [],
      events: [],
    });
  });
});
