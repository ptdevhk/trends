/// <reference path="./query-count-augmentation.d.ts" />
import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  ACTIVE_RESEARCH_REQUEST_STATES,
  normalizeWorkspaceSlug,
  OPEN_INDUSTRY_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

/**
 * Operator coverage snapshot for Industry verification.
 * Aggregates proposal pipeline, open-proposal evidence fill, resume card
 * projection coverage, profile truth counts, and recent maintenance health.
 */

export const getIndustryCoverageSummary = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    maintenanceLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const maintenanceLimit = Math.min(
      50,
      Math.max(1, Math.floor(args.maintenanceLimit ?? 20)),
    );

    // Precomputed counters (P1.8/C5, 2026-08-09): the proposals / sources /
    // resume-links / profiles scans moved to maintenance-time refresh
    // mutations that write industry_coverage_counters. This query reads the
    // single doc (1 system op) instead of ~10.9k ops of scans, and keeps the
    // live maintenance + research-queue sections. A null doc (never
    // refreshed) surfaces as zeros; the API service awaits a refresh in
    // that case.
    const counters = await ctx.db
      .query("industry_coverage_counters")
      .withIndex("by_workspace", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .unique();
    const proposalsByStatus: Record<string, number> = {
      new: counters?.statusNew ?? 0,
      researching: counters?.statusResearching ?? 0,
      ready_for_review: counters?.statusReadyForReview ?? 0,
      needs_more_evidence: counters?.statusNeedsMoreEvidence ?? 0,
      approved: counters?.statusApproved ?? 0,
      rejected: counters?.statusRejected ?? 0,
      superseded: counters?.statusSuperseded ?? 0,
    };
    const openTotal = counters?.openTotal ?? 0;
    const openWithSources = counters?.openWithSources ?? 0;
    const resumeTotal = counters?.resumeTotal ?? 0;
    const withVerifiedEvidence = counters?.withVerifiedEvidence ?? 0;
    const verifiedProfiles = counters?.profileVerified ?? 0;
    const rejectedProfiles = counters?.profileRejected ?? 0;
    const profileTotal = verifiedProfiles + rejectedProfiles;
    const countersGeneratedAt =
      typeof counters?.generatedAt === "number" ? counters.generatedAt : null;

    const maintenanceRows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    maintenanceRows.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    const recentMaintenance = maintenanceRows.slice(0, maintenanceLimit);

    const researchRequests = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const activeResearchRequests = researchRequests.filter((row: any) =>
      ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    );
    const researchByOrigin: Record<string, number> = {};
    for (const request of activeResearchRequests) {
      researchByOrigin[request.origin] = (researchByOrigin[request.origin] ?? 0) + 1;
    }
    const oldestResearch = [...activeResearchRequests].sort(
      (left: any, right: any) => left.requestedAt - right.requestedAt,
    )[0];
    const oldestDirectResearch = [...activeResearchRequests]
      .filter((row: any) => row.origin === "resume_detail" || row.origin === "admin_review")
      .sort((left: any, right: any) => left.requestedAt - right.requestedAt)[0];
    const retryRequests = researchRequests.filter((row: any) => row.attemptCount > 1);
    const providerLimitedBacklog = researchRequests.filter(
      (row: any) => row.lastErrorCode === "provider_limited" && ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    ).length;
    const workerUnreachableRuns = recentMaintenance.filter(
      (run: any) => typeof run.failureMessage === "string" && run.failureMessage.toLowerCase().includes("worker"),
    ).length;

    const summarizeRun = (run: any) => {
      const counts = run?.counts && typeof run.counts === "object" ? run.counts : {};
      return {
        runId: String(run.runId ?? ""),
        status: typeof run.status === "string" ? run.status : undefined,
        triggerSource:
          typeof run.triggerSource === "string" ? run.triggerSource : undefined,
        triggerContext:
          typeof run.triggerContext === "string" ? run.triggerContext : undefined,
        operatorSummary:
          typeof run.operatorSummary === "string"
            ? run.operatorSummary
            : undefined,
        failureMessage:
          typeof run.failureMessage === "string"
            ? run.failureMessage
            : undefined,
        partial: typeof run.partial === "boolean" ? run.partial : undefined,
        startedAt:
          typeof run.startedAt === "number"
            ? run.startedAt
            : typeof run._creationTime === "number"
              ? run._creationTime
              : undefined,
        finishedAt:
          typeof run.finishedAt === "number" ? run.finishedAt : undefined,
        counts: {
          proposalsResearched:
            typeof counts.proposalsResearched === "number"
              ? counts.proposalsResearched
              : 0,
          readyCreated:
            typeof counts.readyCreated === "number" ? counts.readyCreated : 0,
          sourcesDemoted:
            typeof counts.sourcesDemoted === "number"
              ? counts.sourcesDemoted
              : 0,
          freshnessChecked:
            typeof counts.freshnessChecked === "number"
              ? counts.freshnessChecked
              : 0,
          freshnessRefreshed:
            typeof counts.freshnessRefreshed === "number"
              ? counts.freshnessRefreshed
              : 0,
          errors: typeof counts.errors === "number" ? counts.errors : 0,
        },
      };
    };

    const latest = recentMaintenance[0]
      ? summarizeRun(recentMaintenance[0])
      : null;

    let lastUseful: ReturnType<typeof summarizeRun> | null = null;
    for (const run of recentMaintenance) {
      if (run.status !== "completed") continue;
      const counts = run.counts && typeof run.counts === "object" ? run.counts : {};
      const researched =
        typeof counts.proposalsResearched === "number"
          ? counts.proposalsResearched
          : 0;
      const ready =
        typeof counts.readyCreated === "number" ? counts.readyCreated : 0;
      if (researched > 0 || ready > 0) {
        lastUseful = summarizeRun(run);
        break;
      }
    }

    let lastFailed: ReturnType<typeof summarizeRun> | null = null;
    for (const run of recentMaintenance) {
      if (run.status === "failed") {
        lastFailed = summarizeRun(run);
        break;
      }
    }

    // Treat "none" and "near-empty fill" as the same operator bottleneck:
    // research is not producing steward-ready evidence for the open backlog.
    // emptyEvidenceBottleneck is recomputed by the API service once the
    // merged openWithSources count is available.
    const readyBacklogBottleneck =
      (proposalsByStatus.ready_for_review ?? 0) === 0 &&
      ((proposalsByStatus.new ?? 0) > 0 ||
        (proposalsByStatus.needs_more_evidence ?? 0) > 0);

    return {
      generatedAt: Date.now(),
      workspaceSlug,
      proposalsByStatus,
      openTotal,
      openWithSources,
      readyBacklogBottleneck,
      countersGeneratedAt,
      resumes: {
        total: resumeTotal,
        withVerifiedEvidence,
      },
      profiles: {
        total: profileTotal,
        verified: verifiedProfiles,
        rejected: rejectedProfiles,
      },
      maintenance: {
        latest,
        lastUseful,
        lastFailed,
      },
      researchQueue: {
        active: activeResearchRequests.length,
        queued: activeResearchRequests.filter((row: any) => row.state === "queued").length,
        leased: activeResearchRequests.filter((row: any) => row.state === "leased").length,
        retryWait: activeResearchRequests.filter((row: any) => row.state === "retry_wait").length,
        needsIdentityReview: researchRequests.filter((row: any) => row.state === "needs_identity_review").length,
        failed: researchRequests.filter((row: any) => row.state === "failed").length,
        byOrigin: researchByOrigin,
        oldestRequestedAt: oldestResearch?.requestedAt ?? null,
        oldestPriority: oldestResearch?.priority ?? null,
        alerts: {
          oldestDirectDemandAgeMs: oldestDirectResearch
            ? Math.max(0, Date.now() - oldestDirectResearch.requestedAt)
            : 0,
          highRetryRate: researchRequests.length > 0 && retryRequests.length / researchRequests.length >= 0.25,
          providerLimitedBacklog,
          workerUnreachableRuns,
        },
      },
    };
  },
});

async function upsertIndustryCoverageCounters(
  ctx: any,
  workspaceSlug: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const existing = await ctx.db
    .query("industry_coverage_counters")
    .withIndex("by_workspace", (q: any) => q.eq("workspaceSlug", workspaceSlug))
    .unique();
  const material = {
    workspaceSlug,
    generatedAt: Date.now(),
    ...patch,
  };
  if (existing) {
    await ctx.db.patch(existing._id, material);
  } else {
    // Defaults must come BEFORE the spread: the patch carries the real
    // counts and must win on first insert (insert branch clobbered them
    // before 2026-08-09 fix).
    await ctx.db.insert("industry_coverage_counters", {
      statusNew: 0,
      statusResearching: 0,
      statusReadyForReview: 0,
      statusNeedsMoreEvidence: 0,
      statusApproved: 0,
      statusRejected: 0,
      statusSuperseded: 0,
      openTotal: 0,
      openWithSources: 0,
      resumeTotal: 0,
      withVerifiedEvidence: 0,
      profileVerified: 0,
      profileRejected: 0,
      ...material,
    });
  }
}

/**
 * Budget-safe coverage counters refresh, part 1: the proposals scan
 * (~9.8k system ops on preview) alone. Writes the status distribution and
 * openTotal; the evidence part arrives via
 * refreshIndustryCoverageEvidenceCounters.
 */

export const refreshIndustryCoverageProposalCounters = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const proposals = await ctx.db
      .query("company_industry_review_proposals")
      .collect();
    const proposalsByStatus: Record<string, number> = {};
    let openTotal = 0;
    for (const proposal of proposals) {
      const status = typeof proposal.status === "string" ? proposal.status : "unknown";
      proposalsByStatus[status] = (proposalsByStatus[status] ?? 0) + 1;
      if (OPEN_INDUSTRY_PROPOSAL_STATUSES.has(status)) {
        openTotal += 1;
      }
    }
    await upsertIndustryCoverageCounters(ctx, workspaceSlug, {
      statusNew: proposalsByStatus["new"] ?? 0,
      statusResearching: proposalsByStatus["researching"] ?? 0,
      statusReadyForReview: proposalsByStatus["ready_for_review"] ?? 0,
      statusNeedsMoreEvidence: proposalsByStatus["needs_more_evidence"] ?? 0,
      statusApproved: proposalsByStatus["approved"] ?? 0,
      statusRejected: proposalsByStatus["rejected"] ?? 0,
      statusSuperseded: proposalsByStatus["superseded"] ?? 0,
      openTotal,
      refreshNote: "proposal-counts",
    });
    return { openTotal, proposalsByStatus };
  },
});

/**
 * Budget-safe coverage counters refresh, part 2: the evidence scan (sources
 * table ~1k rows + indexed proposal lookups + resume links + profiles,
 * ~4k ops). Merges into the doc written by
 * refreshIndustryCoverageProposalCounters.
 */

export const refreshIndustryCoverageEvidenceCounters = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const sources = await ctx.db
      .query("company_industry_evidence_sources")
      .collect();
    const proposalIdSet = new Set<string>();
    for (const source of sources) {
      if (typeof source.proposalId === "string" && source.proposalId) {
        proposalIdSet.add(source.proposalId);
      }
    }
    let openWithSources = 0;
    for (const proposalId of proposalIdSet) {
      const proposal = await ctx.db
        .query("company_industry_review_proposals")
        .withIndex("by_proposal_id", (q: any) => q.eq("proposalId", proposalId))
        .first();
      if (proposal && OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
        openWithSources += 1;
      }
    }
    const resumeTotal = await ctx.db.query("resumes").count();
    const verifiedLinkResumes = new Set<string>();
    const resumeLinks = await ctx.db.query("company_resume_links").collect();
    for (const link of resumeLinks) {
      if (typeof link.currentVerdictRevisionId === "string") {
        verifiedLinkResumes.add(String(link.resumeId));
      }
    }
    const profiles = await ctx.db.query("company_industry_profiles").collect();
    let verifiedProfiles = 0;
    let rejectedProfiles = 0;
    for (const profile of profiles) {
      if (profile.verificationLevel === "verified") verifiedProfiles += 1;
      else if (profile.verificationLevel === "rejected") rejectedProfiles += 1;
    }
    await upsertIndustryCoverageCounters(ctx, workspaceSlug, {
      openWithSources,
      resumeTotal,
      withVerifiedEvidence: verifiedLinkResumes.size,
      profileVerified: verifiedProfiles,
      profileRejected: rejectedProfiles,
      refreshNote: "evidence-counts",
    });
    return { openWithSources, resumeTotal, withVerifiedEvidence: verifiedLinkResumes.size };
  },
});

export const getIndustryCoverageCounters = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const doc = await ctx.db
      .query("industry_coverage_counters")
      .withIndex("by_workspace", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .unique();
    return doc ?? null;
  },
});
