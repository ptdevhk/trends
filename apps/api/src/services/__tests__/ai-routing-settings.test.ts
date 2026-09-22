import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCachedAiRoutingSettings,
  invalidateAiRoutingSettingsCache,
  loadEffectiveAIConfig,
  resetAiRoutingSettingsCacheForTest,
} from "../ai-routing-settings.js";
import { loadAIConfig } from "../ai-config.js";

vi.mock("../convex-utils.js", () => ({
  callConvexQuery: vi.fn(),
  callConvexMutation: vi.fn(),
}));

import { callConvexQuery } from "../convex-utils.js";

const mockQuery = vi.mocked(callConvexQuery);

describe("ai-routing-settings", () => {
  beforeEach(() => {
    resetAiRoutingSettingsCacheForTest();
    mockQuery.mockReset();
    process.env.AI_API_BASE = "https://env.api/v1";
    process.env.AI_MODEL = "openai/env-primary";
    process.env.AI_FALLBACK_MODEL = "openai/env-fallback";
    process.env.AI_API_KEY = "sk-env";
  });
  afterEach(() => {
    resetAiRoutingSettingsCacheForTest();
  });

  it("returns env-only effective config when Convex settings are null", async () => {
    mockQuery.mockResolvedValue({
      apiBase: null,
      model: null,
      fallbackModel: null,
    });
    const config = await loadEffectiveAIConfig();
    expect(config.model).toBe("openai/env-primary");
    expect(config.fallbackModel).toBe("openai/env-fallback");
    expect(config.apiBase).toBe("https://env.api/v1");
    expect(config.apiKey).toBe("sk-env");
  });

  it("overrides model/base from settings; key stays from env", async () => {
    mockQuery.mockResolvedValue({
      apiBase: "https://settings.api/v1",
      model: "openai/settings-primary",
      fallbackModel: null,
    });
    const config = await loadEffectiveAIConfig();
    expect(config.model).toBe("openai/settings-primary");
    expect(config.apiBase).toBe("https://settings.api/v1");
    // fallbackModel null → env fallback
    expect(config.fallbackModel).toBe("openai/env-fallback");
    // apiKey always from env, never from settings
    expect(config.apiKey).toBe("sk-env");
  });

  it("caches within TTL and invalidate forces a refresh", async () => {
    mockQuery.mockResolvedValue({ apiBase: "https://v1.api/v1", model: null, fallbackModel: null });
    await getCachedAiRoutingSettings();
    await getCachedAiRoutingSettings();
    expect(mockQuery).toHaveBeenCalledTimes(1);

    invalidateAiRoutingSettingsCache();
    await getCachedAiRoutingSettings();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("falls back to env when Convex query errors", async () => {
    mockQuery.mockRejectedValue(new Error("convex down"));
    const config = await loadEffectiveAIConfig();
    expect(config.model).toBe("openai/env-primary");
    expect(config.apiBase).toBe("https://env.api/v1");
  });
});
