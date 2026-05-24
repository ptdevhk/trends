import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeDetailPathParamSchema,
  ResumeDetailResponseSchema,
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
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
  MatchRunsResponseSchema,
  MatchRunsQuerySchema,
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService, normalizeEducationLevel, parseExperienceYears, type ResumeFilters } from "../services/resume-service.js";
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
  type BrandHit,
  type RoleSignalSummary,
  type RuleScoringContext,
  type RuleScoringResult,
} from "../services/rule-scoring.js";
import { resolveResumeId } from "../services/resume-id.js";
import {
  buildLatestWorkHistoryEvidence,
  buildWorkHistoryEntryText,
  formatKeywordQuery,
  formatLocationHierarchySearchText,
  normalizeKeywordPhrases,
  normalizeWorkHistoryEntry,
  parseKeywordQuery,
  parseSalaryRange,
  selectLatestWorkHistory,
} from "@trends/shared";
import { bffMatchesResumeFilters } from "../services/bff-filter-utils.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import { ActionStorage } from "../services/action-storage.js";
import { submitResumeImport } from "../services/resume-import-service.js";
import { getManualResumeImportMaxUploadBytes, importManualResumes } from "../services/manual-resume-import-service.js";
import { notificationService } from "../services/notification-service.js";
import { notificationTemplateService } from "../services/notification-template-service.js";
import { formatIsoOffsetInTimezone } from "../services/timezone.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { BrandDisplayResolver } from "../services/brand-display-resolver.js";

import { isRecord, buildKeywordAnalysisId, getCurrentResumeAiPromptVersion, resolveResumeAnalysisSourceKey } from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";
import {
  callConvexQuery,
  callConvexMutation,
  callConvexAction,
  isConvexPaginatedQueryPage,
  type ConvexPaginatedQueryPage,
} from "../services/convex-utils.js";
import {
  buildResumeIngestData,
  parseBrandHits,
  parseRoleSignals,
  toOptionalNumber,
  toStringArray,
  toStringValue,
} from "../services/resume-ingest-utils.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
const searchEventLogger = new SearchEventLogger(config.projectRoot);
const actionStorage = new ActionStorage(config.projectRoot);

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
  deleted: z.record(z.string(), z.number().int()),
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
    ...(typeof record.searchText === 'string' ? { searchText: record.searchText } : {}),
  };
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
    showArchived?: boolean;
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

    // AND-mode full-table-scan search: when the keyword expansion yields AND mode,
    // paginate ALL resumes from Convex and filter in-memory.  This avoids two
    // Convex platform limits that the search-index approaches hit:
    //   1. Search index returns at most 1024 results per query (BM25-ranked).
    //      Resumes with long searchText (6KB+ from AI analysis / synonyms) score
    //      low and fall beyond the 1024-position cutoff, making them invisible.
    //   2. Convex action memory limit (64 MB) prevents full-table scan inside
    //      a Convex action.  BFF (Node.js) has no such limit.
    if (keywordExpansion?.mode === "AND") {
      const allResults: PreparedResumeCandidate[] = [];
      let scanCursor: string | null = null;
      const groups = keywordExpansion.groups;
      const filters = params.filters;
      const loweredGroups = groups.map((g) => ({
        ...g,
        loweredVariants: g.variants.map((v: string) => v.toLowerCase()),
      }));

      // Phase 1: Scan all docs with slim projection (no content/ingestData).
      // Only collect IDs of docs matching keyword groups + basic filters.
      const matchingIds: string[] = [];
      while (true) {
        const page = await callConvexQuery("resumes:scanResumePageSlim", {
          ...(scanCursor ? { cursor: scanCursor } : {}),
          numItems: 1000,
        });

        if (!isRecord(page) || !Array.isArray(page.docs)) {
          break;
        }

        for (const doc of page.docs) {
          if (!isRecord(doc)) continue;
          const searchText = typeof doc.searchText === "string" ? doc.searchText.toLowerCase() : "";
          const allGroupsMatch = loweredGroups.every((group) =>
            group.loweredVariants.some((lv: string) => searchText.includes(lv))
          );
          if (!allGroupsMatch) continue;

          // Basic filters that can run on slim projection
          if (filters) {
            if (typeof filters.minAge === 'number' && typeof doc.age === 'number' && doc.age < filters.minAge) continue;
            if (typeof filters.maxAge === 'number' && typeof doc.age === 'number' && doc.age > filters.maxAge) continue;
            if (Array.isArray(filters.sources) && filters.sources.length > 0) {
              const resumeSourceKey = (typeof doc.sourceKey === 'string' ? doc.sourceKey : undefined)
                ?? resolveResumeAnalysisSourceKey({ source: typeof doc.source === 'string' ? doc.source : undefined });
              if (!resumeSourceKey || !filters.sources.includes(resumeSourceKey)) continue;
            }
          }

          const resumeId = toStringValue(doc._id);
          if (resumeId) matchingIds.push(resumeId);
        }

        if (!page.cursor || page.isDone) break;
        scanCursor = toStringValue(page.cursor) ?? null;
      }

      // Phase 2: Fetch full docs only for matches, then apply remaining filters.
      const BATCH_SIZE = 100;
      for (let i = 0; i < matchingIds.length; i += BATCH_SIZE) {
        const batchIds = matchingIds.slice(i, i + BATCH_SIZE);
        const fullDocs = await callConvexQuery("resumes:getResumeDocsByIds", {
          ids: batchIds,
        });

        if (!isRecord(fullDocs) || !Array.isArray(fullDocs)) continue;

        for (const doc of fullDocs) {
          if (!isRecord(doc)) continue;
          const resumeId = toStringValue(doc._id);
          if (!resumeId) continue;

          const searchText = typeof doc.searchText === "string" ? doc.searchText.toLowerCase() : "";

          // Apply remaining filters that need full docs (role, education, etc.)
          if (filters && !bffMatchesResumeFilters(doc, searchText, filters)) continue;

          const provenance = collectBffAndModeProvenance(searchText, groups, keywordExpansion.sourceMapping);
          const resume = toResumeItemFromRecord(isRecord(doc.content) ? doc.content : {}, toStringValue(doc.source));
          // Override resumeId with Convex _id so the frontend can use it
          // for Convex mutations (dispatch analysis, etc.). Content's
          // resumeId is a source-specific ID (e.g., "13467969") that
          // doesn't match v.id("resumes").
          resume.resumeId = resumeId;
          // Propagate Convex doc-level fields that the frontend's mapResumeDoc
          // reads from the doc (not from content). Without these, analysis
          // scores never appear on AND-mode search results.
          if (doc.analysis !== undefined && doc.analysis !== null) {
            (resume as Record<string, unknown>).analysis = doc.analysis;
          }
          if (doc.analyses !== undefined && doc.analyses !== null) {
            (resume as Record<string, unknown>).analyses = doc.analyses;
          }
          if (typeof doc.identityKey === "string") {
            (resume as Record<string, unknown>).identityKey = doc.identityKey;
          }
          if (typeof doc.crawledAt === "number") {
            (resume as Record<string, unknown>).crawledAt = doc.crawledAt;
          }
          if (Array.isArray(doc.tags)) {
            (resume as Record<string, unknown>).tags = doc.tags;
          }
          if (typeof doc.searchText === "string") {
            resume.searchText = doc.searchText;
          }
          allResults.push(prepareResumeCandidate({
            resume,
            resumeId,
            primaryRuleScore: toOptionalNumber(doc.primaryRuleScore),
            provenance,
            ingestData: doc.ingestData,
          }));
        }
      }

      const hasActiveFilters = filters ? hasResumeListFilters(filters) : false;
      return {
        prepared: allResults,
        keywordExpansion,
        total: allResults.length,
        usedServerSideFilters: hasActiveFilters,
      };
    }

    // OR-mode or mode-less with paged/filters: single-pass cursor scan
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

          const resumeItem = toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source));
          if (typeof resumeRecord.searchText === 'string') {
            resumeItem.searchText = resumeRecord.searchText;
          }
          allResults.push(prepareResumeCandidate({
            resume: resumeItem,
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

      const resumeItem = toResumeItemFromRecord(isRecord(resumeRecord.content) ? resumeRecord.content : {}, toStringValue(resumeRecord.source));
      if (typeof resumeRecord.searchText === 'string') {
        resumeItem.searchText = resumeRecord.searchText;
      }
      return [prepareResumeCandidate({
        resume: resumeItem,
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
      const resumeItem = toResumeItemFromRecord(isRecord(item.content) ? item.content : {}, toStringValue(item.source));
      if (typeof item.searchText === 'string') {
        resumeItem.searchText = item.searchText;
      }
      return [prepareResumeCandidate({
        resume: resumeItem,
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
  const resumeItem = toResumeItemFromRecord(
    isRecord(resumeRecord.content) ? resumeRecord.content : {},
    toStringValue(resumeRecord.source),
  );
  if (typeof resumeRecord.searchText === 'string') {
    resumeItem.searchText = resumeRecord.searchText;
  }
  const candidate = prepareResumeCandidate({
    resume: resumeItem,
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
  // Convex's matchesResumeListFilters already handled these 8 fields,
  // so strip them to avoid double-filtering. Other fields (experience,
  // education, salary) are intentionally re-applied by BFF — the
  // double-filter is benign because both paths use the same content fields.
  // skills/requiredKeywords were previously re-applied but this created a
  // bug risk: if searchText is missing on a ResumeItem, BFF falls back to
  // the narrow buildBffSearchText which could exclude resumes that Convex
  // correctly included via full searchText.
  const { minRoleYears, roleFilterType, minAge, maxAge, sources, locations, skills, requiredKeywords, ...rest } = filters;
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

// Collect provenance for AND-mode search results from BFF-side matching.
function collectBffAndModeProvenance(
  searchText: string,
  groups: Array<{ original: string; variants: string[] }>,
  sourceMapping: Record<string, string>,
): ResumeSearchProvenance[] {
  const provenance: ResumeSearchProvenance[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const variant of group.variants) {
      const normalized = variant.toLowerCase();
      if (searchText.includes(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        provenance.push({
          term: variant,
          source: "searchText",
          expandedFrom: sourceMapping[variant],
        });
      }
    }
  }
  return provenance;
}

function resolveResumeSortOrder(sortBy: "score" | "name" | "experience" | "extractedAt" | undefined, sortOrder: "asc" | "desc" | undefined): "asc" | "desc" | undefined {
  if (!sortBy || sortBy === "score") {
    return sortOrder;
  }
  return sortOrder || "asc";
}

export async function triggerReingestStaleSkillsVersion(limit: number): Promise<{
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

export function shouldTriggerSkillsReingest(observation: string): boolean {
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
  if (typeof value.searchText === "string") {
    resume.searchText = value.searchText;
  }
  const ingestData = buildResumeIngestData(value.ingestData);

  return ingestData
    ? {
        ...resume,
        ingestData,
      }
    : resume;
}


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
