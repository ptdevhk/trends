import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { callConvexQuery, callConvexMutation, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import { ActionStorage } from "../services/action-storage.js";
import { submitResumeImport } from "../services/resume-import-service.js";
import { getManualResumeImportMaxUploadBytes, importManualResumes } from "../services/manual-resume-import-service.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import {
  ResumeBackupRequestSchema,
  ResumeImportRequestSchema,
  ResumeManualImportErrorSchema,
  ResumeManualImportRequestSchema,
  ResumeManualImportFormSchema,
  ResumeManualImportResponseSchema,
  ResumeSubmitSummarySchema,
  SimpleErrorSchema,
  ResumeResetResponseSchema,
} from "../schemas/index.js";
import { resolveResumeId } from "../services/resume-id.js";
import { isRecord, normalizeWorkHistoryEntry } from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";
import {
  buildResumeIngestData,
  toOptionalNumber,
  toStringArray,
  toStringValue,
} from "../services/resume-ingest-utils.js";

const app = new OpenAPIHono();
const actionStorage = new ActionStorage(config.projectRoot);


function toResumeItemFromRecord(record: Record<string, unknown>, source?: string): ResumeItem {
  const profileUrl = toStringValue(
    record.profileUrl ?? record.profile_url ?? record.profileURL ?? record.url
  );
  const workHistory = Array.isArray(record.workHistory)
    ? record.workHistory
      .map((entry: unknown) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const projectExperience = Array.isArray(record.projectExperience)
    ? record.projectExperience
      .map((entry: unknown) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const profileEducation = Array.isArray(record.profileEducation)
    ? record.profileEducation
      .map((entry: unknown) => {
        if (!isRecord(entry)) {
          return null;
        }

        const institution = toStringValue(entry.institution) || undefined;
        const qualification = toStringValue(entry.qualification) || undefined;
        const fieldOfStudy = toStringValue(entry.fieldOfStudy) || undefined;
        const description = toStringValue(entry.description) || undefined;
        const startDate = toStringValue(entry.startDate) || undefined;
        const endDate = toStringValue(entry.endDate) || undefined;

        if (
          !institution
          && !qualification
          && !fieldOfStudy
          && !description
          && !startDate
          && !endDate
        ) {
          return null;
        }

        return {
          ...(institution ? { institution } : {}),
          ...(qualification ? { qualification } : {}),
          ...(fieldOfStudy ? { fieldOfStudy } : {}),
          ...(description ? { description } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  return {
    name: toStringValue(record.name),
    profileUrl,
    ...(toStringValue(record.source) || source ? { source: toStringValue(record.source) || source } : {}),
    activityStatus: toStringValue(record.activityStatus),
    age: toStringValue(record.age),
    experience: toStringValue(record.experience),
    education: toStringValue(record.education),
    location: toStringValue(record.location),
    selfIntro: toStringValue(record.selfIntro),
    jobIntention: toStringValue(record.jobIntention),
    expectedSalary: toStringValue(record.expectedSalary),
    workHistory,
    ...(projectExperience.length > 0 ? { projectExperience } : {}),
    ...(profileEducation.length > 0 ? { profileEducation } : {}),
    extractedAt: toStringValue(record.extractedAt),
    ingestData: buildResumeIngestData(record.ingestData),
    resumeId: toStringValue(record.resumeId) || undefined,
    perUserId: toStringValue(record.perUserId) || undefined,
    profileId: toStringValue(record.profileId) || undefined,
    profileType: toStringValue(record.profileType) || (source ? source : undefined),
    externalId: toStringValue(record.externalId) || undefined,
    ...(typeof record.searchText === "string" ? { searchText: record.searchText } : {}),
  };
}

// --- Backup-specific helpers ---

function buildResumeBackupItem(params: {
  record: Record<string, unknown>;
  sourceHost: string;
  tags: string[];
}): Record<string, unknown> {
  const content = isRecord(params.record.content) ? params.record.content : {};
  const restoreState = buildResumeBackupRestoreState(params.record);
  return {
    ...content,
    externalId: toStringValue(params.record.externalId) || toStringValue(content.externalId),
    sourceHost: params.sourceHost,
    tags: params.tags,
    ...(restoreState ? { restoreState } : {}),
  };
}

function buildResumeBackupRestoreState(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const restoreState: Record<string, unknown> = {};
  const crawledAt = record.crawledAt;
  if (typeof crawledAt === "number" && Number.isFinite(crawledAt)) {
    restoreState.crawledAt = crawledAt;
  }

  if (typeof record.isArchived === "boolean") {
    restoreState.isArchived = record.isArchived;
    if (record.isArchived) {
      const archivedAt = record.archivedAt;
      if (typeof archivedAt === "number" && Number.isFinite(archivedAt)) {
        restoreState.archivedAt = archivedAt;
      }
    }
  } else {
    const archivedAt = record.archivedAt;
    if (typeof archivedAt === "number" && Number.isFinite(archivedAt)) {
      restoreState.archivedAt = archivedAt;
    }
  }

  const searchText = toStringValue(record.searchText);
  if (searchText) {
    restoreState.searchText = searchText;
  }

  const primaryRuleScore = record.primaryRuleScore;
  if (typeof primaryRuleScore === "number" && Number.isFinite(primaryRuleScore)) {
    restoreState.primaryRuleScore = primaryRuleScore;
  }

  if (record.ingestData !== undefined) {
    restoreState.ingestData = record.ingestData;
  }

  if (record.analysis !== undefined) {
    restoreState.analysis = record.analysis;
  }

  if (record.analyses !== undefined) {
    restoreState.analyses = record.analyses;
  }

  return Object.keys(restoreState).length > 0 ? restoreState : undefined;
}

function normalizeResumeBackupFilterValues(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeResumeBackupSourceHosts(values: string[] | undefined): string[] | undefined {
  const normalized = normalizeResumeBackupFilterValues(values);
  return normalized?.map((value) => value.toLowerCase());
}

const ResumeImportErrorSchema = SimpleErrorSchema;

const manualImportResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/manual-import",
  tags: ["resumes"],
  summary: "Import resumes from manual 51job uploads",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: ResumeManualImportRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResumeManualImportResponseSchema } },
      description: "Manual import result",
    },
    400: {
      content: { "application/json": { schema: ResumeManualImportErrorSchema } },
      description: "Invalid upload payload",
    },
    413: {
      content: { "application/json": { schema: ResumeManualImportErrorSchema } },
      description: "Upload exceeds size limit",
    },
    500: {
      content: { "application/json": { schema: ResumeManualImportErrorSchema } },
      description: "Manual import failed",
    },
  },
});

const importResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/import",
  tags: ["resumes"],
  summary: "Import resumes from a first-party payload",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ResumeImportRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResumeSubmitSummarySchema } },
      description: "Import result",
    },
    400: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Invalid request payload",
    },
    403: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Admin access required",
    },
    500: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Import failed",
    },
  },
});

const backupResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/backup",
  tags: ["resumes"],
  summary: "Backup live resume records",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ResumeBackupRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeImportRequestSchema,
        },
      },
      description: "Portable backup payload",
    },
    403: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Admin access required",
    },
    404: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Requested resume records could not be resolved",
    },
    500: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Backup failed",
    },
  },
});

const resetResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/reset",
  tags: ["resumes"],
  summary: "Reset resume-related Convex records",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeResetResponseSchema,
        },
      },
      description: "Reset result",
    },
    403: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Admin access required",
    },
    500: {
      content: { "application/json": { schema: ResumeImportErrorSchema } },
      description: "Reset failed",
    },
  },
});

app.openapi(importResumesRoute, async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  try {
    const payload = c.req.valid("json");
    const result = await submitResumeImport(payload, c.var.workspaceSlug);
    return c.json(result, 200);
  } catch (error) {
    logger.error("Failed to import resumes", error, { route: "resumes_import" });
    return c.json({ success: false as const, error: "Failed to import resumes" }, 500);
  }
});

app.use(
  "/api/resumes/manual-import",
  bodyLimit({
    maxSize: getManualResumeImportMaxUploadBytes(),
    onError: (c) => {
      return c.json({ success: false as const, error: "Upload exceeds size limit" }, 413);
    },
  }),
);

app.openapi(manualImportResumesRoute, async (c) => {
  try {
    const formData = await c.req.formData();
    const parsedForm = ResumeManualImportFormSchema.safeParse({
      files: formData.getAll("files"),
      searchProfileId: formData.get("searchProfileId") ?? undefined,
      keyword: formData.get("keyword") ?? undefined,
      location: formData.get("location") ?? undefined,
    });

    if (!parsedForm.success) {
      return c.json({ success: false as const, error: "Expected at least one uploaded file" }, 400);
    }

    const result = await importManualResumes(parsedForm.data);
    return c.json(result, 200);
  } catch (error) {
    logger.error("Failed to import manual resumes", error, { route: "resumes_import" });
    const message = error instanceof Error ? error.message : "Failed to import manual resumes";
    return c.json({ success: false as const, error: message }, 500);
  }
});

app.openapi(backupResumesRoute, async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  try {
    const request = c.req.valid("json");
    const requestedResumeIds = normalizeResumeBackupFilterValues(request.resumeIds);
    const requestedSourceHosts = normalizeResumeBackupSourceHosts(request.sourceHosts);

    type BackupResumeEntry = {
      resumeId: string;
      sourceHost: string;
      tags: string[];
      crawledAt: number;
      payload: Record<string, unknown>;
    };

    const entries: BackupResumeEntry[] = [];
    const foundResumeIds = new Set<string>();
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const value = await callConvexQuery("resumes:listForBackup", {
        paginationOpts: {
          cursor,
          numItems: 50,
        },
        resumeIds: requestedResumeIds,
        sourceHosts: requestedSourceHosts,
        limit: request.limit,
      });
      if (!isConvexPaginatedQueryPage(value)) {
        throw new Error("Invalid resume backup response from Convex");
      }

      for (const item of value.page) {
        if (!isRecord(item)) {
          continue;
        }

        const sourceHost = toStringValue(item.source).toLowerCase();
        const content = isRecord(item.content) ? item.content : {};
        const resume = toResumeItemFromRecord(content, sourceHost);
        const resumeId = resolveResumeId(resume, entries.length);
        const tags = toStringArray(item.tags);

        entries.push({
          resumeId,
          sourceHost,
          tags,
          crawledAt: typeof item.crawledAt === "number" && Number.isFinite(item.crawledAt) ? item.crawledAt : 0,
          payload: buildResumeBackupItem({
            record: item,
            sourceHost,
            tags,
          }),
        });
        if (requestedResumeIds) {
          foundResumeIds.add(resumeId);
        }
      }

      const reachedRequestedLimit = typeof request.limit === "number"
        && !requestedResumeIds
        && entries.length >= request.limit;
      const foundAllRequestedResumeIds = requestedResumeIds
        ? requestedResumeIds.every((resumeId) => foundResumeIds.has(resumeId))
        : false;

      cursor = value.isDone ? null : value.continueCursor;
      isDone = value.isDone || reachedRequestedLimit || foundAllRequestedResumeIds;
    }

    let selectedEntries: BackupResumeEntry[];
    if (requestedResumeIds) {
      const byResumeId = new Map(entries.map((entry) => [entry.resumeId, entry]));
      const missingResumeIds = requestedResumeIds.filter((resumeId) => !byResumeId.has(resumeId));
      if (missingResumeIds.length > 0) {
        return c.json({
          success: false as const,
          error: `Unable to resolve resumes for backup: ${missingResumeIds.join(", ")}`,
        }, 404);
      }

      selectedEntries = requestedResumeIds
        .map((resumeId) => byResumeId.get(resumeId))
        .filter((entry): entry is BackupResumeEntry => Boolean(entry));
    } else {
      selectedEntries = [...entries].sort((left, right) => {
        const crawledDiff = right.crawledAt - left.crawledAt;
        if (crawledDiff !== 0) {
          return crawledDiff;
        }

        const sourceDiff = left.sourceHost.localeCompare(right.sourceHost);
        if (sourceDiff !== 0) {
          return sourceDiff;
        }

        return left.resumeId.localeCompare(right.resumeId);
      });
    }

    const limited = typeof request.limit === "number" ? selectedEntries.slice(0, request.limit) : selectedEntries;
    const generatedAt = new Date().toISOString();

    const resumeIds = limited.map((entry) => entry.resumeId);
    const candidateActions = actionStorage.listActionsForBackup({
      workspaceSlug: c.var.workspaceSlug,
      resumeIds,
    });

    let candidateStatus: Array<{
      identityKey: string;
      status: string;
      notes?: string;
      updatedBy?: string;
      updatedAt: number;
      history?: Array<{ status: string; updatedAt: number; notes?: string }>;
    }> = [];
    try {
      const statusResponse = await callConvexQuery("candidate_status:listForBackup", {
        workspaceSlug: c.var.workspaceSlug,
      });
      if (Array.isArray(statusResponse)) {
        candidateStatus = statusResponse;
      }
    } catch (error) {
      logger.error("Failed to query candidate_status for backup", error, { route: "resumes_import" });
    }

    c.header("Content-Disposition", `attachment; filename="resume-backup-${generatedAt.replace(/[:.]/g, "-")}.json"`);
    c.header("Cache-Control", "no-store");
    return c.json(ResumeImportRequestSchema.parse({
      metadata: {
        sourceUrl: c.req.url,
        generatedBy: "trends-api backup",
        generatedAt,
        totalResumes: limited.length,
        version: "2",
      },
      resumes: limited.map((entry) => entry.payload),
      candidateActions,
      candidateStatus,
    }), 200);
  } catch (error) {
    logger.error("Failed to backup resumes", error, { route: "resumes_import" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

app.openapi(resetResumesRoute, async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  try {
    const value = await callConvexMutation("resume_tasks:resetDatabase", {});
    return c.json(ResumeResetResponseSchema.parse(value), 200);
  } catch (error) {
    logger.error("Failed to reset resumes", error, { route: "resumes_import" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});


export default app;
