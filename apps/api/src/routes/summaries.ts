import { randomUUID } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  WORKSPACE_TEAMS,
  isValidWorkspace,
  type SummaryProfileRecord as SummaryProfileRecordType,
  type SummaryProfileRuntimeItem as SummaryProfileRuntimeItemType,
  type SummaryProfilesConfig as SummaryProfilesConfigType,
  type WorkspaceSlug,
} from "@trends/shared";

import { SummaryDataService } from "../services/summaries/summary-data-service.js";
import { summaryDispatcher } from "../services/summaries/summary-dispatcher.js";
import { SummaryRenderer } from "../services/summaries/summary-renderer.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { logger } from "../services/logger.js";
import { denyIfNotAdmin } from "../middleware/workspace.js";
import {
  WorkspaceSummaryRunStorage,
  type StoredWorkspaceSummaryRun,
} from "../services/workspace-summary-run-storage.js";

const app = new OpenAPIHono();
const summaryDataService = new SummaryDataService();
const summaryRenderer = new SummaryRenderer();
const workspaceSummaryRunStorage = new WorkspaceSummaryRunStorage();
const KNOWN_WORKSPACE_SLUGS = Object.keys(WORKSPACE_TEAMS).filter(isValidWorkspace);
const SummaryPeriodSchema = z.enum(["daily", "weekly", "monthly"]);
const WorkspaceSlugSchema = z.string().min(1);

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

const SummaryWindowSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  timezone: z.string(),
});

const SummaryComparisonSchema = z.object({
  previousWindow: SummaryWindowSchema,
  totalsDelta: z.object({
    sharedIngest: SummarySharedIngestTotalsSchema,
    workspaceActivity: SummaryWorkspaceActivityTotalsSchema,
  }),
});

const SummaryReportSchema = z.object({
  workspaceSlug: z.string(),
  period: SummaryPeriodSchema,
  generatedAt: z.string(),
  window: SummaryWindowSchema,
  comparison: SummaryComparisonSchema.optional(),
  totals: SummaryTotalsSchema,
  breakdowns: SummaryBreakdownsSchema,
  scopes: SummaryScopesSchema.optional(),
  notes: z.array(z.string()),
});

const SummaryPreviewRequestSchema = z.object({
  workspaceSlug: z.string().min(1).optional(),
  period: SummaryPeriodSchema.default("daily"),
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
  period: SummaryPeriodSchema,
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

const SummaryProfileScheduleSchema = z.object({
  cron: z.string().trim().min(1),
});

const SummaryProfileRequestSchema = z.object({
  period: SummaryPeriodSchema,
  channel: SummaryChannelSchema,
  dryRun: z.boolean(),
  templateId: z.string().trim().min(1).optional(),
  to: z.string().trim().email().optional(),
  subject: z.string().trim().min(1).optional(),
});

const SummaryProfileSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  schedule: SummaryProfileScheduleSchema,
  request: SummaryProfileRequestSchema,
});

const SummaryProfilesListResponseSchema = z.object({
  success: z.literal(true),
  profiles: z.array(SummaryProfileSchema),
});

const SummaryProfileDetailResponseSchema = z.object({
  success: z.literal(true),
  profile: SummaryProfileSchema,
});

const SummaryProfileRuntimeItemSchema = z.object({
  workspaceSlug: WorkspaceSlugSchema,
  profileId: z.string(),
  name: z.string(),
  cron: z.string(),
  period: SummaryPeriodSchema,
  channel: SummaryChannelSchema,
  dryRun: z.boolean(),
  templateId: z.string().optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
});

const SummaryProfilesRuntimeResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(SummaryProfileRuntimeItemSchema),
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
        period: run.period,
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

function cloneSummaryProfile(profile: SummaryProfileRecordType): SummaryProfileRecordType {
  const isEmailProfile = profile.request.channel === "email";
  return {
    id: profile.id,
    name: profile.name,
    enabled: profile.enabled,
    schedule: {
      cron: profile.schedule.cron,
    },
    request: {
      period: profile.request.period,
      channel: profile.request.channel,
      dryRun: profile.request.dryRun,
      ...(profile.request.templateId ? { templateId: profile.request.templateId } : {}),
      ...(isEmailProfile && profile.request.to ? { to: profile.request.to } : {}),
      ...(isEmailProfile && profile.request.subject ? { subject: profile.request.subject } : {}),
    },
  };
}

function getSummaryProfileValidationError(profile: SummaryProfileRecordType): string | null {
  if (profile.request.channel === "email" && !profile.request.to) {
    return "Email recipient is required";
  }

  return null;
}

function findSummaryProfile(
  config: SummaryProfilesConfigType,
  profileId: string,
): SummaryProfileRecordType | undefined {
  return config.profiles.find((profile) => profile.id === profileId);
}

function toSummaryProfileRuntimeItem(
  workspaceSlug: WorkspaceSlug,
  profile: SummaryProfileRecordType,
): SummaryProfileRuntimeItemType {
  return {
    workspaceSlug,
    profileId: profile.id,
    name: profile.name,
    cron: profile.schedule.cron,
    period: profile.request.period,
    channel: profile.request.channel,
    dryRun: profile.request.dryRun,
    ...(profile.request.templateId ? { templateId: profile.request.templateId } : {}),
    ...(profile.request.to ? { to: profile.request.to } : {}),
    ...(profile.request.subject ? { subject: profile.request.subject } : {}),
  };
}

const listProfilesRoute = createRoute({
  method: "get",
  path: "/profiles",
  tags: ["Summaries"],
  summary: "List workspace summary profiles",
  responses: {
    200: {
      description: "Workspace summary profiles",
      content: {
        "application/json": {
          schema: SummaryProfilesListResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(listProfilesRoute, async (c) => {
  if (denyIfNotAdmin(c.var.accessLevel)) {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  const config = await workspaceConfigService.getWorkspaceSummaryProfiles(c.var.workspaceSlug);
  return c.json({
    success: true as const,
    profiles: config.profiles.map((profile) => cloneSummaryProfile(profile)),
  }, 200);
});

const createProfileRoute = createRoute({
  method: "post",
  path: "/profiles",
  tags: ["Summaries"],
  summary: "Create workspace summary profile",
  request: {
    body: {
      content: {
        "application/json": {
          schema: SummaryProfileSchema,
        },
      },
    },
  },
  responses: {
    400: {
      description: "Invalid summary profile",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    201: {
      description: "Summary profile created",
      content: {
        "application/json": {
          schema: SummaryProfileDetailResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: "Duplicate profile id",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(createProfileRoute, async (c) => {
  if (denyIfNotAdmin(c.var.accessLevel)) {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  const payload = c.req.valid("json");
  const profile = cloneSummaryProfile(payload);
  const validationError = getSummaryProfileValidationError(profile);
  if (validationError) {
    return c.json({ success: false as const, error: validationError }, 400);
  }

  const config = await workspaceConfigService.getWorkspaceSummaryProfiles(c.var.workspaceSlug);
  if (findSummaryProfile(config, profile.id)) {
    return c.json({
      success: false as const,
      error: `Summary profile already exists: ${profile.id}`,
    }, 409);
  }

  await workspaceConfigService.setWorkspaceSummaryProfiles(c.var.workspaceSlug, {
    profiles: [...config.profiles, profile],
  });

  return c.json({
    success: true as const,
    profile,
  }, 201);
});

const runtimeProfilesRoute = createRoute({
  method: "get",
  path: "/profiles/runtime",
  tags: ["Summaries"],
  summary: "List enabled summary profiles across known workspaces for worker runtime",
  responses: {
    200: {
      description: "Runtime summary profile list",
      content: {
        "application/json": {
          schema: SummaryProfilesRuntimeResponseSchema,
        },
      },
    },
  },
});

app.openapi(runtimeProfilesRoute, async (c) => {
  const configs = await Promise.all(
    KNOWN_WORKSPACE_SLUGS.map(async (workspaceSlug) => ({
      workspaceSlug,
      config: await workspaceConfigService.getWorkspaceSummaryProfiles(workspaceSlug),
    })),
  );

  const items = configs.flatMap(({ workspaceSlug, config }) =>
    config.profiles
      .filter((profile) => profile.enabled)
      .map((profile) => toSummaryProfileRuntimeItem(workspaceSlug, profile)),
  );

  return c.json({
    success: true as const,
    items,
  }, 200);
});

const getProfileRoute = createRoute({
  method: "get",
  path: "/profiles/{profileId}",
  tags: ["Summaries"],
  summary: "Get one workspace summary profile",
  request: {
    params: z.object({
      profileId: z.string().trim().min(1),
    }),
  },
  responses: {
    200: {
      description: "Summary profile detail",
      content: {
        "application/json": {
          schema: SummaryProfileDetailResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Summary profile not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(getProfileRoute, async (c) => {
  if (denyIfNotAdmin(c.var.accessLevel)) {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  const { profileId } = c.req.valid("param");
  const config = await workspaceConfigService.getWorkspaceSummaryProfiles(c.var.workspaceSlug);
  const profile = findSummaryProfile(config, profileId);
  if (!profile) {
    return c.json({
      success: false as const,
      error: `Summary profile not found: ${profileId}`,
    }, 404);
  }

  return c.json({
    success: true as const,
    profile: cloneSummaryProfile(profile),
  }, 200);
});

const updateProfileRoute = createRoute({
  method: "put",
  path: "/profiles/{profileId}",
  tags: ["Summaries"],
  summary: "Update one workspace summary profile",
  request: {
    params: z.object({
      profileId: z.string().trim().min(1),
    }),
    body: {
      content: {
        "application/json": {
          schema: SummaryProfileSchema,
        },
      },
    },
  },
  responses: {
    400: {
      description: "Invalid summary profile",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    200: {
      description: "Summary profile updated",
      content: {
        "application/json": {
          schema: SummaryProfileDetailResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Summary profile not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(updateProfileRoute, async (c) => {
  if (denyIfNotAdmin(c.var.accessLevel)) {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  const { profileId } = c.req.valid("param");
  const payload = c.req.valid("json");
  const nextProfileBase = cloneSummaryProfile(payload);
  const validationError = getSummaryProfileValidationError(nextProfileBase);
  if (validationError) {
    return c.json({ success: false as const, error: validationError }, 400);
  }

  const config = await workspaceConfigService.getWorkspaceSummaryProfiles(c.var.workspaceSlug);
  const profileIndex = config.profiles.findIndex((profile) => profile.id === profileId);
  if (profileIndex === -1) {
    return c.json({
      success: false as const,
      error: `Summary profile not found: ${profileId}`,
    }, 404);
  }

  const existingProfile = config.profiles[profileIndex];
  const nextProfile: SummaryProfileRecordType = {
    ...nextProfileBase,
    id: existingProfile.id,
  };
  const nextProfiles = [...config.profiles];
  nextProfiles[profileIndex] = nextProfile;

  await workspaceConfigService.setWorkspaceSummaryProfiles(c.var.workspaceSlug, {
    profiles: nextProfiles,
  });

  return c.json({
    success: true as const,
    profile: nextProfile,
  }, 200);
});

const deleteProfileRoute = createRoute({
  method: "delete",
  path: "/profiles/{profileId}",
  tags: ["Summaries"],
  summary: "Delete one workspace summary profile",
  request: {
    params: z.object({
      profileId: z.string().trim().min(1),
    }),
  },
  responses: {
    200: {
      description: "Summary profile deleted",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
          }),
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: "Summary profile not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(deleteProfileRoute, async (c) => {
  if (denyIfNotAdmin(c.var.accessLevel)) {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  const { profileId } = c.req.valid("param");
  const config = await workspaceConfigService.getWorkspaceSummaryProfiles(c.var.workspaceSlug);
  const nextProfiles = config.profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === config.profiles.length) {
    return c.json({
      success: false as const,
      error: `Summary profile not found: ${profileId}`,
    }, 404);
  }

  await workspaceConfigService.setWorkspaceSummaryProfiles(c.var.workspaceSlug, {
    profiles: nextProfiles,
  });

  return c.json({ success: true as const }, 200);
});

const previewRoute = createRoute({
  method: "post",
  path: "/preview",
  tags: ["Summaries"],
  summary: "Preview a workspace summary",
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
      period: report.period,
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
    logger.error("Failed to preview summary:", error, { route: "summaries" });
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
  summary: "Render and optionally send a workspace summary",
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
      templateId,
    });
    triggerSource = body.triggerSource ?? "api_manual";
    const runId = randomUUID();
    const dispatched = await summaryDispatcher.dispatch(report, {
      channel: body.channel,
      dryRun: body.dryRun,
      templateId,
      to: body.to,
      subject: body.subject,
      webhookUrl: body.webhookUrl,
      botToken: body.botToken,
      chatId: body.chatId,
    });
    const run = workspaceSummaryRunStorage.createRun({
      id: runId,
      workspaceSlug,
      period: report.period,
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
        period: report.period,
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
    logger.error("Failed to run summary:", error, { route: "summaries" });
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
