import { aiConfig, loadAIConfig } from "./ai-config.js";
import { workspaceConfigService } from "./workspace-config-service.js";

const DEFAULT_AI_SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL || "anthropic/claude-3-haiku-20240307";

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

function extractModelName(model: string): string {
  const parts = model.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : model;
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

  private async callLLM(
    config: ReturnType<typeof loadAIConfig>,
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const baseUrl = config.apiBase || aiConfig.apiBase || "https://api.openai.com/v1";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: extractModelName(model),
          messages,
          temperature: 0.1,
          max_tokens: Math.min(config.maxTokens, 900),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`AI summary request failed with status ${response.status}: ${await response.text()}`);
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string }; text?: string }>;
      };
      const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text;
      if (!content) {
        throw new Error("No summary content returned from AI provider");
      }

      return content;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AI summary request timed out after ${config.timeout}ms`);
      }
      throw error;
    }
  }
}

export const aiSummaryService = new AiSummaryService();
