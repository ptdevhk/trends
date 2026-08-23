import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAIConfig: vi.fn(),
  callChatCompletion: vi.fn(),
  getIndustryProposal: vi.fn(),
  listIndustryEvidenceSources: vi.fn(),
  callConvexMutation: vi.fn(),
  getConvexWriteSecret: vi.fn(),
}));

vi.mock("./ai-config.js", () => ({
  loadAIConfig: mocks.loadAIConfig,
}));

vi.mock("./ai-chat-client.js", () => ({
  callChatCompletion: mocks.callChatCompletion,
}));

vi.mock("./company-industry-proposal-service.js", () => ({
  getIndustryProposal: mocks.getIndustryProposal,
}));

vi.mock("./company-industry-evidence-service.js", () => ({
  listIndustryEvidenceSources: mocks.listIndustryEvidenceSources,
}));

vi.mock("./convex-utils.js", () => ({
  callConvexMutation: mocks.callConvexMutation,
}));

vi.mock("./config.js", () => ({
  getConvexWriteSecret: mocks.getConvexWriteSecret,
}));

import {
  refreshMachineOriginSuggestion,
  suggestMachineOrigin,
} from "./machine-origin-suggestion-service.js";
import type { IndustryProposal } from "./company-industry-contracts.js";

const enabledConfig = {
  enabled: true,
  resumesEnabled: true,
  model: "openai/deepseek-v4-flash-e",
  fallbackModel: "openai/deepseek-v4-flash",
  apiKey: "test-key",
  temperature: 0,
  maxTokens: 4000,
  timeout: 120000,
  bonded: [],
};

const source = {
  _id: "source-1",
  sourceId: "src-1",
  url: "https://example.com/catalog",
  sourceDomain: "example.com",
  sourceType: "official_site" as const,
  trustTier: "primary" as const,
  title: "Official catalog",
  evidenceExcerpt: "The catalog lists domestic CNC brands.",
  fetchStatus: "fetched" as const,
};

const baseProposal = {
  _id: "proposal-1",
  proposalId: "proposal-1",
  companyKey: "acme-cnc",
  normalizedEmployerSurface: "ACME CNC SDN BHD",
  triggerReasons: [],
  priority: 1,
  status: "pending",
  suggestedIndustryClass: "cnc",
  createdAt: 100,
  updatedAt: 100,
} as unknown as IndustryProposal;

function validAIJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    suggestedMachineOrigin: "domestic",
    confidence: 0.82,
    evidenceExcerpt: "Official catalog lists domestic brand.",
    sourceUrl: "https://example.com/catalog",
    sourceTitle: "Official catalog",
    ...overrides,
  });
}

describe("suggestMachineOrigin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAIConfig.mockReturnValue(enabledConfig);
    mocks.callChatCompletion.mockResolvedValue(validAIJSON());
  });

  it("returns undefined without calling the AI when AI is disabled", async () => {
    mocks.loadAIConfig.mockReturnValue({ ...enabledConfig, enabled: false });

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toBeUndefined();
    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
  });

  it("returns undefined when the chat completion throws", async () => {
    mocks.callChatCompletion.mockRejectedValue(new Error("network down"));

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toBeUndefined();
  });

  it("returns a suggestion with the configured model on valid output", async () => {
    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toEqual({
      suggestedMachineOrigin: "domestic",
      confidence: 0.82,
      evidenceExcerpt: "Official catalog lists domestic brand.",
      sourceUrl: "https://example.com/catalog",
      sourceTitle: "Official catalog",
      model: "openai/deepseek-v4-flash-e",
    });
    expect(mocks.callChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 1000, temperature: 0 }),
    );
  });

  it("strips markdown code fences from the AI output", async () => {
    mocks.callChatCompletion.mockResolvedValue(
      "```json\n" + validAIJSON({ confidence: 0.9 }) + "\n```",
    );

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result?.confidence).toBe(0.9);
    expect(result?.suggestedMachineOrigin).toBe("domestic");
  });

  it("returns undefined on non-JSON output", async () => {
    mocks.callChatCompletion.mockResolvedValue("sorry, I cannot do that");

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toBeUndefined();
  });

  it("rejects an invalid suggestedMachineOrigin value", async () => {
    mocks.callChatCompletion.mockResolvedValue(
      validAIJSON({ suggestedMachineOrigin: "european" }),
    );

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toBeUndefined();
  });

  it.each([1.5, -0.1, 0.9999 + 0.0002])(
    "rejects out-of-range confidence %s",
    async (confidence) => {
      mocks.callChatCompletion.mockResolvedValue(
        validAIJSON({ confidence: String(confidence) }),
      );

      const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

      expect(result).toBeUndefined();
    },
  );

  it("rejects a non-numeric confidence", async () => {
    mocks.callChatCompletion.mockResolvedValue(validAIJSON({ confidence: "high" }));

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toBeUndefined();
  });

  it("maps missing optional fields to undefined", async () => {
    mocks.callChatCompletion.mockResolvedValue(
      validAIJSON({ evidenceExcerpt: "", sourceUrl: "", sourceTitle: "" }),
    );

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result).toEqual({
      suggestedMachineOrigin: "domestic",
      confidence: 0.82,
      model: "openai/deepseek-v4-flash-e",
    });
  });

  it("truncates evidence fields to bounded lengths", async () => {
    const longExcerpt = "e".repeat(900);
    const longUrl = "u".repeat(900);
    const longTitle = "t".repeat(900);
    mocks.callChatCompletion.mockResolvedValue(
      validAIJSON({
        evidenceExcerpt: longExcerpt,
        sourceUrl: longUrl,
        sourceTitle: longTitle,
      }),
    );

    const result = await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    expect(result?.evidenceExcerpt).toBe("e".repeat(600));
    expect(result?.sourceUrl).toBe("u".repeat(500));
    expect(result?.sourceTitle).toBe("t".repeat(300));
  });

  it("caps the evidence sources passed to the prompt at 15", async () => {
    const manySources = Array.from({ length: 20 }, (_, i) => ({
      ...source,
      _id: `source-${i}`,
      sourceId: `src-${i}`,
      title: `Source ${i}`,
      url: `https://example.com/${i}`,
    }));

    await suggestMachineOrigin("ACME CNC", "cnc", manySources);

    const userMessage = mocks.callChatCompletion.mock.calls[0][0].messages[1].content;
    expect(userMessage).toContain("[Source 1]");
    expect(userMessage).toContain("[Source 15]");
    expect(userMessage).not.toContain("[Source 16]");
  });

  it("passes the company name and industry class into the prompt", async () => {
    await suggestMachineOrigin("ACME CNC", "cnc", [source]);

    const userMessage = mocks.callChatCompletion.mock.calls[0][0].messages[1].content;
    expect(userMessage).toContain("Company: ACME CNC");
    expect(userMessage).toContain("Industry: cnc");
  });

  it("handles the no-evidence case with a placeholder line", async () => {
    await suggestMachineOrigin("ACME CNC", "cnc", []);

    const userMessage = mocks.callChatCompletion.mock.calls[0][0].messages[1].content;
    expect(userMessage).toContain("No evidence sources available.");
  });
});

describe("refreshMachineOriginSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAIConfig.mockReturnValue(enabledConfig);
    mocks.callChatCompletion.mockResolvedValue(validAIJSON());
    mocks.getIndustryProposal.mockResolvedValue(baseProposal);
    mocks.listIndustryEvidenceSources.mockResolvedValue([source]);
    mocks.getConvexWriteSecret.mockReturnValue("write-secret");
    mocks.callConvexMutation.mockResolvedValue({ proposalId: "proposal-1" });
  });

  it("skips without writing when the proposal does not exist", async () => {
    mocks.getIndustryProposal.mockResolvedValue(null);

    await refreshMachineOriginSuggestion("missing");

    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });

  it("skips when a suggestion already exists on the proposal", async () => {
    mocks.getIndustryProposal.mockResolvedValue({
      ...baseProposal,
      suggestedMachineOrigin: "domestic",
    } as unknown as IndustryProposal);

    await refreshMachineOriginSuggestion("proposal-1");

    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });

  it("skips when sourcesOnly is set and no evidence sources exist", async () => {
    mocks.listIndustryEvidenceSources.mockResolvedValue([]);

    await refreshMachineOriginSuggestion("proposal-1", { sourcesOnly: true });

    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });

  it("runs without evidence when sourcesOnly is not set", async () => {
    mocks.listIndustryEvidenceSources.mockResolvedValue([]);

    await refreshMachineOriginSuggestion("proposal-1");

    expect(mocks.callChatCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.callConvexMutation).toHaveBeenCalledTimes(1);
  });

  it("skips when the proposal has no company name", async () => {
    mocks.getIndustryProposal.mockResolvedValue({
      ...baseProposal,
      companyKey: undefined,
      normalizedEmployerSurface: undefined,
    } as unknown as IndustryProposal);

    await refreshMachineOriginSuggestion("proposal-1");

    expect(mocks.callChatCompletion).not.toHaveBeenCalled();
    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });

  it("does not write when the AI returns no suggestion", async () => {
    mocks.callChatCompletion.mockResolvedValue("not json");

    await refreshMachineOriginSuggestion("proposal-1");

    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });

  it("patches the proposal through the industry_proposals mutation with the write secret", async () => {
    await refreshMachineOriginSuggestion("proposal-1");

    expect(mocks.callConvexMutation).toHaveBeenCalledWith(
      "industry_proposals:setIndustryProposalMachineOriginSuggestion",
      {
        proposalId: "proposal-1",
        writeSecret: "write-secret",
        suggestedMachineOrigin: "domestic",
        confidence: 0.82,
        evidenceExcerpt: "Official catalog lists domestic brand.",
        sourceUrl: "https://example.com/catalog",
        sourceTitle: "Official catalog",
        model: "openai/deepseek-v4-flash-e",
      },
    );
  });

  it("feeds the proposal company key and industry class into the AI call", async () => {
    await refreshMachineOriginSuggestion("proposal-1");

    const userMessage = mocks.callChatCompletion.mock.calls[0][0].messages[1].content;
    expect(userMessage).toContain("Company: acme-cnc");
    expect(userMessage).toContain("Industry: cnc");
  });

  it("swallows errors from the proposal lookup without rethrowing", async () => {
    mocks.getIndustryProposal.mockRejectedValue(new Error("convex down"));

    await expect(refreshMachineOriginSuggestion("proposal-1")).resolves.toBeUndefined();
    expect(mocks.callConvexMutation).not.toHaveBeenCalled();
  });
});
