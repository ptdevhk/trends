import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexAction, callConvexMutation, callConvexQuery } from "../services/convex-utils.js";
import { IngestComputeService } from "../services/ingest-compute-service.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { requireAdmin } from "../middleware/auth.js";
import { notificationService } from "../services/notification-service.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";

const app = new OpenAPIHono();
// Per-route requireAdmin — do NOT use app.use("*", requireAdmin) here
// because that would apply to ALL routes in the parent app, not just
// this sub-app's routes (Hono mounts sub-apps at / with wildcard).
const ingestComputeService = new IngestComputeService(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);

const SimpleErrorSchema = z.object({ success: z.literal(false), error: z.string() });

const HardResetReingestRequestSchema = z.object({
  dryRun: z.boolean().optional(),
});

const HardResetReingestResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean().optional(),
  cleared: z.number().int().optional(),
  wouldClear: z.number().int().optional(),
  scheduled: z.number().int().optional(),
  batches: z.number().int().optional(),
  phase: z.enum(["dry_run", "cleared", "scheduled", "failed_scheduling"]).optional(),
  error: z.string().optional(),
});

function isPlaceholderExternalIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "unknown" || normalized === "externalid:unknown";
}

const ExactReingestTargetSchema = z.object({
  referenceResumeId: z.string().trim().min(1).optional(),
  currentResumeId: z.string().trim().min(1).optional(),
  profileResumeId: z.string().trim().min(1).optional(),
  profileUrl: z.string().trim().min(1).optional(),
  externalId: z.string().trim().min(1)
    .refine((value) => !isPlaceholderExternalIdentity(value), "Placeholder external IDs are not stable selectors")
    .optional(),
  identityKey: z.string().trim().min(1)
    .refine((value) => !isPlaceholderExternalIdentity(value), "Placeholder external identity keys are not stable selectors")
    .optional(),
  source: z.string().trim().min(1).optional(),
}).strict();

const ExactReingestRequestSchema = z.object({
  targets: z.array(ExactReingestTargetSchema).min(1).max(500),
  dryRun: z.boolean().optional(),
}).strict();

const ExactReingestResolvedSelectorSchema = z.object({
  kind: z.enum(["currentResumeId", "profileUrl", "profileResumeId", "externalId", "identityKey"]),
  value: z.string().min(1),
});

const ExactReingestResolvedTargetSchema = z.object({
  referenceResumeId: z.string().optional(),
  currentResumeId: z.string().min(1),
  profileResumeId: z.string().optional(),
  profileUrl: z.string().optional(),
  externalId: z.string(),
  source: z.string(),
  canonicalIdentityKey: z.string().min(1),
  outcome: z.literal("resolved"),
  selectors: z.array(ExactReingestResolvedSelectorSchema).min(1),
});

const ExactReingestResolutionSchema = z.object({
  requested: z.number().int().positive(),
  resolved: z.number().int().positive(),
  resumeIds: z.array(z.string().min(1)).min(1),
  targets: z.array(ExactReingestResolvedTargetSchema).min(1),
});

const ExactReingestDispatchSchema = z.object({
  requested: z.number().int().positive(),
  resolved: z.number().int().positive(),
  scheduled: z.number().int().positive(),
  batches: z.number().int().positive(),
  resumeIds: z.array(z.string().min(1)).min(1),
  dispatchedAt: z.number(),
});

const ExactReingestResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean(),
  manifestVersion: z.literal(1),
  expectedSkillsVersion: z.number().int(),
  requested: z.number().int().positive(),
  resolved: z.number().int().positive(),
  scheduled: z.number().int().nonnegative(),
  batches: z.number().int().nonnegative(),
  dispatchedAt: z.number().optional(),
  resumeIds: z.array(z.string().min(1)).min(1),
  targets: z.array(ExactReingestResolvedTargetSchema).min(1),
});

const ExactReingestReadinessRequestSchema = z.object({
  resumeIds: z.array(z.string().trim().min(1)).min(1).max(500),
  dispatchedAt: z.number(),
  expectedSkillsVersion: z.number().int(),
});

const ExactReingestReadinessTargetSchema = z.object({
  currentResumeId: z.string().min(1),
  state: z.enum(["ready", "pending", "invalid"]),
  computedAt: z.number().optional(),
  skillsVersion: z.number().optional(),
  phase2FieldsPresent: z.boolean(),
  reasons: z.array(z.string()),
});

const ExactReingestReadinessResponseSchema = z.object({
  success: z.literal(true),
  allReady: z.boolean(),
  ready: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  checkedAt: z.number(),
  dispatchedAt: z.number(),
  expectedSkillsVersion: z.number().int(),
  targets: z.array(ExactReingestReadinessTargetSchema).min(1),
});

const ClearAnalysesRequestSchema = z.object({
  jobDescriptionId: z.string().trim().optional(),
  resumeIds: z.array(z.string().trim().min(1)).optional(),
  batchSize: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
});

const ClearAnalysesResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean().optional(),
  cleared: z.number().int(),
  wouldClear: z.number().int().optional(),
  batches: z.number().int().optional(),
  targeted: z.boolean(),
  jobDescriptionId: z.string().optional(),
});

const ResetDatabaseRequestSchema = z.object({
  dryRun: z.boolean().optional(),
});

const ArchiveResumesRequestSchema = z.object({
  resumeIds: z.array(z.string()).min(1),
  action: z.union([z.literal("archive"), z.literal("unarchive")]),
});

const ArchiveResumesResponseSchema = z.object({
  success: z.literal(true),
  requested: z.number().int(),
  archived: z.number().int().optional(),
  alreadyArchived: z.number().int().optional(),
  unarchived: z.number().int().optional(),
  notArchived: z.number().int().optional(),
  missingResumeIds: z.array(z.string()).optional(),
});

const ResetDatabaseV2ResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean().optional(),
  count: z.number().int().optional(),
  wouldDelete: z.record(z.string(), z.number().int()).optional(),
  partial: z.boolean().optional(),
  deleted: z.record(z.string(), z.number().int()).optional(),
});

const ResetDatabasePreviewPageSchema = z.object({
  tableName: z.string().min(1),
  count: z.number().int().nonnegative(),
  nextTableIndex: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
  done: z.boolean(),
});

const IngestComputeRequestSchema = z.object({
  resumes: z.array(z.object({
    resumeId: z.string(),
    content: z.record(z.string(), z.unknown()),
    sourceKey: z.string().optional(),
  })),
});
const IngestComputeResponseSchema = z.object({
  success: z.literal(true),
  results: z.array(z.record(z.string(), z.unknown())),
});

const BiasReportQuerySchema = z.object({
  workspaceSlug: z.string().min(1),
});
const GroupRateSchema = z.object({
  groupKey: z.string(),
  rate: z.number(),
});
const DisparateImpactEntrySchema = z.object({
  groupKey: z.string(),
  ratio: z.number(),
  referenceGroupKey: z.string(),
});
const BiasMetricsReportSchema = z.object({
  status: z.literal("ok"),
  workspaceSlug: z.string(),
  decisionType: z.string(),
  scoreThreshold: z.number(),
  totalAuditRecords: z.number(),
  groupCount: z.number(),
  demographicParity: z.object({
    disparityRatio: z.number(),
    maxDifference: z.number(),
    passing: z.boolean(),
    groupRates: z.array(GroupRateSchema),
  }),
  disparateImpact: z.array(DisparateImpactEntrySchema),
  overrideRate: z.object({
    tprDifference: z.number(),
    fprDifference: z.number(),
    passing: z.boolean(),
  }),
  scoreDrift: z.object({
    psi: z.number(),
    driftDetected: z.boolean(),
  }),
  anomalyFlags: z.object({
    statisticalParityViolation: z.boolean(),
    disparateImpactViolation: z.boolean(),
    scoreDriftDetected: z.boolean(),
  }),
  computedAt: z.number(),
});
const BiasReportResponseSchema = z.object({
  success: z.literal(true),
  report: BiasMetricsReportSchema.nullable(),
});

const AnomalyAlertsQuerySchema = z.object({
  workspaceSlug: z.string().min(1),
});
const AnomalyAlertSchema = z.object({
  workspaceSlug: z.string(),
  flags: z.array(z.string()),
  psiValue: z.number().nullable(),
  disparityRatio: z.number().nullable(),
  alertedAt: z.number(),
});
const AnomalyAlertsResponseSchema = z.object({
  success: z.literal(true),
  alerts: AnomalyAlertSchema.nullable(),
});

const BiasAnomalyNotifyRequestSchema = z.object({
  workspaceSlug: z.string().min(1),
  channel: z.enum(["feishu", "wechat_work", "email"]).optional(),
});
const BiasAnomalyNotifyResponseSchema = z.object({
  success: z.literal(true),
  notified: z.boolean(),
  reason: z.string().optional(),
  alerts: z.object({ flags: z.array(z.string()), alertedAt: z.string() }).optional(),
  channels: z.array(z.object({ channel: z.string(), success: z.boolean(), error: z.string().optional() })).optional(),
});

// ---------------------------------------------------------------------------
// Route definitions (createRoute OpenAPI pattern)
// ---------------------------------------------------------------------------

const hardResetReingestRoute = createRoute({
  method: "post",
  path: "/api/resumes/hard-reset-reingest",
  tags: ["admin"],
  summary: "Hard reset ingest data and reschedule re-ingest (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: HardResetReingestRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: HardResetReingestResponseSchema } }, description: "Reset result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(hardResetReingestRoute, async (c) => {
  const { dryRun } = c.req.valid("json");

  try {
    if (dryRun) {
      const firstPage = await callConvexMutation("resumes_mutations:hardResetIngestData", {
        batchSize: 50,
        dryRun: true,
      }) as { cleared: number; hasMore: boolean; cursor?: string };

      let wouldClear = firstPage.cleared;
      let cursor: string | undefined = firstPage.cursor;
      let hasMore = firstPage.hasMore;

      for (let i = 0; i < 10000 && hasMore; i++) {
        const pageArgs: { batchSize: number; dryRun: true; cursor?: string } = {
          batchSize: 50,
          dryRun: true,
        };
        if (cursor) pageArgs.cursor = cursor;
        const page = await callConvexMutation("resumes_mutations:hardResetIngestData", pageArgs) as { cleared: number; hasMore: boolean; cursor?: string };
        wouldClear += page.cleared;
        hasMore = page.hasMore;
        cursor = page.cursor;
      }

      return c.json(HardResetReingestResponseSchema.parse({
        success: true as const,
        dryRun: true,
        wouldClear,
        phase: "dry_run",
      }), 200);
    }

    let totalCleared = 0;
    let cursor: string | undefined;
    let hasMore = true;

    for (let i = 0; i < 10000 && hasMore; i++) {
      const pageArgs: { batchSize: number; cursor?: string } = { batchSize: 50 };
      if (cursor) pageArgs.cursor = cursor;
      const page = await callConvexMutation("resumes_mutations:hardResetIngestData", pageArgs) as { cleared: number; hasMore: boolean; cursor?: string };
      totalCleared += page.cleared;
      hasMore = page.hasMore;
      cursor = page.cursor;
    }

    try {
      const reingestResult = await callConvexAction("migrations:reIngestAllResumes", {}) as {
        scheduled: number;
        batches: number;
      };
      return c.json(HardResetReingestResponseSchema.parse({
        success: true as const,
        cleared: totalCleared,
        scheduled: reingestResult.scheduled,
        batches: reingestResult.batches,
        phase: "scheduled",
      }), 200);
    } catch (schedulingError) {
      const message = schedulingError instanceof Error ? schedulingError.message : String(schedulingError);
      logger.error("Failed to schedule re-ingest after hard reset", schedulingError, { route: "resumes_admin" });
      return c.json(HardResetReingestResponseSchema.parse({
        success: true as const,
        cleared: totalCleared,
        phase: "failed_scheduling",
        error: message,
      }), 200);
    }
  } catch (error) {
    logger.error("Failed to hard reset ingest data", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const exactReingestRoute = createRoute({
  method: "post",
  path: "/api/resumes/exact-reingest",
  tags: ["admin"],
  summary: "Resolve and schedule an exact stable-identity resume cohort (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: ExactReingestRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ExactReingestResponseSchema } }, description: "Exact target resolution or dispatch result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid or conflicting target manifest" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(exactReingestRoute, async (c) => {
  const { targets, dryRun = false } = c.req.valid("json");
  const workspaceSlug = c.var.workspaceSlug;

  try {
    const resolution = ExactReingestResolutionSchema.parse(
      await callConvexAction("ingest_agent:resolveExactReingestTargets", {
        workspaceSlug,
        writeSecret: config.auth.convexWriteSecret,
        targets,
      }),
    );
    if (resolution.requested !== targets.length
      || resolution.targets.length !== targets.length
      || resolution.resolved !== resolution.resumeIds.length) {
      throw new Error("Exact re-ingest resolution returned inconsistent target counts");
    }

    const expectedSkillsVersion = skillsKnowledgeService.getVersion();
    if (dryRun) {
      return c.json(ExactReingestResponseSchema.parse({
        success: true as const,
        dryRun: true,
        manifestVersion: 1 as const,
        expectedSkillsVersion,
        requested: resolution.requested,
        resolved: resolution.resolved,
        scheduled: 0,
        batches: 0,
        resumeIds: resolution.resumeIds,
        targets: resolution.targets,
      }), 200);
    }

    const dispatch = ExactReingestDispatchSchema.parse(
      await callConvexMutation("ingest_agent:scheduleExactReingest", {
        workspaceSlug,
        writeSecret: config.auth.convexWriteSecret,
        resumeIds: resolution.resumeIds,
      }),
    );
    if (dispatch.resolved !== resolution.resolved
      || dispatch.scheduled !== resolution.resolved
      || dispatch.requested !== resolution.resolved
      || dispatch.resumeIds.length !== resolution.resumeIds.length
      || dispatch.resumeIds.some((resumeId, index) => resumeId !== resolution.resumeIds[index])) {
      throw new Error("Exact re-ingest dispatch returned inconsistent target IDs");
    }

    return c.json(ExactReingestResponseSchema.parse({
      success: true as const,
      dryRun: false,
      manifestVersion: 1 as const,
      expectedSkillsVersion,
      requested: resolution.requested,
      resolved: resolution.resolved,
      scheduled: dispatch.scheduled,
      batches: dispatch.batches,
      dispatchedAt: dispatch.dispatchedAt,
      resumeIds: dispatch.resumeIds,
      targets: resolution.targets,
    }), 200);
  } catch (error) {
    logger.error("Failed to resolve or schedule exact resume re-ingest", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Exact re-ingest target") ? 400 : 500;
    return c.json({ success: false as const, error: message }, status);
  }
});

const exactReingestReadinessRoute = createRoute({
  method: "post",
  path: "/api/resumes/exact-reingest/readiness",
  tags: ["admin"],
  summary: "Check persisted readiness for an exact re-ingest dispatch (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: ExactReingestReadinessRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ExactReingestReadinessResponseSchema } }, description: "Exact re-ingest readiness" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(exactReingestReadinessRoute, async (c) => {
  const { resumeIds, dispatchedAt, expectedSkillsVersion } = c.req.valid("json");
  const targetResumeIds = Array.from(new Set(resumeIds));

  try {
    const readiness = ExactReingestReadinessResponseSchema.omit({ success: true }).parse(
      await callConvexQuery("ingest_agent:getExactReingestReadiness", {
        workspaceSlug: c.var.workspaceSlug,
        writeSecret: config.auth.convexWriteSecret,
        resumeIds: targetResumeIds,
        dispatchedAt,
        expectedSkillsVersion,
      }),
    );
    if (readiness.targets.length !== targetResumeIds.length
      || readiness.ready + readiness.pending + readiness.invalid !== readiness.targets.length) {
      throw new Error("Exact re-ingest readiness returned inconsistent target counts");
    }
    return c.json(ExactReingestReadinessResponseSchema.parse({
      success: true as const,
      ...readiness,
    }), 200);
  } catch (error) {
    logger.error("Failed to check exact resume re-ingest readiness", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

const clearAnalysesRoute = createRoute({
  method: "post",
  path: "/api/resumes/clear-analyses",
  tags: ["admin"],
  summary: "Clear analyses for specific JDs or resume IDs (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: ClearAnalysesRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ClearAnalysesResponseSchema } }, description: "Clear result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(clearAnalysesRoute, async (c) => {
  const { jobDescriptionId, resumeIds, batchSize, dryRun } = c.req.valid("json");
  const isTargeted = (jobDescriptionId?.trim()?.length ?? 0) > 0 || (resumeIds?.length ?? 0) > 0;
  const buildClearAnalysesArgs = (cursor?: string | null): Record<string, unknown> => {
    const args: Record<string, unknown> = {
      batchSize: batchSize ?? 50,
    };

    if (typeof cursor === "string" && cursor.trim().length > 0) {
      args.cursor = cursor;
    }
    if (jobDescriptionId?.trim()) {
      args.jobDescriptionId = jobDescriptionId.trim();
    }
    if (resumeIds && resumeIds.length > 0) {
      args.resumeIds = resumeIds;
    }

    return args;
  };

  try {
    if (dryRun) {
      const args = { ...buildClearAnalysesArgs(), dryRun: true };

      const firstPage = await callConvexMutation("resumes_mutations:clearAnalyses", args) as {
        cleared: number;
        hasMore: boolean;
        cursor?: string;
      };

      let wouldClear = firstPage.cleared;
      let cursor: string | undefined | null = firstPage.cursor;
      let hasMore = firstPage.hasMore;

      for (let i = 0; i < 10000 && hasMore && !isTargeted; i++) {
        const pageArgs = { ...buildClearAnalysesArgs(cursor), dryRun: true };
        const page = await callConvexMutation("resumes_mutations:clearAnalyses", pageArgs) as {
          cleared: number;
          hasMore: boolean;
          cursor?: string;
        };
        wouldClear += page.cleared;
        hasMore = page.hasMore;
        cursor = page.cursor;
      }

      return c.json(ClearAnalysesResponseSchema.parse({
        success: true as const,
        dryRun: true,
        cleared: 0,
        wouldClear,
        targeted: isTargeted,
        jobDescriptionId: jobDescriptionId?.trim() || undefined,
      }), 200);
    }

    let totalCleared = 0;
    let batches = 0;
    let cursor: string | null | undefined = null;
    let hasMore = true;

    for (let i = 0; i < 10000 && hasMore; i++) {
      const args = buildClearAnalysesArgs(cursor);

      const page = await callConvexMutation("resumes_mutations:clearAnalyses", args) as {
        cleared: number;
        hasMore: boolean;
        cursor?: string;
      };
      totalCleared += page.cleared;
      batches += 1;
      hasMore = page.hasMore;
      cursor = page.cursor ?? null;

      if (isTargeted) break;
    }

    return c.json(ClearAnalysesResponseSchema.parse({
      success: true as const,
      cleared: totalCleared,
      batches,
      targeted: isTargeted,
      jobDescriptionId: jobDescriptionId?.trim() || undefined,
    }), 200);
  } catch (error) {
    logger.error("Failed to clear analyses", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const resetDatabaseRoute = createRoute({
  method: "post",
  path: "/api/resumes/reset-database",
  tags: ["admin"],
  summary: "Reset the database (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: ResetDatabaseRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ResetDatabaseV2ResponseSchema } }, description: "Reset result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(resetDatabaseRoute, async (c) => {
  const { dryRun } = c.req.valid("json");

  try {
    if (dryRun) {
      const wouldDelete: Record<string, number> = {};
      let count = 0;
      let tableIndex = 0;
      let cursor: string | undefined;
      let done = false;

      for (let iteration = 0; iteration < 10000 && !done; iteration += 1) {
        const args: { tableIndex: number; cursor?: string } = { tableIndex };
        if (cursor) {
          args.cursor = cursor;
        }
        const page = ResetDatabasePreviewPageSchema.parse(
          await callConvexQuery("resume_tasks:previewResetDatabase", args),
        );
        wouldDelete[page.tableName] = (wouldDelete[page.tableName] ?? 0) + page.count;
        count += page.count;
        tableIndex = page.nextTableIndex;
        cursor = page.cursor ?? undefined;
        done = page.done;
      }

      if (!done) {
        throw new Error("Reset database preview exceeded maximum pagination iterations");
      }

      return c.json(ResetDatabaseV2ResponseSchema.parse({
        success: true as const,
        dryRun: true,
        wouldDelete,
        count,
      }), 200);
    }

    const value = await callConvexMutation("resume_tasks:resetDatabase", {});
    return c.json(ResetDatabaseV2ResponseSchema.parse(value), 200);
  } catch (error) {
    logger.error("Failed to reset database", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const archiveResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/archive",
  tags: ["admin"],
  summary: "Archive or unarchive resumes (admin only)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: ArchiveResumesRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: ArchiveResumesResponseSchema } }, description: "Archive result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(archiveResumesRoute, async (c) => {
  const { resumeIds, action } = c.req.valid("json");

  try {
    if (action === "archive") {
      const result = await callConvexMutation("resumes_mutations:archiveResumes", { resumeIds }) as {
        requested: number;
        archived: number;
        alreadyArchived: number;
        missingResumeIds: string[];
      };
      return c.json({ success: true as const, ...result }, 200);
    } else {
      const result = await callConvexMutation("resumes_mutations:unarchiveResumes", { resumeIds }) as {
        requested: number;
        unarchived: number;
        notArchived: number;
        missingResumeIds: string[];
      };
      return c.json({ success: true as const, ...result }, 200);
    }
  } catch (error) {
    logger.error("Failed to archive/unarchive resumes", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const ingestComputeRoute = createRoute({
  method: "post",
  path: "/api/resumes/ingest-compute",
  tags: ["admin"],
  summary: "Compute ingest data for a batch of resumes (internal)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: IngestComputeRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: IngestComputeResponseSchema } }, description: "Compute result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(ingestComputeRoute, async (c) => {
  const { resumes } = c.req.valid("json");

  try {
    const results = ingestComputeService.computeBatch(resumes);
    return c.json({ success: true as const, results }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const biasReportRoute = createRoute({
  method: "get",
  path: "/api/resumes/bias-report",
  tags: ["admin"],
  summary: "Get latest bias audit report for workspace (EU AI Act Art. 12)",
  middleware: [requireAdmin] as const,
  request: {
    query: BiasReportQuerySchema,
  },
  responses: {
    200: { content: { "application/json": { schema: BiasReportResponseSchema } }, description: "Bias report" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(biasReportRoute, async (c) => {
  const { workspaceSlug } = c.req.valid("query");

  try {
    const report = await callConvexQuery("bias_audit:getLatestBiasReport", { workspaceSlug });
    return c.json({ success: true as const, report: report as z.infer<typeof BiasMetricsReportSchema> | null }, 200);
  } catch (error) {
    logger.error("Failed to fetch bias report", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const anomalyAlertsRoute = createRoute({
  method: "get",
  path: "/api/resumes/anomaly-alerts",
  tags: ["admin"],
  summary: "Get active anomaly alerts for workspace (EU AI Act Art. 12)",
  middleware: [requireAdmin] as const,
  request: {
    query: AnomalyAlertsQuerySchema,
  },
  responses: {
    200: { content: { "application/json": { schema: AnomalyAlertsResponseSchema } }, description: "Anomaly alerts" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(anomalyAlertsRoute, async (c) => {
  const { workspaceSlug } = c.req.valid("query");

  try {
    const alerts = await callConvexQuery("bias_audit:getAnomalyAlerts", { workspaceSlug });
    return c.json({ success: true as const, alerts: alerts as z.infer<typeof AnomalyAlertSchema> | null }, 200);
  } catch (error) {
    logger.error("Failed to fetch anomaly alerts", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const biasAnomalyNotifyRoute = createRoute({
  method: "post",
  path: "/api/resumes/bias-anomaly-notify",
  tags: ["admin"],
  summary: "Dispatch bias anomaly alert notifications (EU AI Act Art. 12)",
  middleware: [requireAdmin] as const,
  request: {
    body: { content: { "application/json": { schema: BiasAnomalyNotifyRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: BiasAnomalyNotifyResponseSchema } }, description: "Notification result" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(biasAnomalyNotifyRoute, async (c) => {
  const { workspaceSlug, channel } = c.req.valid("json");

  try {
    const alerts = await callConvexQuery("bias_audit:getAnomalyAlerts", { workspaceSlug }) as {
      workspaceSlug: string;
      flags: string[];
      psiValue: number | null;
      disparityRatio: number | null;
      alertedAt: number;
    } | null;

    if (!alerts || alerts.flags.length === 0) {
      return c.json({ success: true as const, notified: false, reason: "No active anomaly alerts" }, 200);
    }

    const alertDate = new Date(alerts.alertedAt).toISOString();
    const flagList = alerts.flags.join(", ");
    const psiNote = alerts.psiValue != null ? `PSI: ${alerts.psiValue.toFixed(4)}` : "";
    const dirNote = alerts.disparityRatio != null ? `DIR: ${alerts.disparityRatio.toFixed(4)}` : "";
    const metricsNote = [psiNote, dirNote].filter(Boolean).join(" | ");

    const subject = `[Trends] Bias Anomaly Alert — ${workspaceSlug}`;
    const textContent = [
      `Bias Audit Anomaly Alert`,
      `Workspace: ${workspaceSlug}`,
      `Flags: ${flagList}`,
      `Metrics: ${metricsNote}`,
      `Detected at: ${alertDate}`,
      ``,
      `This alert was generated automatically by the weekly bias audit (EU AI Act Art. 12).`,
      `Please review the Audit & Compliance dashboard for details.`,
    ].join("\n");

    const validChannels = ["feishu", "wechat_work", "email"] as const;
    const channels = channel ? [channel] : validChannels;
    const results: Array<{ channel: string; success: boolean; error?: string }> = [];

    for (const ch of channels) {
      try {
        if (ch === "feishu") {
          await notificationService.sendFeishuText({ content: textContent });
          results.push({ channel: ch, success: true });
        } else if (ch === "wechat_work") {
          await notificationService.sendWechatWorkMarkdown({ content: textContent });
          results.push({ channel: ch, success: true });
        } else if (ch === "email") {
          const adminEmail = process.env.BIAS_ALERT_EMAIL;
          if (!adminEmail) {
            results.push({ channel: ch, success: false, error: "BIAS_ALERT_EMAIL not configured" });
            continue;
          }
          await notificationService.sendEmail({
            to: adminEmail,
            subject,
            html: `<pre>${textContent}</pre>`,
            text: textContent,
          });
          results.push({ channel: ch, success: true });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to send bias anomaly notification via ${ch}`, error, { route: "resumes_admin" });
        results.push({ channel: ch, success: false, error: msg });
      }
    }

    const anySuccess = results.some((r) => r.success);
    return c.json({
      success: true as const,
      notified: anySuccess,
      alerts: { flags: alerts.flags, alertedAt: alertDate },
      channels: results,
    }, 200);
  } catch (error) {
    logger.error("Failed to dispatch bias anomaly notification", error, { route: "resumes_admin" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

export default app;
