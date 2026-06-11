import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";
import type {
  AuthProvider,
  AuthUser,
  StoredOidcState,
  WorkspaceMembership,
  WorkspaceRole,
} from "./auth-types.js";
import type { AuthEventInput } from "./auth-event-types.js";
import type { PasswordCredential } from "./local-password-provider.js";

type IdentityRow = {
  user_id?: unknown;
};

type ProviderIdentityRow = {
  user_id?: unknown;
  provider?: unknown;
  provider_subject?: unknown;
  provider_tenant?: unknown;
  email?: unknown;
  display_name?: unknown;
  updated_at?: unknown;
};

type MembershipRow = {
  user_id: string;
  workspace_slug: string;
  role: WorkspaceRole;
};

type ProviderMembershipPreapprovalRow = {
  id?: unknown;
  workspace_slug?: unknown;
  role?: unknown;
  operator_id?: unknown;
};

type ProviderMembershipPreapprovalListRow = ProviderMembershipPreapprovalRow & {
  provider?: unknown;
  provider_subject?: unknown;
  provider_tenant?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  revoked_at?: unknown;
  revoked_by?: unknown;
};

type ProviderMembershipGrantRow = {
  id?: unknown;
  user_id?: unknown;
  workspace_slug?: unknown;
  role?: unknown;
  membership_created?: unknown;
};

type ProviderMembershipGrantListRow = ProviderMembershipGrantRow & {
  preapproval_id?: unknown;
  provider?: unknown;
  provider_subject?: unknown;
  provider_tenant?: unknown;
  granted_at?: unknown;
  revoked_at?: unknown;
};

type PasswordCredentialRow = {
  user_id?: unknown;
  password_hash?: unknown;
  salt?: unknown;
  scrypt_n?: unknown;
  scrypt_r?: unknown;
  scrypt_p?: unknown;
  key_length?: unknown;
  must_change_password?: unknown;
  password_changed_at?: unknown;
};

type UserRow = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  display_name?: unknown;
  status?: unknown;
};

export type StoredAuthSession = {
  id: string;
  userId: string;
  csrfTokenHash: string;
  expiresAt: string;
};

export type StoredPasswordCredential = PasswordCredential & {
  userId: string;
  mustChangePassword: boolean;
  passwordChangedAt?: string;
};

type SessionRow = {
  id?: unknown;
  user_id?: unknown;
  csrf_token_hash?: unknown;
  expires_at?: unknown;
  revoked_at?: unknown;
};

type OidcStateRow = {
  state?: unknown;
  provider?: unknown;
  code_verifier?: unknown;
  nonce?: unknown;
  redirect_to?: unknown;
  expires_at?: unknown;
};

export type ProviderMembershipPreapprovalInput = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  operatorId: string;
};

export type ProviderMembershipApplyInput = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string;
  userId: string;
};

export type ProviderMembershipRevokeInput = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string;
  workspaceSlug: string;
  operatorId: string;
};

export type ProviderIdentityRecord = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string | null;
  userId: string;
  email?: string;
  displayName?: string;
  updatedAt: string;
};

export type ProviderMembershipPreapprovalRecord = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  operatorId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokedBy?: string;
};

export type ProviderMembershipGrantRecord = {
  provider: AuthProvider;
  providerSubject: string;
  providerTenant: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  userId: string;
  preapprovalId: string;
  active: boolean;
  grantedAt: string;
  revokedAt?: string;
};

export type ProviderIdentityListInput = {
  provider?: AuthProvider;
};

export type ProviderMembershipPreapprovalListInput = {
  provider?: AuthProvider;
  workspaceSlug?: string;
  includeRevoked?: boolean;
};

export type ProviderMembershipGrantListInput = {
  provider?: AuthProvider;
  workspaceSlug?: string;
  includeRevoked?: boolean;
};

function toIsoNow(): string {
  return formatIsoOffsetInTimezone(new Date(), config.timezone);
}

function isAuthProvider(value: unknown): value is AuthProvider {
  return value === "local" || value === "casdoor";
}

function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === "user" || value === "admin";
}

export class AuthStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  createUser(input: { email?: string; displayName?: string }): AuthUser {
    const id = randomUUID();
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO users (id, email, name, display_name, status, created_at, last_active_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      input.email ?? null,
      input.displayName ?? null,
      input.displayName ?? null,
      now,
      now,
    );

    return {
      id,
      email: input.email,
      displayName: input.displayName,
      status: "active",
    };
  }

  findUser(userId: string): AuthUser | null {
    const row = this.db
      .prepare("SELECT id, email, name, display_name, status FROM users WHERE id = ?")
      .get(userId) as UserRow | undefined;

    if (!row || typeof row.id !== "string") {
      return null;
    }

    const status = typeof row.status === "string" ? row.status : "active";
    if (status !== "active") {
      return null;
    }

    const displayName = typeof row.display_name === "string"
      ? row.display_name
      : typeof row.name === "string"
        ? row.name
        : undefined;

    return {
      id: row.id,
      email: typeof row.email === "string" ? row.email : undefined,
      displayName,
      status: "active",
    };
  }

  linkIdentity(input: {
    userId: string;
    provider: AuthProvider;
    providerSubject: string;
    providerTenant?: string;
    email?: string;
    displayName?: string;
    rawProfile?: unknown;
  }): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO auth_identities (
        id,
        user_id,
        provider,
        provider_subject,
        provider_tenant,
        email,
        display_name,
        raw_profile_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject, provider_tenant)
      DO UPDATE SET
        user_id = excluded.user_id,
        email = excluded.email,
        display_name = excluded.display_name,
        raw_profile_json = excluded.raw_profile_json,
        updated_at = excluded.updated_at
    `).run(
      randomUUID(),
      input.userId,
      input.provider,
      input.providerSubject,
      input.providerTenant ?? null,
      input.email ?? null,
      input.displayName ?? null,
      input.rawProfile === undefined ? null : JSON.stringify(input.rawProfile),
      now,
      now,
    );
  }

  findIdentity(
    provider: AuthProvider,
    providerSubject: string,
    providerTenant?: string,
  ): { userId: string } | null {
    const row = this.db.prepare(`
      SELECT user_id FROM auth_identities
      WHERE provider = ? AND provider_subject = ? AND provider_tenant IS ?
    `).get(provider, providerSubject, providerTenant ?? null) as IdentityRow | undefined;

    return typeof row?.user_id === "string" ? { userId: row.user_id } : null;
  }

  listProviderIdentities(input: ProviderIdentityListInput = {}): ProviderIdentityRecord[] {
    const where: string[] = [];
    const params: string[] = [];
    if (input.provider) {
      where.push("provider = ?");
      params.push(input.provider);
    }

    const rows = this.db.prepare(`
      SELECT
        user_id,
        provider,
        provider_subject,
        provider_tenant,
        email,
        display_name,
        updated_at
      FROM auth_identities
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY provider ASC, provider_tenant ASC, provider_subject ASC
    `).all(...params) as ProviderIdentityRow[];

    return rows.flatMap((row) => {
      if (
        !isAuthProvider(row.provider)
        || typeof row.provider_subject !== "string"
        || typeof row.user_id !== "string"
        || typeof row.updated_at !== "string"
      ) {
        return [];
      }

      return [{
        provider: row.provider,
        providerSubject: row.provider_subject,
        providerTenant: typeof row.provider_tenant === "string" ? row.provider_tenant : null,
        userId: row.user_id,
        email: typeof row.email === "string" ? row.email : undefined,
        displayName: typeof row.display_name === "string" ? row.display_name : undefined,
        updatedAt: row.updated_at,
      }];
    });
  }

  preapproveProviderMembership(input: ProviderMembershipPreapprovalInput): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO auth_provider_membership_preapprovals (
        id,
        provider,
        provider_subject,
        provider_tenant,
        workspace_slug,
        role,
        operator_id,
        created_at,
        updated_at,
        revoked_at,
        revoked_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(provider, provider_subject, provider_tenant, workspace_slug)
      DO UPDATE SET
        role = excluded.role,
        operator_id = excluded.operator_id,
        updated_at = excluded.updated_at,
        revoked_at = NULL,
        revoked_by = NULL
    `).run(
      randomUUID(),
      input.provider,
      input.providerSubject,
      input.providerTenant,
      input.workspaceSlug,
      input.role,
      input.operatorId,
      now,
      now,
    );

    const existingIdentity = this.findIdentity(input.provider, input.providerSubject, input.providerTenant);
    if (existingIdentity) {
      this.applyProviderMembershipPreapprovals({
        provider: input.provider,
        providerSubject: input.providerSubject,
        providerTenant: input.providerTenant,
        userId: existingIdentity.userId,
      });
    }
  }

  listProviderMembershipPreapprovals(
    input: ProviderMembershipPreapprovalListInput = {},
  ): ProviderMembershipPreapprovalRecord[] {
    const where: string[] = [];
    const params: string[] = [];
    if (input.provider) {
      where.push("provider = ?");
      params.push(input.provider);
    }
    if (input.workspaceSlug) {
      where.push("workspace_slug = ?");
      params.push(input.workspaceSlug);
    }
    if (!input.includeRevoked) {
      where.push("revoked_at IS NULL");
    }

    const rows = this.db.prepare(`
      SELECT
        provider,
        provider_subject,
        provider_tenant,
        workspace_slug,
        role,
        operator_id,
        created_at,
        updated_at,
        revoked_at,
        revoked_by
      FROM auth_provider_membership_preapprovals
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY provider ASC, workspace_slug ASC, provider_tenant ASC, provider_subject ASC
    `).all(...params) as ProviderMembershipPreapprovalListRow[];

    return rows.flatMap((row) => {
      if (
        !isAuthProvider(row.provider)
        || typeof row.provider_subject !== "string"
        || typeof row.provider_tenant !== "string"
        || typeof row.workspace_slug !== "string"
        || !isWorkspaceRole(row.role)
        || typeof row.operator_id !== "string"
        || typeof row.created_at !== "string"
        || typeof row.updated_at !== "string"
      ) {
        return [];
      }

      const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : undefined;
      return [{
        provider: row.provider,
        providerSubject: row.provider_subject,
        providerTenant: row.provider_tenant,
        workspaceSlug: row.workspace_slug,
        role: row.role,
        operatorId: row.operator_id,
        active: !revokedAt,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        revokedAt,
        revokedBy: typeof row.revoked_by === "string" ? row.revoked_by : undefined,
      }];
    });
  }

  listProviderMembershipGrants(input: ProviderMembershipGrantListInput = {}): ProviderMembershipGrantRecord[] {
    const where: string[] = [];
    const params: string[] = [];
    if (input.provider) {
      where.push("provider = ?");
      params.push(input.provider);
    }
    if (input.workspaceSlug) {
      where.push("workspace_slug = ?");
      params.push(input.workspaceSlug);
    }
    if (!input.includeRevoked) {
      where.push("revoked_at IS NULL");
    }

    const rows = this.db.prepare(`
      SELECT
        preapproval_id,
        user_id,
        provider,
        provider_subject,
        provider_tenant,
        workspace_slug,
        role,
        granted_at,
        revoked_at
      FROM auth_provider_membership_grants
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY provider ASC, workspace_slug ASC, provider_tenant ASC, provider_subject ASC, user_id ASC
    `).all(...params) as ProviderMembershipGrantListRow[];

    return rows.flatMap((row) => {
      if (
        !isAuthProvider(row.provider)
        || typeof row.provider_subject !== "string"
        || typeof row.provider_tenant !== "string"
        || typeof row.workspace_slug !== "string"
        || !isWorkspaceRole(row.role)
        || typeof row.user_id !== "string"
        || typeof row.preapproval_id !== "string"
        || typeof row.granted_at !== "string"
      ) {
        return [];
      }

      const revokedAt = typeof row.revoked_at === "string" ? row.revoked_at : undefined;
      return [{
        provider: row.provider,
        providerSubject: row.provider_subject,
        providerTenant: row.provider_tenant,
        workspaceSlug: row.workspace_slug,
        role: row.role,
        userId: row.user_id,
        preapprovalId: row.preapproval_id,
        active: !revokedAt,
        grantedAt: row.granted_at,
        revokedAt,
      }];
    });
  }

  applyProviderMembershipPreapprovals(input: ProviderMembershipApplyInput): WorkspaceMembership[] {
    const rows = this.db.prepare(`
      SELECT id, workspace_slug, role, operator_id
      FROM auth_provider_membership_preapprovals
      WHERE provider = ?
        AND provider_subject = ?
        AND provider_tenant = ?
        AND revoked_at IS NULL
      ORDER BY workspace_slug ASC
    `).all(
      input.provider,
      input.providerSubject,
      input.providerTenant,
    ) as ProviderMembershipPreapprovalRow[];

    const memberships: WorkspaceMembership[] = [];
    for (const row of rows) {
      if (
        typeof row.id !== "string"
        || typeof row.workspace_slug !== "string"
        || !isWorkspaceRole(row.role)
        || typeof row.operator_id !== "string"
      ) {
        continue;
      }

      const membership: WorkspaceMembership = {
        userId: input.userId,
        workspaceSlug: row.workspace_slug,
        role: row.role,
      };
      const existingMembership = this.findMembership(input.userId, row.workspace_slug);
      const existingGrant = this.findActiveProviderMembershipGrant({
        ...input,
        workspaceSlug: row.workspace_slug,
      });
      const isNewGrant = !existingGrant || existingGrant.role !== row.role;
      const membershipCreated = existingGrant ? existingGrant.membershipCreated : existingMembership === null;

      this.upsertMembership(membership);
      if (isNewGrant) {
        this.upsertProviderMembershipGrant({
          ...input,
          preapprovalId: row.id,
          workspaceSlug: row.workspace_slug,
          role: row.role,
          membershipCreated,
        });
        this.appendAuthEvent({
          type: "workspace_membership_granted",
          userId: input.userId,
          provider: input.provider,
          workspaceSlug: row.workspace_slug,
          metadata: {
            operatorId: row.operator_id,
            providerSubject: input.providerSubject,
            providerTenant: input.providerTenant,
            role: row.role,
          },
        });
      }
      memberships.push(membership);
    }

    return memberships;
  }

  revokeProviderMembershipPreapproval(input: ProviderMembershipRevokeInput): void {
    const preapproval = this.db.prepare(`
      SELECT id, role
      FROM auth_provider_membership_preapprovals
      WHERE provider = ?
        AND provider_subject = ?
        AND provider_tenant = ?
        AND workspace_slug = ?
        AND revoked_at IS NULL
    `).get(
      input.provider,
      input.providerSubject,
      input.providerTenant,
      input.workspaceSlug,
    ) as ProviderMembershipPreapprovalRow | undefined;

    if (typeof preapproval?.id !== "string" || !isWorkspaceRole(preapproval.role)) {
      return;
    }

    const now = toIsoNow();
    const grants = this.db.prepare(`
      SELECT id, user_id, workspace_slug, role, membership_created
      FROM auth_provider_membership_grants
      WHERE provider = ?
        AND provider_subject = ?
        AND provider_tenant = ?
        AND workspace_slug = ?
        AND revoked_at IS NULL
    `).all(
      input.provider,
      input.providerSubject,
      input.providerTenant,
      input.workspaceSlug,
    ) as ProviderMembershipGrantRow[];

    this.db.prepare(`
      UPDATE auth_provider_membership_preapprovals
      SET revoked_at = ?, revoked_by = ?, updated_at = ?
      WHERE id = ?
    `).run(now, input.operatorId, now, preapproval.id);

    for (const grant of grants) {
      if (
        typeof grant.id !== "string"
        || typeof grant.user_id !== "string"
        || typeof grant.workspace_slug !== "string"
        || !isWorkspaceRole(grant.role)
      ) {
        continue;
      }

      if (grant.membership_created !== 0) {
        this.deleteProviderGrantedMembership({
          userId: grant.user_id,
          workspaceSlug: grant.workspace_slug,
          role: grant.role,
        });
      }
      this.db.prepare(`
        UPDATE auth_provider_membership_grants
        SET revoked_at = ?
        WHERE id = ?
      `).run(now, grant.id);
      this.appendAuthEvent({
        type: "workspace_membership_revoked",
        userId: grant.user_id,
        provider: input.provider,
        workspaceSlug: grant.workspace_slug,
        metadata: {
          operatorId: input.operatorId,
          providerSubject: input.providerSubject,
          providerTenant: input.providerTenant,
          role: grant.role,
        },
      });
    }
  }

  upsertMembership(input: WorkspaceMembership): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO workspace_memberships (user_id, workspace_slug, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workspace_slug)
      DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
    `).run(input.userId, input.workspaceSlug, input.role, now, now);
  }

  replaceMemberships(userId: string, memberships: readonly Omit<WorkspaceMembership, "userId">[]): void {
    const replace = this.db.transaction(() => {
      this.db.prepare("DELETE FROM workspace_memberships WHERE user_id = ?").run(userId);
      for (const membership of memberships) {
        this.upsertMembership({ userId, ...membership });
      }
    });
    replace();
  }

  listMemberships(userId: string): WorkspaceMembership[] {
    const rows = this.db.prepare(`
      SELECT user_id, workspace_slug, role
      FROM workspace_memberships
      WHERE user_id = ?
      ORDER BY workspace_slug ASC
    `).all(userId) as MembershipRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      workspaceSlug: row.workspace_slug,
      role: row.role,
    }));
  }

  private findMembership(userId: string, workspaceSlug: string): WorkspaceMembership | null {
    const row = this.db.prepare(`
      SELECT user_id, workspace_slug, role
      FROM workspace_memberships
      WHERE user_id = ? AND workspace_slug = ?
    `).get(userId, workspaceSlug) as MembershipRow | undefined;

    return row ? {
      userId: row.user_id,
      workspaceSlug: row.workspace_slug,
      role: row.role,
    } : null;
  }

  private findActiveProviderMembershipGrant(input: {
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    userId: string;
  }): { role: WorkspaceRole; membershipCreated: boolean } | null {
    const row = this.db.prepare(`
      SELECT role, membership_created
      FROM auth_provider_membership_grants
      WHERE provider = ?
        AND provider_subject = ?
        AND provider_tenant = ?
        AND workspace_slug = ?
        AND user_id = ?
        AND revoked_at IS NULL
    `).get(
      input.provider,
      input.providerSubject,
      input.providerTenant,
      input.workspaceSlug,
      input.userId,
    ) as ProviderMembershipGrantRow | undefined;

    return isWorkspaceRole(row?.role)
      ? { role: row.role, membershipCreated: row.membership_created !== 0 }
      : null;
  }

  private upsertProviderMembershipGrant(input: {
    preapprovalId: string;
    provider: AuthProvider;
    providerSubject: string;
    providerTenant: string;
    workspaceSlug: string;
    role: WorkspaceRole;
    userId: string;
    membershipCreated: boolean;
  }): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO auth_provider_membership_grants (
        id,
        preapproval_id,
        user_id,
        provider,
        provider_subject,
        provider_tenant,
        workspace_slug,
        role,
        membership_created,
        granted_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(provider, provider_subject, provider_tenant, workspace_slug, user_id)
      DO UPDATE SET
        preapproval_id = excluded.preapproval_id,
        role = excluded.role,
        membership_created = excluded.membership_created,
        granted_at = excluded.granted_at,
        revoked_at = NULL
    `).run(
      randomUUID(),
      input.preapprovalId,
      input.userId,
      input.provider,
      input.providerSubject,
      input.providerTenant,
      input.workspaceSlug,
      input.role,
      input.membershipCreated ? 1 : 0,
      now,
    );
  }

  private deleteProviderGrantedMembership(input: {
    userId: string;
    workspaceSlug: string;
    role: WorkspaceRole;
  }): void {
    this.db.prepare(`
      DELETE FROM workspace_memberships
      WHERE user_id = ? AND workspace_slug = ? AND role = ?
    `).run(input.userId, input.workspaceSlug, input.role);
  }

  private appendAuthEvent(input: AuthEventInput): void {
    this.db.prepare(`
      INSERT INTO auth_events (
        id,
        type,
        user_id,
        provider,
        workspace_slug,
        session_id,
        reason,
        metadata_json,
        ip_hash,
        user_agent,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.type,
      input.userId ?? null,
      input.provider ?? null,
      input.workspaceSlug ?? null,
      input.sessionId ?? null,
      input.reason ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.ipHash ?? null,
      input.userAgent ?? null,
      toIsoNow(),
    );
  }

  savePasswordCredential(input: PasswordCredential & {
    userId: string;
    mustChangePassword?: boolean;
  }): void {
    const now = toIsoNow();
    const mustChangePassword = input.mustChangePassword ?? true;
    this.db.prepare(`
      INSERT INTO auth_password_credentials (
        user_id,
        password_hash,
        salt,
        scrypt_n,
        scrypt_r,
        scrypt_p,
        key_length,
        must_change_password,
        password_changed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id)
      DO UPDATE SET
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        scrypt_n = excluded.scrypt_n,
        scrypt_r = excluded.scrypt_r,
        scrypt_p = excluded.scrypt_p,
        key_length = excluded.key_length,
        must_change_password = excluded.must_change_password,
        password_changed_at = excluded.password_changed_at,
        updated_at = excluded.updated_at
    `).run(
      input.userId,
      input.passwordHash,
      input.salt,
      input.scryptN,
      input.scryptR,
      input.scryptP,
      input.keyLength,
      mustChangePassword ? 1 : 0,
      mustChangePassword ? null : now,
      now,
      now,
    );
  }

  findPasswordCredential(userId: string): StoredPasswordCredential | null {
    const row = this.db.prepare(`
      SELECT
        user_id,
        password_hash,
        salt,
        scrypt_n,
        scrypt_r,
        scrypt_p,
        key_length,
        must_change_password,
        password_changed_at
      FROM auth_password_credentials
      WHERE user_id = ?
    `).get(userId) as PasswordCredentialRow | undefined;

    if (
      typeof row?.user_id !== "string"
      || typeof row.password_hash !== "string"
      || typeof row.salt !== "string"
      || typeof row.scrypt_n !== "number"
      || typeof row.scrypt_r !== "number"
      || typeof row.scrypt_p !== "number"
      || typeof row.key_length !== "number"
    ) {
      return null;
    }

    return {
      userId: row.user_id,
      passwordHash: row.password_hash,
      salt: row.salt,
      scryptN: row.scrypt_n,
      scryptR: row.scrypt_r,
      scryptP: row.scrypt_p,
      keyLength: row.key_length,
      mustChangePassword: row.must_change_password === 1,
      passwordChangedAt: typeof row.password_changed_at === "string" ? row.password_changed_at : undefined,
    };
  }

  createSession(input: {
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: string;
  }): StoredAuthSession {
    const id = randomUUID();
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO auth_sessions (
        id,
        user_id,
        token_hash,
        csrf_token_hash,
        created_at,
        expires_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(id, input.userId, input.tokenHash, input.csrfTokenHash, now, input.expiresAt);

    return {
      id,
      userId: input.userId,
      csrfTokenHash: input.csrfTokenHash,
      expiresAt: input.expiresAt,
    };
  }

  findSessionByTokenHash(tokenHash: string): StoredAuthSession | null {
    const row = this.db.prepare(`
      SELECT id, user_id, csrf_token_hash, expires_at, revoked_at
      FROM auth_sessions
      WHERE token_hash = ?
    `).get(tokenHash) as SessionRow | undefined;

    if (
      !row
      || typeof row.id !== "string"
      || typeof row.user_id !== "string"
      || typeof row.csrf_token_hash !== "string"
      || typeof row.expires_at !== "string"
      || row.revoked_at
    ) {
      return null;
    }

    if (Date.parse(row.expires_at) <= Date.now()) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      csrfTokenHash: row.csrf_token_hash,
      expiresAt: row.expires_at,
    };
  }

  revokeSessionByTokenHash(tokenHash: string): void {
    this.db.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(toIsoNow(), tokenHash);
  }

  saveOidcState(state: StoredOidcState): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO auth_oidc_states (
        state,
        provider,
        code_verifier,
        nonce,
        redirect_to,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(state)
      DO UPDATE SET
        provider = excluded.provider,
        code_verifier = excluded.code_verifier,
        nonce = excluded.nonce,
        redirect_to = excluded.redirect_to,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).run(
      state.state,
      state.provider,
      state.codeVerifier,
      state.nonce ?? null,
      state.redirectTo ?? null,
      now,
      state.expiresAt,
    );
  }

  consumeOidcState(state: string): StoredOidcState | null {
    const row = this.db.prepare(`
      SELECT state, provider, code_verifier, nonce, redirect_to, expires_at
      FROM auth_oidc_states
      WHERE state = ?
    `).get(state) as OidcStateRow | undefined;

    this.db.prepare("DELETE FROM auth_oidc_states WHERE state = ?").run(state);

    if (
      !row
      || row.provider !== "casdoor"
      || typeof row.state !== "string"
      || typeof row.code_verifier !== "string"
      || typeof row.expires_at !== "string"
      || Date.parse(row.expires_at) <= Date.now()
    ) {
      return null;
    }

    return {
      state: row.state,
      provider: row.provider,
      codeVerifier: row.code_verifier,
      nonce: typeof row.nonce === "string" ? row.nonce : undefined,
      redirectTo: typeof row.redirect_to === "string" ? row.redirect_to : undefined,
      expiresAt: row.expires_at,
    };
  }
}
