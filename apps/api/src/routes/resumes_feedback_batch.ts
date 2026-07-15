import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { requireWorkspaceUser, getAuthenticatedActorId } from "../middleware/auth.js";
import { config } from "../services/config.js";
import { callConvexMutation } from "../services/convex-utils.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();

app.use("/api/resumes/feedback-batch", requireWorkspaceUser);

const FeedbackBatchItemSchema = z.object({
  resumeId: z.string().trim().min(1),
  name: z.string().trim().optional(),
  comments: z.string(),
  /** Stable source profile URL from export CSVs; used when Convex resume ids changed after restore. */
  profileUrl: z.string().trim().optional(),
});

const FeedbackBatchRequestSchema = z.object({
  items: z.array(FeedbackBatchItemSchema).min(1).max(1000),
});

const FeedbackBatchResultSchema = z.object({
  resumeId: z.string(),
  name: z.string().optional(),
  comments: z.string(),
  status: z.enum(["imported", "skipped", "notFound"]),
  reason: z.string().optional(),
});

const FeedbackBatchResponseSchema = z.object({
  success: z.literal(true),
  total: z.number().int(),
  imported: z.number().int(),
  skipped: z.number().int(),
  notFound: z.array(z.string()),
  results: z.array(FeedbackBatchResultSchema),
});

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

type NormalizedFeedbackBatchItem = z.infer<typeof FeedbackBatchItemSchema> & {
  comments: string;
};

const ConvexImportNoteResultSchema = z.object({
  resumeId: z.string(),
  identityKey: z.string().optional(),
  outcome: z.enum(["applied", "unchanged", "notFound", "skipped"]),
  reason: z.enum([
    "empty_comments",
    "superseded_by_later_duplicate",
    "resume_not_found",
  ]).optional(),
});

const ConvexImportNotesBatchSchema = z.object({
  requested: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  notFound: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  results: z.array(ConvexImportNoteResultSchema),
});

type ConvexImportNoteResult = z.infer<typeof ConvexImportNoteResultSchema>;

function parseConvexImportBatch(
  value: unknown,
  requestedItems: Array<{ resumeId: string; comments: string }>,
): ConvexImportNoteResult[] {
  const parsed = ConvexImportNotesBatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid candidate note import response from Convex");
  }

  const batch = parsed.data;
  const outcomeCounts = {
    applied: batch.results.filter((result) => result.outcome === "applied").length,
    unchanged: batch.results.filter((result) => result.outcome === "unchanged").length,
    notFound: batch.results.filter((result) => result.outcome === "notFound").length,
    skipped: batch.results.filter((result) => result.outcome === "skipped").length,
  };
  const responseMatchesRequest = batch.requested === requestedItems.length
    && batch.results.length === requestedItems.length
    && batch.results.every((result, index) => result.resumeId === requestedItems[index]?.resumeId)
    && batch.applied === outcomeCounts.applied
    && batch.unchanged === outcomeCounts.unchanged
    && batch.notFound === outcomeCounts.notFound
    && batch.skipped === outcomeCounts.skipped
    && batch.skipped === 0
    && batch.results.every((result) =>
      result.outcome !== "notFound" || result.reason === "resume_not_found"
    );
  if (!responseMatchesRequest) {
    throw new Error("Candidate note import response did not match the requested batch");
  }

  return batch.results;
}

const importFeedbackBatchRoute = createRoute({
  method: "post",
  path: "/api/resumes/feedback-batch",
  tags: ["resumes"],
  summary: "Import HR feedback comments as candidate notes",
  request: {
    body: {
      content: {
        "application/json": { schema: FeedbackBatchRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: FeedbackBatchResponseSchema } },
      description: "Batch feedback import result",
    },
    500: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Feedback import failed",
    },
  },
});

app.openapi(importFeedbackBatchRoute, async (c) => {
  const { items } = c.req.valid("json");
  const normalizedItems: NormalizedFeedbackBatchItem[] = items.map((item) => ({
    ...item,
    comments: item.comments.trim(),
    profileUrl: item.profileUrl?.trim() || undefined,
  }));
  try {
    const workspaceSlug = c.var.workspaceSlug;
    const updatedBy = getAuthenticatedActorId(c);
    const rowKey = (item: NormalizedFeedbackBatchItem) =>
      item.profileUrl && item.profileUrl.length > 0
        ? `profileUrl:${item.profileUrl.toLowerCase()}`
        : `resumeId:${item.resumeId}`;
    const lastNonemptyIndex = new Map<string, number>();
    normalizedItems.forEach((item, index) => {
      if (item.comments) {
        lastNonemptyIndex.set(rowKey(item), index);
      }
    });
    const winners = normalizedItems
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => item.comments && lastNonemptyIndex.get(rowKey(item)) === index);
    const outcomesByIndex = new Map<number, ConvexImportNoteResult>();

    for (let offset = 0; offset < winners.length; offset += 100) {
      const batch = winners.slice(offset, offset + 100);
      const mutationItems = batch.map(({ item }) => ({
        resumeId: item.resumeId,
        comments: item.comments,
        ...(item.profileUrl ? { profileUrl: item.profileUrl } : {}),
      }));
      const value = await callConvexMutation("candidate_status:importNotesBatch", {
        workspaceSlug,
        items: mutationItems,
        updatedBy,
        writeSecret: config.auth.convexWriteSecret,
      });
      const mutationResults = parseConvexImportBatch(value, mutationItems);
      mutationResults.forEach((result, index) => {
        const winner = batch[index];
        if (!winner) {
          throw new Error("Candidate note import response contained an unexpected result");
        }
        outcomesByIndex.set(winner.index, result);
      });
    }

    let imported = 0;
    let skipped = 0;
    const notFound: string[] = [];
    const results: z.infer<typeof FeedbackBatchResultSchema>[] = [];

    for (let index = 0; index < normalizedItems.length; index += 1) {
      const item = normalizedItems[index];
      const comments = item.comments;
      if (!comments) {
        skipped += 1;
        results.push({
          resumeId: item.resumeId,
          name: item.name,
          comments,
          status: "skipped",
          reason: "empty_comments",
        });
        continue;
      }

      if (lastNonemptyIndex.get(rowKey(item)) !== index) {
        skipped += 1;
        results.push({
          resumeId: item.resumeId,
          name: item.name,
          comments,
          status: "skipped",
          reason: "superseded_by_later_duplicate",
        });
        continue;
      }

      const outcome = outcomesByIndex.get(index);
      if (!outcome) {
        throw new Error("Candidate note import response was incomplete");
      }
      if (outcome.outcome === "notFound") {
        notFound.push(item.resumeId);
        results.push({
          resumeId: item.resumeId,
          name: item.name,
          comments,
          status: "notFound",
          reason: "resume_not_found",
        });
        continue;
      }
      if (outcome.outcome === "unchanged") {
        skipped += 1;
        results.push({
          resumeId: item.resumeId,
          name: item.name,
          comments,
          status: "skipped",
          reason: "unchanged",
        });
        continue;
      }
      if (outcome.outcome !== "applied") {
        throw new Error(`Unexpected candidate note outcome: ${outcome.outcome}`);
      }

      imported += 1;
      results.push({
        resumeId: item.resumeId,
        name: item.name,
        comments,
        status: "imported",
      });
    }

    return c.json(FeedbackBatchResponseSchema.parse({
      success: true as const,
      total: items.length,
      imported,
      skipped,
      notFound,
      results,
    }), 200);
  } catch (error) {
    logger.error("Failed to import HR feedback batch", error, { route: "resumes_feedback_batch" });
    return c.json({
      success: false as const,
      error: "Failed to import HR feedback batch",
    }, 500);
  }
});

export default app;
