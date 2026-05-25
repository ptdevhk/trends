import { describe, expect, it } from "vitest";

import { ResumeAiPromptService, LOCALE_TO_NATURAL_LANGUAGE, DEFAULT_RESUME_AI_PROMPT_LOCALE } from "./resume-ai-prompt-service";

// Use the project root so loadPrompt can find config/resume/ai-prompts.md
const svc = new ResumeAiPromptService();

// ---------------------------------------------------------------------------
// renderUserPromptTemplate
// ---------------------------------------------------------------------------

describe("ResumeAiPromptService.renderUserPromptTemplate", () => {
  it("allows extra values and only requires placeholders used by the template", () => {
    const rendered = svc.renderUserPromptTemplate(
      "Hello {candidateName}, role {jobTitle}",
      {
        candidateName: "Alice",
        jobTitle: "Sales Engineer",
        workExperience: "5",
        education: "本科",
        companies: "Foo Corp",
      },
    );

    expect(rendered).toBe("Hello Alice, role Sales Engineer");
  });

  it("throws when a placeholder is missing from the provided values", () => {
    expect(() =>
      svc.renderUserPromptTemplate("Hello {candidateName}, role {jobTitle}", {
        candidateName: "Alice",
      }),
    ).toThrow(/jobTitle/);
  });

  it("replaces all occurrences of the same variable", () => {
    const rendered = svc.renderUserPromptTemplate(
      "{candidateName} is {candidateName}",
      { candidateName: "Bob" },
    );
    expect(rendered).toBe("Bob is Bob");
  });

  it("returns the template unchanged when there are no placeholders", () => {
    const rendered = svc.renderUserPromptTemplate("No placeholders here", {});
    expect(rendered).toBe("No placeholders here");
  });

  it("handles empty values", () => {
    const rendered = svc.renderUserPromptTemplate("Hello {name}", { name: "" });
    expect(rendered).toBe("Hello ");
  });

  it("recognizes variables with underscores and digits", () => {
    const rendered = svc.renderUserPromptTemplate(
      "{var_1} and {myVar2}",
      { var_1: "a", myVar2: "b" },
    );
    expect(rendered).toBe("a and b");
  });

  it("does not treat {1bad} as a variable (must start with letter)", () => {
    // Variable pattern is /\{([A-Za-z][A-Za-z0-9_]*)\}/g
    // {1bad} doesn't match, so no missing-variable error
    const rendered = svc.renderUserPromptTemplate("{1bad}", {});
    expect(rendered).toBe("{1bad}");
  });

  it("throws listing all missing variables", () => {
    expect(() =>
      svc.renderUserPromptTemplate("{a} {b} {c}", { b: "x" }),
    ).toThrow(/a.*c/);
  });
});

// ---------------------------------------------------------------------------
// resolveLocale
// ---------------------------------------------------------------------------

describe("ResumeAiPromptService.resolveLocale", () => {
  it("defaults to zh-Hans when no locale provided", () => {
    const resolution = svc.resolveLocale();
    expect(resolution.requestedLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(resolution.resolvedSourceLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(resolution.fallbackToZhHans).toBe(false);
  });

  it("defaults to zh-Hans for empty string", () => {
    const resolution = svc.resolveLocale("");
    expect(resolution.requestedLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
  });

  it("defaults to zh-Hans for whitespace-only string", () => {
    const resolution = svc.resolveLocale("  ");
    expect(resolution.requestedLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
  });

  it("accepts zh-Hans directly", () => {
    const resolution = svc.resolveLocale("zh-Hans");
    expect(resolution.requestedLocale).toBe("zh-Hans");
    expect(resolution.fallbackToZhHans).toBe(false);
  });

  it("falls back to zh-Hans for unknown locale", () => {
    const resolution = svc.resolveLocale("fr");
    expect(resolution.requestedLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
  });

  it("resolves known locale from LOCALE_TO_NATURAL_LANGUAGE", () => {
    // en is in the lookup table, so it should be accepted as requested
    const resolution = svc.resolveLocale("en");
    expect(resolution.requestedLocale).toBe("en");
    expect(resolution.naturalLanguage).toBe("English");
  });

  it("reports fallbackToZhHans when requested locale has no variant file", () => {
    // "en" is in LOCALE_TO_NATURAL_LANGUAGE but may not have a variant file
    const resolution = svc.resolveLocale("en");
    // If no ai-prompts.en.md exists, it falls back
    if (resolution.resolvedSourceLocale === DEFAULT_RESUME_AI_PROMPT_LOCALE) {
      expect(resolution.fallbackToZhHans).toBe(true);
    }
    // If variant exists, no fallback
  });

  it("trims whitespace from locale", () => {
    const resolution = svc.resolveLocale("  en  ");
    expect(resolution.requestedLocale).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// LOCALE_TO_NATURAL_LANGUAGE constant
// ---------------------------------------------------------------------------

describe("LOCALE_TO_NATURAL_LANGUAGE", () => {
  it("contains zh-Hans, zh-Hant, en, ja, ko", () => {
    expect(LOCALE_TO_NATURAL_LANGUAGE["zh-Hans"]).toBe("Simplified Chinese");
    expect(LOCALE_TO_NATURAL_LANGUAGE["zh-Hant"]).toBe("Traditional Chinese");
    expect(LOCALE_TO_NATURAL_LANGUAGE["en"]).toBe("English");
    expect(LOCALE_TO_NATURAL_LANGUAGE["ja"]).toBe("Japanese");
    expect(LOCALE_TO_NATURAL_LANGUAGE["ko"]).toBe("Korean");
  });
});

// ---------------------------------------------------------------------------
// loadPrompt (requires config/resume/ai-prompts.md)
// ---------------------------------------------------------------------------

describe("ResumeAiPromptService.loadPrompt", () => {
  it("loads the default zh-Hans prompt successfully", () => {
    const doc = svc.loadPrompt();
    expect(doc.metadata.version).toBeGreaterThanOrEqual(1);
    expect(doc.metadata.updatedAt).toBeTruthy();
    expect(doc.metadata.description).toBeTruthy();
    expect(doc.sections.systemPrompt).toBeTruthy();
    expect(doc.sections.userPromptTemplate).toBeTruthy();
    expect(doc.sections.outputContract).toBeTruthy();
    expect(doc.sections.promptVariables).toBeTruthy();
    expect(doc.sections.notes).toBeTruthy();
  });

  it("returns a normalized prompt with locale info", () => {
    const doc = svc.loadPrompt();
    expect(doc.normalized.locale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(doc.normalized.sourceLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(doc.normalized.systemPrompt).toBeTruthy();
    expect(doc.normalized.userPromptTemplate).toBeTruthy();
  });

  it("returns resolution metadata", () => {
    const doc = svc.loadPrompt();
    expect(doc.resolution.requestedLocale).toBe(DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(doc.resolution.resolvedFilePath).toBeTruthy();
    expect(doc.resolution.fallbackToZhHans).toBe(false);
  });

  it("returns raw markdown", () => {
    const doc = svc.loadPrompt();
    expect(doc.rawMarkdown).toContain("---");
    expect(doc.rawMarkdown).toContain("## System Prompt");
  });
});

// ---------------------------------------------------------------------------
// listAvailablePromptSources
// ---------------------------------------------------------------------------

describe("ResumeAiPromptService.listAvailablePromptSources", () => {
  it("lists at least the zh-Hans master prompt", () => {
    const sources = svc.listAvailablePromptSources();
    expect(sources.length).toBeGreaterThanOrEqual(1);
    const zhHans = sources.find((s) => s.locale === DEFAULT_RESUME_AI_PROMPT_LOCALE);
    expect(zhHans).toBeDefined();
    expect(zhHans!.fileRelativePath).toBeTruthy();
    expect(zhHans!.metadata.version).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe("ResumeAiPromptService.clearCache", () => {
  it("does not throw", () => {
    expect(() => svc.clearCache()).not.toThrow();
  });

  it("allows re-loading after cache clear", () => {
    svc.clearCache();
    const doc = svc.loadPrompt();
    expect(doc.metadata.version).toBeGreaterThanOrEqual(1);
  });
});
