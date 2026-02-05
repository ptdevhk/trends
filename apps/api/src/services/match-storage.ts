import { getResumeScreeningDb } from "./database.js";
import type { MatchingResult } from "./ai-matching.js";

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
  aiModel?: string;
  processingTimeMs?: number;
  matchedAt: string;
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

function normalizeMatch(row: Record<string, unknown>): StoredMatch {
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
    aiModel: row.ai_model ? String(row.ai_model) : undefined,
    processingTimeMs: row.processing_time_ms ? Number(row.processing_time_ms) : undefined,
    matchedAt: String(row.matched_at),
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
          ai_model,
          processing_time_ms,
          matched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resume_id, job_description_id) DO UPDATE SET
          session_id = excluded.session_id,
          user_id = excluded.user_id,
          sample_name = excluded.sample_name,
          score = excluded.score,
          recommendation = excluded.recommendation,
          highlights = excluded.highlights,
          concerns = excluded.concerns,
          summary = excluded.summary,
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
}
