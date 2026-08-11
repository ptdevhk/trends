/**
 * Industry verification coverage summary (operator health snapshot).
 * Reads the precomputed counters doc (P1.8/C5) plus live maintenance and
 * research-queue state, and derives the operator bottleneck flags.
 */

import { config } from "./config.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";

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
  // openWithSources now arrives from the precomputed counters doc (C5);
  // tolerate its absence from older payloads.
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

const COUNTERS_REFRESH_TTL_MS = 5 * 60 * 1000;

function refreshCounters(workspaceSlug: string): void {
  const writeSecret = config.auth.convexWriteSecret;
  void callConvexMutation("companies:refreshIndustryCoverageProposalCounters", {
    workspaceSlug,
    writeSecret,
  }).catch(() => {
    // Counters are an operator snapshot; a failed refresh is served stale.
  });
  void callConvexMutation("companies:refreshIndustryCoverageEvidenceCounters", {
    workspaceSlug,
    writeSecret,
  }).catch(() => {
    // Counters are an operator snapshot; a failed refresh is served stale.
  });
}

export async function getIndustryCoverageSummary(
  workspaceSlug: string,
): Promise<IndustryCoverageSummary> {
  const writeSecret = config.auth.convexWriteSecret;
  const fetchValue = () =>
    callConvexQuery("companies:getIndustryCoverageSummary", {
      workspaceSlug,
      maintenanceLimit: 50,
      writeSecret,
    });

  let value = await fetchValue();
  const countersGeneratedAt = isRecord(value) && typeof value.countersGeneratedAt === "number"
    ? value.countersGeneratedAt
    : undefined;
  if (countersGeneratedAt === undefined) {
    // Never refreshed: pay for the refresh inline so the first render is
    // accurate instead of a wall of zeros. Each refresh mutation stays
    // under the per-query system-op ceiling (~9.8k and ~4k ops).
    await callConvexMutation("companies:refreshIndustryCoverageProposalCounters", {
      workspaceSlug,
      writeSecret,
    });
    await callConvexMutation("companies:refreshIndustryCoverageEvidenceCounters", {
      workspaceSlug,
      writeSecret,
    });
    value = await fetchValue();
  } else if (Date.now() - countersGeneratedAt > COUNTERS_REFRESH_TTL_MS) {
    refreshCounters(workspaceSlug);
  }

  const parsed = parseIndustryCoverageSummary(value);
  if (!parsed) {
    throw new Error("Invalid companies:getIndustryCoverageSummary response");
  }
  parsed.openWithoutSources = Math.max(0, parsed.openTotal - parsed.openWithSources);
  parsed.emptyEvidenceBottleneck =
    parsed.openTotal > 0 &&
    (parsed.openWithSources === 0 ||
      parsed.openWithSources / parsed.openTotal < 0.05);
  return parsed;
}
