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

export type StoredAuthSession = {
  id: string;
  userId: string;
  csrfTokenHash: string;
  expiresAt: string;
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
