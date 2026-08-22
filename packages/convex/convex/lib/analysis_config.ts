/**
 * AI configuration and locale resolution extracted from analyze.ts.
 *
 * Pure functions for resolving AI model config, API keys,
 * output locale, and prompt template accessors.
 */
import {
    DEFAULT_RESUME_AI_PROMPT_LOCALE,
    buildResumeAiSystemPrompt,
    getResumeAiPromptDefinition,
    getResumeAiUserPromptTemplate,
    resolveResumeAnalysisSourceKey,
    resolveResumeAiPromptLocale,
} from "@trends/shared";
import {
    DEFAULT_FALLBACK_CHAT_MODEL,
    DEFAULT_PRIMARY_CHAT_MODEL,
    warnUnknownModel,
} from "./ai_model.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AI_OUTPUT_LOCALE = DEFAULT_RESUME_AI_PROMPT_LOCALE;

export type ChatMessage = {
    role: "system" | "user";
    content: string;
};

export const SYSTEM_PROMPT = getResumeAiPromptDefinition(DEFAULT_AI_OUTPUT_LOCALE).sections.systemPrompt;
export const USER_PROMPT_TEMPLATE = getResumeAiUserPromptTemplate(DEFAULT_AI_OUTPUT_LOCALE);

// ---------------------------------------------------------------------------
// Source key / locale
// ---------------------------------------------------------------------------

export function inferSourceKey(source: string | undefined) {
    return resolveResumeAnalysisSourceKey({ source });
}

// For Convex deployments, set AI_OUTPUT_LOCALE via the dashboard or `convex env set`.
export function resolveAIOutputLocale(scope?: { sourceKey?: string }): string {
    // Source-specific overrides take priority over the env var default.
    // Without this, AI_OUTPUT_LOCALE=zh-Hans makes the seek→en branch dead code.
    if (scope?.sourceKey === "seek") {
        return "en";
    }
    const locale = process.env.AI_OUTPUT_LOCALE?.trim();
    if (locale && locale.length > 0) {
        return resolveResumeAiPromptLocale(locale).requestedLocale;
    }
    return resolveResumeAiPromptLocale(undefined).requestedLocale;
}

// ---------------------------------------------------------------------------
// Prompt accessors
// ---------------------------------------------------------------------------

export function buildSystemPrompt(locale: string): string {
    return buildResumeAiSystemPrompt(locale);
}

export function getUserPromptTemplate(locale: string): string {
    return getResumeAiUserPromptTemplate(locale);
}

// ---------------------------------------------------------------------------
// AI config (env var accessors)
// ---------------------------------------------------------------------------

export function getAiApiKey(): string | undefined {
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

export function getAiApiBase(): string {
    return process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
}

export function getAiModel(): string {
    return warnUnknownModel(process.env.AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_PRIMARY_CHAT_MODEL);
}

export function getAiFallbackModel(): string {
    const raw = process.env.AI_FALLBACK_MODEL?.trim();
    return warnUnknownModel(raw && raw.length > 0 ? raw : DEFAULT_FALLBACK_CHAT_MODEL);
}

/** Call-time provider + models. Reads process.env on every invocation — not a module snapshot. */
export function resolveAnalyzeLlmRuntimeConfig(): {
    apiBase: string;
    primary: string;
    fallback: string;
} {
    return {
        apiBase: getAiApiBase(),
        primary: getAiModel(),
        fallback: getAiFallbackModel(),
    };
}

export function getAiTemperature(): number {
    const raw = process.env.AI_TEMPERATURE;
    if (raw !== undefined && raw.trim().length > 0) {
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}
