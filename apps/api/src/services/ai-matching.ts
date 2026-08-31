/**
 * AI Matching Service
 *
 * Uses LLM for resume-job description matching
 * Compatible with OpenAI API and Poe.com proxy
 */

import fs from "node:fs";
import path from "node:path";

import JSON5 from "json5";

import {
    applyMarketIndustryDbFloor,
    FALLBACK_INDUSTRY_KEYWORDS,
    buildBrandHitsPromptSegments,
    computeFinalAiScore,
    deriveMarketFromSourceKey,
    evaluateRelatedExpEvidence,
    getResumeAiLocaleText,
    recommendationFromFinalAiScore,
    sanitizeResumeRecordForSurface,
    type RelatedExpContextInput,
    type ResumeFieldUsagePolicy,
    type ResumeFieldUsagePolicyOverrides,
} from "@trends/shared";
import { logger } from "./logger.js";
import { aiConfig, validateResumeAIConfig, getMaskedApiKey } from "./ai-config.js";
import { findProjectRoot } from "./db.js";
import { computeDirectIndustryDbScore } from "./industry-db-batch-stats.js";
import { localeToNaturalLanguage, resolveAIOutputLocale } from "./locale-utils.js";
import { resumeAiPromptService, type ResumeAiPromptDocument } from "./resume-ai-prompt-service.js";

// Types
export interface MatchingRequest {
    resume: {
        id: string;
        name: string;
        workExperience?: number;
        education?: string;
        skills?: string[];
        companies?: string[];
        brandHits?: Array<{
            brand?: string;
            role?: string;
            source?: string;
            context?: string;
            origin?: string;
            productClass?: string;
        }>;
        companyHits?: string[];
        brandOrigin?: string;
        productClass?: string;
        market?: string;
        industryDbV2Raw?: number;
        roleSignals?: Array<{
            type: string;
            matchedSignals: string[];
            signalCount: number;
            occurrences: number;
            years: number;
            industryVerifiedYears?: number;
            roleRelevantYears?: number;
            industryVerifiedRelevantYears?: number;
            matchedWorkEntries?: Array<{
                companyName?: string;
                jobTitle?: string;
                years: number;
                industryVerified: boolean;
                matchedSignals: string[];
                directRoleMatch?: boolean;
            }>;
            verifyIn: string;
        }>;
        workHistory?: string;
        sourceKey?: string;
    };
    jobDescription: {
        title: string;
        requirements: string;
        responsibilities?: string;
        company?: string;
    };
}

export type MatchingBreakdown = Record<string, number>;

export interface MatchingResult {
    score: number; // 0-100
    recommendation: "strong_match" | "match" | "potential" | "no_match";
    highlights: string[]; // Matching points
    concerns: string[]; // Missing or concerning points
    summary: string; // AI-generated summary
    breakdown?: MatchingBreakdown;
    matchedSkills?: string[];
    matchedCompanies?: string[];
    scoreSource?: "rule" | "ai";
    rawResponse?: string; // For debugging
}

export interface BatchMatchingProgress {
    resumeId: string;
    result: MatchingResult;
    done: number;
    total: number;
}

export interface BatchMatchingOptions {
    concurrency?: number;
    onResult?: (progress: BatchMatchingProgress) => void | Promise<void>;
    fieldUsagePolicy?: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides;
}

export interface BatchMatchingResult {
    results: Array<{ resumeId: string; result: MatchingResult }>;
    processedCount: number;
    failedCount: number;
    processingTimeMs: number;
}

type MatchResumeOptions = {
    prompt?: ResumeAiPromptDocument;
    fieldUsagePolicy?: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides;
};

function toObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
}

function readNumberField(obj: Record<string, unknown> | null, key: string): number | null {
    if (!obj) return null;
    const value = obj[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function loadConfiguredConcurrency(): number {
    try {
        const projectRoot = findProjectRoot();
        const configPath = path.join(projectRoot, "config", "resume", "agents.json5");
        if (!fs.existsSync(configPath)) return 5;

        const parsed = JSON5.parse(fs.readFileSync(configPath, "utf8")) as unknown;
        const root = toObject(parsed);
        const ruleScoring = toObject(root?.ruleScoring);
        const explicit = readNumberField(ruleScoring, "aiConcurrency");
        if (explicit && explicit > 0) {
            return Math.floor(explicit);
        }

        const agents = toObject(root?.agents);
        const list = Array.isArray(agents?.list) ? agents?.list : [];
        for (const item of list) {
            const entry = toObject(item);
            if (!entry || entry.id !== "screener") continue;
            const config = toObject(entry.config);
            const parallelism = readNumberField(config, "parallelism");
            if (parallelism && parallelism > 0) {
                return Math.floor(parallelism);
            }
        }
    } catch (error) {
        logger.error("[AI Matching] Failed to read agents config", error, { service: "ai-matching" });
    }

    return 5;
}

// Prompt templates
function buildSystemPrompt(systemPrompt: string, locale: string): string {
    const naturalLanguage = localeToNaturalLanguage(locale);
    return `${systemPrompt}\nPlease respond entirely in ${naturalLanguage}.`;
}

const SCORE_WORD_MAP: Record<string, number> = {
    zero: 0,
    ten: 10,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
};

const MAX_ERROR_TEXT_LENGTH = 320;
const MAX_RAW_RESPONSE_LENGTH = 4000;
const RELATED_EXP_CEILING_BY_RECOMMENDATION: Record<MatchingResult["recommendation"], number> = {
    strong_match: 100,
    match: 100,
    potential: 60,
    no_match: 30,
};
const SALES_ROLE_KEYWORDS = [
    "sales",
    "sale",
    "business development",
    "account manager",
    "客户开发",
    "销售",
    "业务",
    "商务",
];
const DOMAIN_IRRELEVANT_SALES_KEYWORDS = [
    "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
    "房地产", "地产", "置业", "房产",
    "教育", "培训", "学校",
    "医疗", "医院", "医药",
    "insurance", "assurance", "takaful",
    "finance", "financial", "investment", "bank",
    "real estate", "property",
];
const MACHINERY_DOMAIN_KEYWORDS = FALLBACK_INDUSTRY_KEYWORDS.machinery.map((keyword) => keyword.toLowerCase());

function compactWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function trimText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
}

function toCompactErrorMessage(value: unknown): string {
    const raw = value instanceof Error ? value.message : String(value);
    const compact = compactWhitespace(raw);
    return trimText(compact, MAX_ERROR_TEXT_LENGTH);
}

function toStoredRawResponse(value: string): string {
    const compact = compactWhitespace(value);
    return trimText(compact, MAX_RAW_RESPONSE_LENGTH);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseNumericBreakdown(value: unknown): MatchingBreakdown | undefined {
    const record = toObject(value);
    if (!record) return undefined;

    const numericEntries = Object.entries(record).flatMap(([key, item]) => {
        if (typeof item === "number" && Number.isFinite(item)) {
            return [[key, item] as const];
        }
        if (typeof item === "string") {
            const parsed = Number(item);
            if (Number.isFinite(parsed)) {
                return [[key, parsed] as const];
            }
        }
        return [];
    });

    return numericEntries.length > 0 ? Object.fromEntries(numericEntries) : undefined;
}

type MatchingResumeRoleSignal = NonNullable<MatchingRequest["resume"]["roleSignals"]>[number];
type MatchingResumeWorkEntry = NonNullable<MatchingResumeRoleSignal["matchedWorkEntries"]>[number];

function resolveResumeMarket(resume: MatchingRequest["resume"]): "CN" | "MY" | "TH" {
    const explicitMarket = resume.market?.trim().toUpperCase();
    if (explicitMarket === "MY") {
        return "MY";
    }
    if (explicitMarket === "TH") {
        return "TH";
    }
    if (explicitMarket === "CN") {
        return "CN";
    }

    return deriveMarketFromSourceKey(resume.sourceKey);
}

function computeDeterministicIndustryDb(resume: MatchingRequest["resume"]): number {
    const directIndustryDb = computeDirectIndustryDbScore({
        brandHits: resume.brandHits,
        companyHits: resume.companyHits,
        industryDbV2Raw: resume.industryDbV2Raw,
    });
    const market = resolveResumeMarket(resume);
    return applyMarketIndustryDbFloor(market, directIndustryDb);
}

function inferRoleFilterType(jobDescription: MatchingRequest["jobDescription"]): string | undefined {
    const haystack = [
        jobDescription.title,
        jobDescription.requirements,
        jobDescription.responsibilities,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ")
        .toLowerCase();

    return SALES_ROLE_KEYWORDS.some((keyword) => haystack.includes(keyword)) ? "sales" : undefined;
}

function inferMinRoleYears(jobDescription: MatchingRequest["jobDescription"]): number | undefined {
    const haystack = [
        jobDescription.requirements,
        jobDescription.responsibilities,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(" ");

    const match = haystack.match(/(\d+(?:\.\d+)?)\s*(?:\+)?\s*(?:years?|yrs?|年)(?:以上|经验|of experience)?/i);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function roleTypeMatches(signalType: string, roleFilterType: string | undefined): boolean {
    if (!roleFilterType || roleFilterType.trim().toLowerCase() === "any") {
        return true;
    }
    return signalType.trim().toLowerCase() === roleFilterType.trim().toLowerCase();
}

function formatMatchedWorkEntry(entry: MatchingResumeWorkEntry): string | undefined {
    const parts = [
        entry.jobTitle?.trim(),
        entry.companyName?.trim() ? `@ ${entry.companyName.trim()}` : undefined,
        Number.isFinite(entry.years) ? `(${entry.years}y)` : undefined,
    ].filter((item): item is string => Boolean(item));

    return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildSalesEntryDomainText(signal: MatchingResumeRoleSignal, entries: MatchingResumeWorkEntry[]): string {
    const signalMatchedSignals = signal.matchedSignals.filter((value) => value.trim().length > 0);
    const entryParts = entries.flatMap((entry) => {
        const parts: string[] = [];
        if (entry.companyName?.trim()) {
            parts.push(entry.companyName.trim());
        }
        if (entry.jobTitle?.trim()) {
            parts.push(entry.jobTitle.trim());
        }
        parts.push(...entry.matchedSignals.filter((value) => value.trim().length > 0));
        return parts;
    });

    return [...signalMatchedSignals, ...entryParts].join(" ").toLowerCase();
}

function isDomainIrrelevantSalesEntry(entry: MatchingResumeWorkEntry): boolean {
    const text = [
        entry.companyName?.trim(),
        entry.jobTitle?.trim(),
        ...entry.matchedSignals.filter((value) => value.trim().length > 0),
    ].filter((item): item is string => Boolean(item)).join(" ").toLowerCase();

    return DOMAIN_IRRELEVANT_SALES_KEYWORDS.some((keyword) => text.includes(keyword));
}

function hasMachineryDomainText(text: string): boolean {
    return MACHINERY_DOMAIN_KEYWORDS.some((keyword) => text.includes(keyword));
}

function buildRelatedExpNormalizeArg(
    resume: MatchingRequest["resume"],
    jobDescription: MatchingRequest["jobDescription"],
    locale?: string,
): { context: RelatedExpContextInput; ingestEvidence: Parameters<typeof evaluateRelatedExpEvidence>[0]["ingestEvidence"] } | undefined {
    const roleFilterType = inferRoleFilterType(jobDescription);
    if (!roleFilterType) {
        return undefined;
    }

    const minRoleYears = inferMinRoleYears(jobDescription);
    const relatedExpContext: RelatedExpContextInput = {
        roleFilterType,
        ...(minRoleYears === undefined ? {} : { minRoleYears }),
        market: resolveResumeMarket(resume),
        ...(locale ? { locale } : {}),
    };

    const roleSignals = Array.isArray(resume.roleSignals) ? resume.roleSignals : [];
    const matchingSignals = roleSignals.filter((signal) => roleTypeMatches(signal.type, relatedExpContext.roleFilterType));
    let directRoleMatch = false;
    let industryVerifiedRelevantYears = 0;
    const matchedWorkEntries: string[] = [];
    const myMarketContext = relatedExpContext.market === "MY" || relatedExpContext.market === "TH";
    let domainRelevantUnverified = false;

    for (const signal of matchingSignals) {
        if (typeof signal.industryVerifiedRelevantYears === "number" && Number.isFinite(signal.industryVerifiedRelevantYears)) {
            industryVerifiedRelevantYears = Math.max(
                industryVerifiedRelevantYears,
                Math.max(0, signal.industryVerifiedRelevantYears),
            );
        }

        if (!Array.isArray(signal.matchedWorkEntries)) {
            continue;
        }

        const rawEntries = signal.matchedWorkEntries.filter(
            (entry): entry is MatchingResumeWorkEntry => typeof entry.years === "number" && Number.isFinite(entry.years),
        );

        for (const entry of rawEntries) {
            directRoleMatch = directRoleMatch || entry.directRoleMatch === true;
            const formatted = formatMatchedWorkEntry(entry);
            if (formatted) {
                matchedWorkEntries.push(formatted);
            }
        }

        if (!myMarketContext || industryVerifiedRelevantYears > 0) {
            continue;
        }

        const hasDirectSalesEntry = rawEntries.some((entry) => entry.directRoleMatch === true);
        const hasDomainIrrelevantEntry = rawEntries.some((entry) => isDomainIrrelevantSalesEntry(entry));
        const salesEntryText = buildSalesEntryDomainText(signal, rawEntries);
        const hasMachineryEvidence = hasMachineryDomainText(salesEntryText);
        domainRelevantUnverified = domainRelevantUnverified || (
            hasDirectSalesEntry
            && hasMachineryEvidence
            && !hasDomainIrrelevantEntry
        );
    }

    return {
        context: relatedExpContext,
        ingestEvidence: {
            directRoleMatch,
            industryVerifiedRelevantYears,
            matchedWorkEntries,
            ...(myMarketContext ? { domainRelevantUnverified } : {}),
        },
    };
}


function formatRoleSignals(
    roleSignals: MatchingResumeRoleSignal[] | undefined,
    localeText: ReturnType<typeof getResumeAiLocaleText>,
): string {
    if (!roleSignals || roleSignals.length === 0) {
        return localeText.noneLabel;
    }

    return roleSignals.slice(0, 8).map((signal) => {
        const relevantYears =
            typeof signal.industryVerifiedRelevantYears === "number"
                ? signal.industryVerifiedRelevantYears
                : typeof signal.roleRelevantYears === "number"
                    ? signal.roleRelevantYears
                    : typeof signal.industryVerifiedYears === "number"
                        ? signal.industryVerifiedYears
                        : signal.years;
        const workEntries = signal.matchedWorkEntries && signal.matchedWorkEntries.length > 0
            ? signal.matchedWorkEntries.map((entry) => {
                const parts = [
                    entry.companyName,
                    entry.jobTitle,
                    `${entry.years}${localeText.yearsUnitSuffix}`,
                    entry.industryVerified ? localeText.verifiedLabel : localeText.unverifiedLabel,
                    entry.matchedSignals.length > 0
                        ? `${localeText.signalsLabel}:${entry.matchedSignals.join("/")}`
                        : undefined,
                ].filter((item): item is string => Boolean(item));
                return parts.join(" ");
            }).join("; ")
            : undefined;
        const parts = [
            `${signal.type}(${signal.verifyIn})`,
            `years:${signal.years}`,
            `relevant:${Number.isFinite(relevantYears) ? relevantYears : 0}`,
            signal.matchedSignals.length > 0 ? `signals:${signal.matchedSignals.join("/")}` : undefined,
            workEntries ? `work:${workEntries}` : undefined,
        ].filter((item): item is string => Boolean(item));
        return `- ${parts.join(" | ")}`;
    }).join("\n");
}

/**
 * AI Matching Service class
 */
export class AIMatchingService {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;
    private readonly defaultConcurrency: number;

    constructor() {
        // Use apiBase if provided, otherwise construct from model provider
        this.baseUrl = aiConfig.apiBase || "https://api.openai.com/v1";

        this.headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aiConfig.apiKey}`,
        };

        this.defaultConcurrency = loadConfiguredConcurrency();
    }

    /**
     * Check if AI service is available
     */
    isAvailable(): { available: boolean; reason?: string } {
        // Allow bypass in test/dev environment if explicitly requested or if using a mock provider
        if (process.env.NODE_ENV === 'test' || process.env.AI_MOCK_ENABLED === 'true') {
            return { available: true };
        }

        const validation = validateResumeAIConfig();
        if (!validation.valid) {
            return { available: false, reason: validation.error };
        }
        return { available: true };
    }

    /**
     * Get service info for debugging
     */
    getServiceInfo(): {
        enabled: boolean;
        resumesEnabled: boolean;
        model: string;
        apiBase: string;
        apiKeyMasked: string;
        concurrency: number;
    } {
        return {
            enabled: aiConfig.enabled,
            resumesEnabled: aiConfig.resumesEnabled,
            model: aiConfig.model,
            apiBase: this.baseUrl,
            apiKeyMasked: getMaskedApiKey(),
            concurrency: this.defaultConcurrency,
        };
    }

    /**
     * Match a single resume against a job description
     */
    async matchResume(request: MatchingRequest, options?: MatchResumeOptions): Promise<MatchingResult> {
        const availability = this.isAvailable();
        if (!availability.available) {
            const localeText = getResumeAiLocaleText(
                resolveAIOutputLocale({ sourceKey: request.resume.sourceKey })
            );
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: [availability.reason || "AI service unavailable"],
                summary: localeText.serviceUnavailableSummary,
                scoreSource: "ai",
            };
        }

        const prompt = options?.prompt ?? this.loadPromptForResume(request.resume);
        const messages = [
            { role: "system", content: buildSystemPrompt(prompt.normalized.systemPrompt, prompt.normalized.locale) },
            {
                role: "user",
                content: this.buildPrompt(request.resume, request.jobDescription, prompt, options?.fieldUsagePolicy),
            },
        ];

        try {
            const response = await this.callLLM(messages);
            const parsed = this.parseResponse(response, request, prompt);
            return parsed;
        } catch (error) {
            const errorMessage = toCompactErrorMessage(error);
            logger.error("[AI Matching] Error", errorMessage, { service: "ai-matching" });
            const localeText = getResumeAiLocaleText(prompt.normalized.locale);
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: [`${localeText.analysisErrorConcernPrefix}: ${errorMessage}`],
                summary: localeText.analysisErrorSummary,
                rawResponse: errorMessage,
                scoreSource: "ai",
            };
        }
    }

    /**
     * Batch match multiple resumes
     */
    async matchBatch(
        resumes: MatchingRequest["resume"][],
        jobDescription: MatchingRequest["jobDescription"],
        options?: BatchMatchingOptions
    ): Promise<BatchMatchingResult> {
        const startTime = Date.now();
        if (resumes.length === 0) {
            return {
                results: [],
                processedCount: 0,
                failedCount: 0,
                processingTimeMs: 0,
            };
        }

        const concurrency = Math.max(1, Math.min(
            options?.concurrency ?? this.defaultConcurrency,
            resumes.length
        ));
        const promptsBySourceKey = new Map<string, ResumeAiPromptDocument>();

        const orderedResults: Array<{ resumeId: string; result: MatchingResult } | null> =
            Array.from({ length: resumes.length }, () => null);
        let failedCount = 0;
        let done = 0;
        let nextIndex = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                if (currentIndex >= resumes.length) return;
                const resume = resumes[currentIndex];

                let result: MatchingResult;
                try {
                    const prompt = this.loadPromptForResume(resume, promptsBySourceKey);
                    result = await this.matchResume(
                        {
                            resume,
                            jobDescription,
                        },
                        {
                            prompt,
                            fieldUsagePolicy: options?.fieldUsagePolicy,
                        }
                    );
                } catch {
                    failedCount += 1;
                    const batchLocale = resolveAIOutputLocale({ sourceKey: resume.sourceKey });
                    const localeText = getResumeAiLocaleText(batchLocale);
                    result = {
                        score: 0,
                        recommendation: "no_match",
                        highlights: [],
                        concerns: [localeText.parseErrorConcern],
                        summary: localeText.parseErrorSummary,
                        scoreSource: "ai",
                    };
                }

                orderedResults[currentIndex] = { resumeId: resume.id, result };
                done += 1;

                if (options?.onResult) {
                    await options.onResult({
                        resumeId: resume.id,
                        result,
                        done,
                        total: resumes.length,
                    });
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        return {
            results: orderedResults.filter(
                (entry): entry is { resumeId: string; result: MatchingResult } => entry !== null
            ),
            processedCount: resumes.length,
            failedCount,
            processingTimeMs: Date.now() - startTime,
        };
    }

    /**
     * Generate an outreach email for a candidate
     */
    async generateOutreach(
        resume: MatchingRequest["resume"],
        jobDescription: MatchingRequest["jobDescription"],
        analysis: MatchingResult
    ): Promise<{ subject: string; body: string }> {
        const availability = this.isAvailable();
        if (!availability.available) {
            throw new Error(availability.reason || "AI service unavailable");
        }

        const outreachLocale = resolveAIOutputLocale({ sourceKey: resume.sourceKey });
        const naturalLanguage = localeToNaturalLanguage(outreachLocale);

        const prompt = `You are a professional technical recruiter. Draft a personalized outreach email to a candidate.

Job: ${jobDescription.title}
Company: ${jobDescription.company || "our company"}
Candidate: ${resume.name}
Summary: ${analysis.summary}
Highlights: ${analysis.highlights.join(", ")}

Requirements:
1. Tone: Professional, polite, and engaging.
2. Language: ${naturalLanguage}.
3. Structure: Subject line + Body.
4. Content: Mention specific highlights from their profile that match the job.

Return strictly valid JSON:
{
  "subject": "Email subject",
  "body": "Email body (text format, use \\n for newlines)"
}`;

        const messages = [{ role: "user", content: prompt }];

        try {
            const response = await this.callLLM(messages);
            const parsed = this.parseResponseObject(response);
            if (!parsed || typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
                // Fallback if JSON parsing fails
                return {
                    subject: `Regarding ${jobDescription.title} position`,
                    body: response // Return raw response as body if not JSON
                };
            }
            return {
                subject: parsed.subject as string,
                body: parsed.body as string
            };
        } catch (error) {
            logger.error("[AI Outreach] Error", error, { service: "ai-matching" });
            throw error;
        }
    }

    /**
     * Build the prompt from request
     */
    private buildPrompt(
        resume: MatchingRequest["resume"],
        jobDescription: MatchingRequest["jobDescription"],
        prompt: ResumeAiPromptDocument,
        fieldUsagePolicy?: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides,
    ): string {
        const localeText = getResumeAiLocaleText(prompt.normalized.locale);
        const analysisResume = sanitizeResumeRecordForSurface({ ...resume }, "analysis", fieldUsagePolicy);
        const matchingRules = jobDescription.responsibilities || jobDescription.requirements || "";
        const verifiedCompanies = Array.isArray(resume.companyHits) && analysisResume.companyHits !== undefined && resume.companyHits.length > 0
            ? resume.companyHits.join(", ")
            : localeText.noneLabel;
        const brandHitsText = buildBrandHitsPromptSegments({
            brandHits: analysisResume.brandHits !== undefined ? resume.brandHits : undefined,
            brandOrigin: resume.brandOrigin,
            productClass: resume.productClass,
        }).join(", ");
        const evidenceText = typeof resume.workHistory === "string" && analysisResume.workHistory !== undefined && resume.workHistory.trim().length > 0
            ? resume.workHistory
            : localeText.noWorkHistoryLabel;
        const roleSignals = formatRoleSignals(
            Array.isArray(resume.roleSignals) && analysisResume.roleSignals !== undefined ? resume.roleSignals : undefined,
            localeText,
        );
        const market = resolveResumeMarket(resume);

        return resumeAiPromptService.renderUserPromptTemplate(prompt.normalized.userPromptTemplate, {
            jobTitle: jobDescription.title,
            requirements: jobDescription.requirements,
            matchingRules,
            candidateName: typeof resume.name === "string" && analysisResume.name !== undefined && resume.name.trim().length > 0
                ? resume.name
                : localeText.emptyFieldLabel,
            verifiedCompanies,
            brandHits: brandHitsText.length > 0 ? brandHitsText : localeText.noneLabel,
            market,
            evidenceText,
            roleSignals,
            workExperience: String(typeof resume.workExperience === "number" && analysisResume.workExperience !== undefined ? resume.workExperience : 0),
            education: typeof resume.education === "string" && analysisResume.education !== undefined && resume.education.trim().length > 0
                ? resume.education
                : localeText.emptyFieldLabel,
            companies: Array.isArray(resume.companies) && analysisResume.companies !== undefined && resume.companies.length > 0
                ? resume.companies.join(", ")
                : localeText.emptyFieldLabel,
        });
    }

    private loadPromptForResume(
        resume: MatchingRequest["resume"],
        promptCache?: Map<string, ResumeAiPromptDocument>
    ): ResumeAiPromptDocument {
        const sourceKey = resume.sourceKey ?? "";
        const cached = promptCache?.get(sourceKey);
        if (cached) return cached;

        const aiOutputLocale = resolveAIOutputLocale({ sourceKey: resume.sourceKey });
        const prompt = resumeAiPromptService.loadPrompt(aiOutputLocale);
        promptCache?.set(sourceKey, prompt);
        return prompt;
    }

    /**
     * Call the LLM API
     */
    async callLLM(
        messages: Array<{ role: string; content: string }>
    ): Promise<string> {
        // Mock response for testing
        if (process.env.AI_MOCK_ENABLED === 'true') {
            return JSON.stringify({
                subject: "Regarding the Senior Frontend Engineer position",
                body: "Dear Candidate,\n\nWe are impressed by your extensive experience in React and TypeScript..."
            });
        }

        // Extract model name (remove provider prefix for some APIs)
        const modelParts = aiConfig.model.split("/");
        const modelName = modelParts.length > 1 ? modelParts.slice(1).join("/") : aiConfig.model;

        const requestBody = {
            model: modelName,
            messages,
            temperature: aiConfig.temperature,
            max_tokens: aiConfig.maxTokens,
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), aiConfig.timeout);

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: this.headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json() as {
                choices?: Array<{ message?: { content?: string }; text?: string }>;
            };

            // Extract content from OpenAI-compatible response
            const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
            if (!content) {
                throw new Error("No content in API response");
            }

            return content;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`Request timeout after ${aiConfig.timeout}ms`);
            }
            throw error;
        }
    }

    /**
     * Parse the LLM response into MatchingResult
     */
    private parseResponse(
        response: string,
        request: MatchingRequest,
        prompt?: ResumeAiPromptDocument,
    ): MatchingResult {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonText = response.trim();

            // Remove markdown code blocks if present
            if (jsonText.includes("```json")) {
                const start = jsonText.indexOf("```json") + 7;
                const end = jsonText.lastIndexOf("```");
                jsonText = jsonText.slice(start, end).trim();
            } else if (jsonText.includes("```")) {
                const start = jsonText.indexOf("```") + 3;
                const end = jsonText.lastIndexOf("```");
                jsonText = jsonText.slice(start, end).trim();
            }

            // Find JSON object in text
            const jsonStart = jsonText.indexOf("{");
            const jsonEnd = jsonText.lastIndexOf("}");
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
            }

            const parsed = this.parseResponseObject(jsonText);
            if (!parsed) {
                throw new Error("Unable to parse AI response as object");
            }

            // Validate and normalize
            const rawScore = this.parseScoreValue(parsed.score);
            const score = Math.max(0, Math.min(100, Number.isFinite(rawScore) ? rawScore : 0));
            const recommendation = this.normalizeRecommendation(
                typeof parsed.recommendation === "string" ? parsed.recommendation : undefined,
                score
            );
            const localeText = getResumeAiLocaleText(prompt?.normalized.locale);
            const breakdown = parseNumericBreakdown(parsed.breakdown);
            const market = resolveResumeMarket(request.resume);
            const llmRelatedExp = typeof breakdown?.related_exp === "number" ? breakdown.related_exp : undefined;
            const normalizedBreakdown = breakdown ? { ...breakdown } : undefined;

            let effectiveScore = score;
            let effectiveRecommendation = recommendation;

            if ((market === "MY" || market === "TH") && llmRelatedExp !== undefined) {
                const industryDb = computeDeterministicIndustryDb(request.resume);
                let effectiveRelatedExp = clamp(
                    llmRelatedExp,
                    0,
                    RELATED_EXP_CEILING_BY_RECOMMENDATION[recommendation],
                );
                const relatedExpArg = buildRelatedExpNormalizeArg(
                    request.resume,
                    request.jobDescription,
                    prompt?.normalized.locale,
                );

                if (relatedExpArg) {
                    const relatedExpEvidence = evaluateRelatedExpEvidence({
                        context: relatedExpArg.context,
                        llmRaw: llmRelatedExp,
                        llmRecommendation: recommendation,
                        ingestEvidence: relatedExpArg.ingestEvidence,
                    });
                    effectiveRelatedExp = relatedExpEvidence.effectiveRaw;
                }

                effectiveScore = computeFinalAiScore(effectiveRelatedExp, industryDb);
                if (recommendation === "no_match" && market !== "MY" && market !== "TH") {
                    effectiveScore = Math.min(effectiveScore, 39);
                }
                effectiveRecommendation = recommendationFromFinalAiScore(effectiveScore);

                if (normalizedBreakdown) {
                    normalizedBreakdown.related_exp = effectiveRelatedExp;
                    normalizedBreakdown.industry_db = industryDb;
                }
            }

            return {
                score: effectiveScore,
                recommendation: effectiveRecommendation,
                highlights: Array.isArray(parsed.highlights)
                    ? parsed.highlights.map((item) => String(item))
                    : [],
                concerns: Array.isArray(parsed.concerns)
                    ? parsed.concerns.map((item) => String(item))
                    : [],
                summary: typeof parsed.summary === "string" ? parsed.summary : localeText.noAnalysisResult,
                ...(normalizedBreakdown ? { breakdown: normalizedBreakdown } : {}),
                rawResponse: toStoredRawResponse(response),
                scoreSource: "ai",
            };
        } catch (error) {
            logger.error("[AI Matching] Parse error", error, { service: "ai-matching" });
            const localeText = getResumeAiLocaleText(prompt?.normalized.locale);
            return {
                score: 0,
                recommendation: "no_match",
                highlights: [],
                concerns: [localeText.parseErrorConcern],
                summary: localeText.parseErrorSummary,
                rawResponse: toStoredRawResponse(response),
                scoreSource: "ai",
            };
        }
    }

    private parseResponseObject(jsonText: string): Record<string, unknown> | null {
        const parsed = this.tryParseObject(jsonText);
        if (parsed) return parsed;

        const repaired = this.repairScoreField(jsonText);
        if (repaired !== jsonText) {
            const repairedParsed = this.tryParseObject(repaired);
            if (repairedParsed) return repairedParsed;
        }

        return null;
    }

    private tryParseObject(text: string): Record<string, unknown> | null {
        try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === "object") {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // noop
        }

        try {
            const parsed = JSON5.parse(text) as unknown;
            if (parsed && typeof parsed === "object") {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // noop
        }

        return null;
    }

    private repairScoreField(text: string): string {
        return text.replace(
            /("score"\s*:\s*)([A-Za-z\u4e00-\u9fa5][A-Za-z\u4e00-\u9fa5\s-]*)(\s*[,}\n])/gi,
            (_match, prefix: string, scoreToken: string, suffix: string) => {
                const score = this.parseScoreToken(scoreToken);
                if (score === null) {
                    return `${prefix}${scoreToken}${suffix}`;
                }
                return `${prefix}${score}${suffix}`;
            }
        );
    }

    private parseScoreValue(value: unknown): number {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === "string") {
            const tokenScore = this.parseScoreToken(value);
            if (tokenScore !== null) return tokenScore;
            const numeric = Number.parseInt(value, 10);
            return Number.isFinite(numeric) ? numeric : 0;
        }

        const numeric = Number.parseInt(String(value ?? "0"), 10);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    private parseScoreToken(token: string): number | null {
        const cleaned = token
            .trim()
            .toLowerCase()
            .replace(/^["']|["']$/g, "")
            .replace(/\.$/, "");

        if (!cleaned) return null;

        const numeric = Number.parseInt(cleaned, 10);
        if (Number.isFinite(numeric)) {
            return Math.max(0, Math.min(100, numeric));
        }

        if (SCORE_WORD_MAP[cleaned] !== undefined) {
            return SCORE_WORD_MAP[cleaned];
        }

        const compact = cleaned.replace(/\s+/g, "-");
        if (SCORE_WORD_MAP[compact] !== undefined) {
            return SCORE_WORD_MAP[compact];
        }

        const parts = compact.split("-");
        if (parts.length === 2) {
            const tens = SCORE_WORD_MAP[parts[0]];
            const ones = this.parseOneDigitWord(parts[1]);
            if (typeof tens === "number" && typeof ones === "number") {
                return Math.max(0, Math.min(100, tens + ones));
            }
        }

        return null;
    }

    private parseOneDigitWord(word: string): number | null {
        if (word === "one") return 1;
        if (word === "two") return 2;
        if (word === "three") return 3;
        if (word === "four") return 4;
        if (word === "five") return 5;
        if (word === "six") return 6;
        if (word === "seven") return 7;
        if (word === "eight") return 8;
        if (word === "nine") return 9;
        return null;
    }

    /**
     * Normalize recommendation based on score
     */
    private normalizeRecommendation(
        rec: string | undefined,
        score: number
    ): MatchingResult["recommendation"] {
        // If valid recommendation provided, use it
        const validRecs = ["strong_match", "match", "potential", "no_match"];
        if (rec && validRecs.includes(rec)) {
            return rec as MatchingResult["recommendation"];
        }

        // Otherwise derive from score
        if (score >= 90) return "strong_match";
        if (score >= 70) return "match";
        if (score >= 50) return "potential";
        return "no_match";
    }
}

// Singleton instance
export const aiMatchingService = new AIMatchingService();
