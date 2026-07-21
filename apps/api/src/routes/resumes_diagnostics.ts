import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexMutation, callConvexQuery, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { CURRENT_INGEST_COMPUTE_EPOCH, resolveResumeDiagnosticsSourceKey } from "@trends/shared";
import {
  AnalysisTasksResponseSchema,
  AnalysisTaskCancelResponseSchema,
  AnalysisTaskDispatchRequestSchema,
  AnalysisTaskDispatchResponseSchema,
  AnalysisTaskDetailResponseSchema,
  AnalysisTaskDetailSchema,
  ExactTaskAuditPageResponseSchema,
  ExactTaskAuditPageSchema,
  ResumeDiagnosticsQuerySchema,
  ResumeDiagnosticsResponseSchema,
} from "../schemas/index.js";
import { requireAdmin, requireAdminOrConvexWorker } from "../middleware/auth.js";
import { requireWorkspacePermission } from "../services/workspace-permissions.js";

const app = new OpenAPIHono();
// Member permission: workspace role `user` and `admin` both get resume:analysis:run.
// Previously requireAdmin blocked HR members (role user) from search auto-analyze.
app.use("/api/resumes/analysis-tasks", requireWorkspacePermission("resume:analysis:run"));
app.use("/api/resumes/analysis-tasks/*", requireWorkspacePermission("resume:analysis:run"));
// Audit export remains workspace-admin only (compliance surface).
app.use("/api/resumes/analysis-tasks/*/audit-export", requireAdmin);
// skills-version is read by Convex ingest_agent reIngestStaleResumes with write secret
app.use("/api/resumes/skills-version", requireAdminOrConvexWorker);
app.use("/api/resumes/field-coverage", requireAdmin);
app.use("/api/resumes/diagnostics", requireAdmin);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);

const SimpleErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const AnalysisTasksSuccessSchema = AnalysisTasksResponseSchema;
const SkillsVersionResponseSchema = z.object({
  success: z.literal(true),
  version: z.number(),
  /** Algorithm epoch for roleSignals/years (distinct from skills catalog version). */
  ingestComputeEpoch: z.number().int(),
});
const FieldCoverageResponseSchema = z.object({
  success: z.literal(true),
  scanned: z.number().int(),
  missingSearchText: z.number().int(),
  missingVerifiedRoleYears: z.number().int(),
  hasRoleSignals: z.number().int(),
  missingIngestComputeEpoch: z.number().int(),
  laggingIngestComputeEpoch: z.number().int(),
  currentIngestComputeEpoch: z.number().int(),
});
const SearchFreshnessResponseSchema = z.object({
  success: z.literal(true),
  currentSkillsVersion: z.number().int(),
  currentIngestComputeEpoch: z.number().int(),
  apiReachable: z.boolean(),
  lag: z.object({
    scanned: z.number().int(),
    withIngestData: z.number().int(),
    skillsStale: z.number().int(),
    computeStale: z.number().int(),
    missingEpoch: z.number().int(),
    currentEpoch: z.number().int(),
    scanComplete: z.boolean(),
  }),
  goldenQueries: z.array(z.object({
    id: z.string(),
    location: z.string(),
    q: z.string(),
    minRoleYears: z.number(),
    roleType: z.string().optional(),
    minTotalFloor: z.number(),
    total: z.number().nullable(),
    ok: z.boolean().nullable(),
    error: z.string().optional(),
  })),
  /** Non-zero when compute-stale above threshold or a golden floor fails while API is up */
  exitCodeHint: z.number().int(),
  messages: z.array(z.string()),
});

const ExactTaskAuditPageQuerySchema = z.object({
  cursor: z.string().min(1).max(4_096).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
});

type ExactTaskAuditPage = z.infer<typeof ExactTaskAuditPageSchema>;

const exactTaskAuditMismatchReasonSequences = [
  ["job_description_mismatch"],
  ["prompt_version_mismatch"],
  ["timestamp_missing"],
  ["not_newer_than_dispatch"],
  ["job_description_mismatch", "prompt_version_mismatch"],
  ["job_description_mismatch", "timestamp_missing"],
  ["job_description_mismatch", "not_newer_than_dispatch"],
  ["prompt_version_mismatch", "timestamp_missing"],
  ["prompt_version_mismatch", "not_newer_than_dispatch"],
  ["job_description_mismatch", "prompt_version_mismatch", "timestamp_missing"],
  ["job_description_mismatch", "prompt_version_mismatch", "not_newer_than_dispatch"],
] as const;

function hasExactTaskAuditScoreEvidence(row: ExactTaskAuditPage["page"][number]): boolean {
  return [
    row.finalAiScore,
    row.currentRecommendation,
    row.currentBreakdown,
    row.relatedExpAuditFactor,
    row.relatedExpContribution,
    row.industryDbContribution,
    row.currentAISummary,
    row.currentHighlights,
    row.currentConcerns,
    row.currentKeyFactors,
    row.evidenceBandMax,
    row.relatedExpCoverage,
    row.missingReasons,
    row.effectiveRelatedExp,
    row.llmRelatedExp,
    row.recommendationMax,
    row.relatedExpContextHash,
    row.relatedExpRubricVersion,
  ].some((value) => value !== undefined);
}

function hasExactTaskAuditReasonStateConsistency(row: ExactTaskAuditPage["page"][number]): boolean {
  if (row.analysisState === "ready") {
    return row.analysisReasons.length === 0;
  }
  if (["not_targeted", "cold_row_missing", "analysis_map_missing", "analysis_key_missing"].includes(row.analysisState)) {
    return row.analysisReasons.length === 1 && row.analysisReasons[0] === row.analysisState;
  }
  return exactTaskAuditMismatchReasonSequences.some((expectedReasons) => (
    row.analysisState === expectedReasons[0]
    && row.analysisReasons.length === expectedReasons.length
    && row.analysisReasons.every((reason, index) => reason === expectedReasons[index])
  ));
}

function assertExactTaskAuditPageConsistency(
  value: ExactTaskAuditPage,
  taskId: string,
  workspaceSlug: string,
): void {
  const targeted = value.page.filter((row) => row.exactCohortMember).length;
  const ready = value.page.filter((row) => row.analysisState === "ready").length;
  const resumeIds = new Set(value.page.map((row) => row.currentResumeId));
  const rowsMatchTask = value.page.every((row) => (
    row.taskId === value.task.taskId
    && row.taskStatus === value.task.status
    && row.taskWorkspaceSlug === value.task.workspaceSlug
    && row.workspaceSlug === value.task.workspaceSlug
    && row.taskDispatchedAt === value.task.dispatchedAt
    && row.taskCompletedAt === value.task.completedAt
    && row.expectedJobDescriptionId === value.task.expectedJobDescriptionId
    && row.expectedPromptVersion === value.task.expectedPromptVersion
    && (row.currentAnalysisKey === undefined || row.currentAnalysisKey === row.expectedAnalysisKey)
    && hasExactTaskAuditReasonStateConsistency(row)
    && (row.analysisState === "ready"
      ? (
        row.exactCohortMember
        && row.analysisReasons.length === 0
        && row.currentAnalysisKey === row.expectedAnalysisKey
        && row.currentJobDescriptionId === value.task.expectedJobDescriptionId
        && row.currentPromptVersion === value.task.expectedPromptVersion
        && row.currentAnalyzedAt !== undefined
        && row.currentAnalyzedAt > value.task.dispatchedAt
        && row.finalAiScore !== undefined
      )
      : !hasExactTaskAuditScoreEvidence(row))
    && (row.analysisState !== "not_targeted" || !row.exactCohortMember)
    && (row.exactCohortMember || row.analysisState === "not_targeted")
  ));

  if (value.task.taskId !== taskId
    || value.task.workspaceSlug !== workspaceSlug
    || value.counts.scanned < value.counts.exported
    || value.counts.exported !== value.page.length
    || value.counts.targeted !== targeted
    || value.counts.ready !== ready
    || value.counts.ready > value.counts.targeted
    || value.counts.targeted > value.task.targetCount
    || resumeIds.size !== value.page.length
    || !rowsMatchTask
    || (!value.isDone && value.continueCursor.length === 0)) {
    throw new Error("Exact task audit export returned inconsistent task, count, row, or cursor metadata");
  }
}

function isInvalidExactTaskAuditError(message: string): boolean {
  return [
    "not an exact dispatch",
    "must be completed for audit export",
    "does not match",
    "missing verification metadata",
    "missing completion metadata",
    "invalid verification metadata",
    "inconsistent target count metadata",
  ].some((fragment) => message.includes(fragment));
}

function normalizeResumeDiagnosticsSourceKeys(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const resolved = Array.from(new Set(
    values
      .map((value) => resolveResumeDiagnosticsSourceKey({ sourceKey: value.trim(), source: value.trim() }))
  ));

  return resolved.length > 0 ? resolved : undefined;
}

const listAnalysisTasksRoute = createRoute({
  method: "get",
  path: "/api/resumes/analysis-tasks",
  tags: ["resumes"],
  summary: "List analysis tasks",
  responses: {
    200: { content: { "application/json": { schema: AnalysisTasksSuccessSchema } }, description: "Analysis tasks" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(listAnalysisTasksRoute, async (c) => {
  try {
    const tasks = (await callConvexQuery("analysis_tasks:list", {
      workspaceSlug: c.var.workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    })) as Array<{
      _id: string;
      status: string;
      _creationTime: number;
      config?: {
        jobDescriptionId?: string;
        jobDescriptionTitle?: string;
        keywords?: string[];
        location?: string;
        promptVersion?: number;
        resumeCount?: number;
      };
      progress?: { current?: number; total?: number; skipped?: number };
      results?: {
        analyzed?: number;
        failed?: number;
        avgScore?: number;
        highScoreCount?: number;
      };
      lastStatus?: string;
      error?: string;
    }>;

    return c.json(
      AnalysisTasksResponseSchema.parse({
        success: true,
        tasks,
      }),
      200,
    );
  } catch (error) {
    logger.error("Failed to list analysis tasks", error, { route: "resumes_diagnostics" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const dispatchAnalysisTaskRoute = createRoute({
  method: "post",
  path: "/api/resumes/analysis-tasks/dispatch",
  tags: ["resumes"],
  summary: "Dispatch a normal analysis task",
  request: {
    body: {
      content: { "application/json": { schema: AnalysisTaskDispatchRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: { content: { "application/json": { schema: AnalysisTaskDispatchResponseSchema } }, description: "Analysis task dispatched" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid task dispatch request" },
    503: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Analysis dispatch unavailable during maintenance" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(dispatchAnalysisTaskRoute, async (c) => {
  const request = c.req.valid("json");
  try {
    const result = AnalysisTaskDispatchResponseSchema.parse(await callConvexMutation("analysis_tasks:dispatch", {
      ...request,
      workspaceSlug: c.var.workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    }));
    if (!result.queued) {
      return c.json({ success: false as const, error: "Analysis dispatch is unavailable during maintenance" }, 503);
    }
    return c.json(result, 200);
  } catch (error) {
    logger.error("Failed to dispatch analysis task", error, { route: "resumes_diagnostics" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const cancelAnalysisTaskRoute = createRoute({
  method: "delete",
  path: "/api/resumes/analysis-tasks/{taskId}",
  tags: ["resumes"],
  summary: "Cancel an analysis task",
  request: {
    params: z.object({ taskId: z.string().min(1).max(512) }),
  },
  responses: {
    200: { content: { "application/json": { schema: AnalysisTaskCancelResponseSchema } }, description: "Analysis task cancellation requested" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid analysis task ID" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(cancelAnalysisTaskRoute, async (c) => {
  const { taskId } = c.req.valid("param");
  try {
    await callConvexMutation("analysis_tasks:cancel", {
      taskId,
      workspaceSlug: c.var.workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    });
    return c.json(AnalysisTaskCancelResponseSchema.parse({ success: true }), 200);
  } catch (error) {
    logger.error("Failed to cancel analysis task", error, { route: "resumes_diagnostics", taskId });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const getAnalysisTaskRoute = createRoute({
  method: "get",
  path: "/api/resumes/analysis-tasks/{taskId}",
  tags: ["resumes"],
  summary: "Get exact analysis task status",
  request: {
    params: z.object({ taskId: z.string().min(1) }),
  },
  responses: {
    200: { content: { "application/json": { schema: AnalysisTaskDetailResponseSchema } }, description: "Exact analysis task status" },
    404: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Analysis task not found" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(getAnalysisTaskRoute, async (c) => {
  const { taskId } = c.req.valid("param");
  try {
    const value = await callConvexQuery("analysis_tasks:getExactStatus", {
      taskId,
      workspaceSlug: c.var.workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
    });
    if (value === null) {
      return c.json({ success: false as const, error: "Analysis task not found" }, 404);
    }

    const detail = AnalysisTaskDetailSchema.parse(value);
    const stateCounts = detail.verification.targets.reduce(
      (counts, target) => {
        counts[target.state] += 1;
        return counts;
      },
      { ready: 0, pending: 0, invalid: 0 },
    );
    const targetResumeIds = detail.task.targetResumeIds ?? [];
    const targetIdsMatch = targetResumeIds.length === detail.verification.targets.length
      && targetResumeIds.every(
        (resumeId, index) => resumeId === detail.verification.targets[index].currentResumeId,
      );
    const expectedAllReady = detail.task.status === "completed"
      && stateCounts.ready === detail.verification.targets.length
      && stateCounts.pending === 0
      && stateCounts.invalid === 0;
    if (detail.verification.ready !== stateCounts.ready
      || detail.verification.pending !== stateCounts.pending
      || detail.verification.invalid !== stateCounts.invalid
      || detail.verification.ready + detail.verification.pending + detail.verification.invalid
        !== detail.verification.targets.length
      || detail.verification.allReady !== expectedAllReady
      || detail.task.dispatchedAt !== detail.verification.dispatchedAt
      || detail.task.config?.resumeCount !== detail.verification.targets.length
      || !targetIdsMatch) {
      throw new Error("Exact analysis status returned inconsistent target counts or IDs");
    }

    return c.json(AnalysisTaskDetailResponseSchema.parse({
      success: true as const,
      ...detail,
    }), 200);
  } catch (error) {
    logger.error("Failed to get exact analysis task status", error, { route: "resumes_diagnostics", taskId });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

const getExactTaskAuditExportRoute = createRoute({
  method: "get",
  path: "/api/resumes/analysis-tasks/{taskId}/audit-export",
  tags: ["resumes"],
  summary: "Get one page of an exact completed analysis task audit export",
  request: {
    params: z.object({ taskId: z.string().min(1).max(512) }),
    query: ExactTaskAuditPageQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ExactTaskAuditPageResponseSchema } },
      description: "Exact task audit export page",
    },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    404: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Analysis task not found" },
    409: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Task is not exportable" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(getExactTaskAuditExportRoute, async (c) => {
  const rawTaskId = c.req.valid("param").taskId;
  let taskId: string;
  try {
    taskId = decodeURIComponent(rawTaskId).trim();
  } catch {
    return c.json({ success: false as const, error: "Invalid analysis task ID" }, 400);
  }
  if (!taskId) {
    return c.json({ success: false as const, error: "Invalid analysis task ID" }, 400);
  }
  const { cursor, limit } = c.req.valid("query");

  try {
    const value = await callConvexQuery("analysis_tasks:getExactAuditExportPage", {
      taskId,
      workspaceSlug: c.var.workspaceSlug,
      writeSecret: config.auth.convexWriteSecret,
      ...(cursor === undefined ? {} : { cursor }),
      limit,
    });
    if (value === null) {
      return c.json({ success: false as const, error: "Analysis task not found" }, 404);
    }

    const page = ExactTaskAuditPageResponseSchema.parse({
      ...(value as Record<string, unknown>),
      success: true as const,
    });
    assertExactTaskAuditPageConsistency(page, taskId, c.var.workspaceSlug);
    return c.json(page, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isInvalidExactTaskAuditError(message)) {
      return c.json({ success: false as const, error: message }, 409);
    }

    const safeMessage = message.startsWith("Exact task audit export returned inconsistent")
      ? message
      : "Exact task audit export failed validation";
    logger.error(
      "Failed to get exact task audit export page",
      new Error(safeMessage),
      { route: "resumes_diagnostics", taskId },
    );
    return c.json({ success: false as const, error: safeMessage }, 500);
  }
});

const getSkillsVersionRoute = createRoute({
  method: "get",
  path: "/api/resumes/skills-version",
  tags: ["resumes"],
  summary: "Get current skills knowledge version and ingest-compute epoch",
  responses: {
    200: { content: { "application/json": { schema: SkillsVersionResponseSchema } }, description: "Skills version" },
  },
});
app.openapi(getSkillsVersionRoute, (c) => {
  const version = skillsKnowledgeService.getVersion();
  return c.json({
    success: true,
    version,
    ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
  }, 200);
});

const getFieldCoverageRoute = createRoute({
  method: "get",
  path: "/api/resumes/field-coverage",
  tags: ["resumes"],
  summary: "Get field coverage stats across all resumes",
  responses: {
    200: { content: { "application/json": { schema: FieldCoverageResponseSchema } }, description: "Field coverage" },
  },
});
app.openapi(getFieldCoverageRoute, async (c) => {
  const total = {
    scanned: 0,
    missingSearchText: 0,
    missingVerifiedRoleYears: 0,
    hasRoleSignals: 0,
    missingIngestComputeEpoch: 0,
    laggingIngestComputeEpoch: 0,
    currentIngestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
  };
  let cursor: string | null = null;

  for (let i = 0; i < 100; i++) {
    const batch = await callConvexQuery("resumes:fieldCoverage", {
      ...(cursor ? { cursor } : {}),
      batchSize: 200,
    }) as {
      scanned: number;
      missingSearchText: number;
      missingVerifiedRoleYears: number;
      hasRoleSignals: number;
      missingIngestComputeEpoch?: number;
      laggingIngestComputeEpoch?: number;
      hasMore: boolean;
      cursor: string | null;
    };
    total.scanned += batch.scanned;
    total.missingSearchText += batch.missingSearchText;
    total.missingVerifiedRoleYears += batch.missingVerifiedRoleYears;
    total.hasRoleSignals += batch.hasRoleSignals;
    total.missingIngestComputeEpoch += batch.missingIngestComputeEpoch ?? 0;
    total.laggingIngestComputeEpoch += batch.laggingIngestComputeEpoch ?? 0;

    if (!batch.hasMore) break;
    cursor = batch.cursor;
  }

  return c.json({ success: true, ...total }, 200);
});

const COMPUTE_STALE_DOCTOR_THRESHOLD = 1;

const getSearchFreshnessRoute = createRoute({
  method: "get",
  path: "/api/resumes/search-freshness",
  tags: ["resumes"],
  summary:
    "Search-data freshness doctor: ingestComputeEpoch lag counts + golden MY/CN minRoleYears totals",
  request: {
    query: z.object({
      scanLimit: z.coerce.number().int().min(1).max(1000).optional(),
      /** When true, skip golden live search queries */
      skipGolden: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SearchFreshnessResponseSchema } },
      description: "Freshness report",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Doctor failed",
    },
  },
});
app.use("/api/resumes/search-freshness", requireAdmin);
app.openapi(getSearchFreshnessRoute, async (c) => {
  const { scanLimit, skipGolden } = c.req.valid("query");
  const messages: string[] = [];
  const currentSkillsVersion = skillsKnowledgeService.getVersion();
  const currentEpoch = CURRENT_INGEST_COMPUTE_EPOCH;

  let lag = {
    scanned: 0,
    withIngestData: 0,
    skillsStale: 0,
    computeStale: 0,
    missingEpoch: 0,
    currentEpoch: 0,
    scanComplete: false,
  };

  try {
    const { triggerReingestStaleSkillsVersion } = await import("./resumes.js");
    const dry = await triggerReingestStaleSkillsVersion({
      limit: scanLimit ?? 200,
      mode: "any",
      dryRun: true,
    });
    lag = {
      scanned: scanLimit ?? 200,
      withIngestData: Math.max(dry.skillsStaleCount, dry.computeStaleCount, dry.matchedCount),
      skillsStale: dry.skillsStaleCount,
      computeStale: dry.computeStaleCount,
      missingEpoch: dry.computeStaleCount,
      currentEpoch: dry.currentIngestComputeEpoch,
      scanComplete: !dry.hasMore,
    };
    messages.push(
      `dry-run reingest mode=${dry.mode}: matched=${dry.matchedCount} skillsStale=${dry.skillsStaleCount} computeStale=${dry.computeStaleCount} hasMore=${dry.hasMore}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    messages.push(`lag scan failed: ${message}`);
  }

  const { SEARCH_FRESHNESS_GOLDEN_QUERIES } = await import("@trends/shared");
  const workspaceSlug = c.req.header("X-Workspace-Slug") || "dev";
  const goldenQueries: Array<{
    id: string;
    location: string;
    q: string;
    minRoleYears: number;
    roleType?: string;
    minTotalFloor: number;
    total: number | null;
    ok: boolean | null;
    error?: string;
  }> = [];

  let apiReachable = true;
  if (skipGolden === true) {
    messages.push("golden queries skipped (skipGolden=true)");
  } else {
    for (const g of SEARCH_FRESHNESS_GOLDEN_QUERIES) {
      const params = new URLSearchParams({
        source: "convex",
        location: g.location,
        q: g.q,
        minRoleYears: String(g.minRoleYears),
        limit: "1",
      });
      if (g.roleType) {
        params.set("roleType", g.roleType);
      }
      try {
        // Internal call through same app — use full URL if available, else relative via c.env
        const base = process.env.BFF_API_URL || process.env.API_URL || "http://127.0.0.1:3000";
        const cookie = c.req.header("cookie") || "";
        const response = await fetch(`${base.replace(/\/$/, "")}/api/resumes?${params}`, {
          headers: {
            "X-Workspace-Slug": workspaceSlug,
            ...(cookie ? { cookie } : {}),
          },
        });
        if (!response.ok) {
          apiReachable = response.status !== 0;
          goldenQueries.push({
            id: g.id,
            location: g.location,
            q: g.q,
            minRoleYears: g.minRoleYears,
            roleType: g.roleType,
            minTotalFloor: g.minTotalFloor,
            total: null,
            ok: null,
            error: `HTTP ${response.status}`,
          });
          continue;
        }
        const body = await response.json() as {
          success?: boolean;
          summary?: { total?: number };
          error?: string;
        };
        if (!body.success) {
          goldenQueries.push({
            id: g.id,
            location: g.location,
            q: g.q,
            minRoleYears: g.minRoleYears,
            roleType: g.roleType,
            minTotalFloor: g.minTotalFloor,
            total: null,
            ok: null,
            error: body.error || "search failed",
          });
          continue;
        }
        const total = typeof body.summary?.total === "number" ? body.summary.total : 0;
        const ok = total >= g.minTotalFloor;
        if (!ok) {
          messages.push(
            `golden ${g.id} total=${total} below floor ${g.minTotalFloor}`,
          );
        }
        goldenQueries.push({
          id: g.id,
          location: g.location,
          q: g.q,
          minRoleYears: g.minRoleYears,
          roleType: g.roleType,
          minTotalFloor: g.minTotalFloor,
          total,
          ok,
        });
      } catch (error) {
        apiReachable = false;
        const message = error instanceof Error ? error.message : String(error);
        goldenQueries.push({
          id: g.id,
          location: g.location,
          q: g.q,
          minRoleYears: g.minRoleYears,
          roleType: g.roleType,
          minTotalFloor: g.minTotalFloor,
          total: null,
          ok: null,
          error: message,
        });
        messages.push(`golden ${g.id} unreachable: ${message}`);
      }
    }
  }

  let exitCodeHint = 0;
  if (lag.computeStale >= COMPUTE_STALE_DOCTOR_THRESHOLD) {
    exitCodeHint = 2;
    messages.push(
      `compute-stale rows detected (${lag.computeStale}); schedule: trends resume debug trigger-reingest --mode any --limit 200`,
    );
  }
  if (apiReachable && goldenQueries.some((g) => g.ok === false)) {
    exitCodeHint = exitCodeHint === 0 ? 3 : exitCodeHint;
  }

  return c.json({
    success: true as const,
    currentSkillsVersion,
    currentIngestComputeEpoch: currentEpoch,
    apiReachable,
    lag: {
      scanned: lag.scanned,
      withIngestData: lag.withIngestData,
      skillsStale: lag.skillsStale,
      computeStale: lag.computeStale,
      missingEpoch: lag.missingEpoch,
      currentEpoch: typeof lag.currentEpoch === "number" ? lag.currentEpoch : currentEpoch,
      scanComplete: lag.scanComplete,
    },
    goldenQueries,
    exitCodeHint,
    messages,
  }, 200);
});

const listResumeDiagnosticsRoute = createRoute({
  method: "get",
  path: "/api/resumes/diagnostics",
  tags: ["resumes"],
  summary: "List resume diagnostics rows with optional archived/source filters",
  request: {
    query: ResumeDiagnosticsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeDiagnosticsResponseSchema,
        },
      },
      description: "Diagnostics rows",
    },
  },
});

app.openapi(listResumeDiagnosticsRoute, async (c) => {
  const {
    archived,
    sourceKey,
    limit,
  } = c.req.valid("query");

  const includeArchived = archived === true;
  const requestedLimit = Math.min(Math.max(limit ?? 100, 1), 500);
  const normalizedSourceKeys = normalizeResumeDiagnosticsSourceKeys(sourceKey);
  const pathName = includeArchived ? "resumes_diagnostics:listArchivedDiagnostics" : "resumes_diagnostics:listIngestDiagnostics";
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let rounds = 0; rounds < 100 && rows.length < requestedLimit; rounds += 1) {
    const value = await callConvexQuery(pathName, {
      paginationOpts: {
        cursor,
        numItems: Math.min(requestedLimit - rows.length, 100),
      },
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
    });

    if (!isConvexPaginatedQueryPage(value)) {
      throw new Error(`Unexpected diagnostics page payload for ${pathName}`);
    }

    rows.push(...value.page);
    if (value.isDone) {
      break;
    }

    cursor = value.continueCursor ?? null;
    if (!cursor) {
      break;
    }
  }

  return c.json(ResumeDiagnosticsResponseSchema.parse({
    success: true as const,
    summary: {
      archived: includeArchived,
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
      returned: rows.length,
      limit: requestedLimit,
    },
    data: rows,
  }), 200);
});

export default app;
