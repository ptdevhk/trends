import type { CandidateAction } from "./action-storage.js";
import type {
  ReviewPacketSummaryStats,
  StoredReviewPacketRun,
} from "./review-packet-storage.js";

type CandidateStatusRecord = {
  identityKey: string;
  status: string;
};

type SummaryCountEntry = {
  key: string;
  label: string;
  count: number;
};

export type FeedbackSummaryData = {
  packetId: string;
  workspaceSlug: string;
  source: "sample" | "convex";
  sampleName?: string;
  sessionId?: string;
  jobDescriptionId?: string;
  exportedAt: string;
  feedbackImportedAt?: string;
  summarySentAt?: string;
  totalExported: number;
  reviewedCount: number;
  pendingCount: number;
  warningCount: number;
  statusBreakdown: SummaryCountEntry[];
  actionBreakdown: SummaryCountEntry[];
  warnings: string[];
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

const ACTION_LABELS: Record<string, string> = {
  shortlist: "Shortlist",
  reject: "Reject",
  star: "Star",
  archive: "Archive",
  note: "Note",
  contact: "Contact",
  ai_score_like: "AI Score Like",
  ai_score_unlike: "AI Score Unlike",
  ai_summary_like: "AI Summary Like",
  ai_summary_unlike: "AI Summary Unlike",
};

function toSortedEntries(counts: Map<string, number>, labels: Record<string, string>): SummaryCountEntry[] {
  return Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .map(([key, count]) => ({
      key,
      label: labels[key] ?? key,
      count,
    }));
}

function buildStatusCounts(
  run: StoredReviewPacketRun,
  statuses: CandidateStatusRecord[],
): Map<string, number> {
  const byIdentity = new Map(statuses.map((item) => [item.identityKey, item.status]));
  const counts = new Map<string, number>();
  for (const item of run.items) {
    const status = byIdentity.get(item.identityKey) ?? "new";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

function buildActionCounts(actions: CandidateAction[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const action of actions) {
    counts.set(action.actionType, (counts.get(action.actionType) ?? 0) + 1);
  }
  return counts;
}

export class FeedbackSummaryService {
  buildSummary(params: {
    run: StoredReviewPacketRun;
    statuses: CandidateStatusRecord[];
    actions: CandidateAction[];
  }): FeedbackSummaryData {
    const reviewedResumeIds = new Set(params.run.stats?.import?.reviewedResumeIds ?? []);
    const reviewedCount = reviewedResumeIds.size;
    const pendingCount = Math.max(params.run.totalCount - reviewedCount, 0);
    const warningCount = params.run.stats?.import?.warningCount ?? 0;
    const warnings = (params.run.stats?.import?.warnings ?? []).slice(0, 5);

    const statusBreakdown = toSortedEntries(buildStatusCounts(params.run, params.statuses), STATUS_LABELS);
    const actionBreakdown = toSortedEntries(buildActionCounts(params.actions), ACTION_LABELS);

    return {
      packetId: params.run.id,
      workspaceSlug: params.run.workspaceSlug,
      source: params.run.source,
      sampleName: params.run.sampleName,
      sessionId: params.run.sessionId,
      jobDescriptionId: params.run.jobDescriptionId,
      exportedAt: params.run.exportedAt,
      feedbackImportedAt: params.run.feedbackImportedAt,
      summarySentAt: params.run.summarySentAt,
      totalExported: params.run.totalCount,
      reviewedCount,
      pendingCount,
      warningCount,
      statusBreakdown,
      actionBreakdown,
      warnings,
    };
  }

  toSummaryStats(
    summary: FeedbackSummaryData,
    params: {
      previewedAt?: string;
      sentAt?: string;
      channel?: string;
    } = {}
  ): ReviewPacketSummaryStats {
    return {
      previewedAt: params.previewedAt,
      sentAt: params.sentAt,
      channel: params.channel,
      reviewedCount: summary.reviewedCount,
      pendingCount: summary.pendingCount,
      warningCount: summary.warningCount,
      statusBreakdown: Object.fromEntries(summary.statusBreakdown.map((item) => [item.key, item.count])),
      actionBreakdown: Object.fromEntries(summary.actionBreakdown.map((item) => [item.key, item.count])),
    };
  }
}
