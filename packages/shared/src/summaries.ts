export type SummaryPeriod = "daily" | "weekly";

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

export type SummarySharedIngestTotals = Pick<
  SummaryTotals,
  "newResumes" | "collectionTasksCompleted" | "collectionTasksFailed"
>;

export type SummaryWorkspaceActivityTotals = Pick<
  SummaryTotals,
  "candidateStatusUpdates" | "shortlistActions" | "rejectActions" | "contactActions"
>;

export type SummaryComparison = {
  previousWindow: SummaryWindow;
  totalsDelta: {
    sharedIngest: SummarySharedIngestTotals;
    workspaceActivity: SummaryWorkspaceActivityTotals;
  };
};

export type SummaryScopes = {
  sharedIngest: {
    totals: SummarySharedIngestTotals;
    breakdowns: {
      resumesBySource: SummaryCountEntry[];
      collectionTasksByStatus: SummaryCountEntry[];
    };
  };
  workspaceActivity: {
    totals: SummaryWorkspaceActivityTotals;
    breakdowns: {
      candidateStatusByValue: SummaryCountEntry[];
      actionsByType: SummaryCountEntry[];
    };
  };
};

export type SummaryReport = {
  workspaceSlug: string;
  period: SummaryPeriod;
  generatedAt: string;
  window: SummaryWindow;
  comparison?: SummaryComparison;
  totals: SummaryTotals;
  breakdowns: {
    resumesBySource: SummaryCountEntry[];
    candidateStatusByValue: SummaryCountEntry[];
    actionsByType: SummaryCountEntry[];
    collectionTasksByStatus: SummaryCountEntry[];
  };
  scopes?: SummaryScopes;
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
  templateId?: string;
  to?: string;
  subject?: string;
  webhookUrl?: string;
  botToken?: string;
  chatId?: string;
};
