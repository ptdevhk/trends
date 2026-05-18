import { describe, expect, it } from "vitest";

import {
    MAX_DAILY_INPUT_TOKENS,
    MAX_DAILY_CONFIRM_COUNT,
    todayPeriod,
    getRemainingBudget,
    hasBudget,
    resolveAnalysisParallelism,
    resolveSubmitResumeParallelism,
    resolveAiTaggingParallelism,
} from "../lib/parallelism";

describe("todayPeriod", () => {
    it("returns a string matching YYYY-MM-DD format", () => {
        const result = todayPeriod();
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns today's date in local time", () => {
        const now = new Date();
        const y = String(now.getFullYear());
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        expect(todayPeriod()).toBe(`${y}-${m}-${d}`);
    });
});

describe("getRemainingBudget", () => {
    it("returns full budget when record is null", () => {
        const budget = getRemainingBudget(null);
        expect(budget.remainingTokens).toBe(MAX_DAILY_INPUT_TOKENS);
        expect(budget.remainingConfirms).toBe(MAX_DAILY_CONFIRM_COUNT);
        expect(budget.limit).toBe(MAX_DAILY_INPUT_TOKENS);
        expect(budget.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns correct remaining amounts with partial usage", () => {
        const budget = getRemainingBudget({ inputTokens: 30_000, confirmCount: 3 });
        expect(budget.remainingTokens).toBe(70_000);
        expect(budget.remainingConfirms).toBe(7);
    });

    it("returns 0 remaining when usage is exactly at the limit", () => {
        const budget = getRemainingBudget({ inputTokens: MAX_DAILY_INPUT_TOKENS, confirmCount: MAX_DAILY_CONFIRM_COUNT });
        expect(budget.remainingTokens).toBe(0);
        expect(budget.remainingConfirms).toBe(0);
    });

    it("returns 0 remaining when usage exceeds the limit (Math.max floor)", () => {
        const budget = getRemainingBudget({ inputTokens: 150_000, confirmCount: 15 });
        expect(budget.remainingTokens).toBe(0);
        expect(budget.remainingConfirms).toBe(0);
    });
});

describe("hasBudget", () => {
    it("returns true when record is null (full budget)", () => {
        expect(hasBudget(null)).toBe(true);
    });

    it("returns true when there is partial usage", () => {
        expect(hasBudget({ inputTokens: 30_000, confirmCount: 3 })).toBe(true);
    });

    it("returns false when remainingTokens is 0", () => {
        expect(hasBudget({ inputTokens: MAX_DAILY_INPUT_TOKENS, confirmCount: 0 })).toBe(false);
    });

    it("returns false when remainingConfirms is 0", () => {
        expect(hasBudget({ inputTokens: 0, confirmCount: MAX_DAILY_CONFIRM_COUNT })).toBe(false);
    });
});

describe("resolveAnalysisParallelism", () => {
    it("returns default when no env is set", () => {
        expect(resolveAnalysisParallelism(10, {})).toBe(4);
    });

    it("caps at MAX_ANALYSIS_PARALLELISM (12)", () => {
        expect(resolveAnalysisParallelism(100, { AI_ANALYSIS_PARALLELISM: "99" })).toBe(12);
    });

    it("uses AI_PARALLELISM as fallback env key", () => {
        expect(resolveAnalysisParallelism(10, { AI_PARALLELISM: "6" })).toBe(6);
    });

    it("prefers AI_ANALYSIS_PARALLELISM over AI_PARALLELISM", () => {
        expect(resolveAnalysisParallelism(10, {
            AI_ANALYSIS_PARALLELISM: "8",
            AI_PARALLELISM: "3",
        })).toBe(8);
    });

    it("returns 1 when totalCandidates is 0", () => {
        expect(resolveAnalysisParallelism(0, {})).toBe(1);
    });

    it("ignores invalid env values and falls back to default", () => {
        expect(resolveAnalysisParallelism(10, { AI_ANALYSIS_PARALLELISM: "abc" })).toBe(4);
    });
});

describe("resolveAiTaggingParallelism", () => {
    it("returns default when no env is set", () => {
        expect(resolveAiTaggingParallelism(10, {})).toBe(2);
    });

    it("caps at MAX_AI_TAGGING_PARALLELISM (8)", () => {
        expect(resolveAiTaggingParallelism(100, { AI_TAGGING_PARALLELISM: "99" })).toBe(8);
    });

    it("returns 1 when totalCandidates is 0", () => {
        expect(resolveAiTaggingParallelism(0, {})).toBe(1);
    });

    it("ignores invalid env values and falls back to default", () => {
        expect(resolveAiTaggingParallelism(10, { AI_TAGGING_PARALLELISM: "0" })).toBe(2);
    });
});

describe("resolveSubmitResumeParallelism", () => {
    it("returns default when no env is set", () => {
        expect(resolveSubmitResumeParallelism(10, {})).toBe(8);
    });

    it("caps at MAX_SUBMIT_RESUME_PARALLELISM (24)", () => {
        expect(resolveSubmitResumeParallelism(100, { SUBMIT_RESUME_PARALLELISM: "99" })).toBe(24);
    });

    it("returns 1 when totalResumes is 0", () => {
        expect(resolveSubmitResumeParallelism(0, {})).toBe(1);
    });

    it("ignores invalid env values and falls back to default", () => {
        expect(resolveSubmitResumeParallelism(10, { SUBMIT_RESUME_PARALLELISM: "-5" })).toBe(8);
    });
});
