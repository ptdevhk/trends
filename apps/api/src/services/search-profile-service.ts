/**
 * Search Profile Service
 *
 * Loads and manages search profiles from config/search-profiles/*.yaml
 * Supports auto-matching JD based on keywords and filter preset application
 */

import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { findProjectRoot } from "./db.js";
import { DataNotFoundError } from "./errors.js";

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
    }>;

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

export interface SearchProfileFile {
    id: string;
    name: string;
    filename: string;
    updatedAt: string;
    status: "active" | "paused" | "archived";
    location: string;
    keywords: string[];
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
    return Array.from(
        new Set(
            keywords
                .map((keyword) => keyword.trim())
                .filter((keyword) => keyword.length > 0)
        )
    );
}

export function matchSearchProfilesByKeywords(
    profiles: SearchProfile[],
    keywords: string[],
    location?: string
): AutoMatchResult {
    const normalizedInputKeywords = normalizeKeywords(keywords.map((keyword) => keyword.toLowerCase()));
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

        const profileKeywords = profile.keywords.map((keyword) => keyword.toLowerCase());
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

const DEFAULT_WORKSPACE_SLUG = "dev";

function normalizeWorkspaceSlug(rawSlug?: string): string {
    const normalized = rawSlug?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
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
            if (!type || enabled === undefined) return null;

            return {
                type,
                enabled,
                priority,
                jobUrl,
            };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    return sources.length > 0 ? sources : undefined;
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
    private cache: Map<string, SearchProfile> = new Map();

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getProfilesBaseDir(): string {
        return path.join(this.projectRoot, "config", "search-profiles");
    }

    private getProfilesDir(workspaceSlug?: string): string {
        const normalizedWorkspace = normalizeWorkspaceSlug(workspaceSlug);
        const baseDir = this.getProfilesBaseDir();
        if (normalizedWorkspace === DEFAULT_WORKSPACE_SLUG) {
            return baseDir;
        }
        return path.join(baseDir, normalizedWorkspace);
    }

    private findExistingProfilePath(id: string, workspaceSlug?: string): string | null {
        const profilesDir = this.getProfilesDir(workspaceSlug);
        const candidates = [
            path.join(profilesDir, `${id}.yaml`),
            path.join(profilesDir, `${id}.yml`),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
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
            jobDescription,
            filterPreset,
            filters,
            schedule,
            sources,
            notifications,
            ai,
            session,
        };
    }

    private readProfileFromFile(filePath: string, fallbackId: string): SearchProfile {
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = parseYaml(content);
        const fallback: SearchProfile = {
            id: fallbackId,
            name: fallbackId,
            status: "active",
            location: "",
            keywords: [],
        };
        const profile = this.coerceProfile(parsed, fallback);
        profile.id = normalizeProfileId(profile.id || fallbackId);
        return profile;
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

    private getCacheKey(workspaceSlug: string, profileId: string): string {
        return `${workspaceSlug}:${profileId}`;
    }

    /**
     * List all profile files
     */
    listProfiles(workspaceSlug?: string): SearchProfileFile[] {
        const dir = this.getProfilesDir(workspaceSlug);
        if (!fs.existsSync(dir)) return [];

        const entries = fs.readdirSync(dir)
            .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
            .map((filename) => {
                const filePath = path.join(dir, filename);
                const stat = fs.statSync(filePath);
                const fallbackId = filename.replace(/\.(yaml|yml)$/i, "");
                const profile = this.readProfileFromFile(filePath, fallbackId);

                return {
                    id: profile.id,
                    name: profile.name,
                    filename,
                    updatedAt: stat.mtime.toISOString(),
                    status: profile.status,
                    location: profile.location,
                    keywords: profile.keywords,
                } satisfies SearchProfileFile;
            });

        return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    /**
     * Load a single profile by ID
     */
    loadProfile(id: string, workspaceSlug?: string): SearchProfile {
        const normalizedWorkspace = normalizeWorkspaceSlug(workspaceSlug);
        const normalizedId = normalizeProfileId(id);
        const cacheKey = this.getCacheKey(normalizedWorkspace, normalizedId);

        const cachedProfile = this.cache.get(cacheKey);
        if (cachedProfile) {
            return cachedProfile;
        }

        const existingPath = this.findExistingProfilePath(normalizedId, normalizedWorkspace);
        if (!existingPath) {
            const available = this.listProfiles(normalizedWorkspace).map((p) => p.id).join(", ");
            throw new DataNotFoundError(`Search profile not found: ${normalizedId}`, {
                suggestion: available ? `Available: ${available}` : "No search profiles available",
            });
        }

        const profile = this.readProfileFromFile(existingPath, normalizedId);
        this.cache.set(cacheKey, profile);
        return profile;
    }

    /**
     * Get effective filters (merge preset with custom filters)
     */
    getEffectiveFilters(profile: SearchProfile, presets: Record<string, unknown>): SearchProfile["filters"] {
        const preset = profile.filterPreset ? presets[profile.filterPreset] : undefined;

        return {
            ...(isRecord(preset) ? parseFilters(preset) : {}),
            ...profile.filters,
        };
    }

    /**
     * Find profile by keywords (auto-match)
     */
    findByKeywords(keywords: string[], location?: string, workspaceSlug?: string): AutoMatchResult {
        const normalizedWorkspace = normalizeWorkspaceSlug(workspaceSlug);
        const profiles = this.listProfiles(normalizedWorkspace)
            .filter((p) => p.status === "active")
            .map((profileFile) => this.loadProfile(profileFile.id, normalizedWorkspace));

        return matchSearchProfilesByKeywords(profiles, keywords, location);
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get profile count
     */
    getStats(workspaceSlug?: string): { total: number; active: number; paused: number; archived: number } {
        const profiles = this.listProfiles(workspaceSlug);
        return {
            total: profiles.length,
            active: profiles.filter((p) => p.status === "active").length,
            paused: profiles.filter((p) => p.status === "paused").length,
            archived: profiles.filter((p) => p.status === "archived").length,
        };
    }
}

// Singleton
export const searchProfileService = new SearchProfileService();
