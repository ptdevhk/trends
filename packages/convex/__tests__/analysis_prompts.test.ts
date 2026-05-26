/**
 * Unit tests for lib/analysis_prompts.ts
 */
import { describe, expect, it } from "vitest";
import {
    isEnglishResumeAiLocale,
    hydrateUserPrompt,
    buildKeywordRequirements,
    buildKeywordMatchingRules,
    buildConfirmPrompt,
} from "../convex/lib/analysis_prompts.js";

// ---------------------------------------------------------------------------
// isEnglishResumeAiLocale
// ---------------------------------------------------------------------------
describe("isEnglishResumeAiLocale", () => {
    it("returns true for English locale", () => {
        expect(isEnglishResumeAiLocale("en")).toBe(true);
    });

    it("returns false for Chinese locale", () => {
        expect(isEnglishResumeAiLocale("zh-Hans")).toBe(false);
    });

    it("returns false for undefined (default is zh-Hans)", () => {
        expect(isEnglishResumeAiLocale(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hydrateUserPrompt
// ---------------------------------------------------------------------------
describe("hydrateUserPrompt", () => {
    const template = "{jobTitle} | {requirements} | {matchingRules} | {candidateName} | {workExperience} | {education} | {evidenceText} | {roleSignals} | {companies} | {verifiedCompanies}";

    it("replaces all template placeholders", () => {
        const result = hydrateUserPrompt(
            template,
            { title: "CNC Operator", requirements: "3+ years", matchingRules: "CNC keywords" },
            {
                name: "John",
                workExperience: 5,
                education: "BS",
                evidenceText: "5yr CNC",
                roleSignalsText: "CNC(3yr)",
                companies: "Acme",
                verifiedCompanies: ["Acme"],
            },
            "en",
        );
        expect(result).toContain("CNC Operator");
        expect(result).toContain("John");
        expect(result).toContain("Acme");
    });

    it("shows noneLabel for empty verifiedCompanies", () => {
        const result = hydrateUserPrompt(
            "{verifiedCompanies}",
            { title: "T", requirements: "R", matchingRules: "M" },
            {
                name: "N",
                workExperience: 0,
                education: "",
                evidenceText: "",
                roleSignalsText: "",
                companies: "",
                verifiedCompanies: [],
            },
            "en",
        );
        expect(result).toBe("none");
    });
});

// ---------------------------------------------------------------------------
// buildKeywordRequirements
// ---------------------------------------------------------------------------
describe("buildKeywordRequirements", () => {
    it("builds English keyword list", () => {
        const result = buildKeywordRequirements(["CNC", "machining"], "en");
        expect(result).toContain("- CNC");
        expect(result).toContain("- machining");
        expect(result).toContain("key skills");
    });

    it("builds Chinese keyword list", () => {
        const result = buildKeywordRequirements(["CNC", "机加工"], "zh-Hans");
        expect(result).toContain("- CNC");
        expect(result).toContain("关键技能");
    });
});

// ---------------------------------------------------------------------------
// buildKeywordMatchingRules
// ---------------------------------------------------------------------------
describe("buildKeywordMatchingRules", () => {
    it("builds English matching rules", () => {
        const result = buildKeywordMatchingRules(["CNC"], "en");
        expect(result).toContain("Score the candidate");
        expect(result).toContain("CNC");
    });

    it("builds Chinese matching rules", () => {
        const result = buildKeywordMatchingRules(["CNC"], "zh-Hans");
        expect(result).toContain("匹配程度评分");
        expect(result).toContain("CNC");
    });
});

// ---------------------------------------------------------------------------
// buildConfirmPrompt
// ---------------------------------------------------------------------------
describe("buildConfirmPrompt", () => {
    it("includes search query and resume details", () => {
        const result = buildConfirmPrompt(
            { content: { title: "Senior CNC Operator" }, tags: ["CNC", "machining"] },
            "CNC operator",
        );
        expect(result).toContain('Search query: "CNC operator"');
        expect(result).toContain("Senior CNC Operator");
        expect(result).toContain("CNC, machining");
    });

    it("handles missing content gracefully", () => {
        const result = buildConfirmPrompt({}, "test query");
        expect(result).toContain("N/A");
        expect(result).toContain("none");
    });

    it("includes roleSignals from ingestData", () => {
        const result = buildConfirmPrompt(
            { ingestData: { roleSignals: [{ type: "CNC", years: 5 }] } },
            "CNC",
        );
        expect(result).toContain("CNC (5y)");
    });

    it("includes score/recommendation format in prompt", () => {
        const result = buildConfirmPrompt({}, "test");
        expect(result).toContain("score");
        expect(result).toContain("recommendation");
    });
});
