import { getResumeScreeningDb } from "./database.js";
import type { MatchingResult } from "./ai-matching.js";

export type MatchRunMode = "rules_only" | "hybrid" | "ai_only";
export type MatchRunStatus = "processing" | "completed" | "failed";

export type StoredMatch = {
  id: number;
  sessionId?: string;
  userId?: string;
  resumeId: string;
  jobDescriptionId: string;
  sampleName?: string;
  score: number;
  recommendation: MatchingResult["recommendation"];
  highlights: string[];
  concerns: string[];
  summary: string;
  breakdown?: MatchingResult["breakdown"];
  scoreSource: "rule" | "ai";
  aiModel?: string;
  processingTimeMs?: number;
  matchedAt: string;
};

export type StoredMatchRun = {
  id: string;
  sessionId?: string;
  jobDescriptionId: string;
  sampleName?: string;
  mode: MatchRunMode;
  status: MatchRunStatus;
  totalCount: number;
  processedCount: number;
  failedCount: number;
  matchedCount?: number;
  avgScore?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
};

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(
  value: unknown
): MatchingResult["breakdown"] | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const requiredKeys = [
      "skillMatch",
      "experienceMatch",
      "educationMatch",
      "locationMatch",
      "industryMatch",
    ];
    const hasAllKeys = requiredKeys.every((key) => typeof parsed[key] === "number");
    if (!hasAllKeys) return undefined;
    return {
      skillMatch: Number(parsed.skillMatch),
      experienceMatch: Number(parsed.experienceMatch),
      educationMatch: Number(parsed.educationMatch),
      locationMatch: Number(parsed.locationMatch),
      industryMatch: Number(parsed.industryMatch),
    };
  } catch {
    return undefined;
  }
}

function normalizeMatch(row: Record<string, unknown>): StoredMatch {
  const scoreSource = row.score_source
    ? String(row.score_source)
    : String(row.ai_model || "").startsWith("rule")
      ? "rule"
      : "ai";

  return {
    id: Number(row.id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    resumeId: String(row.resume_id),
    jobDescriptionId: String(row.job_description_id),
    sampleName: row.sample_name ? String(row.sample_name) : undefined,
    score: Number(row.score),
    recommendation: String(row.recommendation) as StoredMatch["recommendation"],
    highlights: parseJsonArray(row.highlights),
    concerns: parseJsonArray(row.concerns),
    summary: row.summary ? String(row.summary) : "",
    breakdown: parseJsonObject(row.breakdown),
    scoreSource: scoreSource === "rule" ? "rule" : "ai",
    aiModel: row.ai_model ? String(row.ai_model) : undefined,
    processingTimeMs: row.processing_time_ms ? Number(row.processing_time_ms) : undefined,
    matchedAt: String(row.matched_at),
  };
}

function normalizeMatchRun(row: Record<string, unknown>): StoredMatchRun {
  const rawMode = String(row.mode ?? "hybrid");
  const rawStatus = String(row.status ?? "processing");

  const mode: MatchRunMode =
    rawMode === "rules_only" || rawMode === "ai_only" || rawMode === "hybrid"
      ? rawMode
      : "hybrid";
  const status: MatchRunStatus =
    rawStatus === "completed" || rawStatus === "failed" || rawStatus === "processing"
      ? rawStatus
      : "processing";

  return {
    id: String(row.id),
    sessionId: row.session_id ? String(row.session_id) : undefined,
    jobDescriptionId: String(row.job_description_id),
    sampleName: row.sample_name ? String(row.sample_name) : undefined,
    mode,
    status,
    totalCount: Number(row.total_count ?? 0),
    processedCount: Number(row.processed_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    matchedCount: row.matched_count !== null && row.matched_count !== undefined
      ? Number(row.matched_count)
      : undefined,
    avgScore: row.avg_score !== null && row.avg_score !== undefined
      ? Number(row.avg_score)
      : undefined,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    error: row.error ? String(row.error) : undefined,
  };
}

export class MatchStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  saveMatch(params: {
    sessionId?: string;
    userId?: string;
    resumeId: string;
    jobDescriptionId: string;
    sampleName?: string;
    result: MatchingResult;
    aiModel?: string;
    processingTimeMs?: number;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO resume_matches (
          session_id,
          user_id,
          resume_id,
          job_description_id,
          sample_name,
          score,
          recommendation,
          highlights,
          concerns,
          summary,
          breakdown,
          score_source,
          ai_model,
          processing_time_ms,
          matched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resume_id, job_description_id) DO UPDATE SET
          session_id = excluded.session_id,
          user_id = excluded.user_id,
          sample_name = excluded.sample_name,
          score = excluded.score,
          recommendation = excluded.recommendation,
          highlights = excluded.highlights,
          concerns = excluded.concerns,
          summary = excluded.summary,
          breakdown = excluded.breakdown,
          score_source = excluded.score_source,
          ai_model = excluded.ai_model,
          processing_time_ms = excluded.processing_time_ms,
          matched_at = excluded.matched_at
        `
      )
      .run(
        params.sessionId ?? null,
        params.userId ?? null,
        params.resumeId,
        params.jobDescriptionId,
        params.sampleName ?? null,
        params.result.score,
        params.result.recommendation,
        JSON.stringify(params.result.highlights ?? []),
        JSON.stringify(params.result.concerns ?? []),
        params.result.summary ?? "",
        params.result.breakdown ? JSON.stringify(params.result.breakdown) : null,
        params.result.scoreSource ?? "ai",
        params.aiModel ?? null,
        params.processingTimeMs ?? null,
        now
      );
  }

  saveMatches(batch: Array<Parameters<MatchStorage["saveMatch"]>[0]>): void {
    const transaction = this.db.transaction((entries: Array<Parameters<MatchStorage["saveMatch"]>[0]>) => {
      for (const entry of entries) {
        this.saveMatch(entry);
      }
    });
    transaction(batch);
  }

  getMatch(resumeId: string, jobDescriptionId: string): StoredMatch | null {
    const row = this.db
      .prepare("SELECT * FROM resume_matches WHERE resume_id = ? AND job_description_id = ?")
      .get(resumeId, jobDescriptionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return normalizeMatch(row);
  }

  getMatchesForJob(jobDescriptionId: string): StoredMatch[] {
    const rows = this.db
      .prepare("SELECT * FROM resume_matches WHERE job_description_id = ? ORDER BY score DESC")
      .all(jobDescriptionId) as Record<string, unknown>[];

    return rows.map((row) => normalizeMatch(row));
  }

  getMatchesForSession(sessionId: string, jobDescriptionId?: string): StoredMatch[] {
    const rows = jobDescriptionId
      ? this.db
          .prepare(
            "SELECT * FROM resume_matches WHERE session_id = ? AND job_description_id = ? ORDER BY score DESC"
          )
          .all(sessionId, jobDescriptionId)
      : this.db
          .prepare("SELECT * FROM resume_matches WHERE session_id = ? ORDER BY score DESC")
          .all(sessionId);

    return (rows as Record<string, unknown>[]).map((row) => normalizeMatch(row));
  }

  getMatchesByResumeIds(resumeIds: string[], jobDescriptionId: string): StoredMatch[] {
    if (resumeIds.length === 0) return [];
    const placeholders = resumeIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM resume_matches WHERE job_description_id = ? AND resume_id IN (${placeholders})`
      )
      .all(jobDescriptionId, ...resumeIds) as Record<string, unknown>[];

    return rows.map((row) => normalizeMatch(row));
  }

  clearOldMatches(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db
      .prepare("DELETE FROM resume_matches WHERE matched_at < ?")
      .run(cutoff);
    return result.changes ?? 0;
  }

  clearMatches(jobDescriptionId?: string): number {
    const result = jobDescriptionId
      ? this.db.prepare("DELETE FROM resume_matches WHERE job_description_id = ?").run(jobDescriptionId)
      : this.db.prepare("DELETE FROM resume_matches").run();
    return result.changes ?? 0;
  }

  createMatchRun(params: {
    id: string;
    sessionId?: string;
    jobDescriptionId: string;
    sampleName?: string;
    mode: MatchRunMode;
    status?: MatchRunStatus;
    totalCount: number;
    startedAt?: string;
  }): void {
    const startedAt = params.startedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO match_runs (
          id,
          session_id,
          job_description_id,
          sample_name,
          mode,
          status,
          total_count,
          processed_count,
          failed_count,
          matched_count,
          avg_score,
          started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          job_description_id = excluded.job_description_id,
          sample_name = excluded.sample_name,
          mode = excluded.mode,
          status = excluded.status,
          total_count = excluded.total_count,
          processed_count = 0,
          failed_count = 0,
          matched_count = NULL,
          avg_score = NULL,
          started_at = excluded.started_at,
          completed_at = NULL,
          error = NULL
        `
      )
      .run(
        params.id,
        params.sessionId ?? null,
        params.jobDescriptionId,
        params.sampleName ?? null,
        params.mode,
        params.status ?? "processing",
        params.totalCount,
        startedAt
      );
  }

  finalizeMatchRun(params: {
    id: string;
    status: Extract<MatchRunStatus, "completed" | "failed">;
    processedCount: number;
    failedCount: number;
    matchedCount?: number;
    avgScore?: number;
    completedAt?: string;
    error?: string;
  }): void {
    const completedAt = params.completedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `
        UPDATE match_runs
        SET
          status = ?,
          processed_count = ?,
          failed_count = ?,
          matched_count = ?,
          avg_score = ?,
          completed_at = ?,
          error = ?
        WHERE id = ?
        `
      )
      .run(
        params.status,
        params.processedCount,
        params.failedCount,
        params.matchedCount ?? null,
        params.avgScore ?? null,
        completedAt,
        params.error ?? null,
        params.id
      );
  }

  listMatchRuns(params?: {
    sessionId?: string;
    jobDescriptionId?: string;
    limit?: number;
  }): StoredMatchRun[] {
    const limit = Math.max(1, Math.min(params?.limit ?? 20, 100));

    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (params?.sessionId) {
      clauses.push("session_id = ?");
      values.push(params.sessionId);
    }
    if (params?.jobDescriptionId) {
      clauses.push("job_description_id = ?");
      values.push(params.jobDescriptionId);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM match_runs
        ${whereClause}
        ORDER BY started_at DESC
        LIMIT ?
        `
      )
      .all(...values, limit) as Record<string, unknown>[];

    return rows.map((row) => normalizeMatchRun(row));
  }
}
