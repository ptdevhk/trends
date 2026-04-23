/// <reference path="./convex-env.d.ts" />
import {
    DEFAULT_RESUME_AI_PROMPT_LOCALE,
    FALLBACK_INDUSTRY_KEYWORDS,
    INDUSTRY_DISPLAY_NAME_TO_TAG,
    buildResumeAiSystemPrompt,
    getResumeAiLocaleText,
    getResumeAiPromptDefinition,
    getResumeAiUserPromptTemplate,
    isSalesRequiredContext,
    resolveResumeAnalysisSourceKey,
    sanitizeResumeRecordForSurface,
    resolveResumeAiPromptLocale,
    selectLatestWorkHistory,
    type ResumeFieldUsagePolicy,
    type ResumeFieldUsagePolicyOverrides,
} from "@trends/shared";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { resolveChatCompletionModel } from "./lib/ai_model";

const DEFAULT_AI_OUTPUT_LOCALE = DEFAULT_RESUME_AI_PROMPT_LOCALE;

export type ChatMessage = {
    role: "system" | "user";
    content: string;
};

type NormalizedMatchedWorkEntry = {
    companyName?: string;
    jobTitle?: string;
    years: number;
    industryVerified: boolean;
    matchedSignals: string[];
    directRoleMatch?: boolean;
};

type NormalizedRoleSignal = {
    type: string;
    matchedSignals: string[];
    signalCount: number;
    occurrences: number;
    years: number;
    industryVerifiedYears: number;
    roleRelevantYears?: number;
    industryVerifiedRelevantYears?: number;
    matchedWorkEntries?: NormalizedMatchedWorkEntry[];
    verifyIn: "searchText" | "workHistory";
};

export const SYSTEM_PROMPT = getResumeAiPromptDefinition(DEFAULT_AI_OUTPUT_LOCALE).sections.systemPrompt;
export const USER_PROMPT_TEMPLATE = getResumeAiUserPromptTemplate(DEFAULT_AI_OUTPUT_LOCALE);

export function inferSourceKey(source: string | undefined) {
    return resolveResumeAnalysisSourceKey({ source });
}

// For Convex deployments, set AI_OUTPUT_LOCALE via the dashboard or `convex env set`.
export function resolveAIOutputLocale(scope?: { sourceKey?: string }): string {
    const locale = process.env.AI_OUTPUT_LOCALE?.trim();
    if (locale && locale.length > 0) {
        return resolveResumeAiPromptLocale(locale).requestedLocale;
    }
    if (scope?.sourceKey === "seek") {
        return "en";
    }
    return resolveResumeAiPromptLocale(undefined).requestedLocale;
}

export function buildSystemPrompt(locale: string): string {
    return buildResumeAiSystemPrompt(locale);
}

export function getUserPromptTemplate(locale: string): string {
    return getResumeAiUserPromptTemplate(locale);
}

function isEnglishResumeAiLocale(locale?: string): boolean {
    return resolveResumeAiPromptLocale(locale).resolvedSourceLocale === "en";
}

function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

const INDUSTRY_DB_SCORE_CAP = 50;
const RELATED_EXP_WEIGHT = INDUSTRY_DB_SCORE_CAP / 100;

type AnalysisRecommendation = "strong_match" | "match" | "potential" | "no_match";

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseNumericBreakdown(value: unknown): Record<string, number> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const parsed: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(value)) {
        const numeric = toNumber(rawValue);
        if (numeric !== undefined) {
            parsed[key] = numeric;
        }
    }

    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function hasNonEmployerBrandHits(value: unknown): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.some((item) => {
        if (!isRecord(item)) {
            return false;
        }

        const context = typeof item.context === "string" ? item.context.trim().toLowerCase() : "";
        return context !== "employer";
    });
}

function hasCompanyHits(value: unknown): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.some((item) => typeof item === "string" && item.trim().length > 0);
}

function getResumeIngestData(resume: unknown): Record<string, unknown> {
    const root = isRecord(resume) ? resume : {};
    const content = isRecord(root.content) ? root.content : {};
    if (isRecord(root.ingestData)) {
        return root.ingestData;
    }
    if (isRecord(content.ingestData)) {
        return content.ingestData;
    }
    return {};
}

function computeDirectIndustryDbScoreFromResume(resume: unknown): number {
    const ingestData = getResumeIngestData(resume);
    const brandHits = hasNonEmployerBrandHits(ingestData.brandHits);
    const companyHits = hasCompanyHits(ingestData.companyHits);
    if (brandHits || companyHits) {
        return INDUSTRY_DB_SCORE_CAP;
    }

    const raw = toNumber(ingestData.industryDbV2Raw) ?? 0;
    return clamp(raw, 0, INDUSTRY_DB_SCORE_CAP);
}

function recommendationFromScore(score: number): AnalysisRecommendation {
    if (score >= 85) return "strong_match";
    if (score >= 70) return "match";
    if (score >= 40) return "potential";
    return "no_match";
}

function hasHanText(value: string): boolean {
    return /[\u4e00-\u9fff]/.test(value);
}

function normalizeSummaryConsistency(
    summary: string,
    normalized: {
        score: number;
        recommendation: AnalysisRecommendation;
    },
): string {
    if (summary.trim().length === 0) {
        return summary;
    }

    let next = summary.trim();

    const mentionedScores = Array.from(
        next.matchAll(/\bscore\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/gi),
        (match) => Number(match[1]),
    ).filter((value) => Number.isFinite(value));
    const hasScoreMention = mentionedScores.length > 0;
    const hasScoreMismatch = hasScoreMention
        && !mentionedScores.some((value) => Math.round(value) === normalized.score);

    if (hasScoreMismatch) {
        next = next.replace(
            /(\bscore\s*[:：]?\s*)\d{1,3}(?:\.\d+)?/gi,
            (_raw, prefix: string) => `${prefix}${normalized.score}`,
        );
    }

    const recommendationMentions = Array.from(
        next.matchAll(/\b(strong_match|match|potential|no_match)\b/gi),
        (match) => match[1].toLowerCase(),
    );
    const hasRecommendationMention = recommendationMentions.length > 0;
    const hasRecommendationMismatch = hasRecommendationMention
        && !recommendationMentions.includes(normalized.recommendation);

    if (hasRecommendationMismatch) {
        next = next.replace(
            /\b(strong_match|match|potential|no_match)\b/gi,
            normalized.recommendation,
        );
    }

    // If model prose is still semantically stale (common in zh summaries), append
    // a canonical normalized statement to remove ambiguity.
    if (hasScoreMismatch || hasRecommendationMismatch) {
        const normalizedLine = hasHanText(next)
            ? `系统归一化结果：score ${normalized.score}，recommendation ${normalized.recommendation}。`
            : `Normalized result: score ${normalized.score}, recommendation ${normalized.recommendation}.`;
        if (!next.includes(normalizedLine)) {
            next = `${next} ${normalizedLine}`.trim();
        }
    }

    return next;
}

function inferSalesRelatedExpFloor(resume: unknown): number | undefined {
    const ingestData = getResumeIngestData(resume);
    if (!Array.isArray(ingestData.roleSignals)) {
        return undefined;
    }

    for (const rawSignal of ingestData.roleSignals) {
        if (!isRecord(rawSignal)) {
            continue;
        }

        const type = typeof rawSignal.type === "string" ? rawSignal.type.trim().toLowerCase() : "";
        if (type !== "sales") {
            continue;
        }

        const verifiedYears = toNumber(rawSignal.industryVerifiedYears) ?? 0;
        const verifiedRelevantYears = toNumber(rawSignal.industryVerifiedRelevantYears) ?? 0;
        const workEntries = Array.isArray(rawSignal.matchedWorkEntries)
            ? rawSignal.matchedWorkEntries.filter((rawEntry): rawEntry is Record<string, unknown> => isRecord(rawEntry))
            : [];
        const hasDirectRoleEvidence = workEntries.some((rawEntry) => rawEntry.directRoleMatch === true);

        // The 80 floor only applies to industry-verified sales; unverified direct-role
        // sales are handled by the AI (prompt rules 12/13) and inferUnverifiedDomainRelevantSalesFloor.
        const hasIndustryVerifiedSales = verifiedYears > 0 || verifiedRelevantYears > 0
            || workEntries.some((rawEntry) => rawEntry.industryVerified === true);

        if (hasDirectRoleEvidence && !hasIndustryVerifiedSales) {
            // Unverified direct-role: 80 floor doesn't apply; 60 floor or 15 ceiling
            // may apply via other inference functions.
            continue;
        }

        // Industry-verified sales with 3+ years → floor of 80
        const relevantYears = Math.max(verifiedYears, toNumber(rawSignal.roleRelevantYears) ?? toNumber(rawSignal.years) ?? 0);
        if (hasIndustryVerifiedSales && relevantYears >= 3) {
            return 80;
        }
    }

    return undefined;
}

/**
 * Caps related_exp at 15 when domain+sales keywords are combined but the candidate's
 * sales has no domain evidence. Bypassed by: industry-verified sales, verified entries,
 * sales-relevant brand hits, or industry tags + direct sales at a non-irrelevant company.
 * Returns 15 or undefined if no cap applies.
 */
function inferDomainIrrelevantSalesCeiling(
    resume: unknown,
    keywords: string[],
): number | undefined {
    const ingestData = getResumeIngestData(resume);
    if (!Array.isArray(ingestData.roleSignals)) {
        return undefined;
    }

    // Only applies when there are both sales and non-sales keywords
    const salesKeywords = keywords.filter((kw) => isSalesRequiredContext(kw));
    const domainKeywords = keywords.filter((kw) => !isSalesRequiredContext(kw));
    if (salesKeywords.length === 0 || domainKeywords.length === 0) {
        return undefined;
    }

    // Check if candidate has any industry-verified sales signal or
    // sales work entries at industry-verified companies
    const salesSignal = ingestData.roleSignals.find((rawSignal) => {
        if (!isRecord(rawSignal)) return false;
        return typeof rawSignal.type === "string"
            && rawSignal.type.trim().toLowerCase() === "sales";
    });

    if (!salesSignal || !isRecord(salesSignal)) {
        // No sales signal at all — ceiling doesn't apply (floor won't either)
        return undefined;
    }

    // Signal-level: industry-verified sales years
    const hasIndustryVerifiedSalesYears = (toNumber(salesSignal.industryVerifiedRelevantYears) ?? 0) > 0
        || (toNumber(salesSignal.industryVerifiedYears) ?? 0) > 0;

    // Entry-level: sales work entries at industry-verified companies
    const workEntries = Array.isArray(salesSignal.matchedWorkEntries)
        ? salesSignal.matchedWorkEntries.filter((rawEntry): rawEntry is Record<string, unknown> => isRecord(rawEntry))
        : [];
    const hasIndustryVerifiedSalesEntry = workEntries.some(
        (entry) => entry.industryVerified === true
    );

    // Only brand hits with sales-relevant context bypass the ceiling;
    // technical-only brand hits from non-sales roles don't prove sales domain overlap.
    const hasSalesRelevantBrandHits = (() => {
        if (!Array.isArray(ingestData.brandHits) || ingestData.brandHits.length === 0) {
            return false;
        }
        if (hasIndustryVerifiedSalesEntry) return true;
        const salesRelevantContexts = new Set(["product", "dealer", "agent", "distributor"]);
        return ingestData.brandHits.some((item) => {
            if (!isRecord(item)) return false;
            const context = typeof item.context === "string" ? item.context.trim().toLowerCase() : "";
            if (context === "employer" || context === "technical") return false;
            return salesRelevantContexts.has(context) || context === "both" || context === "";
        });
    })();

    // Industry tags + direct sales at a non-irrelevant company → tags likely
    // reflect the sales role's domain (tags alone can come from non-sales roles).
    const industryTags = Array.isArray(ingestData.industryTags)
        ? ingestData.industryTags.filter((tag): tag is string => typeof tag === "string")
        : [];
    const hasDomainIndustryTag = industryTags.length > 0 && domainKeywords.some(
        (kw) => keywordMapsToIndustryTag(kw, industryTags),
    );
    const hasDomainIrrelevantSalesEntry = workEntries.some((entry) =>
        isDomainIrrelevantSalesEntry(entry),
    );

    // If any domain-evidence path confirms relevance, no ceiling.
    if (hasIndustryVerifiedSalesYears || hasIndustryVerifiedSalesEntry || hasSalesRelevantBrandHits) {
        return undefined;
    }
    // Industry tags + direct sales role + no domain-irrelevant company →
    // tags likely reflect the sales role's domain (e.g. sales engineer at a
    // machinery trading company). Let the AI decide with prompt guidance.
    if (hasDomainIndustryTag && !hasDomainIrrelevantSalesEntry) {
        return undefined;
    }

    // Candidate has sales signal but no domain evidence —
    // the sales experience is likely domain-irrelevant
    return 15;
}

/**
 * Keywords that clearly indicate a company or role is in a sector unrelated
 * to the machinery/CNC domain. Used to prevent industry tags from non-sales
 * roles from bypassing the domain-irrelevant ceiling.
 */
const DOMAIN_IRRELEVANT_SALES_KEYWORDS = [
    // Insurance / finance
    "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
    // Real estate
    "房地产", "地产", "置业", "房产",
    // Education / training
    "教育", "培训", "学校",
    // Medical / healthcare
    "医疗", "医院", "医药",
    // Consumer / food / clothing
    "食品", "餐饮", "服装", "化妆品",
    // Job-title-level negative signals (e.g. "保险代理人")
    "保险代理", "保险销售", "置业顾问",
];

/**
 * Checks whether a sales work entry is at a company or in a role that is
 * clearly unrelated to the machinery/CNC domain, based on negative keyword
 * matching against company name and job title.
 */
function isDomainIrrelevantSalesEntry(entry: Record<string, unknown>): boolean {
    const companyName = typeof entry.companyName === "string" ? entry.companyName : "";
    const jobTitle = typeof entry.jobTitle === "string" ? entry.jobTitle : "";
    const text = `${companyName} ${jobTitle}`.toLowerCase();
    return DOMAIN_IRRELEVANT_SALES_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * Checks whether a search keyword maps to any of the resume's industry tags
 * through the FALLBACK_INDUSTRY_KEYWORDS taxonomy.
 * e.g. "cnc" maps to "machinery"; if the resume has "machinery" industryTag → match.
 *
 * Handles both English tag IDs (e.g. "machinery") and Chinese displayNames
 * (e.g. "机械") stored in ingestData.industryTags.
 */
function keywordMapsToIndustryTag(keyword: string, resumeIndustryTags: string[]): boolean {
    const kwLower = keyword.trim().toLowerCase();
    if (!kwLower) return false;

    // Normalize resume tags: map Chinese displayNames to English tag IDs
    const normalizedTags = new Set<string>();
    for (const tag of resumeIndustryTags) {
        const tagLower = tag.toLowerCase();
        normalizedTags.add(tagLower);
        // Map Chinese displayName to canonical English tag ID
        const mappedTag = INDUSTRY_DISPLAY_NAME_TO_TAG[tag];
        if (mappedTag) {
            normalizedTags.add(mappedTag.toLowerCase());
        }
    }

    // Direct tag match (e.g. keyword="machinery" matches tag="machinery")
    if (normalizedTags.has(kwLower)) return true;

    // Check if the keyword is one of the taxonomy keywords that maps to a resume tag
    for (const [tag, keywords] of Object.entries(FALLBACK_INDUSTRY_KEYWORDS)) {
        if (!normalizedTags.has(tag.toLowerCase())) continue;
        if (keywords.some((kw) => kw.toLowerCase() === kwLower)) return true;
    }

    return false;
}

/**
 * Floor of 60 for unverified sales when domain evidence suggests relevance
 * (industry tags overlap + direct sales title + no domain-irrelevant company).
 * Mirrors the ceiling bypass: if ceiling doesn't apply, this floor prevents
 * the AI from under-scoring (typically ~20-30 instead of 60-80).
 * Returns 60 or undefined if no floor applies.
 */
function inferUnverifiedDomainRelevantSalesFloor(
    resume: unknown,
    keywords: string[],
): number | undefined {
    const ingestData = getResumeIngestData(resume);
    if (!Array.isArray(ingestData.roleSignals)) {
        return undefined;
    }

    // Only applies when there are both sales and domain keywords
    const salesKeywords = keywords.filter((kw) => isSalesRequiredContext(kw));
    const domainKeywords = keywords.filter((kw) => !isSalesRequiredContext(kw));
    if (salesKeywords.length === 0 || domainKeywords.length === 0) {
        return undefined;
    }

    const salesSignal = ingestData.roleSignals.find((rawSignal) => {
        if (!isRecord(rawSignal)) return false;
        return typeof rawSignal.type === "string"
            && rawSignal.type.trim().toLowerCase() === "sales";
    });

    if (!salesSignal || !isRecord(salesSignal)) {
        return undefined;
    }

    // Must have a direct sales role title
    const workEntries = Array.isArray(salesSignal.matchedWorkEntries)
        ? salesSignal.matchedWorkEntries.filter((rawEntry): rawEntry is Record<string, unknown> => isRecord(rawEntry))
        : [];
    const hasDirectSalesTitle = workEntries.some((entry) => entry.directRoleMatch === true);
    if (!hasDirectSalesTitle) {
        return undefined;
    }

    // Must NOT have industry-verified sales (those get the 80 floor already)
    const hasIndustryVerifiedSales = (toNumber(salesSignal.industryVerifiedRelevantYears) ?? 0) > 0
        || (toNumber(salesSignal.industryVerifiedYears) ?? 0) > 0
        || workEntries.some((entry) => entry.industryVerified === true);
    if (hasIndustryVerifiedSales) {
        return undefined;
    }

    // Must have industry tags overlapping with domain keywords
    const industryTags = Array.isArray(ingestData.industryTags)
        ? ingestData.industryTags.filter((tag): tag is string => typeof tag === "string")
        : [];
    const hasDomainIndustryTag = industryTags.length > 0 && domainKeywords.some(
        (kw) => keywordMapsToIndustryTag(kw, industryTags),
    );
    if (!hasDomainIndustryTag) {
        return undefined;
    }

    // Sales entries must NOT be at domain-irrelevant companies
    const hasDomainIrrelevantSalesEntry = workEntries.some((entry) =>
        isDomainIrrelevantSalesEntry(entry),
    );
    if (hasDomainIrrelevantSalesEntry) {
        return undefined;
    }

    return 60;
}

/**
 * Caps related_exp to 0 when all sales entries have directRoleMatch=false
 * (sales signal from descriptions only). Bypassed when the floor was already
 * applied or any entry has directRoleMatch=true.
 * Returns 0 or undefined.
 */
function inferNoDirectSalesRoleCap(resume: unknown, precomputedFloor?: number): number | undefined {
    const ingestData = getResumeIngestData(resume);
    if (!Array.isArray(ingestData.roleSignals)) {
        return undefined;
    }

    const salesSignals = (ingestData.roleSignals as unknown[]).filter((raw): raw is Record<string, unknown> => {
        if (!isRecord(raw)) return false;
        const type = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "";
        return type === "sales";
    });

    if (salesSignals.length === 0) {
        return 0;
    }

    // If the floor condition is met, the cap does not apply
    if (precomputedFloor !== undefined) {
        return undefined;
    }

    // Any direct sales title → don't zero out (wrong industry handled by ceiling)
    const hasDirectSalesTitle = salesSignals.some((rawSignal) => {
        const workEntries = Array.isArray(rawSignal.matchedWorkEntries)
            ? rawSignal.matchedWorkEntries.filter((rawEntry): rawEntry is Record<string, unknown> => isRecord(rawEntry))
            : [];
        return workEntries.some((rawEntry) => rawEntry.directRoleMatch === true);
    });
    if (hasDirectSalesTitle) {
        return undefined;
    }

    // No direct sales job title — sales signal came from descriptions only — cap at 0
    return 0;
}


export function normalizeAnalysisResult(
    result: {
        score?: unknown;
        recommendation?: unknown;
        summary?: unknown;
        highlights?: unknown;
        concerns?: unknown;
        breakdown?: unknown;
    },
    resume: unknown,
    options?: {
        targetRoleType?: "sales";
        keywords?: string[];
    },
): {
    score: number;
    recommendation: AnalysisRecommendation;
    summary: string;
    highlights: string[];
    concerns: string[];
    breakdown: Record<string, number>;
} {
    const breakdown = parseNumericBreakdown(result.breakdown);
    let relatedExpRaw = clamp(toNumber(breakdown?.related_exp) ?? 0, 0, 100);
    if (options?.targetRoleType === "sales") {
        const floor = inferSalesRelatedExpFloor(resume);
        if (floor !== undefined) {
            relatedExpRaw = Math.max(relatedExpRaw, floor);
        }
        // Keyword-dependent floor/ceiling (order-safe with noDirectSalesCap below:
        // min is commutative, so the order of floor/ceiling/cap application
        // doesn't affect the final result)
        if (Array.isArray(options.keywords) && options.keywords.length > 0) {
            const unverifiedFloor = inferUnverifiedDomainRelevantSalesFloor(resume, options.keywords);
            if (unverifiedFloor !== undefined) {
                relatedExpRaw = Math.max(relatedExpRaw, unverifiedFloor);
            }
            const ceiling = inferDomainIrrelevantSalesCeiling(resume, options.keywords);
            if (ceiling !== undefined) {
                relatedExpRaw = Math.min(relatedExpRaw, ceiling);
            }
        }
        // No-direct-sales-role cap: zeros out description-only sales signals
        const noDirectSalesCap = inferNoDirectSalesRoleCap(resume, floor);
        if (noDirectSalesCap !== undefined) {
            relatedExpRaw = Math.min(relatedExpRaw, noDirectSalesCap);
        }
    }
    const relatedExpWeightedContribution = Math.round(relatedExpRaw * RELATED_EXP_WEIGHT);
    const industryDb = computeDirectIndustryDbScoreFromResume(resume);
    const score = clamp(relatedExpWeightedContribution + industryDb, 0, 100);
    const recommendation = recommendationFromScore(score);
    const rawSummary = typeof result.summary === "string" && result.summary.trim().length > 0
        ? result.summary
        : "No summary provided.";

    return {
        score,
        recommendation,
        summary: normalizeSummaryConsistency(rawSummary, {
            score,
            recommendation,
        }),
        highlights: Array.isArray(result.highlights)
            ? result.highlights.filter((item): item is string => typeof item === "string")
            : [],
        concerns: Array.isArray(result.concerns)
            ? result.concerns.filter((item): item is string => typeof item === "string")
            : [],
        breakdown: {
            ...(breakdown ?? {}),
            related_exp: relatedExpRaw,
            industry_db: industryDb,
        },
    };
}

function formatWorkEntry(
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

function formatRoleSignals(
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

function parseRoleSignals(value: unknown): NormalizedRoleSignal[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item) => {
        if (!isRecord(item)) {
            return [];
        }

        const type = typeof item.type === "string" ? item.type.trim() : "";
        const years = toNumber(item.years);
        if (!type || years === undefined) {
            return [];
        }

        const verifyIn = item.verifyIn === "searchText" ? "searchText" : "workHistory";
        const matchedSignals = Array.isArray(item.matchedSignals)
            ? item.matchedSignals.filter((signal): signal is string => typeof signal === "string" && signal.length > 0)
            : [];
        const signalCount = toNumber(item.signalCount) ?? matchedSignals.length;
        const occurrences = toNumber(item.occurrences) ?? matchedSignals.length;
        const industryVerifiedYears = toNumber(item.industryVerifiedYears) ?? 0;
        const roleRelevantYears = toNumber(item.roleRelevantYears);
        const industryVerifiedRelevantYears = toNumber(item.industryVerifiedRelevantYears);
        const matchedWorkEntries = Array.isArray(item.matchedWorkEntries)
            ? item.matchedWorkEntries.flatMap((entry) => {
                if (!isRecord(entry)) {
                    return [];
                }

                const entryYears = toNumber(entry.years);
                if (entryYears === undefined) {
                    return [];
                }

                const matchedEntrySignals = Array.isArray(entry.matchedSignals)
                    ? entry.matchedSignals.filter(
                        (signal): signal is string => typeof signal === "string" && signal.length > 0
                    )
                    : [];

                return [{
                    companyName: typeof entry.companyName === "string" && entry.companyName.trim().length > 0
                        ? entry.companyName.trim()
                        : undefined,
                    jobTitle: typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0
                        ? entry.jobTitle.trim()
                        : undefined,
                    years: entryYears,
                    industryVerified: entry.industryVerified === true,
                    matchedSignals: matchedEntrySignals,
                    ...(typeof entry.directRoleMatch === "boolean"
                        ? { directRoleMatch: entry.directRoleMatch }
                        : {}),
                }];
            })
            : undefined;

        return [{
            type,
            matchedSignals,
            signalCount,
            occurrences,
            years,
            industryVerifiedYears,
            ...(roleRelevantYears === undefined ? {} : { roleRelevantYears }),
            ...(industryVerifiedRelevantYears === undefined ? {} : { industryVerifiedRelevantYears }),
            ...(matchedWorkEntries && matchedWorkEntries.length > 0 ? { matchedWorkEntries } : {}),
            verifyIn,
        }];
    });
}

export function hydrateUserPrompt(
    template: string,
    job: { title: string; requirements: string; matchingRules: string },
    resume: ReturnType<typeof normalizeResume>,
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

export function getAiApiKey(): string | undefined {
    return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

export function getAiApiBase(): string {
    return process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.openai.com/v1";
}

export function getAiModel(): string {
    return process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4-turbo-preview";
}

export function getAiTemperature(): number {
    const raw = process.env.AI_TEMPERATURE;
    if (raw !== undefined && raw.trim().length > 0) {
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

// Helper to normalize resume data
export function normalizeResume(
    data: unknown,
    options?: {
        locale?: string;
        fieldUsagePolicy?: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides;
    },
) {
    const localeText = getResumeAiLocaleText(options?.locale);
    const root = isRecord(data) ? data : {};
    const rawContent = isRecord(root.content) ? root.content : root;
    const content = sanitizeResumeRecordForSurface(rawContent, "analysis", options?.fieldUsagePolicy);
    const ingestData = isRecord(root.ingestData)
        ? root.ingestData
        : (isRecord(content.ingestData) ? content.ingestData : undefined);

    const latestWorkHistory = selectLatestWorkHistory(content.workHistory);

    // Extract companies from workHistory since resume content has no "companies" field
    const historyCompanies = latestWorkHistory
        .map((item) => item.companyName)
        .filter((item): item is string => typeof item === "string" && item.length > 0);
    const existingCompanies = Array.isArray(content.companies)
        ? content.companies.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [];
    const allCompanies = [...new Set([...existingCompanies, ...historyCompanies])];

    // Parse experience: handle "11年" string format or numeric
    const rawExp = content.experience ?? content.workExperience ?? "0";
    const parsedExp = typeof rawExp === "string"
        ? parseInt(rawExp.replace(/[^0-9]/g, ""), 10)
        : (typeof rawExp === "number" ? rawExp : 0);

    const evidenceText = typeof ingestData?.evidenceText === "string"
        ? ingestData.evidenceText
        : "";

    const companyHits = Array.isArray(ingestData?.companyHits)
        ? ingestData.companyHits.filter(
            (item: unknown): item is string => typeof item === "string" && item.length > 0
        )
        : [];
    const roleSignals = parseRoleSignals(ingestData?.roleSignals);

    return {
        name: typeof content.name === "string" ? content.name : localeText.emptyFieldLabel,
        workExperience: Number.isFinite(parsedExp) ? parsedExp : 0,
        education: typeof content.education === "string"
            ? content.education
            : (typeof content.degree === "string" ? content.degree : localeText.emptyFieldLabel),
        companies: allCompanies.length > 0 ? allCompanies.slice(0, 8).join(", ") : localeText.emptyFieldLabel,
        evidenceText: evidenceText.trim() || localeText.emptyFieldLabel,
        roleSignals,
        roleSignalsText: formatRoleSignals(roleSignals, localeText),
        verifiedCompanies: companyHits,
    };
}

// Helper to call OpenAI/Compatible API
export async function callLLM(messages: ChatMessage[], apiKey: string) {
    const apiBase = getAiApiBase();
    const url = `${apiBase}/chat/completions`;
    const model = resolveChatCompletionModel(apiBase, getAiModel());

    console.log(`Calling LLM at ${url} with model ${model}...`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: messages,
            temperature: getAiTemperature(),
            response_format: { type: "json_object" },
        }),
    });

    if (!response.ok) {
        // Handle 502/504 specially possibly?
        const text = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content;

    // Clean markdown code blocks
    content = content.replace(/```json\n?|```/g, "").trim();

    // Attempt to fix common LLM JSON errors (e.g. unquoted keys or english word numbers)
    // This simple regex fixes "score": thirty -> "score": 30 (if mapping exists) or just "score": 0
    // But since we can't easily map all words, let's just quote the value if it looks like a word so JSON.parse passes, then downstream handles it.
    // However, correcting the Prompt is the best fix.
    // Let's try to simple-fix unquoted string values for score to make it valid JSON at least.
    // Match "score": word (no quotes)
    content = content.replace(/"(score|related_exp|experience|skills|industry_db|education|location)":\s*([a-zA-Z]+)(?=[,}])/g, '"$1": "$2"');

    try {
        const json = JSON.parse(content);
        // Force score to be a number if it's a string like "30"
        if (typeof json.score === 'string') {
            const num = parseInt(json.score);
            if (!isNaN(num)) json.score = num;
        }
        return json;
    } catch (e) {
        console.error("Failed to parse LLM response (raw content):", content.slice(0, 2000));
        throw new Error(`Invalid JSON response from AI: ${content.slice(0, 200)}`);
    }
}

export const analyzeResume = action({
    args: {
        resumeId: v.id("resumes"),
        jobDescription: v.optional(v.object({
            title: v.string(),
            requirements: v.string(),
        })),
        matchingRules: v.optional(v.any()), // New unified config
        jobDescriptionId: v.optional(v.string()), // Added ID
        keywords: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const apiKey = getAiApiKey();
        if (!apiKey) {
            throw new Error("AI_API_KEY/OPENAI_API_KEY is not set in Convex environment variables.");
        }

        const resume = await ctx.runQuery(internal.resumes.getResume, { resumeId: args.resumeId });

        if (!resume) {
            throw new Error(`Resume not found: ${args.resumeId}`);
        }

        const sourceKey = inferSourceKey(resume.source);
        const locale = resolveAIOutputLocale({ sourceKey });
        const isEnglishLocale = isEnglishResumeAiLocale(locale);

        const jd = args.jobDescription || {
            title: isEnglishLocale ? "Sales Manager (General)" : "销售经理 (通用)",
            requirements: isEnglishLocale
                ? "Sales experience, strong communication, and machine-tool industry familiarity preferred."
                : "具备销售经验，沟通能力强，熟悉机床行业优先。",
        };

        const matchingRules = args.matchingRules
            ? JSON.stringify(args.matchingRules, null, 2)
            : (isEnglishLocale ? "Use the default scoring rules." : "使用默认评分标准");
        const promptVersion = getResumeAiPromptDefinition(locale).metadata.version;
        const norm = normalizeResume(resume, { locale });
        const prompt = hydrateUserPrompt(
            getUserPromptTemplate(locale),
            { title: jd.title, requirements: jd.requirements, matchingRules },
            norm,
            locale,
        );

        const messages: ChatMessage[] = [
            { role: "system", content: buildSystemPrompt(locale) },
            { role: "user", content: prompt },
        ];

        // 3. Call LLM
        let rawResult;
        try {
            rawResult = await callLLM(messages, apiKey);
        } catch (e) {
            console.error("LLM Call failed:", e);
            throw new Error("Failed to analyze resume with AI.");
        }
        const normalizedKeywords = (args.keywords ?? [])
            .map((k) => k.trim().toLowerCase())
            .filter((k) => k.length > 0);
        const targetRoleType = isSalesRequiredContext(...normalizedKeywords) ? "sales" as const : undefined;
        const result = normalizeAnalysisResult(
            isRecord(rawResult) ? rawResult : {},
            resume,
            normalizedKeywords.length > 0 ? { targetRoleType, keywords: normalizedKeywords } : undefined,
        );

        // 4. Update Resume with result
        await ctx.runMutation(internal.resumes.updateAnalysis, {
            resumeId: args.resumeId,
            analysis: {
                score: result.score,
                breakdown: result.breakdown,
                summary: result.summary,
                highlights: result.highlights || [],
                recommendation: result.recommendation || "no_match",
                jobDescriptionId: args.jobDescriptionId || "default",
                promptVersion,
                locale,
                analyzedAt: Date.now(),
            },
        });

        return result;
    },
});

export const analyzeBatch = action({
    args: {
        resumeIds: v.array(v.id("resumes")),
        jobDescription: v.optional(v.object({
            title: v.string(),
            requirements: v.string(),
        })),
        matchingRules: v.optional(v.any()),
        jobDescriptionId: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const { resumeIds, jobDescription, matchingRules, jobDescriptionId, keywords } = args;

        // Dispatch actions for each resume
        // This runs them securely in background without blocking
        await Promise.all(resumeIds.map(id => {
            return ctx.scheduler.runAfter(0, (internal as any).analyze.analyzeResume, {
                resumeId: id,
                jobDescription,
                matchingRules,
                jobDescriptionId,
                ...(keywords ? { keywords } : {}),
            });
        }));

        return { count: resumeIds.length, status: "scheduled" };
    }
});
