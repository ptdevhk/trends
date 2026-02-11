import { randomUUID } from "node:crypto";

import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

export type ResumeFilters = {
  q?: string;
  limit?: number;
  offset?: number;
  minExperience?: number;
  maxExperience?: number;
  education?: string[];
  skills?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
  minMatchScore?: number;
  recommendation?: string[];
  sortBy?: "score" | "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
};

export type SearchSessionStatus = "active" | "completed" | "archived";

export type SearchSession = {
  id: string;
  userId?: string;
  jobDescriptionId?: string;
  sampleName?: string;
  filters?: ResumeFilters;
  status: SearchSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

type SessionUpdateInput = Partial<Omit<SearchSession, "jobDescriptionId" | "userId" | "sampleName" | "expiresAt">> & {
  userId?: string | null;
  jobDescriptionId?: string | null;
  sampleName?: string | null;
  expiresAt?: string | null;
};

function toIsoNow(): string {
  return formatIsoOffsetInTimezone(new Date(), config.timezone);
}

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function normalizeSession(row: Record<string, unknown>): SearchSession {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    jobDescriptionId: row.job_description_id ? String(row.job_description_id) : undefined,
    sampleName: row.sample_name ? String(row.sample_name) : undefined,
    filters: parseJson<ResumeFilters>(row.filters) ?? undefined,
    status: (row.status ? String(row.status) : "active") as SearchSessionStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
  };
}

export class SessionManager {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  createSession(params: {
    userId?: string;
    jobDescriptionId?: string;
    sampleName?: string;
    filters?: ResumeFilters;
  } = {}): SearchSession {
    const id = randomUUID();
    const now = toIsoNow();

    this.db
      .prepare(`
        INSERT INTO search_sessions (
          id,
          user_id,
          job_description_id,
          sample_name,
          filters,
          status,
          created_at,
          updated_at,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.userId ?? null,
        params.jobDescriptionId ?? null,
        params.sampleName ?? null,
        params.filters ? JSON.stringify(params.filters) : null,
        "active",
        now,
        now,
        null
      );

    return {
      id,
      userId: params.userId,
      jobDescriptionId: params.jobDescriptionId,
      sampleName: params.sampleName,
      filters: params.filters,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(sessionId: string): SearchSession | null {
    const row = this.db
      .prepare("SELECT * FROM search_sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return normalizeSession(row);
  }

  getOrCreateSession(userId?: string): SearchSession {
    if (userId) {
      const row = this.db
        .prepare(
          "SELECT * FROM search_sessions WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
        )
        .get(userId) as Record<string, unknown> | undefined;

      if (row) return normalizeSession(row);
    }

    return this.createSession({ userId });
  }

  updateSession(sessionId: string, updates: SessionUpdateInput): SearchSession | null {
    const existing = this.getSession(sessionId);
    if (!existing) return null;

    const fields: string[] = [];
    const values: Array<string | null> = [];

    if (updates.userId !== undefined) {
      fields.push("user_id = ?");
      values.push(updates.userId ?? null);
    }
    if (updates.jobDescriptionId !== undefined) {
      fields.push("job_description_id = ?");
      values.push(updates.jobDescriptionId ?? null);
    }
    if (updates.sampleName !== undefined) {
      fields.push("sample_name = ?");
      values.push(updates.sampleName ?? null);
    }
    if (updates.filters !== undefined) {
      fields.push("filters = ?");
      values.push(updates.filters ? JSON.stringify(updates.filters) : null);
    }
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status ?? "active");
    }
    if (updates.expiresAt !== undefined) {
      fields.push("expires_at = ?");
      values.push(updates.expiresAt ?? null);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = ?");
    values.push(toIsoNow());

    values.push(sessionId);

    this.db
      .prepare(`UPDATE search_sessions SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.getSession(sessionId);
  }

  archiveIdleSessions(idleMinutes: number): number {
    const cutoff = formatIsoOffsetInTimezone(
      new Date(Date.now() - idleMinutes * 60 * 1000),
      config.timezone,
    );
    const result = this.db
      .prepare(
        "UPDATE search_sessions SET status = 'archived', updated_at = ? WHERE status = 'active' AND updated_at < ?"
      )
      .run(toIsoNow(), cutoff);

    return result.changes ?? 0;
  }

  resetSession(sessionId: string, reason: "manual" | "idle" | "completed"): SearchSession | null {
    const status = reason === "completed" ? "completed" : "archived";
    return this.updateSession(sessionId, { status });
  }
}
