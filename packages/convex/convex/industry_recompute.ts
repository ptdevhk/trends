import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  currentIndustryRevisionId,
  findIndustryProposal,
  findIndustryRecomputeRun,
  normalizeCompanyKey,
  normalizeWorkspaceSlug,
  requireReadSecret,
  requireWriteSecret,
  TERMINAL_INDUSTRY_RECOMPUTE_STATUSES,
} from "./lib/company_shared.js";

// ---------------------------------------------------------------------------
// Durable targeted company-industry recompute orchestration
// ---------------------------------------------------------------------------

const INDUSTRY_RECOMPUTE_BATCH_SIZE = 50;

const INDUSTRY_RECOMPUTE_FAILURE_SAMPLE_LIMIT = 20;

async function findIndustryRecomputeBatch(ctx: { db: any }, batchId: string) {
  const rows = await ctx.db
    .query("company_industry_recompute_batches")
    .withIndex("by_batch_id", (q: any) => q.eq("batchId", batchId))
    .collect();
  return rows[0] ?? null;
}

async function patchProposalRecomputeState(
  ctx: { db: any },
  proposalId: string | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!proposalId) return;
  const proposal = await findIndustryProposal(ctx, proposalId);
  if (!proposal) return;
  await ctx.db.patch(proposal._id, patch);
}

function boundedRunFailures(
  existing: Array<{
    resumeId?: string;
    stage: string;
    message: string;
    occurredAt: number;
  }>,
  additions: Array<{
    resumeId?: string;
    stage: string;
    message: string;
    occurredAt: number;
  }>,
) {
  return [...existing, ...additions].slice(-INDUSTRY_RECOMPUTE_FAILURE_SAMPLE_LIMIT);
}

export const getIndustryRecomputeRevisionState = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
    targetRevisionId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const targetRevisionId = args.targetRevisionId.trim();
    const currentRevisionId = await currentIndustryRevisionId(ctx, companyKey);
    return {
      currentRevisionId,
      matchesTargetRevision:
        Boolean(targetRevisionId) && currentRevisionId === targetRevisionId,
    };
  },
});

export const startIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    targetRevisionId: v.string(),
    proposalId: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const runId = args.runId.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const targetRevisionId = args.targetRevisionId.trim();
    if (!runId || !companyKey || !targetRevisionId) {
      throw new Error(
        "Industry recompute requires runId, companyKey, and targetRevisionId",
      );
    }

    const currentRevisionId = await currentIndustryRevisionId(ctx, companyKey);
    if (currentRevisionId !== targetRevisionId) {
      throw new Error(
        `Industry recompute target revision ${targetRevisionId} is not current for ${companyKey}`,
      );
    }

    const existing = await ctx.db
      .query("company_industry_recompute_runs")
      .withIndex("by_workspace_company_revision", (q) =>
        q
          .eq("workspaceSlug", workspaceSlug)
          .eq("companyKey", companyKey)
          .eq("targetRevisionId", targetRevisionId),
      )
      .collect();
    if (existing[0]) {
      return existing[0];
    }
    if (await findIndustryRecomputeRun(ctx, runId)) {
      throw new Error(`Industry recompute runId already exists: ${runId}`);
    }

    const now = Date.now();
    const normalizedProposalId = args.proposalId?.trim() || undefined;
    const id = await ctx.db.insert("company_industry_recompute_runs", {
      runId,
      workspaceSlug,
      companyKey,
      targetRevisionId,
      ...(normalizedProposalId ? { proposalId: normalizedProposalId } : {}),
      ...(args.requestedBy?.trim()
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      status: "queued",
      attempt: 1,
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      createdAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, normalizedProposalId, {
      approvedRevisionId: targetRevisionId,
      recomputeRunId: runId,
      applicationState: "recompute_pending",
      updatedAt: now,
    });
    return ctx.db.get(id);
  },
});

export const getIndustryRecomputeRun = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryRecomputeRun(ctx, args.runId.trim());
  },
});

export const listIndustryRecomputeRuns = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    companyKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 20)));
    return ctx.db
      .query("company_industry_recompute_runs")
      .withIndex("by_workspace_company_updated", (q) =>
        q.eq("workspaceSlug", workspaceSlug).eq("companyKey", companyKey),
      )
      .order("desc")
      .take(limit);
  },
});

export const getNextIndustryRecomputeBatch = query({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const runId = args.runId.trim();
    for (const status of ["dispatched", "planned"] as const) {
      const rows = await ctx.db
        .query("company_industry_recompute_batches")
        .withIndex("by_run_status", (q) =>
          q.eq("runId", runId).eq("status", status),
        )
        .collect();
      rows.sort(
        (left, right) =>
          left.pageNumber - right.pageNumber ||
          left.batchId.localeCompare(right.batchId),
      );
      if (rows[0]) return rows[0];
    }
    return null;
  },
});

export const reserveIndustryRecomputePage = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    expectedCursor: v.optional(v.string()),
    items: v.array(
      v.object({
        resumeId: v.id("resumes"),
        currentVerdictRevisionId: v.optional(v.string()),
      }),
    ),
    continueCursor: v.string(),
    isDone: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(run.status)) return run;
    if (args.items.length > 200) {
      throw new Error("Industry recompute pages are limited to 200 resumes");
    }
    if ((run.cursor ?? "") !== (args.expectedCursor ?? "")) {
      return run;
    }
    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      throw new Error("Industry recompute revision was superseded");
    }

    const seenResumeIds = new Set<string>();
    const uniqueItems = args.items.filter((item) => {
      const resumeId = String(item.resumeId);
      if (seenResumeIds.has(resumeId)) return false;
      seenResumeIds.add(resumeId);
      return true;
    });
    const alreadyCurrent = uniqueItems.filter(
      (item) => item.currentVerdictRevisionId === run.targetRevisionId,
    );
    const staleResumeIds = uniqueItems
      .filter(
        (item) => item.currentVerdictRevisionId !== run.targetRevisionId,
      )
      .map((item) => item.resumeId);
    const now = Date.now();
    const pageNumber = run.pageCount + 1;
    let createdBatches = 0;
    for (
      let index = 0;
      index < staleResumeIds.length;
      index += INDUSTRY_RECOMPUTE_BATCH_SIZE
    ) {
      const batchNumber = Math.floor(index / INDUSTRY_RECOMPUTE_BATCH_SIZE) + 1;
      const batchId = `${run.runId}:${run.attempt}:${pageNumber}:${batchNumber}`;
      if (!(await findIndustryRecomputeBatch(ctx, batchId))) {
        await ctx.db.insert("company_industry_recompute_batches", {
          batchId,
          runId: run.runId,
          pageNumber,
          status: "planned",
          resumeIds: staleResumeIds.slice(
            index,
            index + INDUSTRY_RECOMPUTE_BATCH_SIZE,
          ),
          createdAt: now,
          updatedAt: now,
        });
        createdBatches += 1;
      }
    }
    await ctx.db.patch(run._id, {
      status: staleResumeIds.length > 0 ? "running" : run.status,
      cursor: args.continueCursor,
      sourceDone: args.isDone,
      pageCount: pageNumber,
      affectedCount: run.affectedCount + uniqueItems.length,
      alreadyCurrentCount:
        run.alreadyCurrentCount + alreadyCurrent.length,
      readyCount: run.readyCount + alreadyCurrent.length,
      ...(run.startedAt === undefined ? { startedAt: now } : {}),
      updatedAt: now,
    });
    if (createdBatches > 0) {
      await patchProposalRecomputeState(ctx, run.proposalId, {
        applicationState: "recompute_running",
        updatedAt: now,
      });
    }
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchDispatch = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    dispatchedAt: v.number(),
    expectedSkillsVersion: v.number(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (batch.status !== "planned") return run;
    const now = Date.now();
    await ctx.db.patch(batch._id, {
      status: "dispatched",
      dispatchedAt: args.dispatchedAt,
      expectedSkillsVersion: args.expectedSkillsVersion,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "waiting",
      scheduledCount: run.scheduledCount + batch.resumeIds.length,
      batchCount: run.batchCount + 1,
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchFailure = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    stage: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (
      batch.status === "completed" ||
      batch.status === "partial_failed" ||
      batch.status === "failed"
    ) {
      return run;
    }
    const stage = args.stage.trim() || "unknown";
    const message = args.message.trim() || "Unknown recompute failure";
    const now = Date.now();
    const failures: Array<{
      resumeId: string;
      stage: string;
      message: string;
    }> = batch.resumeIds.map((resumeId: unknown) => ({
      resumeId: String(resumeId),
      stage,
      message,
    }));
    await ctx.db.patch(batch._id, {
      status: "failed",
      readyCount: 0,
      failureCount: failures.length,
      failures,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "running",
      failureCount: run.failureCount + failures.length,
      failures: boundedRunFailures(
        run.failures,
        failures.map((failure: {
          resumeId: string;
          stage: string;
          message: string;
        }) => ({ ...failure, occurredAt: now })),
      ),
      lastError: message,
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const recordIndustryRecomputeBatchReadiness = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    batchId: v.string(),
    readyResumeIds: v.array(v.id("resumes")),
    failures: v.array(
      v.object({
        resumeId: v.optional(v.string()),
        stage: v.string(),
        message: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    const batch = await findIndustryRecomputeBatch(ctx, args.batchId.trim());
    if (!run || !batch || batch.runId !== run.runId) {
      throw new Error("Unknown industry recompute batch");
    }
    if (
      batch.status === "completed" ||
      batch.status === "partial_failed" ||
      batch.status === "failed"
    ) {
      return run;
    }
    if (batch.status !== "dispatched") {
      throw new Error("Industry recompute batch has not been dispatched");
    }

    const batchResumeIds = new Set(batch.resumeIds.map(String));
    const readyResumeIds = Array.from(
      new Set(args.readyResumeIds.map(String)),
    );
    if (readyResumeIds.some((resumeId) => !batchResumeIds.has(resumeId))) {
      throw new Error("Industry recompute readiness contains an unrelated resume");
    }
    const failureResumeIds = new Set(
      args.failures
        .map((failure) => failure.resumeId)
        .filter((resumeId): resumeId is string => Boolean(resumeId)),
    );
    const coveredResumeIds = new Set([...readyResumeIds, ...failureResumeIds]);
    if (coveredResumeIds.size !== batch.resumeIds.length) {
      throw new Error("Industry recompute readiness does not cover the batch");
    }

    const now = Date.now();
    const status =
      args.failures.length === 0
        ? ("completed" as const)
        : readyResumeIds.length > 0
          ? ("partial_failed" as const)
          : ("failed" as const);
    await ctx.db.patch(batch._id, {
      status,
      readyCount: readyResumeIds.length,
      failureCount: args.failures.length,
      failures: args.failures,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "running",
      readyCount: run.readyCount + readyResumeIds.length,
      failureCount: run.failureCount + args.failures.length,
      failures: boundedRunFailures(
        run.failures,
        args.failures.map((failure) => ({ ...failure, occurredAt: now })),
      ),
      ...(args.failures[0]?.message
        ? { lastError: args.failures[0].message }
        : {}),
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const finalizeIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(run.status)) return run;

    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      const now = Date.now();
      await ctx.db.patch(run._id, {
        status: "superseded",
        supersededByRevisionId: currentRevisionId,
        completedAt: now,
        updatedAt: now,
      });
      await patchProposalRecomputeState(ctx, run.proposalId, {
        applicationState: "superseded",
        updatedAt: now,
      });
      return ctx.db.get(run._id);
    }
    if (!run.sourceDone) return run;

    const batches = await ctx.db
      .query("company_industry_recompute_batches")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .collect();
    if (
      batches.some(
        (batch) =>
          batch.status === "planned" || batch.status === "dispatched",
      )
    ) {
      return run;
    }

    const now = Date.now();
    const status =
      run.failureCount === 0
        ? ("completed" as const)
        : run.readyCount > 0
          ? ("partial_failed" as const)
          : ("failed" as const);
    await ctx.db.patch(run._id, {
      status,
      completedAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(
      ctx,
      run.proposalId,
      status === "completed"
        ? {
            applicationState: "applied",
            appliedRevisionId: run.targetRevisionId,
            appliedAt: now,
            updatedAt: now,
          }
        : {
            applicationState: "partial_failure",
            updatedAt: now,
          },
    );
    return ctx.db.get(run._id);
  },
});

export const markIndustryRecomputeRunSuperseded = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    observedRevisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (run.status === "superseded") return run;
    if (
      run.status === "completed" ||
      run.status === "partial_failed" ||
      run.status === "failed"
    ) {
      return run;
    }
    const observedRevisionId =
      args.observedRevisionId?.trim() ||
      (await currentIndustryRevisionId(ctx, run.companyKey));
    if (observedRevisionId === run.targetRevisionId) {
      return run;
    }
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "superseded",
      supersededByRevisionId: observedRevisionId,
      completedAt: now,
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, run.proposalId, {
      applicationState: "superseded",
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const retryIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting" ||
      run.status === "completed"
    ) {
      return run;
    }
    if (run.status === "superseded") {
      throw new Error(
        "Cannot retry an industry recompute for a superseded revision",
      );
    }
    const currentRevisionId = await currentIndustryRevisionId(
      ctx,
      run.companyKey,
    );
    if (currentRevisionId !== run.targetRevisionId) {
      throw new Error(
        "Cannot retry an industry recompute for a superseded revision",
      );
    }

    const batches = await ctx.db
      .query("company_industry_recompute_batches")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .collect();
    for (const batch of batches) {
      await ctx.db.delete(batch._id);
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "queued",
      attempt: run.attempt + 1,
      cursor: undefined,
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      lastError: undefined,
      completedAt: undefined,
      ...(args.requestedBy?.trim()
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, run.proposalId, {
      applicationState: "recompute_pending",
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});

export const resetIndustryRecomputeRun = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    runId: v.string(),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const run = await findIndustryRecomputeRun(ctx, args.runId.trim());
    if (!run) throw new Error(`Unknown industry recompute run: ${args.runId}`);
    if (run.status === "superseded") {
      throw new Error(
        "Cannot retry an industry recompute for a superseded revision",
      );
    }

    const batches = await ctx.db
      .query("company_industry_recompute_batches")
      .withIndex("by_run", (q) => q.eq("runId", run.runId))
      .collect();
    for (const batch of batches) {
      await ctx.db.delete(batch._id);
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "queued",
      attempt: run.attempt + 1,
      cursor: undefined,
      sourceDone: false,
      pageCount: 0,
      affectedCount: 0,
      alreadyCurrentCount: 0,
      scheduledCount: 0,
      readyCount: 0,
      failureCount: 0,
      batchCount: 0,
      failures: [],
      lastError: undefined,
      completedAt: undefined,
      ...(args.requestedBy?.trim()
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      updatedAt: now,
    });
    await patchProposalRecomputeState(ctx, run.proposalId, {
      applicationState: "recompute_pending",
      updatedAt: now,
    });
    return ctx.db.get(run._id);
  },
});
