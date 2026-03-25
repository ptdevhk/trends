export type SummaryPeriod = "daily";

export type SummaryChannel = "email" | "wechat_work" | "feishu" | "telegram";

export type SummaryWindow = {
  startAt: string;
  endAt: string;
  timezone: string;
};

export type SummaryTotals = {
  newResumes: number;
  candidateStatusUpdates: number;
  shortlistActions: number;
  rejectActions: number;
  contactActions: number;
  collectionTasksCompleted: number;
  collectionTasksFailed: number;
};

export type SummaryCountEntry = {
  key: string;
  label: string;
  count: number;
};

export type SummaryReport = {
  workspaceSlug: string;
  period: SummaryPeriod;
  generatedAt: string;
  window: SummaryWindow;
  totals: SummaryTotals;
  breakdowns: {
    resumesBySource: SummaryCountEntry[];
    candidateStatusByValue: SummaryCountEntry[];
    actionsByType: SummaryCountEntry[];
    collectionTasksByStatus: SummaryCountEntry[];
  };
  notes: string[];
};

export type SummaryPreviewRequest = {
  workspaceSlug?: string;
  period: SummaryPeriod;
  endAt?: string;
};

export type SummarySendRequest = SummaryPreviewRequest & {
  channel: SummaryChannel;
  dryRun?: boolean;
};
