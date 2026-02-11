import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { randomUUID } from "node:crypto";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeSamplesResponseSchema,
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
  MatchRunsResponseSchema,
  MatchRunsQuerySchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService, parseExperienceYears } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { AIMatchingService, type MatchingRequest, type MatchingResult } from "../services/ai-matching.js";
import {
  MatchStorage,
  type MatchRunMode,
  type StoredMatch,
  type StoredMatchRun,
} from "../services/match-storage.js";
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import { RuleScoringService } from "../services/rule-scoring.js";
import { resolveResumeId } from "../services/resume-id.js";

import type { ResumeItem } from "../types/resume.js";
import type { ResumeIndex } from "../services/resume-index.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);

const DEFAULT_AI_TOP_N = 20;

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
  jobDescriptionId: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  location: z.string().optional(),
  resumeIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

const MatchRescoreResponseSchema = MatchResponseSchema;

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

function extractSkills(jobIntention?: string): string[] | undefined {
  if (!jobIntention) return undefined;
  const parts = jobIntention
    .split(/[，,、/\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return Array.from(new Set(parts)).slice(0, 12);
}

function extractCompanies(workHistory: ResumeItem["workHistory"]): string[] | undefined {
  if (!workHistory?.length) return undefined;
  const entries = workHistory
    .map((item) => item.raw)
    .filter(Boolean)
    .map((raw) => raw.replace(/^\d[\d\-~至今()年月日\s]*?/g, "").trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  return Array.from(new Set(entries)).slice(0, 8);
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!Array.isArray(keywords)) return [];
  return Array.from(
    new Set(
      keywords
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    )
  );
}

function toKeywordJobDescriptionId(keywords: string[], location?: string): string {
  const locationPart = location?.trim() ? `@${location.trim()}` : "";
  return `keyword-search:${keywords.join("|")}${locationPart}`;
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
  const text = [
    resume.name,
    resume.jobIntention,
    resume.selfIntro,
    resume.location,
    resume.education,
    ...(resume.workHistory ?? []).map((item) => item.raw),
  ].join(" ").toLowerCase();

  return {
    resumeId,
    experienceYears: parseExperienceYears(resume.experience),
    educationLevel: resume.education || null,
    locationCity: resume.location || null,
    skills: extractSkills(resume.jobIntention) ?? [],
    companies: extractCompanies(resume.workHistory) ?? [],
    industryTags: [],
    salaryRange: null,
    searchText: text,
  };
}

function buildAiResumePayload(item: {
  resume: ResumeItem;
  resumeId: string;
  indexData: ResumeIndex;
}): MatchingRequest["resume"] {
  return {
    id: item.resumeId,
    name: item.resume.name || "未命名",
    jobIntention: item.resume.jobIntention || undefined,
    workExperience: item.indexData.experienceYears ?? undefined,
    education: item.resume.education || undefined,
    skills: item.indexData.skills.length > 0 ? item.indexData.skills : extractSkills(item.resume.jobIntention),
    companies: item.indexData.companies.length > 0 ? item.indexData.companies : extractCompanies(item.resume.workHistory),
    summary: item.resume.selfIntro || undefined,
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
    q,
    limit,
    offset,
    minExperience,
    maxExperience,
    education,
    skills,
    locations,
    minSalary,
    maxSalary,
    minMatchScore,
    recommendation,
    sortBy,
    sortOrder,
    sessionId,
    jobDescriptionId,
  } = c.req.valid("query");
  const sampleName = sample?.trim() || undefined;
  const keyword = q?.trim() || undefined;

  try {
    const { items, sample: sampleInfo, metadata, indexes } = resumeService.loadSample(sampleName);
    let filtered = resumeService.searchResumes(items, keyword, indexes);
    filtered = resumeService.filterResumes(filtered, {
      minExperience,
      maxExperience,
      education,
      skills,
      locations,
      minSalary,
      maxSalary,
    });

    const session = sessionId ? sessionManager.getSession(sessionId) : null;
    const resolvedJobId = jobDescriptionId || session?.jobDescriptionId;

    const enriched = filtered.map((item, index) => ({
      resume: item,
      id: resolveResumeId(item, index),
      relevanceScore: item.relevanceScore,
    }));

    let matchMap: Map<string, { score: number; recommendation: string }> | null = null;
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

    return c.json({
      success: true as const,
      sample: sampleInfo,
      metadata: metadata ?? undefined,
      summary: {
        total: working.length,
        returned: limited.length,
        query: keyword,
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
  const matchJobDescriptionId = normalizedJobDescriptionId
    ? normalizedJobDescriptionId
    : toKeywordJobDescriptionId(normalizedKeywords, location);

  const mode = toMatchMode(modeInput);

  let session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  if (!session) {
    session = sessionManager.createSession({
      jobDescriptionId: normalizedJobDescriptionId,
      sampleName: sample,
    });
  } else {
    session = sessionManager.updateSession(session.id, {
      jobDescriptionId: normalizedJobDescriptionId ?? null,
      sampleName: sample ?? session.sampleName,
    }) ?? session;
  }

  const sampleName = sample ?? session.sampleName;

  let items: ResumeItem[] = [];
  let indexMap = new Map<string, ResumeIndex>();
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    indexMap = sampleData.indexes;

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

  const selected = resumeIds?.length
    ? items
      .map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }))
      .filter((item) => resumeIds.includes(item.resumeId))
    : items.map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }));

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;

  const requirements = normalizedJobDescriptionId
    ? (extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content))
    : buildKeywordRequirements(normalizedKeywords);
  const responsibilities = normalizedJobDescriptionId
    ? extractSection(content, ["Responsibilities", "岗位职责", "职责"])
    : buildKeywordResponsibilities(normalizedKeywords, location);

  const prepared = limited.map((item) => ({
    ...item,
    indexData: indexMap.get(item.resumeId) ?? createFallbackIndex(item.resume, item.resumeId),
  }));

  const shouldTrackRun = mode !== "hybrid";
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
      const scored = ruleScoringService.scoreBatch(prepared.map((item) => item.indexData), context);

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

      const storedMatches = matchStorage.getMatchesByResumeIds(
        prepared.map((item) => item.resumeId),
        matchJobDescriptionId
      );

      const results = storedMatches
        .map((match) => mapStoredMatch(match))
        .sort((a, b) => b.score - a.score);

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

      return c.json(
        {
          success: true as const,
          mode,
          streamPath: mode === "hybrid" ? "/api/resumes/match-stream" : undefined,
          pendingAiCount: mode === "hybrid" ? pendingAiCount : undefined,
          results,
          stats,
        },
        200
      );
    }

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
      const batchResult = await aiService.matchBatch(
        toProcess.map((item) => buildAiResumePayload(item)),
        {
          title: jdMeta.title || matchJobDescriptionId,
          requirements,
          responsibilities,
        }
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

    return c.json(
      {
        success: true as const,
        mode: "ai_only",
        results: finalResults,
        stats,
      },
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

  let items: ResumeItem[] = [];
  let indexMap = new Map<string, ResumeIndex>();
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    indexMap = sampleData.indexes;
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

  const selected = resumeIds?.length
    ? items
      .map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }))
      .filter((item) => resumeIds.includes(item.resumeId))
    : items.map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }));

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;

  const requirements = normalizedJobDescriptionId
    ? (extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content))
    : buildKeywordRequirements(normalizedKeywords);
  const responsibilities = normalizedJobDescriptionId
    ? extractSection(content, ["Responsibilities", "岗位职责", "职责"])
    : buildKeywordResponsibilities(normalizedKeywords, location);

  const prepared = limited.map((item) => ({
    ...item,
    indexData: indexMap.get(item.resumeId) ?? createFallbackIndex(item.resume, item.resumeId),
  }));
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
          const scored = ruleScoringService.scoreBatch(prepared.map((item) => item.indexData), context);
          const orderedRuleResults = scored
            .map((entry) => ({
              resumeId: entry.resumeId,
              result: ruleScoringService.toMatchingResult(entry.result),
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
              result,
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
              resumeId,
              jobDescriptionId: matchJobDescriptionId,
              ...result,
              matchedAt: ruleMatchedAt,
              sessionId: session?.id,
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
            const batchResult = await aiService.matchBatch(
              processQueue.map((item) => buildAiResumePayload(item)),
              {
                title: jdMeta.title || matchJobDescriptionId,
                requirements,
                responsibilities,
              },
              undefined,
              {
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

        const batchResult = await aiService.matchBatch(
          prepared.map((item) => buildAiResumePayload(item)),
          {
            title: jdMeta.title || matchJobDescriptionId,
            requirements,
            responsibilities,
          },
          undefined,
          {
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

app.openapi(rescoreResumeMatchesRoute, (c) => {
  const { sessionId, sample, jobDescriptionId, keywords, location, resumeIds, limit } = c.req.valid("json");
  const normalizedJobDescriptionId = jobDescriptionId?.trim();
  const normalizedKeywords = normalizeKeywords(keywords);
  if (!normalizedJobDescriptionId && normalizedKeywords.length === 0) {
    return c.json({ success: false, error: "jobDescriptionId or keywords is required" }, 400);
  }
  const matchJobDescriptionId = normalizedJobDescriptionId
    ? normalizedJobDescriptionId
    : toKeywordJobDescriptionId(normalizedKeywords, location);

  const session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  const sampleName = sample ?? session?.sampleName;

  let items: ResumeItem[] = [];
  let indexMap = new Map<string, ResumeIndex>();

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    indexMap = sampleData.indexes;
    if (normalizedJobDescriptionId) {
      jobService.loadFile(normalizedJobDescriptionId);
    }
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const selected = resumeIds?.length
    ? items
      .map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }))
      .filter((item) => resumeIds.includes(item.resumeId))
    : items.map((resume, index) => ({ resume, resumeId: resolveResumeId(resume, index) }));

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;

  const context = normalizedJobDescriptionId
    ? ruleScoringService.buildContext(normalizedJobDescriptionId)
    : ruleScoringService.buildContextFromKeywords(normalizedKeywords, location);
  const scored = ruleScoringService.scoreBatch(
    limited.map((item) => indexMap.get(item.resumeId) ?? createFallbackIndex(item.resume, item.resumeId)),
    context
  );

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

  const finalMatches = matchStorage
    .getMatchesByResumeIds(limited.map((item) => item.resumeId), matchJobDescriptionId)
    .sort((a, b) => b.score - a.score);

  const results = finalMatches.map((match) => mapStoredMatch(match));

  return c.json(
    {
      success: true as const,
      mode: "rules_only",
      results,
      stats: computeStats(results, Date.now() - startTime, 0),
    },
    200
  );
});

export default app;
