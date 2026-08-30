/**
 * Analysis normalization helpers extracted from analyze.ts.
 *
 * Pure functions for normalizing LLM analysis results, parsing role
 * signals, computing industry DB scores, and ensuring summary consistency.
 */
import {
    applyAdjacentProductScoreCap,
    applyMarketIndustryDbFloor,
    collectAdjacentProductEvidenceText,
    computeIndustryDbDirectHitScore,
    deriveMarketFromSourceKey,
    INDUSTRY_DB_DISPLAY_CAP,
    isRecord,
    evaluateRelatedExpEvidence,
    computeFinalAiScore,
    recommendationFromFinalAiScore,
    resolveResumeAnalysisSourceKey,
    aggregateBrandOrigin,
    aggregateProductClass,
    parseBrandOrigin,
    parseProductClass,
    stripForbiddenStrongMatchProse,
    structuredBrandConcerns,
    type BrandOrigin,
    type ProductClass,
    type RelatedExpContextInput,
    type RelatedExpIngestEvidence,
    type RelatedExpEvidenceResult,
} from "@trends/shared";
import {
    parseScreeningChecklist,
    type ScreeningChecklist,
} from "./screening_checklist.js";

// Re-export for callers that need the P1 context types
export type { RelatedExpContextInput, RelatedExpIngestEvidence, RelatedExpEvidenceResult };
export type { ScreeningChecklist };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalysisRecommendation = "strong_match" | "match" | "potential" | "no_match";

export interface KeyFactor {
    factor: string;
    weight?: number;
    value: string;
}

export type NormalizedMatchedWorkEntry = {
    companyName?: string;
    companyKey?: string;
    jobTitle?: string;
    years: number;
    industryVerified: boolean;
    verdictRevisionId?: string;
    workEntryFingerprint?: string;
    matchedSignals: string[];
    directRoleMatch?: boolean;
};

export type NormalizedRoleSignal = {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INDUSTRY_DB_SCORE_CAP = INDUSTRY_DB_DISPLAY_CAP;
/**
 * @deprecated No longer part of the score formula. `score = related_exp` (the factor)
 * as of the P0.5 refactor; industry_db is a display/sort signal only. Kept for legacy
 * display compatibility and downstream consumers.
 */
export const RELATED_EXP_WEIGHT = INDUSTRY_DB_SCORE_CAP / 100;

export const RELATED_EXP_CEILING_BY_RECOMMENDATION: Record<AnalysisRecommendation, number> = {
    strong_match: 100,
    match: 100,
    potential: 60,
    no_match: 30,
} as const;

const VALID_LLM_RECOMMENDATIONS = new Set<string>(["strong_match", "match", "potential", "no_match"]);
const CN_MACHINE_TOOL_COMPANY_VERIFIED_SALES_FLOOR = 60;
const CN_MACHINE_TOOL_COMPANY_VERIFIED_SALES_FLOOR_REASON = "cn_machine_tool_company_verified_sales_floor_v1";
const CN_MACHINE_TOOL_POSITIVE_KEYWORDS = [
    "cnc",
    "数控",
    "机床",
    "加工中心",
    "车床",
    "磨床",
    "铣床",
    "电火花",
    "线切割",
    "走心机",
].map((keyword) => keyword.toLowerCase());
const CN_MACHINE_TOOL_EXCLUSION_KEYWORDS = [
    "刀具",
    "工具",
    "砂轮",
    "称重",
    "称量",
    "激光",
    "automation",
    "自动化",
    "空压机",
    "液压",
    "减速机",
    "测量",
    "metrology",
    "cmm",
    "机器人",
    "机械手",
    "矿山",
    "混凝土",
    "工程机械",
    "鞋机",
    "木工",
    "木材",
].map((keyword) => keyword.toLowerCase());

function toLLMRecommendation(value: unknown): AnalysisRecommendation | undefined {
    if (typeof value === "string" && VALID_LLM_RECOMMENDATIONS.has(value)) {
        return value as AnalysisRecommendation;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function toNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function recommendationFromScore(score: number): AnalysisRecommendation {
    if (score >= 85) return "strong_match";
    if (score >= 70) return "match";
    if (score >= 40) return "potential";
    return "no_match";
}

export function hasHanText(value: string): boolean {
    return /[\u4e00-\u9fff]/.test(value);
}

function buildNormalizedSummaryLine(
    summary: string,
    normalized: {
        score: number;
        recommendation: AnalysisRecommendation;
    },
): string {
    return hasHanText(summary)
        ? `系统归一化结果：score ${normalized.score}，recommendation ${normalized.recommendation}。`
        : `Normalized result: score ${normalized.score}, recommendation ${normalized.recommendation}.`;
}

function ensureNormalizedSummaryLine(
    summary: string,
    normalized: {
        score: number;
        recommendation: AnalysisRecommendation;
    },
): string {
    const normalizedLine = buildNormalizedSummaryLine(summary, normalized);
    if (summary.includes(normalizedLine)) {
        return summary;
    }
    return `${summary} ${normalizedLine}`.trim();
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export function parseKeyFactors(value: unknown): KeyFactor[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
            factor: typeof item.factor === "string" ? item.factor : "unknown",
            weight: typeof item.weight === "number" && Number.isFinite(item.weight) ? item.weight : undefined,
            value: typeof item.value === "string" ? item.value : "",
        }))
        .filter((f) => f.factor !== "unknown" || f.value.length > 0);
}

export function parseNumericBreakdown(value: unknown): Record<string, number> | undefined {
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

export function parseRoleSignals(value: unknown): NormalizedRoleSignal[] {
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
                    companyKey: typeof entry.companyKey === "string" && entry.companyKey.trim().length > 0
                        ? entry.companyKey.trim().toLowerCase()
                        : undefined,
                    jobTitle: typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0
                        ? entry.jobTitle.trim()
                        : undefined,
                    years: entryYears,
                    industryVerified: entry.industryVerified === true,
                    verdictRevisionId:
                        typeof entry.verdictRevisionId === "string"
                        && entry.verdictRevisionId.trim().length > 0
                            ? entry.verdictRevisionId.trim()
                            : undefined,
                    workEntryFingerprint:
                        typeof entry.workEntryFingerprint === "string"
                        && entry.workEntryFingerprint.trim().length > 0
                            ? entry.workEntryFingerprint.trim()
                            : undefined,
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

// ---------------------------------------------------------------------------
// Ingest data helpers
// ---------------------------------------------------------------------------

export function hasNonEmployerBrandHits(value: unknown): boolean {
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

export function hasCompanyHits(value: unknown): boolean {
    if (!Array.isArray(value)) {
        return false;
    }

    return value.some((item) => typeof item === "string" && item.trim().length > 0);
}

export function getResumeIngestData(resume: unknown): Record<string, unknown> {
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

type NormalizedWorkHistoryEntry = {
    companyName?: string;
    jobTitle?: string;
    description?: string;
    raw?: string;
};

function getResumeWorkHistory(resume: unknown): NormalizedWorkHistoryEntry[] {
    const root = isRecord(resume) ? resume : {};
    const content = isRecord(root.content) ? root.content : {};
    const rawWorkHistory = Array.isArray(root.workHistory)
        ? root.workHistory
        : (Array.isArray(content.workHistory) ? content.workHistory : []);

    return rawWorkHistory.flatMap((entry) => {
        if (!isRecord(entry)) {
            return [];
        }

        return [{
            companyName: typeof entry.companyName === "string" && entry.companyName.trim().length > 0
                ? entry.companyName.trim()
                : undefined,
            jobTitle: typeof entry.jobTitle === "string" && entry.jobTitle.trim().length > 0
                ? entry.jobTitle.trim()
                : undefined,
            description: typeof entry.description === "string" && entry.description.trim().length > 0
                ? entry.description.trim()
                : undefined,
            raw: typeof entry.raw === "string" && entry.raw.trim().length > 0
                ? entry.raw.trim()
                : undefined,
        }];
    });
}

function normalizeComparableText(value: string | undefined): string {
    return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function workHistoryMatchesDirectSalesEntry(
    workEntry: NormalizedWorkHistoryEntry,
    matchedEntry: NormalizedMatchedWorkEntry,
): boolean {
    const workCompany = normalizeComparableText(workEntry.companyName);
    const matchedCompany = normalizeComparableText(matchedEntry.companyName);
    if (!workCompany || !matchedCompany) {
        return false;
    }

    const companyMatches = workCompany.includes(matchedCompany) || matchedCompany.includes(workCompany);
    if (!companyMatches) {
        return false;
    }

    const workTitle = normalizeComparableText(workEntry.jobTitle);
    const matchedTitle = normalizeComparableText(matchedEntry.jobTitle);
    return !workTitle || !matchedTitle || workTitle === matchedTitle;
}

function buildWorkHistoryEntryDomainText(entry: NormalizedWorkHistoryEntry): string {
    return [
        entry.companyName,
        entry.jobTitle,
        entry.description,
        entry.raw,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ").toLowerCase();
}

function hasAnyKeyword(text: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

function getPrimarySalesSignal(resume: unknown): NormalizedRoleSignal | undefined {
    const ingestData = getResumeIngestData(resume);
    const salesSignals = parseRoleSignals(ingestData.roleSignals).filter((signal) => signal.type.trim().toLowerCase() === "sales");
    if (salesSignals.length === 0) {
        return undefined;
    }

    return salesSignals.sort((left, right) => {
        const leftVerified = left.industryVerifiedRelevantYears ?? left.industryVerifiedYears ?? 0;
        const rightVerified = right.industryVerifiedRelevantYears ?? right.industryVerifiedYears ?? 0;
        if (rightVerified !== leftVerified) {
            return rightVerified - leftVerified;
        }

        if (right.years !== left.years) {
            return right.years - left.years;
        }

        return right.matchedSignals.length - left.matchedSignals.length;
    })[0];
}


function collectResumeAdjacentProductEvidenceText(resume: unknown): string {
    const ingestData = getResumeIngestData(resume);
    const salesSignal = getPrimarySalesSignal(resume);
    const workHistoryText = getResumeWorkHistory(resume).map((entry) => buildWorkHistoryEntryDomainText(entry));
    const matchedEntryText = (salesSignal?.matchedWorkEntries ?? []).flatMap((entry) => [
        entry.companyName,
        entry.jobTitle,
        ...entry.matchedSignals,
    ]);
    const evidenceText = typeof ingestData.evidenceText === "string" ? ingestData.evidenceText : undefined;
    return collectAdjacentProductEvidenceText([
        ...workHistoryText,
        ...matchedEntryText,
        evidenceText,
    ]);
}

function inferCnMachineToolCompanyVerifiedSalesFloor(
    resume: unknown,
    relatedExpCtx: {
        context: RelatedExpContextInput;
        ingestEvidence: RelatedExpIngestEvidence;
    } | undefined,
    relatedExpEvidence: RelatedExpEvidenceResult | undefined,
    llmRecommendation: AnalysisRecommendation | undefined,
    currentEffectiveRelatedExp: number,
): {
    floor: number;
    reason: string;
} | undefined {
    if (!relatedExpCtx || !relatedExpEvidence) {
        return undefined;
    }

    if (relatedExpCtx.context.market?.trim().toUpperCase() !== "CN") {
        return undefined;
    }

    if (relatedExpCtx.context.roleFilterType?.trim().toLowerCase() !== "sales") {
        return undefined;
    }

    if (llmRecommendation !== "potential") {
        return undefined;
    }

    if (relatedExpEvidence.coverage !== "full") {
        return undefined;
    }

    if (currentEffectiveRelatedExp >= CN_MACHINE_TOOL_COMPANY_VERIFIED_SALES_FLOOR) {
        return undefined;
    }

    const ingestData = getResumeIngestData(resume);
    if (!hasCompanyHits(ingestData.companyHits)) {
        return undefined;
    }

    if (hasNonEmployerBrandHits(ingestData.brandHits)) {
        return undefined;
    }

    const salesSignal = getPrimarySalesSignal(resume);
    if (!salesSignal) {
        return undefined;
    }

    const verifiedYears = salesSignal.industryVerifiedRelevantYears ?? salesSignal.industryVerifiedYears ?? 0;
    if (verifiedYears < 5) {
        return undefined;
    }

    const directVerifiedEntries = (salesSignal.matchedWorkEntries ?? []).filter(
        (entry) => entry.directRoleMatch === true && entry.industryVerified === true,
    );
    if (directVerifiedEntries.length === 0) {
        return undefined;
    }

    const matchedWorkHistoryText = getResumeWorkHistory(resume)
        .flatMap((entry) => {
            const text = buildWorkHistoryEntryDomainText(entry);
            if (!text) {
                return [];
            }

            const matchesDirectEntry = directVerifiedEntries.some((directEntry) => workHistoryMatchesDirectSalesEntry(entry, directEntry));
            return matchesDirectEntry ? [text] : [];
        })
        .join(" ");

    const directEntryText = directVerifiedEntries.flatMap((entry) => [
        entry.companyName,
        entry.jobTitle,
        ...entry.matchedSignals,
    ]).filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ").toLowerCase();

    const machineToolSalesText = `${matchedWorkHistoryText} ${directEntryText}`.trim();
    if (!machineToolSalesText) {
        return undefined;
    }

    if (!hasAnyKeyword(machineToolSalesText, CN_MACHINE_TOOL_POSITIVE_KEYWORDS)) {
        return undefined;
    }

    if (hasAnyKeyword(machineToolSalesText, CN_MACHINE_TOOL_EXCLUSION_KEYWORDS)) {
        return undefined;
    }

    return {
        floor: Math.min(CN_MACHINE_TOOL_COMPANY_VERIFIED_SALES_FLOOR, relatedExpEvidence.recommendationMax),
        reason: CN_MACHINE_TOOL_COMPANY_VERIFIED_SALES_FLOOR_REASON,
    };
}

export function computeDirectIndustryDbScoreFromResume(resume: unknown): number {
    const ingestData = getResumeIngestData(resume);
    const brandHits = hasNonEmployerBrandHits(ingestData.brandHits);
    const companyHits = hasCompanyHits(ingestData.companyHits);
    const directHitScore = computeIndustryDbDirectHitScore(brandHits, companyHits);

    const raw = toNumber(ingestData.industryDbV2Raw) ?? 0;
    return clamp(Math.max(raw, directHitScore), 0, INDUSTRY_DB_SCORE_CAP);
}

function resolveResumeMarket(resume: unknown): "CN" | "MY" {
    const ingestData = getResumeIngestData(resume);
    const explicitMarket = typeof ingestData.market === "string" ? ingestData.market.trim().toUpperCase() : "";
    if (explicitMarket === "MY") {
        return "MY";
    }
    if (explicitMarket === "CN") {
        return "CN";
    }

    const root = isRecord(resume) ? resume : {};
    const content = isRecord(root.content) ? root.content : {};
    const sourceKey = typeof root.sourceKey === "string"
        ? root.sourceKey
        : (typeof content.profileType === "string" ? content.profileType : undefined);
    const source = typeof root.source === "string"
        ? root.source
        : (typeof content.source === "string" ? content.source : undefined);
    const canonicalSourceKey = resolveResumeAnalysisSourceKey({ sourceKey, source });
    return deriveMarketFromSourceKey(canonicalSourceKey);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeSummaryConsistency(
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

    if (hasScoreMismatch || hasRecommendationMismatch) {
        next = ensureNormalizedSummaryLine(next, normalized);
    }

    // Phase 2: forbid strong-match prose on low score bands (e.g. 刘先生 刀具 summary).
    next = stripForbiddenStrongMatchProse(next, normalized.score);

    return next;
}

function resolveStructuredBrandSignals(resume: unknown): {
    brandOrigin?: BrandOrigin;
    productClass?: ProductClass;
} {
    const ingestData = getResumeIngestData(resume);
    const hits = Array.isArray(ingestData.brandHits)
        ? ingestData.brandHits.flatMap((item) => {
            if (!isRecord(item)) {
                return [];
            }
            const origin = parseBrandOrigin(item.origin);
            const productClass = parseProductClass(item.productClass);
            return origin === undefined && productClass === undefined
                ? []
                : [{ origin, productClass }];
        })
        : [];
    const hasHitOrigin = hits.some((hit) => hit.origin !== undefined);
    const hasHitProductClass = hits.some((hit) => hit.productClass !== undefined);
    return {
        brandOrigin: parseBrandOrigin(ingestData.brandOrigin)
            ?? (hasHitOrigin ? aggregateBrandOrigin(hits) : undefined),
        productClass: parseProductClass(ingestData.productClass)
            ?? (hasHitProductClass ? aggregateProductClass(hits) : undefined),
    };
}

/**
 * Merge deterministic structured brand concerns into LLM concerns without
 * duplicating already-present phrases.
 */
export function enrichConcernsWithBrandSignals(
    concerns: string[],
    resume: unknown,
    locale?: string,
): string[] {
    const signals = resolveStructuredBrandSignals(resume);
    const extras = structuredBrandConcerns({
        brandOrigin: signals.brandOrigin,
        productClass: signals.productClass,
        locale,
    });
    if (extras.length === 0) {
        return concerns;
    }
    const next = [...concerns];
    for (const extra of extras) {
        if (!next.some((item) => item.includes(extra) || extra.includes(item))) {
            next.push(extra);
        }
    }
    return next;
}

export function normalizeAnalysisResult(
    result: {
        score?: unknown;
        recommendation?: unknown;
        summary?: unknown;
        highlights?: unknown;
        concerns?: unknown;
        breakdown?: unknown;
        keyFactors?: unknown;
        screeningChecklist?: unknown;
    },
    resume: unknown,
    relatedExpCtx?: {
        context: RelatedExpContextInput;
        ingestEvidence: RelatedExpIngestEvidence;
    },
): {
    score: number;
    recommendation: AnalysisRecommendation;
    summary: string;
    highlights: string[];
    concerns: string[];
    breakdown: Record<string, number>;
    keyFactors: KeyFactor[];
    relatedExpEvidence?: RelatedExpEvidenceResult;
    screeningChecklist: ScreeningChecklist;
} {
    const breakdown = parseNumericBreakdown(result.breakdown);
    const llmRelatedExp = toNumber(breakdown?.related_exp);
    const directIndustryDb = computeDirectIndustryDbScoreFromResume(resume);
    const market = resolveResumeMarket(resume);
    const industryDb = applyMarketIndustryDbFloor(market, directIndustryDb);

    if (llmRelatedExp === undefined) {
        console.warn("LLM related_exp invalid, falling back to related_exp=0");
    }

    const relatedExpRaw = clamp(llmRelatedExp ?? 0, 0, 100);
    const llmRecommendation = toLLMRecommendation(result.recommendation);
    if (llmRecommendation === undefined && result.recommendation !== undefined) {
        console.warn("unknown LLM recommendation; defaulting to no_match ceiling", { recommendation: result.recommendation });
    }
    const relatedExpCeiling = RELATED_EXP_CEILING_BY_RECOMMENDATION[llmRecommendation ?? "no_match"];
    const cappedRelatedExp = clamp(relatedExpRaw, 0, relatedExpCeiling);

    // P1: apply evidence ceiling when context is provided
    let relatedExpEvidence: RelatedExpEvidenceResult | undefined;
    let effectiveRelatedExp = cappedRelatedExp;

    if (relatedExpCtx) {
        relatedExpEvidence = evaluateRelatedExpEvidence({
            context: relatedExpCtx.context,
            llmRaw: relatedExpRaw,
            llmRecommendation: llmRecommendation ?? "no_match",
            ingestEvidence: relatedExpCtx.ingestEvidence,
        });
        // Lower-only: effectiveRaw already respects recommendationMax ceiling
        effectiveRelatedExp = relatedExpEvidence.effectiveRaw;

        const floorAdjustment = inferCnMachineToolCompanyVerifiedSalesFloor(
            resume,
            relatedExpCtx,
            relatedExpEvidence,
            llmRecommendation,
            effectiveRelatedExp,
        );
        if (floorAdjustment && floorAdjustment.floor > effectiveRelatedExp) {
            relatedExpEvidence = {
                ...relatedExpEvidence,
                baseEffectiveRaw: effectiveRelatedExp,
                effectiveRaw: floorAdjustment.floor,
                adjustmentReason: floorAdjustment.reason,
            };
            effectiveRelatedExp = floorAdjustment.floor;
        }
    }

    const adjacentCap = applyAdjacentProductScoreCap({
        relatedExp: clamp(effectiveRelatedExp, 0, 100),
        industryDb,
        evidenceText: collectResumeAdjacentProductEvidenceText(resume),
        market,
    });
    if (adjacentCap.applied && relatedExpEvidence) {
        relatedExpEvidence = {
            ...relatedExpEvidence,
            baseEffectiveRaw: relatedExpEvidence.baseEffectiveRaw ?? effectiveRelatedExp,
            effectiveRaw: adjacentCap.relatedExp,
            adjustmentReason: adjacentCap.reason,
        };
    }
    effectiveRelatedExp = adjacentCap.relatedExp;
    const cappedIndustryDb = adjacentCap.industryDb;

    // relatedExpAuditFactor = the effective related-exp factor (0-100) after
    // recommendation ceiling, optional evidence ceiling, and adjacent-product cap.
    const relatedExpAuditFactor = clamp(effectiveRelatedExp, 0, 100);

    // Final AI Score = round(relatedExp * 0.5) + industryDb
    let score = computeFinalAiScore(relatedExpAuditFactor, cappedIndustryDb);

    // Gate: preserve LLM no_match — prevent industryDb from overriding a semantic rejection.
    // A candidate explicitly rejected by the LLM must not be elevated to potential/match
    // even when they have recognized employer brand hits.
    if (llmRecommendation === "no_match" && market !== "MY") {
        score = Math.min(score, 39);
    }

    const recommendation = recommendationFromFinalAiScore(score);
    const rawSummary = typeof result.summary === "string" && result.summary.trim().length > 0
        ? result.summary
        : "No summary provided.";
    const baseConcerns = Array.isArray(result.concerns)
        ? result.concerns.filter((item): item is string => typeof item === "string")
        : [];
    const localeHint = hasHanText(rawSummary) ? "zh" : "en";
    const normalizedSummary = normalizeSummaryConsistency(rawSummary, {
        score,
        recommendation,
    });
    const finalSummary = relatedExpEvidence?.adjustmentReason
        ? ensureNormalizedSummaryLine(normalizedSummary, {
            score,
            recommendation,
        })
        : normalizedSummary;

    const screeningChecklist = parseScreeningChecklist(result.screeningChecklist, resume);

    return {
        score,
        recommendation,
        summary: finalSummary,
        highlights: Array.isArray(result.highlights)
            ? result.highlights.filter((item): item is string => typeof item === "string")
            : [],
        concerns: enrichConcernsWithBrandSignals(baseConcerns, resume, localeHint),
        breakdown: {
            ...(breakdown ?? {}),
            related_exp: relatedExpAuditFactor,
            industry_db: cappedIndustryDb,
        },
        keyFactors: parseKeyFactors(result.keyFactors),
        screeningChecklist,
        ...(relatedExpEvidence ? { relatedExpEvidence } : {}),
    };
}
