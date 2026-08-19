import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ResumeService,
  normalizeEducationLevel,
  parseExperienceYears,
  type ResumeFilters,
} from "../services/resume-service.js";
import { type MatchingResult } from "../services/ai-matching.js";
import { MatchStorage } from "../services/match-storage.js";
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
  CANDIDATE_STATUS_VALUES,
} from "../schemas/index.js";
import { resolveResumeId } from "../services/resume-id.js";
import { callConvexAction, callConvexQuery, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import { requireWorkspacePermission } from "../services/workspace-permissions.js";
import {
  formatKeywordQuery,
  parseKeywordQuery,
} from "@trends/shared";
import { isRecord } from "@trends/shared";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { listCandidateBlocks } from "../services/candidate-block-service.js";
import { getIndustryReviewAccessError } from "../middleware/auth.js";
import { ResumePolicyEnforcer } from "../services/resume-policy-enforcer.js";
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
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
const searchEventLogger = new SearchEventLogger(config.projectRoot);

const DEFAULT_CONVEX_RESUME_PAGE_SIZE = 50;
const MAX_SAFE_CONVEX_POST_FILTER_SCAN = 250;
type CandidateStatus = typeof CANDIDATE_STATUS_VALUES[number];
type CandidateStatusCounts = Record<CandidateStatus, number>;
const CANDIDATE_STATUS_SET: ReadonlySet<string> = new Set(CANDIDATE_STATUS_VALUES);

function createCandidateStatusCounts(): CandidateStatusCounts {
  return {
    new: 0,
    shortlisted: 0,
    rejected: 0,
    contacted: 0,
    interviewing: 0,
    interviewed_pass: 0,
    interviewed_reject: 0,
    appeal_submitted: 0,
    human_review: 0,
    upheld: 0,
    reversed: 0,
    offer: 0,
    hired: 0,
    withdrawn: 0,
  };
}

function isCandidateStatus(value: string): value is CandidateStatus {
  return CANDIDATE_STATUS_SET.has(value);
}

function resolveCandidateStatus(value: string | undefined): CandidateStatus {
  return value && isCandidateStatus(value) ? value : "new";
}

type CandidateStatusContext = {
  statusByIdentity: Map<string, string>;
  blockedIdentities: Set<string>;
};

function normalizeStatusFilters(values: string[] | undefined): CandidateStatus[] {
  if (!values?.length) {
    return [];
  }

  const normalized: CandidateStatus[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!isCandidateStatus(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function getResumeIdentityKey(item: { resume: ResumeItem }): string | undefined {
  const resumeRecord = item.resume as Record<string, unknown>;
  return typeof resumeRecord.identityKey === "string" && resumeRecord.identityKey.trim().length > 0
    ? resumeRecord.identityKey
    : undefined;
}

function getCandidateStatus(item: { resume: ResumeItem }, context: CandidateStatusContext): CandidateStatus {
  const identityKey = getResumeIdentityKey(item);
  return identityKey ? resolveCandidateStatus(context.statusByIdentity.get(identityKey)) : "new";
}

function matchesStatusFilter(
  item: { resume: ResumeItem },
  context: CandidateStatusContext,
  activeFilters: CandidateStatus[],
): boolean {
  const identityKey = getResumeIdentityKey(item);
  if (identityKey && context.blockedIdentities.has(identityKey)) {
    return false;
  }
  if (activeFilters.length === 0) {
    return true;
  }

  const status = getCandidateStatus(item, context);
  return activeFilters.some((filterValue) => status === filterValue);
}

async function loadCandidateStatusContext(
  workspaceSlug: string,
  showBlocked: boolean | undefined,
): Promise<CandidateStatusContext> {
  const [statusList, blockList] = await Promise.all([
    callConvexQuery("candidate_status:list", {
      workspaceSlug,
    }) as Promise<Array<{ identityKey?: string; status?: string }>>,
    showBlocked
      ? Promise.resolve([] as Array<{ identityKey?: string }>)
      : listCandidateBlocks(workspaceSlug),
  ]);

  const statusByIdentity = new Map<string, string>();
  for (const statusItem of statusList) {
    if (statusItem.identityKey && statusItem.status) {
      statusByIdentity.set(String(statusItem.identityKey), String(statusItem.status));
    }
  }

  const blockedIdentities = new Set<string>();
  for (const block of blockList) {
    if (block.identityKey) {
      blockedIdentities.add(String(block.identityKey));
    }
  }

  return { statusByIdentity, blockedIdentities };
}

function countCandidateStatuses(
  items: Array<{ resume: ResumeItem }>,
  context: CandidateStatusContext,
): CandidateStatusCounts {
  const counts = createCandidateStatusCounts();
  for (const item of items) {
    const identityKey = getResumeIdentityKey(item);
    if (identityKey && context.blockedIdentities.has(identityKey)) {
      continue;
    }
    counts[getCandidateStatus(item, context)] += 1;
  }
  return counts;
}

export function scorePreparedCandidates(
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

export function prepareSampleCandidates(params: {
  items: ResumeItem[];
  indexMap: Map<string, ResumeIndex>;
  resumeIds?: string[];
  limit?: number;
  workHistoryLimit?: number;
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
    workHistoryLimit: params.workHistoryLimit,
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
  middleware: [requireWorkspacePermission("resume:search")] as const,
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
    education,
    skills,
    requiredKeywords,
    locations,
    location,
    minSalary,
    maxSalary,
    minRoleYears,
    roleFilterType,
    roleType,
    minAge,
    maxAge,
    sources,
    status,
    minMatchScore,
    recommendation,
    showBlocked,
    includeHidden,
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
  const canReadOperationalOverlays = Boolean(c.var.auth);
  const normalizedLocationAlias = location?.trim() || undefined;
  const effectiveLocations = locations && locations.length > 0
    ? locations
    : normalizedLocationAlias
      ? [normalizedLocationAlias]
      : undefined;
  const effectiveRoleFilterType = roleFilterType?.trim() || roleType?.trim() || undefined;

  try {
    if (source === "convex") {
      return (async () => {
        const workspaceSlug = c.var.workspaceSlug ?? "dev";
        const resolvedJobId = jobDescriptionId?.trim() || undefined;
        const normalizedKeywords = keyword ? normalizeKeywords(parseKeywordQuery(keyword).keywords) : [];
        const normalizedRequiredKeywords = normalizeKeywords(requiredKeywords);
        const normalizedRecommendations = normalizeMatchRecommendations(recommendation);
        const normalizedStatusFilters = normalizeStatusFilters(status);
        const hasLocalMatchFilters = minMatchScore !== undefined || (normalizedRecommendations?.length ?? 0) > 0;
        const hasLocalResumeFilters = hasResumeListFilters({
          education,
          skills,
          requiredKeywords: normalizedRequiredKeywords,
          locations: effectiveLocations,
          minSalary,
          maxSalary,
          minRoleYears,
          roleFilterType: effectiveRoleFilterType,
          minAge,
          maxAge,
          sources,
        });
        const requiresMatchPagination = sortBy === "score" || hasLocalMatchFilters;
        const localResumeFilters: ResumeFilters = {
          education,
          skills,
          requiredKeywords: normalizedRequiredKeywords,
          locations: effectiveLocations,
          minSalary,
          maxSalary,
          minRoleYears,
          roleFilterType: effectiveRoleFilterType,
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
              minRoleYears,
              roleFilterType: effectiveRoleFilterType,
              minAge,
              maxAge,
              education,
              skills,
              requiredKeywords: normalizedRequiredKeywords,
              locations: effectiveLocations,
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

        // Load match context before local filtering so minScore can be
        // enforced uniformly on every path below (F5).
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

        // F5: minScore must apply on all paths. The pre-paged match path
        // (usesPrePagedMatchResults) skips the working-set filter below, so
        // minScore is enforced here keyed by candidate resumeId, which matches
        // the matchMap key space on every path. Idempotent when prep already
        // filtered server-side. Without a resolved JD there are no scores, so
        // minScore is a no-op by design (scores only exist against a JD).
        if (minMatchScore !== undefined && matchMap) {
          prepared = prepared.filter((candidate) => {
            const match = matchMap?.get(candidate.resumeId);
            return match && match.score >= minMatchScore;
          });
        }
        // Same cross-path enforcement for recommendation filters: the pre-paged
        // keyword/match-storage paths already filtered server-side, so this is
        // idempotent there; it closes the gap on the fallback paths where the
        // working-set filter is skipped.
        if (normalizedRecommendations?.length && matchMap) {
          const allowed = new Set(normalizedRecommendations);
          prepared = prepared.filter((candidate) => {
            const match = matchMap?.get(candidate.resumeId);
            return match && allowed.has(match.recommendation);
          });
        }

        const canReadHidden = includeHidden === true && getIndustryReviewAccessError(c) === null;
        if (!canReadHidden && prepared.length > 0) {
          const policyEnforcer = await ResumePolicyEnforcer.load(workspaceSlug);
          prepared = prepared.filter((candidate) => !policyEnforcer.evaluate(candidate.resume).hidden);
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
          resumeId: typeof item.resumeId === "string" ? item.resumeId : undefined,
        }));

        let working = enriched;
        if (!usesPrePagedMatchResults && matchMap) {
          if (normalizedRecommendations?.length) {
            const allowed = new Set(normalizedRecommendations);
            working = working.filter((item) => {
              const match = matchMap?.get(item.resumeId ?? item.id);
              return match && allowed.has(match.recommendation);
            });
          }
        }

        if (!usesPrePagedMatchResults && sortBy) {
          const order = sortOrder || (sortBy === "score" ? "desc" : "asc");
          const direction = order === "desc" ? -1 : 1;

          working = [...working].sort((a, b) => {
            if (sortBy === "score") {
              const scoreA = matchMap?.get(a.resumeId ?? a.id)?.score ?? -1;
              const scoreB = matchMap?.get(b.resumeId ?? b.id)?.score ?? -1;
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

        // Compute operational status overlays only after authentication. Anonymous
        // HR search returns base resume/search data and ignores status filters
        // because status is part of the HR decision trail.
        let statusCounts: CandidateStatusCounts | undefined;
        let statusFilteredWorking = working;
        const canApplyStatusFilters = canReadOperationalOverlays && normalizedStatusFilters.length > 0;
        if (canReadOperationalOverlays) {
          try {
            const statusContext = await loadCandidateStatusContext(workspaceSlug, showBlocked);
            statusCounts = countCandidateStatuses(working, statusContext);
            if (canApplyStatusFilters) {
              statusFilteredWorking = working.filter((item) =>
                matchesStatusFilter(item, statusContext, normalizedStatusFilters)
              );
            }
          } catch (error) {
            logger.error("[Resumes] Failed to load candidate status context", error, {
              route: "resumes_search",
              workspaceSlug,
            });
            statusCounts = undefined;
          }
        }

        // Cursor-scan returns all results without pre-slicing, so
        // offset/limit must be applied after local filtering.
        const start = offset ?? 0;
        const end = typeof limit === "number" ? start + limit : undefined;
        const pagedWorking = end ? statusFilteredWorking.slice(start, end) : statusFilteredWorking.slice(start);
        // usesPrePagedMatchResults already has correct offset/limit from match storage;
        // canUseSourcePagination with no keywords already has offset/limit from Convex list page;
        // all other paths need offset/limit applied locally.
        const isSourcePaginated = canUseSourcePagination && normalizedKeywords.length === 0;
        const shouldUsePrePagedResponse = !canApplyStatusFilters && (usesPrePagedMatchResults || isSourcePaginated);
        const limited = shouldUsePrePagedResponse
          ? statusFilteredWorking.map((item) => item.resume)
          : pagedWorking.map((item) => item.resume);
        const responseTotal = canApplyStatusFilters
          ? statusFilteredWorking.length
          : (usesPrePagedMatchResults || isSourcePaginated)
            ? (totalCount ?? statusFilteredWorking.length)
            : statusFilteredWorking.length;

        // List-view projection: the web list consumes the resume fields,
        // ingestData, analysis/analyses, and provenance — but never the raw
        // searchText blob (up to ~27KB per resume). Dropping it shrinks the
        // CN list payload by ~12% (763KB of 6.6MB) with zero UI impact.
        const projected = limited.map((item) => {
          if (!isRecord(item) || typeof item.searchText !== "string") {
            return item;
          }
          const { searchText: _dropped, ...rest } = item as Record<string, unknown>;
          return rest as ResumeItem;
        });

        return c.json({
          success: true as const,
          summary: {
            total: responseTotal,
            returned: limited.length,
            query: keyword,
            source,
            ...buildKeywordExpansionSummary(liveExpansion ?? keywordExpansion),
            searchMode: hybridSearchMode,
            ...(statusCounts ? { statusCounts } : {}),
          },
          data: projected,
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
      education,
      skills,
      requiredKeywords: normalizeKeywords(requiredKeywords),
      locations: effectiveLocations,
      minSalary,
      maxSalary,
    });

    const enriched = filtered.map((item, index) => ({
      resume: item,
      id: resolveResumeId(item, index),
      resumeId: typeof item.resumeId === "string" ? item.resumeId : undefined,
      relevanceScore: item.relevanceScore,
    }));

    let matchMap: Map<string, { score: number; recommendation: MatchingResult["recommendation"] }> | null = null;
    const needsMatchContext = Boolean(
      resolvedJobId
      && (minMatchScore !== undefined || (recommendation?.length ?? 0) > 0 || sortBy === "score")
    );

    if (needsMatchContext && resolvedJobId) {
      const matches = matchStorage.getMatchesByResumeIds(
        enriched.map((item) => item.resumeId ?? item.id),
        resolvedJobId
      );
      matchMap = new Map(matches.map((match) => [match.resumeId, match]));
    }

    let working = enriched;
    if (matchMap) {
      if (minMatchScore !== undefined) {
        working = working.filter((item) => {
          const match = matchMap?.get(item.resumeId ?? item.id);
          return match && match.score >= minMatchScore;
        });
      }
      if (recommendation?.length) {
        const allowed = new Set(recommendation);
        working = working.filter((item) => {
          const match = matchMap?.get(item.resumeId ?? item.id);
          return match && allowed.has(match.recommendation);
        });
      }
    }

    if (sortBy) {
      const order = sortOrder || (sortBy === "score" ? "desc" : "asc");
      const direction = order === "desc" ? -1 : 1;

      working = [...working].sort((a, b) => {
        if (sortBy === "score") {
          const scoreA = matchMap?.get(a.resumeId ?? a.id)?.score ?? -1;
          const scoreB = matchMap?.get(b.resumeId ?? b.id)?.score ?? -1;
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
          ...(canReadOperationalOverlays ? { statusCounts: createCandidateStatusCounts() } : {}),
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

export default app;
