import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexQuery, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { resolveResumeDiagnosticsSourceKey } from "@trends/shared";
import {
  AnalysisTasksResponseSchema,
  AnalysisTaskDetailResponseSchema,
  AnalysisTaskDetailSchema,
  ExactTaskAuditPageResponseSchema,
  ExactTaskAuditPageSchema,
  ResumeDiagnosticsQuerySchema,
  ResumeDiagnosticsResponseSchema,
} from "../schemas/index.js";
import { requireAdmin } from "../middleware/auth.js";

const app = new OpenAPIHono();
app.use("/api/resumes/analysis-tasks", requireAdmin);
app.use("/api/resumes/analysis-tasks/*", requireAdmin);
app.use("/api/resumes/skills-version", requireAdmin);
app.use("/api/resumes/field-coverage", requireAdmin);
app.use("/api/resumes/diagnostics", requireAdmin);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);

const SimpleErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const AnalysisTasksSuccessSchema = AnalysisTasksResponseSchema;
const SkillsVersionResponseSchema = z.object({ success: z.literal(true), version: z.number() });
const FieldCoverageResponseSchema = z.object({
  success: z.literal(true),
  scanned: z.number().int(),
  missingSearchText: z.number().int(),
  missingVerifiedRoleYears: z.number().int(),
  hasRoleSignals: z.number().int(),
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
    const tasks = (await callConvexQuery("analysis_tasks:list", {})) as Array<{
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
  summary: "Get current skills knowledge version",
  responses: {
    200: { content: { "application/json": { schema: SkillsVersionResponseSchema } }, description: "Skills version" },
  },
});
app.openapi(getSkillsVersionRoute, (c) => {
  const version = skillsKnowledgeService.getVersion();
  return c.json({ success: true, version }, 200);
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
  const total = { scanned: 0, missingSearchText: 0, missingVerifiedRoleYears: 0, hasRoleSignals: 0 };
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
      hasMore: boolean;
      cursor: string | null;
    };
    total.scanned += batch.scanned;
    total.missingSearchText += batch.missingSearchText;
    total.missingVerifiedRoleYears += batch.missingVerifiedRoleYears;
    total.hasRoleSignals += batch.hasRoleSignals;

    if (!batch.hasMore) break;
    cursor = batch.cursor;
  }

  return c.json({ success: true, ...total }, 200);
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
