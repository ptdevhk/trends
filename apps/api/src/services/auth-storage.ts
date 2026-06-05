import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";
import type { AuthProvider, AuthUser, WorkspaceMembership, WorkspaceRole } from "./auth-types.js";

type IdentityRow = {
  user_id?: unknown;
};

type MembershipRow = {
  user_id: string;
  workspace_slug: string;
  role: WorkspaceRole;
};

type UserRow = {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  display_name?: unknown;
  status?: unknown;
};

function toIsoNow(): string {
  return formatIsoOffsetInTimezone(new Date(), config.timezone);
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

  upsertMembership(input: WorkspaceMembership): void {
    const now = toIsoNow();
    this.db.prepare(`
      INSERT INTO workspace_memberships (user_id, workspace_slug, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, workspace_slug)
      DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
    `).run(input.userId, input.workspaceSlug, input.role, now, now);
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
}
