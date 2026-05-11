import type {
  SummaryComparison,
  SummaryCountEntry,
  SummaryNewCandidate,
  SummaryPeriod,
  SummaryReport,
  SummaryScopes,
  SummarySharedIngestTotals,
  SummaryTotals,
  SummaryWindow,
  SummaryWorkspaceActivityTotals,
} from "@trends/shared";

import {
  ActionStorage,
  type CandidateActionType,
} from "../action-storage.js";
import { config } from "../config.js";
import { resolveConvexUrl } from "../resume-import-service.js";
import {
  formatIsoOffsetInTimezone,
  getLocalDatePartsInTimezone,
  resolveLocalMidnightUtc,
  type LocalDateParts,
} from "../timezone.js";

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

type SummaryWindowRange = {
  fromTimestamp: number;
  toTimestamp: number;
  window: SummaryWindow;
};

type SummaryWindowSet = {
  current: SummaryWindowRange;
  previous: SummaryWindowRange;
};

type SummaryMetrics = {
  totals: SummaryTotals;
  breakdowns: SummaryReport["breakdowns"];
  scopes: SummaryScopes;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const ACTION_LABELS: Record<CandidateActionType, string> = {
  star: "Star",
  shortlist: "Shortlist",
  reject: "Reject",
  archive: "Archive",
  note: "Note",
  contact: "Contact",
  rating: "Rating",
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
}): SummaryWindowSet {
  const anchorDate = params.endAt ? new Date(params.endAt) : params.now();
  if (Number.isNaN(anchorDate.getTime())) {
    throw new Error("Invalid endAt value");
  }

  if (params.period === "daily") {
    const currentEnd = anchorDate;
    const currentStart = new Date(currentEnd.getTime() - DAY_MS);
    const previousEnd = currentStart;
    const previousStart = new Date(previousEnd.getTime() - DAY_MS);
    return {
      current: buildWindowRange(currentStart, currentEnd, params.timezone),
      previous: buildWindowRange(previousStart, previousEnd, params.timezone),
    };
  }

  if (params.period === "monthly") {
    const localAnchor = getLocalDatePartsInTimezone(anchorDate, params.timezone);
    const currentMonthStart = { year: localAnchor.year, month: localAnchor.month, day: 1 };
    const nextMonth = localAnchor.month === 12
      ? { year: localAnchor.year + 1, month: 1, day: 1 }
      : { year: localAnchor.year, month: localAnchor.month + 1, day: 1 };
    const previousMonth = localAnchor.month === 1
      ? { year: localAnchor.year - 1, month: 12, day: 1 }
      : { year: localAnchor.year, month: localAnchor.month - 1, day: 1 };
    const currentStart = resolveLocalMidnightUtc(currentMonthStart, params.timezone);
    const currentEnd = resolveLocalMidnightUtc(nextMonth, params.timezone);
    const previousStart = resolveLocalMidnightUtc(previousMonth, params.timezone);
    const previousEnd = currentStart;
    return {
      current: buildWindowRange(currentStart, currentEnd, params.timezone),
      previous: buildWindowRange(previousStart, previousEnd, params.timezone),
    };
  }

  const localAnchorDate = getLocalDatePartsInTimezone(anchorDate, params.timezone);
  const currentWeekStart = getWeekStartLocalDate(localAnchorDate);
  const currentWeekEnd = shiftLocalDateParts(currentWeekStart, 7);
  const previousWeekStart = shiftLocalDateParts(currentWeekStart, -7);

  const currentStart = resolveLocalMidnightUtc(currentWeekStart, params.timezone);
  const currentEnd = resolveLocalMidnightUtc(currentWeekEnd, params.timezone);
  const previousStart = resolveLocalMidnightUtc(previousWeekStart, params.timezone);
  return {
    current: buildWindowRange(currentStart, currentEnd, params.timezone),
    previous: buildWindowRange(previousStart, currentStart, params.timezone),
  };
}

function buildWindowRange(startDate: Date, endDate: Date, timezone: string): SummaryWindowRange {
  return {
    fromTimestamp: startDate.getTime(),
    toTimestamp: endDate.getTime(),
    window: buildSummaryWindow(startDate, endDate, timezone),
  };
}

function buildSummaryWindow(startDate: Date, endDate: Date, timezone: string): SummaryWindow {
  return {
    startAt: formatIsoOffsetInTimezone(startDate, timezone),
    endAt: formatIsoOffsetInTimezone(endDate, timezone),
    timezone,
  };
}

function shiftLocalDateParts(parts: LocalDateParts, days: number): LocalDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getWeekStartLocalDate(parts: LocalDateParts): LocalDateParts {
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftLocalDateParts(parts, -daysSinceMonday);
}

function subtractSharedIngestTotals(
  current: SummarySharedIngestTotals,
  previous: SummarySharedIngestTotals,
): SummarySharedIngestTotals {
  return {
    newResumes: current.newResumes - previous.newResumes,
    collectionTasksCompleted: current.collectionTasksCompleted - previous.collectionTasksCompleted,
    collectionTasksFailed: current.collectionTasksFailed - previous.collectionTasksFailed,
  };
}

function subtractWorkspaceActivityTotals(
  current: SummaryWorkspaceActivityTotals,
  previous: SummaryWorkspaceActivityTotals,
): SummaryWorkspaceActivityTotals {
  return {
    candidateStatusUpdates: current.candidateStatusUpdates - previous.candidateStatusUpdates,
    shortlistActions: current.shortlistActions - previous.shortlistActions,
    rejectActions: current.rejectActions - previous.rejectActions,
    contactActions: current.contactActions - previous.contactActions,
  };
}

function buildComparison(
  previousWindow: SummaryWindow,
  currentScopes: SummaryScopes,
  previousScopes: SummaryScopes,
): SummaryComparison {
  return {
    previousWindow,
    totalsDelta: {
      sharedIngest: subtractSharedIngestTotals(
        currentScopes.sharedIngest.totals,
        previousScopes.sharedIngest.totals,
      ),
      workspaceActivity: subtractWorkspaceActivityTotals(
        currentScopes.workspaceActivity.totals,
        previousScopes.workspaceActivity.totals,
      ),
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

function toSummaryScopes(params: {
  totals: SummaryTotals;
  resumeEntries: SummaryCountEntry[];
  candidateStatusEntries: SummaryCountEntry[];
  actionEntries: SummaryCountEntry[];
  taskEntries: SummaryCountEntry[];
}): SummaryScopes {
  return {
    sharedIngest: {
      totals: {
        newResumes: params.totals.newResumes,
        collectionTasksCompleted: params.totals.collectionTasksCompleted,
        collectionTasksFailed: params.totals.collectionTasksFailed,
      },
      breakdowns: {
        resumesBySource: params.resumeEntries,
        collectionTasksByStatus: params.taskEntries,
      },
    },
    workspaceActivity: {
      totals: {
        candidateStatusUpdates: params.totals.candidateStatusUpdates,
        shortlistActions: params.totals.shortlistActions,
        rejectActions: params.totals.rejectActions,
        contactActions: params.totals.contactActions,
      },
      breakdowns: {
        candidateStatusByValue: params.candidateStatusEntries,
        actionsByType: params.actionEntries,
      },
    },
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
    const windows = buildWindow({
      period: params.period,
      endAt: params.endAt,
      now: this.now,
      timezone: config.timezone,
    });

    const [currentMetrics, previousMetrics, newCandidates] = await Promise.all([
      this.buildWindowMetrics(params.workspaceSlug, windows.current),
      this.buildWindowMetrics(params.workspaceSlug, windows.previous),
      params.period === "monthly"
        ? this.loadNewCandidates(windows.current.fromTimestamp, windows.current.toTimestamp)
        : Promise.resolve(undefined),
    ]);

    const report: SummaryReport = {
      workspaceSlug: params.workspaceSlug,
      period: params.period,
      generatedAt: formatIsoOffsetInTimezone(this.now(), config.timezone),
      window: windows.current.window,
      comparison: buildComparison(
        windows.previous.window,
        currentMetrics.scopes,
        previousMetrics.scopes,
      ),
      totals: currentMetrics.totals,
      breakdowns: currentMetrics.breakdowns,
      scopes: currentMetrics.scopes,
      notes: [
        "Shared ingest totals come from the global resume and collection-task pools in the current workspace model.",
        "Workspace activity totals cover candidate-status updates and persisted workspace-linked actions only.",
      ],
    };

    if (newCandidates) {
      report.newCandidates = newCandidates;
      report.notes.push(
        `Monthly digest includes ${newCandidates.length} new candidates from the window.`,
      );
    }

    return report;
  }

  private async buildWindowMetrics(
    workspaceSlug: string,
    windowRange: SummaryWindowRange,
  ): Promise<SummaryMetrics> {
    const [resumeSummary, candidateStatusSummary, collectionTaskSummary] = await Promise.all([
      this.loadResumeSummary(windowRange.fromTimestamp, windowRange.toTimestamp),
      this.loadCandidateStatusSummary(
        workspaceSlug,
        windowRange.fromTimestamp,
        windowRange.toTimestamp,
      ),
      this.loadCollectionTaskSummary(windowRange.fromTimestamp, windowRange.toTimestamp),
    ]);

    const actionSummary = this.actionStorage.summarizeActionsInWindow({
      workspaceSlug,
      startAt: windowRange.window.startAt,
      endAt: windowRange.window.endAt,
    });

    const resumeEntries = normalizeConvexEntries(resumeSummary.bySource);
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
      totals,
      breakdowns: {
        resumesBySource: resumeEntries,
        candidateStatusByValue: candidateStatusEntries,
        actionsByType: actionEntries,
        collectionTasksByStatus: taskEntries,
      },
      scopes: toSummaryScopes({
        totals,
        resumeEntries,
        candidateStatusEntries,
        actionEntries,
        taskEntries,
      }),
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

  private async loadNewCandidates(
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<SummaryNewCandidate[]> {
    const value = await this.queryConvex("resumes:listNewForWindow", {
      fromTimestamp,
      toTimestamp,
      limit: 200,
    });

    if (!Array.isArray(value)) {
      return [];
    }

    const candidates: SummaryNewCandidate[] = [];
    for (const item of value) {
      if (!isRecord(item)) continue;
      const resumeId = readString(item.resumeId);
      const source = readString(item.source);
      const crawledAt = readNumber(item.crawledAt);
      if (!resumeId || !source || !crawledAt) continue;

      candidates.push({
        resumeId,
        name: readString(item.name) || undefined,
        source,
        location: readString(item.location) || undefined,
        experience: readString(item.experience) || undefined,
        education: readString(item.education) || undefined,
        score: readNumber(item.score) || undefined,
        recommendation: readString(item.recommendation) || undefined,
        crawledAt: formatIsoOffsetInTimezone(new Date(crawledAt), config.timezone),
      });
    }

    return candidates;
  }
}
