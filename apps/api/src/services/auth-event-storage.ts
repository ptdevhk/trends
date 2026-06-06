import { randomUUID } from "node:crypto";

import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";
import { config } from "./config.js";
import type {
  AuthEvent,
  AuthEventInput,
  AuthEventListOptions,
} from "./auth-event-types.js";

const MAX_USER_AGENT_LENGTH = 256;

type EventRow = {
  id?: unknown;
  type?: unknown;
  user_id?: unknown;
  provider?: unknown;
  workspace_slug?: unknown;
  session_id?: unknown;
  reason?: unknown;
  metadata_json?: unknown;
  ip_hash?: unknown;
  user_agent?: unknown;
  created_at?: unknown;
};

function toIsoNow(): string {
  return formatIsoOffsetInTimezone(new Date(), config.timezone);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseEvent(row: EventRow): AuthEvent {
  const metadata = typeof row.metadata_json === "string"
    ? JSON.parse(row.metadata_json) as Record<string, string | number | boolean | null>
    : undefined;

  return {
    id: typeof row.id === "string" ? row.id : "",
    type: row.type as AuthEvent["type"],
    userId: optionalString(row.user_id),
    provider: optionalString(row.provider) as AuthEvent["provider"],
    workspaceSlug: optionalString(row.workspace_slug),
    sessionId: optionalString(row.session_id),
    reason: optionalString(row.reason),
    metadata,
    ipHash: optionalString(row.ip_hash),
    userAgent: optionalString(row.user_agent),
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export class AuthEventStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  append(input: AuthEventInput): AuthEvent {
    const id = randomUUID();
    const now = toIsoNow();
    const userAgent = input.userAgent
      ? input.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
      : null;
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    this.db.prepare(`
      INSERT INTO auth_events (
        id, type, user_id, provider, workspace_slug, session_id,
        reason, metadata_json, ip_hash, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.userId ?? null,
      input.provider ?? null,
      input.workspaceSlug ?? null,
      input.sessionId ?? null,
      input.reason ?? null,
      metadataJson,
      input.ipHash ?? null,
      userAgent,
      now,
    );

    return {
      id,
      type: input.type,
      userId: input.userId,
      provider: input.provider,
      workspaceSlug: input.workspaceSlug,
      sessionId: input.sessionId,
      reason: input.reason,
      metadata: input.metadata,
      ipHash: input.ipHash,
      userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH),
      createdAt: now,
    };
  }

  listRecent(options: AuthEventListOptions = {}): AuthEvent[] {
    const limit = options.limit ?? 50;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }
    if (options.userId) {
      conditions.push("user_id = ?");
      params.push(options.userId);
    }
    if (options.workspaceSlug) {
      conditions.push("workspace_slug = ?");
      params.push(options.workspaceSlug);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = this.db.prepare(`
      SELECT id, type, user_id, provider, workspace_slug, session_id,
             reason, metadata_json, ip_hash, user_agent, created_at
      FROM auth_events
      ${where}
      ORDER BY created_at DESC, ROWID DESC
      LIMIT ?
    `).all(...params) as EventRow[];

    return rows.map(parseEvent);
  }
}
