import { config } from "./config.js";
import { getResumeScreeningDb } from "./database.js";
import { formatIsoOffsetInTimezone } from "./timezone.js";

export type WorkspaceSummaryRunStatus = "previewed" | "dry_run" | "sent" | "failed";

export type WorkspaceSummaryTriggerSource =
  | "api_preview"
  | "api_manual"
  | "worker_manual"
  | "worker_schedule";

export type StoredWorkspaceSummaryRun = {
  id: string;
  workspaceSlug: string;
  period: "daily";
  triggerSource: WorkspaceSummaryTriggerSource;
  status: WorkspaceSummaryRunStatus;
  channel?: "email" | "wechat_work" | "feishu" | "telegram";
  templateId?: string;
  dryRun: boolean;
  windowStart: string;
  windowEnd: string;
  startedAt: string;
  finishedAt?: string;
  report: Record<string, unknown>;
  content?: string;
  delivery?: Record<string, unknown>;
  error?: string;
};

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeTriggerSource(value: unknown): WorkspaceSummaryTriggerSource {
  const source = String(value ?? "api_manual");
  if (
    source === "api_preview"
    || source === "api_manual"
    || source === "worker_manual"
    || source === "worker_schedule"
  ) {
    return source;
  }
  return "api_manual";
}

function normalizeStatus(value: unknown): WorkspaceSummaryRunStatus {
  const status = String(value ?? "sent");
  if (status === "previewed" || status === "dry_run" || status === "sent" || status === "failed") {
    return status;
  }
  return "sent";
}

function normalizeChannel(value: unknown): StoredWorkspaceSummaryRun["channel"] {
  const channel = typeof value === "string" ? value : "";
  if (channel === "email" || channel === "wechat_work" || channel === "feishu" || channel === "telegram") {
    return channel;
  }
  return undefined;
}

function normalizeRun(row: Record<string, unknown>): StoredWorkspaceSummaryRun {
  return {
    id: String(row.id),
    workspaceSlug: row.workspace_slug ? String(row.workspace_slug) : "dev",
    period: "daily",
    triggerSource: normalizeTriggerSource(row.trigger_source),
    status: normalizeStatus(row.status),
    channel: normalizeChannel(row.channel),
    templateId: row.template_id ? String(row.template_id) : undefined,
    dryRun: Number(row.dry_run ?? 0) === 1,
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    report: parseJsonObject(row.report_json) ?? {},
    content: row.content_text ? String(row.content_text) : undefined,
    delivery: parseJsonObject(row.delivery_json),
    error: row.error ? String(row.error) : undefined,
  };
}

export class WorkspaceSummaryRunStorage {
  private readonly db;

  constructor(projectRoot?: string) {
    this.db = getResumeScreeningDb(projectRoot);
  }

  createRun(params: {
    id: string;
    workspaceSlug: string;
    triggerSource: WorkspaceSummaryTriggerSource;
    status: WorkspaceSummaryRunStatus;
    channel?: StoredWorkspaceSummaryRun["channel"];
    templateId?: string;
    dryRun: boolean;
    windowStart: string;
    windowEnd: string;
    startedAt?: string;
    finishedAt?: string;
    report: Record<string, unknown>;
    content?: string;
    delivery?: Record<string, unknown>;
    error?: string;
  }): StoredWorkspaceSummaryRun {
    const startedAt = params.startedAt ?? formatIsoOffsetInTimezone(new Date(), config.timezone);
    this.db
      .prepare(
        `
        INSERT INTO workspace_summary_runs (
          id, workspace_slug, period, trigger_source, status,
          channel, template_id, dry_run, window_start, window_end,
          started_at, finished_at, report_json, content_text,
          delivery_json, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        params.id,
        params.workspaceSlug,
        "daily",
        params.triggerSource,
        params.status,
        params.channel ?? null,
        params.templateId ?? null,
        params.dryRun ? 1 : 0,
        params.windowStart,
        params.windowEnd,
        startedAt,
        params.finishedAt ?? startedAt,
        JSON.stringify(params.report),
        params.content ?? null,
        params.delivery ? JSON.stringify(params.delivery) : null,
        params.error ?? null,
      );

    const created = this.getRun(params.id, params.workspaceSlug);
    if (!created) {
      throw new Error(`Failed to create workspace summary run: ${params.id}`);
    }
    return created;
  }

  getRun(id: string, workspaceSlug: string): StoredWorkspaceSummaryRun | null {
    const row = this.db
      .prepare("SELECT * FROM workspace_summary_runs WHERE id = ? AND workspace_slug = ?")
      .get(id, workspaceSlug) as Record<string, unknown> | undefined;

    return row ? normalizeRun(row) : null;
  }

  listRuns(workspaceSlug: string, limit = 20): StoredWorkspaceSummaryRun[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM workspace_summary_runs
        WHERE workspace_slug = ?
        ORDER BY started_at DESC
        LIMIT ?
        `
      )
      .all(workspaceSlug, limit) as Record<string, unknown>[];

    return rows.map((row) => normalizeRun(row));
  }
}
