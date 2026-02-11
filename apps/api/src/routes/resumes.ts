import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ResumesQuerySchema,
  ResumesResponseSchema,
  ResumeSamplesResponseSchema,
  MatchRequestSchema,
  MatchResponseSchema,
  ResumeMatchesResponseSchema,
  ResumeMatchesQuerySchema,
} from "../schemas/index.js";
import { config } from "../services/config.js";
import { ResumeService, parseExperienceYears } from "../services/resume-service.js";
import { DataNotFoundError } from "../services/errors.js";
import { AIMatchingService } from "../services/ai-matching.js";
import { MatchStorage } from "../services/match-storage.js";
import { ResumePipelineConfigService } from "../services/resume-pipeline-config.js";
import { RuleScoringService } from "../services/rule-scoring.js";
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import { extractCompanies, extractSkills, resolveResumeId } from "../services/resume-utils.js";
import { streamSSE } from "hono/streaming";
import type { ResumeItem } from "../types/resume.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const pipelineConfig = new ResumePipelineConfigService(config.projectRoot);
const ruleScoringService = new RuleScoringService(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

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

function toScoreSource(aiModel: string | undefined): "rule" | "ai" {
  return aiModel === "rule" ? "rule" : "ai";
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
    const { items, sample: sampleInfo, metadata } = resumeService.loadSample(sampleName);
    let filtered = resumeService.searchResumes(items, keyword);
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

    const enriched = filtered.map((resume, index) => ({
      resume,
      id: resolveResumeId(resume, index),
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
  description: "Runs AI matching and stores results for the session",
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
    404: {
      content: { "application/json": { schema: SimpleErrorSchema } },
      description: "Session or job description not found",
    },
  },
});

app.openapi(matchResumesRoute, async (c) => {
  const { sessionId, jobDescriptionId, sample, resumeIds, limit, mode } = c.req.valid("json");
  const effectiveMode = mode ?? "hybrid";

  let session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  if (!session) {
    session = sessionManager.createSession({
      jobDescriptionId,
      sampleName: sample,
    });
  } else {
    session = sessionManager.updateSession(session.id, {
      jobDescriptionId,
      sampleName: sample ?? session.sampleName,
    }) ?? session;
  }

  const sampleName = sample ?? session.sampleName;

  let items: ResumeItem[] = [];
  let jdData: ReturnType<JobDescriptionService["loadFile"]>;

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    jdData = jobService.loadFile(jobDescriptionId);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const content = jdData.content;
  const selected = resumeIds?.length
    ? items.filter((item, index) => {
      const id = resolveResumeId(item, index);
      return resumeIds.includes(id);
    })
    : items;

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;

  const requirements = extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content);
  const responsibilities = extractSection(content, ["Responsibilities", "岗位职责", "职责"]);

  const resumesWithIds = limited.map((resume, index) => ({
    resume,
    id: resolveResumeId(resume, index),
  }));

  const targetResumeIds = resumesWithIds.map((item) => item.id);

  const cachedMatches = matchStorage.getMatchesByResumeIds(targetResumeIds, jobDescriptionId);
  const cachedMap = new Map(cachedMatches.map((match) => [match.resumeId, match]));

  const startTime = Date.now();
  if (effectiveMode === "ai_only") {
    const toProcess = resumesWithIds.filter((item) => {
      const cached = cachedMap.get(item.id);
      return !cached || !cached.aiModel || cached.aiModel === "rule";
    });

    if (toProcess.length) {
      const batchResult = await aiService.matchBatch(
        toProcess.map((item) => ({
          id: item.id,
          name: item.resume.name || "未命名",
          jobIntention: item.resume.jobIntention || undefined,
          workExperience: parseExperienceYears(item.resume.experience) ?? undefined,
          education: item.resume.education || undefined,
          skills: extractSkills(item.resume.jobIntention),
          companies: extractCompanies(item.resume.workHistory),
          summary: item.resume.selfIntro || undefined,
        })),
        {
          title: jdData.title || jobDescriptionId,
          requirements,
          responsibilities,
        },
        undefined,
        { concurrency: pipelineConfig.getAiMatchingConcurrency() }
      );

      if (batchResult.results.length) {
        const entries = batchResult.results.map((entry) => ({
          sessionId: session?.id,
          resumeId: entry.resumeId,
          jobDescriptionId,
          sampleName: sampleName ?? undefined,
          result: entry.result,
          aiModel: aiService.getServiceInfo().model,
          processingTimeMs: batchResult.processingTimeMs,
        }));
        matchStorage.saveMatches(entries);
      }
    }
  } else {
    const indexService = resumeService.getIndexService();

    const toScore = resumesWithIds.filter((item) => {
      const cached = cachedMap.get(item.id);
      return !cached || !cached.aiModel || cached.aiModel === "rule";
    });

    const entries: Array<Parameters<MatchStorage["saveMatch"]>[0]> = [];
    for (const item of toScore) {
      const index = indexService.get(item.id);
      if (!index) {
        console.error("Missing resume index for rule scoring:", item.id);
        continue;
      }

      const rule = ruleScoringService.scoreResume(index, jdData);
      const result = ruleScoringService.toMatchingResult(rule);

      entries.push({
        sessionId: session?.id,
        resumeId: item.id,
        jobDescriptionId,
        sampleName: sampleName ?? undefined,
        result,
        aiModel: "rule",
        processingTimeMs: 0,
      });
    }

    if (entries.length) {
      matchStorage.saveMatches(entries);
    }
  }

  const storedMatches = matchStorage.getMatchesByResumeIds(targetResumeIds, jobDescriptionId);

  const results = storedMatches
    .map((match) => ({
      resumeId: match.resumeId,
      jobDescriptionId: match.jobDescriptionId,
      score: match.score,
      scoreSource: toScoreSource(match.aiModel),
      recommendation: match.recommendation,
      highlights: match.highlights,
      concerns: match.concerns,
      summary: match.summary,
      breakdown: match.breakdown,
      matchedAt: match.matchedAt,
      sessionId: match.sessionId,
      userId: match.userId,
    }))
    .sort((a, b) => b.score - a.score);

  const processed = results.length;
  const matched = results.filter((item) => item.score >= 50).length;
  const avgScore = processed
    ? Number((results.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    : 0;

  const totalTime = Date.now() - startTime;
  return c.json(
    {
      success: true as const,
      results,
      stats: {
        processed,
        matched,
        avgScore,
        processingTimeMs: totalTime,
      },
    },
    200
  );
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

const MatchStreamRequestSchema = z.object({
  sessionId: z.string().optional(),
  sample: z.string().optional(),
  jobDescriptionId: z.string(),
  resumeIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  concurrency: z.number().int().min(1).max(50).optional(),
  aiLimit: z.number().int().min(1).max(200).optional(),
  minRuleScore: z.number().int().min(0).max(100).optional(),
});

app.post("/api/resumes/match-stream", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error("Failed to parse match-stream body", error);
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = MatchStreamRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid match-stream payload" }, 400);
  }

  const { sessionId, jobDescriptionId, sample, resumeIds, limit, concurrency, aiLimit, minRuleScore } = parsed.data;

  let session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }
  if (!session) {
    session = sessionManager.createSession({
      jobDescriptionId,
      sampleName: sample,
    });
  }

  const sampleName = sample ?? session.sampleName;

  let items: ResumeItem[] = [];
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    const jdData = jobService.loadFile(jobDescriptionId);
    jdMeta = { title: jdData.title };
    content = jdData.content;
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const selected = resumeIds?.length
    ? items.filter((item, index) => {
      const id = resolveResumeId(item, index);
      return resumeIds.includes(id);
    })
    : items;

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;
  const requirements = extractSection(content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(content);
  const responsibilities = extractSection(content, ["Responsibilities", "岗位职责", "职责"]);

  const resumesForAi = limited.map((resume, index) => ({
    resume,
    id: resolveResumeId(resume, index),
  }));

  const allResumeIds = resumesForAi.map((item) => item.id);
  const cachedMatches = matchStorage.getMatchesByResumeIds(allResumeIds, jobDescriptionId);
  const cachedMap = new Map(cachedMatches.map((match) => [match.resumeId, match]));

  const indexService = resumeService.getIndexService();

  const jdFile = jobService.loadFile(jobDescriptionId);
  const defaultTopN = pipelineConfig.getRuleTopCandidatesForAi();
  const defaultMinScore = pipelineConfig.getRuleMinScoreForAi();
  const topN = aiLimit ?? defaultTopN;
  const minScore = minRuleScore ?? defaultMinScore;

  const candidates = resumesForAi
    .map((item) => {
      const cached = cachedMap.get(item.id);
      if (cached?.aiModel && cached.aiModel !== "rule") {
        return null;
      }

      const baseScore = cached?.score;
      if (typeof baseScore === "number") {
        return { item, ruleScore: baseScore };
      }

      const index = indexService.get(item.id);
      if (!index) {
        console.error("Missing resume index for AI candidate ranking:", item.id);
        return null;
      }

      const rule = ruleScoringService.scoreResume(index, jdFile);
      return { item, ruleScore: rule.score };
    })
    .filter((entry): entry is { item: (typeof resumesForAi)[number]; ruleScore: number } => Boolean(entry))
    .filter((entry) => entry.ruleScore >= minScore)
    .sort((a, b) => b.ruleScore - a.ruleScore)
    .slice(0, topN);

  const selectedForAi = candidates.map((entry) => entry.item);
  const total = selectedForAi.length;
  const maxConcurrency = concurrency ?? pipelineConfig.getAiMatchingConcurrency();

  return streamSSE(c, async (stream) => {
    let writeChain: Promise<void> = Promise.resolve();
    const write = async (message: { event?: string; data: string }) => {
      writeChain = writeChain
        .then(() => stream.writeSSE(message))
        .catch((error) => {
          console.error("Failed to write SSE message", error);
        });
      await writeChain;
    };

    await write({
      event: "start",
      data: JSON.stringify({
        total,
        considered: resumesForAi.length,
        topN,
        minScore,
      }),
    });

    let done = 0;

    await runConcurrent(selectedForAi, maxConcurrency, async (item) => {
      const start = Date.now();
      const result = await aiService.matchResume({
        resume: {
          id: item.id,
          name: item.resume.name || "未命名",
          jobIntention: item.resume.jobIntention || undefined,
          workExperience: parseExperienceYears(item.resume.experience) ?? undefined,
          education: item.resume.education || undefined,
          skills: extractSkills(item.resume.jobIntention),
          companies: extractCompanies(item.resume.workHistory),
          summary: item.resume.selfIntro || undefined,
        },
        jobDescription: {
          title: jdMeta.title || jobDescriptionId,
          requirements,
          responsibilities,
        },
      });

      const processingTimeMs = Date.now() - start;
      matchStorage.saveMatch({
        sessionId: session?.id,
        resumeId: item.id,
        jobDescriptionId,
        sampleName: sampleName ?? undefined,
        result,
        aiModel: aiService.getServiceInfo().model,
        processingTimeMs,
      });

      done += 1;
      await write({
        event: "match",
        data: JSON.stringify({
          resumeId: item.id,
          result: {
            resumeId: item.id,
            jobDescriptionId,
            score: result.score,
            scoreSource: "ai",
            recommendation: result.recommendation,
            highlights: result.highlights,
            concerns: result.concerns,
            summary: result.summary,
            breakdown: result.breakdown,
            matchedAt: new Date().toISOString(),
            sessionId: session?.id,
          },
          progress: { done, total },
          processingTimeMs,
        }),
      });
    });

    await write({ event: "done", data: JSON.stringify({ done, total }) });
  });
});

app.delete("/api/resumes/matches", (c) => {
  const deleted = matchStorage.clearAllMatches();
  return c.json({ success: true as const, deleted }, 200);
});

const RescoreRequestSchema = z.object({
  sessionId: z.string().optional(),
  sample: z.string().optional(),
  jobDescriptionId: z.string(),
  resumeIds: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  overwriteAi: z.boolean().optional(),
});

app.post("/api/resumes/matches/rescore", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    console.error("Failed to parse rescore body", error);
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = RescoreRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid rescore payload" }, 400);
  }

  const {
    sessionId,
    sample,
    jobDescriptionId,
    resumeIds,
    limit,
    overwriteAi,
  } = parsed.data;

  const allowOverwriteAi = overwriteAi ?? true;

  let session = sessionId ? sessionManager.getSession(sessionId) : null;
  if (sessionId && !session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }
  if (!session) {
    session = sessionManager.createSession({ jobDescriptionId, sampleName: sample });
  }

  const sampleName = sample ?? session.sampleName;

  const startTime = Date.now();
  let items: ResumeItem[] = [];
  let jdData: ReturnType<JobDescriptionService["loadFile"]>;
  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    jdData = jobService.loadFile(jobDescriptionId);
  } catch (error) {
    if (error instanceof DataNotFoundError) {
      return c.json({ success: false, error: error.message }, 404);
    }
    throw error;
  }

  const selected = resumeIds?.length
    ? items.filter((item, index) => {
      const id = resolveResumeId(item, index);
      return resumeIds.includes(id);
    })
    : items;

  const limited = typeof limit === "number" ? selected.slice(0, limit) : selected;
  const resumesWithIds = limited.map((resume, index) => ({
    resume,
    id: resolveResumeId(resume, index),
  }));
  const targetResumeIds = resumesWithIds.map((item) => item.id);

  const cached = matchStorage.getMatchesByResumeIds(targetResumeIds, jobDescriptionId);
  const cachedMap = new Map(cached.map((match) => [match.resumeId, match]));

  const indexService = resumeService.getIndexService();
  const entries: Array<Parameters<MatchStorage["saveMatch"]>[0]> = [];
  for (const item of resumesWithIds) {
    const existing = cachedMap.get(item.id);
    if (!allowOverwriteAi && existing?.aiModel && existing.aiModel !== "rule") {
      continue;
    }

    const index = indexService.get(item.id);
    if (!index) {
      console.error("Missing resume index for rescore:", item.id);
      continue;
    }

    const rule = ruleScoringService.scoreResume(index, jdData);
    const result = ruleScoringService.toMatchingResult(rule);

    entries.push({
      sessionId: session?.id,
      resumeId: item.id,
      jobDescriptionId,
      sampleName: sampleName ?? undefined,
      result,
      aiModel: "rule",
      processingTimeMs: 0,
    });
  }

  if (entries.length) {
    matchStorage.saveMatches(entries);
  }

  const storedMatches = matchStorage.getMatchesByResumeIds(targetResumeIds, jobDescriptionId);
  const results = storedMatches
    .map((match) => ({
      resumeId: match.resumeId,
      jobDescriptionId: match.jobDescriptionId,
      score: match.score,
      scoreSource: toScoreSource(match.aiModel),
      recommendation: match.recommendation,
      highlights: match.highlights,
      concerns: match.concerns,
      summary: match.summary,
      breakdown: match.breakdown,
      matchedAt: match.matchedAt,
      sessionId: match.sessionId,
      userId: match.userId,
    }))
    .sort((a, b) => b.score - a.score);

  const processed = results.length;
  const matched = results.filter((item) => item.score >= 50).length;
  const avgScore = processed
    ? Number((results.reduce((sum, item) => sum + item.score, 0) / processed).toFixed(2))
    : 0;

  const totalTime = Date.now() - startTime;
  return c.json(
    {
      success: true as const,
      results,
      stats: {
        processed,
        matched,
        avgScore,
        processingTimeMs: totalTime,
      },
    },
    200
  );
});

app.openapi(getResumeMatchesRoute, (c) => {
  const { sessionId, jobDescriptionId } = c.req.valid("query");

  if (!sessionId && !jobDescriptionId) {
    return c.json({ success: false, error: "sessionId or jobDescriptionId is required" }, 400);
  }

  let resolvedJobId = jobDescriptionId;
  if (!resolvedJobId && sessionId) {
    const session = sessionManager.getSession(sessionId);
    resolvedJobId = session?.jobDescriptionId;
  }

  if (!resolvedJobId) {
    return c.json({ success: false, error: "jobDescriptionId is required" }, 400);
  }

  const results = matchStorage.getMatchesForJob(resolvedJobId);

  return c.json(
    {
      success: true as const,
      results: results.map((match) => ({
        resumeId: match.resumeId,
        jobDescriptionId: match.jobDescriptionId,
        score: match.score,
        scoreSource: toScoreSource(match.aiModel),
        recommendation: match.recommendation,
        highlights: match.highlights,
        concerns: match.concerns,
        summary: match.summary,
        breakdown: match.breakdown,
        matchedAt: match.matchedAt,
        sessionId: match.sessionId,
        userId: match.userId,
      })),
    },
    200
  );
});

export default app;

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  const effectiveConcurrency = Math.max(1, Math.min(50, concurrency));
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(effectiveConcurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;

      const item = items[index];
      try {
        await handler(item);
      } catch (error) {
        console.error("Failed to process match-stream item", error);
      }
    }
  });

  await Promise.all(workers);
}
