import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isRecord } from "@trends/shared";

import { requireWorkspaceUser, getAuthenticatedActorId } from "../middleware/auth.js";
import { ActionStorage } from "../services/action-storage.js";
import { config } from "../services/config.js";
import { callConvexQuery } from "../services/convex-utils.js";
import { logger } from "../services/logger.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";

const app = new OpenAPIHono();
const actionStorage = new ActionStorage(config.projectRoot);

app.use("/api/resumes/feedback-batch", requireWorkspaceUser);

const FeedbackBatchItemSchema = z.object({
  resumeId: z.string().trim().min(1),
  name: z.string().trim().optional(),
  comments: z.string(),
});

const FeedbackBatchRequestSchema = z.object({
  items: z.array(FeedbackBatchItemSchema).min(1).max(1000),
});

const FeedbackBatchResultSchema = z.object({
  resumeId: z.string(),
  name: z.string().optional(),
  comments: z.string(),
  status: z.enum(["imported", "skipped", "notFound"]),
  actionId: z.number().int().optional(),
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

function looksLikeConvexResumeId(value: string): boolean {
  return /^[a-z0-9]{20,}$/.test(value);
}

function readResolvedResumeId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.resumeId !== "string") {
    return null;
  }
  const trimmed = value.resumeId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveExistingResumeIds(resumeIds: string[]): Promise<Set<string>> {
  if (resumeIds.length === 0) {
    return new Set();
  }

  const value = await callConvexQuery("resumes:getByIdsForExport", { resumeIds });
  if (!Array.isArray(value)) {
    throw new Error("Invalid resume lookup response from Convex");
  }

  const resolved = new Set<string>();
  for (const item of value) {
    const resumeId = readResolvedResumeId(item);
    if (resumeId) {
      resolved.add(resumeId);
    }
  }
  return resolved;
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
  }));
  const uniqueResumeIds = Array.from(new Set(
    normalizedItems
      .filter((item) => item.comments && looksLikeConvexResumeId(item.resumeId))
      .map((item) => item.resumeId),
  ));
  const importedAt = formatIsoOffsetInTimezone(new Date(), config.timezone);

  try {
    const existingResumeIds = await resolveExistingResumeIds(uniqueResumeIds);
    let imported = 0;
    let skipped = 0;
    const notFound: string[] = [];
    const results: z.infer<typeof FeedbackBatchResultSchema>[] = [];

    for (const item of normalizedItems) {
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

      if (!looksLikeConvexResumeId(item.resumeId) || !existingResumeIds.has(item.resumeId)) {
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

      const actionData: Record<string, unknown> = {
        text: comments,
        context: "hr_feedback",
        importedAt,
      };
      if (item.name) {
        actionData.sourceName = item.name;
      }
      const action = actionStorage.saveAction({
        userId: getAuthenticatedActorId(c),
        resumeId: item.resumeId,
        actionType: "note",
        actionData,
      });
      imported += 1;
      results.push({
        resumeId: item.resumeId,
        name: item.name,
        comments,
        status: "imported",
        actionId: action.id,
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
