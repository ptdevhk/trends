import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { SummaryDataService } from "../services/summaries/summary-data-service.js";
import { SummaryRenderer } from "../services/summaries/summary-renderer.js";

const app = new OpenAPIHono();
const summaryDataService = new SummaryDataService();
const summaryRenderer = new SummaryRenderer();

const SummaryCountEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
});

const SummaryReportSchema = z.object({
  workspaceSlug: z.string(),
  period: z.literal("daily"),
  generatedAt: z.string(),
  window: z.object({
    startAt: z.string(),
    endAt: z.string(),
    timezone: z.string(),
  }),
  totals: z.object({
    newResumes: z.number().int(),
    candidateStatusUpdates: z.number().int(),
    shortlistActions: z.number().int(),
    rejectActions: z.number().int(),
    contactActions: z.number().int(),
    collectionTasksCompleted: z.number().int(),
    collectionTasksFailed: z.number().int(),
  }),
  breakdowns: z.object({
    resumesBySource: z.array(SummaryCountEntrySchema),
    candidateStatusByValue: z.array(SummaryCountEntrySchema),
    actionsByType: z.array(SummaryCountEntrySchema),
    collectionTasksByStatus: z.array(SummaryCountEntrySchema),
  }),
  notes: z.array(z.string()),
});

const SummaryPreviewRequestSchema = z.object({
  workspaceSlug: z.string().min(1).optional(),
  period: z.literal("daily").default("daily"),
  endAt: z.string().datetime({ offset: true }).optional(),
});

const SummaryPreviewResponseSchema = z.object({
  success: z.literal(true),
  report: SummaryReportSchema,
  markdown: z.string(),
});

const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const previewRoute = createRoute({
  method: "post",
  path: "/preview",
  tags: ["Summaries"],
  summary: "Preview a workspace daily summary",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SummaryPreviewRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Summary preview",
      content: {
        "application/json": {
          schema: SummaryPreviewResponseSchema,
        },
      },
    },
    500: {
      description: "Preview error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(previewRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const workspaceSlug = body.workspaceSlug?.trim() || c.var.workspaceSlug;
    const report = await summaryDataService.buildSummaryReport({
      workspaceSlug,
      period: body.period,
      endAt: body.endAt,
    });

    return c.json({
      success: true as const,
      report,
      markdown: summaryRenderer.renderMarkdown(report),
    }, 200);
  } catch (error) {
    console.error("Failed to preview summary:", error);
    return c.json({
      success: false as const,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

export default app;
