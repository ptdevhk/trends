import { buildWorkHistoryEvidence, buildWorkHistoryEntryText, normalizeWorkHistoryEntry } from "../../packages/shared/src/index.ts";
import { AIMatchingService, type MatchingRequest } from "../../apps/api/src/services/ai-matching.ts";
import { JobDescriptionService } from "../../apps/api/src/services/job-description-service.ts";
import { resolveConvexUrl } from "../../apps/api/src/services/resume-import-service.ts";
import { parseExperienceYears } from "../../apps/api/src/services/resume-service.ts";

type LocalResumeAIScoreRequest = {
  apiUrl: string;
  workspace: string;
  source: string;
  query?: string;
  location?: string;
  jobDescriptionId?: string;
  resumeIds?: string[];
  limit?: number;
  topN?: number;
};

type RuleMatchResult = {
  resumeId: string;
  score: number;
};

type RuleMatchResponse = {
  success: boolean;
  results: Array<RuleMatchResult>;
};

type HydratedConvexResume = {
  resumeId: string;
  resume: {
    name?: string;
    location?: string;
    education?: string;
    experience?: string;
    profileUrl?: string;
    source?: string;
    workHistory?: Array<Record<string, unknown>>;
  };
};

function splitQueryKeywords(query: string | undefined): string[] {
  if (!query) return [];
  return query.trim().split(/\s+/).map((part) => part.trim()).filter(Boolean);
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
    `^##\\s+(${headings.map((heading) => escapeRegex(heading)).join("|")})\\s*$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    if (!headingRegex.test(lines[index].trim())) {
      continue;
    }
    startIndex = index + 1;
    for (let cursor = startIndex; cursor < lines.length; cursor += 1) {
      if (/^##\s+/.test(lines[cursor].trim())) {
        endIndex = cursor;
        break;
      }
    }
    break;
  }

  if (startIndex === -1) return undefined;
  return lines.slice(startIndex, endIndex).join("\n").trim();
}

function buildKeywordRequirements(keywords: string[]): string {
  return `候选人需具备以下关键技能/经验:\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}`;
}

function buildKeywordResponsibilities(keywords: string[], location?: string): string | undefined {
  const parts = [
    `核心关键词: ${keywords.join(", ")}`,
    location?.trim() ? `目标地点: ${location.trim()}` : undefined,
  ].filter((value): value is string => Boolean(value));

  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

function extractCompanies(workHistory: Array<Record<string, unknown>> | undefined): string[] | undefined {
  if (!workHistory || workHistory.length === 0) return undefined;

  const companies = workHistory
    .map((entry) => {
      const normalized = normalizeWorkHistoryEntry(entry);
      return normalized?.companyName || buildWorkHistoryEntryText(entry);
    })
    .filter(Boolean)
    .map((raw) => raw.replace(/^\d[\d\-~至今()年月日\s]*?/g, "").trim())
    .filter(Boolean);

  if (companies.length === 0) return undefined;
  return Array.from(new Set(companies)).slice(0, 8);
}

async function callAPI<T>(input: LocalResumeAIScoreRequest, path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${input.apiUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": input.workspace,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`API ${method} ${path} failed (${response.status}): ${await response.text()}`);
  }

  return await response.json() as T;
}

async function hydrateConvexResumes(resumeIds: string[]): Promise<Map<string, HydratedConvexResume["resume"]>> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: "resumes:getByIdsForExport",
      args: { resumeIds },
    }),
  });

  if (!response.ok) {
    throw new Error(`Convex query failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };
  if (payload.status !== "success" || !Array.isArray(payload.value)) {
    throw new Error(payload.errorMessage || "Invalid Convex response for resumes:getByIdsForExport");
  }

  const result = new Map<string, HydratedConvexResume["resume"]>();
  for (const entry of payload.value as HydratedConvexResume[]) {
    result.set(entry.resumeId, entry.resume);
  }
  return result;
}

function buildJobDescription(input: LocalResumeAIScoreRequest, keywords: string[]) {
  if (input.jobDescriptionId?.trim()) {
    const service = new JobDescriptionService();
    const jd = service.loadFile(input.jobDescriptionId.trim());
    return {
      title: jd.title || jd.id,
      requirements: extractSection(jd.content, ["Requirements", "任职要求", "要求"]) || stripFrontMatter(jd.content),
      responsibilities: extractSection(jd.content, ["Responsibilities", "岗位职责", "职责"]),
      jobDescriptionId: jd.id,
    };
  }

  return {
    title: keywords.join(" "),
    requirements: buildKeywordRequirements(keywords),
    responsibilities: buildKeywordResponsibilities(keywords, input.location),
    jobDescriptionId: `keyword-search:${keywords.join("|")}${input.location?.trim() ? `@${input.location.trim()}` : ""}`,
  };
}

function buildMatchingResumePayload(resumeId: string, resume: HydratedConvexResume["resume"]): MatchingRequest["resume"] {
  return {
    id: resumeId,
    name: resume.name?.trim() || "未命名",
    workExperience: typeof resume.experience === "string" ? parseExperienceYears(resume.experience) ?? undefined : undefined,
    education: resume.education || undefined,
    companies: extractCompanies(resume.workHistory),
    workHistory: buildWorkHistoryEvidence(resume.workHistory ?? []).lines.join("\n") || undefined,
    sourceKey: resume.source || undefined,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

async function main(): Promise<void> {
  const rawInput = await Bun.stdin.text();
  const input = JSON.parse(rawInput) as LocalResumeAIScoreRequest;
  const source = (input.source || "convex").trim().toLowerCase();
  if (source !== "convex") {
    throw new Error("Local AI scorer currently supports source=convex only");
  }

  const keywords = splitQueryKeywords(input.query);
  if (!input.jobDescriptionId?.trim() && keywords.length === 0) {
    throw new Error("query or jobDescriptionId is required");
  }

  const aiService = new AIMatchingService();
  const availability = aiService.isAvailable();
  if (!availability.available) {
    throw new Error(availability.reason || "AI service unavailable");
  }

  const topN = Math.max(1, input.topN || input.limit || 10);
  const limit = Math.max(topN, input.limit || topN);

  const rulesResponse = await callAPI<RuleMatchResponse>(input, "/api/resumes/match", "POST", {
    source,
    persist: false,
    jobDescriptionId: input.jobDescriptionId?.trim() || undefined,
    keywords: keywords.length > 0 ? keywords : undefined,
    location: input.location?.trim() || undefined,
    resumeIds: input.resumeIds?.length ? input.resumeIds : undefined,
    limit,
    topN: limit,
    mode: "rules_only",
  });
  if (!rulesResponse.success) {
    throw new Error("rules_only matching did not succeed");
  }

  const topRuleResults = rulesResponse.results.slice(0, topN);
  const topResumeIDs = topRuleResults.map((result) => result.resumeId);
  if (topResumeIDs.length === 0) {
    console.log(JSON.stringify({
      success: true,
      source,
      jobDescriptionId: input.jobDescriptionId?.trim() || `keyword-search:${keywords.join("|")}`,
      results: [],
      stats: {
        processed: 0,
        ruleAvg: 0,
        aiScoreAvg: 0,
      },
    }));
    return;
  }

  const hydratedResumes = await hydrateConvexResumes(topResumeIDs);
  const jobDescription = buildJobDescription(input, keywords);
  const aiPayloads = topResumeIDs
    .map((resumeId) => {
      const resume = hydratedResumes.get(resumeId);
      if (!resume) return null;
      return buildMatchingResumePayload(resumeId, resume);
    })
    .filter((entry): entry is MatchingRequest["resume"] => entry !== null);

  const aiBatch = await aiService.matchBatch(aiPayloads, {
    title: jobDescription.title,
    requirements: jobDescription.requirements,
    responsibilities: jobDescription.responsibilities,
  });

  const aiByResumeID = new Map(aiBatch.results.map((entry) => [entry.resumeId, entry.result]));
  const results = topRuleResults
    .map((ruleEntry) => {
      const aiResult = aiByResumeID.get(ruleEntry.resumeId);
      const hydrated = hydratedResumes.get(ruleEntry.resumeId);
      if (!aiResult || !hydrated) {
        return null;
      }

      return {
        resumeId: ruleEntry.resumeId,
        name: hydrated.name || "",
        location: hydrated.location || "",
        profileUrl: hydrated.profileUrl || "",
        ruleScore: ruleEntry.score,
        aiScore: aiResult.score,
        recommendation: aiResult.recommendation,
        summary: aiResult.summary,
        highlights: aiResult.highlights,
        concerns: aiResult.concerns,
        rawResponse: aiResult.rawResponse || "",
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.aiScore - left.aiScore || right.ruleScore - left.ruleScore);

  console.log(JSON.stringify({
    success: true,
    source,
    jobDescriptionId: jobDescription.jobDescriptionId,
    results,
    stats: {
      processed: results.length,
      ruleAvg: average(results.map((result) => result.ruleScore)),
      aiScoreAvg: average(results.map((result) => result.aiScore)),
    },
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
