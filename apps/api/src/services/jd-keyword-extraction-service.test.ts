import { afterEach, describe, expect, it, vi } from "vitest";

const {
  callChatCompletionMock,
  loadAIConfigMock,
} = vi.hoisted(() => ({
  callChatCompletionMock: vi.fn(),
  loadAIConfigMock: vi.fn(),
}));

vi.mock("./ai-config.js", () => ({
  loadAIConfig: () => loadAIConfigMock(),
}));

vi.mock("./ai-chat-client.js", () => ({
  callChatCompletion: (args: unknown) => callChatCompletionMock(args),
}));

import {
  JdKeywordExtractionService,
  normalizeExtractedKeywords,
  parseKeywordExtractionResponse,
} from "./jd-keyword-extraction-service.js";

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

describe("JdKeywordExtractionService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    callChatCompletionMock.mockReset();
    loadAIConfigMock.mockReset();
  });

  it("parses fenced JSON keyword output and deduplicates values", () => {
    const keywords = parseKeywordExtractionResponse(`\`\`\`json
{"keywords":["Machine Tools","Business Development","machine tools","Team Player"]}
\`\`\``);

    expect(keywords).toEqual([
      "Machine Tools",
      "Business Development",
    ]);
  });

  it("normalizes plain-text keyword lists", () => {
    const keywords = normalizeExtractedKeywords([
      "keywords: CNC",
      " machine tools ",
      "Business Development",
      "business development",
      "communication skills",
      "N/A",
    ]);

    expect(keywords).toEqual([
      "CNC",
      "machine tools",
      "Business Development",
    ]);
  });

  it("extracts recruiter keywords through the AI client and filters filler terms", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig());
    callChatCompletionMock.mockResolvedValue(`\`\`\`json
{"keywords":["Machine Tools","team player","CNC","machine tools"]}
\`\`\``);

    const service = new JdKeywordExtractionService();
    const result = await service.extractKeywords({
      text: "Responsibilities: machine tools sales; Requirements: CNC application experience; Team player",
    });

    expect(callChatCompletionMock).toHaveBeenCalledTimes(1);
    const call = callChatCompletionMock.mock.calls[0]?.[0] as {
      maxTokens: number;
      messages: Array<{ role: string; content: string }>;
      model: string;
      temperature: number;
    };

    expect(call.temperature).toBe(0);
    expect(call.maxTokens).toBe(400);
    expect(call.model).toBe("openai/gpt-4o-mini");
    expect(call.messages[0]?.content).toContain("Return JSON only");
    expect(call.messages[1]?.content).toContain("Extract the most useful resume-search keywords");
    expect(call.messages[1]?.content).toContain("Job description:");
    expect(result).toEqual({
      keywords: ["Machine Tools", "CNC"],
      model: call.model,
    });
  });

  it("throws when the AI response does not produce any usable keywords", async () => {
    loadAIConfigMock.mockReturnValue(createAIConfig());
    callChatCompletionMock.mockResolvedValue(`{"keywords":["team player","none","communication skills"]}`);

    const service = new JdKeywordExtractionService();

    await expect(
      service.extractKeywords({
        text: "Responsibilities: team player communication and responsible attitude",
      }),
    ).rejects.toThrow("No keywords could be extracted from the job description");
  });

  it("uses heuristic extraction in mock mode without calling the AI client", async () => {
    vi.stubEnv("AI_MOCK_ENABLED", "true");

    const service = new JdKeywordExtractionService();
    const result = await service.extractKeywords({
      text: "Requirements: CNC, Machine Tools; Responsibilities: business development; Team player",
    });

    expect(callChatCompletionMock).not.toHaveBeenCalled();
    expect(result.keywords).toEqual([
      "CNC",
      "Machine Tools",
      "business development",
    ]);
    expect(result.model).toContain("/");
  });
});
