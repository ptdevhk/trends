import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  findIndustryMaintenanceRun,
  industryMaintenanceRunModeValidator,
  normalizeWorkspaceSlug,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

// ---------------------------------------------------------------------------
// Industry evidence maintenance run registry + per-proposal ledger.
// Mirrors the recompute-run architecture: the worker writes runs/ledger rows
// during maintenance; the API pipeline + admin UI read them. All writes are
// write-secret gated; reads are read-secret gated. Ledger writes from the
// worker are best-effort (observability never aborts maintenance).
// ---------------------------------------------------------------------------

export const startIndustryMaintenanceRun = mutation({
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
    mode: v.optional(industryMaintenanceRunModeValidator),
    claimedRequestCount: v.optional(v.number()),
    targetProposalCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    if (!runId) throw new Error("Industry maintenance run requires a runId");
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);

    const id = await ctx.db.insert("industry_maintenance_runs", {
      runId,
      workspaceSlug,
      triggerSource: args.triggerSource,
      ...(args.triggerContext?.trim()
        ? { triggerContext: args.triggerContext.trim() }
        : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.claimedRequestCount !== undefined
        ? { claimedRequestCount: Math.max(0, Math.floor(args.claimedRequestCount)) }
        : {}),
      ...(args.targetProposalCount !== undefined
        ? { targetProposalCount: Math.max(0, Math.floor(args.targetProposalCount)) }
        : {}),
      status: "queued",
    });
    void id;
    return { runId };
  },
});

export const claimNextIndustryMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (!run || run.status !== "queued") return false;
    await ctx.db.patch(run._id, {
      status: "running",
      startedAt: Date.now(),
    });
    return true;
  },
});

export const patchIndustryMaintenanceRunContext = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    triggerContext: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryMaintenanceRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry maintenance run: ${args.runId}`);
    const next = args.triggerContext.trim();
    if (!next) return { runId: run.runId, triggerContext: run.triggerContext };
    const prior = run.triggerContext?.trim();
    const triggerContext = prior ? `${prior}; ${next}` : next;
    await ctx.db.patch(run._id, { triggerContext });
    return { runId: run.runId, triggerContext };
  },
});

export const appendIndustryMaintenanceLedger = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    proposalId: v.string(),
    companyKey: v.optional(v.string()),
    action: v.union(
      v.literal("researched"),
      v.literal("ready"),
      v.literal("demoted"),
      v.literal("recycled"),
      v.literal("needs_more_evidence"),
      v.literal("freshness_ok"),
      v.literal("freshness_refreshed"),
      v.literal("error"),
    ),
    reason: v.string(),
    detail: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const proposalId = args.proposalId.trim();
    if (!runId || !proposalId) {
      throw new Error("Industry maintenance ledger requires runId and proposalId");
    }
    await ctx.db.insert("industry_maintenance_ledger", {
      runId,
      proposalId,
      ...(args.companyKey?.trim()
        ? { companyKey: args.companyKey.trim() }
        : {}),
      action: args.action,
      reason: args.reason,
      ...(args.detail !== undefined ? { detail: args.detail } : {}),
    });
    return { ok: true };
  },
});

export const finishIndustryMaintenanceRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    counts: v.optional(v.any()),
    failureMessage: v.optional(v.string()),
    partial: v.optional(v.boolean()),
    operatorSummary: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const run = await findIndustryMaintenanceRun(ctx, runId);
    if (!run) throw new Error(`Unknown industry maintenance run: ${runId}`);
    await ctx.db.patch(run._id, {
      status: args.status,
      finishedAt: Date.now(),
      ...(args.counts !== undefined ? { counts: args.counts } : {}),
      ...(args.failureMessage?.trim()
        ? { failureMessage: args.failureMessage.trim() }
        : {}),
      ...(args.partial !== undefined ? { partial: args.partial } : {}),
      operatorSummary: args.operatorSummary,
    });
    return { runId, status: args.status };
  },
});

export const listIndustryMaintenanceRuns = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    const filtered = args.status
      ? rows.filter((r: any) => r.status === args.status)
      : rows;
    // Newest-first: prefer startedAt, fall back to _creationTime.
    filtered.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    return filtered.slice(0, limit);
  },
});

export const getIndustryMaintenanceRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryMaintenanceRun(ctx, args.runId.trim());
  },
});

export const listIndustryMaintenanceLedger = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.optional(v.string()),
    proposalId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const runId = args.runId?.trim();
    const proposalId = args.proposalId?.trim();
    if (!runId && !proposalId) {
      throw new Error(
        "Industry maintenance ledger requires runId or proposalId",
      );
    }
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 200)));
    const rows = runId
      ? await ctx.db
          .query("industry_maintenance_ledger")
          .withIndex("by_run", (q: any) => q.eq("runId", runId))
          .collect()
      : await ctx.db
          .query("industry_maintenance_ledger")
          .withIndex("by_proposal", (q: any) => q.eq("proposalId", proposalId))
          .collect();
    // Newest-first by creation time.
    rows.sort((left: any, right: any) => right._creationTime - left._creationTime);
    return rows.slice(0, limit);
  },
});

export const findActiveIndustryMaintenanceRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const rows = await ctx.db
      .query("industry_maintenance_runs")
      .withIndex("by_workspace_time", (q: any) =>
        q.eq("workspaceSlug", workspaceSlug),
      )
      .collect();
    const active = rows.filter(
      (r: any) => r.status === "queued" || r.status === "running",
    );
    if (active.length === 0) return null;
    active.sort(
      (left: any, right: any) =>
        (right.startedAt ?? right._creationTime) -
        (left.startedAt ?? left._creationTime),
    );
    return active[0];
  },
});
