import { afterEach, describe, expect, it, vi } from "vitest";

const {
  callChatCompletionMock,
  getWorkspaceConfigValueMock,
  loadAIConfigMock,
} = vi.hoisted(() => ({
  callChatCompletionMock: vi.fn(),
  getWorkspaceConfigValueMock: vi.fn(),
  loadAIConfigMock: vi.fn(),
}));

vi.mock("./ai-config.js", () => ({
  loadAIConfig: () => loadAIConfigMock(),
}));

vi.mock("./ai-chat-client.js", () => ({
  callChatCompletion: (args: unknown) => callChatCompletionMock(args),
}));

vi.mock("./workspace-config-service.js", () => ({
  workspaceConfigService: {
    getWorkspaceConfigValue: (workspaceSlug: string, configKey: string) =>
      getWorkspaceConfigValueMock(workspaceSlug, configKey),
  },
}));

vi.mock("./logger.js");

import { logger } from "./logger.js";
import { AiSummaryService } from "./ai-summary-service.js";

function createAIConfig(overrides: Partial<ReturnType<typeof loadAIConfigMock>> = {}) {
  return {
    enabled: true,
    resumesEnabled: true,
    model: "openai/gpt-4o-mini",
    apiKey: "test-api-key",
    apiBase: "https://ai.example.test/v1",
    temperature: 0,
    maxTokens: 4000,
    timeout: 120000,
    bonded: [],
    ...overrides,
  };
}

describe("AiSummaryService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    callChatCompletionMock.mockReset();
    getWorkspaceConfigValueMock.mockReset();
    loadAIConfigMock.mockReset();
  });

  it("uses the workspace override model, builds the recruiter summary prompt, and strips fenced output", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig());
    getWorkspaceConfigValueMock.mockResolvedValue("anthropic/claude-3-5-haiku-20241022");
    callChatCompletionMock.mockResolvedValue(`\`\`\`markdown
Strong overlap around machine tools and CNC sales backgrounds.
\`\`\``);

    const service = new AiSummaryService();
    const result = await service.generateSummary({
      workspaceSlug: "dev",
      query: "machine tools",
      location: "Malaysia",
      jobDescriptionId: "lathe-sales",
      facets: {
        selectedTags: ["Machine Tools", "CNC"],
        selectedCompanies: ["DMG Mori"],
        selectedExperienceLevel: "senior",
      },
      results: [
        {
          id: "resume-1",
          name: "Jane Tan",
          title: "Regional Sales Manager",
          location: "Kuala Lumpur",
          score: 92.4,
          keywords: ["Machine Tools", "CNC"],
          snippet: "  Led   CNC\nsales   across   SEA markets. ",
        },
      ],
    });

    expect(getWorkspaceConfigValueMock).toHaveBeenCalledWith("dev", "ai_summary_model");
    expect(callChatCompletionMock).toHaveBeenCalledTimes(1);

    const call = callChatCompletionMock.mock.calls[0]?.[0] as {
      config: ReturnType<typeof loadAIConfigMock>;
      maxTokens: number;
      messages: Array<{ role: string; content: string }>;
      model: string;
      temperature: number;
    };

    expect(call.config).toEqual(createAIConfig());
    expect(call.model).toBe("anthropic/claude-3-5-haiku-20241022");
    expect(call.temperature).toBe(0.1);
    expect(call.maxTokens).toBe(900);
    expect(call.messages[0]?.content).toContain("You summarize resume search results for recruiters");
    expect(call.messages[1]?.content).toContain("Query: machine tools");
    expect(call.messages[1]?.content).toContain("Location: Malaysia");
    expect(call.messages[1]?.content).toContain("Job description: lathe-sales");
    expect(call.messages[1]?.content).toContain("Selected tags: Machine Tools, CNC");
    expect(call.messages[1]?.content).toContain("Selected companies: DMG Mori");
    expect(call.messages[1]?.content).toContain("Selected experience level: senior");
    expect(call.messages[1]?.content).toContain("Visible result count: 1");
    expect(call.messages[1]?.content).toContain("score=92");
    expect(call.messages[1]?.content).toContain("snippet=Led CNC sales across SEA markets.");

    expect(result).toEqual({
      model: "anthropic/claude-3-5-haiku-20241022",
      summary: "Strong overlap around machine tools and CNC sales backgrounds.",
    });
  });

  it("falls back to the default model when the workspace override is not provider-qualified", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig());
    getWorkspaceConfigValueMock.mockResolvedValue("claude-3-haiku");
    callChatCompletionMock.mockResolvedValue("Plain summary");

    const service = new AiSummaryService();
    const result = await service.generateSummary({
      workspaceSlug: "dev",
      query: "automation",
      results: [
        {
          id: "resume-1",
          name: "Alex",
          snippet: "Automation and robotics background",
        },
      ],
    });

    const call = callChatCompletionMock.mock.calls[0]?.[0] as { model: string };
    expect(call.model).toBe("openai/gpt-4o-mini");
    expect(call.model).toContain("/");
    expect(call.model).not.toBe("claude-3-haiku");
    expect(result.model).toBe(call.model);
  });

  it("fails before the AI call when the runtime has no API key", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig({ apiKey: "" }));
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    logger.error.mockClear();

    const service = new AiSummaryService();
    const result = await service.generateSummary({
      workspaceSlug: "dev",
      query: "cnc",
      location: "China",
      results: [
        {
          id: "resume-1",
          name: "Lee",
          title: "Sales Engineer",
          location: "Shenzhen",
          score: 82,
          keywords: ["CNC", "Sales"],
          snippet: "CNC applications engineer",
        },
      ],
    });

    expect(callChatCompletionMock).not.toHaveBeenCalled();
    expect(result.model).toBe("heuristic/search-summary-fallback");
    expect(result.summary).toContain('Visible results for "cnc" currently include 1 candidates.');
    expect(result.summary).toContain("Shared themes are strongest around CNC, Sales.");
    expect(result.summary).toContain("Keep the location filter on China");
    expect(logger.error).toHaveBeenCalledWith(
      "AI summary generation unavailable, using heuristic fallback",
      expect.any(Error),
      { service: "ai-summary-service" },
    );
  });

  it("falls back to a heuristic summary when the AI call itself fails", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig());
    getWorkspaceConfigValueMock.mockResolvedValue("anthropic/claude-3-5-haiku-20241022");
    callChatCompletionMock.mockRejectedValue(new Error("provider timeout"));
    logger.error.mockClear();

    const service = new AiSummaryService();
    const result = await service.generateSummary({
      workspaceSlug: "dev",
      query: "machine tools sales",
      results: [
        {
          id: "resume-1",
          name: "Jane Tan",
          title: "Regional Sales Manager",
          location: "Kuala Lumpur",
          score: 92.4,
          keywords: ["Machine Tools", "CNC"],
          snippet: "Led CNC sales across SEA markets.",
        },
        {
          id: "resume-2",
          name: "Alex Lim",
          title: "Sales Engineer",
          location: "Johor",
          score: 87.2,
          keywords: ["Machine Tools", "Automation"],
          snippet: "Built machine tools pipeline coverage.",
        },
      ],
    });

    expect(result.model).toBe("heuristic/search-summary-fallback");
    expect(result.summary).toContain('Visible results for "machine tools sales" currently include 2 candidates.');
    expect(result.summary).toContain("Shared themes are strongest around Machine Tools");
    expect(result.summary).toContain("Visible scores range from 87 to 92");
    expect(logger.error).toHaveBeenCalledWith(
      "AI summary generation unavailable, using heuristic fallback",
      expect.any(Error),
      { service: "ai-summary-service" },
    );
  });
});
