import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import { ResumeService } from "../services/resume-service.js";
import { AIMatchingService, type MatchingResult } from "../services/ai-matching.js";
import { MatchStorage, type StoredMatch, type StoredMatchRun, type MatchRunMode } from "../services/match-storage.js";
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import { RuleScoringService, type RuleScoringContext, type RuleScoringResult } from "../services/rule-scoring.js";
import { SearchEventLogger } from "../services/search-event-logger.js";
import { config } from "../services/config.js";
import { DataNotFoundError } from "../services/errors.js";
import {
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
  MatchRunsResponseSchema,
  MatchRunsQuerySchema,
  SimpleErrorSchema,
  ClearMatchesResponseSchema,
} from "../schemas/index.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { formatKeywordQuery } from "@trends/shared";
import {
  type ResumeKeywordExpansion,
  type PreparedResumeCandidate,
  normalizeKeywords,
  buildSearchEventQuery,
  toKeywordJobDescriptionId,
  createSsePayload,
  buildAiResumePayload,
  buildKeywordRequirements,
  buildKeywordResponsibilities,
  prepareConvexCandidates,
} from "../services/resume-candidate-prep.js";
import {
  scorePreparedCandidates,
  prepareSampleCandidates,
} from "./resumes_search.js";
import { requireWorkspaceUser } from "../middleware/auth.js";
import { getEffectiveResumeWorkHistoryLimit } from "../services/resume-work-history-limit.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const searchEventLogger = new SearchEventLogger(config.projectRoot);

const DEFAULT_AI_TOP_N = 20;

app.use("/api/resumes/match", requireWorkspaceUser);
app.use("/api/resumes/match-stream", requireWorkspaceUser);
app.use("/api/resumes/matches", requireWorkspaceUser);
app.use("/api/resumes/match-runs", requireWorkspaceUser);

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
  const workHistoryLimit = await getEffectiveResumeWorkHistoryLimit();

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
        workHistoryLimit,
      })).prepared;
    } else {
      const sampleData = resumeService.loadSample(sampleName);
      sampleName = sampleData.sample.name;
      prepared = prepareSampleCandidates({
        items: sampleData.items,
        indexMap: sampleData.indexes,
        resumeIds,
        limit,
        workHistoryLimit,
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

const matchStreamRoute = createRoute({
  method: "post",
  path: "/api/resumes/match-stream",
  tags: ["resumes"],
  summary: "Stream resume matching results via SSE",
  description: "Runs rule/AI matching and streams progress events via Server-Sent Events. Returns text/event-stream.",
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
      content: {
        "text/event-stream": {
          schema: z.string().openapi({ description: "Server-Sent Events stream" }),
        },
      },
      description: "SSE stream of matching progress and results",
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

app.openapi(matchStreamRoute, async (c) => {
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
  } = c.req.valid("json");

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
  const workHistoryLimit = await getEffectiveResumeWorkHistoryLimit();

  try {
    const sampleData = resumeService.loadSample(sampleName);
    prepared = prepareSampleCandidates({
      items: sampleData.items,
      indexMap: sampleData.indexes,
      resumeIds,
      limit,
      workHistoryLimit,
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
