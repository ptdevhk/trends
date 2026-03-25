import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { SummaryDataService } from "../services/summaries/summary-data-service.js";
import { summaryDispatcher } from "../services/summaries/summary-dispatcher.js";
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

const SummaryChannelSchema = z.enum(["email", "wechat_work", "feishu", "telegram"]);

const SummaryRunRequestSchema = SummaryPreviewRequestSchema.extend({
  channel: SummaryChannelSchema,
  dryRun: z.boolean().default(false),
  templateId: z.string().min(1).optional(),
  to: z.string().email().optional(),
  subject: z.string().min(1).optional(),
  webhookUrl: z.string().url().optional(),
  botToken: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
});

const SummaryRunResponseSchema = z.object({
  success: z.literal(true),
  channel: SummaryChannelSchema,
  dryRun: z.boolean(),
  templateId: z.string(),
  subject: z.string().optional(),
  report: SummaryReportSchema,
  content: z.string(),
  delivery: z.object({}).catchall(z.unknown()).optional(),
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

const runRoute = createRoute({
  method: "post",
  path: "/run",
  tags: ["Summaries"],
  summary: "Render and optionally send a workspace daily summary",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SummaryRunRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Summary run result",
      content: {
        "application/json": {
          schema: SummaryRunResponseSchema,
        },
      },
    },
    500: {
      description: "Summary run error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(runRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const workspaceSlug = body.workspaceSlug?.trim() || c.var.workspaceSlug;
    const report = await summaryDataService.buildSummaryReport({
      workspaceSlug,
      period: body.period,
      endAt: body.endAt,
    });
    const dispatched = await summaryDispatcher.dispatch(report, {
      channel: body.channel,
      dryRun: body.dryRun,
      templateId: body.templateId,
      to: body.to,
      subject: body.subject,
      webhookUrl: body.webhookUrl,
      botToken: body.botToken,
      chatId: body.chatId,
    });

    return c.json({
      success: true as const,
      channel: dispatched.channel,
      dryRun: dispatched.dryRun,
      templateId: dispatched.templateId,
      subject: dispatched.subject,
      report,
      content: dispatched.content,
      delivery: dispatched.delivery,
    }, 200);
  } catch (error) {
    console.error("Failed to run summary:", error);
    return c.json({
      success: false as const,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

export default app;
