/**
 * Search Profile Service
 *
 * Normalizes, validates, and keyword-matches search profile payloads.
 */

import path from "node:path";

import { normalizeKeywordPhrases } from "@trends/shared";

import { findProjectRoot } from "./db.js";

// Types
export interface SearchProfile {
    id: string;
    name: string;
    description?: string;
    status: "active" | "paused" | "archived";
    createdAt?: string;
    updatedAt?: string;

    // Core inputs
    location: string;
    keywords: string[];
    requiredKeywords?: string[];

    // Auto-configured
    jobDescription?: string;
    filterPreset?: string;

    // Custom filters (override preset)
    filters?: {
        minExperience?: number;
        maxExperience?: number | null;
        minAge?: number;
        maxAge?: number;
        education?: string[];
        salaryRange?: {
            min?: number;
            max?: number;
            currency?: string;
            period?: string;
        };
        locations?: string[];
    };

    // Automation
    schedule?: {
        enabled: boolean;
        cron?: string;
        timezone?: string;
        maxCandidates?: number;
        notifyOnlyOnNew?: boolean;
    };

    // Sources
    sources?: Array<{
        type: string;
        enabled: boolean;
        priority?: number;
        jobUrl?: string;
        unsafeLimits?: boolean;
        job51CollectLimit?: number;
        job51MaxPages?: number;
        collectLimit?: number;
        maxPages?: number;
        mode?: string;
    }>;

    // Landing page quick start
    quickStart?: {
        enabled: boolean;
        rank?: number;
        label?: string;
        description?: string;
    };

    // Notifications
    notifications?: {
        enabled: boolean;
        channels?: Array<{
            type: string;
            enabled: boolean;
            webhook?: string;
            recipients?: string[];
        }>;
        triggers?: Array<{
            event: string;
            threshold?: number;
            time?: string;
            day?: string;
            channels?: string[];
        }>;
    };

    // AI pipeline
    ai?: {
        pipeline?: Array<{
            stage: string;
            model: string;
            threshold?: number;
            batchSize?: number;
            topPercent?: number;
        }>;
        generateOutreach?: boolean;
        outreachTemplate?: string;
    };

    // Session
    session?: {
        scope?: string;
        resetTriggers?: string[];
        retention?: {
            mode?: string;
            archiveAfterDays?: number;
        };
    };
}

export interface AutoMatchResult {
    profile?: SearchProfile;
    jobDescription?: string;
    filterPreset?: string;
    confidence: number;
    matchedKeywords: string[];
}

type ProfileFilters = NonNullable<SearchProfile["filters"]>;
type ProfileSalaryRange = NonNullable<ProfileFilters["salaryRange"]>;
type ProfileQuickStart = NonNullable<SearchProfile["quickStart"]>;
type ProfileSession = NonNullable<SearchProfile["session"]>;
type ProfileRetention = NonNullable<ProfileSession["retention"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function readString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    return normalized ? normalized : undefined;
}

function readOptionalStringField(
    record: Record<string, unknown>,
    key: string,
    fallback?: string
): string | undefined {
    if (!hasOwn(record, key)) {
        return fallback;
    }
    return readString(record[key]);
}

function readClearableStringField(
    record: Record<string, unknown>,
    key: string,
    fallback = ""
): string {
    if (!hasOwn(record, key)) {
        return fallback;
    }
    if (typeof record[key] !== "string") {
        return "";
    }
    return record[key].trim();
}

function readBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const normalized = value
        .map((item) => readString(item))
        .filter((item): item is string => Boolean(item));

    return normalized.length > 0 ? normalized : undefined;
}

function normalizeKeywords(keywords: string[]): string[] {
    return normalizeKeywordPhrases(keywords);
}

function normalizeKeywordFingerprints(keywords: string[]): string[] {
    return normalizeKeywords(keywords).map((keyword) => keyword.toLowerCase());
}

export function matchSearchProfilesByKeywords(
    profiles: SearchProfile[],
    keywords: string[],
    location?: string
): AutoMatchResult {
    const normalizedInputKeywords = normalizeKeywordFingerprints(keywords);
    if (normalizedInputKeywords.length === 0) {
        return {
            confidence: 0,
            matchedKeywords: [],
        };
    }

    let bestMatch: { profile: SearchProfile; score: number; matchedKeywords: string[] } | null = null;

    for (const profile of profiles) {
        if (profile.status !== "active") {
            continue;
        }

        const profileKeywords = normalizeKeywordFingerprints(profile.keywords);
        const matchedKeywords = normalizedInputKeywords.filter((keyword) =>
            profileKeywords.some((profileKeyword) => profileKeyword.includes(keyword) || keyword.includes(profileKeyword))
        );
        let score = matchedKeywords.length / normalizedInputKeywords.length;

        if (location && profile.location) {
            const profileLocation = profile.location.toLowerCase();
            const inputLocation = location.toLowerCase();
            if (profileLocation.includes(inputLocation) || inputLocation.includes(profileLocation)) {
                score += 0.2;
            }
        }

        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { profile, score, matchedKeywords };
        }
    }

    if (bestMatch && bestMatch.score > 0.3) {
        return {
            profile: bestMatch.profile,
            jobDescription: bestMatch.profile.jobDescription,
            filterPreset: bestMatch.profile.filterPreset,
            confidence: Math.min(bestMatch.score, 1),
            matchedKeywords: bestMatch.matchedKeywords,
        };
    }

    return {
        confidence: 0,
        matchedKeywords: [],
    };
}

function normalizeProfileId(rawId: string): string {
    const normalized = rawId
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized || "profile";
}

function parseFilters(value: unknown): SearchProfile["filters"] | undefined {
    if (!isRecord(value)) return undefined;

    const minExperience = readNumber(value.minExperience);
    const maxExperienceRaw = value.maxExperience;
    const maxExperience = maxExperienceRaw === null ? null : readNumber(maxExperienceRaw);
    const minAge = readNumber(value.minAge);
    const maxAge = readNumber(value.maxAge);
    const education = readStringArray(value.education);
    const locations = readStringArray(value.locations);

    let salaryRange: ProfileSalaryRange | undefined;
    if (isRecord(value.salaryRange)) {
        const min = readNumber(value.salaryRange.min);
        const max = readNumber(value.salaryRange.max);
        const currency = readString(value.salaryRange.currency);
        const period = readString(value.salaryRange.period);

        if (min !== undefined || max !== undefined || currency || period) {
            salaryRange = {
                min,
                max,
                currency,
                period,
            };
        }
    }

    if (
        minExperience === undefined
        && maxExperience === undefined
        && maxExperienceRaw !== null
        && minAge === undefined
        && maxAge === undefined
        && !education
        && !locations
        && !salaryRange
    ) {
        return undefined;
    }

    return {
        minExperience,
        maxExperience,
        minAge,
        maxAge,
        education,
        salaryRange,
        locations,
    };
}

function parseSchedule(value: unknown): SearchProfile["schedule"] | undefined {
    if (!isRecord(value)) return undefined;

    const enabled = readBoolean(value.enabled) ?? false;
    const cron = readString(value.cron);
    const timezone = readString(value.timezone);
    const maxCandidates = readNumber(value.maxCandidates);
    const notifyOnlyOnNew = readBoolean(value.notifyOnlyOnNew);

    if (!enabled && !cron && !timezone && maxCandidates === undefined && notifyOnlyOnNew === undefined) {
        return undefined;
    }

    return {
        enabled,
        cron,
        timezone,
        maxCandidates,
        notifyOnlyOnNew,
    };
}

function parseSources(value: unknown): SearchProfile["sources"] | undefined {
    if (!Array.isArray(value)) return undefined;

    const sources = value
        .map((item) => {
            if (!isRecord(item)) return null;
            const type = readString(item.type);
            const enabled = readBoolean(item.enabled);
            const priority = readNumber(item.priority);
            const jobUrl = readString(item.jobUrl);
            const unsafeLimits = readBoolean(item.unsafeLimits);
            const job51CollectLimit = readNumber(item.job51CollectLimit);
            const job51MaxPages = readNumber(item.job51MaxPages);
            const collectLimit = readNumber(item.collectLimit);
            const maxPages = readNumber(item.maxPages);
            const mode = readString(item.mode);
            if (!type || enabled === undefined) return null;

            return {
                type,
                enabled,
                priority,
                jobUrl,
                ...(unsafeLimits === true ? { unsafeLimits: true } : {}),
                ...(typeof job51CollectLimit === "number" ? { job51CollectLimit } : {}),
                ...(typeof job51MaxPages === "number" ? { job51MaxPages } : {}),
                ...(typeof collectLimit === "number" ? { collectLimit } : {}),
                ...(typeof maxPages === "number" ? { maxPages } : {}),
                ...(mode !== undefined ? { mode } : {}),
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    return sources.length > 0 ? sources : undefined;
}

function parseQuickStart(value: unknown): SearchProfile["quickStart"] | undefined {
    if (!isRecord(value)) return undefined;

    const enabled = readBoolean(value.enabled) ?? false;
    const rank = readNumber(value.rank);
    const label = readString(value.label);
    const description = readString(value.description);

    if (!enabled && rank === undefined && !label && !description) {
        return undefined;
    }

    const quickStart: ProfileQuickStart = {
        enabled,
        rank,
        label,
        description,
    };

    return quickStart;
}

function parseNotifications(value: unknown): SearchProfile["notifications"] | undefined {
    if (!isRecord(value)) return undefined;

    const enabled = readBoolean(value.enabled) ?? false;

    const channels = Array.isArray(value.channels)
        ? value.channels
            .map((item) => {
                if (!isRecord(item)) return null;
                const type = readString(item.type);
                const channelEnabled = readBoolean(item.enabled);
                const webhook = readString(item.webhook);
                const recipients = readStringArray(item.recipients);
                if (!type || channelEnabled === undefined) return null;

                return {
                    type,
                    enabled: channelEnabled,
                    webhook,
                    recipients,
                };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : undefined;

    const triggers = Array.isArray(value.triggers)
        ? value.triggers
            .map((item) => {
                if (!isRecord(item)) return null;
                const event = readString(item.event);
                const threshold = readNumber(item.threshold);
                const time = readString(item.time);
                const day = readString(item.day);
                const triggerChannels = readStringArray(item.channels);
                if (!event) return null;

                return {
                    event,
                    threshold,
                    time,
                    day,
                    channels: triggerChannels,
                };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : undefined;

    if (!enabled && !channels && !triggers) {
        return undefined;
    }

    return {
        enabled,
        channels,
        triggers,
    };
}

function parseAiConfig(value: unknown): SearchProfile["ai"] | undefined {
    if (!isRecord(value)) return undefined;

    const pipeline = Array.isArray(value.pipeline)
        ? value.pipeline
            .map((item) => {
                if (!isRecord(item)) return null;
                const stage = readString(item.stage);
                const model = readString(item.model);
                const threshold = readNumber(item.threshold);
                const batchSize = readNumber(item.batchSize);
                const topPercent = readNumber(item.topPercent);
                if (!stage || !model) return null;

                return {
                    stage,
                    model,
                    threshold,
                    batchSize,
                    topPercent,
                };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
        : undefined;

    const generateOutreach = readBoolean(value.generateOutreach);
    const outreachTemplate = readString(value.outreachTemplate);

    if (!pipeline && generateOutreach === undefined && !outreachTemplate) {
        return undefined;
    }

    return {
        pipeline,
        generateOutreach,
        outreachTemplate,
    };
}

function parseSession(value: unknown): SearchProfile["session"] | undefined {
    if (!isRecord(value)) return undefined;

    const scope = readString(value.scope);
    const resetTriggers = readStringArray(value.resetTriggers);

    let retention: ProfileRetention | undefined;
    if (isRecord(value.retention)) {
        const mode = readString(value.retention.mode);
        const archiveAfterDays = readNumber(value.retention.archiveAfterDays);
        if (mode || archiveAfterDays !== undefined) {
            retention = {
                mode,
                archiveAfterDays,
            };
        }
    }

    if (!scope && !resetTriggers && !retention) {
        return undefined;
    }

    return {
        scope,
        resetTriggers,
        retention,
    };
}

function isSeekRecommendedCandidatesUrl(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.hostname.toLowerCase().endsWith(".employer.seek.com")
            && url.pathname.replace(/\/+$/, "") === "/candidates/recommended";
    } catch {
        return false;
    }
}

export class SearchProfileService {
    readonly projectRoot: string;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private coerceProfile(input: unknown, fallback?: SearchProfile): SearchProfile {
        const record = isRecord(input) ? input : {};

        const fallbackId = fallback?.id;
        const inputId = readString(record.id);
        const id = normalizeProfileId(inputId ?? fallbackId ?? "profile");

        const fallbackName = fallback?.name;
        const name = readString(record.name) ?? fallbackName ?? id;

        const fallbackLocation = fallback?.location ?? "";
        const location = readClearableStringField(record, "location", fallbackLocation);

        const inputKeywords = readStringArray(record.keywords);
        const keywords = normalizeKeywords(inputKeywords ?? fallback?.keywords ?? []);

        const inputRequiredKeywords = readStringArray(record.requiredKeywords ?? record.required_keywords);
        const requiredKeywordSource = inputRequiredKeywords ?? fallback?.requiredKeywords;
        const requiredKeywords = requiredKeywordSource !== undefined
            ? normalizeKeywords(requiredKeywordSource)
            : undefined;

        const inputStatus = readString(record.status);
        const status: SearchProfile["status"] =
            inputStatus === "paused" || inputStatus === "archived" || inputStatus === "active"
                ? inputStatus
                : (fallback?.status ?? "active");

        const description = readOptionalStringField(record, "description", fallback?.description);
        const createdAt = readString(record.createdAt) ?? fallback?.createdAt;
        const updatedAt = readString(record.updatedAt) ?? fallback?.updatedAt;

        const jobDescription = readOptionalStringField(record, "jobDescription", fallback?.jobDescription);
        const filterPreset = readOptionalStringField(record, "filterPreset", fallback?.filterPreset);

        const filters = hasOwn(record, "filters") ? parseFilters(record.filters) : fallback?.filters;
        const schedule = hasOwn(record, "schedule") ? parseSchedule(record.schedule) : fallback?.schedule;
        const sources = hasOwn(record, "sources") ? parseSources(record.sources) : fallback?.sources;
        const quickStart = hasOwn(record, "quickStart") ? parseQuickStart(record.quickStart) : fallback?.quickStart;
        const notifications = hasOwn(record, "notifications")
            ? parseNotifications(record.notifications)
            : fallback?.notifications;
        const ai = hasOwn(record, "ai") ? parseAiConfig(record.ai) : fallback?.ai;
        const session = hasOwn(record, "session") ? parseSession(record.session) : fallback?.session;

        return {
            id,
            name,
            description,
            status,
            createdAt,
            updatedAt,
            location,
            keywords,
            ...(requiredKeywords !== undefined && { requiredKeywords }),
            jobDescription,
            filterPreset,
            filters,
            schedule,
            sources,
            quickStart,
            notifications,
            ai,
            session,
        };
    }

    private ensureRequiredCoreFields(profile: SearchProfile): void {
        if (!profile.id) {
            throw new Error("Profile id is required");
        }
        if (!profile.name) {
            throw new Error("Profile name is required");
        }
        if (!Array.isArray(profile.keywords) || profile.keywords.length === 0) {
            throw new Error("Profile keywords must contain at least one value");
        }
    }

    normalizeProfileInput(input: unknown, fallback?: SearchProfile): SearchProfile {
        return this.coerceProfile(input, fallback);
    }

    normalizeProfileIdentifier(id: string): string {
        return normalizeProfileId(id);
    }

    validateProfile(profile: SearchProfile): void {
        this.ensureRequiredCoreFields(profile);

        const invalidSeekSource = profile.sources?.find((source) => (
            source.type === "seek"
            && source.enabled
            && !isSeekRecommendedCandidatesUrl(source.jobUrl)
        ));
        if (invalidSeekSource) {
            throw new Error("Enabled Seek source requires an exact Seek recommended candidates URL");
        }
    }

}

// Singleton
export const searchProfileService = new SearchProfileService();
