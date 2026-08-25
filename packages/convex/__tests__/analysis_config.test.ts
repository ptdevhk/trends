import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for packages/convex/convex/lib/analysis_config.ts
// ---------------------------------------------------------------------------

// Mock the @trends/shared module before importing the module under test
vi.mock("@trends/shared", () => ({
  DEFAULT_RESUME_AI_PROMPT_LOCALE: "zh-Hans",
  buildResumeAiSystemPrompt: (locale: string) => `system-prompt-${locale}`,
  getResumeAiPromptDefinition: (locale: string) => ({
    sections: { systemPrompt: `system-prompt-${locale}` },
    promptVersion: "1.0",
  }),
  getResumeAiUserPromptTemplate: (locale: string) => `user-template-${locale}`,
  resolveResumeAnalysisSourceKey: ({ source }: { source?: string }) =>
    source === "seek" ? "seek" : source === "boss" ? "boss" : "default",
  resolveResumeAiPromptLocale: (locale: string | undefined) => ({
    requestedLocale: locale ?? "zh-Hans",
  }),
}));

vi.mock("./ai_model.js", () => ({
  warnUnknownModel: (model: string) => model,
}));

import {
  inferSourceKey,
  resolveAIOutputLocale,
  buildSystemPrompt,
  getUserPromptTemplate,
  getAiApiKey,
  getAiApiBase,
  getAiModel,
  getAiFallbackModel,
  getAiTemperature,
  resolveAnalyzeLlmRuntimeConfig,
  SYSTEM_PROMPT,
  USER_PROMPT_TEMPLATE,
} from "../convex/lib/analysis_config.js";

// ---------------------------------------------------------------------------
// inferSourceKey
// ---------------------------------------------------------------------------

describe("inferSourceKey", () => {
  it("returns 'seek' for seek source", () => {
    expect(inferSourceKey("seek")).toBe("seek");
  });

  it("returns 'boss' for boss source", () => {
    expect(inferSourceKey("boss")).toBe("boss");
  });

  it("returns 'default' for undefined source", () => {
    expect(inferSourceKey(undefined)).toBe("default");
  });

  it("returns 'default' for unknown source", () => {
    expect(inferSourceKey("unknown")).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// resolveAIOutputLocale
// ---------------------------------------------------------------------------

describe("resolveAIOutputLocale", () => {
  afterEach(() => {
    delete process.env.AI_OUTPUT_LOCALE;
  });

  it("returns 'en' for seek sourceKey override", () => {
    expect(resolveAIOutputLocale({ sourceKey: "seek" })).toBe("en");
  });

  it("returns env var locale when set", () => {
    process.env.AI_OUTPUT_LOCALE = "en";
    expect(resolveAIOutputLocale()).toBe("en");
  });

  it("returns env var locale when set to zh-Hant", () => {
    process.env.AI_OUTPUT_LOCALE = "zh-Hant";
    expect(resolveAIOutputLocale()).toBe("zh-Hant");
  });

  it("returns default zh-Hans when no env var and no sourceKey", () => {
    expect(resolveAIOutputLocale()).toBe("zh-Hans");
  });

  it("prioritizes seek override over env var", () => {
    process.env.AI_OUTPUT_LOCALE = "zh-Hant";
    expect(resolveAIOutputLocale({ sourceKey: "seek" })).toBe("en");
  });

  it("ignores non-seek sourceKey (falls through to env/default)", () => {
    process.env.AI_OUTPUT_LOCALE = "en";
    expect(resolveAIOutputLocale({ sourceKey: "boss" })).toBe("en");
  });

  it("trims whitespace from env var", () => {
    process.env.AI_OUTPUT_LOCALE = "  en  ";
    expect(resolveAIOutputLocale()).toBe("en");
  });

  it("ignores empty env var string", () => {
    process.env.AI_OUTPUT_LOCALE = "  ";
    expect(resolveAIOutputLocale()).toBe("zh-Hans");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("builds system prompt for given locale", () => {
    expect(buildSystemPrompt("en")).toBe("system-prompt-en");
  });

  it("builds system prompt for zh-Hans locale", () => {
    expect(buildSystemPrompt("zh-Hans")).toBe("system-prompt-zh-Hans");
  });
});

// ---------------------------------------------------------------------------
// getUserPromptTemplate
// ---------------------------------------------------------------------------

describe("getUserPromptTemplate", () => {
  it("returns user prompt template for given locale", () => {
    expect(getUserPromptTemplate("en")).toBe("user-template-en");
  });
});

// ---------------------------------------------------------------------------
// Constants (SYSTEM_PROMPT, USER_PROMPT_TEMPLATE)
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SYSTEM_PROMPT is built from default locale", () => {
    expect(SYSTEM_PROMPT).toBe("system-prompt-zh-Hans");
  });

  it("USER_PROMPT_TEMPLATE is built from default locale", () => {
    expect(USER_PROMPT_TEMPLATE).toBe("user-template-zh-Hans");
  });
});

// ---------------------------------------------------------------------------
// getAiApiKey
// ---------------------------------------------------------------------------

describe("getAiApiKey", () => {
  afterEach(() => {
    delete process.env.AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("returns AI_API_KEY when set", () => {
    process.env.AI_API_KEY = "sk-ai";
    expect(getAiApiKey()).toBe("sk-ai");
  });

  it("falls back to OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(getAiApiKey()).toBe("sk-openai");
  });

  it("prefers AI_API_KEY over OPENAI_API_KEY", () => {
    process.env.AI_API_KEY = "sk-ai";
    process.env.OPENAI_API_KEY = "sk-openai";
    expect(getAiApiKey()).toBe("sk-ai");
  });

  it("returns undefined when neither is set", () => {
    expect(getAiApiKey()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAiApiBase
// ---------------------------------------------------------------------------

describe("getAiApiBase", () => {
  afterEach(() => {
    delete process.env.AI_API_BASE;
    delete process.env.OPENAI_API_BASE;
  });

  it("returns AI_API_BASE when set", () => {
    process.env.AI_API_BASE = "https://custom.api/v1";
    expect(getAiApiBase()).toBe("https://custom.api/v1");
  });

  it("falls back to OPENAI_API_BASE", () => {
    process.env.OPENAI_API_BASE = "https://openai.proxy/v1";
    expect(getAiApiBase()).toBe("https://openai.proxy/v1");
  });

  it("defaults to OpenAI API URL", () => {
    expect(getAiApiBase()).toBe("https://api.openai.com/v1");
  });
});

// ---------------------------------------------------------------------------
// getAiModel
// ---------------------------------------------------------------------------

describe("getAiModel", () => {
  afterEach(() => {
    delete process.env.AI_MODEL;
    delete process.env.OPENAI_MODEL;
  });

  it("returns AI_MODEL when set", () => {
    process.env.AI_MODEL = "gpt-4o";
    expect(getAiModel()).toBe("gpt-4o");
  });

  it("falls back to OPENAI_MODEL", () => {
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    expect(getAiModel()).toBe("gpt-4o-mini");
  });

  it("defaults to openai/deepseek-v4-flash", () => {
    expect(getAiModel()).toBe("openai/deepseek-v4-flash");
  });
});

describe("getAiFallbackModel", () => {
  afterEach(() => {
    delete process.env.AI_FALLBACK_MODEL;
  });

  it("returns AI_FALLBACK_MODEL when set", () => {
    process.env.AI_FALLBACK_MODEL = "openai/deepseek-v4-flash";
    expect(getAiFallbackModel()).toBe("openai/deepseek-v4-flash");
  });

  it("defaults to openai/deepseek-v4-flash-e (fallback)", () => {
    delete process.env.AI_FALLBACK_MODEL;
    expect(getAiFallbackModel()).toBe("openai/deepseek-v4-flash-e");
  });
});

describe("resolveAnalyzeLlmRuntimeConfig (call-time, no process reload)", () => {
  const keys = ["AI_API_BASE", "OPENAI_API_BASE", "AI_MODEL", "OPENAI_MODEL", "AI_FALLBACK_MODEL"] as const;
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      originals[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  });

  it("returns new provider base and model names on a second call after env swap", () => {
    process.env.AI_API_BASE = "https://api.poe.com/v1";
    process.env.AI_MODEL = "openai/deepseek-v4-flash";
    process.env.AI_FALLBACK_MODEL = "openai/deepseek-v4-flash-e";
    expect(resolveAnalyzeLlmRuntimeConfig()).toEqual({
      apiBase: "https://api.poe.com/v1",
      primary: "openai/deepseek-v4-flash",
      fallback: "openai/deepseek-v4-flash-e",
    });

    process.env.AI_API_BASE = "https://api.example-runtime.test/v1";
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    process.env.AI_FALLBACK_MODEL = "openai/deepseek-chat";
    expect(resolveAnalyzeLlmRuntimeConfig()).toEqual({
      apiBase: "https://api.example-runtime.test/v1",
      primary: "openai/gpt-4o-mini",
      fallback: "openai/deepseek-chat",
    });
  });
});

// ---------------------------------------------------------------------------
// getAiTemperature
// ---------------------------------------------------------------------------

describe("getAiTemperature", () => {
  afterEach(() => {
    delete process.env.AI_TEMPERATURE;
  });

  it("parses a valid temperature", () => {
    process.env.AI_TEMPERATURE = "0.5";
    expect(getAiTemperature()).toBe(0.5);
  });

  it("parses zero temperature", () => {
    process.env.AI_TEMPERATURE = "0";
    expect(getAiTemperature()).toBe(0);
  });

  it("parses integer temperature", () => {
    process.env.AI_TEMPERATURE = "1";
    expect(getAiTemperature()).toBe(1);
  });

  it("defaults to 0 when env var is not set", () => {
    expect(getAiTemperature()).toBe(0);
  });

  it("defaults to 0 for empty string", () => {
    process.env.AI_TEMPERATURE = "";
    expect(getAiTemperature()).toBe(0);
  });

  it("defaults to 0 for whitespace-only string", () => {
    process.env.AI_TEMPERATURE = "   ";
    expect(getAiTemperature()).toBe(0);
  });

  it("defaults to 0 for non-numeric string", () => {
    process.env.AI_TEMPERATURE = "high";
    expect(getAiTemperature()).toBe(0);
  });

  it("defaults to 0 for NaN-like string", () => {
    process.env.AI_TEMPERATURE = "NaN";
    expect(getAiTemperature()).toBe(0);
  });

  it("defaults to 0 for Infinity", () => {
    process.env.AI_TEMPERATURE = "Infinity";
    expect(getAiTemperature()).toBe(0);
  });
});
