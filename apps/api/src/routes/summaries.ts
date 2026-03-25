import { randomUUID } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isValidWorkspace, type WorkspaceSlug } from "@trends/shared";

import { SummaryDataService } from "../services/summaries/summary-data-service.js";
import { summaryDispatcher } from "../services/summaries/summary-dispatcher.js";
import { SummaryRenderer } from "../services/summaries/summary-renderer.js";
import {
  WorkspaceSummaryRunStorage,
  type StoredWorkspaceSummaryRun,
} from "../services/workspace-summary-run-storage.js";

const app = new OpenAPIHono();
const summaryDataService = new SummaryDataService();
const summaryRenderer = new SummaryRenderer();
const workspaceSummaryRunStorage = new WorkspaceSummaryRunStorage();

const SummaryCountEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
});

const SummaryTotalsSchema = z.object({
  newResumes: z.number().int(),
  candidateStatusUpdates: z.number().int(),
  shortlistActions: z.number().int(),
  rejectActions: z.number().int(),
  contactActions: z.number().int(),
  collectionTasksCompleted: z.number().int(),
  collectionTasksFailed: z.number().int(),
});

const SummaryBreakdownsSchema = z.object({
  resumesBySource: z.array(SummaryCountEntrySchema),
  candidateStatusByValue: z.array(SummaryCountEntrySchema),
  actionsByType: z.array(SummaryCountEntrySchema),
  collectionTasksByStatus: z.array(SummaryCountEntrySchema),
});

const SummarySharedIngestTotalsSchema = SummaryTotalsSchema.pick({
  newResumes: true,
  collectionTasksCompleted: true,
  collectionTasksFailed: true,
});

const SummaryWorkspaceActivityTotalsSchema = SummaryTotalsSchema.pick({
  candidateStatusUpdates: true,
  shortlistActions: true,
  rejectActions: true,
  contactActions: true,
});

const SummarySharedIngestBreakdownsSchema = SummaryBreakdownsSchema.pick({
  resumesBySource: true,
  collectionTasksByStatus: true,
});

const SummaryWorkspaceActivityBreakdownsSchema = SummaryBreakdownsSchema.pick({
  candidateStatusByValue: true,
  actionsByType: true,
});

const SummaryScopesSchema = z.object({
  sharedIngest: z.object({
    totals: SummarySharedIngestTotalsSchema,
    breakdowns: SummarySharedIngestBreakdownsSchema,
  }),
  workspaceActivity: z.object({
    totals: SummaryWorkspaceActivityTotalsSchema,
    breakdowns: SummaryWorkspaceActivityBreakdownsSchema,
  }),
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
  totals: SummaryTotalsSchema,
  breakdowns: SummaryBreakdownsSchema,
  scopes: SummaryScopesSchema.optional(),
  notes: z.array(z.string()),
});

const SummaryPreviewRequestSchema = z.object({
  workspaceSlug: z.string().min(1).optional(),
  period: z.literal("daily").default("daily"),
  endAt: z.string().datetime({ offset: true }).optional(),
});

const SummaryTriggerSourceSchema = z.enum([
  "api_preview",
  "api_manual",
  "worker_manual",
  "worker_schedule",
]);

const SummaryChannelSchema = z.enum(["email", "wechat_work", "feishu", "telegram"]);

const SummaryDeliveryAccountSchema = z.object({
  index: z.number().int(),
  chatIdHint: z.string(),
  attempted: z.boolean(),
  sent: z.boolean(),
  batchesPlanned: z.number().int(),
  skippedReason: z.string().optional(),
});

const SummaryDeliverySchema = z.object({
  channel: SummaryChannelSchema.optional(),
  ok: z.boolean().optional(),
  messageId: z.string().optional(),
  accountsConfigured: z.number().int().optional(),
  accountsSelected: z.number().int().optional(),
  accountsAttempted: z.number().int().optional(),
  accountsSent: z.number().int().optional(),
  batchCountPerAccount: z.number().int().optional(),
  totalBatches: z.number().int().optional(),
  batchSizes: z.array(z.number().int()).optional(),
  maxBytesPerBatch: z.number().int().optional(),
  usedOverrideBotToken: z.boolean().optional(),
  usedOverrideChatId: z.boolean().optional(),
  accounts: z.array(SummaryDeliveryAccountSchema).optional(),
}).catchall(z.unknown());

const StoredSummaryRunSchema = z.object({
  id: z.string(),
  workspaceSlug: z.string(),
  period: z.literal("daily"),
  triggerSource: SummaryTriggerSourceSchema,
  status: z.enum(["previewed", "dry_run", "sent", "failed"]),
  channel: SummaryChannelSchema.optional(),
  templateId: z.string().optional(),
  dryRun: z.boolean(),
  windowStart: z.string(),
  windowEnd: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  report: SummaryReportSchema,
  content: z.string().optional(),
  delivery: SummaryDeliverySchema.optional(),
  error: z.string().optional(),
});

const SummaryPreviewResponseSchema = z.object({
  success: z.literal(true),
  report: SummaryReportSchema,
  markdown: z.string(),
  run: StoredSummaryRunSchema,
});

const SummaryRunRequestSchema = SummaryPreviewRequestSchema.extend({
  channel: SummaryChannelSchema,
  dryRun: z.boolean().default(false),
  triggerSource: SummaryTriggerSourceSchema.optional(),
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
  delivery: SummaryDeliverySchema.optional(),
  run: StoredSummaryRunSchema,
});

const SummaryRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SummaryRunListResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(StoredSummaryRunSchema),
});

const SummaryRunDetailResponseSchema = z.object({
  success: z.literal(true),
  item: StoredSummaryRunSchema,
});

const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

function isSummaryReport(value: unknown): value is z.infer<typeof SummaryReportSchema> {
  return SummaryReportSchema.safeParse(value).success;
}

function createEmptySummaryScopes(): z.infer<typeof SummaryScopesSchema> {
  return {
    sharedIngest: {
      totals: {
        newResumes: 0,
        collectionTasksCompleted: 0,
        collectionTasksFailed: 0,
      },
      breakdowns: {
        resumesBySource: [],
        collectionTasksByStatus: [],
      },
    },
    workspaceActivity: {
      totals: {
        candidateStatusUpdates: 0,
        shortlistActions: 0,
        rejectActions: 0,
        contactActions: 0,
      },
      breakdowns: {
        candidateStatusByValue: [],
        actionsByType: [],
      },
    },
  };
}

function toPublicSummaryRun(run: StoredWorkspaceSummaryRun): z.infer<typeof StoredSummaryRunSchema> {
  return {
    ...run,
    report: isSummaryReport(run.report)
      ? run.report
      : {
        workspaceSlug: run.workspaceSlug,
        period: "daily",
        generatedAt: run.finishedAt ?? run.startedAt,
        window: {
          startAt: run.windowStart,
          endAt: run.windowEnd,
          timezone: "unknown",
        },
        totals: {
          newResumes: 0,
          candidateStatusUpdates: 0,
          shortlistActions: 0,
          rejectActions: 0,
          contactActions: 0,
          collectionTasksCompleted: 0,
          collectionTasksFailed: 0,
        },
        breakdowns: {
          resumesBySource: [],
          candidateStatusByValue: [],
          actionsByType: [],
          collectionTasksByStatus: [],
        },
        scopes: createEmptySummaryScopes(),
        notes: [],
      },
  };
}

function resolveWorkspaceSlug(value: string | undefined, fallback: WorkspaceSlug): WorkspaceSlug {
  const candidate = value?.trim();
  if (!candidate) {
    return fallback;
  }
  if (!isValidWorkspace(candidate)) {
    throw new Error(`Invalid workspace slug: ${candidate}. Allowed: dev, hr`);
  }
  return candidate;
}

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
    const workspaceSlug = resolveWorkspaceSlug(body.workspaceSlug, c.var.workspaceSlug);
    const report = await summaryDataService.buildSummaryReport({
      workspaceSlug,
      period: body.period,
      endAt: body.endAt,
    });
    const markdown = summaryRenderer.renderMarkdown(report);
    const run = workspaceSummaryRunStorage.createRun({
      id: randomUUID(),
      workspaceSlug,
      triggerSource: "api_preview",
      status: "previewed",
      dryRun: true,
      windowStart: report.window.startAt,
      windowEnd: report.window.endAt,
      report,
      content: markdown,
    });

    return c.json({
      success: true as const,
      report,
      markdown,
      run: toPublicSummaryRun(run),
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
  let workspaceSlug = c.var.workspaceSlug;
  let triggerSource: z.infer<typeof SummaryTriggerSourceSchema> = "api_manual";
  let dryRun = false;
  let channel: z.infer<typeof SummaryChannelSchema> | undefined;
  let templateId: string | undefined;
  let report: z.infer<typeof SummaryReportSchema> | undefined;
  let preview: { content: string; templateId: string; subject?: string } | undefined;
  try {
    const body = c.req.valid("json");
    workspaceSlug = resolveWorkspaceSlug(body.workspaceSlug, c.var.workspaceSlug);
    dryRun = body.dryRun;
    channel = body.channel;
    templateId = body.templateId;
    report = await summaryDataService.buildSummaryReport({
      workspaceSlug,
      period: body.period,
      endAt: body.endAt,
    });
    preview = summaryDispatcher.buildPreview(report, {
      templateId: body.templateId,
    });
    triggerSource = body.triggerSource ?? "api_manual";
    const runId = randomUUID();
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
    const run = workspaceSummaryRunStorage.createRun({
      id: runId,
      workspaceSlug,
      triggerSource,
      status: dispatched.dryRun ? "dry_run" : "sent",
      channel: dispatched.channel,
      templateId: dispatched.templateId,
      dryRun: dispatched.dryRun,
      windowStart: report.window.startAt,
      windowEnd: report.window.endAt,
      report,
      content: dispatched.content,
      delivery: dispatched.delivery,
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
      run: toPublicSummaryRun(run),
    }, 200);
  } catch (error) {
    if (report) {
      workspaceSummaryRunStorage.createRun({
        id: randomUUID(),
        workspaceSlug,
        triggerSource,
        status: "failed",
        channel,
        templateId,
        dryRun,
        windowStart: report.window.startAt,
        windowEnd: report.window.endAt,
        report,
        content: preview?.content,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    console.error("Failed to run summary:", error);
    return c.json({
      success: false as const,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

const listRunsRoute = createRoute({
  method: "get",
  path: "/runs",
  tags: ["Summaries"],
  summary: "List persisted workspace summary runs",
  request: {
    query: SummaryRunsQuerySchema,
  },
  responses: {
    200: {
      description: "Summary run list",
      content: {
        "application/json": {
          schema: SummaryRunListResponseSchema,
        },
      },
    },
  },
});

app.openapi(listRunsRoute, async (c) => {
  const query = c.req.valid("query");
  const items = workspaceSummaryRunStorage
    .listRuns(c.var.workspaceSlug, query.limit)
    .map((item) => toPublicSummaryRun(item));

  return c.json({
    success: true as const,
    items,
  }, 200);
});

const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{runId}",
  tags: ["Summaries"],
  summary: "Get one persisted workspace summary run",
  request: {
    params: z.object({
      runId: z.string().min(1),
    }),
  },
  responses: {
    200: {
      description: "Summary run detail",
      content: {
        "application/json": {
          schema: SummaryRunDetailResponseSchema,
        },
      },
    },
    404: {
      description: "Run not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(getRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const item = workspaceSummaryRunStorage.getRun(runId, c.var.workspaceSlug);
  if (!item) {
    return c.json({
      success: false as const,
      error: `Summary run not found: ${runId}`,
    }, 404);
  }

  return c.json({
    success: true as const,
    item: toPublicSummaryRun(item),
  }, 200);
});

export default app;
