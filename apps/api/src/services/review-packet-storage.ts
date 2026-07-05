import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

export type ReviewPacketRunStatus = "exported" | "feedback_imported" | "summary_sent" | "failed";

export type ReviewPacketItemSnapshot = {
  resumeId: string;
  identityKey: string;
  profileUrl?: string;
  name?: string;
  source?: string;
};

export type ReviewPacketImportStats = {
  importedAt: string;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  importedRows: number;
  reviewedCount: number;
  statusUpdates: number;
  actionUpdates: number;
  noteUpdates: number;
  invalidRows: number;
  duplicateRows: number;
  warningCount: number;
  matchedByProfileUrlCount: number;
  nameMismatchCount: number;
  reviewedResumeIds: string[];
  warnings: string[];
};

export type ReviewPacketSummaryStats = {
  previewedAt?: string;
  sentAt?: string;
  channel?: string;
  reviewedCount: number;
  pendingCount: number;
  warningCount: number;
  statusBreakdown: Record<string, number>;
  actionBreakdown: Record<string, number>;
};

export type ReviewPacketRunStats = {
  import?: ReviewPacketImportStats;
  summary?: ReviewPacketSummaryStats;
};

export type StoredReviewPacketRun = {
  id: string;
  workspaceSlug: string;
  source: "sample" | "convex";
  sampleName?: string;
  sessionId?: string;
  jobDescriptionId?: string;
  format: "csv" | "xlsx";
  status: ReviewPacketRunStatus;
  totalCount: number;
  packetFilename?: string;
  exportedAt: string;
  feedbackImportedAt?: string;
  summarySentAt?: string;
  summaryChannel?: string;
  items: ReviewPacketItemSnapshot[];
  stats?: ReviewPacketRunStats;
  error?: string;
};

function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    console.error("review-packet-storage items_json parse failed:", error);
    return [];
  }
}

function parseJsonObject<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as T;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch (error) {
    console.error("review-packet-storage stats_json parse failed:", error);
    return undefined;
  }
}

function normalizeStatus(value: unknown): ReviewPacketRunStatus {
  const status = String(value ?? "exported");
  if (status === "feedback_imported" || status === "summary_sent" || status === "failed") {
    return status;
  }
  return "exported";
}

function normalizeRun(row: Record<string, unknown>): StoredReviewPacketRun {
  const rawSource = String(row.source ?? "convex");
  const rawFormat = String(row.format ?? "xlsx");

  return {
    id: String(row.id),
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : "dev",
    source: rawSource === "sample" ? "sample" : "convex",
    sampleName: row.sample_name ? String(row.sample_name) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    jobDescriptionId: row.job_description_id ? String(row.job_description_id) : undefined,
    format: rawFormat === "csv" ? "csv" : "xlsx",
    status: normalizeStatus(row.status),
    totalCount: Number(row.total_count ?? 0),
    packetFilename: row.packet_filename ? String(row.packet_filename) : undefined,
    exportedAt: String(row.exported_at),
    feedbackImportedAt: row.feedback_imported_at ? String(row.feedback_imported_at) : undefined,
    summarySentAt: row.summary_sent_at ? String(row.summary_sent_at) : undefined,
    summaryChannel: row.summary_channel ? String(row.summary_channel) : undefined,
    items: parseJsonArray<ReviewPacketItemSnapshot>(row.items_json),
    stats: parseJsonObject<ReviewPacketRunStats>(row.stats_json),
    error: row.error ? String(row.error) : undefined,
  };
}

export class ReviewPacketStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  createRun(params: {
    id: string;
    workspaceSlug: string;
    source: "sample" | "convex";
    sampleName?: string;
    sessionId?: string;
    jobDescriptionId?: string;
    format: "csv" | "xlsx";
    status?: ReviewPacketRunStatus;
    totalCount: number;
    packetFilename?: string;
    exportedAt?: string;
    items: ReviewPacketItemSnapshot[];
    stats?: ReviewPacketRunStats;
    error?: string;
  }): StoredReviewPacketRun {
    const exportedAt = params.exportedAt ?? formatIsoOffsetInTimezone(new Date(), config.timezone);
    this.db
      .prepare(
        `
        INSERT INTO review_packet_runs (
          id, workspace_slug, source, sample_name, session_id,
          job_description_id, format, status, total_count,
          packet_filename, exported_at, items_json, stats_json, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        params.id,
        params.workspaceSlug,
        params.source,
        params.sampleName ?? null,
        params.sessionId ?? null,
        params.jobDescriptionId ?? null,
        params.format,
        params.status ?? "exported",
        params.totalCount,
        params.packetFilename ?? null,
        exportedAt,
        JSON.stringify(params.items),
        params.stats ? JSON.stringify(params.stats) : null,
        params.error ?? null,
      );

    const created = this.getRun(params.id, params.workspaceSlug);
    if (!created) {
      throw new Error(`Failed to create review packet run: ${params.id}`);
    }
    return created;
  }

  getRun(id: string, workspaceSlug: string): StoredReviewPacketRun | null {
    const row = this.db
      .prepare("SELECT * FROM review_packet_runs WHERE id = ? AND workspace_slug = ?")
      .get(id, workspaceSlug) as Record<string, unknown> | undefined;

    return row ? normalizeRun(row) : null;
  }

  listRuns(workspaceSlug: string, limit = 20): StoredReviewPacketRun[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM review_packet_runs
        WHERE workspace_slug = ?
        ORDER BY exported_at DESC
        LIMIT ?
        `
      )
      .all(workspaceSlug, limit) as Record<string, unknown>[];

    return rows.map((row) => normalizeRun(row));
  }

  recordFeedbackImport(params: {
    id: string;
    workspaceSlug: string;
    stats: ReviewPacketImportStats;
  }): StoredReviewPacketRun | null {
    const existing = this.getRun(params.id, params.workspaceSlug);
    if (!existing) {
      return null;
    }

    const nextStats: ReviewPacketRunStats = {
      ...existing.stats,
      import: params.stats,
    };

    this.db
      .prepare(
        `
        UPDATE review_packet_runs
        SET status = ?,
            feedback_imported_at = ?,
            stats_json = ?,
            error = NULL
        WHERE id = ? AND workspace_slug = ?
        `
      )
      .run(
        "feedback_imported",
        params.stats.importedAt,
        JSON.stringify(nextStats),
        params.id,
        params.workspaceSlug,
      );

    return this.getRun(params.id, params.workspaceSlug);
  }

  updateSummaryStats(params: {
    id: string;
    workspaceSlug: string;
    stats: ReviewPacketSummaryStats;
    sent?: boolean;
  }): StoredReviewPacketRun | null {
    const existing = this.getRun(params.id, params.workspaceSlug);
    if (!existing) {
      return null;
    }

    const nextStats: ReviewPacketRunStats = {
      ...existing.stats,
      summary: params.stats,
    };

    if (params.sent) {
      this.db
        .prepare(
          `
          UPDATE review_packet_runs
          SET status = ?,
              summary_sent_at = ?,
              summary_channel = ?,
              stats_json = ?,
              error = NULL
          WHERE id = ? AND workspace_slug = ?
          `
        )
        .run(
          "summary_sent",
          params.stats.sentAt ?? formatIsoOffsetInTimezone(new Date(), config.timezone),
          params.stats.channel ?? "wechat_work",
          JSON.stringify(nextStats),
          params.id,
          params.workspaceSlug,
        );
    } else {
      this.db
        .prepare(
          `
          UPDATE review_packet_runs
          SET stats_json = ?,
              error = NULL
          WHERE id = ? AND workspace_slug = ?
          `
        )
        .run(JSON.stringify(nextStats), params.id, params.workspaceSlug);
    }

    return this.getRun(params.id, params.workspaceSlug);
  }

  markFailed(params: {
    id: string;
    workspaceSlug: string;
    error: string;
  }): StoredReviewPacketRun | null {
    this.db
      .prepare(
        `
        UPDATE review_packet_runs
        SET status = ?,
            error = ?
        WHERE id = ? AND workspace_slug = ?
        `
      )
      .run("failed", params.error, params.id, params.workspaceSlug);

    return this.getRun(params.id, params.workspaceSlug);
  }
}
