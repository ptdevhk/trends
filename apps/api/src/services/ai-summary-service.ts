import { loadAIConfig } from "./ai-config.js";
import { callChatCompletion } from "./ai-chat-client.js";
import { logger } from "./logger.js";
import { workspaceConfigService } from "./workspace-config-service.js";

const DEFAULT_AI_SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL
  || process.env.AI_MODEL
  || "openai/gpt-4o-mini";
const FALLBACK_AI_SUMMARY_MODEL = "heuristic/search-summary-fallback";

type SummaryCandidate = {
  id: string;
  keywords?: string[];
  location?: string;
  name: string;
  score?: number;
  snippet: string;
  title?: string;
};

type GenerateSummaryRequest = {
  workspaceSlug: string;
  query: string;
  location?: string;
  jobDescriptionId?: string;
  facets?: {
    selectedTags?: string[];
    selectedCompanies?: string[];
    selectedExperienceLevel?: string;
  };
  results: SummaryCandidate[];
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/```$/m, "")
    .trim();
}

function collectTopValues(values: Array<string | undefined>, limit: number): string[] {
  const counts = new Map<string, { label: string; count: number }>();

  values.forEach((value) => {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(key, {
      label: normalized,
      count: 1,
    });
  });

  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map((item) => item.label);
}

function summarizeScoreRange(results: SummaryCandidate[]): string {
  const scores = results
    .map((candidate) => candidate.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

  if (scores.length === 0) {
    return "Visible candidates do not include score metadata.";
  }

  const sorted = [...scores].sort((left, right) => left - right);
  const min = Math.round(sorted[0] ?? 0);
  const max = Math.round(sorted[sorted.length - 1] ?? 0);
  const average = Math.round(sorted.reduce((sum, score) => sum + score, 0) / sorted.length);

  if (min === max) {
    return `Visible scores are tightly clustered at ${min}.`;
  }

  return `Visible scores range from ${min} to ${max}, with the current set centered around ${average}.`;
}

export class AiSummaryService {
  async resolveModel(workspaceSlug: string): Promise<string> {
    const workspaceOverride = await workspaceConfigService.getWorkspaceConfigValue(workspaceSlug, "ai_summary_model");
    if (typeof workspaceOverride === "string" && workspaceOverride.trim().includes("/")) {
      return workspaceOverride.trim();
    }

    return DEFAULT_AI_SUMMARY_MODEL;
  }

  async generateSummary(request: GenerateSummaryRequest): Promise<{ model: string; summary: string }> {
    if (process.env.AI_MOCK_ENABLED === "true") {
      return {
        model: DEFAULT_AI_SUMMARY_MODEL,
        summary: `Found ${request.results.length} candidate snippets for "${request.query}". Common themes include ${request.results[0]?.keywords?.slice(0, 2).join(", ") || "relevant experience"}.`,
      };
    }

    try {
      const config = loadAIConfig();
      if (!config.apiKey) {
        throw new Error("Missing AI_API_KEY environment variable");
      }

      const model = await this.resolveModel(request.workspaceSlug);
      if (!model.includes("/")) {
        throw new Error(`Invalid AI summary model: ${model}`);
      }

      const message = this.buildUserPrompt(request);
      const content = await this.callLLM(config, model, [
        {
          role: "system",
          content: "You summarize resume search results for recruiters. Stay factual, compact, and read-only. Do not invent candidate details or recommend contacting anyone directly.",
        },
        {
          role: "user",
          content: message,
        },
      ]);

      return {
        model,
        summary: stripCodeFence(content),
      };
    } catch (error) {
      logger.error("AI summary generation unavailable, using heuristic fallback", error, { service: "ai-summary-service" });
      return {
        model: FALLBACK_AI_SUMMARY_MODEL,
        summary: this.buildFallbackSummary(request),
      };
    }
  }

  private buildUserPrompt(request: GenerateSummaryRequest): string {
    const candidateLines = request.results
      .map((candidate, index) => [
        `${index + 1}. ${candidate.name}`,
        candidate.title ? `title=${candidate.title}` : undefined,
        candidate.location ? `location=${candidate.location}` : undefined,
        typeof candidate.score === "number" ? `score=${Math.round(candidate.score)}` : undefined,
        candidate.keywords?.length ? `keywords=${candidate.keywords.join(", ")}` : undefined,
        candidate.snippet ? `snippet=${compactWhitespace(candidate.snippet)}` : undefined,
      ].filter(Boolean).join(" | "))
      .join("\n");

    return [
      `Query: ${request.query}`,
      request.location ? `Location: ${request.location}` : undefined,
      request.jobDescriptionId ? `Job description: ${request.jobDescriptionId}` : undefined,
      request.facets?.selectedTags?.length ? `Selected tags: ${request.facets.selectedTags.join(", ")}` : undefined,
      request.facets?.selectedCompanies?.length ? `Selected companies: ${request.facets.selectedCompanies.join(", ")}` : undefined,
      request.facets?.selectedExperienceLevel ? `Selected experience level: ${request.facets.selectedExperienceLevel}` : undefined,
      `Visible result count: ${request.results.length}`,
      "",
      "Write a concise summary in 3 short paragraphs:",
      "1. Describe the strongest shared patterns in the visible result set.",
      "2. Call out where the result set is narrow, mixed, or missing clear evidence.",
      "3. Mention 2-3 useful keywords or filters to refine next if needed.",
      "",
      "Candidate snippets:",
      candidateLines,
    ].filter(Boolean).join("\n");
  }

  private buildFallbackSummary(request: GenerateSummaryRequest): string {
    const topKeywords = collectTopValues(request.results.flatMap((candidate) => candidate.keywords ?? []), 3);
    const topTitles = collectTopValues(request.results.map((candidate) => candidate.title), 3);
    const topLocations = collectTopValues(request.results.map((candidate) => candidate.location), 2);
    const refinementHints = collectTopValues([
      ...request.facets?.selectedTags ?? [],
      ...request.facets?.selectedCompanies ?? [],
      ...topKeywords,
    ], 3);

    const firstParagraph = [
      `Visible results for "${request.query}" currently include ${request.results.length} candidates.`,
      topKeywords.length > 0
        ? `Shared themes are strongest around ${topKeywords.join(", ")}.`
        : topTitles.length > 0
          ? `Shared themes are strongest around titles such as ${topTitles.join(", ")}.`
          : undefined,
    ].filter(Boolean).join(" ");

    const secondParagraph = [
      topTitles.length > 0 ? `Common titles include ${topTitles.join(", ")}.` : undefined,
      topLocations.length > 0 ? `Visible locations are concentrated in ${topLocations.join(", ")}.` : undefined,
      summarizeScoreRange(request.results),
    ].filter(Boolean).join(" ");

    const thirdParagraph = [
      request.location ? `Keep the location filter on ${request.location} if that market is still the priority.` : undefined,
      refinementHints.length > 0
        ? `Useful next refinements are ${refinementHints.join(", ")}.`
        : "Useful next refinements are narrower role, company, or location filters.",
    ].filter(Boolean).join(" ");

    return [firstParagraph, secondParagraph, thirdParagraph].join("\n\n");
  }

  private async callLLM(
    config: ReturnType<typeof loadAIConfig>,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    return callChatCompletion({
      config,
      model,
      messages,
      temperature: 0.1,
      maxTokens: 900,
    });
  }
}

export const aiSummaryService = new AiSummaryService();
