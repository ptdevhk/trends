import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import { INDUSTRY_RESEARCH_ORIGIN_PRIORITIES } from "@trends/shared";
import {
  ACTIVE_RESEARCH_REQUEST_STATES,
  findIndustryMaintenanceRun,
  findIndustryProposal,
  industryMaintenanceRunModeValidator,
  normalizeWorkspaceSlug,
  REQUESTABLE_RESEARCH_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

const industryResearchOriginValidator = v.union(
  v.literal("resume_detail"),
  v.literal("resume_search_batch"),
  v.literal("admin_review"),
  v.literal("refresh"),
  v.literal("scheduled_sweep"),
);

const industryResearchStateValidator = v.union(
  v.literal("queued"),
  v.literal("leased"),
  v.literal("completed"),
  v.literal("needs_identity_review"),
  v.literal("needs_more_evidence"),
  v.literal("retry_wait"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const industryResearchFailureCodeValidator = v.union(
  v.literal("worker_unreachable"),
  v.literal("timeout"),
  v.literal("provider_limited"),
  v.literal("fetch_failed"),
  v.literal("identity_ambiguous"),
  v.literal("proposal_terminal"),
);

const MAX_RESEARCH_REQUEST_BATCH = 50;

const DEFAULT_RESEARCH_LEASE_MS = 5 * 60 * 1_000;

const MAX_RESEARCH_ATTEMPTS = 5;

const MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE = 100;

const MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL = 1_000;

const MAX_SCHEDULED_RESEARCH_PRODUCE = 20;

const SCHEDULED_RESEARCH_AGING_HOUR_MS = 60 * 60 * 1_000;

function researchPriorityForOrigin(origin: string): number {
  const priority = (INDUSTRY_RESEARCH_ORIGIN_PRIORITIES as Record<string, number>)[origin];
  return typeof priority === "number" ? priority : 10;
}

function safeResearchRequestSummary(row: any) {
  const retryableStates = new Set(["failed", "retry_wait", "needs_more_evidence"]);
  return {
    requestId: row.requestId,
    proposalId: row.proposalId,
    origin: row.origin,
    state: row.state,
    priority: row.priority,
    requestedAt: row.requestedAt,
    demandCount: row.demandCount,
    attemptCount: row.attemptCount,
    ...(row.nextAttemptAt !== undefined ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(row.leaseExpiresAt !== undefined ? { leaseExpiresAt: row.leaseExpiresAt } : {}),
    ...(row.lastRunId ? { lastRunId: row.lastRunId } : {}),
    ...(row.lastOutcome ? { lastOutcome: row.lastOutcome } : {}),
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    updatedAt: row.updatedAt,
    canRetry:
      retryableStates.has(row.state) &&
      row.attemptCount < MAX_RESEARCH_ATTEMPTS,
    canCancel: ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
  };
}

async function findIndustryResearchRequest(ctx: { db: any }, requestId: string) {
  const rows = await ctx.db
    .query("industry_evidence_research_requests")
    .withIndex("by_request_id", (q: any) => q.eq("requestId", requestId))
    .collect();
  return rows[0] ?? null;
}

async function listIndustryResearchRequestsForWorkspaceProposal(
  ctx: { db: any },
  workspaceSlug: string,
  proposalId: string,
) {
  return ctx.db
    .query("industry_evidence_research_requests")
    .withIndex("by_workspace_proposal", (q: any) =>
      q.eq("workspaceSlug", workspaceSlug).eq("proposalId", proposalId),
    )
    .collect();
}

// ---------------------------------------------------------------------------
// Targeted industry-evidence research request queue.
// ---------------------------------------------------------------------------

export const enqueueIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    origin: industryResearchOriginValidator,
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const proposalId = args.proposalId.trim();
    if (!proposalId) throw new Error("Research request requires a proposalId");
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    if (!REQUESTABLE_RESEARCH_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not requestable: ${proposal.status}`);
    }

    const now = Date.now();
    const incomingPriority = researchPriorityForOrigin(args.origin);
    const rows = await listIndustryResearchRequestsForWorkspaceProposal(
      ctx,
      workspaceSlug,
      proposalId,
    );
    const active = rows
      .filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state))
      .sort((left: any, right: any) => right.updatedAt - left.updatedAt)[0];
    if (active) {
      const nextPriority = Math.max(active.priority, incomingPriority);
      const nextState = active.state === "retry_wait" ? "queued" : active.state;
      await ctx.db.patch(active._id, {
        origin:
          nextPriority > active.priority ? args.origin : active.origin,
        priority: nextPriority,
        state: nextState,
        demandCount: active.demandCount + 1,
        ...(nextState === "queued" ? { nextAttemptAt: undefined } : {}),
        updatedAt: now,
      });
      return {
        ...safeResearchRequestSummary({
          ...active,
          origin: nextPriority > active.priority ? args.origin : active.origin,
          priority: nextPriority,
          state: nextState,
          demandCount: active.demandCount + 1,
          updatedAt: now,
        }),
        created: false,
        disposition: nextPriority > active.priority ? "reprioritized" : "already_queued",
      };
    }

    const workspaceActiveRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const workspaceActiveCount = workspaceActiveRows.filter((row: any) =>
      ACTIVE_RESEARCH_REQUEST_STATES.has(row.state),
    ).length;
    if (workspaceActiveCount >= MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE) {
      throw new Error("Industry research workspace queue limit reached");
    }
    const globalQueuedRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_state", (q: any) => q.eq("state", "queued"))
      .collect();
    if (globalQueuedRows.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) {
      throw new Error("Industry research global queue limit reached");
    }

    const requestId = `industry-research-${workspaceSlug}-${proposalId}-${now}-${Math.random().toString(36).slice(2, 8)}`;
    await ctx.db.insert("industry_evidence_research_requests", {
      requestId,
      workspaceSlug,
      proposalId,
      origin: args.origin,
      state: "queued",
      priority: incomingPriority,
      requestedAt: now,
      ...(args.requestedBy?.trim() ? { requestedBy: args.requestedBy.trim() } : {}),
      demandCount: 1,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      requestId,
      proposalId,
      origin: args.origin,
      state: "queued" as const,
      priority: incomingPriority,
      requestedAt: now,
      demandCount: 1,
      attemptCount: 0,
      updatedAt: now,
      canRetry: false,
      canCancel: true,
      created: true,
      disposition: "created" as const,
    };
  },
});

/**
 * Bounded background producer for the low-priority scheduled lane. It only
 * materializes requests for open proposals that currently have no active
 * request and stops at a small fixed cap; user-originated requests always
 * retain their higher priority and are never rewritten here.
 */

export const enqueueScheduledIndustryEvidenceResearchSweep = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const limit = Math.min(
      MAX_SCHEDULED_RESEARCH_PRODUCE,
      Math.max(1, Math.floor(args.limit ?? MAX_SCHEDULED_RESEARCH_PRODUCE)),
    );
    const proposalsById = new Map<string, any>();
    for (const status of ["new", "researching", "needs_more_evidence"] as const) {
      const rows = await ctx.db
        .query("company_industry_review_proposals")
        .withIndex("by_status_priority", (q: any) => q.eq("status", status))
        .collect();
      for (const row of rows) {
        if (row.proposalId) proposalsById.set(row.proposalId, row);
      }
    }
    const proposals = [...proposalsById.values()]
      .sort((left: any, right: any) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        String(left.proposalId).localeCompare(String(right.proposalId)),
      )
      .slice(0, limit * 3);
    const activeRows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const activeProposalIds = new Set(
      activeRows
        .filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state))
        .map((row: any) => row.proposalId),
    );
    const created: Array<{ requestId: string; proposalId: string }> = [];
    const now = Date.now();
    const globalQueuedCount = (await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_state", (q: any) => q.eq("state", "queued"))
      .collect()).length;
    if (globalQueuedCount >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) {
      return { created, limit, capped: true };
    }
    for (const proposal of proposals) {
      if (created.length >= limit || activeProposalIds.has(proposal.proposalId)) continue;
      if (activeRows.filter((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state)).length + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_PER_WORKSPACE) break;
      if (globalQueuedCount + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL) break;
      const requestId = `industry-scheduled-${workspaceSlug}-${proposal.proposalId}-${now}-${created.length}`;
      await ctx.db.insert("industry_evidence_research_requests", {
        requestId,
        workspaceSlug,
        proposalId: proposal.proposalId,
        origin: "scheduled_sweep",
        state: "queued",
        priority: INDUSTRY_RESEARCH_ORIGIN_PRIORITIES.scheduled_sweep,
        requestedAt: now,
        demandCount: 1,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      activeProposalIds.add(proposal.proposalId);
      created.push({ requestId, proposalId: proposal.proposalId });
    }
    return { created, limit, capped: globalQueuedCount + created.length >= MAX_ACTIVE_RESEARCH_REQUESTS_GLOBAL };
  },
});

export const getIndustryEvidenceResearchRequestSummary = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await listIndustryResearchRequestsForWorkspaceProposal(
      ctx,
      normalizeWorkspaceSlug(args.workspaceSlug),
      args.proposalId.trim(),
    );
    rows.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    const limit = Math.min(20, Math.max(1, Math.floor(args.limit ?? 10)));
    const active = rows.find((row: any) => ACTIVE_RESEARCH_REQUEST_STATES.has(row.state));
    return {
      active: active ? safeResearchRequestSummary(active) : null,
      history: rows.slice(0, limit).map((row: any) => safeResearchRequestSummary(row)),
    };
  },
});

export const listIndustryEvidenceResearchRequests = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    state: v.optional(industryResearchStateValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const rows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    const filtered = args.state ? rows.filter((row: any) => row.state === args.state) : rows;
    filtered.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    return filtered.slice(0, limit).map((row: any) => safeResearchRequestSummary(row));
  },
});

async function claimIndustryEvidenceResearchRequestsInternal(
  ctx: { db: any },
  args: {
    writeSecret?: string;
    runId: string;
    workspaceSlug?: string;
    requestIds?: string[];
    proposalIds?: string[];
    limit?: number;
    leaseId?: string;
    leaseMs?: number;
  },
) {
  const now = Date.now();
  const limit = Math.min(
    MAX_RESEARCH_REQUEST_BATCH,
    Math.max(1, Math.floor(args.limit ?? 10)),
  );
  const requestIdSet = new Set((args.requestIds ?? []).map((id) => id.trim()).filter(Boolean));
  const proposalIdSet = new Set((args.proposalIds ?? []).map((id) => id.trim()).filter(Boolean));
  const rows = await ctx.db.query("industry_evidence_research_requests").collect();
  const candidates = rows.filter((row: any) => {
    if (!ACTIVE_RESEARCH_REQUEST_STATES.has(row.state) || row.state === "leased") return false;
    if (row.state === "retry_wait" && row.nextAttemptAt !== undefined && row.nextAttemptAt > now) {
      return false;
    }
    if (args.workspaceSlug && row.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug)) return false;
    if (requestIdSet.size > 0 && !requestIdSet.has(row.requestId)) return false;
    if (proposalIdSet.size > 0 && !proposalIdSet.has(row.proposalId)) return false;
    return true;
  });
  const effectivePriority = (row: any): number => {
    const aging = row.origin === "scheduled_sweep"
      ? Math.min(
          20,
          Math.max(0, Math.floor((now - row.requestedAt) / SCHEDULED_RESEARCH_AGING_HOUR_MS)),
        )
      : 0;
    return row.priority + aging;
  };
  candidates.sort(
    (left: any, right: any) =>
      effectivePriority(right) - effectivePriority(left) ||
      left.requestedAt - right.requestedAt ||
      left.requestId.localeCompare(right.requestId),
  );

  const selectedProposalIds: string[] = [];
  const selected = new Set<string>();
  for (const row of candidates) {
    if (selected.has(row.proposalId)) continue;
    if (selectedProposalIds.length >= limit) break;
    selected.add(row.proposalId);
    selectedProposalIds.push(row.proposalId);
  }
  const selectedRows = candidates.filter((row: any) => selected.has(row.proposalId));
  const leaseBase = args.leaseId?.trim() || `lease-${args.runId}-${now}`;
  const leaseMs = Math.min(
    15 * 60 * 1_000,
    Math.max(30_000, Math.floor(args.leaseMs ?? DEFAULT_RESEARCH_LEASE_MS)),
  );
  const requests: Array<{ requestId: string; proposalId: string; leaseId: string }> = [];
  for (const [index, row] of selectedRows.entries()) {
    const leaseId = `${leaseBase}-${index}`;
    await ctx.db.patch(row._id, {
      state: "leased",
      leaseId,
      leaseExpiresAt: now + leaseMs,
      attemptCount: row.attemptCount + 1,
      lastRunId: args.runId.trim(),
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    requests.push({ requestId: row.requestId, proposalId: row.proposalId, leaseId });
  }
  return {
    runId: args.runId.trim(),
    proposalIds: selectedProposalIds,
    requests,
  };
}

export const claimIndustryEvidenceResearchRequests = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.optional(v.string()),
    requestIds: v.optional(v.array(v.string())),
    proposalIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    leaseId: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    return claimIndustryEvidenceResearchRequestsInternal(ctx, args);
  },
});

export const startAndClaimIndustryEvidenceMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.string(),
    triggerSource: v.union(
      v.literal("schedule"),
      v.literal("restore"),
      v.literal("approval"),
      v.literal("manual"),
    ),
    triggerContext: v.optional(v.string()),
    mode: industryMaintenanceRunModeValidator,
    requestIds: v.optional(v.array(v.string())),
    proposalIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    if (!runId) throw new Error("Industry maintenance run requires a runId");
    const targetedLimit = args.mode === "targeted"
      ? Math.min(
          MAX_RESEARCH_REQUEST_BATCH,
          Math.max(1, args.limit ?? args.requestIds?.length ?? args.proposalIds?.length ?? 1),
        )
      : args.limit;
    const claimArgs = { ...args, limit: targetedLimit };
    const existing = await findIndustryMaintenanceRun(ctx, runId);
    if (existing) {
      const claimed = await claimIndustryEvidenceResearchRequestsInternal(ctx, claimArgs);
      return { ...claimed, created: false };
    }
    await ctx.db.insert("industry_maintenance_runs", {
      runId,
      workspaceSlug,
      triggerSource: args.triggerSource,
      ...(args.triggerContext?.trim() ? { triggerContext: args.triggerContext.trim() } : {}),
      mode: args.mode,
      claimedRequestCount: 0,
      targetProposalCount: 0,
      status: "queued",
    });
    const claimed = await claimIndustryEvidenceResearchRequestsInternal(ctx, claimArgs);
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (run) {
      await ctx.db.patch(run._id, {
        claimedRequestCount: claimed.requests.length,
        targetProposalCount: claimed.proposalIds.length,
      });
    }
    return { ...claimed, created: true };
  },
});

export const renewIndustryEvidenceResearchRequestLease = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    leaseId: v.string(),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (!request || request.state !== "leased" || request.leaseId !== args.leaseId.trim()) {
      return { renewed: false };
    }
    const leaseMs = Math.min(
      15 * 60 * 1_000,
      Math.max(30_000, Math.floor(args.leaseMs ?? DEFAULT_RESEARCH_LEASE_MS)),
    );
    const leaseExpiresAt = Date.now() + leaseMs;
    await ctx.db.patch(request._id, { leaseExpiresAt, updatedAt: Date.now() });
    return { renewed: true, requestId: request.requestId, leaseExpiresAt };
  },
});

export const completeIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    leaseId: v.string(),
    runId: v.optional(v.string()),
    state: v.union(
      v.literal("completed"),
      v.literal("needs_identity_review"),
      v.literal("needs_more_evidence"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    outcome: v.string(),
    failureCode: v.optional(industryResearchFailureCodeValidator),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (!request) throw new Error(`Unknown research request: ${args.requestId}`);
    if (request.state !== "leased" || request.leaseId !== args.leaseId.trim()) {
      return { completed: false, reason: "lease_mismatch" };
    }
    const now = Date.now();
    await ctx.db.patch(request._id, {
      state: args.state,
      ...(args.runId?.trim() ? { lastRunId: args.runId.trim() } : {}),
      lastOutcome: args.outcome.trim().slice(0, 300),
      ...(args.failureCode ? { lastErrorCode: args.failureCode } : {}),
      leaseId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    return { completed: true, requestId: request.requestId, state: args.state };
  },
});

export const releaseIndustryEvidenceResearchRequests = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    requests: v.array(v.object({ requestId: v.string(), leaseId: v.string() })),
    failureCode: industryResearchFailureCodeValidator,
    outcome: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const now = Date.now();
    const updated: string[] = [];
    for (const item of args.requests.slice(0, MAX_RESEARCH_REQUEST_BATCH)) {
      const request = await findIndustryResearchRequest(ctx, item.requestId.trim());
      if (
        !request ||
        request.state !== "leased" ||
        request.leaseId !== item.leaseId.trim() ||
        request.lastRunId !== args.runId.trim()
      ) {
        continue;
      }
      const attempt = request.attemptCount;
      const terminal = attempt >= MAX_RESEARCH_ATTEMPTS;
      const backoffMs = Math.min(30 * 60 * 1_000, 30_000 * 2 ** Math.max(0, attempt - 1));
      await ctx.db.patch(request._id, {
        state: terminal ? "failed" : "retry_wait",
        nextAttemptAt: terminal ? undefined : now + backoffMs,
        lastOutcome: args.outcome.trim().slice(0, 300),
        lastErrorCode: args.failureCode,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      updated.push(request.requestId);
    }
    return { updated };
  },
});

export const recoverExpiredIndustryEvidenceResearchLeases = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const now = Date.now();
    const limit = Math.min(MAX_RESEARCH_REQUEST_BATCH, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_lease_expiry", (q: any) => q.eq("state", "leased"))
      .collect();
    const recovered: string[] = [];
    for (const request of rows
      .filter((row: any) => row.leaseExpiresAt !== undefined && row.leaseExpiresAt <= now)
      .sort((left: any, right: any) => (left.leaseExpiresAt ?? 0) - (right.leaseExpiresAt ?? 0))
      .slice(0, limit)) {
      const terminal = request.attemptCount >= MAX_RESEARCH_ATTEMPTS;
      await ctx.db.patch(request._id, {
        state: terminal ? "failed" : "retry_wait",
        nextAttemptAt: terminal ? undefined : now + 30_000,
        lastOutcome: "lease expired before research completed",
        lastErrorCode: "timeout",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      recovered.push(request.requestId);
    }
    return { recovered };
  },
});

export const retryIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (
      !request ||
      request.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug) ||
      request.proposalId !== args.proposalId.trim()
    ) {
      throw new Error("Unknown research request");
    }
    if (!(request.state === "failed" || request.state === "retry_wait" || request.state === "needs_more_evidence")) {
      throw new Error(`Research request is not retryable: ${request.state}`);
    }
    if (request.attemptCount >= MAX_RESEARCH_ATTEMPTS) {
      throw new Error("Research request retry limit reached");
    }
    await ctx.db.patch(request._id, {
      state: "queued",
      nextAttemptAt: undefined,
      lastErrorCode: undefined,
      updatedAt: Date.now(),
    });
    return { requestId: request.requestId, state: "queued" as const };
  },
});

export const cancelIndustryEvidenceResearchRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    proposalId: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const request = await findIndustryResearchRequest(ctx, args.requestId.trim());
    if (
      !request ||
      request.workspaceSlug !== normalizeWorkspaceSlug(args.workspaceSlug) ||
      request.proposalId !== args.proposalId.trim()
    ) {
      throw new Error("Unknown research request");
    }
    if (!ACTIVE_RESEARCH_REQUEST_STATES.has(request.state)) {
      return { requestId: request.requestId, state: request.state, cancelled: false };
    }
    await ctx.db.patch(request._id, {
      state: "cancelled",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      lastOutcome: "cancelled by administrator",
      updatedAt: Date.now(),
    });
    return { requestId: request.requestId, state: "cancelled" as const, cancelled: true };
  },
});
