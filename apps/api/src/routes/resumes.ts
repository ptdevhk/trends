import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeDetailPathParamSchema,
  ResumeDetailResponseSchema,
  ResumeDiagnosticsQuerySchema,
  ResumeDiagnosticsResponseSchema,
  ResumeKeywordExpansionQuerySchema,
  ResumeKeywordExpansionResponseSchema,
  ResumeSamplesResponseSchema,
  ResumeBackupRequestSchema,
  ResumeImportRequestSchema,
  ResumeManualImportErrorSchema,
  ResumeManualImportFormSchema,
  ResumeManualImportRequestSchema,
  ResumeManualImportResponseSchema,
  ResumeSubmitSummarySchema,
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
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
  MatchRunsResponseSchema,
  MatchRunsQuerySchema,
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  AnalysisTasksResponseSchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService, parseExperienceYears, type ResumeFilters } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { resolveConvexUrl } from "../services/resume-import-service.js";
import { AIMatchingService, type MatchingRequest, type MatchingResult } from "../services/ai-matching.js";
import {
  MatchStorage,
  type MatchRunMode,
  type StoredMatch,
  type StoredMatchRun,
} from "../services/match-storage.js";
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import {
  RuleScoringService,
  type BrandContext,
  type BrandHit,
  type BrandRole,
  type RoleSignalSummary,
  type RuleScoringContext,
  type RuleScoringResult,
} from "../services/rule-scoring.js";
import { resolveResumeId } from "../services/resume-id.js";
import { IngestComputeService } from "../services/ingest-compute-service.js";
import {
  buildLatestWorkHistoryEvidence,
  buildWorkHistoryEntryText,
  formatKeywordQuery,
  formatLocationHierarchySearchText,
  normalizeKeywordPhrases,
  normalizeWorkHistoryEntry,
  parseKeywordQuery,
  selectLatestWorkHistory,
} from "@trends/shared";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import {
  ExportService,
  type ExportFormat,
  type ExportBatchMeta,
  type ReviewPacketExportOptions,
  type ResumeExportEntry,
} from "../services/export-service.js";
import { ActionStorage } from "../services/action-storage.js";
import { FeedbackImportService, normalizeProfileIdentityKey } from "../services/feedback-import-service.js";
import { FeedbackSummaryService } from "../services/feedback-summary-service.js";
import {
  computeEffectiveIndustryDbV2Raw,
  computeBatchStats,
  type IndustryDbV2BatchStats,
} from "../services/industry-db-batch-stats.js";
import { submitResumeImport } from "../services/resume-import-service.js";
import { getManualResumeImportMaxUploadBytes, importManualResumes } from "../services/manual-resume-import-service.js";
import { notificationService } from "../services/notification-service.js";
import { notificationTemplateService } from "../services/notification-template-service.js";
import {
  ReviewPacketStorage,
  type ReviewPacketItemSnapshot,
  type StoredReviewPacketRun,
} from "../services/review-packet-storage.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { BrandDisplayResolver } from "../services/brand-display-resolver.js";

import { buildKeywordAnalysisId, getCurrentResumeAiPromptVersion, resolveResumeAnalysisSourceKey, resolveResumeDiagnosticsSourceKey } from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const ingestComputeService = new IngestComputeService(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
const companyPatterns = skillsKnowledgeService.getCompanyPatterns();
const searchEventLogger = new SearchEventLogger(config.projectRoot);
const actionStorage = new ActionStorage(config.projectRoot);
const exportService = new ExportService(
  new BrandDisplayResolver(config.projectRoot, companyPatterns),
  companyPatterns
);
const reviewPacketStorage = new ReviewPacketStorage(config.projectRoot);
const feedbackImportService = new FeedbackImportService();
const feedbackSummaryService = new FeedbackSummaryService();

const DEFAULT_AI_TOP_N = 20;
const DEFAULT_CONVEX_RESUME_PAGE_SIZE = 50;
const MAX_SAFE_CONVEX_POST_FILTER_SCAN = 250;
const MAX_SAFE_CONVEX_POST_FILTER_LIMIT = 2000;
const MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE = 250;

type MatchMode = "rules_only" | "hybrid" | "ai_only";

const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const ClearMatchesResponseSchema = z.object({
  success: z.literal(true),
  deleted: z.number().int(),
  jobDescriptionId: z.string().optional(),
});

const RescoreRequestSchema = z.object({
  sessionId: z.string().optional(),
  sample: z.string().optional(),
  source: z.enum(["sample", "convex"]).default("sample"),
  persist: z.boolean().default(true),
  jobDescriptionId: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  location: z.string().optional(),
  resumeIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

const MatchRescoreResponseSchema = MatchResponseSchema;
const LearningFeedbackRequestSchema = z.object({
  observation: z.string().trim().min(1),
  action: z.enum(["shortlist", "reject"]).optional(),
  resumeId: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  autoReingestLimit: z.number().int().min(1).max(1000).optional(),
});
const TriggerReingestRequestSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});
const ResumeImportErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const ResumeResetResponseSchema = z.object({
  success: z.literal(true),
  count: z.number().int(),
  partial: z.boolean(),
  deleted: z.record(z.number().int()),
});

const ResetCandidateActionsRequestSchema = z.object({
  workspaceSlug: z.string().optional(),
});

const ResetCandidateActionsResponseSchema = z.object({
  success: z.literal(true),
  deleted: z.number().int(),
});

const resetCandidateActionsRoute = createRoute({
  method: "post",
  path: "/api/resumes/candidate-actions/reset",
  tags: ["resumes"],
  summary: "Reset candidate actions for a workspace",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ResetCandidateActionsRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResetCandidateActionsResponseSchema,
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

app.openapi(resetCandidateActionsRoute, async (c) => {
  if (c.var.accessLevel !== "admin") {
    return c.json({ success: false as const, error: "Admin access required" }, 403);
  }

  try {
    const request = c.req.valid("json");
    const workspaceSlug = request.workspaceSlug || c.var.workspaceSlug;
    const deleted = actionStorage.clearActionsForWorkspace(workspaceSlug, true);
    return c.json(ResetCandidateActionsResponseSchema.parse({ success: true, deleted }), 200);
  } catch (error) {
    console.error("Failed to reset candidate actions", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

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
  wouldDelete: z.record(z.number().int()).optional(),
  partial: z.boolean().optional(),
  deleted: z.record(z.number().int()).optional(),
});

type ResumeExportCanonicalRequest = z.infer<typeof ResumeExportCanonicalRequestSchema>;
type ResumeExportRequest = ResumeExportCanonicalRequest;
type ReviewPacketExportRequest = z.infer<typeof ReviewPacketExportRequestSchema>;
type ResumeExportEntryContext = ResumeExportCanonicalRequest["entries"][number];
type ReviewPacketSummaryTemplateRequest = z.infer<typeof ReviewPacketSummaryPreviewRequestSchema>;
type ExportResumePayload = ResumeExportEntry["resume"];
type ResumeExportEntryFields = Omit<ResumeExportEntry, "key" | "resume">;
type ResumeSource = "sample" | "convex";
type ResumeKeywordExpansion = ReturnType<ResumeService["expandSearchQuery"]>;
type ResumeSearchProvenance = {
  term: string;
  source: "searchText" | "industryTags" | "companyHits" | "synonymHits";
  expandedFrom?: string;
};
type PreparedResumeCandidate = {
  resume: ResumeItem;
  resumeId: string;
  indexData: ResumeIndex;
  primaryRuleScore?: number;
  provenance?: ResumeSearchProvenance[];
  brandHits: BrandHit[];
  companyHits: string[];
  roleSignals: RoleSignalSummary[];
};
type ResumeMatchContext = {
  score: number;
  recommendation: MatchingResult["recommendation"];
};
type ResumeMatchContextEntry = ResumeMatchContext & {
  resumeId: string;
};
type ExactKeywordScanCandidate = {
  candidate: PreparedResumeCandidate;
  identityKey: string;
  crawledAt: number;
  jobRuleScore: number;
  primaryRuleScore: number;
  provenance: ResumeSearchProvenance[];
};
type SortableKeywordMatchEntry = {
  candidate: PreparedResumeCandidate;
  match: ResumeMatchContext | undefined;
  sortMetadata?: ExactKeywordScanCandidate;
};
type ReviewPacketResolvedRecord = {
  resumeId: string;
  resume: ExportResumePayload;
  identityKey: string;
  profileUrl?: string;
  name?: string;
  source?: string;
};

function stripFrontMatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return content;
  const endIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (endIndex === -1) return content;
  return lines.slice(endIndex + 2).join("\n");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(content: string, headings: string[]): string | undefined {
  const lines = stripFrontMatter(content).split("\n");
  let startIndex = -1;
  let endIndex = lines.length;
  const headingRegex = new RegExp(
    `^##\\s+(${headings.map((h) => escapeRegex(h)).join("|")})\\s*$`,
    "i"
  );

  for (let i = 0; i < lines.length; i += 1) {
    if (headingRegex.test(lines[i].trim())) {
      startIndex = i + 1;
      for (let j = startIndex; j < lines.length; j += 1) {
        if (/^##\s+/.test(lines[j].trim())) {
          endIndex = j;
          break;
        }
      }
      break;
    }
  }

  if (startIndex === -1) return undefined;
  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function extractSkills(...texts: (string | undefined)[]): string[] | undefined {
  const allParts: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const parts = text
      .split(/[，,、/\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    allParts.push(...parts);
  }
  if (allParts.length === 0) return undefined;
  return Array.from(new Set(allParts)).slice(0, 20);
}

function getLatestWorkHistory(workHistory: ResumeItem["workHistory"] | undefined): ResumeItem["workHistory"] {
  return selectLatestWorkHistory(workHistory ?? []);
}

function extractCompanies(workHistory: ResumeItem["workHistory"]): string[] | undefined {
  if (!workHistory?.length) return undefined;
  const entries = workHistory
    .map((item) => {
      const normalized = normalizeWorkHistoryEntry(item);
      return normalized?.companyName || buildWorkHistoryEntryText(item);
    })
    .filter(Boolean)
    .map((raw) => raw.replace(/^\d[\d\-~至今()年月日\s]*?/g, "").trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  return Array.from(new Set(entries)).slice(0, 8);
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!Array.isArray(keywords)) return [];
  return normalizeKeywordPhrases(keywords).map((item) => item.toLowerCase());
}

function sourceMappingEntries(mapping: Record<string, string> | undefined): Array<{ term: string; expandedFrom: string }> {
  return Object.entries(mapping ?? {}).map(([term, expandedFrom]) => ({ term, expandedFrom }));
}

function normalizeMatchRecommendations(
  values: string[] | undefined
): MatchingResult["recommendation"][] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const allowed = new Set<MatchingResult["recommendation"]>([
    "strong_match",
    "match",
    "potential",
    "no_match",
  ]);
  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter((value): value is MatchingResult["recommendation"] => allowed.has(value as MatchingResult["recommendation"])))
  );
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => toStringValue(item))
    .filter(Boolean);
}

function toBrandRole(value: unknown): BrandRole | null {
  if (value === "employer" || value === "equipment" || value === "both") {
    return value;
  }
  return null;
}

function toBrandContext(value: unknown): BrandContext | null {
  if (
    value === "employer"
    || value === "equipment"
    || value === "sales"
    || value === "technical"
    || value === "general"
  ) {
    return value;
  }
  return null;
}

function parseBrandHits(value: unknown): BrandHit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const brand = toStringValue(item.brand);
    const role = toBrandRole(item.role);
    const source = item.source === "workHistory" || item.source === "selfIntro" || item.source === "jobIntention"
      ? item.source
      : null;
    const context = toBrandContext(item.context);

    if (!brand || !role || !source || !context) {
      return [];
    }

    return [{
      brand,
      role,
      source,
      context,
    }];
  });
}

function parseRoleSignals(value: unknown): RoleSignalSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const type = toStringValue(item.type);
    const years = toOptionalNumber(item.years);
    if (!type || years === undefined) {
      return [];
    }

    const matchedSignals = toStringArray(item.matchedSignals);
    const verifyIn = item.verifyIn === "searchText" ? "searchText" : "workHistory";
    const signalCount = toOptionalNumber(item.signalCount) ?? matchedSignals.length;
    const occurrences = toOptionalNumber(item.occurrences) ?? matchedSignals.length;
    const industryVerifiedYears = toOptionalNumber(item.industryVerifiedYears) ?? 0;
    const roleRelevantYears = toOptionalNumber(item.roleRelevantYears);
    const industryVerifiedRelevantYears = toOptionalNumber(item.industryVerifiedRelevantYears);
    const matchedWorkEntries = Array.isArray(item.matchedWorkEntries)
      ? item.matchedWorkEntries.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const entryYears = toOptionalNumber(entry.years);
          if (entryYears === undefined) {
            return [];
          }
          return [{
            companyName: toStringValue(entry.companyName) || undefined,
            jobTitle: toStringValue(entry.jobTitle) || undefined,
            years: entryYears,
            industryVerified: entry.industryVerified === true,
            matchedSignals: toStringArray(entry.matchedSignals),
          }];
        })
      : undefined;

    return [{
      type,
      matchedSignals,
      signalCount,
      occurrences,
      years,
      industryVerifiedYears,
      ...(roleRelevantYears === undefined ? {} : { roleRelevantYears }),
      ...(industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears }),
      ...(matchedWorkEntries && matchedWorkEntries.length > 0 ? { matchedWorkEntries } : {}),
      verifyIn,
    }];
  });
}

function buildResumeIngestData(value: unknown): ResumeItem["ingestData"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const industryTags = toStringArray(value.industryTags);
  const companyHits = toStringArray(value.companyHits);
  const brandHits = parseBrandHits(value.brandHits);
  const roleSignals = parseRoleSignals(value.roleSignals);
  const industryDbV2Raw = toOptionalNumber(value.industryDbV2Raw);

  if (
    industryTags.length === 0
    && companyHits.length === 0
    && brandHits.length === 0
    && roleSignals.length === 0
    && industryDbV2Raw === undefined
  ) {
    return undefined;
  }

  return {
    ...(industryTags.length > 0 ? { industryTags } : {}),
    ...(companyHits.length > 0 ? { companyHits } : {}),
    ...(brandHits.length > 0 ? { brandHits } : {}),
    ...(roleSignals.length > 0 ? { roleSignals } : {}),
    ...(industryDbV2Raw === undefined ? {} : { industryDbV2Raw }),
  };
}

function parseConvexProvenance(value: unknown): ResumeSearchProvenance[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const provenance = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const term = toStringValue(item.term);
    const source: ResumeSearchProvenance["source"] | null = item.source === "searchText"
      || item.source === "industryTags"
      || item.source === "companyHits"
      || item.source === "synonymHits"
      ? item.source
      : null;
    const expandedFrom = toStringValue(item.expandedFrom) || undefined;
    if (!term || !source) {
      return [];
    }
    return [{ term, source, ...(expandedFrom ? { expandedFrom } : {}) }];
  });

  return provenance.length > 0 ? provenance : undefined;
}

function toResumeItemFromRecord(record: Record<string, unknown>, source?: string): ResumeItem {
  const profileUrl = toStringValue(
    record.profileUrl ?? record.profile_url ?? record.profileURL ?? record.url
  );
  const workHistory = Array.isArray(record.workHistory)
    ? record.workHistory
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const projectExperience = Array.isArray(record.projectExperience)
    ? record.projectExperience
      .map((entry) => normalizeWorkHistoryEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];
  const profileEducation = Array.isArray(record.profileEducation)
    ? record.profileEducation
      .map((entry) => {
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
  };
}

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

function normalizeResumeDiagnosticsSourceKeys(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const resolved = Array.from(new Set(
    values
      .map((value) => resolveResumeDiagnosticsSourceKey({ sourceKey: value.trim(), source: value.trim() }))
  ));

  return resolved.length > 0 ? resolved : undefined;
}

function prepareResumeCandidate(params: {
  resume: ResumeItem;
  resumeId: string;
  indexData?: ResumeIndex;
  primaryRuleScore?: number;
  provenance?: ResumeSearchProvenance[];
  ingestData?: unknown;
}): PreparedResumeCandidate {
  const rawIngestData = params.ingestData ?? params.resume.ingestData;
  const parsedIngestData = params.resume.ingestData ?? buildResumeIngestData(params.ingestData);
  const baseResume = params.resume.resumeId
    ? params.resume
    : {
        ...params.resume,
        resumeId: params.resumeId,
      };
  const resume = parsedIngestData
    ? {
        ...baseResume,
        ingestData: parsedIngestData,
      }
    : baseResume;
  return {
    resume,
    resumeId: params.resumeId,
    indexData: params.indexData ?? createFallbackIndex(resume, params.resumeId),
    primaryRuleScore: params.primaryRuleScore,
    provenance: params.provenance,
    brandHits: parseBrandHits(isRecord(rawIngestData) ? rawIngestData.brandHits : undefined),
    companyHits: toStringArray(isRecord(rawIngestData) ? rawIngestData.companyHits : undefined),
    roleSignals: parseRoleSignals(isRecord(rawIngestData) ? rawIngestData.roleSignals : undefined),
  };
}

async function callConvexQuery(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex query failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex query failed for ${pathName}`);
  }

  return payload.value;
}

type ConvexPaginatedQueryPage = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

function isConvexPaginatedQueryPage(value: unknown): value is ConvexPaginatedQueryPage {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.page)
    && typeof value.continueCursor === "string"
    && typeof value.isDone === "boolean";
}

async function callConvexMutation(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex mutation failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex mutation failed for ${pathName}`);
  }

  return payload.value;
}

async function callConvexAction(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex action failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex action failed for ${pathName}`);
  }

  return payload.value;
}

function buildKeywordExpansionSummary(expansion: ResumeKeywordExpansion): {
  expandedTo?: string[];
  mode?: "AND" | "OR";
  keywordGroups?: Array<{ original: string; variants: string[] }>;
  sourceMapping?: Record<string, string>;
} {
  return {
    expandedTo: expansion?.flatTerms,
    mode: expansion?.mode,
    keywordGroups: expansion?.groups,
    sourceMapping: expansion?.sourceMapping,
  };
}

function buildMatchQueryMetadata(params: {
  source: ResumeSource;
  persisted: boolean;
  keywordExpansion?: ResumeKeywordExpansion;
  context: RuleScoringContext;
}) {
  const requiredRoles = params.context.requiredRoles.map((role) => ({
    type: role.type,
    signals: role.signals,
    verifyIn: role.verifyIn,
    ...(typeof role.minYears === "number" ? { minYears: role.minYears } : {}),
  }));

  return {
    source: params.source,
    persisted: params.persisted,
    keywordGroups: params.keywordExpansion?.groups,
    expandedTo: params.keywordExpansion?.flatTerms,
    sourceMapping: params.keywordExpansion?.sourceMapping,
    inferredRequiredRoles: requiredRoles,
  };
}

function scorePreparedCandidates(
  prepared: PreparedResumeCandidate[],
  context: RuleScoringContext
): Array<{ resumeId: string; result: RuleScoringResult; candidate: PreparedResumeCandidate }> {
  return prepared.map((candidate) => ({
    resumeId: candidate.resumeId,
    result: ruleScoringService.scoreResume(
      candidate.indexData,
      context,
      candidate.brandHits,
      candidate.roleSignals
    ),
    candidate,
  }));
}

function buildRuleMatchResponseEntry(params: {
  candidate: PreparedResumeCandidate;
  result: RuleScoringResult;
  jobDescriptionId: string;
  sessionId?: string;
}): z.infer<typeof MatchResponseSchema>["results"][number] {
  const matchingResult = ruleScoringService.toMatchingResult(params.result);
  return {
    resumeId: params.candidate.resumeId,
    jobDescriptionId: params.jobDescriptionId,
    score: matchingResult.score,
    recommendation: matchingResult.recommendation,
    highlights: matchingResult.highlights,
    concerns: matchingResult.concerns,
    summary: matchingResult.summary,
    breakdown: matchingResult.breakdown,
    scoreSource: matchingResult.scoreSource,
    matchedAt: new Date().toISOString(),
    sessionId: params.sessionId,
    debug: {
      primaryRuleScore: params.candidate.primaryRuleScore,
      provenance: params.candidate.provenance,
      roleSignals: params.candidate.roleSignals,
      companyHits: params.candidate.companyHits,
      brandHits: params.candidate.brandHits,
    },
  };
}

function prepareSampleCandidates(params: {
  items: ResumeItem[];
  indexMap: Map<string, ResumeIndex>;
  resumeIds?: string[];
  limit?: number;
}): PreparedResumeCandidate[] {
  const resumeIdFilter = params.resumeIds?.length
    ? new Set(params.resumeIds)
    : null;
  const selected = resumeIdFilter
    ? params.items
      .map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }))
      .filter((item) => resumeIdFilter.has(item.resumeId))
    : params.items.map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }));
  const limited = typeof params.limit === "number" ? selected.slice(0, params.limit) : selected;

  return limited.map((item) => prepareResumeCandidate({
    resume: item.resume,
    resumeId: item.resumeId,
    indexData: params.indexMap.get(item.resumeId) ?? createFallbackIndex(item.resume, item.resumeId),
  }));
}

async function prepareConvexCandidates(params: {
  resumeIds?: string[];
  keywords?: string[];
  keywordQuery?: string;
  location?: string;
  limit?: number;
  offset?: number;
  sortBy?: "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  filters?: {
    minExperience?: number;
    maxExperience?: number;
    education?: string[];
    skills?: string[];
    requiredKeywords?: string[];
    locations?: string[];
    minSalary?: number;
    maxSalary?: number;
    minRoleYears?: number;
    roleFilterType?: string;
    minAge?: number;
    maxAge?: number;
    sources?: string[];
  };
  jobDescriptionId?: string;
  paged?: boolean;
}): Promise<{
  prepared: PreparedResumeCandidate[];
  keywordExpansion?: ResumeKeywordExpansion;
  total?: number;
  usedServerSideFilters?: boolean;
}> {
  const resumeIds = Array.from(new Set((params.resumeIds ?? []).map((resumeId) => resumeId.trim()).filter(Boolean)));
  if (resumeIds.length > 0) {
    const value = await callConvexQuery("resumes:getByIdsForExport", { resumeIds });
    if (!Array.isArray(value)) {
      throw new Error("Invalid resume response from Convex");
    }

    const byId = new Map<string, PreparedResumeCandidate>();
    value.forEach((item) => {
      if (!isRecord(item)) {
        return;
      }
      const resumeId = toStringValue(item.resumeId);
      const resumeRecord = isRecord(item.resume) ? item.resume : null;
      if (!resumeId || !resumeRecord) {
        return;
      }
      const resume = toResumeItemFromRecord(resumeRecord);
      byId.set(resumeId, prepareResumeCandidate({
        resume,
        resumeId,
        ingestData: resumeRecord.ingestData,
      }));
    });

    const prepared = resumeIds
      .map((resumeId) => byId.get(resumeId))
      .filter((item): item is PreparedResumeCandidate => Boolean(item));
    const limited = typeof params.limit === "number" ? prepared.slice(0, params.limit) : prepared;
    return { prepared: limited };
  }

  const normalizedKeywords = normalizeKeywords(params.keywords);
  const keywordQuery = params.keywordQuery?.trim() || undefined;
  if (normalizedKeywords.length > 0 || keywordQuery) {
    const canonicalKeywordQuery = keywordQuery ?? formatKeywordQuery(normalizedKeywords);
    const keywordExpansion = resumeService.expandSearchQuery(canonicalKeywordQuery);

    // Use cursor-based scan pagination for keyword searches to handle
    // AND-mode post-filter attrition (the .take() path in searchWithTagExpansionPage
    // can return 0 results when the anchor search term matches many docs but
    // AND-filtering eliminates most of them before the take limit is reached).
    const hasActiveFilters = params.filters ? hasResumeListFilters(params.filters) : false;
    const useCursorScan = params.paged || hasActiveFilters;

    if (useCursorScan) {
      const allResults: PreparedResumeCandidate[] = [];
      let cursor: string | null = null;
      let totalScanned = 0;

      while (true) {
        const value = await callConvexQuery("resumes:searchWithTagExpansionScanPage", {
          paginationOpts: {
            cursor,
            numItems: MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
          },
          query: canonicalKeywordQuery,
          keywordGroups: keywordExpansion?.groups ?? [],
          mode: keywordExpansion?.mode ?? "AND",
          sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
          ...(params.filters ?? {}),
        });

        if (!isConvexPaginatedQueryPage(value)) {
          throw new Error("Invalid paginated search response from Convex");
        }

        for (const entry of value.page) {
          if (!isRecord(entry) || !isRecord(entry.resume)) {
            continue;
          }
          const resumeRecord = entry.resume;
          const resumeId = toStringValue(resumeRecord._id);
          if (!resumeId) {
            continue;
          }

          allResults.push(prepareResumeCandidate({
            resume: toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source)),
            resumeId,
            primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore),
            provenance: parseConvexProvenance(entry.provenance),
            ingestData: resumeRecord.ingestData,
          }));
        }

        if (value.isDone) {
          break;
        }
        if (!value.continueCursor) {
          break;
        }
        cursor = value.continueCursor;
        totalScanned += value.page?.length ?? 0;
        if (totalScanned >= MAX_SAFE_CONVEX_POST_FILTER_LIMIT) {
          break;
        }
      }

      return {
        prepared: allResults,
        keywordExpansion,
        total: allResults.length,
        usedServerSideFilters: hasActiveFilters,
      };
    }

    // Fallback: non-paged, no-filters path uses the simple search query
    const value = await callConvexQuery("resumes:searchWithTagExpansion", {
      query: canonicalKeywordQuery,
      keywordGroups: keywordExpansion?.groups ?? [],
      mode: keywordExpansion?.mode ?? "AND",
      sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
      limit: params.limit,
      jobDescriptionId: params.jobDescriptionId,
    });

    if (!isRecord(value) || !Array.isArray(value.results)) {
      throw new Error("Invalid resume search response from Convex");
    }

    const prepared = value.results.flatMap((entry) => {
      if (!isRecord(entry) || !isRecord(entry.resume)) {
        return [];
      }
      const resumeRecord = entry.resume;
      const resumeId = toStringValue(resumeRecord._id);
      if (!resumeId) {
        return [];
      }

      return [prepareResumeCandidate({
        resume: toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source)),
        resumeId,
        primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore),
        provenance: parseConvexProvenance(entry.provenance),
        ingestData: resumeRecord.ingestData,
      })];
    });

    return {
      prepared,
      keywordExpansion,
    };
  }

  const value = await callConvexQuery(params.paged ? "resumes:listWithIngestDataPage" : "resumes:listWithIngestData", {
    limit: params.limit,
    ...(params.paged ? { offset: params.offset } : {}),
    ...(params.paged && params.sortBy ? { sortBy: params.sortBy, sortOrder: params.sortOrder } : {}),
    ...(params.paged && params.filters ? params.filters : {}),
    jobDescriptionId: params.jobDescriptionId,
  });
  const items = params.paged && isRecord(value) && Array.isArray(value.results)
    ? value.results
    : value;
  if (!Array.isArray(items)) {
    throw new Error("Invalid resume list response from Convex");
  }

  return {
    prepared: items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const resumeId = toStringValue(item._id);
      if (!resumeId) {
        return [];
      }
      return [prepareResumeCandidate({
        resume: toResumeItemFromRecord(isRecord(item.content) ? item.content : {}, toStringValue(item.source)),
        resumeId,
        primaryRuleScore: toOptionalNumber(item.primaryRuleScore),
        ingestData: item.ingestData,
      })];
    }),
    total: params.paged && isRecord(value) ? (toOptionalNumber(value.total) ?? undefined) : undefined,
  };
}

function filterPreparedCandidatesByResumeFilters(
  prepared: PreparedResumeCandidate[],
  filters: ResumeFilters | undefined,
): PreparedResumeCandidate[] {
  if (!filters) {
    return prepared;
  }

  const allowed = new Set(resumeService.filterResumes(prepared.map((item) => item.resume), filters));
  return prepared.filter((item) => allowed.has(item.resume));
}

function createResumeMatchContextMap(matches: Array<StoredMatch | ResumeMatchContextEntry>): Map<string, ResumeMatchContext> {
  return new Map(matches.map((match) => [
    match.resumeId,
    {
      score: match.score,
      recommendation: match.recommendation,
    },
  ]));
}

function loadResumeMatchContextMap(
  jobDescriptionId: string,
  resumeIds: string[],
): Map<string, ResumeMatchContext> {
  const normalizedResumeIds = Array.from(new Set(
    resumeIds.map((resumeId) => resumeId.trim()).filter(Boolean),
  ));
  const matchMap = new Map<string, ResumeMatchContext>();

  for (let index = 0; index < normalizedResumeIds.length; index += MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE) {
    const batchIds = normalizedResumeIds.slice(index, index + MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE);
    const matches = matchStorage.getMatchesByResumeIds(batchIds, jobDescriptionId);
    for (const match of matches) {
      matchMap.set(match.resumeId, {
        score: match.score,
        recommendation: match.recommendation,
      });
    }
  }

  return matchMap;
}

function dedupeResumeSearchProvenance(items: ResumeSearchProvenance[] | undefined): ResumeSearchProvenance[] {
  const deduped: ResumeSearchProvenance[] = [];
  const seen = new Set<string>();

  for (const item of items ?? []) {
    const key = `${item.source}|${item.term}|${item.expandedFrom ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function resolveProjectedResumeRuleScore(resumeRecord: Record<string, unknown>, jobDescriptionId: string): number {
  const ingestData = isRecord(resumeRecord.ingestData) ? resumeRecord.ingestData : null;
  const ruleScores = ingestData && isRecord(ingestData.ruleScores) ? ingestData.ruleScores : null;
  return ruleScores ? (toOptionalNumber(ruleScores[jobDescriptionId]) ?? 0) : 0;
}

function compareExactKeywordScanCandidates(left: ExactKeywordScanCandidate, right: ExactKeywordScanCandidate): number {
  const ruleScoreDiff = right.jobRuleScore - left.jobRuleScore;
  if (ruleScoreDiff !== 0) {
    return ruleScoreDiff;
  }

  const primaryRuleScoreDiff = right.primaryRuleScore - left.primaryRuleScore;
  if (primaryRuleScoreDiff !== 0) {
    return primaryRuleScoreDiff;
  }

  return right.crawledAt - left.crawledAt;
}

function parseExactKeywordScanCandidate(
  value: unknown,
  jobDescriptionId: string,
): ExactKeywordScanCandidate | null {
  if (!isRecord(value) || !isRecord(value.resume)) {
    return null;
  }

  const resumeRecord = value.resume;
  const resumeId = toStringValue(resumeRecord._id);
  if (!resumeId) {
    return null;
  }

  const provenance = dedupeResumeSearchProvenance(parseConvexProvenance(value.provenance));
  const candidate = prepareResumeCandidate({
    resume: toResumeItemFromRecord(
      isRecord(resumeRecord.content) ? resumeRecord.content : {},
      toStringValue(resumeRecord.source),
    ),
    resumeId,
    primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore),
    provenance,
    ingestData: resumeRecord.ingestData,
  });

  return {
    candidate,
    identityKey: toStringValue(resumeRecord.identityKey) || resumeId,
    crawledAt: toOptionalNumber(resumeRecord.crawledAt) ?? 0,
    jobRuleScore: resolveProjectedResumeRuleScore(resumeRecord, jobDescriptionId),
    primaryRuleScore: toOptionalNumber(resumeRecord.primaryRuleScore) ?? 0,
    provenance,
  };
}

function matchesKeywordIdentityFilters(
  match: ResumeMatchContext | undefined,
  minScore: number | undefined,
  allowedRecommendations: Set<MatchingResult["recommendation"]> | null,
): boolean {
  if (typeof minScore === "number" && (!match || match.score < minScore)) {
    return false;
  }
  if (allowedRecommendations && (!match || !allowedRecommendations.has(match.recommendation))) {
    return false;
  }
  return true;
}

function compareExactKeywordIdentityCandidates(
  left: ExactKeywordScanCandidate,
  right: ExactKeywordScanCandidate,
  matchMap: Map<string, ResumeMatchContext>,
  params: {
    minScore?: number;
    allowedRecommendations: Set<MatchingResult["recommendation"]> | null;
    sortBy?: "score" | "name" | "experience" | "extractedAt";
  },
): number {
  const leftMatch = matchMap.get(left.candidate.resumeId);
  const rightMatch = matchMap.get(right.candidate.resumeId);
  const leftPasses = matchesKeywordIdentityFilters(leftMatch, params.minScore, params.allowedRecommendations);
  const rightPasses = matchesKeywordIdentityFilters(rightMatch, params.minScore, params.allowedRecommendations);

  if (leftPasses !== rightPasses) {
    return leftPasses ? -1 : 1;
  }

  if (params.sortBy === "score" || typeof params.minScore === "number" || params.allowedRecommendations) {
    const scoreDiff = (rightMatch?.score ?? -1) - (leftMatch?.score ?? -1);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
  }

  return compareExactKeywordScanCandidates(left, right);
}

function resolveExactKeywordIdentityCandidates(
  candidates: ExactKeywordScanCandidate[],
  matchMap: Map<string, ResumeMatchContext>,
  params: {
    minScore?: number;
    allowedRecommendations: Set<MatchingResult["recommendation"]> | null;
    sortBy?: "score" | "name" | "experience" | "extractedAt";
  },
): ExactKeywordScanCandidate[] {
  const groups = new Map<string, ExactKeywordScanCandidate[]>();

  for (const candidate of candidates) {
    const group = groups.get(candidate.identityKey);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(candidate.identityKey, [candidate]);
    }
  }

  return Array.from(groups.values()).map((group) => {
    const preferred = [...group].sort((left, right) => compareExactKeywordIdentityCandidates(left, right, matchMap, params))[0];
    const mergedProvenance = dedupeResumeSearchProvenance(group.flatMap((entry) => entry.provenance));

    return {
      ...preferred,
      provenance: mergedProvenance,
      candidate: {
        ...preferred.candidate,
        ...(mergedProvenance.length > 0 ? { provenance: mergedProvenance } : {}),
      },
    };
  });
}

function sortKeywordMatchEntries(
  entries: SortableKeywordMatchEntry[],
  sortBy: "score" | "name" | "experience" | "extractedAt" | undefined,
  sortOrder: "asc" | "desc" | undefined,
): SortableKeywordMatchEntry[] {
  if (!sortBy) {
    return entries;
  }

  const direction = (sortOrder || (sortBy === "score" ? "desc" : "asc")) === "desc" ? -1 : 1;
  return [...entries].sort((left, right) => {
    if (sortBy === "score") {
      const leftScore = left.match?.score ?? -1;
      const rightScore = right.match?.score ?? -1;
      return (leftScore - rightScore) * direction;
    }
    if (sortBy === "experience") {
      const leftExperience = parseExperienceYears(left.candidate.resume.experience) ?? -1;
      const rightExperience = parseExperienceYears(right.candidate.resume.experience) ?? -1;
      return (leftExperience - rightExperience) * direction;
    }
    if (sortBy === "extractedAt") {
      const leftTime = Date.parse(left.candidate.resume.extractedAt || "") || 0;
      const rightTime = Date.parse(right.candidate.resume.extractedAt || "") || 0;
      return (leftTime - rightTime) * direction;
    }

    const leftName = left.candidate.resume.name?.toLowerCase() ?? "";
    const rightName = right.candidate.resume.name?.toLowerCase() ?? "";
    return leftName.localeCompare(rightName) * direction;
  });
}

async function prepareKeywordMatchPageByCursor(params: {
  jobDescriptionId: string;
  keywords: string[];
  offset?: number;
  limit?: number;
  minScore?: number;
  recommendation?: MatchingResult["recommendation"][];
  sortBy?: "score" | "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  resumeFilters?: ResumeFilters;
}): Promise<{
  prepared: PreparedResumeCandidate[];
  total: number;
  matchMap: Map<string, ResumeMatchContext>;
  keywordExpansion?: ResumeKeywordExpansion;
}> {
  const canonicalKeywordQuery = formatKeywordQuery(params.keywords);
  const keywordExpansion = resumeService.expandSearchQuery(canonicalKeywordQuery);
  const scanned: ExactKeywordScanCandidate[] = [];
  let cursor: string | null = null;

  while (true) {
    const value = await callConvexQuery("resumes:searchWithTagExpansionScanPage", {
      paginationOpts: {
        cursor,
        numItems: MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
      },
      query: canonicalKeywordQuery,
      keywordGroups: keywordExpansion?.groups ?? [],
      mode: keywordExpansion?.mode ?? "AND",
      sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
      ...(params.resumeFilters ?? {}),
    });

    if (!isConvexPaginatedQueryPage(value)) {
      throw new Error("Invalid paginated keyword scan response from Convex");
    }

    for (const item of value.page) {
      const parsed = parseExactKeywordScanCandidate(item, params.jobDescriptionId);
      if (!parsed) {
        continue;
      }
      scanned.push(parsed);
    }

    if (value.isDone) {
      break;
    }

    if (!value.continueCursor) {
      throw new Error("Convex keyword scan returned an unfinished page without a continueCursor");
    }
    cursor = value.continueCursor;
  }

  const fullMatchMap = loadResumeMatchContextMap(
    params.jobDescriptionId,
    scanned.map((entry) => entry.candidate.resumeId),
  );
  const allowedRecommendations = params.recommendation?.length
    ? new Set(params.recommendation)
    : null;
  const merged = resolveExactKeywordIdentityCandidates(scanned, fullMatchMap, {
    minScore: params.minScore,
    allowedRecommendations,
    sortBy: params.sortBy,
  });

  let working: SortableKeywordMatchEntry[] = merged.map((entry) => ({
    candidate: entry.candidate,
    match: fullMatchMap.get(entry.candidate.resumeId),
    sortMetadata: entry,
  }));

  const minScore = params.minScore;
  if (typeof minScore === "number") {
    working = working.filter((entry) => entry.match && entry.match.score >= minScore);
  }

  if (allowedRecommendations) {
    working = working.filter((entry) => entry.match && allowedRecommendations.has(entry.match.recommendation));
  }

  working = params.sortBy
    ? sortKeywordMatchEntries(working, params.sortBy, params.sortOrder)
    : [...working].sort((left, right) => {
        const leftMetadata = left.sortMetadata;
        const rightMetadata = right.sortMetadata;
        if (!leftMetadata || !rightMetadata) {
          return 0;
        }

        if (rightMetadata.provenance.length !== leftMetadata.provenance.length) {
          return rightMetadata.provenance.length - leftMetadata.provenance.length;
        }
        return compareExactKeywordScanCandidates(leftMetadata, rightMetadata);
      });

  const pageOffset = typeof params.offset === "number" ? Math.max(0, params.offset) : 0;
  const pageLimit = typeof params.limit === "number" ? Math.max(1, params.limit) : DEFAULT_CONVEX_RESUME_PAGE_SIZE;
  const paged = working.slice(pageOffset, pageOffset + pageLimit);

  return {
    prepared: paged.map((entry) => entry.candidate),
    total: working.length,
    matchMap: createResumeMatchContextMap(
      paged.flatMap((entry) => entry.match
        ? [{
            resumeId: entry.candidate.resumeId,
            score: entry.match.score,
            recommendation: entry.match.recommendation,
          }]
        : []),
    ),
    keywordExpansion,
  };
}

async function prepareFilteredMatchStoragePage(params: {
  jobDescriptionId: string;
  offset?: number;
  limit?: number;
  minScore?: number;
  recommendation?: MatchingResult["recommendation"][];
  sortOrder?: "asc" | "desc";
  resumeFilters: ResumeFilters;
}): Promise<{
  prepared: PreparedResumeCandidate[];
  total: number;
  matchMap: Map<string, ResumeMatchContext>;
}> {
  const pageOffset = typeof params.offset === "number" ? Math.max(0, params.offset) : 0;
  const pageLimit = typeof params.limit === "number" ? Math.max(1, params.limit) : DEFAULT_CONVEX_RESUME_PAGE_SIZE;
  const pageEnd = pageOffset + pageLimit;
  const matchMap = new Map<string, ResumeMatchContext>();
  const pagedPrepared: PreparedResumeCandidate[] = [];
  let filteredCount = 0;
  let scanOffset = 0;
  let totalMatches = 0;

  while (true) {
    const matchPage = matchStorage.getMatchesPageForJob({
      jobDescriptionId: params.jobDescriptionId,
      offset: scanOffset,
      limit: MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
      minScore: params.minScore,
      recommendation: params.recommendation,
      sortOrder: params.sortOrder,
    });
    totalMatches = matchPage.total;

    if (matchPage.matches.length === 0) {
      break;
    }

    const preparedBatch = (await prepareConvexCandidates({
      resumeIds: matchPage.matches.map((match) => match.resumeId),
    })).prepared;
    const filteredBatch = filterPreparedCandidatesByResumeFilters(preparedBatch, params.resumeFilters);
    const batchMatchMap = createResumeMatchContextMap(matchPage.matches);

    for (const candidate of filteredBatch) {
      if (filteredCount >= pageOffset && filteredCount < pageEnd) {
        pagedPrepared.push(candidate);
        const match = batchMatchMap.get(candidate.resumeId);
        if (match) {
          matchMap.set(candidate.resumeId, match);
        }
      }
      filteredCount += 1;
    }

    scanOffset += matchPage.matches.length;
    if (scanOffset >= totalMatches) {
      break;
    }
  }

  return {
    prepared: pagedPrepared,
    total: filteredCount,
    matchMap,
  };
}

async function prepareKeywordMatchPage(params: {
  jobDescriptionId: string;
  keywords: string[];
  offset?: number;
  limit?: number;
  minScore?: number;
  recommendation?: MatchingResult["recommendation"][];
  sortBy?: "score" | "name" | "experience" | "extractedAt";
  sortOrder?: "asc" | "desc";
  resumeFilters?: ResumeFilters;
}): Promise<{
  prepared: PreparedResumeCandidate[];
  total: number;
  matchMap: Map<string, ResumeMatchContext>;
  keywordExpansion?: ResumeKeywordExpansion;
}> {
  return prepareKeywordMatchPageByCursor(params);
}

function resolveConvexResumeFetchLimit(params: {
  limit: number | undefined;
  offset: number | undefined;
  requiresMatchPagination: boolean;
  hasLocalResumeFilters: boolean;
  hasKeywordQuery: boolean;
}): number | undefined {
  const pageSize = typeof params.limit === "number" ? params.limit : DEFAULT_CONVEX_RESUME_PAGE_SIZE;
  const requestedOffset = typeof params.offset === "number" && params.offset > 0 ? params.offset : 0;
  const requestedWindow = requestedOffset + pageSize;

  if (!params.requiresMatchPagination) {
    return params.limit;
  }

  if (!params.hasLocalResumeFilters && !params.hasKeywordQuery) {
    return requestedWindow;
  }

  return Math.min(
    Math.max(requestedWindow, MAX_SAFE_CONVEX_POST_FILTER_SCAN),
    MAX_SAFE_CONVEX_POST_FILTER_LIMIT,
  );
}

function removeServerSideFilters(filters: ResumeFilters): ResumeFilters {
  // Convex's matchesResumeListFilters already handled these fields,
  // so strip them to avoid double-filtering with potentially different logic.
  const { minRoleYears, roleFilterType, minAge, maxAge, sources, locations, ...rest } = filters;
  return rest;
}

function hasResumeListFilters(params: {
  minExperience?: number;
  maxExperience?: number;
  education?: string[];
  skills?: string[];
  requiredKeywords?: string[];
  locations?: string[];
  minSalary?: number;
  maxSalary?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  minAge?: number;
  maxAge?: number;
  sources?: string[];
}): boolean {
  return typeof params.minExperience === "number"
    || typeof params.maxExperience === "number"
    || (params.education?.length ?? 0) > 0
    || (params.skills?.length ?? 0) > 0
    || (params.requiredKeywords?.length ?? 0) > 0
    || (params.locations?.length ?? 0) > 0
    || typeof params.minSalary === "number"
    || typeof params.maxSalary === "number"
    || typeof params.minRoleYears === "number"
    || typeof params.roleFilterType === "string"
    || typeof params.minAge === "number"
    || typeof params.maxAge === "number"
    || (params.sources?.length ?? 0) > 0;
}

function resolveResumeSortOrder(sortBy: "score" | "name" | "experience" | "extractedAt" | undefined, sortOrder: "asc" | "desc" | undefined): "asc" | "desc" | undefined {
  if (!sortBy || sortBy === "score") {
    return sortOrder;
  }
  return sortOrder || "asc";
}

function toExportResumePayload(resume: ResumeItem): ExportResumePayload {
  return {
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

function normalizeExportResumePayload(
  resume: z.infer<typeof ResumeExportResolvedResumeSchema>
): ExportResumePayload {
  return {
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

function toExportEntryFields(entry: ResumeExportEntryContext): ResumeExportEntryFields {
  return {
    match: entry.match,
    action: entry.action,
    status: entry.status,
    ruleScore: entry.ruleScore,
    userComment: entry.userComment,
    referenceNote: entry.referenceNote,
  };
}

function toExportEntry(key: string, resume: ExportResumePayload, fields: ResumeExportEntryFields): ResumeExportEntry {
  return {
    key,
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
    const resumeId = item.resumeId;
    const parsedResume = ResumeExportResolvedResumeSchema.safeParse(item.resume);
    if (!parsedResume.success) {
      return;
    }
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

function buildReviewPacketIdentityKey(params: {
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

function toReviewPacketItemSnapshot(
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

function buildReviewPacketEntriesFromResolvedRecords(
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

function buildExportEntriesFromResolvedResumes(
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
  const entries = buildExportEntriesFromResolvedResumes(request.entries, resolvedResumes);

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
  const industryDbV2Stats = request.industryDbV2Stats
    ?? computeBatchStats(resolved.entries.map((entry) => computeEffectiveIndustryDbV2Raw(entry.resume.ingestData)));

  return {
    format: request.format,
    source: request.source,
    sampleName: request.sample?.trim() || undefined,
    sessionId: request.sessionId?.trim() || undefined,
    jobDescriptionId: request.jobDescriptionId?.trim() || undefined,
    entries: resolved.entries,
    items: resolved.items,
    batchMeta: {
      userComment: request.userComment,
      referenceNote: request.referenceNote,
    },
    industryDbV2Stats,
    debug: request.debug ?? process.env.DEBUG === "true",
  };
}

function buildReviewPacketDownloadPath(runId: string): string {
  return `/api/resumes/review-packets/${encodeURIComponent(runId)}/download`;
}

function buildReviewPacketSessionId(runId: string): string {
  return `review-packet:${runId}`;
}

function buildReviewPacketFilename(runId: string, format: ExportFormat): string {
  return `review-packet-${runId}.${format}`;
}

function getReviewPacketOutputDir(): string {
  return path.join(config.projectRoot, "output", "review-packets");
}

function getReviewPacketFilePath(runId: string, format: ExportFormat): string {
  return path.join(getReviewPacketOutputDir(), buildReviewPacketFilename(runId, format));
}

function toPublicReviewPacketRun(run: StoredReviewPacketRun): z.infer<typeof ReviewPacketRunSchema> {
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

async function triggerReingestStaleSkillsVersion(limit: number): Promise<{
  scheduled: number;
  batches: number;
  currentVersion: number;
  hasMore: boolean;
}> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: "migrations:reIngestStaleSkillsVersion",
      args: { limit },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex action failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || "Convex action failed");
  }

  if (!isRecord(payload.value)) {
    throw new Error("Invalid re-ingest response from Convex");
  }

  const result = payload.value;

  return {
    scheduled: typeof result.scheduled === "number" ? result.scheduled : 0,
    batches: typeof result.batches === "number" ? result.batches : 0,
    currentVersion: typeof result.currentVersion === "number" ? result.currentVersion : skillsKnowledgeService.getVersion(),
    hasMore: result.hasMore === true,
  };
}

function shouldTriggerSkillsReingest(observation: string): boolean {
  const normalized = observation.trim().toLowerCase();
  return normalized.startsWith("synonym_suggestion:") || normalized.startsWith("domain_expansion:");
}

function buildSearchEventQuery(params: {
  keywords: string[];
  location?: string;
  jobDescriptionId?: string;
}): string | null {
  const keywordQuery = formatKeywordQuery(params.keywords).trim();
  if (keywordQuery) {
    const location = params.location?.trim();
    return location ? `${keywordQuery} ${location}` : keywordQuery;
  }

  const jobDescriptionId = params.jobDescriptionId?.trim();
  if (jobDescriptionId) {
    return `jd:${jobDescriptionId}`;
  }

  return null;
}

function toKeywordJobDescriptionId(keywords: string[], location?: string): string {
  return buildKeywordAnalysisId(keywords, {
    location,
    promptVersion: getCurrentResumeAiPromptVersion(),
  });
}

function buildKeywordRequirements(keywords: string[]): string {
  return `候选人需具备以下关键技能/经验:\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}`;
}

function buildKeywordResponsibilities(keywords: string[], location?: string): string | undefined {
  const parts = [
    `核心关键词: ${keywords.join(", ")}`,
    location?.trim() ? `目标地点: ${location.trim()}` : undefined,
  ].filter((item): item is string => Boolean(item));
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

function mapStoredMatch(match: StoredMatch): {
  resumeId: string;
  jobDescriptionId: string;
  score: number;
  recommendation: MatchingResult["recommendation"];
  highlights: string[];
  concerns: string[];
  summary: string;
  breakdown?: MatchingResult["breakdown"];
  scoreSource: "rule" | "ai";
  matchedAt: string;
  sessionId?: string;
  userId?: string;
} {
  return {
    resumeId: match.resumeId,
    jobDescriptionId: match.jobDescriptionId,
    score: match.score,
    recommendation: match.recommendation,
    highlights: match.highlights,
    concerns: match.concerns,
    summary: match.summary,
    breakdown: match.breakdown,
    scoreSource: match.scoreSource,
    matchedAt: match.matchedAt,
    sessionId: match.sessionId,
    userId: match.userId,
  };
}

function mapStoredMatchRun(run: StoredMatchRun): {
  id: string;
  sessionId?: string;
  jobDescriptionId: string;
  sampleName?: string;
  mode: MatchRunMode;
  status: "processing" | "completed" | "failed";
  totalCount: number;
  processedCount: number;
  failedCount: number;
  matchedCount?: number;
  avgScore?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
} {
  return {
    id: run.id,
    sessionId: run.sessionId,
    jobDescriptionId: run.jobDescriptionId,
    sampleName: run.sampleName,
    mode: run.mode,
    status: run.status,
    totalCount: run.totalCount,
    processedCount: run.processedCount,
    failedCount: run.failedCount,
    matchedCount: run.matchedCount,
    avgScore: run.avgScore,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
  };
}

function toMatchMode(mode: string | undefined): MatchMode {
  if (mode === "rules_only" || mode === "hybrid" || mode === "ai_only") {
    return mode;
  }
  return "hybrid";
}

function toTopN(value: number | undefined): number {
  if (typeof value !== "number" || value <= 0) return DEFAULT_AI_TOP_N;
  return Math.max(1, Math.min(500, value));
}

function computeStats(
  results: Array<{ score: number }>,
  processingTimeMs?: number,
  pendingAi?: number
): { processed: number; matched: number; avgScore: number; processingTimeMs?: number; pendingAi?: number } {
  const processed = results.length;
  const matched = results.filter((item) => item.score >= 50).length;
  const avgScore = processed
    ? Number((results.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    : 0;

  return {
    processed,
    matched,
    avgScore,
    processingTimeMs,
    pendingAi,
  };
}

function createFallbackIndex(resume: ResumeItem, resumeId: string): ResumeIndex {
  const latestWorkHistory = getLatestWorkHistory(resume.workHistory);
  const locationText = formatLocationHierarchySearchText(resume.locationHierarchy) || resume.location || "";
  const text = [
    resume.name,
    locationText,
    resume.education,
    ...latestWorkHistory.map((item) => buildWorkHistoryEntryText(item)),
  ].join(" ").toLowerCase();

  return {
    resumeId,
    experienceYears: null,
    educationLevel: resume.education || null,
    locationCity: resume.locationHierarchy?.city
      || resume.locationHierarchy?.province
      || resume.locationHierarchy?.country
      || resume.location
      || null,
    skills: [],
    companies: extractCompanies(latestWorkHistory) ?? [],
    industryTags: [],
    salaryRange: null,
    searchText: text,
    evidenceText: buildLatestWorkHistoryEvidence(latestWorkHistory).text,
  };
}

function buildAiResumePayload(item: {
  resume: ResumeItem;
  resumeId: string;
  indexData: ResumeIndex;
  companyHits: string[];
  roleSignals: PreparedResumeCandidate["roleSignals"];
}): MatchingRequest["resume"] {
  const latestWorkHistory = getLatestWorkHistory(item.resume.workHistory);
  return {
    id: item.resumeId,
    name: item.resume.name || "未命名",
    workExperience: item.indexData.experienceYears ?? undefined,
    education: item.resume.education || undefined,
    skills: item.indexData.skills,
    companies: item.indexData.companies.length > 0 ? item.indexData.companies : extractCompanies(latestWorkHistory),
    companyHits: item.companyHits,
    roleSignals: item.roleSignals,
    workHistory: buildLatestWorkHistoryEvidence(latestWorkHistory).lines.join("\n") || undefined,
    sourceKey: resolveResumeAnalysisSourceKey({ sourceKey: item.resume.profileType }),
  };
}

function createSsePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const listSamplesRoute = createRoute({
  method: "get",
  path: "/api/resumes/samples",
  tags: ["resumes"],
  summary: "List resume sample files",
  description: "Returns available resume sample JSON files stored under output/resumes/samples",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeSamplesResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(listSamplesRoute, (c) => {
  const samples = resumeService.listSampleFiles();
  return c.json({
    success: true as const,
    samples,
  }, 200);
});

const getResumeKeywordExpansionRoute = createRoute({
  method: "get",
  path: "/api/resumes/keyword-expansion",
  tags: ["resumes"],
  summary: "Expand resume keyword query with synonyms",
  description: "Returns the backend-expanded keyword variants used for unified resume search",
  request: {
    query: ResumeKeywordExpansionQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeKeywordExpansionResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getResumeKeywordExpansionRoute, (c) => {
  const { q } = c.req.valid("query");
  const expansion = resumeService.expandSearchQuery(q);

  return c.json({
    success: true as const,
    summary: {
      keyword: q,
      groups: expansion?.groups ?? [],
      mode: expansion?.mode ?? "AND",
      expandedTo: expansion?.flatTerms ?? [],
      sourceMapping: expansion?.sourceMapping ?? {},
    },
  }, 200);
});

const getResumesRoute = createRoute({
  method: "get",
  path: "/api/resumes",
  tags: ["resumes"],
  summary: "List resumes from a sample file",
  description: "Returns resume items from the latest or specified sample JSON",
  request: {
    query: ResumesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumesResponseSchema,
        },
      },
      description: "Successful response",
    },
  },
});

app.openapi(getResumesRoute, (c) => {
  const {
    sample,
    source,
    q,
    limit,
    offset,
    minExperience,
    maxExperience,
    education,
    skills,
    requiredKeywords,
    locations,
    minSalary,
    maxSalary,
    minRoleYears,
    roleFilterType,
    minAge,
    maxAge,
    sources,
    minMatchScore,
    recommendation,
    sortBy,
    sortOrder,
    sessionId,
    jobDescriptionId,
  } = c.req.valid("query");
  const sampleName = sample?.trim() || undefined;
  const keyword = q?.trim() || undefined;
  const keywordExpansion = resumeService.expandSearchQuery(keyword);

  try {
    if (source === "convex") {
      return (async () => {
        const resolvedJobId = jobDescriptionId?.trim() || undefined;
        const normalizedKeywords = keyword ? normalizeKeywords(parseKeywordQuery(keyword).keywords) : [];
        const normalizedRequiredKeywords = normalizeKeywords(requiredKeywords);
        const normalizedRecommendations = normalizeMatchRecommendations(recommendation);
        const hasLocalMatchFilters = minMatchScore !== undefined || (normalizedRecommendations?.length ?? 0) > 0;
        const hasLocalResumeFilters = hasResumeListFilters({
          minExperience,
          maxExperience,
          education,
          skills,
          requiredKeywords: normalizedRequiredKeywords,
          locations,
          minSalary,
          maxSalary,
          minRoleYears,
          roleFilterType,
          minAge,
          maxAge,
          sources,
        });
        const requiresMatchPagination = sortBy === "score" || hasLocalMatchFilters;
        const localResumeFilters: ResumeFilters = {
          minExperience,
          maxExperience,
          education,
          skills,
          requiredKeywords: normalizedRequiredKeywords,
          locations,
          minSalary,
          maxSalary,
          minRoleYears,
          roleFilterType,
          minAge,
          maxAge,
          sources,
        };
        const canUseMatchStoragePagination = Boolean(
          resolvedJobId
          && requiresMatchPagination
          && normalizedKeywords.length === 0
          && !hasLocalResumeFilters
        );
        const canUseFilteredMatchStoragePagination = Boolean(
          resolvedJobId
          && requiresMatchPagination
          && normalizedKeywords.length === 0
          && hasLocalResumeFilters
        );
        const canUseKeywordMatchPagination = Boolean(
          resolvedJobId
          && requiresMatchPagination
          && normalizedKeywords.length > 0
        );
        const canUseSourcePagination = !requiresMatchPagination;
        let usesPrePagedMatchResults = canUseMatchStoragePagination || canUseFilteredMatchStoragePagination;
        const matchSortOrder = sortBy === "score"
          ? resolveResumeSortOrder(sortBy, sortOrder) || "desc"
          : "desc";

        let prepared: PreparedResumeCandidate[] = [];
        let liveExpansion: ResumeKeywordExpansion | undefined;
        let totalCount: number | undefined;
        let matchMap: Map<string, ResumeMatchContext> | null = null;
        let usedServerSideFilters = false;

        if (canUseMatchStoragePagination && resolvedJobId) {
          const matchPage = matchStorage.getMatchesPageForJob({
            jobDescriptionId: resolvedJobId,
            offset,
            limit,
            minScore: minMatchScore,
            recommendation: normalizedRecommendations,
            sortOrder: matchSortOrder,
          });
          const pagedResumeIds = matchPage.matches.map((match) => match.resumeId);
          matchMap = new Map(matchPage.matches.map((match) => [match.resumeId, match]));
          totalCount = matchPage.total;
          if (pagedResumeIds.length > 0) {
            prepared = (await prepareConvexCandidates({
              resumeIds: pagedResumeIds,
            })).prepared;
          }
        } else if (canUseFilteredMatchStoragePagination && resolvedJobId) {
          const filteredMatchPage = await prepareFilteredMatchStoragePage({
            jobDescriptionId: resolvedJobId,
            offset,
            limit,
            minScore: minMatchScore,
            recommendation: normalizedRecommendations,
            sortOrder: matchSortOrder,
            resumeFilters: localResumeFilters,
          });
          prepared = filteredMatchPage.prepared;
          matchMap = filteredMatchPage.matchMap;
          totalCount = filteredMatchPage.total;
        } else if (canUseKeywordMatchPagination && resolvedJobId) {
          const keywordMatchPage = await prepareKeywordMatchPage({
            jobDescriptionId: resolvedJobId,
            keywords: normalizedKeywords,
            offset,
            limit,
            minScore: minMatchScore,
            recommendation: normalizedRecommendations,
            sortBy,
            sortOrder: resolveResumeSortOrder(sortBy, sortOrder) || "desc",
            resumeFilters: localResumeFilters,
          });
          prepared = keywordMatchPage.prepared;
          matchMap = keywordMatchPage.matchMap;
          totalCount = keywordMatchPage.total;
          liveExpansion = keywordMatchPage.keywordExpansion;
          usesPrePagedMatchResults = true;
        } else {
          const convexFetchLimit = canUseSourcePagination ? limit : resolveConvexResumeFetchLimit({
            limit,
            offset,
            requiresMatchPagination,
            hasLocalResumeFilters,
            hasKeywordQuery: normalizedKeywords.length > 0,
          });
          const preparedResult = await prepareConvexCandidates({
            keywordQuery: keyword,
            keywords: normalizedKeywords,
            limit: convexFetchLimit,
            offset: canUseSourcePagination ? offset : undefined,
            sortBy: canUseSourcePagination && sortBy ? sortBy : undefined,
            sortOrder: canUseSourcePagination ? resolveResumeSortOrder(sortBy, sortOrder) : undefined,
            filters: canUseSourcePagination ? localResumeFilters : undefined,
            jobDescriptionId: resolvedJobId,
            paged: canUseSourcePagination,
          });
          prepared = preparedResult.prepared;
          liveExpansion = preparedResult.keywordExpansion;
          totalCount = preparedResult.total;
          usedServerSideFilters = preparedResult.usedServerSideFilters ?? false;
        }

        // When the cursor scan path already applied filters server-side via
        // Convex's matchesResumeListFilters, skip redundant local filtering
        // for those filter fields that Convex already handled. Local filtering
        // still runs for the old filter fields that Convex doesn't cover
        // (or when using the non-cursor paths).
        let filtered = prepared.map((item) => item.resume);
        filtered = usesPrePagedMatchResults
          ? filtered
          : usedServerSideFilters
            ? resumeService.filterResumes(filtered, removeServerSideFilters(localResumeFilters))
            : resumeService.filterResumes(filtered, localResumeFilters);

        const enriched = filtered.map((item, index) => ({
          resume: item,
          id: resolveResumeId(item, index),
        }));

        const needsMatchContext = Boolean(
          resolvedJobId
          && (minMatchScore !== undefined || (normalizedRecommendations?.length ?? 0) > 0 || sortBy === "score")
        );

        if (!matchMap && needsMatchContext && resolvedJobId) {
          matchMap = loadResumeMatchContextMap(
            resolvedJobId,
            prepared.map((item) => item.resumeId),
          );
        }

        let working = enriched;
        if (!usesPrePagedMatchResults && matchMap) {
          if (minMatchScore !== undefined) {
            working = working.filter((item) => {
              const match = matchMap?.get(item.id);
              return match && match.score >= minMatchScore;
            });
          }
          if (normalizedRecommendations?.length) {
            const allowed = new Set(normalizedRecommendations);
            working = working.filter((item) => {
              const match = matchMap?.get(item.id);
              return match && allowed.has(match.recommendation);
            });
          }
        }

        if (!usesPrePagedMatchResults && sortBy) {
          const order = sortOrder || (sortBy === "score" ? "desc" : "asc");
          const direction = order === "desc" ? -1 : 1;

          working = [...working].sort((a, b) => {
            if (sortBy === "score") {
              const scoreA = matchMap?.get(a.id)?.score ?? -1;
              const scoreB = matchMap?.get(b.id)?.score ?? -1;
              return (scoreA - scoreB) * direction;
            }
            if (sortBy === "experience") {
              const expA = parseExperienceYears(a.resume.experience) ?? -1;
              const expB = parseExperienceYears(b.resume.experience) ?? -1;
              return (expA - expB) * direction;
            }
            if (sortBy === "extractedAt") {
              const timeA = Date.parse(a.resume.extractedAt || "") || 0;
              const timeB = Date.parse(b.resume.extractedAt || "") || 0;
              return (timeA - timeB) * direction;
            }
            const nameA = a.resume.name?.toLowerCase() ?? "";
            const nameB = b.resume.name?.toLowerCase() ?? "";
            return nameA.localeCompare(nameB) * direction;
          });
        }

        // Cursor-scan returns all results without pre-slicing, so
        // offset/limit must be applied after local filtering.
        const start = offset ?? 0;
        const end = typeof limit === "number" ? start + limit : undefined;
        const pagedWorking = end ? working.slice(start, end) : working.slice(start);
        // usesPrePagedMatchResults already has correct offset/limit from match storage;
        // canUseSourcePagination with no keywords already has offset/limit from Convex list page;
        // all other paths need offset/limit applied locally.
        const isSourcePaginated = canUseSourcePagination && normalizedKeywords.length === 0;
        const limited = (usesPrePagedMatchResults || isSourcePaginated)
          ? working.map((item) => item.resume)
          : pagedWorking.map((item) => item.resume);

        return c.json({
          success: true as const,
          summary: {
            total: (usesPrePagedMatchResults || isSourcePaginated)
              ? (totalCount ?? working.length)
              : working.length,
            returned: limited.length,
            query: keyword,
            source,
            ...buildKeywordExpansionSummary(liveExpansion ?? keywordExpansion),
          },
          data: limited,
        }, 200);
      })();
    }

    const { items, sample: sampleInfo, metadata, indexes } = resumeService.loadSample(sampleName);
    const session = sessionId ? sessionManager.getSession(sessionId) : null;
    const resolvedJobId = jobDescriptionId?.trim() || session?.jobDescriptionId;

    let ruleScoreMap: Map<string, number> | undefined;
    if (resolvedJobId) {
      try {
        const context = ruleScoringService.buildContext(resolvedJobId);
        const preparedForScores = prepareSampleCandidates({
          items,
          indexMap: indexes,
        });
        const scored = scorePreparedCandidates(preparedForScores, context);
        ruleScoreMap = new Map(scored.map((entry) => [entry.resumeId, entry.result.score]));
      } catch (error) {
        console.error(`[Resumes] Failed to compute rule score map for ${resolvedJobId}:`, error);
      }
    }

    let filtered = resumeService.searchResumes(items, keyword, indexes, ruleScoreMap);
    filtered = resumeService.filterResumes(filtered, {
      minExperience,
      maxExperience,
      education,
      skills,
      requiredKeywords: normalizeKeywords(requiredKeywords),
      locations,
      minSalary,
      maxSalary,
    });

    const enriched = filtered.map((item, index) => ({
      resume: item,
      id: resolveResumeId(item, index),
      relevanceScore: item.relevanceScore,
    }));

    let matchMap: Map<string, { score: number; recommendation: MatchingResult["recommendation"] }> | null = null;
    const needsMatchContext = Boolean(
      resolvedJobId
      && (minMatchScore !== undefined || (recommendation?.length ?? 0) > 0 || sortBy === "score")
    );

    if (needsMatchContext && resolvedJobId) {
      const matches = matchStorage.getMatchesByResumeIds(
        enriched.map((item) => item.id),
        resolvedJobId
      );
      matchMap = new Map(matches.map((match) => [match.resumeId, match]));
    }

    let working = enriched;
    if (matchMap) {
      if (minMatchScore !== undefined) {
        working = working.filter((item) => {
          const match = matchMap?.get(item.id);
          return match && match.score >= minMatchScore;
        });
      }
      if (recommendation?.length) {
        const allowed = new Set(recommendation);
        working = working.filter((item) => {
          const match = matchMap?.get(item.id);
          return match && allowed.has(match.recommendation);
        });
      }
    }

    if (sortBy) {
      const order = sortOrder || (sortBy === "score" ? "desc" : "asc");
      const direction = order === "desc" ? -1 : 1;

      working = [...working].sort((a, b) => {
        if (sortBy === "score") {
          const scoreA = matchMap?.get(a.id)?.score ?? -1;
          const scoreB = matchMap?.get(b.id)?.score ?? -1;
          return (scoreA - scoreB) * direction;
        }
        if (sortBy === "experience") {
          const expA = parseExperienceYears(a.resume.experience) ?? -1;
          const expB = parseExperienceYears(b.resume.experience) ?? -1;
          return (expA - expB) * direction;
        }
        if (sortBy === "extractedAt") {
          const timeA = Date.parse(a.resume.extractedAt || "") || 0;
          const timeB = Date.parse(b.resume.extractedAt || "") || 0;
          return (timeA - timeB) * direction;
        }
        const nameA = a.resume.name?.toLowerCase() ?? "";
        const nameB = b.resume.name?.toLowerCase() ?? "";
        return nameA.localeCompare(nameB) * direction;
      });
    } else if (keyword) {
      // Default sort by relevance if keyword is present but no explicit sortBy
      working = [...working].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    const start = offset ?? 0;
    const end = typeof limit === "number" ? start + limit : undefined;
    const paged = end ? working.slice(start, end) : working.slice(start);
    const limited = paged.map((item) => item.resume);

    if (keyword) {
      const topScore = working[0]?.relevanceScore;
      searchEventLogger.logSearchQuery({
        query: keyword,
        resultCount: working.length,
        topScore: typeof topScore === "number" ? topScore : undefined,
      });
    }

    return c.json({
      success: true as const,
      sample: sampleInfo,
      metadata: metadata ?? undefined,
      summary: {
        total: working.length,
        returned: limited.length,
        query: keyword,
        source,
        expandedTo: keywordExpansion?.flatTerms,
        mode: keywordExpansion?.mode,
        keywordGroups: keywordExpansion?.groups,
        sourceMapping: keywordExpansion?.sourceMapping,
      },
      data: limited,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: true as const,
        summary: {
          total: 0,
          returned: 0,
          query: keyword,
        },
        data: [],
      }, 200);
    }
    throw error;
  }
});

function findSampleResumeByIdentifier(items: ResumeItem[], resumeId: string): ResumeItem | null {
  const normalizedResumeId = resumeId.trim();
  if (!normalizedResumeId) {
    return null;
  }

  for (const [index, item] of items.entries()) {
    if (resolveResumeId(item, index) === normalizedResumeId) {
      return item;
    }
  }

  return null;
}

async function getConvexResumeDetail(resumeId: string): Promise<ResumeItem | null> {
  const value = await callConvexQuery("resumes:getResumeDetail", { resumeId });
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid resume detail response from Convex");
  }

  const content = isRecord(value.content) ? value.content : {};
  const source = toStringValue(value.source) || undefined;
  const resume = toResumeItemFromRecord(content, source);
  const ingestData = buildResumeIngestData(value.ingestData);

  return ingestData
    ? {
        ...resume,
        ingestData,
      }
    : resume;
}

const matchResumesRoute = createRoute({
  method: "post",
  path: "/api/resumes/match",
  tags: ["resumes"],
  summary: "Match resumes with a job description",
  description: "Runs rule/AI matching and stores results for the session",
  request: {
    body: {
      content: {
        "application/json": {
          schema: MatchRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: MatchResponseSchema } },
      description: "Matching results",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Session or job description not found",
    },
  },
});

app.openapi(matchResumesRoute, async (c) => {
  const requestPayload = c.req.valid("json");
  const {
    sessionId,
    jobDescriptionId,
    keywords,
    location,
    sample,
    source,
    persist,
    resumeIds,
    limit,
    topN,
    mode: modeInput,
  } = requestPayload;

  const normalizedJobDescriptionId = jobDescriptionId?.trim();
  const normalizedKeywords = normalizeKeywords(keywords);
  if (!normalizedJobDescriptionId && normalizedKeywords.length === 0) {
    return c.json({ success: false, error: "jobDescriptionId or keywords is required" }, 400);
  }

  const mode = toMatchMode(modeInput);
  if (!persist && mode !== "rules_only") {
    return c.json({ success: false, error: "persist=false only supports rules_only mode" }, 400);
  }
  if (source === "convex" && persist !== false) {
    return c.json({ success: false, error: "source=convex only supports persist=false" }, 400);
  }

  const matchJobDescriptionId = normalizedJobDescriptionId
    ? normalizedJobDescriptionId
    : toKeywordJobDescriptionId(normalizedKeywords, location);
  const searchEventQuery = buildSearchEventQuery({
    keywords: normalizedKeywords,
    location,
    jobDescriptionId: normalizedJobDescriptionId,
  });
  const keywordExpansion = normalizedKeywords.length > 0
    ? resumeService.expandSearchQuery(formatKeywordQuery(normalizedKeywords))
    : undefined;

  let session = persist && sessionId ? sessionManager.getSession(sessionId) : null;
  if (persist && sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }
  if (persist && !session) {
    session = sessionManager.createSession({
      jobDescriptionId: normalizedJobDescriptionId,
      sampleName: sample,
    });
  } else if (persist && session) {
    session = sessionManager.updateSession(session.id, {
      jobDescriptionId: normalizedJobDescriptionId ?? null,
      sampleName: sample ?? session.sampleName,
    }) ?? session;
  }

  let sampleName = sample ?? session?.sampleName;
  let prepared: PreparedResumeCandidate[] = [];
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    if (source === "convex") {
      prepared = (await prepareConvexCandidates({
        resumeIds,
        keywords: normalizedKeywords,
        keywordQuery: (normalizedKeywords.length > 0 ? formatKeywordQuery(normalizedKeywords) : undefined),
        location,
        limit,
        jobDescriptionId: normalizedJobDescriptionId,
      })).prepared;
    } else {
      const sampleData = resumeService.loadSample(sampleName);
      sampleName = sampleData.sample.name;
      prepared = prepareSampleCandidates({
        items: sampleData.items,
        indexMap: sampleData.indexes,
        resumeIds,
        limit,
      });
    }

    if (normalizedJobDescriptionId) {
      const jdData = jobService.loadFile(normalizedJobDescriptionId);
      jdMeta = { title: jdData.title };
      content = jdData.content;
    } else {
      jdMeta = { title: normalizedKeywords.join(", ") };
    }
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const requirements = normalizedJobDescriptionId
    ? (extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content))
    : buildKeywordRequirements(normalizedKeywords);
  const responsibilities = normalizedJobDescriptionId
    ? extractSection(content, ["Responsibilities", "岗位职责", "职责"])
    : buildKeywordResponsibilities(normalizedKeywords, location);

  const shouldTrackRun = persist && mode !== "hybrid";
  const runId = randomUUID();
  if (shouldTrackRun) {
    matchStorage.createMatchRun({
      id: runId,
      sessionId: session?.id,
      jobDescriptionId: matchJobDescriptionId,
      sampleName: sampleName ?? undefined,
      mode,
      totalCount: prepared.length,
    });
  }

  const startTime = Date.now();

  try {
    if (mode === "rules_only" || mode === "hybrid") {
      const context = normalizedJobDescriptionId
        ? ruleScoringService.buildContext(normalizedJobDescriptionId)
        : ruleScoringService.buildContextFromKeywords(normalizedKeywords, location);
      const scored = scorePreparedCandidates(prepared, context)
        .sort((a, b) => b.result.score - a.result.score);
      const entries = scored.map((entry) => ({
        sessionId: session?.id,
        resumeId: entry.resumeId,
        jobDescriptionId: matchJobDescriptionId,
        sampleName: sampleName ?? undefined,
        result: ruleScoringService.toMatchingResult(entry.result),
        aiModel: "rule-scoring",
        processingTimeMs: Date.now() - startTime,
      }));

      if (persist && entries.length > 0) {
        matchStorage.saveMatches(entries);
      }

      const results = scored.map((entry) => buildRuleMatchResponseEntry({
        candidate: entry.candidate,
        result: entry.result,
        jobDescriptionId: matchJobDescriptionId,
        sessionId: session?.id,
      }));
      const pendingAiCount = mode === "hybrid"
        ? Math.min(toTopN(topN), results.length)
        : 0;
      const stats = computeStats(
        results,
        Date.now() - startTime,
        mode === "hybrid" ? pendingAiCount : undefined
      );

      if (shouldTrackRun) {
        matchStorage.finalizeMatchRun({
          id: runId,
          status: "completed",
          processedCount: stats.processed,
          failedCount: 0,
          matchedCount: stats.matched,
          avgScore: stats.avgScore,
        });
      }

      if (persist && searchEventQuery) {
        searchEventLogger.logSearchQuery({
          query: searchEventQuery,
          resultCount: results.length,
          topScore: results[0]?.score,
        });
      }

      return c.json(
        MatchResponseSchema.parse({
          success: true as const,
          mode,
          streamPath: mode === "hybrid" ? "/api/resumes/match-stream" : undefined,
          pendingAiCount: mode === "hybrid" ? pendingAiCount : undefined,
          query: buildMatchQueryMetadata({
            source,
            persisted: persist,
            keywordExpansion,
            context,
          }),
          results,
          stats,
        }),
        200
      );
    }

    const context = normalizedJobDescriptionId
      ? ruleScoringService.buildContext(normalizedJobDescriptionId)
      : ruleScoringService.buildContextFromKeywords(normalizedKeywords, location);
    const cachedMatches = matchStorage.getMatchesByResumeIds(
      prepared.map((item) => item.resumeId),
      matchJobDescriptionId
    );
    const cachedMap = new Map(cachedMatches.map((match) => [match.resumeId, match]));
    const toProcess = prepared.filter((item) => {
      const cached = cachedMap.get(item.resumeId);
      if (!cached) return true;
      return cached.scoreSource === "rule";
    });

    if (toProcess.length > 0) {
      const fieldUsagePolicy = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
      const batchResult = await aiService.matchBatch(
        toProcess.map((item) => buildAiResumePayload(item)),
        {
          title: jdMeta.title || matchJobDescriptionId,
          requirements,
          responsibilities,
        },
        {
          fieldUsagePolicy,
        },
      );

      const entries = batchResult.results.map((entry) => ({
        sessionId: session?.id,
        resumeId: entry.resumeId,
        jobDescriptionId: matchJobDescriptionId,
        sampleName: sampleName ?? undefined,
        result: {
          ...entry.result,
          scoreSource: "ai" as const,
        },
        aiModel: aiService.getServiceInfo().model,
        processingTimeMs: batchResult.processingTimeMs,
      }));

      if (entries.length > 0) {
        matchStorage.saveMatches(entries);
      }
    }

    const finalMatches = matchStorage.getMatchesByResumeIds(
      prepared.map((item) => item.resumeId),
      matchJobDescriptionId
    );
    const finalResults = finalMatches
      .map((match) => mapStoredMatch(match))
      .sort((a, b) => b.score - a.score);
    const stats = computeStats(finalResults, Date.now() - startTime);

    if (shouldTrackRun) {
      matchStorage.finalizeMatchRun({
        id: runId,
        status: "completed",
        processedCount: stats.processed,
        failedCount: 0,
        matchedCount: stats.matched,
        avgScore: stats.avgScore,
      });
    }

    if (searchEventQuery) {
      searchEventLogger.logSearchQuery({
        query: searchEventQuery,
        resultCount: finalResults.length,
        topScore: finalResults[0]?.score,
      });
    }

    return c.json(
      MatchResponseSchema.parse({
        success: true as const,
        mode: "ai_only",
        query: buildMatchQueryMetadata({
          source,
          persisted: persist,
          keywordExpansion,
          context,
        }),
        results: finalResults,
        stats,
      }),
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldTrackRun) {
      matchStorage.finalizeMatchRun({
        id: runId,
        status: "failed",
        processedCount: 0,
        failedCount: prepared.length,
        error: message,
      });
    }
    throw error;
  }
});

app.post("/api/resumes/match-stream", async (c) => {
  const parsed = MatchRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const {
    sessionId,
    jobDescriptionId,
    keywords,
    location,
    sample,
    source,
    persist,
    resumeIds,
    limit,
    topN,
    mode: modeInput,
  } = parsed.data;

  const normalizedJobDescriptionId = jobDescriptionId?.trim();
  const normalizedKeywords = normalizeKeywords(keywords);
  if (!normalizedJobDescriptionId && normalizedKeywords.length === 0) {
    return c.json({ success: false, error: "jobDescriptionId or keywords is required" }, 400);
  }
  const matchJobDescriptionId = normalizedJobDescriptionId
    ? normalizedJobDescriptionId
    : toKeywordJobDescriptionId(normalizedKeywords, location);
  if (source === "convex") {
    return c.json({ success: false, error: "match-stream does not support source=convex" }, 400);
  }
  if (persist === false) {
    return c.json({ success: false, error: "match-stream does not support persist=false" }, 400);
  }

  const mode = toMatchMode(modeInput);
  const requestedTopN = toTopN(topN);

  let session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  if (!session) {
    session = sessionManager.createSession({
      jobDescriptionId: normalizedJobDescriptionId,
      sampleName: sample,
    });
  }

  const sampleName = sample ?? session.sampleName;

  let prepared: PreparedResumeCandidate[] = [];
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    const sampleData = resumeService.loadSample(sampleName);
    prepared = prepareSampleCandidates({
      items: sampleData.items,
      indexMap: sampleData.indexes,
      resumeIds,
      limit,
    });
    if (normalizedJobDescriptionId) {
      const jdData = jobService.loadFile(normalizedJobDescriptionId);
      jdMeta = { title: jdData.title };
      content = jdData.content;
    } else {
      jdMeta = { title: normalizedKeywords.join(", ") };
    }
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const requirements = normalizedJobDescriptionId
    ? (extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content))
    : buildKeywordRequirements(normalizedKeywords);
  const responsibilities = normalizedJobDescriptionId
    ? extractSection(content, ["Responsibilities", "岗位职责", "职责"])
    : buildKeywordResponsibilities(normalizedKeywords, location);
  const preparedMap = new Map(prepared.map((item) => [item.resumeId, item]));

  const runId = randomUUID();
  matchStorage.createMatchRun({
    id: runId,
    sessionId: session?.id,
    jobDescriptionId: matchJobDescriptionId,
    sampleName: sampleName ?? undefined,
    mode,
    totalCount: prepared.length,
  });

  const encoder = new TextEncoder();
  const abortSignal = c.req.raw.signal;

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const safeSend = (event: string, payload: unknown): void => {
        if (abortSignal.aborted) return;
        controller.enqueue(encoder.encode(createSsePayload(event, payload)));
      };

      const startTime = Date.now();
      let runFinalized = false;

      const finalizeRun = (params: {
        status: "completed" | "failed";
        processedCount: number;
        failedCount: number;
        matchedCount?: number;
        avgScore?: number;
        error?: string;
      }): void => {
        if (runFinalized) return;
        runFinalized = true;
        matchStorage.finalizeMatchRun({
          id: runId,
          status: params.status,
          processedCount: params.processedCount,
          failedCount: params.failedCount,
          matchedCount: params.matchedCount,
          avgScore: params.avgScore,
          error: params.error,
        });
      };

      try {
        safeSend("ready", {
          runId,
          mode,
          total: prepared.length,
          topN: requestedTopN,
        });

        let ruleOrdered = prepared;

        if (mode === "rules_only" || mode === "hybrid") {
          const context = normalizedJobDescriptionId
            ? ruleScoringService.buildContext(normalizedJobDescriptionId)
            : ruleScoringService.buildContextFromKeywords(normalizedKeywords, location);
          const scored = scorePreparedCandidates(prepared, context);
          const orderedRuleResults = scored
            .map((entry) => ({
              resumeId: entry.resumeId,
              result: buildRuleMatchResponseEntry({
                candidate: entry.candidate,
                result: entry.result,
                jobDescriptionId: matchJobDescriptionId,
                sessionId: session?.id,
              }),
            }))
            .sort((a, b) => b.result.score - a.result.score);
          const existingRuleScopeMatches = matchStorage.getMatchesByResumeIds(
            prepared.map((item) => item.resumeId),
            matchJobDescriptionId
          );
          const existingRuleScopeMap = new Map(
            existingRuleScopeMatches.map((match) => [match.resumeId, match])
          );

          const ruleEntries = orderedRuleResults
            .filter(({ resumeId }) => {
              const existing = existingRuleScopeMap.get(resumeId);
              return !existing || existing.scoreSource !== "ai";
            })
            .map(({ resumeId, result }) => ({
              sessionId: session?.id,
              resumeId,
              jobDescriptionId: matchJobDescriptionId,
              sampleName: sampleName ?? undefined,
              result: {
                score: result.score,
                recommendation: result.recommendation,
                highlights: result.highlights,
                concerns: result.concerns,
                summary: result.summary,
                breakdown: result.breakdown,
                scoreSource: result.scoreSource,
              },
              aiModel: "rule-scoring",
              processingTimeMs: Date.now() - startTime,
            }));

          if (ruleEntries.length > 0) {
            matchStorage.saveMatches(ruleEntries);
          }

          ruleOrdered = orderedRuleResults
            .map((entry) => preparedMap.get(entry.resumeId))
            .filter((item): item is (typeof prepared)[number] => Boolean(item));

          const ruleMatchedAt = new Date().toISOString();
          safeSend("rules", {
            mode,
            results: orderedRuleResults.map(({ resumeId, result }) => ({
              ...result,
              resumeId,
              matchedAt: ruleMatchedAt,
            })),
            progress: { done: orderedRuleResults.length, total: prepared.length },
          });

          if (mode === "rules_only") {
            const stats = computeStats(
              orderedRuleResults.map((entry) => ({ score: entry.result.score })),
              Date.now() - startTime,
              0
            );
            finalizeRun({
              status: "completed",
              processedCount: stats.processed,
              failedCount: 0,
              matchedCount: stats.matched,
              avgScore: stats.avgScore,
            });
            safeSend("done", {
              mode,
              stats,
            });
            controller.close();
            return;
          }

          const aiCandidates = ruleOrdered.slice(0, requestedTopN);
          const topIds = aiCandidates.map((item) => item.resumeId);
          const existingTopMatches = matchStorage.getMatchesByResumeIds(topIds, matchJobDescriptionId);
          const existingTopMap = new Map(existingTopMatches.map((match) => [match.resumeId, match]));

          let aiDone = 0;
          let aiFailed = 0;

          const processQueue = aiCandidates.filter((item) => {
            const existing = existingTopMap.get(item.resumeId);
            return !existing || existing.scoreSource === "rule";
          });

          const cachedAiResults = aiCandidates
            .map((item) => existingTopMap.get(item.resumeId))
            .filter((match): match is StoredMatch => Boolean(match && match.scoreSource === "ai"));

          for (const cached of cachedAiResults) {
            aiDone += 1;
            safeSend("result", {
              resumeId: cached.resumeId,
              result: mapStoredMatch(cached),
              progress: {
                done: aiDone,
                total: aiCandidates.length,
              },
            });
          }

          if (processQueue.length > 0) {
            const fieldUsagePolicy = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
            const batchResult = await aiService.matchBatch(
              processQueue.map((item) => buildAiResumePayload(item)),
              {
                title: jdMeta.title || matchJobDescriptionId,
                requirements,
                responsibilities,
              },
              {
                fieldUsagePolicy,
                onResult: ({ resumeId, result, done }) => {
                  const payload = {
                    ...result,
                    scoreSource: "ai" as const,
                  };
                  matchStorage.saveMatch({
                    sessionId: session?.id,
                    resumeId,
                    jobDescriptionId: matchJobDescriptionId,
                    sampleName: sampleName ?? undefined,
                    result: payload,
                    aiModel: aiService.getServiceInfo().model,
                    processingTimeMs: Date.now() - startTime,
                  });

                  safeSend("result", {
                    resumeId,
                    result: {
                      resumeId,
                      jobDescriptionId: matchJobDescriptionId,
                      ...payload,
                      matchedAt: new Date().toISOString(),
                      sessionId: session?.id,
                    },
                    progress: {
                      done: cachedAiResults.length + done,
                      total: aiCandidates.length,
                    },
                  });
                },
              }
            );

            aiDone += batchResult.processedCount;
            aiFailed += batchResult.failedCount;
          }

          const finalTopMatches = matchStorage
            .getMatchesByResumeIds(topIds, matchJobDescriptionId)
            .sort((a, b) => b.score - a.score);
          const finalScoreMap = new Map(
            orderedRuleResults.map((entry) => [entry.resumeId, entry.result.score])
          );
          for (const match of finalTopMatches) {
            finalScoreMap.set(match.resumeId, match.score);
          }
          const stats = computeStats(
            Array.from(finalScoreMap.values()).map((score) => ({ score })),
            Date.now() - startTime,
            Math.max(0, aiCandidates.length - aiDone)
          );

          finalizeRun({
            status: "completed",
            processedCount: stats.processed,
            failedCount: aiFailed,
            matchedCount: stats.matched,
            avgScore: stats.avgScore,
          });

          safeSend("done", {
            mode,
            failedCount: aiFailed,
            stats,
          });

          controller.close();
          return;
        }

        const fieldUsagePolicy = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
        const batchResult = await aiService.matchBatch(
          prepared.map((item) => buildAiResumePayload(item)),
          {
            title: jdMeta.title || matchJobDescriptionId,
            requirements,
            responsibilities,
          },
          {
            fieldUsagePolicy,
            onResult: ({ resumeId, result, done, total }) => {
              const payload = {
                ...result,
                scoreSource: "ai" as const,
              };
              matchStorage.saveMatch({
                sessionId: session?.id,
                resumeId,
                jobDescriptionId: matchJobDescriptionId,
                sampleName: sampleName ?? undefined,
                result: payload,
                aiModel: aiService.getServiceInfo().model,
                processingTimeMs: Date.now() - startTime,
              });

              safeSend("result", {
                resumeId,
                result: {
                  resumeId,
                  jobDescriptionId: matchJobDescriptionId,
                  ...payload,
                  matchedAt: new Date().toISOString(),
                  sessionId: session?.id,
                },
                progress: { done, total },
              });
            },
          }
        );
        const stats = computeStats(
          batchResult.results.map((entry) => ({ score: entry.result.score })),
          Date.now() - startTime,
          0
        );
        finalizeRun({
          status: "completed",
          processedCount: stats.processed,
          failedCount: batchResult.failedCount,
          matchedCount: stats.matched,
          avgScore: stats.avgScore,
        });

        safeSend("done", {
          mode,
          failedCount: batchResult.failedCount,
          stats,
        });
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finalizeRun({
          status: "failed",
          processedCount: 0,
          failedCount: prepared.length,
          error: message,
        });
        safeSend("error", { message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

const getResumeMatchesRoute = createRoute({
  method: "get",
  path: "/api/resumes/matches",
  tags: ["resumes"],
  summary: "Get cached resume matches",
  description: "Returns cached match results for a session or job description",
  request: {
    query: ResumeMatchesQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResumeMatchesResponseSchema } },
      description: "Match results",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Missing query parameters",
    },
  },
});

app.openapi(getResumeMatchesRoute, (c) => {
  const { sessionId, jobDescriptionId } = c.req.valid("query");

  if (!sessionId && !jobDescriptionId) {
    return c.json({ success: false, error: "sessionId or jobDescriptionId is required" }, 400);
  }

  const results = sessionId
    ? matchStorage.getMatchesForSession(sessionId, jobDescriptionId)
    : jobDescriptionId
      ? matchStorage.getMatchesForJob(jobDescriptionId)
      : [];

  return c.json(
    {
      success: true as const,
      results: results.map((match) => mapStoredMatch(match)),
    },
    200
  );
});

const getMatchRunsRoute = createRoute({
  method: "get",
  path: "/api/resumes/match-runs",
  tags: ["resumes"],
  summary: "Get resume match run history",
  description: "Returns recent matching runs for backend AI/rule pipeline",
  request: {
    query: MatchRunsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: MatchRunsResponseSchema } },
      description: "Recent run history",
    },
  },
});

app.openapi(getMatchRunsRoute, (c) => {
  const { sessionId, jobDescriptionId, limit } = c.req.valid("query");
  const runs = matchStorage.listMatchRuns({ sessionId, jobDescriptionId, limit });

  return c.json(
    {
      success: true as const,
      runs: runs.map((run) => mapStoredMatchRun(run)),
    },
    200
  );
});

const clearResumeMatchesRoute = createRoute({
  method: "delete",
  path: "/api/resumes/matches",
  tags: ["resumes"],
  summary: "Clear cached resume matches",
  request: {
    query: z.object({
      jobDescriptionId: z.string().optional().openapi({
        param: { name: "jobDescriptionId", in: "query" },
        example: "lathe-sales",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ClearMatchesResponseSchema } },
      description: "Deleted count",
    },
  },
});

app.openapi(clearResumeMatchesRoute, (c) => {
  const { jobDescriptionId } = c.req.valid("query");
  const deleted = matchStorage.clearMatches(jobDescriptionId);

  return c.json({
    success: true as const,
    deleted,
    jobDescriptionId: jobDescriptionId || undefined,
  }, 200);
});

const ResumeExportFormSchema = z.object({
  payload: z.string().min(1),
});

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

const rescoreResumeMatchesRoute = createRoute({
  method: "post",
  path: "/api/resumes/matches/rescore",
  tags: ["resumes"],
  summary: "Re-score resumes with rule engine",
  request: {
    body: {
      content: {
        "application/json": {
          schema: RescoreRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: MatchRescoreResponseSchema } },
      description: "Re-scored results",
    },
    400: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Session or data not found",
    },
  },
});

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
    console.error("Failed to import resumes", error);
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
    console.error("Failed to import manual resumes", error);
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
      console.error("Failed to query candidate_status for backup", error);
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
    console.error("Failed to backup resumes", error);
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
    console.error("Failed to reset resumes", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

app.openapi(rescoreResumeMatchesRoute, async (c) => {
  const { sessionId, sample, source, persist, jobDescriptionId, keywords, location, resumeIds, limit } = c.req.valid("json");
  const normalizedJobDescriptionId = jobDescriptionId?.trim();
  const normalizedKeywords = normalizeKeywords(keywords);
  if (!normalizedJobDescriptionId && normalizedKeywords.length === 0) {
    return c.json({ success: false, error: "jobDescriptionId or keywords is required" }, 400);
  }
  if (!persist) {
    return c.json({ success: false, error: "persist=false is not supported for rescore" }, 400);
  }
  if (source === "convex") {
    return c.json({ success: false, error: "source=convex is not supported for rescore" }, 400);
  }
  const matchJobDescriptionId = normalizedJobDescriptionId
    ? normalizedJobDescriptionId
    : toKeywordJobDescriptionId(normalizedKeywords, location);
  const searchEventQuery = buildSearchEventQuery({
    keywords: normalizedKeywords,
    location,
    jobDescriptionId: normalizedJobDescriptionId,
  });

  const session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  const sampleName = sample ?? session?.sampleName;

  let prepared: PreparedResumeCandidate[] = [];

  try {
    const sampleData = resumeService.loadSample(sampleName);
    prepared = prepareSampleCandidates({
      items: sampleData.items,
      indexMap: sampleData.indexes,
      resumeIds,
      limit,
    });
    if (normalizedJobDescriptionId) {
      jobService.loadFile(normalizedJobDescriptionId);
    }
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const context = normalizedJobDescriptionId
    ? ruleScoringService.buildContext(normalizedJobDescriptionId)
    : ruleScoringService.buildContextFromKeywords(normalizedKeywords, location);
  const scored = scorePreparedCandidates(prepared, context)
    .sort((a, b) => b.result.score - a.result.score);

  const startTime = Date.now();
  const entries = scored.map((entry) => ({
    sessionId: session?.id,
    resumeId: entry.resumeId,
    jobDescriptionId: matchJobDescriptionId,
    sampleName: sampleName ?? undefined,
    result: ruleScoringService.toMatchingResult(entry.result),
    aiModel: "rule-scoring",
    processingTimeMs: Date.now() - startTime,
  }));

  if (entries.length > 0) {
    matchStorage.saveMatches(entries);
  }

  const results = scored.map((entry) => buildRuleMatchResponseEntry({
    candidate: entry.candidate,
    result: entry.result,
    jobDescriptionId: matchJobDescriptionId,
    sessionId: session?.id,
  }));
  if (searchEventQuery) {
    searchEventLogger.logSearchQuery({
      query: searchEventQuery,
      resultCount: results.length,
      topScore: results[0]?.score,
    });
  }

  return c.json(
    MatchResponseSchema.parse({
      success: true as const,
      mode: "rules_only",
      query: buildMatchQueryMetadata({
        source,
        persisted: persist,
        keywordExpansion: normalizedKeywords.length > 0
          ? resumeService.expandSearchQuery(formatKeywordQuery(normalizedKeywords))
          : undefined,
        context,
      }),
      results,
      stats: computeStats(results, Date.now() - startTime, 0),
    }),
    200
  );
});

async function buildResumeExportResponse(request: ResumeExportCanonicalRequest) {
  const { format, entries, batchMeta, industryDbV2Stats, debug } = await resolveExportRequest(request);
  const file = await exportService.exportResumes(format, entries, batchMeta, industryDbV2Stats, debug);
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

async function parseResumeExportDownloadRequest(c: Context) {
  const formData = await c.req.formData();
  const parsedForm = ResumeExportFormSchema.parse({
    payload: formData.get("payload"),
  });
  return ResumeExportCanonicalRequestSchema.parse(JSON.parse(parsedForm.payload));
}

function buildResumeExportErrorResponse(c: Context, error: unknown) {
  if (error instanceof DataNotFoundError) {
    return c.json({ success: false, error: error.message }, 404);
  }

  console.error("Failed to export resumes:", error);
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ success: false, error: message }, 500);
}

function buildReviewPacketErrorResponse(c: Context, error: unknown) {
  if (error instanceof DataNotFoundError) {
    return c.json({ success: false as const, error: error.message }, 404);
  }

  console.error("Review packet flow failed:", error);
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

type ReviewPacketStatusListItem = {
  identityKey: string;
  status: string;
};

function toReviewPacketStatusListItem(value: unknown): ReviewPacketStatusListItem | null {
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

app.openapi(exportResumesRoute, async (c) => {
  try {
    const request = c.req.valid("json");
    return await buildResumeExportResponse(request);
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

app.post("/api/resumes/export/download", async (c) => {
  try {
    const request = await parseResumeExportDownloadRequest(c);
    return await buildResumeExportResponse(request);
  } catch (error) {
    return buildResumeExportErrorResponse(c, error);
  }
});

app.post("/api/resumes/learning-feedback", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LearningFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request: observation is required" }, 400);
  }

  try {
    const learningEntry = await workspaceConfigService.appendLearningLogEntry(
      c.var.workspaceSlug,
      parsed.data.observation
    );
    const entry = `- ${learningEntry.date}: ${learningEntry.observation}`;
    if (parsed.data.action && parsed.data.resumeId) {
      searchEventLogger.logCandidateAction({
        resumeId: parsed.data.resumeId,
        action: parsed.data.action,
        query: parsed.data.query,
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

    if (shouldTriggerSkillsReingest(parsed.data.observation)) {
      bumpedVersion = skillsKnowledgeService.getVersion();
      reingest = await triggerReingestStaleSkillsVersion(parsed.data.autoReingestLimit ?? 200);
    }

    return c.json({ success: true, entry, bumpedVersion, reingest }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

app.get("/api/resumes/analysis-tasks", async (c) => {
  try {
    const tasks = (await callConvexQuery("analysis_tasks:list", {})) as Array<{
      _id: string;
      status: string;
      _creationTime: number;
      config?: {
        jobDescriptionId?: string;
        jobDescriptionTitle?: string;
        keywords?: string[];
        location?: string;
        promptVersion?: number;
        resumeCount?: number;
      };
      progress?: { current?: number; total?: number; skipped?: number };
      results?: {
        analyzed?: number;
        failed?: number;
        avgScore?: number;
        highScoreCount?: number;
      };
      lastStatus?: string;
      error?: string;
    }>;

    return c.json(
      AnalysisTasksResponseSchema.parse({
        success: true,
        tasks,
      }),
      200,
    );
  } catch (error) {
    console.error("Failed to list analysis tasks", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

app.get("/api/resumes/skills-version", (c) => {
  const version = skillsKnowledgeService.getVersion();
  return c.json({ success: true, version }, 200);
});

app.get("/api/resumes/field-coverage", async (c) => {
  const total = { scanned: 0, missingSearchText: 0, missingVerifiedRoleYears: 0, hasRoleSignals: 0 };
  let cursor: string | null = null;

  for (let i = 0; i < 100; i++) {
    const batch = await callConvexQuery("resumes:fieldCoverage", {
      cursor,
      batchSize: 200,
    }) as {
      scanned: number;
      missingSearchText: number;
      missingVerifiedRoleYears: number;
      hasRoleSignals: number;
      hasMore: boolean;
      cursor: string | null;
    };
    total.scanned += batch.scanned;
    total.missingSearchText += batch.missingSearchText;
    total.missingVerifiedRoleYears += batch.missingVerifiedRoleYears;
    total.hasRoleSignals += batch.hasRoleSignals;

    if (!batch.hasMore) break;
    cursor = batch.cursor;
  }

  return c.json({ success: true, ...total }, 200);
});

const listResumeDiagnosticsRoute = createRoute({
  method: "get",
  path: "/api/resumes/diagnostics",
  tags: ["resumes"],
  summary: "List resume diagnostics rows with optional archived/source filters",
  request: {
    query: ResumeDiagnosticsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeDiagnosticsResponseSchema,
        },
      },
      description: "Diagnostics rows",
    },
  },
});

app.openapi(listResumeDiagnosticsRoute, async (c) => {
  const {
    archived,
    sourceKey,
    limit,
  } = c.req.valid("query");

  const includeArchived = archived === true;
  const requestedLimit = Math.min(Math.max(limit ?? 100, 1), 500);
  const normalizedSourceKeys = normalizeResumeDiagnosticsSourceKeys(sourceKey);
  const pathName = includeArchived ? "resumes:listArchivedDiagnostics" : "resumes:listIngestDiagnostics";
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let rounds = 0; rounds < 100 && rows.length < requestedLimit; rounds += 1) {
    const value = await callConvexQuery(pathName, {
      paginationOpts: {
        cursor,
        numItems: Math.min(requestedLimit - rows.length, 100),
      },
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
    });

    if (!isConvexPaginatedQueryPage(value)) {
      throw new Error(`Unexpected diagnostics page payload for ${pathName}`);
    }

    rows.push(...value.page);
    if (value.isDone) {
      break;
    }

    cursor = value.continueCursor ?? null;
    if (!cursor) {
      break;
    }
  }

  return c.json(ResumeDiagnosticsResponseSchema.parse({
    success: true as const,
    summary: {
      archived: includeArchived,
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
      returned: rows.length,
      limit: requestedLimit,
    },
    data: rows,
  }), 200);
});

const getResumeDetailRoute = createRoute({
  method: "get",
  path: "/api/resumes/{resumeId}",
  tags: ["resumes"],
  summary: "Get one resume with detailed work experience",
  description: "Returns one resume including structured work history for UI or CLI inspection",
  request: {
    params: ResumeDetailPathParamSchema,
    query: ResumesQuerySchema.pick({
      sample: true,
      source: true,
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeDetailResponseSchema,
        },
      },
      description: "Resume detail",
    },
    404: {
      content: {
        "application/json": {
          schema: SimpleErrorSchema,
        },
      },
      description: "Resume not found",
    },
  },
});

app.openapi(getResumeDetailRoute, async (c) => {
  const resumeId = c.req.param("resumeId").trim();
  const { sample, source } = c.req.valid("query");
  const sampleName = sample?.trim() || undefined;

  if (source === "convex") {
    const resume = await getConvexResumeDetail(resumeId);
    if (!resume) {
      return c.json({
        success: false as const,
        error: `Resume not found: ${resumeId}`,
      }, 404);
    }

    return c.json({
      success: true as const,
      source,
      data: resume,
    }, 200);
  }

  try {
    const { items, sample: sampleInfo } = resumeService.loadSample(sampleName);
    const resume = findSampleResumeByIdentifier(items, resumeId);
    if (!resume) {
      return c.json({
        success: false as const,
        error: `Resume not found: ${resumeId}`,
      }, 404);
    }

    return c.json({
      success: true as const,
      source,
      sample: sampleInfo,
      data: resume,
    }, 200);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({
        success: false as const,
        error: error.message,
      }, 404);
    }
    throw error;
  }
});

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
      // Dry run: count resumes with computed fields without mutating
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

    // Phase 1: Clear all computed fields via paginated mutation
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

    // Phase 2: Schedule full re-ingest
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
      // Partial failure: clearing succeeded but scheduling failed
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
      // Dry run: count resumes with analysis fields without mutating
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

    // Full execution: paginated clearing
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

      // Targeted clears are single-batch
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
      // Dry run: count documents per table without deleting
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

app.post("/api/resumes/trigger-reingest", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = TriggerReingestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  try {
    const result = await triggerReingestStaleSkillsVersion(parsed.data.limit ?? 200);
    return c.json({ success: true, ...result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// Internal endpoint for ingest compute (called by Convex action)
app.post("/api/resumes/ingest-compute", async (c) => {
  const body = await c.req.json();
  const resumes = body.resumes as Array<{ resumeId: string; content: unknown }>;

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

app.post("/api/resumes/analyze", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid request payload" }, 400);
  }

  const {
    query,
    jobDescriptionId,
    location,
    minExperience,
    maxExperience,
    education,
    skills,
    requiredKeywords,
    locations: locationFilters,
    minSalary,
    maxSalary,
    limit,
    dryRun,
  } = parsed.data;

  const normalizedQuery = query?.trim() || "";
  const normalizedJobDescriptionId = jobDescriptionId?.trim() || "";

  if (!normalizedQuery && !normalizedJobDescriptionId) {
    return c.json(
      { success: false, error: "Either query or jobDescriptionId is required" },
      400,
    );
  }

  const keywords = normalizedQuery
    ? normalizeKeywords(parseKeywordQuery(normalizedQuery).keywords)
    : undefined;

  const responseConfig = {
    ...(normalizedJobDescriptionId ? { jobDescriptionId: normalizedJobDescriptionId } : {}),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
    ...(location ? { location } : {}),
  };
  const searchLocations = [
    ...(location ? [location.trim()] : []),
    ...(locationFilters ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
  ];

  try {
    const canonicalKeywordQuery = keywords
      ? formatKeywordQuery(keywords)
      : "";
    const keywordExpansion = resumeService.expandSearchQuery(canonicalKeywordQuery);

    const searchArgs: Record<string, unknown> = {
      query: canonicalKeywordQuery || normalizedQuery,
      keywordGroups: keywordExpansion?.groups ?? [],
      mode: keywordExpansion?.mode ?? "OR",
      sourceMappings: sourceMappingEntries(keywordExpansion?.sourceMapping),
      ...(normalizedJobDescriptionId ? { jobDescriptionId: normalizedJobDescriptionId } : {}),
      ...(minExperience !== undefined ? { minExperience } : {}),
      ...(maxExperience !== undefined ? { maxExperience } : {}),
      ...(education && education.length > 0 ? { education } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(requiredKeywords && requiredKeywords.length > 0 ? { requiredKeywords } : {}),
      ...(searchLocations.length > 0 ? { locations: searchLocations } : {}),
      ...(minSalary !== undefined ? { minSalary } : {}),
      ...(maxSalary !== undefined ? { maxSalary } : {}),
      paginationOpts: { numItems: limit, cursor: null },
    };

    const searchResult = (await callConvexQuery(
      "resumes:searchWithTagExpansionPaginated",
      searchArgs,
    )) as {
      page: Array<{ resume: { _id: string } }>;
      continuationCursor: string | null;
    };

    const resumeIds = (searchResult.page ?? []).map((item) => item.resume._id);

    if (dryRun) {
      return c.json(
        AnalyzeResponseSchema.parse({
          success: true,
          dryRun: true,
          resumeCount: resumeIds.length,
          config: responseConfig,
        }),
        200,
      );
    }

    if (resumeIds.length === 0) {
      return c.json(
        AnalyzeResponseSchema.parse({
          success: true,
          resumeCount: 0,
          config: responseConfig,
        }),
        200,
      );
    }

    let jobDescriptionTitle: string | undefined;
    let jobDescriptionContent: string | undefined;

    if (normalizedJobDescriptionId) {
      try {
        const jdData = jobService.loadFile(normalizedJobDescriptionId);
        jobDescriptionTitle = jdData.title;
        jobDescriptionContent = jdData.content;
      } catch {
        // JD file not found locally — the Convex dispatch will use keywords only
      }
    }

    const dispatchResult = (await callConvexMutation("analysis_tasks:dispatch", {
      ...(normalizedJobDescriptionId
        ? { jobDescriptionId: normalizedJobDescriptionId }
        : {}),
      ...(jobDescriptionTitle ? { jobDescriptionTitle } : {}),
      ...(jobDescriptionContent ? { jobDescriptionContent } : {}),
      ...(keywords && keywords.length > 0 ? { keywords } : {}),
      ...(location ? { location } : {}),
      resumeIds,
    })) as string;

    return c.json(
      AnalyzeResponseSchema.parse({
        success: true,
        taskId: dispatchResult,
        resumeCount: resumeIds.length,
        config: responseConfig,
      }),
      200,
    );
  } catch (error) {
    console.error("Failed to dispatch analysis", error);
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});


export default app;
