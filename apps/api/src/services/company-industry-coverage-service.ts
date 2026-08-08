/**
 * Industry verification coverage summary (operator health snapshot).
 * Thin wrapper over companies:getIndustryCoverageSummary.
 */

import { config } from "./config.js";
import { callConvexQuery } from "./convex-utils.js";

export interface IndustryCoverageMaintenanceRun {
  runId: string;
  status?: string;
  triggerSource?: string;
  triggerContext?: string;
  operatorSummary?: string;
  failureMessage?: string;
  partial?: boolean;
  startedAt?: number;
  finishedAt?: number;
  counts: {
    proposalsResearched: number;
    readyCreated: number;
    sourcesDemoted: number;
    freshnessChecked: number;
    freshnessRefreshed: number;
    errors: number;
  };
}

export interface IndustryCoverageSummary {
  generatedAt: number;
  workspaceSlug: string;
  proposalsByStatus: Record<string, number>;
  openTotal: number;
  openWithSources: number;
  openWithoutSources: number;
  emptyEvidenceBottleneck: boolean;
  readyBacklogBottleneck: boolean;
  resumes: {
    total: number;
    withVerifiedEvidence: number;
  };
  profiles: {
    total: number;
    verified: number;
    rejected: number;
  };
  maintenance: {
    latest: IndustryCoverageMaintenanceRun | null;
    lastUseful: IndustryCoverageMaintenanceRun | null;
    lastFailed: IndustryCoverageMaintenanceRun | null;
  };
  researchQueue: {
    active: number;
    queued: number;
    leased: number;
    retryWait: number;
    needsIdentityReview: number;
    failed: number;
    byOrigin: Record<string, number>;
    oldestRequestedAt: number | null;
    oldestPriority: number | null;
    alerts: {
      oldestDirectDemandAgeMs: number;
      highRetryRate: boolean;
      providerLimitedBacklog: number;
      workerUnreachableRuns: number;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseRun(value: unknown): IndustryCoverageMaintenanceRun | null {
  if (!isRecord(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    return null;
  }
  const counts = isRecord(value.counts) ? value.counts : {};
  return {
    runId: value.runId.trim(),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(typeof value.triggerSource === "string"
      ? { triggerSource: value.triggerSource }
      : {}),
    ...(typeof value.triggerContext === "string"
      ? { triggerContext: value.triggerContext }
      : {}),
    ...(typeof value.operatorSummary === "string"
      ? { operatorSummary: value.operatorSummary }
      : {}),
    ...(typeof value.failureMessage === "string"
      ? { failureMessage: value.failureMessage }
      : {}),
    ...(typeof value.partial === "boolean" ? { partial: value.partial } : {}),
    ...(finiteNumber(value.startedAt) !== undefined
      ? { startedAt: finiteNumber(value.startedAt) }
      : {}),
    ...(finiteNumber(value.finishedAt) !== undefined
      ? { finishedAt: finiteNumber(value.finishedAt) }
      : {}),
    counts: {
      proposalsResearched: finiteNumber(counts.proposalsResearched) ?? 0,
      readyCreated: finiteNumber(counts.readyCreated) ?? 0,
      sourcesDemoted: finiteNumber(counts.sourcesDemoted) ?? 0,
      freshnessChecked: finiteNumber(counts.freshnessChecked) ?? 0,
      freshnessRefreshed: finiteNumber(counts.freshnessRefreshed) ?? 0,
      errors: finiteNumber(counts.errors) ?? 0,
    },
  };
}

export function parseIndustryCoverageSummary(
  value: unknown,
): IndustryCoverageSummary | null {
  if (!isRecord(value)) return null;
  const proposalsByStatus = isRecord(value.proposalsByStatus)
    ? Object.fromEntries(
        Object.entries(value.proposalsByStatus).map(([key, count]) => [
          key,
          finiteNumber(count) ?? 0,
        ]),
      )
    : {};
  const resumes = isRecord(value.resumes) ? value.resumes : {};
  const profiles = isRecord(value.profiles) ? value.profiles : {};
  const maintenance = isRecord(value.maintenance) ? value.maintenance : {};
  const researchQueue = isRecord(value.researchQueue) ? value.researchQueue : {};
  const generatedAt = finiteNumber(value.generatedAt);
  const openTotal = finiteNumber(value.openTotal);
  // openWithSources/openWithoutSources/emptyEvidenceBottleneck are computed
  // by the service from the merged countIndustryOpenProposalSources query
  // (the main Convex query must stay under the per-query system-op budget);
  // tolerate their absence from the raw Convex payload.
  const openWithSources = finiteNumber(value.openWithSources) ?? 0;
  const openWithoutSources = finiteNumber(value.openWithoutSources) ?? 0;
  if (
    generatedAt === undefined ||
    openTotal === undefined ||
    typeof value.workspaceSlug !== "string"
  ) {
    return null;
  }
  return {
    generatedAt,
    workspaceSlug: value.workspaceSlug,
    proposalsByStatus,
    openTotal,
    openWithSources,
    openWithoutSources,
    emptyEvidenceBottleneck: value.emptyEvidenceBottleneck === true,
    readyBacklogBottleneck: value.readyBacklogBottleneck === true,
    resumes: {
      total: finiteNumber(resumes.total) ?? 0,
      withVerifiedEvidence: finiteNumber(resumes.withVerifiedEvidence) ?? 0,
    },
    profiles: {
      total: finiteNumber(profiles.total) ?? 0,
      verified: finiteNumber(profiles.verified) ?? 0,
      rejected: finiteNumber(profiles.rejected) ?? 0,
    },
    maintenance: {
      latest: parseRun(maintenance.latest),
      lastUseful: parseRun(maintenance.lastUseful),
      lastFailed: parseRun(maintenance.lastFailed),
    },
    researchQueue: {
      active: finiteNumber(researchQueue.active) ?? 0,
      queued: finiteNumber(researchQueue.queued) ?? 0,
      leased: finiteNumber(researchQueue.leased) ?? 0,
      retryWait: finiteNumber(researchQueue.retryWait) ?? 0,
      needsIdentityReview: finiteNumber(researchQueue.needsIdentityReview) ?? 0,
      failed: finiteNumber(researchQueue.failed) ?? 0,
      byOrigin: isRecord(researchQueue.byOrigin)
        ? Object.fromEntries(Object.entries(researchQueue.byOrigin).map(([key, count]) => [key, finiteNumber(count) ?? 0]))
        : {},
      oldestRequestedAt: finiteNumber(researchQueue.oldestRequestedAt) ?? null,
      oldestPriority: finiteNumber(researchQueue.oldestPriority) ?? null,
      alerts: {
        oldestDirectDemandAgeMs: finiteNumber(isRecord(researchQueue.alerts) ? researchQueue.alerts.oldestDirectDemandAgeMs : undefined) ?? 0,
        highRetryRate: isRecord(researchQueue.alerts) && researchQueue.alerts.highRetryRate === true,
        providerLimitedBacklog: finiteNumber(isRecord(researchQueue.alerts) ? researchQueue.alerts.providerLimitedBacklog : undefined) ?? 0,
        workerUnreachableRuns: finiteNumber(isRecord(researchQueue.alerts) ? researchQueue.alerts.workerUnreachableRuns : undefined) ?? 0,
      },
    },
  };
}

export async function getIndustryCoverageSummary(
  workspaceSlug: string,
): Promise<IndustryCoverageSummary> {
  // Two budget-safe queries instead of one: the main summary scans the
  // ~9.8k-row proposals table (~9.9k system ops), and the open-with-sources
  // count runs as a separate lean query (~2k ops) so neither exceeds the
  // local-backend per-query system-op ceiling.
  const [value, openWithSources] = await Promise.all([
    callConvexQuery("companies:getIndustryCoverageSummary", {
      workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    }),
    callConvexQuery("companies:countIndustryOpenProposalSources", {
      workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    }),
  ]);
  const parsed = parseIndustryCoverageSummary(value);
  if (!parsed) {
    throw new Error("Invalid companies:getIndustryCoverageSummary response");
  }
  const withSources =
    typeof openWithSources === "number" ? openWithSources : 0;
  parsed.openWithSources = withSources;
  parsed.openWithoutSources = Math.max(0, parsed.openTotal - withSources);
  parsed.emptyEvidenceBottleneck =
    parsed.openTotal > 0 &&
    (withSources === 0 || withSources / parsed.openTotal < 0.05);
  return parsed;
}
