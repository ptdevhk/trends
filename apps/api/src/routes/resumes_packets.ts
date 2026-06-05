import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ResumeExportBinaryResponseSchema,
  ResumeExportCanonicalRequestSchema,
  ResumeExportResolvedResumeSchema,
  ReviewPacketExportRequestSchema,
  ReviewPacketFeedbackImportFormSchema,
  ReviewPacketFeedbackImportRequestSchema,
  ReviewPacketFeedbackImportResponseSchema,
  ReviewPacketRunSchema,
  ReviewPacketRunsResponseSchema,
  ReviewPacketSummaryPreviewRequestSchema,
  ReviewPacketSummaryPreviewResponseSchema,
  ReviewPacketSummarySendRequestSchema,
  ReviewPacketSummarySendResponseSchema,
  ReviewPacketTrackedExportResponseSchema,
  SimpleErrorSchema,
} from "../schemas/index.js";
import { logger } from "../services/logger.js";
import { requireAdmin } from "../middleware/workspace.js";
import { config } from "../services/config.js";
import { ResumeService } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { resolveConvexUrl } from "../services/resume-import-service.js";
import { resolveResumeId } from "../services/resume-id.js";
import {
  ExportService,
  type ExportFormat,
  type ExportBatchMeta,
  type ReviewPacketExportOptions,
  type ResumeExportEntry,
} from "../services/export-service.js";
import { ReviewPacketStorage, type ReviewPacketItemSnapshot, type StoredReviewPacketRun } from "../services/review-packet-storage.js";
import { ActionStorage } from "../services/action-storage.js";
import { FeedbackImportService, normalizeProfileIdentityKey } from "../services/feedback-import-service.js";
import { FeedbackSummaryService } from "../services/feedback-summary-service.js";
import { callConvexQuery, callConvexMutation } from "../services/convex-utils.js";
import { notificationService } from "../services/notification-service.js";
import { notificationTemplateService } from "../services/notification-template-service.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";
import { triggerReingestStaleSkillsVersion, shouldTriggerSkillsReingest } from "./resumes.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { BrandDisplayResolver } from "../services/brand-display-resolver.js";
import {
  computeEffectiveIndustryDbV2Raw,
  computeBatchStats,
  type IndustryDbV2BatchStats,
} from "../services/industry-db-batch-stats.js";
import type { ResumeItem } from "../types/resume.js";
import {
  isRecord,
  toStringValue,
  toOptionalNumber,
  toStringArray,
  toBrandRole,
  toBrandContext,
  parseBrandHits,
  parseRoleSignals,
  buildResumeIngestData,
} from "./resumes-packets-helpers.js";

const app = new OpenAPIHono();
app.use("/api/resumes/review-packets", requireAdmin);
app.use("/api/resumes/review-packets/*", requireAdmin);
app.use("/api/resumes/learning-feedback", requireAdmin);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
const companyPatterns = skillsKnowledgeService.getCompanyPatterns();
const exportService = new ExportService(
  new BrandDisplayResolver(config.projectRoot, companyPatterns),
  companyPatterns
);
const reviewPacketStorage = new ReviewPacketStorage(config.projectRoot);
const actionStorage = new ActionStorage(config.projectRoot);
const feedbackImportService = new FeedbackImportService();
const feedbackSummaryService = new FeedbackSummaryService();
const resumeService = new ResumeService(config.projectRoot);
const searchEventLogger = new SearchEventLogger(config.projectRoot);

// --- Export/packet types ---

type ResumeExportCanonicalRequest = z.infer<typeof ResumeExportCanonicalRequestSchema>;
type ReviewPacketExportRequest = z.infer<typeof ReviewPacketExportRequestSchema>;
type ResumeExportEntryContext = ResumeExportCanonicalRequest["entries"][number];
type ReviewPacketSummaryTemplateRequest = z.infer<typeof ReviewPacketSummaryPreviewRequestSchema>;
type ExportResumePayload = ResumeExportEntry["resume"];
type ResumeExportEntryFields = Omit<ResumeExportEntry, "key" | "resume">;
type ResumeSource = "sample" | "convex";
type ReviewPacketResolvedRecord = {
  resumeId: string;
  resume: ExportResumePayload;
  identityKey: string;
  profileUrl?: string;
  name?: string;
  source?: string;
};
type ReviewPacketStatusListItem = {
  identityKey: string;
  status: string;
};

// --- Export/packet helper functions ---

export function toExportResumePayload(resume: ResumeItem): ExportResumePayload {
  return {
    externalId: resume.externalId,
    name: resume.name,
    jobIntention: resume.jobIntention,
    location: resume.location,
    age: resume.age,
    experience: resume.experience,
    education: resume.education,
    expectedSalary: resume.expectedSalary,
    profileUrl: resume.profileUrl,
    source: undefined,
    selfIntro: resume.selfIntro,
    workHistory: resume.workHistory,
    ingestData: resume.ingestData,
  };
}

export function normalizeExportResumePayload(
  resume: z.infer<typeof ResumeExportResolvedResumeSchema>
): ExportResumePayload {
  return {
    externalId: resume.externalId,
    name: resume.name,
    jobIntention: resume.jobIntention,
    location: resume.location,
    age: resume.age,
    experience: resume.experience,
    education: resume.education,
    expectedSalary: resume.expectedSalary,
    profileUrl: resume.profileUrl,
    source: resume.source,
    selfIntro: resume.selfIntro,
    workHistory: resume.workHistory,
    ingestData: buildResumeIngestData(resume.ingestData),
  };
}

export function toExportEntryFields(entry: ResumeExportEntryContext): ResumeExportEntryFields {
  return {
    match: entry.match,
    action: entry.action,
    status: entry.status,
    ruleScore: entry.ruleScore,
    userComment: entry.userComment,
    referenceNote: entry.referenceNote,
    userRating: entry.userRating,
  };
}

export function toExportEntry(key: string, resume: ExportResumePayload, fields: ResumeExportEntryFields): ResumeExportEntry {
  return {
    key: key.trim(),
    resume,
    ...fields,
  };
}

async function resolveConvexExportResumeMap(
  entries: ResumeExportEntryContext[]
): Promise<Map<string, ExportResumePayload>> {
  const resumeIds = Array.from(new Set(entries.map((entry) => entry.resumeId.trim()).filter(Boolean)));
  if (resumeIds.length === 0) {
    return new Map();
  }

  const value = await callConvexQuery("resumes:getByIdsForExport", { resumeIds });
  if (!Array.isArray(value)) {
    throw new Error("Invalid export resume response from Convex");
  }

  const resolved = new Map<string, ExportResumePayload>();
  value.forEach((item) => {
    if (!isRecord(item) || typeof item.resumeId !== "string" || item.resumeId.length === 0) {
      return;
    }
    const parsedResume = ResumeExportResolvedResumeSchema.safeParse(item.resume);
    if (!parsedResume.success) {
      return;
    }

    const resumeId = item.resumeId;
    resolved.set(resumeId, normalizeExportResumePayload(parsedResume.data));
  });

  return resolved;
}

function resolveSampleExportResumeMap(
  sampleName: string,
  entries: ResumeExportEntryContext[]
): Map<string, ExportResumePayload> {
  const { items } = resumeService.loadSample(sampleName);
  const requestedIds = new Set(entries.map((entry) => entry.resumeId.trim()).filter(Boolean));
  const resolved = new Map<string, ExportResumePayload>();

  items.forEach((resume, index) => {
    const resumeId = resolveResumeId(resume, index);
    if (!requestedIds.has(resumeId)) {
      return;
    }

    resolved.set(resumeId, toExportResumePayload(resume));
  });

  return resolved;
}

export function buildExportEntriesFromResolvedResumes(
  entries: ResumeExportEntryContext[],
  resolvedResumes: Map<string, ExportResumePayload>
): ResumeExportEntry[] {
  const missingIds: string[] = [];
  const resolvedEntries = entries.flatMap((entry) => {
    const resume = resolvedResumes.get(entry.resumeId);
    if (!resume) {
      missingIds.push(entry.resumeId);
      return [];
    }

    return [toExportEntry(entry.resumeId, resume, toExportEntryFields(entry))];
  });

  if (missingIds.length > 0) {
    throw new DataNotFoundError(`Unable to resolve resumes for export: ${missingIds.join(", ")}`);
  }

  return resolvedEntries;
}

export function applyStoredUserRatings(
  entries: ResumeExportEntry[],
  ratingsByResume: ReadonlyMap<string, number>
): ResumeExportEntry[] {
  if (ratingsByResume.size === 0) {
    return entries;
  }

  return entries.map((entry) => {
    if (entry.userRating !== undefined) {
      return entry;
    }

    const rating = ratingsByResume.get(entry.key);
    return rating === undefined
      ? entry
      : {
          ...entry,
          userRating: rating,
        };
  });
}

function resolveStoredRatingsForExportRequest(
  request: Pick<ResumeExportCanonicalRequest, "sessionId" | "jobDescriptionId">,
  entries: ResumeExportEntry[]
): Map<string, number> {
  const sessionId = request.sessionId?.trim();
  if (!sessionId) {
    return new Map();
  }

  return actionStorage.getLatestRatingsForSession({
    sessionId,
    jobDescriptionId: request.jobDescriptionId?.trim() || undefined,
    resumeIds: entries.map((entry) => entry.key),
  });
}

async function resolveExportRequest(
  request: ResumeExportCanonicalRequest
): Promise<{
  format: ExportFormat;
  entries: ResumeExportEntry[];
  batchMeta: ExportBatchMeta;
  industryDbV2Stats: IndustryDbV2BatchStats;
  debug: boolean;
}> {
  const resolvedResumes = request.source === "sample"
    ? resolveSampleExportResumeMap(request.sample ?? "", request.entries)
    : await resolveConvexExportResumeMap(request.entries);
  const resolvedEntries = buildExportEntriesFromResolvedResumes(request.entries, resolvedResumes);
  const entries = applyStoredUserRatings(
    resolvedEntries,
    resolveStoredRatingsForExportRequest(request, resolvedEntries)
  );

  const industryDbV2Stats = request.industryDbV2Stats
    ?? computeBatchStats(entries.map((entry) => {
      return computeEffectiveIndustryDbV2Raw(entry.resume.ingestData);
    }));

  return {
    format: request.format,
    entries,
    batchMeta: {
      userComment: request.userComment,
      referenceNote: request.referenceNote,
    },
    industryDbV2Stats,
    debug: request.debug ?? process.env.DEBUG === "true",
  };
}

async function buildResumeExportResponse(request: ResumeExportCanonicalRequest, workspaceSlug?: string) {
  const { format, entries, batchMeta, industryDbV2Stats, debug } = await resolveExportRequest(request);
  const fieldConfig = workspaceSlug
    ? await workspaceConfigService.getExportFieldsConfig(workspaceSlug)
    : null;
  const file = await exportService.exportResumes(format, entries, batchMeta, industryDbV2Stats, debug, fieldConfig);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `resumes-export-${timestamp}.${file.extension}`;

  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(file.content.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export function buildReviewPacketIdentityKey(params: {
  resumeId: string;
  profileUrl?: string;
  source?: string;
}): string {
  const profileIdentityKey = normalizeProfileIdentityKey(params.profileUrl, params.source);
  if (profileIdentityKey) {
    return profileIdentityKey;
  }
  return `resumeId:${params.resumeId.trim().toLowerCase()}`;
}

export function toReviewPacketItemSnapshot(
  record: ReviewPacketResolvedRecord
): ReviewPacketItemSnapshot {
  return {
    resumeId: record.resumeId,
    identityKey: record.identityKey,
    profileUrl: record.profileUrl,
    name: record.name,
    source: record.source,
  };
}

export function buildReviewPacketEntriesFromResolvedRecords(
  entries: ResumeExportEntryContext[],
  resolvedRecords: Map<string, ReviewPacketResolvedRecord>
): {
  entries: ResumeExportEntry[];
  items: ReviewPacketItemSnapshot[];
} {
  const missingIds: string[] = [];
  const exportEntries: ResumeExportEntry[] = [];
  const items: ReviewPacketItemSnapshot[] = [];

  for (const entry of entries) {
    const resolved = resolvedRecords.get(entry.resumeId);
    if (!resolved) {
      missingIds.push(entry.resumeId);
      continue;
    }

    exportEntries.push(toExportEntry(entry.resumeId, resolved.resume, toExportEntryFields(entry)));
    items.push(toReviewPacketItemSnapshot(resolved));
  }

  if (missingIds.length > 0) {
    throw new DataNotFoundError(`Unable to resolve resumes for review packet export: ${missingIds.join(", ")}`);
  }

  return {
    entries: exportEntries,
    items,
  };
}

async function resolveConvexReviewPacketRecordMap(
  entries: ResumeExportEntryContext[]
): Promise<Map<string, ReviewPacketResolvedRecord>> {
  const resumeIds = Array.from(new Set(entries.map((entry) => entry.resumeId.trim()).filter(Boolean)));
  if (resumeIds.length === 0) {
    return new Map();
  }

  const value = await callConvexQuery("resumes:getByIdsForExport", { resumeIds });
  if (!Array.isArray(value)) {
    throw new Error("Invalid export resume response from Convex");
  }

  const resolved = new Map<string, ReviewPacketResolvedRecord>();
  value.forEach((item) => {
    if (!isRecord(item) || typeof item.resumeId !== "string" || item.resumeId.length === 0) {
      return;
    }
    const parsedResume = ResumeExportResolvedResumeSchema.safeParse(item.resume);
    if (!parsedResume.success) {
      return;
    }

    const resumeId = item.resumeId;
    const resume = normalizeExportResumePayload(parsedResume.data);
    resolved.set(resumeId, {
      resumeId,
      resume,
      identityKey: buildReviewPacketIdentityKey({
        resumeId,
        profileUrl: resume.profileUrl,
        source: resume.source,
      }),
      profileUrl: resume.profileUrl,
      name: resume.name,
      source: resume.source,
    });
  });

  return resolved;
}

function resolveSampleReviewPacketRecordMap(
  sampleName: string,
  entries: ResumeExportEntryContext[]
): Map<string, ReviewPacketResolvedRecord> {
  const { items } = resumeService.loadSample(sampleName);
  const requestedIds = new Set(entries.map((entry) => entry.resumeId.trim()).filter(Boolean));
  const resolved = new Map<string, ReviewPacketResolvedRecord>();

  items.forEach((resume, index) => {
    const resumeId = resolveResumeId(resume, index);
    if (!requestedIds.has(resumeId)) {
      return;
    }

    const payload = toExportResumePayload(resume);
    resolved.set(resumeId, {
      resumeId,
      resume: payload,
      identityKey: buildReviewPacketIdentityKey({
        resumeId,
        profileUrl: payload.profileUrl,
        source: payload.source,
      }),
      profileUrl: payload.profileUrl,
      name: payload.name,
      source: payload.source,
    });
  });

  return resolved;
}

async function resolveReviewPacketExportRequest(
  request: ReviewPacketExportRequest
): Promise<{
  format: ExportFormat;
  source: ResumeSource;
  sampleName?: string;
  sessionId?: string;
  jobDescriptionId?: string;
  entries: ResumeExportEntry[];
  items: ReviewPacketItemSnapshot[];
  batchMeta: ExportBatchMeta;
  industryDbV2Stats: IndustryDbV2BatchStats;
  debug: boolean;
}> {
  const resolvedRecords = request.source === "sample"
    ? resolveSampleReviewPacketRecordMap(request.sample ?? "", request.entries)
    : await resolveConvexReviewPacketRecordMap(request.entries);
  const resolved = buildReviewPacketEntriesFromResolvedRecords(request.entries, resolvedRecords);
  const entries = applyStoredUserRatings(
    resolved.entries,
    resolveStoredRatingsForExportRequest(request, resolved.entries)
  );
  const industryDbV2Stats = request.industryDbV2Stats
    ?? computeBatchStats(entries.map((entry) => computeEffectiveIndustryDbV2Raw(entry.resume.ingestData)));

  return {
    format: request.format,
    source: request.source,
    sampleName: request.sample?.trim() || undefined,
    sessionId: request.sessionId?.trim() || undefined,
    jobDescriptionId: request.jobDescriptionId?.trim() || undefined,
    entries,
    items: resolved.items,
    batchMeta: {
      userComment: request.userComment,
      referenceNote: request.referenceNote,
    },
    industryDbV2Stats,
    debug: request.debug ?? process.env.DEBUG === "true",
  };
}

export function buildReviewPacketDownloadPath(runId: string): string {
  return `/api/resumes/review-packets/${encodeURIComponent(runId)}/download`;
}

export function buildReviewPacketSessionId(runId: string): string {
  return `review-packet:${runId}`;
}

export function buildReviewPacketFilename(runId: string, format: ExportFormat): string {
  return `review-packet-${runId}.${format}`;
}

function getReviewPacketOutputDir(): string {
  return path.join(config.projectRoot, "output", "review-packets");
}

function getReviewPacketFilePath(runId: string, format: ExportFormat): string {
  return path.join(getReviewPacketOutputDir(), buildReviewPacketFilename(runId, format));
}

export function toPublicReviewPacketRun(run: StoredReviewPacketRun): z.infer<typeof ReviewPacketRunSchema> {
  const importStats = run.stats?.import
    ? {
        importedAt: run.stats.import.importedAt,
        fileName: run.stats.import.fileName,
        totalRows: run.stats.import.totalRows,
        matchedRows: run.stats.import.matchedRows,
        importedRows: run.stats.import.importedRows,
        reviewedCount: run.stats.import.reviewedCount,
        statusUpdates: run.stats.import.statusUpdates,
        actionUpdates: run.stats.import.actionUpdates,
        noteUpdates: run.stats.import.noteUpdates,
        invalidRows: run.stats.import.invalidRows,
        duplicateRows: run.stats.import.duplicateRows,
        warningCount: run.stats.import.warningCount,
        matchedByProfileUrlCount: run.stats.import.matchedByProfileUrlCount,
        nameMismatchCount: run.stats.import.nameMismatchCount,
        warnings: run.stats.import.warnings,
      }
    : undefined;
  const summaryStats = run.stats?.summary
    ? {
        previewedAt: run.stats.summary.previewedAt,
        sentAt: run.stats.summary.sentAt,
        channel: run.stats.summary.channel,
        reviewedCount: run.stats.summary.reviewedCount,
        pendingCount: run.stats.summary.pendingCount,
        warningCount: run.stats.summary.warningCount,
        statusBreakdown: run.stats.summary.statusBreakdown,
        actionBreakdown: run.stats.summary.actionBreakdown,
      }
    : undefined;

  return {
    id: run.id,
    workspaceSlug: run.workspaceSlug,
    source: run.source,
    sampleName: run.sampleName,
    sessionId: run.sessionId,
    jobDescriptionId: run.jobDescriptionId,
    format: run.format,
    status: run.status,
    totalCount: run.totalCount,
    packetFilename: run.packetFilename,
    exportedAt: run.exportedAt,
    feedbackImportedAt: run.feedbackImportedAt,
    summarySentAt: run.summarySentAt,
    summaryChannel: run.summaryChannel,
    stats: importStats || summaryStats ? {
      ...(importStats ? { import: importStats } : {}),
      ...(summaryStats ? { summary: summaryStats } : {}),
    } : undefined,
    error: run.error,
  };
}

function buildResumeExportErrorResponse(c: Context, error: unknown) {
  if (error instanceof DataNotFoundError) {
    return c.json({ success: false, error: error.message }, 404);
  }

  logger.error("Failed to export resumes", error, { route: "resumes/export" });
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ success: false, error: message }, 500);
}

function buildReviewPacketErrorResponse(c: Context, error: unknown) {
  if (error instanceof DataNotFoundError) {
    return c.json({ success: false as const, error: error.message }, 404);
  }

  logger.error("Review packet flow failed", error, { route: "review-packets" });
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ success: false as const, error: message }, 500);
}

function getReviewPacketRunOrThrow(runId: string, workspaceSlug: string): StoredReviewPacketRun {
  const run = reviewPacketStorage.getRun(runId, workspaceSlug);
  if (!run) {
    throw new DataNotFoundError(`Review packet run not found: ${runId}`);
  }
  return run;
}

function markReviewPacketRunFailed(runId: string, workspaceSlug: string, error: unknown): void {
  reviewPacketStorage.markFailed({
    id: runId,
    workspaceSlug,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function saveReviewPacketFile(options: {
  runId: string;
  format: ExportFormat;
  entries: ResumeExportEntry[];
  exportOptions: ReviewPacketExportOptions;
}): Promise<void> {
  const file = await exportService.exportReviewPacket(options.format, options.entries, options.exportOptions);
  await mkdir(getReviewPacketOutputDir(), { recursive: true });
  await writeFile(getReviewPacketFilePath(options.runId, options.format), file.content);
}

async function buildReviewPacketDownloadResponse(run: StoredReviewPacketRun): Promise<Response> {
  const filePath = getReviewPacketFilePath(run.id, run.format);
  let content: Buffer;

  try {
    content = await readFile(filePath);
  } catch {
    throw new DataNotFoundError(`Stored review packet file missing for run: ${run.id}`, {
      suggestion: "Re-export the review packet to recreate the stored file.",
    });
  }

  const contentType = run.format === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv; charset=utf-8";

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${run.packetFilename ?? buildReviewPacketFilename(run.id, run.format)}"`,
      "Content-Length": String(content.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

export function toReviewPacketStatusListItem(value: unknown): ReviewPacketStatusListItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const identityKey = toStringValue(value.identityKey);
  const status = toStringValue(value.status);
  if (!identityKey || !status) {
    return null;
  }

  return { identityKey, status };
}

async function buildReviewPacketSummaryPreview(
  run: StoredReviewPacketRun,
  request: ReviewPacketSummaryTemplateRequest
): Promise<{
  run: StoredReviewPacketRun;
  templateId: string;
  content: string;
  data: ReturnType<FeedbackSummaryService["buildSummary"]>;
}> {
  const templateId = request.templateId?.trim() || "review-packet-wechat";
  const statusValues = await callConvexQuery("candidate_status:list", {
    workspaceSlug: run.workspaceSlug,
  });
  const identityKeys = new Set(run.items.map((item) => item.identityKey));
  const statuses = Array.isArray(statusValues)
    ? statusValues
        .map((value) => toReviewPacketStatusListItem(value))
        .filter((value): value is ReviewPacketStatusListItem => value !== null)
        .filter((value) => identityKeys.has(value.identityKey))
    : [];
  const reviewPacketSessionId = buildReviewPacketSessionId(run.id);
  const reviewPacketResumeIds = new Set(run.items.map((item) => item.resumeId));
  const actions = actionStorage
    .getLatestActionsForSession(reviewPacketSessionId)
    .filter((action) => reviewPacketResumeIds.has(action.resumeId));

  const data = feedbackSummaryService.buildSummary({
    run,
    statuses,
    actions,
  });
  const timestamp = formatIsoOffsetInTimezone(new Date(), config.timezone);
  const rendered = notificationTemplateService.render(templateId, {
    ...data,
    timestamp,
  });
  const updatedRun = reviewPacketStorage.updateSummaryStats({
    id: run.id,
    workspaceSlug: run.workspaceSlug,
    stats: feedbackSummaryService.toSummaryStats(data, {
      previewedAt: timestamp,
      sentAt: run.summarySentAt,
      channel: run.summaryChannel,
    }),
    sent: false,
  }) ?? run;

  return {
    run: updatedRun,
    templateId,
    content: rendered.markdown,
    data,
  };
}

async function parseResumeExportDownloadRequest(c: Context) {
  const formData = await c.req.formData();
  const parsedForm = ResumeExportFormSchema.parse({
    payload: formData.get("payload"),
  });
  return ResumeExportCanonicalRequestSchema.parse(JSON.parse(parsedForm.payload));
}

// --- Schemas used only by export/packet routes ---

const LearningFeedbackRequestSchema = z.object({
  observation: z.string().trim().min(1),
  action: z.enum(["shortlist", "reject"]).optional(),
  resumeId: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  autoReingestLimit: z.number().int().min(1).max(1000).optional(),
});

const LearningFeedbackResponseSchema = z.object({
  success: z.literal(true),
  entry: z.string(),
  bumpedVersion: z.number().optional(),
  reingest: z.object({
    scheduled: z.number().int(),
    batches: z.number().int(),
    currentVersion: z.number().int(),
    hasMore: z.boolean(),
  }).optional(),
});

const ResumeExportFormSchema = z.object({
  payload: z.string().min(1),
});

// --- Route definitions ---

const exportResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/export",
  tags: ["resumes"],
  summary: "Export resumes as CSV or XLSX",
  description: "Exports selected resumes using a canonical resumeId-based request.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResumeExportCanonicalRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "text/csv": {
          schema: ResumeExportBinaryResponseSchema,
        },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
          schema: ResumeExportBinaryResponseSchema,
        },
      },
      description: "Exported CSV or XLSX file",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Sample or selected resumes could not be resolved",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Export failed",
    },
  },
});

const ReviewPacketPathParamSchema = z.object({
  runId: z.string().min(1).openapi({
    param: { name: "runId", in: "path" },
    example: "review-packet-123",
  }),
});

const ReviewPacketRunsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      example: 20,
    }),
});

const trackedReviewPacketExportRoute = createRoute({
  method: "post",
  path: "/api/resumes/review-packets/export",
  tags: ["resumes"],
  summary: "Create a tracked review packet export run",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ReviewPacketExportRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ReviewPacketTrackedExportResponseSchema,
        },
      },
      description: "Tracked review packet export metadata",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Selected resumes could not be resolved",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Tracked export failed",
    },
  },
});

const listReviewPacketRunsRoute = createRoute({
  method: "get",
  path: "/api/resumes/review-packets",
  tags: ["resumes"],
  summary: "List tracked review packet runs",
  request: {
    query: ReviewPacketRunsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ReviewPacketRunsResponseSchema,
        },
      },
      description: "Review packet runs",
    },
  },
});

const getReviewPacketRunRoute = createRoute({
  method: "get",
  path: "/api/resumes/review-packets/{runId}",
  tags: ["resumes"],
  summary: "Get tracked review packet run metadata",
  request: {
    params: ReviewPacketPathParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            run: ReviewPacketRunSchema,
          }),
        },
      },
      description: "Review packet run",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run not found",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run lookup failed",
    },
  },
});

const downloadReviewPacketRoute = createRoute({
  method: "get",
  path: "/api/resumes/review-packets/{runId}/download",
  tags: ["resumes"],
  summary: "Download a tracked review packet file",
  request: {
    params: ReviewPacketPathParamSchema,
  },
  responses: {
    200: {
      content: {
        "text/csv": {
          schema: ResumeExportBinaryResponseSchema,
        },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
          schema: ResumeExportBinaryResponseSchema,
        },
      },
      description: "Review packet file",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run not found",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Download failed",
    },
  },
});

const importReviewPacketFeedbackRoute = createRoute({
  method: "post",
  path: "/api/resumes/review-packets/{runId}/feedback-import",
  tags: ["resumes"],
  summary: "Import reviewed CSV/XLSX feedback for a tracked review packet",
  request: {
    params: ReviewPacketPathParamSchema,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: ReviewPacketFeedbackImportRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ReviewPacketFeedbackImportResponseSchema,
        },
      },
      description: "Feedback import result",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run not found",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Invalid import payload",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Feedback import failed",
    },
  },
});

const previewReviewPacketSummaryRoute = createRoute({
  method: "post",
  path: "/api/resumes/review-packets/{runId}/summary-preview",
  tags: ["resumes"],
  summary: "Preview the WeChat summary for a tracked review packet",
  request: {
    params: ReviewPacketPathParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ReviewPacketSummaryPreviewRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ReviewPacketSummaryPreviewResponseSchema,
        },
      },
      description: "Summary preview",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run not found",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Summary preview failed",
    },
  },
});

const sendReviewPacketSummaryRoute = createRoute({
  method: "post",
  path: "/api/resumes/review-packets/{runId}/summary-send",
  tags: ["resumes"],
  summary: "Send the WeChat summary for a tracked review packet",
  request: {
    params: ReviewPacketPathParamSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ReviewPacketSummarySendRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ReviewPacketSummarySendResponseSchema,
        },
      },
      description: "Summary send result",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Run not found",
    },
    500: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Summary send failed",
    },
  },
});

// --- Handler implementations ---

app.openapi(exportResumesRoute, async (c) => {
  try {
    const request = c.req.valid("json");
    return await buildResumeExportResponse(request, c.var.workspaceSlug);
  } catch (error) {
    return buildResumeExportErrorResponse(c, error);
  }
});

app.openapi(trackedReviewPacketExportRoute, async (c) => {
  try {
    const request = c.req.valid("json");
    const resolved = await resolveReviewPacketExportRequest(request);
    const runId = randomUUID();
    const exportedAt = formatIsoOffsetInTimezone(new Date(), config.timezone);

    await saveReviewPacketFile({
      runId,
      format: resolved.format,
      entries: resolved.entries,
      exportOptions: {
        packetRunId: runId,
        exportedAt,
        batchMeta: resolved.batchMeta,
        industryDbV2Stats: resolved.industryDbV2Stats,
        debug: resolved.debug,
      },
    });

    const run = reviewPacketStorage.createRun({
      id: runId,
      workspaceSlug: c.var.workspaceSlug,
      source: resolved.source,
      sampleName: resolved.sampleName,
      sessionId: resolved.sessionId,
      jobDescriptionId: resolved.jobDescriptionId,
      format: resolved.format,
      totalCount: resolved.entries.length,
      packetFilename: buildReviewPacketFilename(runId, resolved.format),
      exportedAt,
      items: resolved.items,
    });

    return c.json({
      success: true as const,
      run: toPublicReviewPacketRun(run),
      downloadPath: buildReviewPacketDownloadPath(run.id),
    }, 200);
  } catch (error) {
    return buildReviewPacketErrorResponse(c, error);
  }
});

app.openapi(listReviewPacketRunsRoute, (c) => {
  const { limit } = c.req.valid("query");
  const runs = reviewPacketStorage
    .listRuns(c.var.workspaceSlug, limit ?? 20)
    .map((run) => toPublicReviewPacketRun(run));

  return c.json({
    success: true as const,
    items: runs,
  }, 200);
});

app.openapi(getReviewPacketRunRoute, (c) => {
  try {
    const { runId } = c.req.valid("param");
    const run = getReviewPacketRunOrThrow(runId, c.var.workspaceSlug);
    return c.json({
      success: true as const,
      run: toPublicReviewPacketRun(run),
    }, 200);
  } catch (error) {
    return buildReviewPacketErrorResponse(c, error);
  }
});

app.openapi(downloadReviewPacketRoute, async (c) => {
  const { runId } = c.req.valid("param");
  try {
    const run = getReviewPacketRunOrThrow(runId, c.var.workspaceSlug);
    return await buildReviewPacketDownloadResponse(run);
  } catch (error) {
    markReviewPacketRunFailed(runId, c.var.workspaceSlug, error);
    return buildReviewPacketErrorResponse(c, error);
  }
});

app.openapi(importReviewPacketFeedbackRoute, async (c) => {
  const { runId } = c.req.valid("param");
  try {
    const run = getReviewPacketRunOrThrow(runId, c.var.workspaceSlug);
    const formData = await c.req.formData();
    const parsedForm = ReviewPacketFeedbackImportFormSchema.safeParse({
      file: formData.get("file"),
      updatedBy: formData.get("updatedBy") ?? undefined,
    });

    if (!parsedForm.success) {
      return c.json({ success: false as const, error: "Expected one CSV or XLSX file" }, 400);
    }

    const file = parsedForm.data.file;
    const buffer = Buffer.from(await file.arrayBuffer());
    const imported = await feedbackImportService.importFeedback({
      run,
      fileName: file.name,
      buffer,
      updatedBy: parsedForm.data.updatedBy,
      callbacks: {
        upsertCandidateStatus: async (params) => {
          await callConvexMutation("candidate_status:upsert", {
            workspaceSlug: c.var.workspaceSlug,
            identityKey: params.identityKey,
            status: params.status,
            notes: params.notes,
            updatedBy: params.updatedBy,
            writeSecret: config.auth.convexWriteSecret,
          });
        },
        saveAction: async (params) => {
          actionStorage.saveAction({
            sessionId: buildReviewPacketSessionId(run.id),
            resumeId: params.resumeId,
            actionType: params.actionType,
            actionData: {
              ...params.actionData,
              workspaceSlug: c.var.workspaceSlug,
            },
          });
        },
      },
    });

    const updatedRun = reviewPacketStorage.recordFeedbackImport({
      id: run.id,
      workspaceSlug: c.var.workspaceSlug,
      stats: imported.stats,
    });
    if (!updatedRun) {
      throw new DataNotFoundError(`Review packet run not found after import: ${run.id}`);
    }

    return c.json({
      success: true as const,
      run: toPublicReviewPacketRun(updatedRun),
      summary: imported.summary,
      warnings: imported.warnings,
    }, 200);
  } catch (error) {
    markReviewPacketRunFailed(runId, c.var.workspaceSlug, error);
    return buildReviewPacketErrorResponse(c, error);
  }
});

app.openapi(previewReviewPacketSummaryRoute, async (c) => {
  try {
    const { runId } = c.req.valid("param");
    const request = c.req.valid("json");
    const run = getReviewPacketRunOrThrow(runId, c.var.workspaceSlug);
    const preview = await buildReviewPacketSummaryPreview(run, request);

    return c.json({
      success: true as const,
      run: toPublicReviewPacketRun(preview.run),
      channel: "wechat_work" as const,
      templateId: preview.templateId,
      content: preview.content,
      data: preview.data,
    }, 200);
  } catch (error) {
    return buildReviewPacketErrorResponse(c, error);
  }
});

app.openapi(sendReviewPacketSummaryRoute, async (c) => {
  try {
    const { runId } = c.req.valid("param");
    const request = c.req.valid("json");
    const run = getReviewPacketRunOrThrow(runId, c.var.workspaceSlug);
    const preview = await buildReviewPacketSummaryPreview(run, {
      templateId: request.templateId,
    });
    const delivery = await notificationService.sendWechatWorkMarkdown({
      webhookUrl: request.webhookUrl,
      content: preview.content,
    });
    const sentAt = formatIsoOffsetInTimezone(new Date(), config.timezone);
    const updatedRun = reviewPacketStorage.updateSummaryStats({
      id: run.id,
      workspaceSlug: c.var.workspaceSlug,
      stats: feedbackSummaryService.toSummaryStats(preview.data, {
        previewedAt: preview.run.stats?.summary?.previewedAt,
        sentAt,
        channel: "wechat_work",
      }),
      sent: true,
    }) ?? preview.run;

    return c.json({
      success: true as const,
      run: toPublicReviewPacketRun(updatedRun),
      channel: "wechat_work" as const,
      templateId: preview.templateId,
      delivery,
    }, 200);
  } catch (error) {
    return buildReviewPacketErrorResponse(c, error);
  }
});

const exportDownloadRoute = createRoute({
  method: "post",
  path: "/api/resumes/export/download",
  tags: ["resumes"],
  summary: "Export resumes via form-data download",
  request: {
    body: {
      content: { "multipart/form-data": { schema: ResumeExportFormSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "text/csv": { schema: ResumeExportBinaryResponseSchema },
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: ResumeExportBinaryResponseSchema },
      },
      description: "Exported file",
    },
    404: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Resumes not found" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Export failed" },
  },
});
app.openapi(exportDownloadRoute, async (c) => {
  try {
    const request = await parseResumeExportDownloadRequest(c);
    return await buildResumeExportResponse(request, c.var.workspaceSlug);
  } catch (error) {
    return buildResumeExportErrorResponse(c, error);
  }
});

const learningFeedbackRoute = createRoute({
  method: "post",
  path: "/api/resumes/learning-feedback",
  tags: ["resumes"],
  summary: "Append a learning log entry from candidate review feedback",
  request: {
    body: { content: { "application/json": { schema: LearningFeedbackRequestSchema } } },
  },
  responses: {
    200: { content: { "application/json": { schema: LearningFeedbackResponseSchema } }, description: "Feedback logged" },
    400: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Invalid request" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(learningFeedbackRoute, async (c) => {
  const { observation, action, resumeId, query, autoReingestLimit } = c.req.valid("json");

  try {
    const learningEntry = await workspaceConfigService.appendLearningLogEntry(
      c.var.workspaceSlug,
      observation
    );
    const entry = `- ${learningEntry.date}: ${learningEntry.observation}`;
    if (action && resumeId) {
      searchEventLogger.logCandidateAction({
        resumeId,
        action,
        query,
      });
    }

    let bumpedVersion: number | undefined;
    let reingest:
      | {
        scheduled: number;
        batches: number;
        currentVersion: number;
        hasMore: boolean;
      }
      | undefined;

    if (shouldTriggerSkillsReingest(observation)) {
      bumpedVersion = skillsKnowledgeService.getVersion();
      reingest = await triggerReingestStaleSkillsVersion(autoReingestLimit ?? 200);
    }

    return c.json({ success: true as const, entry, bumpedVersion, reingest }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

export default app;
