/**
 * Prompt-building helpers extracted from analyze.ts.
 *
 * Pure functions for formatting AI analysis prompts, including
 * work entry formatting, role signal display, keyword requirement
 * generation, and confirm prompt construction.
 */
import {
    getResumeAiLocaleText,
    resolveResumeAiPromptLocale,
} from "@trends/shared";
import type { NormalizedMatchedWorkEntry, NormalizedRoleSignal } from "./analysis_normalization.js";

// ---------------------------------------------------------------------------
// Locale helpers
// ---------------------------------------------------------------------------

export function isEnglishResumeAiLocale(locale?: string): boolean {
    return resolveResumeAiPromptLocale(locale).resolvedSourceLocale === "en";
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

export function formatWorkEntry(
    entry: NormalizedMatchedWorkEntry,
    localeText: ReturnType<typeof getResumeAiLocaleText>,
): string {
    const parts = [
        entry.companyName,
        entry.jobTitle,
        `${entry.years}${localeText.yearsUnitSuffix}`,
        entry.industryVerified ? localeText.verifiedLabel : localeText.unverifiedLabel,
        entry.directRoleMatch === false ? localeText.indirectRoleLabel : undefined,
        entry.matchedSignals.length > 0 ? `${localeText.signalsLabel}:${entry.matchedSignals.join("/")}` : undefined,
    ].filter((item): item is string => Boolean(item));
    return parts.join(" ");
}

export function formatRoleSignals(
    roleSignals: NormalizedRoleSignal[],
    localeText: ReturnType<typeof getResumeAiLocaleText>,
): string {
    if (roleSignals.length === 0) {
        return localeText.noneLabel;
    }

    return roleSignals.slice(0, 8).map((signal) => {
        const verifiedYears = typeof signal.industryVerifiedYears === "number" && Number.isFinite(signal.industryVerifiedYears)
            ? signal.industryVerifiedYears
            : 0;
        const workEntries = signal.matchedWorkEntries && signal.matchedWorkEntries.length > 0
            ? signal.matchedWorkEntries.map((entry) => formatWorkEntry(entry, localeText)).join("; ")
            : undefined;
        const parts = [
            `${signal.type}(${signal.verifyIn})`,
            `years:${signal.years}`,
            `verified:${verifiedYears}`,
            signal.matchedSignals.length > 0 ? `signals:${signal.matchedSignals.join("/")}` : undefined,
            workEntries ? `work:${workEntries}` : undefined,
        ].filter((item): item is string => Boolean(item));
        return `- ${parts.join(" | ")}`;
    }).join("\n");
}

export function hydrateUserPrompt(
    template: string,
    job: { title: string; requirements: string; matchingRules: string },
    resume: {
        name: string;
        workExperience: string | number;
        education: string;
        evidenceText: string;
        roleSignalsText: string;
        companies: string;
        verifiedCompanies: string[];
    },
    locale?: string,
): string {
    const localeText = getResumeAiLocaleText(locale);
    return template
        .replace("{jobTitle}", job.title)
        .replace("{requirements}", job.requirements)
        .replace("{matchingRules}", job.matchingRules)
        .replace("{candidateName}", resume.name)
        .replace("{workExperience}", String(resume.workExperience))
        .replace("{education}", resume.education)
        .replace("{evidenceText}", resume.evidenceText)
        .replace("{roleSignals}", resume.roleSignalsText)
        .replace("{companies}", resume.companies)
        .replace("{verifiedCompanies}", resume.verifiedCompanies.length > 0
            ? resume.verifiedCompanies.join(", ")
            : localeText.noneLabel);
}

export function buildKeywordRequirements(keywords: string[], locale?: string): string {
    if (isEnglishResumeAiLocale(locale)) {
        return `The candidate should have the following key skills or experience:\n${keywords
            .map((keyword) => `- ${keyword}`)
            .join("\n")}`;
    }
    return `候选人需具备以下关键技能/经验:\n${keywords.map((keyword) => `- ${keyword}`).join("\n")}`;
}

export function buildKeywordMatchingRules(keywords: string[], locale?: string): string {
    if (isEnglishResumeAiLocale(locale)) {
        return `Score the candidate by how well their evidence matches the following keywords. More direct relevance should produce a higher score.\nKeywords: ${keywords.join(", ")}`;
    }
    return `根据候选人与以下关键词的匹配程度评分。关键词越相关评分越高。\n关键词: ${keywords.join(", ")}`;
}

export function buildConfirmPrompt(resume: { content?: Record<string, unknown>; tags?: string[]; ingestData?: Record<string, unknown> }, query: string): string {
    const ingest = resume.ingestData ?? {};
    const signals = Array.isArray(ingest.roleSignals)
        ? (ingest.roleSignals as Array<Record<string, unknown>>).map((s) => `${s.type} (${s.years}y)`).join(", ")
        : "none";

    return [
        `Search query: "${query}"`,
        "",
        "Resume:",
        `- Title: ${resume.content?.title ?? "N/A"}`,
        `- Experience: ${signals}`,
        `- Tags: ${Array.isArray(resume.tags) ? resume.tags.join(", ") : "none"}`,
        "",
        `Rate how relevant this resume is for the search query. Respond with:`,
        `{ "score": <0-100>, "summary": "<one-sentence>", "recommendation": "<strong_match|match|potential|no_match>", "breakdown": { "related_exp": <0-100> } }`,
    ].join("\n");
}
