/**
 * Search Profile Service
 *
 * Loads and manages search profiles from config/search-profiles/*.yaml
 * Supports auto-matching JD based on keywords and filter preset application
 */

import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
        && !education
        && !locations
        && !salaryRange
    ) {
        return undefined;
    }

    return {
        minExperience,
        maxExperience,
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
            if (!type || enabled === undefined) return null;

            return {
                type,
                enabled,
                priority,
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

export class SearchProfileService {
    readonly projectRoot: string;
    private cache: Map<string, SearchProfile> = new Map();

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getProfilesDir(): string {
        return path.join(this.projectRoot, "config", "search-profiles");
    }

    private ensureProfilesDir(): void {
        const profilesDir = this.getProfilesDir();
        if (!fs.existsSync(profilesDir)) {
            fs.mkdirSync(profilesDir, { recursive: true });
        }
    }

    private getProfilePath(id: string): string {
        return path.join(this.getProfilesDir(), `${id}.yaml`);
    }

    private findExistingProfilePath(id: string): string | null {
        const profilesDir = this.getProfilesDir();
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

        const fallbackLocation = fallback?.location;
        const location = readString(record.location) ?? fallbackLocation ?? "";

        const inputKeywords = readStringArray(record.keywords);
        const keywords = normalizeKeywords(inputKeywords ?? fallback?.keywords ?? []);

        const inputStatus = readString(record.status);
        const status: SearchProfile["status"] =
            inputStatus === "paused" || inputStatus === "archived" || inputStatus === "active"
                ? inputStatus
                : (fallback?.status ?? "active");

        const description = readString(record.description) ?? fallback?.description;
        const createdAt = readString(record.createdAt) ?? fallback?.createdAt;
        const updatedAt = readString(record.updatedAt) ?? fallback?.updatedAt;

        const jobDescription = readString(record.jobDescription) ?? fallback?.jobDescription;
        const filterPreset = readString(record.filterPreset) ?? fallback?.filterPreset;

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
        if (!profile.location) {
            throw new Error("Profile location is required");
        }
        if (!Array.isArray(profile.keywords) || profile.keywords.length === 0) {
            throw new Error("Profile keywords must contain at least one value");
        }
    }

    private writeProfile(profile: SearchProfile): void {
        this.ensureProfilesDir();
        const filePath = this.getProfilePath(profile.id);
        const payload = stringifyYaml(profile, {
            lineWidth: 120,
            indent: 2,
            minContentWidth: 20,
        });
        fs.writeFileSync(filePath, payload, "utf8");
    }

    /**
     * List all profile files
     */
    listProfiles(): SearchProfileFile[] {
        const dir = this.getProfilesDir();
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
    loadProfile(id: string): SearchProfile {
        const normalizedId = normalizeProfileId(id);

        const cachedProfile = this.cache.get(normalizedId);
        if (cachedProfile) {
            return cachedProfile;
        }

        const existingPath = this.findExistingProfilePath(normalizedId);
        if (!existingPath) {
            const available = this.listProfiles().map((p) => p.id).join(", ");
            throw new DataNotFoundError(`Search profile not found: ${normalizedId}`, {
                suggestion: available ? `Available: ${available}` : "No search profiles available",
            });
        }

        const profile = this.readProfileFromFile(existingPath, normalizedId);
        this.cache.set(normalizedId, profile);
        return profile;
    }

    createProfile(input: unknown): SearchProfile {
        const provisional = this.coerceProfile(input);
        const derivedId = provisional.id !== "profile" ? provisional.id : normalizeProfileId(provisional.name);
        const profile = this.coerceProfile({ ...provisional, id: derivedId });
        this.ensureRequiredCoreFields(profile);

        if (this.findExistingProfilePath(profile.id)) {
            throw new Error(`Profile already exists: ${profile.id}`);
        }

        const now = new Date().toISOString();
        const profileToStore: SearchProfile = {
            ...profile,
            createdAt: profile.createdAt ?? now,
            updatedAt: now,
        };

        this.writeProfile(profileToStore);
        this.cache.set(profileToStore.id, profileToStore);
        return profileToStore;
    }

    updateProfile(id: string, updates: unknown): SearchProfile {
        const normalizedId = normalizeProfileId(id);
        const existing = this.loadProfile(normalizedId);

        const mergedInput: Record<string, unknown> = {
            ...existing,
            ...(isRecord(updates) ? updates : {}),
            id: normalizedId,
        };
        const profile = this.coerceProfile(mergedInput, existing);
        this.ensureRequiredCoreFields(profile);

        const now = new Date().toISOString();
        const profileToStore: SearchProfile = {
            ...profile,
            id: normalizedId,
            createdAt: existing.createdAt ?? profile.createdAt ?? now,
            updatedAt: now,
        };

        this.writeProfile(profileToStore);
        this.cache.set(normalizedId, profileToStore);
        return profileToStore;
    }

    deleteProfile(id: string): boolean {
        const normalizedId = normalizeProfileId(id);
        const existingPath = this.findExistingProfilePath(normalizedId);
        if (!existingPath) {
            return false;
        }

        fs.unlinkSync(existingPath);
        this.cache.delete(normalizedId);
        return true;
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
    findByKeywords(keywords: string[], location?: string): AutoMatchResult {
        const normalizedInputKeywords = normalizeKeywords(keywords.map((k) => k.toLowerCase()));
        if (normalizedInputKeywords.length === 0) {
            return {
                confidence: 0,
                matchedKeywords: [],
            };
        }

        const profiles = this.listProfiles().filter((p) => p.status === "active");

        let bestMatch: { profile: SearchProfile; score: number; matchedKeywords: string[] } | null = null;

        for (const profileFile of profiles) {
            const profile = this.loadProfile(profileFile.id);

            const profileKeywords = profile.keywords.map((k) => k.toLowerCase());
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

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get profile count
     */
    getStats(): { total: number; active: number; paused: number; archived: number } {
        const profiles = this.listProfiles();
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
