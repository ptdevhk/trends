const DEFAULT_AI_OUTPUT_LOCALE = "zh-Hans";

const LOCALE_TO_NATURAL: Record<string, string> = {
    "zh-Hans": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
};

export function localeToNaturalLanguage(locale: string): string {
    return LOCALE_TO_NATURAL[locale] ?? locale;
}

export function resolveAIOutputLocale(): string {
    const locale = process.env.AI_OUTPUT_LOCALE?.trim();
    return locale && locale.length > 0 ? locale : DEFAULT_AI_OUTPUT_LOCALE;
}
