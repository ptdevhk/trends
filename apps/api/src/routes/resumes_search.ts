import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import {
  ResumeService,
  normalizeEducationLevel,
  parseExperienceYears,
  type ResumeFilters,
} from "../services/resume-service.js";
import { AIMatchingService, type MatchingResult } from "../services/ai-matching.js";
import { MatchStorage, type MatchRunMode, type StoredMatch, type StoredMatchRun } from "../services/match-storage.js";
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import { RuleScoringService, type RuleScoringContext, type RuleScoringResult } from "../services/rule-scoring.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { DataNotFoundError } from "../services/errors.js";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeKeywordExpansionQuerySchema,
  ResumeKeywordExpansionResponseSchema,
  ResumeSamplesResponseSchema,
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
  MatchRunsResponseSchema,
  MatchRunsQuerySchema,
  SimpleErrorSchema,
  ClearMatchesResponseSchema,
} from "../schemas/index.js";
import { resolveResumeId } from "../services/resume-id.js";
import { callConvexAction, callConvexQuery, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import {
  formatKeywordQuery,
  parseKeywordQuery,
} from "@trends/shared";
import { isRecord } from "@trends/shared";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
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
  normalizeMatchRecommendations,
  hasResumeListFilters,
  resolveResumeSortOrder,
  toResumeItemFromRecord,
  prepareResumeCandidate,
  prepareConvexCandidates,
  dedupeResumeSearchProvenance,
  resolveProjectedResumeRuleScore,
  buildKeywordExpansionSummary,
  filterPreparedCandidatesByResumeFilters,
  createResumeMatchContextMap,
  loadResumeMatchContextMap,
  buildAiResumePayload,
  buildSearchEventQuery,
  toKeywordJobDescriptionId,
  createSsePayload,
  buildKeywordRequirements,
  buildKeywordResponsibilities,
  MAX_SAFE_CONVEX_POST_FILTER_LIMIT,
  MATCH_STORAGE_FILTER_SCAN_BATCH_SIZE,
} from "../services/resume-candidate-prep.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
const searchEventLogger = new SearchEventLogger(config.projectRoot);

const DEFAULT_AI_TOP_N = 20;
const DEFAULT_CONVEX_RESUME_PAGE_SIZE = 50;
const MAX_SAFE_CONVEX_POST_FILTER_SCAN = 250;

type ResumeSource = "sample" | "convex";
type MatchMode = "rules_only" | "hybrid" | "ai_only";

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
    const value = await callConvexQuery("resumes_search:searchWithTagExpansionScanPage", {
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
      resumeIds: matchPage.matches.map((match) => match.resumeId),
      resumeService,
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
    enableSemantic,
    semanticWeight,
    semanticLimit,
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
        let hybridSearchMode: "bm25" | "bm25_fallback" | "bm25_only_no_vectors" | "hybrid" | undefined;

        // Hybrid search path: when enableSemantic=true and there's a keyword query,
        // call hybridSearchResumes which does BM25 + vector + RRF merge in Convex.
        if (enableSemantic && keyword) {
          try {
            const hybridResult = await callConvexAction("embeddings:hybridSearchResumes", {
              query: keyword,
              keywordGroups: keywordExpansion?.groups ?? [],
              sourceMappings: Object.entries(keywordExpansion?.sourceMapping ?? {}).map(([term, expandedFrom]) => ({
                term,
                expandedFrom,
              })),
              minExperience,
              maxExperience,
              minRoleYears,
              roleFilterType,
              minAge,
              maxAge,
              education,
              skills,
              requiredKeywords: normalizedRequiredKeywords,
              locations,
              minSalary,
              maxSalary,
              sources,
              jobDescriptionId: resolvedJobId,
              sortBy: sortBy === "score" ? undefined : sortBy,
              sortOrder,
              semanticWeight,
              semanticLimit,
              enableSemantic: true,
            }) as Record<string, unknown>;

            hybridSearchMode = (typeof hybridResult.searchMode === "string" ? hybridResult.searchMode : undefined) as typeof hybridSearchMode;

            if (isRecord(hybridResult) && Array.isArray(hybridResult.results)) {
              const hybridResults = hybridResult.results as Array<Record<string, unknown>>;
              const hybridExpansion = isRecord(hybridResult.expansion) ? hybridResult.expansion : null;

              prepared = hybridResults.map((entry) => {
                const resumeRecord = isRecord(entry.resume) ? entry.resume : {};
                const resume = toResumeItemFromRecord(resumeRecord);
                const resumeId = toStringValue(resumeRecord._id) ?? resolveResumeId(resume, 0);
                return prepareResumeCandidate({
                  resume,
                  resumeId,
                  ingestData: isRecord(resumeRecord) ? resumeRecord.ingestData : undefined,
                });
              });

              if (hybridExpansion && Array.isArray(hybridExpansion.groups)) {
                liveExpansion = {
                  flatTerms: (hybridExpansion.expanded as string[]) ?? [],
                  groups: (hybridExpansion.groups as Array<{ original: string; variants: string[] }>) ?? [],
                  mode: "AND" as const,
                  originalKeyword: keyword,
                  sourceMapping: keywordExpansion?.sourceMapping ?? {},
                };
              }

              totalCount = typeof hybridResult.total === "number" ? hybridResult.total : prepared.length;
              usedServerSideFilters = true;
            }
          } catch (err) {
            console.error("Hybrid search failed, falling back to BM25-only:", err);
            hybridSearchMode = "bm25_fallback";
            // Fall through to existing BM25 paths below
            prepared = [];
            totalCount = undefined;
            usedServerSideFilters = false;
          }
        }

        if (prepared.length === 0 && !hybridSearchMode) {
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
                resumeService,
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
            resumeService,
          });
          prepared = preparedResult.prepared;
          liveExpansion = preparedResult.keywordExpansion;
          totalCount = preparedResult.total;
          usedServerSideFilters = preparedResult.usedServerSideFilters ?? false;
        }
        } // end if (prepared.length === 0 && !hybridSearchMode)

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
            matchStorage,
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
            searchMode: hybridSearchMode,
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
        logger.error(`[Resumes] Failed to compute rule score map for ${resolvedJobId}:`, error, { route: "resumes_search" });
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
  if (typeof value.searchText === 'string') {
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
        resumeService,
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


export default app;
