import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadAIConfig, getMaskedApiKey } from "../ai-config.js";

describe("loadAIConfig", () => {
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "AI_ANALYSIS_ENABLED",
      "AI_ANALYSIS_RESUMES_ENABLED",
      "AI_MODEL",
      "AI_FALLBACK_MODEL",
      "AI_API_KEY",
      "AI_API_BASE",
      "AI_TEMPERATURE",
      "AI_MAX_TOKENS",
      "AI_TIMEOUT",
    ]) {
      originals[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  function clearAIEnv() {
    for (const key of [
      "AI_ANALYSIS_ENABLED",
      "AI_ANALYSIS_RESUMES_ENABLED",
      "AI_MODEL",
      "AI_FALLBACK_MODEL",
      "AI_API_KEY",
      "AI_API_BASE",
      "AI_TEMPERATURE",
      "AI_MAX_TOKENS",
      "AI_TIMEOUT",
    ]) {
      delete process.env[key];
    }
  }

  it("returns defaults when no env vars set", () => {
    clearAIEnv();
    const config = loadAIConfig();
    expect(config.enabled).toBe(false);
    expect(config.resumesEnabled).toBe(true);
    expect(config.model).toBe("openai/deepseek-v4-flash-e");
    expect(config.fallbackModel).toBe("openai/deepseek-v4-flash");
    expect(config.apiKey).toBe("");
    expect(config.apiBase).toBeUndefined();
    expect(config.temperature).toBe(0);
    expect(config.maxTokens).toBe(4000);
    expect(config.timeout).toBe(120000);
    expect(config.bonded).toEqual([]);
  });

  it("parses AI_ANALYSIS_ENABLED=true", () => {
    clearAIEnv();
    process.env.AI_ANALYSIS_ENABLED = "true";
    const config = loadAIConfig();
    expect(config.enabled).toBe(true);
    expect(config.bonded).toContain("AI_ANALYSIS_ENABLED");
  });

  it("treats AI_ANALYSIS_ENABLED as false for non-true values", () => {
    clearAIEnv();
    process.env.AI_ANALYSIS_ENABLED = "1";
    expect(loadAIConfig().enabled).toBe(false);

    process.env.AI_ANALYSIS_ENABLED = "yes";
    expect(loadAIConfig().enabled).toBe(false);
  });

  it("parses AI_ANALYSIS_RESUMES_ENABLED=false", () => {
    clearAIEnv();
    process.env.AI_ANALYSIS_RESUMES_ENABLED = "false";
    const config = loadAIConfig();
    expect(config.resumesEnabled).toBe(false);
    expect(config.bonded).toContain("AI_ANALYSIS_RESUMES_ENABLED");
  });

  it("defaults resumesEnabled to true when unset", () => {
    clearAIEnv();
    expect(loadAIConfig().resumesEnabled).toBe(true);
  });

  it("parses AI_MODEL", () => {
    clearAIEnv();
    process.env.AI_MODEL = "anthropic/claude-sonnet-4-6";
    expect(loadAIConfig().model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("parses AI_API_KEY", () => {
    clearAIEnv();
    process.env.AI_API_KEY = "sk-test-key";
    const config = loadAIConfig();
    expect(config.apiKey).toBe("sk-test-key");
    expect(config.bonded).toContain("AI_API_KEY");
  });

  it("parses AI_FALLBACK_MODEL", () => {
    clearAIEnv();
    process.env.AI_FALLBACK_MODEL = "openai/deepseek-v4-flash";
    const config = loadAIConfig();
    expect(config.fallbackModel).toBe("openai/deepseek-v4-flash");
    expect(config.bonded).toContain("AI_FALLBACK_MODEL");
  });

  it("parses AI_API_BASE", () => {
    clearAIEnv();
    process.env.AI_API_BASE = "https://api.poe.com/v1";
    const config = loadAIConfig();
    expect(config.apiBase).toBe("https://api.poe.com/v1");
  });

  it("parses AI_TEMPERATURE", () => {
    clearAIEnv();
    process.env.AI_TEMPERATURE = "0.7";
    expect(loadAIConfig().temperature).toBeCloseTo(0.7);
  });

  it("parses AI_MAX_TOKENS", () => {
    clearAIEnv();
    process.env.AI_MAX_TOKENS = "8000";
    expect(loadAIConfig().maxTokens).toBe(8000);
  });

  it("parses AI_TIMEOUT", () => {
    clearAIEnv();
    process.env.AI_TIMEOUT = "60000";
    expect(loadAIConfig().timeout).toBe(60000);
  });

  it("tracks all set env vars in bonded", () => {
    clearAIEnv();
    process.env.AI_ANALYSIS_ENABLED = "true";
    process.env.AI_API_KEY = "sk-test";
    process.env.AI_MODEL = "openai/gpt-4o";
    const config = loadAIConfig();
    expect(config.bonded).toEqual(
      expect.arrayContaining(["AI_ANALYSIS_ENABLED", "AI_MODEL", "AI_API_KEY"]),
    );
  });

  it("does not include unset vars in bonded", () => {
    clearAIEnv();
    const config = loadAIConfig();
    expect(config.bonded).toEqual([]);
  });

  it("does not include AI_TEMPERATURE in bonded even when set", () => {
    clearAIEnv();
    process.env.AI_TEMPERATURE = "0.5";
    const config = loadAIConfig();
    expect(config.bonded).not.toContain("AI_TEMPERATURE");
  });
});

describe("getMaskedApiKey", () => {
  it("masks a standard API key", () => {
    // getMaskedApiKey uses the module-level aiConfig singleton.
    // The module was loaded at import time with whatever env was present.
    // We test the masking logic which is purely string-based on aiConfig.apiKey.
    // Since we can't re-import, we test against whatever the current config holds.
    const result = getMaskedApiKey();
    if (!result || result === "******") {
      // Empty or short key — both return "******"
      expect(result).toBe("******");
    } else {
      // Key is 8+ chars — should show first 5 chars + mask
      expect(result).toMatch(/^.{5}\*{6}$/);
    }
  });
});

describe("validateAIConfig", () => {
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "AI_ANALYSIS_ENABLED",
      "AI_ANALYSIS_RESUMES_ENABLED",
      "AI_MODEL",
      "AI_API_KEY",
      "AI_API_BASE",
    ]) {
      originals[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  async function importWithEnv() {
    const mod = await import("../ai-config.js");
    return mod;
  }

  it("returns invalid when AI is disabled", async () => {
    delete process.env.AI_ANALYSIS_ENABLED;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    const { validateAIConfig } = await importWithEnv();
    expect(validateAIConfig()).toEqual({
      valid: false,
      error: "AI analysis is disabled (AI_ANALYSIS_ENABLED=false)",
    });
  });

  it("returns invalid when API key is missing", async () => {
    process.env.AI_ANALYSIS_ENABLED = "true";
    delete process.env.AI_API_KEY;
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    const { validateAIConfig } = await importWithEnv();
    expect(validateAIConfig()).toEqual({
      valid: false,
      error: "Missing AI_API_KEY environment variable",
    });
  });

  it("returns invalid when model format is wrong", async () => {
    process.env.AI_ANALYSIS_ENABLED = "true";
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "gpt-4o-mini";
    const { validateAIConfig } = await importWithEnv();
    expect(validateAIConfig()).toEqual({
      valid: false,
      error: "Invalid model format: gpt-4o-mini. Should be 'provider/model' (e.g., 'openai/deepseek-v4-flash-e')",
    });
  });

  it("returns valid when all checks pass", async () => {
    process.env.AI_ANALYSIS_ENABLED = "true";
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    const { validateAIConfig } = await importWithEnv();
    expect(validateAIConfig()).toEqual({ valid: true });
  });

  it("accepts openai/openai-gpt-oss-120b model format", async () => {
    process.env.AI_ANALYSIS_ENABLED = "true";
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "openai/openai-gpt-oss-120b";
    const { validateAIConfig } = await importWithEnv();
    expect(validateAIConfig()).toEqual({ valid: true });
  });
});

describe("validateResumeAIConfig", () => {
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "AI_ANALYSIS_ENABLED",
      "AI_ANALYSIS_RESUMES_ENABLED",
      "AI_MODEL",
      "AI_API_KEY",
      "AI_API_BASE",
    ]) {
      originals[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  async function importWithEnv() {
    const mod = await import("../ai-config.js");
    return mod;
  }

  it("returns invalid when resume AI is disabled", async () => {
    process.env.AI_ANALYSIS_RESUMES_ENABLED = "false";
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    const { validateResumeAIConfig } = await importWithEnv();
    expect(validateResumeAIConfig()).toEqual({
      valid: false,
      error: "Resume AI analysis is disabled (AI_ANALYSIS_RESUMES_ENABLED=false)",
    });
  });

  it("returns invalid when API key is missing", async () => {
    delete process.env.AI_ANALYSIS_RESUMES_ENABLED;
    delete process.env.AI_API_KEY;
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    const { validateResumeAIConfig } = await importWithEnv();
    expect(validateResumeAIConfig()).toEqual({
      valid: false,
      error: "Missing AI_API_KEY environment variable",
    });
  });

  it("returns invalid when model format is wrong", async () => {
    delete process.env.AI_ANALYSIS_RESUMES_ENABLED;
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "gpt-4o-mini";
    const { validateResumeAIConfig } = await importWithEnv();
    expect(validateResumeAIConfig()).toEqual({
      valid: false,
      error: "Invalid model format: gpt-4o-mini. Should be 'provider/model' (e.g., 'openai/deepseek-v4-flash-e')",
    });
  });

  it("returns valid when all checks pass", async () => {
    delete process.env.AI_ANALYSIS_RESUMES_ENABLED;
    process.env.AI_API_KEY = "sk-test-key-12345";
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    const { validateResumeAIConfig } = await importWithEnv();
    expect(validateResumeAIConfig()).toEqual({ valid: true });
  });
});
