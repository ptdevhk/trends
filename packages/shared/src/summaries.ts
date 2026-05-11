export type SummaryPeriod = "daily" | "weekly" | "monthly";

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

export type SummaryNewCandidate = {
  resumeId: string;
  name?: string;
  source: string;
  location?: string;
  experience?: string;
  education?: string;
  score?: number;
  recommendation?: string;
  crawledAt: string;
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
  newCandidates?: SummaryNewCandidate[];
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

export type SummaryProfileSchedule = {
  cron: string;
};

export type SummaryProfileRequest = {
  period: SummaryPeriod;
  channel: SummaryChannel;
  dryRun: boolean;
  templateId?: string;
  to?: string;
  subject?: string;
};

export type SummaryProfileRecord = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: SummaryProfileSchedule;
  request: SummaryProfileRequest;
};

export type SummaryProfilesConfig = {
  profiles: SummaryProfileRecord[];
};

export type SummaryProfileRuntimeItem = {
  workspaceSlug: string;
  profileId: string;
  name: string;
  cron: string;
  period: SummaryPeriod;
  channel: SummaryChannel;
  dryRun: boolean;
  templateId?: string;
  to?: string;
  subject?: string;
};
