import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

export type CandidateActionType = "star" | "shortlist" | "reject" | "archive" | "note" | "contact";

export type CandidateAction = {
  id: number;
  userId?: string;
  sessionId?: string;
  resumeId: string;
  actionType: CandidateActionType;
  actionData?: Record<string, unknown>;
  createdAt: string;
};

function parseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeAction(row: Record<string, unknown>): CandidateAction {
  return {
    id: Number(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    resumeId: String(row.resume_id),
    actionType: String(row.action_type) as CandidateActionType,
    actionData: parseJson(row.action_data),
    createdAt: String(row.created_at),
  };
}

export class ActionStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  saveAction(params: {
    userId?: string;
    sessionId?: string;
    resumeId: string;
    actionType: CandidateActionType;
    actionData?: Record<string, unknown>;
  }): CandidateAction {
    const now = formatIsoOffsetInTimezone(new Date(), config.timezone);
    const result = this.db
      .prepare(
        `
        INSERT INTO candidate_actions (
          user_id,
          session_id,
          resume_id,
          action_type,
          action_data,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        params.userId ?? null,
        params.sessionId ?? null,
        params.resumeId,
        params.actionType,
        params.actionData ? JSON.stringify(params.actionData) : null,
        now
      );

    return {
      id: Number(result.lastInsertRowid),
      userId: params.userId,
      sessionId: params.sessionId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData: params.actionData,
      createdAt: now,
    };
  }

  getActionsForSession(sessionId: string): CandidateAction[] {
    const rows = this.db
      .prepare("SELECT * FROM candidate_actions WHERE session_id = ? ORDER BY created_at DESC")
      .all(sessionId) as Record<string, unknown>[];

    return rows.map((row) => normalizeAction(row));
  }

  getLatestActionsForSession(sessionId: string): CandidateAction[] {
    const rows = this.db
      .prepare(
        `
        SELECT a.* FROM candidate_actions a
        JOIN (
          SELECT resume_id, MAX(created_at) AS created_at
          FROM candidate_actions
          WHERE session_id = ?
          GROUP BY resume_id
        ) latest
        ON a.resume_id = latest.resume_id AND a.created_at = latest.created_at
        WHERE a.session_id = ?
        ORDER BY a.created_at DESC
      `
      )
      .all(sessionId, sessionId) as Record<string, unknown>[];

    return rows.map((row) => normalizeAction(row));
  }
}
