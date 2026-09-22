import { describe, it, expect } from "vitest";
import {
  CURATED_AI_ROUTING_MODELS,
  normalizeAiApiBase,
  isProviderModelForm,
  mapGatewayModelIdToProviderModel,
} from "../ai-routing-models.js";

describe("CURATED_AI_ROUTING_MODELS", () => {
  it("contains the default primary and fallback DeepSeek models", () => {
    expect(CURATED_AI_ROUTING_MODELS).toContain("openai/deepseek-v4-flash");
    expect(CURATED_AI_ROUTING_MODELS).toContain("openai/deepseek-v4-flash-e");
  });
});

describe("normalizeAiApiBase", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeAiApiBase("  https://cpa.pt-mes.com/v1  ")).toBe(
      "https://cpa.pt-mes.com/v1",
    );
  });

  it("strips a single trailing slash", () => {
    expect(normalizeAiApiBase("https://cpa.pt-mes.com/v1/")).toBe(
      "https://cpa.pt-mes.com/v1",
    );
  });

  it("keeps the /v1 suffix when present", () => {
    expect(normalizeAiApiBase("https://cpa.pt-mes.com/v1")).toBe(
      "https://cpa.pt-mes.com/v1",
    );
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAiApiBase("")).toBe("");
    expect(normalizeAiApiBase("   ")).toBe("");
  });
});

describe("isProviderModelForm", () => {
  it("accepts exactly one slash with non-empty sides", () => {
    expect(isProviderModelForm("openai/deepseek-v4-flash")).toBe(true);
    expect(isProviderModelForm("dd/deepseek-v4-flash")).toBe(true);
  });

  it("rejects bare model without slash", () => {
    expect(isProviderModelForm("deepseek-v4-flash")).toBe(false);
  });

  it("rejects empty sides and extra slashes", () => {
    expect(isProviderModelForm("/model")).toBe(false);
    expect(isProviderModelForm("provider/")).toBe(false);
    expect(isProviderModelForm("a/b/c")).toBe(false);
    expect(isProviderModelForm("")).toBe(false);
  });
});

describe("mapGatewayModelIdToProviderModel", () => {
  it("maps bare CPA id to openai prefix", () => {
    expect(mapGatewayModelIdToProviderModel("deepseek-v4-flash")).toBe(
      "openai/deepseek-v4-flash",
    );
    expect(mapGatewayModelIdToProviderModel("deepseek-v4-flash-e")).toBe(
      "openai/deepseek-v4-flash-e",
    );
  });

  it("maps dd/ prefixed lite model to openai prefix", () => {
    expect(mapGatewayModelIdToProviderModel("dd/deepseek-v4-flash")).toBe(
      "openai/deepseek-v4-flash",
    );
  });

  it("passes through an already provider-prefixed id unchanged", () => {
    expect(mapGatewayModelIdToProviderModel("openai/deepseek-v4-flash")).toBe(
      "openai/deepseek-v4-flash",
    );
    expect(mapGatewayModelIdToProviderModel("anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
  });
});
