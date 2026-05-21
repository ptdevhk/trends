import {
    DEFAULT_RESUME_AI_PROMPT_LOCALE,
    LOCALE_TO_NATURAL_LANGUAGE,
} from "./resume-ai-prompt-service.js";

const SEEK_RESUME_AI_OUTPUT_LOCALE = "en";

export function localeToNaturalLanguage(locale: string): string {
    return LOCALE_TO_NATURAL_LANGUAGE[locale] ?? locale;
}

export function resolveAIOutputLocale(scope?: { sourceKey?: string | null }): string {
    // Source-specific overrides take priority over the env var default.
    // Without this, AI_OUTPUT_LOCALE=zh-Hans makes the seek→en branch dead code.
    if (scope?.sourceKey === "seek") {
        return SEEK_RESUME_AI_OUTPUT_LOCALE;
    }
    const locale = process.env.AI_OUTPUT_LOCALE?.trim();
    if (locale && locale.length > 0) {
        return locale;
    }
    return DEFAULT_RESUME_AI_PROMPT_LOCALE;
}
