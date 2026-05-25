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
  SimpleErrorSchema,
  ClearMatchesResponseSchema,
  ResumeResetResponseSchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService, normalizeEducationLevel, parseExperienceYears, type ResumeFilters } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { resolveConvexUrl } from "../services/resume-import-service.js";
import { AIMatchingService, type MatchingResult } from "../services/ai-matching.js";
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
  type RuleScoringContext,
  type RuleScoringResult,
} from "../services/rule-scoring.js";
import { resolveResumeId } from "../services/resume-id.js";
import {
  formatKeywordQuery,
  parseKeywordQuery,
} from "@trends/shared";
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
import { logger } from "../services/logger.js";
import { requireAdmin } from "../middleware/workspace.js";

import { isRecord } from "@trends/shared";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";
import {
  callConvexQuery,
  callConvexMutation,
  isConvexPaginatedQueryPage,
} from "../services/convex-utils.js";
import {
  buildResumeIngestData,
  toOptionalNumber,
  toStringValue,
} from "../services/resume-ingest-utils.js";
import {
  type ResumeKeywordExpansion,
  type ResumeSearchProvenance,
  type PreparedResumeCandidate,
  type ResumeMatchContext,
  type ResumeMatchContextEntry,
  type ExactKeywordScanCandidate,
  type SortableKeywordMatchEntry,
  normalizeKeywords,
  sourceMappingEntries,
  parseConvexProvenance,
  collectBffAndModeProvenance,
  hasResumeListFilters,
  resolveResumeSortOrder,
  toResumeItemFromRecord,
  prepareResumeCandidate,
  prepareConvexCandidates,
  dedupeResumeSearchProvenance,
  resolveProjectedResumeRuleScore,
  filterPreparedCandidatesByResumeFilters,
  createResumeMatchContextMap,
  loadResumeMatchContextMap,
  buildSearchEventQuery,
  toKeywordJobDescriptionId,
  MAX_SAFE_CONVEX_POST_FILTER_LIMIT,
  MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
} from "../services/resume-candidate-prep.js";

const app = new OpenAPIHono();
app.use("/api/resumes/candidate-actions/reset", requireAdmin);
app.use("/api/resumes/trigger-reingest", requireAdmin);
app.use("/api/resumes/analyze", requireAdmin);
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

type MatchMode = "rules_only" | "hybrid" | "ai_only";

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
const ResumeImportErrorSchema = SimpleErrorSchema;

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
  try {
    const request = c.req.valid("json");
    const workspaceSlug = request.workspaceSlug || c.var.workspaceSlug;
    const deleted = actionStorage.clearActionsForWorkspace(workspaceSlug, true);
    return c.json(ResetCandidateActionsResponseSchema.parse({ success: true, deleted }), 200);
  } catch (error) {
    logger.error("Failed to reset candidate actions", error, { route: "resumes" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false as const, error: message }, 500);
  }
});

type ResumeSource = "sample" | "convex";

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
    indexData: params.indexMap.get(item.resumeId),
  }));
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
    matchStorage,
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
      resumeService,
      resumeIds: matchPage.matches.map((match) => match.resumeId),
    })).prepared;
    const filteredBatch = filterPreparedCandidatesByResumeFilters(preparedBatch, params.resumeFilters, resumeService);
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
      content: {
        "application/json": {
          schema: MatchRescoreResponseSchema,
        },
      },
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
    logger.error("Failed to dispatch analysis", error, { route: "resumes" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});


export default app;
