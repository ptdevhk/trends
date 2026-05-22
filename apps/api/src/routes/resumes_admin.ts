import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexAction, callConvexMutation } from "../services/convex-utils.js";
import { IngestComputeService } from "../services/ingest-compute-service.js";
import { config } from "../services/config.js";

const app = new OpenAPIHono();
const ingestComputeService = new IngestComputeService(config.projectRoot);

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

const ResetDatabaseV2ResponseSchema = z.object({
  success: z.literal(true),
  dryRun: z.boolean().optional(),
  count: z.number().int().optional(),
  wouldDelete: z.record(z.string(), z.number().int()).optional(),
  partial: z.boolean().optional(),
  deleted: z.record(z.string(), z.number().int()).optional(),
});

// Hard reset re-ingest: clear computed fields and reschedule
app.post("/api/resumes/hard-reset-reingest", async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = HardResetReingestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  const { dryRun } = parsed.data;

  try {
    if (dryRun) {
      const firstPage = await callConvexMutation("resumes:hardResetIngestData", {
        cursor: null,
        batchSize: 50,
      }) as { cleared: number; hasMore: boolean; cursor?: string };

      let wouldClear = firstPage.cleared;
      let cursor: string | undefined | null = firstPage.cursor;
      let hasMore = firstPage.hasMore;

      for (let i = 0; i < 10000 && hasMore; i++) {
        const page = await callConvexMutation("resumes:hardResetIngestData", {
          cursor,
          batchSize: 50,
        }) as { cleared: number; hasMore: boolean; cursor?: string };
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
    let cursor: string | null | undefined = null;
    let hasMore = true;

    for (let i = 0; i < 10000 && hasMore; i++) {
      const page = await callConvexMutation("resumes:hardResetIngestData", {
        cursor,
        batchSize: 50,
      }) as { cleared: number; hasMore: boolean; cursor?: string };
      totalCleared += page.cleared;
      hasMore = page.hasMore;
      cursor = page.cursor ?? null;
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
      console.error("Failed to schedule re-ingest after hard reset", schedulingError);
      return c.json(HardResetReingestResponseSchema.parse({
        success: true as const,
        cleared: totalCleared,
        phase: "failed_scheduling",
        error: message,
      }), 200);
    }
  } catch (error) {
    console.error("Failed to hard reset ingest data", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// Clear analyses for specific JDs or resume IDs
app.post("/api/resumes/clear-analyses", async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ClearAnalysesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  const { jobDescriptionId, resumeIds, batchSize, dryRun } = parsed.data;
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
      const args = buildClearAnalysesArgs();

      const firstPage = await callConvexMutation("resumes:clearAnalyses", args) as {
        cleared: number;
        hasMore: boolean;
        cursor?: string;
      };

      let wouldClear = firstPage.cleared;
      let cursor: string | undefined | null = firstPage.cursor;
      let hasMore = firstPage.hasMore;

      for (let i = 0; i < 10000 && hasMore && !isTargeted; i++) {
        const pageArgs = buildClearAnalysesArgs(cursor);
        const page = await callConvexMutation("resumes:clearAnalyses", pageArgs) as {
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

      const page = await callConvexMutation("resumes:clearAnalyses", args) as {
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
    console.error("Failed to clear analyses", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// Reset database (admin only)
app.post("/api/resumes/reset-database", async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ResetDatabaseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  const { dryRun } = parsed.data;

  try {
    if (dryRun) {
      const result = await callConvexMutation("resume_tasks:resetDatabase", {}) as {
        success: boolean;
        count: number;
        partial: boolean;
        deleted: Record<string, number>;
      };
      return c.json(ResetDatabaseV2ResponseSchema.parse({
        success: true as const,
        dryRun: true,
        wouldDelete: result.deleted,
        count: result.count,
      }), 200);
    }

    const value = await callConvexMutation("resume_tasks:resetDatabase", {});
    return c.json(ResetDatabaseV2ResponseSchema.parse(value), 200);
  } catch (error) {
    console.error("Failed to reset database", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// Archive/unarchive resumes
app.post("/api/resumes/archive", async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false, error: "Admin access required" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = ArchiveResumesRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  const { resumeIds, action } = parsed.data;

  try {
    if (action === "archive") {
      const result = await callConvexMutation("resumes:archiveResumes", { resumeIds }) as {
        requested: number;
        archived: number;
        alreadyArchived: number;
        missingResumeIds: string[];
      };
      return c.json({ success: true, ...result }, 200);
    } else {
      const result = await callConvexMutation("resumes:unarchiveResumes", { resumeIds }) as {
        requested: number;
        unarchived: number;
        notArchived: number;
        missingResumeIds: string[];
      };
      return c.json({ success: true, ...result }, 200);
    }
  } catch (error) {
    console.error("Failed to archive/unarchive resumes", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// Ingest compute (internal — called by Convex action)
app.post("/api/resumes/ingest-compute", async (c) => {
  const body = await c.req.json();
  const resumes = body.resumes as Array<{ resumeId: string; content: unknown; sourceKey?: string }>;

  if (!Array.isArray(resumes)) {
    return c.json({ success: false, error: "Invalid request: expected { resumes: [...] }" }, 400);
  }

  try {
    const results = ingestComputeService.computeBatch(resumes);
    return c.json({ success: true, results }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

export default app;
