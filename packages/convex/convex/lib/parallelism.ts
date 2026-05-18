/// <reference path="../convex-env.d.ts" />
type EnvSource = Record<string, string | undefined>;

export const DEFAULT_ANALYSIS_PARALLELISM = 4;
export const MAX_ANALYSIS_PARALLELISM = 12;
export const DEFAULT_AI_TAGGING_PARALLELISM = 2;
export const MAX_AI_TAGGING_PARALLELISM = 8;
export const DEFAULT_SUBMIT_RESUME_PARALLELISM = 8;
export const MAX_SUBMIT_RESUME_PARALLELISM = 24;

function parsePositiveInt(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function clampParallelism(total: number, configured: number, cap: number): number {
    if (total <= 0) {
        return 1;
    }
    return Math.max(1, Math.min(total, configured, cap));
}

export function resolveAnalysisParallelism(totalCandidates: number, env: EnvSource = process.env): number {
    const configured = parsePositiveInt(env.AI_ANALYSIS_PARALLELISM ?? env.AI_PARALLELISM)
        ?? DEFAULT_ANALYSIS_PARALLELISM;
    return clampParallelism(totalCandidates, configured, MAX_ANALYSIS_PARALLELISM);
}

export function resolveAiTaggingParallelism(totalCandidates: number, env: EnvSource = process.env): number {
    const configured = parsePositiveInt(env.AI_TAGGING_PARALLELISM)
        ?? DEFAULT_AI_TAGGING_PARALLELISM;
    return clampParallelism(totalCandidates, configured, MAX_AI_TAGGING_PARALLELISM);
}

export function resolveSubmitResumeParallelism(totalResumes: number, env: EnvSource = process.env): number {
    const configured = parsePositiveInt(env.SUBMIT_RESUME_PARALLELISM)
        ?? DEFAULT_SUBMIT_RESUME_PARALLELISM;
    return clampParallelism(totalResumes, configured, MAX_SUBMIT_RESUME_PARALLELISM);
}

// LLM Cost Budget — per-workspace daily limits for batch AI confirm
export const MAX_DAILY_INPUT_TOKENS = 100_000;
export const MAX_DAILY_CONFIRM_COUNT = 10;

export interface CostBudget {
    remainingTokens: number;
    remainingConfirms: number;
    limit: number;
    period: string;
}

export function todayPeriod(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function getRemainingBudget(
    record: { inputTokens: number; confirmCount: number } | null,
): CostBudget {
    const inputTokens = record?.inputTokens ?? 0;
    const confirmCount = record?.confirmCount ?? 0;
    return {
        remainingTokens: Math.max(0, MAX_DAILY_INPUT_TOKENS - inputTokens),
        remainingConfirms: Math.max(0, MAX_DAILY_CONFIRM_COUNT - confirmCount),
        limit: MAX_DAILY_INPUT_TOKENS,
        period: todayPeriod(),
    };
}

export function hasBudget(record: { inputTokens: number; confirmCount: number } | null): boolean {
    const budget = getRemainingBudget(record);
    return budget.remainingTokens > 0 && budget.remainingConfirms > 0;
}
