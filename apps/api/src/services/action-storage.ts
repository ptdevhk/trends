import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

export type CandidateActionType =
  | "star"
  | "shortlist"
  | "reject"
  | "archive"
  | "note"
  | "contact"
  | "rating"
  | "ai_score_like"
  | "ai_score_unlike"
  | "ai_summary_like"
  | "ai_summary_unlike";

/**
 * Action type group used for "latest per group" retrieval.
 * Primary candidate actions (star/shortlist/reject/archive/note/contact) form one group,
 * while each AI feedback dimension forms its own group so they coexist.
 */
export type ActionTypeGroup = "primary" | "rating" | "ai_score" | "ai_summary";

const AI_SCORE_TYPES = ["ai_score_like", "ai_score_unlike"] as const;
const AI_SUMMARY_TYPES = ["ai_summary_like", "ai_summary_unlike"] as const;
const AI_FEEDBACK_TYPES = [...AI_SCORE_TYPES, ...AI_SUMMARY_TYPES] as const;
const AI_SCORE_TYPE_SET: ReadonlySet<string> = new Set(AI_SCORE_TYPES);
const AI_SUMMARY_TYPE_SET: ReadonlySet<string> = new Set(AI_SUMMARY_TYPES);
const AI_FEEDBACK_TYPES_SQL = AI_FEEDBACK_TYPES.map((actionType) => `'${actionType}'`).join(", ");
function jsonExtractSql(column: string, path: string): string {
  return `CASE WHEN json_valid(${column}) THEN json_extract(${column}, '${path}') ELSE NULL END`;
}
const ACTION_DATA_SCOPE_ID_SQL = jsonExtractSql("action_data", "$.scopeId");
const ACTION_DATA_JOB_DESCRIPTION_ID_SQL = jsonExtractSql("action_data", "$.jobDescriptionId");
const CA_ACTION_DATA_SCOPE_ID_SQL = jsonExtractSql("ca.action_data", "$.scopeId");
const ACTION_GROUP_CASE_SQL = `
  CASE
    WHEN action_type = 'rating' THEN 'rating'
    WHEN action_type IN ('ai_score_like', 'ai_score_unlike') THEN 'ai_score'
    WHEN action_type IN ('ai_summary_like', 'ai_summary_unlike') THEN 'ai_summary'
    ELSE 'primary'
  END
`;
const SESSION_SCOPE_WHERE_SQL = `
  (
    session_id = ?
    OR ${ACTION_DATA_SCOPE_ID_SQL} = ?
  )
`;
const AI_JOB_DESCRIPTION_WHERE_SQL = `
  (
    action_type NOT IN (${AI_FEEDBACK_TYPES_SQL})
    OR ${ACTION_DATA_JOB_DESCRIPTION_ID_SQL} IS NULL
    OR ${ACTION_DATA_JOB_DESCRIPTION_ID_SQL} = ?
  )
`;

const WORKSPACE_JOIN_SQL = `
  LEFT JOIN search_sessions persisted_session
    ON persisted_session.id = ca.session_id
  LEFT JOIN search_sessions scoped_session
    ON scoped_session.id = ${CA_ACTION_DATA_SCOPE_ID_SQL}
  LEFT JOIN review_packet_runs persisted_packet
    ON persisted_packet.id = CASE
      WHEN ca.session_id LIKE 'review-packet:%' THEN substr(ca.session_id, 15)
      ELSE NULL
    END
  LEFT JOIN review_packet_runs scoped_packet
    ON scoped_packet.id = CASE
      WHEN ${CA_ACTION_DATA_SCOPE_ID_SQL} LIKE 'review-packet:%'
        THEN substr(${CA_ACTION_DATA_SCOPE_ID_SQL}, 15)
      ELSE NULL
    END`;

const WORKSPACE_COALESCE_SQL = `COALESCE(
  persisted_session.workspace_slug,
  scoped_session.workspace_slug,
  persisted_packet.workspace_slug,
  scoped_packet.workspace_slug
)`;

const WORKSPACE_MATCH_OR_ORPHAN_SQL = `(${WORKSPACE_COALESCE_SQL} = ? OR ${WORKSPACE_COALESCE_SQL} IS NULL)`;

export function actionTypeGroup(actionType: string): ActionTypeGroup {
  if (actionType === "rating") return "rating";
  if (AI_SCORE_TYPE_SET.has(actionType)) return "ai_score";
  if (AI_SUMMARY_TYPE_SET.has(actionType)) return "ai_summary";
  return "primary";
}

export type CandidateAction = {
  id: number;
  userId?: string;
  sessionId?: string;
  resumeId: string;
  actionType: CandidateActionType;
  actionData?: Record<string, unknown>;
  createdAt: string;
};

export type CandidateActionWindowSummary = {
  total: number;
  breakdown: Array<{
    actionType: CandidateActionType;
    count: number;
  }>;
};

const VALID_ACTION_TYPES = new Set<CandidateActionType>([
  "star",
  "shortlist",
  "reject",
  "archive",
  "note",
  "contact",
  "rating",
  "ai_score_like",
  "ai_score_unlike",
  "ai_summary_like",
  "ai_summary_unlike",
]);

function parseActionType(raw: unknown, rowId?: unknown): CandidateActionType | null {
  const value = String(raw);
  if (!VALID_ACTION_TYPES.has(value as CandidateActionType)) {
    console.error(
      `Invalid action_type in DB: ${JSON.stringify(value)}` +
      (rowId !== undefined ? `, row id=${String(rowId)}` : ""),
    );
    return null;
  }
  return value as CandidateActionType;
}

function parseJson(value: unknown, context: string): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    console.error(`Failed to parse ${context}`, error);
    return undefined;
  }
}

function normalizeAction(row: Record<string, unknown>): CandidateAction | null {
  const actionType = parseActionType(row.action_type, row.id);
  if (actionType === null) return null;
  return {
    id: Number(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    resumeId: String(row.resume_id),
    actionType,
    actionData: parseJson(row.action_data, `candidate action_data JSON for row id=${String(row.id)}`),
    createdAt: String(row.created_at),
  };
}

function parseRatingValue(actionData: Record<string, unknown> | undefined): number | undefined {
  const rating = actionData?.rating;
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 0 && rating <= 5
    ? rating
    : undefined;
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
    const normalizedSessionId = params.sessionId?.trim() || undefined;
    const persistedSessionId = normalizedSessionId && this.hasPersistedSession(normalizedSessionId)
      ? normalizedSessionId
      : undefined;
    const actionData = normalizedSessionId && !persistedSessionId
      ? {
          ...(params.actionData ?? {}),
          scopeId: normalizedSessionId,
        }
      : params.actionData;
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
        persistedSessionId ?? null,
        params.resumeId,
        params.actionType,
        actionData ? JSON.stringify(actionData) : null,
        now
      );

    return {
      id: Number(result.lastInsertRowid),
      userId: params.userId,
      sessionId: persistedSessionId ?? normalizedSessionId,
      resumeId: params.resumeId,
      actionType: params.actionType,
      actionData,
      createdAt: now,
    };
  }

  getActionsForSession(sessionId: string, jobDescriptionId?: string): CandidateAction[] {
    const rows = jobDescriptionId
      ? (
          this.db
            .prepare(
              `
              SELECT * FROM candidate_actions
              WHERE ${SESSION_SCOPE_WHERE_SQL}
                AND ${AI_JOB_DESCRIPTION_WHERE_SQL}
              ORDER BY created_at DESC
            `
            )
            .all(sessionId, sessionId, jobDescriptionId) as Record<string, unknown>[]
        )
      : (this.db
          .prepare(
            `
            SELECT * FROM candidate_actions
            WHERE ${SESSION_SCOPE_WHERE_SQL}
            ORDER BY created_at DESC
          `
          )
          .all(sessionId, sessionId) as Record<string, unknown>[]);

    return rows
      .map((row) => normalizeAction(row))
      .filter((action): action is CandidateAction => action !== null);
  }

  getLatestActionsForSession(sessionId: string, jobDescriptionId?: string): CandidateAction[] {
    const rows = jobDescriptionId
      ? (
          this.db
            .prepare(
              `
              SELECT a.* FROM candidate_actions a
              JOIN (
                SELECT resume_id,
                       ${ACTION_GROUP_CASE_SQL} AS action_group,
                       MAX(id) AS max_id
                FROM candidate_actions
                WHERE ${SESSION_SCOPE_WHERE_SQL}
                  AND ${AI_JOB_DESCRIPTION_WHERE_SQL}
                GROUP BY resume_id, action_group
              ) latest
              ON a.id = latest.max_id
              WHERE (
                  a.session_id = ?
                  OR json_extract(a.action_data, '$.scopeId') = ?
                )
              ORDER BY a.created_at DESC
            `
            )
            .all(sessionId, sessionId, jobDescriptionId, sessionId, sessionId) as Record<string, unknown>[]
        )
      : (
          this.db
            .prepare(
              `
              SELECT a.* FROM candidate_actions a
              JOIN (
                SELECT resume_id,
                       ${ACTION_GROUP_CASE_SQL} AS action_group,
                       MAX(id) AS max_id
                FROM candidate_actions
                WHERE ${SESSION_SCOPE_WHERE_SQL}
                GROUP BY resume_id, action_group
              ) latest
              ON a.id = latest.max_id
              WHERE (
                  a.session_id = ?
                  OR json_extract(a.action_data, '$.scopeId') = ?
                )
              ORDER BY a.created_at DESC
            `
            )
            .all(sessionId, sessionId, sessionId, sessionId) as Record<string, unknown>[]
        );

    return rows
      .map((row) => normalizeAction(row))
      .filter((action): action is CandidateAction => action !== null);
  }

  getLatestRatingsForSession(params: {
    sessionId: string;
    resumeIds: string[];
    jobDescriptionId?: string;
  }): Map<string, number> {
    const requestedResumeIds = new Set(
      params.resumeIds
        .map((resumeId) => resumeId.trim())
        .filter((resumeId) => resumeId.length > 0)
    );
    if (requestedResumeIds.size === 0) {
      return new Map();
    }

    const ratingsByResume = new Map<string, number>();
    const latestActions = this.getLatestActionsForSession(params.sessionId, params.jobDescriptionId);
    for (const action of latestActions) {
      const resumeId = action.resumeId.trim();
      if (action.actionType !== "rating" || !requestedResumeIds.has(resumeId)) {
        continue;
      }

      const rating = parseRatingValue(action.actionData);
      if (rating !== undefined && rating > 0) {
        ratingsByResume.set(resumeId, rating);
      }
    }

    return ratingsByResume;
  }

  summarizeActionsInWindow(params: {
    workspaceSlug: string;
    startAt: string;
    endAt: string;
  }): CandidateActionWindowSummary {
    const rows = this.db
      .prepare(
        `
        SELECT
          ca.action_type,
          COUNT(*) AS count
        FROM candidate_actions ca
        LEFT JOIN search_sessions persisted_session
          ON persisted_session.id = ca.session_id
        LEFT JOIN search_sessions scoped_session
          ON scoped_session.id = ${CA_ACTION_DATA_SCOPE_ID_SQL}
        LEFT JOIN review_packet_runs persisted_packet
          ON persisted_packet.id = CASE
            WHEN ca.session_id LIKE 'review-packet:%' THEN substr(ca.session_id, 15)
            ELSE NULL
          END
        LEFT JOIN review_packet_runs scoped_packet
          ON scoped_packet.id = CASE
            WHEN ${CA_ACTION_DATA_SCOPE_ID_SQL} LIKE 'review-packet:%'
              THEN substr(${CA_ACTION_DATA_SCOPE_ID_SQL}, 15)
            ELSE NULL
          END
        WHERE ca.created_at >= ?
          AND ca.created_at < ?
          AND COALESCE(
            persisted_session.workspace_slug,
            scoped_session.workspace_slug,
            persisted_packet.workspace_slug,
            scoped_packet.workspace_slug
          ) = ?
        GROUP BY ca.action_type
        ORDER BY count DESC, ca.action_type ASC
      `
      )
      .all(params.startAt, params.endAt, params.workspaceSlug) as Array<{
      action_type?: unknown;
      count?: unknown;
    }>;

    const breakdown = rows
      .map((row) => ({
        actionType: parseActionType(row.action_type),
        count: Number(row.count ?? 0),
      }))
      .filter((row): row is { actionType: CandidateActionType; count: number } => row.actionType !== null && row.count > 0);

    return {
      total: breakdown.reduce((sum, item) => sum + item.count, 0),
      breakdown,
    };
  }

  private hasPersistedSession(sessionId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM search_sessions WHERE id = ? LIMIT 1")
      .get(sessionId) as Record<string, unknown> | undefined;

    return Boolean(row);
  }

  listActionsForBackup(params: {
    workspaceSlug: string;
    resumeIds?: string[];
  }): CandidateActionBackupRow[] {
    const { workspaceSlug, resumeIds } = params;

    if (resumeIds && resumeIds.length > 0) {
      const placeholders = resumeIds.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `
          SELECT ca.resume_id, ca.action_type, ca.action_data, ca.session_id, ca.created_at
          FROM candidate_actions ca
          ${WORKSPACE_JOIN_SQL}
          WHERE (${WORKSPACE_MATCH_OR_ORPHAN_SQL} OR ca.resume_id IN (${placeholders}))
          ORDER BY ca.created_at ASC
          `
        )
        .all(workspaceSlug, ...resumeIds) as Record<string, unknown>[];

      return rows
        .map((row) => normalizeBackupRow(row))
        .filter((row): row is CandidateActionBackupRow => row !== null);
    }

    const rows = this.db
      .prepare(
        `
        SELECT ca.resume_id, ca.action_type, ca.action_data, ca.session_id, ca.created_at
        FROM candidate_actions ca
        ${WORKSPACE_JOIN_SQL}
        WHERE ${WORKSPACE_MATCH_OR_ORPHAN_SQL}
        ORDER BY ca.created_at ASC
        `
      )
      .all(workspaceSlug) as Record<string, unknown>[];

    return rows
      .map((row) => normalizeBackupRow(row))
      .filter((row): row is CandidateActionBackupRow => row !== null);
  }

  replayActions(params: {
    actions: CandidateActionBackupRow[];
    mode: "replace" | "merge";
  }): { replayed: number; deduped: number } {
    const { actions, mode } = params;
    const insert = this.db.prepare(
      `INSERT INTO candidate_actions (resume_id, action_type, action_data, created_at) VALUES (?, ?, ?, ?)`
    );

    const replayInTransaction = this.db.transaction((actions: CandidateActionBackupRow[]) => {
      if (mode === "merge") {
        const resumeIds = [...new Set(actions.map((a) => a.resumeId))];
        const placeholders = resumeIds.map(() => "?").join(",");
        const existing = this.db
          .prepare(
            `SELECT resume_id, action_type, action_data, created_at FROM candidate_actions WHERE resume_id IN (${placeholders})`
          )
          .all(...resumeIds) as Record<string, unknown>[];

        const existingKeys = new Set(
          existing.map((row) =>
            `${String(row.resume_id)}|${String(row.action_type)}|${String(row.created_at)}|${String(row.action_data ?? "")}`
          )
        );

        let replayed = 0;
        let deduped = 0;
        for (const action of actions) {
          const actionDataJson = action.actionData ? JSON.stringify(action.actionData) : null;
          const key = `${action.resumeId}|${action.actionType}|${action.createdAt}|${actionDataJson ?? ""}`;
          if (existingKeys.has(key)) {
            deduped++;
            continue;
          }
          insert.run(action.resumeId, action.actionType, actionDataJson, action.createdAt);
          replayed++;
        }
        return { replayed, deduped };
      }

      for (const action of actions) {
        const actionDataJson = action.actionData ? JSON.stringify(action.actionData) : null;
        insert.run(action.resumeId, action.actionType, actionDataJson, action.createdAt);
      }

      return { replayed: actions.length, deduped: 0 };
    });

    return replayInTransaction(actions);
  }

  clearActionsForWorkspace(workspaceSlug: string, includeOrphans?: boolean): number {
    const whereClause = includeOrphans
      ? WORKSPACE_MATCH_OR_ORPHAN_SQL
      : `${WORKSPACE_COALESCE_SQL} = ?`;

    const result = this.db
      .prepare(
        `
        DELETE FROM candidate_actions
        WHERE id IN (
          SELECT ca.id FROM candidate_actions ca
          ${WORKSPACE_JOIN_SQL}
          WHERE ${whereClause}
        )
        `
      )
      .run(workspaceSlug);
    return Number(result.changes);
  }
}

export type CandidateActionBackupRow = {
  resumeId: string;
  actionType: CandidateActionType;
  actionData?: Record<string, unknown>;
  scopeId?: string;
  createdAt: string;
};

function normalizeBackupRow(row: Record<string, unknown>): CandidateActionBackupRow | null {
  const actionType = parseActionType(row.action_type, row.resume_id);
  if (actionType === null) return null;
  const sessionId = typeof row.session_id === "string" ? row.session_id : undefined;
  const actionDataRaw = row.action_data;
  let actionData: Record<string, unknown> | undefined;
  if (typeof actionDataRaw === "string" && actionDataRaw.trim()) {
    actionData = parseJson(
      actionDataRaw,
      `candidate action backup action_data JSON for resume_id=${String(row.resume_id)}`,
    );
  } else if (typeof actionDataRaw === "object" && actionDataRaw !== null) {
    actionData = actionDataRaw as Record<string, unknown>;
  }

  const scopeId = (actionData?.scopeId as string | undefined)
    || (sessionId?.startsWith("review-packet:") ? sessionId : undefined);

  return {
    resumeId: String(row.resume_id),
    actionType,
    ...(actionData ? { actionData } : {}),
    ...(scopeId ? { scopeId } : {}),
    createdAt: String(row.created_at),
  };
}
