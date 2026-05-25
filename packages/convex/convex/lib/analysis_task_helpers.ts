/**
 * LLM result parsing and dispatch key helpers extracted from analysis_tasks.ts.
 *
 * Pure functions for parsing LLM analysis results, normalizing keywords,
 * and building dispatch/idempotency keys for analysis task deduplication.
 */
import {
    buildKeywordAnalysisId as buildSharedKeywordAnalysisId,
    getCurrentResumeAiPromptVersion,
} from "@trends/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalysisResult = {
    score: number;
    summary: string;
    highlights: string[];
    recommendation: string;
    breakdown?: Record<string, number>;
    locale?: string;
};

export type AnalysisDispatchKeyInput = {
    derivedJobDescriptionId?: string;
    jobDescriptionTitle?: string;
    jobDescriptionContent?: string;
    keywords?: string[];
    location?: string;
    promptVersion?: number;
    resumeIds: readonly string[];
};

// ---------------------------------------------------------------------------
// LLM result parsing helpers
// ---------------------------------------------------------------------------

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

const WORD_NUMBERS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twenty5: 25,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
    ninety: 90, hundred: 100,
};

export function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
        // Handle English word numbers (e.g. "seventy", "eighty-five")
        const lower = value.trim().toLowerCase();
        if (WORD_NUMBERS[lower] !== undefined) {
            return WORD_NUMBERS[lower];
        }
        // Handle compound like "seventy-five" or "seventy five"
        const parts = lower.split(/[-\s]+/);
        if (parts.length === 2 && WORD_NUMBERS[parts[0]] !== undefined && WORD_NUMBERS[parts[1]] !== undefined) {
            return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
        }
    }
    return null;
}

export function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

export function parseBreakdown(value: unknown): Record<string, number> | undefined {
    if (!isObject(value)) {
        return undefined;
    }

    const parsed: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const numericValue = toNumber(rawValue);
        if (numericValue !== null) {
            parsed[key] = numericValue;
        }
    }

    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * Try to locate the analysis payload from potentially nested LLM responses.
 * Some models wrap results like `{ "result": { "score": 85, ... } }` or
 * `{ "data": { "score": 85, ... } }`.
 */
export function unwrapLlmResult(value: unknown): Record<string, unknown> | null {
    if (!isObject(value)) return null;

    // Top-level score → use as-is
    if (value.score !== undefined) return value;

    // Try common wrapper keys
    for (const key of ["result", "data", "analysis", "response", "output"]) {
        const nested = value[key];
        if (isObject(nested) && nested.score !== undefined) return nested;
    }

    // Scan one level for any object with a `score` key
    for (const nested of Object.values(value)) {
        if (isObject(nested) && nested.score !== undefined) return nested;
    }

    return null;
}

export function parseLlmResult(value: unknown): AnalysisResult {
    const obj = unwrapLlmResult(value);
    if (!obj) {
        console.error("parseLlmResult: no score field found in LLM response:", JSON.stringify(value).slice(0, 1000));
        throw new Error("Invalid analysis result: score is missing.");
    }

    const score = toNumber(obj.score);
    if (score === null) {
        console.error("parseLlmResult: score is not numeric:", JSON.stringify(obj.score), "full:", JSON.stringify(value).slice(0, 500));
        throw new Error("Invalid analysis result: score is missing.");
    }

    const summary = typeof obj.summary === "string" ? obj.summary : "";
    const recommendation = typeof obj.recommendation === "string" ? obj.recommendation : "potential";

    return {
        score,
        summary: summary || "No summary provided.",
        highlights: toStringArray(obj.highlights),
        recommendation,
        breakdown: parseBreakdown(obj.breakdown),
    };
}

// ---------------------------------------------------------------------------
// Keyword helpers
// ---------------------------------------------------------------------------

export function extractKeywords(input: string): string[] {
    const matched = input.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) ?? [];
    return [...new Set(matched)];
}

export function normalizeKeywords(keywords: string[]): string[] {
    return Array.from(
        new Set(
            keywords
                .map((keyword) => keyword.trim().toLowerCase())
                .filter((keyword) => keyword.length > 0)
        )
    );
}

// ---------------------------------------------------------------------------
// Dispatch key helpers
// ---------------------------------------------------------------------------

export function stableHash(seed: string): string {
    let hash = 2166136261;
    for (const char of seed) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

export function buildKeywordAnalysisId(
    keywords: string[],
    options?: {
        location?: string;
        promptVersion?: number;
    }
): string {
    return buildSharedKeywordAnalysisId(keywords, options);
}

export function buildAnalysisDispatchJobKey(input: AnalysisDispatchKeyInput): string {
    const promptVersion = input.promptVersion ?? getCurrentResumeAiPromptVersion();
    if (input.derivedJobDescriptionId && input.derivedJobDescriptionId.trim()) {
        return `job:${input.derivedJobDescriptionId.trim().toLowerCase()}:prompt:${promptVersion}`;
    }

    const normalizedKeywords = normalizeKeywords(input.keywords ?? []);
    if (normalizedKeywords.length > 0) {
        return `keywords:${buildKeywordAnalysisId(normalizedKeywords, {
            location: input.location,
            promptVersion,
        })}`;
    }

    const title = input.jobDescriptionTitle?.trim().toLowerCase() ?? "";
    const content = input.jobDescriptionContent?.trim().toLowerCase() ?? "";
    if (!title && !content) {
        return `job:default:prompt:${promptVersion}`;
    }
    return `job-content:prompt:${promptVersion}:${stableHash(`${title}|${content}`)}`;
}

export function buildAnalysisDispatchIdempotencyKey(input: AnalysisDispatchKeyInput): string {
    const uniqueResumeIds = Array.from(new Set(input.resumeIds.map((resumeId) => String(resumeId)))).sort();
    const resumeSeed = uniqueResumeIds.join("|");
    const resumeHash = stableHash(`resume:${uniqueResumeIds.length}:${resumeSeed}`);
    const jobKey = buildAnalysisDispatchJobKey(input);
    return `${jobKey}:resumes:${resumeHash}`;
}
