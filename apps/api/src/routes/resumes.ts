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
import { SessionManager } from "../services/session-manager.js";
import { JobDescriptionService } from "../services/job-description-service.js";
import type { ResumeItem } from "../types/resume.js";

const app = new OpenAPIHono();
const resumeService = new ResumeService(config.projectRoot);
const aiService = new AIMatchingService();
const matchStorage = new MatchStorage(config.projectRoot);
const sessionManager = new SessionManager(config.projectRoot);
const jobService = new JobDescriptionService(config.projectRoot);
const SimpleErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

function resolveResumeId(resume: ResumeItem, index: number): string {
  if (resume.resumeId) return String(resume.resumeId);
  if (resume.perUserId) return String(resume.perUserId);
  if (resume.profileUrl && resume.profileUrl !== "javascript:;") return resume.profileUrl;
  if (resume.extractedAt) return `${resume.name || "resume"}-${resume.extractedAt}`;
  return `${resume.name || "resume"}-${index}`;
}

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
  const { sessionId, jobDescriptionId, sample, resumeIds, limit } = c.req.valid("json");

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
  let jdMeta: { title?: string } = {};
  let content = "";

  try {
    const sampleData = resumeService.loadSample(sampleName);
    items = sampleData.items;
    const jdData = jobService.loadFile(jobDescriptionId);
    jdMeta = jdData.item;
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

  const cachedMatches = matchStorage.getMatchesByResumeIds(
    resumesForAi.map((item) => item.id),
    jobDescriptionId
  );
  const cachedMap = new Map(cachedMatches.map((match) => [match.resumeId, match]));

  const toProcess = resumesForAi.filter((item) => !cachedMap.has(item.id));

  const startTime = Date.now();
  const batchResult = toProcess.length
    ? await aiService.matchBatch(
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
          title: jdMeta.title || jobDescriptionId,
          requirements,
          responsibilities,
        }
      )
    : {
        results: [],
        processedCount: 0,
        failedCount: 0,
        processingTimeMs: 0,
      };

  const storedMatches: typeof cachedMatches = [...cachedMatches];

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
    const newlySaved = matchStorage.getMatchesByResumeIds(
      batchResult.results.map((entry) => entry.resumeId),
      jobDescriptionId
    );
    storedMatches.push(...newlySaved);
  }

  const results = storedMatches
    .map((match) => ({
      resumeId: match.resumeId,
      jobDescriptionId: match.jobDescriptionId,
      score: match.score,
      recommendation: match.recommendation,
      highlights: match.highlights,
      concerns: match.concerns,
      summary: match.summary,
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

app.openapi(getResumeMatchesRoute, (c) => {
  const { sessionId, jobDescriptionId } = c.req.valid("query");

  if (!sessionId && !jobDescriptionId) {
    return c.json({ success: false, error: "sessionId or jobDescriptionId is required" }, 400);
  }

  const results = sessionId
    ? matchStorage.getMatchesForSession(sessionId, jobDescriptionId)
    : matchStorage.getMatchesForJob(jobDescriptionId as string);

  return c.json(
    {
      success: true as const,
      results: results.map((match) => ({
        resumeId: match.resumeId,
        jobDescriptionId: match.jobDescriptionId,
        score: match.score,
        recommendation: match.recommendation,
        highlights: match.highlights,
        concerns: match.concerns,
        summary: match.summary,
        matchedAt: match.matchedAt,
        sessionId: match.sessionId,
        userId: match.userId,
      })),
    },
    200
  );
});

export default app;
