import type {
  SummaryCountEntry,
  SummaryPeriod,
  SummaryReport,
  SummaryTotals,
  SummaryWindow,
} from "@trends/shared";

import {
  ActionStorage,
  type CandidateActionType,
} from "../action-storage.js";
import { config } from "../config.js";
import { resolveConvexUrl } from "../resume-import-service.js";
import { formatIsoOffsetInTimezone } from "../timezone.js";

type ConvexSummaryEntry = {
  key: string;
  count: number;
};

type ResumeWindowSummary = {
  total: number;
  bySource: ConvexSummaryEntry[];
};

type CollectionTaskWindowSummary = {
  total: number;
  byStatus: ConvexSummaryEntry[];
};

type SummaryDataServiceDependencies = {
  actionStorage?: Pick<ActionStorage, "summarizeActionsInWindow">;
  now?: () => Date;
  queryConvex?: (pathName: string, args: Record<string, unknown>) => Promise<unknown>;
};

const ACTION_LABELS: Record<CandidateActionType, string> = {
  star: "Star",
  shortlist: "Shortlist",
  reject: "Reject",
  archive: "Archive",
  note: "Note",
  contact: "Contact",
  ai_score_like: "AI Score Like",
  ai_score_unlike: "AI Score Unlike",
  ai_summary_like: "AI Summary Like",
  ai_summary_unlike: "AI Summary Unlike",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  interviewing: "Interviewing",
  interviewed_pass: "Interview Passed",
  interviewed_reject: "Interview Rejected",
  offer: "Offer",
  hired: "Hired",
  withdrawn: "Withdrawn",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeConvexEntries(
  value: unknown,
  labels: Record<string, string> = {},
): SummaryCountEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const key = readString(item.key);
      const count = readNumber(item.count);
      if (!key || typeof count !== "number" || count <= 0) {
        return null;
      }
      return {
        key,
        label: labels[key] ?? key,
        count,
      } satisfies SummaryCountEntry;
    })
    .filter((item): item is SummaryCountEntry => item !== null)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.key.localeCompare(right.key);
    });
}

function countFromEntries(entries: SummaryCountEntry[], key: string): number {
  return entries.find((entry) => entry.key === key)?.count ?? 0;
}

function normalizeActionEntries(
  breakdown: Array<{ actionType: CandidateActionType; count: number }>,
): SummaryCountEntry[] {
  return breakdown
    .map((entry) => ({
      key: entry.actionType,
      label: ACTION_LABELS[entry.actionType] ?? entry.actionType,
      count: entry.count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.key.localeCompare(right.key);
    });
}

function buildWindow(params: {
  period: SummaryPeriod;
  endAt?: string;
  now: () => Date;
  timezone: string;
}): { fromTimestamp: number; toTimestamp: number; window: SummaryWindow } {
  const endDate = params.endAt ? new Date(params.endAt) : params.now();
  if (Number.isNaN(endDate.getTime())) {
    throw new Error("Invalid endAt value");
  }

  const durationMs = params.period === "daily" ? 24 * 60 * 60 * 1000 : 0;
  const startDate = new Date(endDate.getTime() - durationMs);

  return {
    fromTimestamp: startDate.getTime(),
    toTimestamp: endDate.getTime(),
    window: {
      startAt: formatIsoOffsetInTimezone(startDate, params.timezone),
      endAt: formatIsoOffsetInTimezone(endDate, params.timezone),
      timezone: params.timezone,
    },
  };
}

async function callConvexQuery(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex query failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex query failed for ${pathName}`);
  }

  return payload.value;
}

function toSummaryTotals(params: {
  resumeSummary: ResumeWindowSummary;
  candidateStatusEntries: SummaryCountEntry[];
  actionEntries: SummaryCountEntry[];
  taskEntries: SummaryCountEntry[];
}): SummaryTotals {
  return {
    newResumes: params.resumeSummary.total,
    candidateStatusUpdates: params.candidateStatusEntries.reduce((sum, entry) => sum + entry.count, 0),
    shortlistActions: countFromEntries(params.actionEntries, "shortlist"),
    rejectActions: countFromEntries(params.actionEntries, "reject"),
    contactActions: countFromEntries(params.actionEntries, "contact"),
    collectionTasksCompleted: countFromEntries(params.taskEntries, "completed"),
    collectionTasksFailed: countFromEntries(params.taskEntries, "failed"),
  };
}

export class SummaryDataService {
  private readonly actionStorage: Pick<ActionStorage, "summarizeActionsInWindow">;
  private readonly now: () => Date;
  private readonly queryConvex: (pathName: string, args: Record<string, unknown>) => Promise<unknown>;

  constructor(dependencies: SummaryDataServiceDependencies = {}) {
    this.actionStorage = dependencies.actionStorage ?? new ActionStorage(config.projectRoot);
    this.now = dependencies.now ?? (() => new Date());
    this.queryConvex = dependencies.queryConvex ?? callConvexQuery;
  }

  async buildSummaryReport(params: {
    workspaceSlug: string;
    period: SummaryPeriod;
    endAt?: string;
  }): Promise<SummaryReport> {
    const { fromTimestamp, toTimestamp, window } = buildWindow({
      period: params.period,
      endAt: params.endAt,
      now: this.now,
      timezone: config.timezone,
    });

    const [resumeSummary, candidateStatusSummary, collectionTaskSummary] = await Promise.all([
      this.loadResumeSummary(fromTimestamp, toTimestamp),
      this.loadCandidateStatusSummary(params.workspaceSlug, fromTimestamp, toTimestamp),
      this.loadCollectionTaskSummary(fromTimestamp, toTimestamp),
    ]);

    const actionSummary = this.actionStorage.summarizeActionsInWindow({
      workspaceSlug: params.workspaceSlug,
      startAt: window.startAt,
      endAt: window.endAt,
    });

    const candidateStatusEntries = normalizeConvexEntries(candidateStatusSummary.byStatus, STATUS_LABELS);
    const actionEntries = normalizeActionEntries(actionSummary.breakdown);
    const taskEntries = normalizeConvexEntries(collectionTaskSummary.byStatus, TASK_STATUS_LABELS);
    const totals = toSummaryTotals({
      resumeSummary,
      candidateStatusEntries,
      actionEntries,
      taskEntries,
    });

    return {
      workspaceSlug: params.workspaceSlug,
      period: params.period,
      generatedAt: formatIsoOffsetInTimezone(this.now(), config.timezone),
      window,
      totals,
      breakdowns: {
        resumesBySource: normalizeConvexEntries(resumeSummary.bySource),
        candidateStatusByValue: candidateStatusEntries,
        actionsByType: actionEntries,
        collectionTasksByStatus: taskEntries,
      },
      notes: [
        "Resume and collection-task counts are shared ingest totals because those records are not workspace-scoped today.",
        "Action counts include only workspace-linked rows resolved through persisted sessions or review-packet runs.",
      ],
    };
  }

  private async loadResumeSummary(fromTimestamp: number, toTimestamp: number): Promise<ResumeWindowSummary> {
    const value = await this.queryConvex("resumes:getSummaryWindow", {
      fromTimestamp,
      toTimestamp,
    });

    if (!isRecord(value)) {
      return { total: 0, bySource: [] };
    }

    return {
      total: readNumber(value.total) ?? 0,
      bySource: normalizeConvexEntries(value.bySource).map((entry) => ({
        key: entry.key,
        count: entry.count,
      })),
    };
  }

  private async loadCandidateStatusSummary(
    workspaceSlug: string,
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<{ byStatus: ConvexSummaryEntry[] }> {
    const value = await this.queryConvex("candidate_status:list", {
      workspaceSlug,
    });

    const counts = new Map<string, number>();
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isRecord(item)) {
          continue;
        }
        const updatedAt = readNumber(item.updatedAt);
        const status = readString(item.status);
        if (!updatedAt || !status) {
          continue;
        }
        if (updatedAt < fromTimestamp || updatedAt >= toTimestamp) {
          continue;
        }
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
    }

    return {
      byStatus: Array.from(counts.entries()).map(([key, count]) => ({ key, count })),
    };
  }

  private async loadCollectionTaskSummary(
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<CollectionTaskWindowSummary> {
    const value = await this.queryConvex("resume_tasks:getSummaryWindow", {
      fromTimestamp,
      toTimestamp,
    });

    if (!isRecord(value)) {
      return { total: 0, byStatus: [] };
    }

    return {
      total: readNumber(value.total) ?? 0,
      byStatus: normalizeConvexEntries(value.byStatus).map((entry) => ({
        key: entry.key,
        count: entry.count,
      })),
    };
  }
}
