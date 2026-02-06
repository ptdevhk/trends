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

export class SearchProfileService {
    readonly projectRoot: string;
    private cache: Map<string, SearchProfile> = new Map();

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getProfilesDir(): string {
        return path.join(this.projectRoot, "config", "search-profiles");
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
                const content = fs.readFileSync(filePath, "utf8");
                const profile = parseYaml(content) as Partial<SearchProfile>;

                return {
                    id: profile.id || filename.replace(/\.(yaml|yml)$/i, ""),
                    name: profile.name || filename,
                    filename,
                    updatedAt: stat.mtime.toISOString(),
                    status: profile.status || "active",
                    location: profile.location || "",
                    keywords: profile.keywords || [],
                } satisfies SearchProfileFile;
            });

        return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    /**
     * Load a single profile by ID
     */
    loadProfile(id: string): SearchProfile {
        // Check cache
        if (this.cache.has(id)) {
            return this.cache.get(id)!;
        }

        const dir = this.getProfilesDir();

        // Try different file extensions
        const possibleFiles = [
            `${id}.yaml`,
            `${id}.yml`,
        ];

        for (const filename of possibleFiles) {
            const filePath = path.join(dir, filename);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf8");
                const profile = parseYaml(content) as SearchProfile;
                profile.id = profile.id || id;

                // Cache it
                this.cache.set(id, profile);
                return profile;
            }
        }

        // Not found
        const available = this.listProfiles().map((p) => p.id).join(", ");
        throw new DataNotFoundError(`Search profile not found: ${id}`, {
            suggestion: available ? `Available: ${available}` : "No search profiles available",
        });
    }

    /**
     * Get effective filters (merge preset with custom filters)
     */
    getEffectiveFilters(profile: SearchProfile, presets: Record<string, unknown>): SearchProfile["filters"] {
        const preset = profile.filterPreset ? presets[profile.filterPreset] : undefined;

        // Start with preset, then override with profile filters
        return {
            ...(preset as SearchProfile["filters"] || {}),
            ...profile.filters,
        };
    }

    /**
     * Find profile by keywords (auto-match)
     */
    findByKeywords(keywords: string[], location?: string): AutoMatchResult {
        const profiles = this.listProfiles().filter((p) => p.status === "active");

        let bestMatch: { profile: SearchProfile; score: number; matchedKeywords: string[] } | null = null;

        for (const profileFile of profiles) {
            const profile = this.loadProfile(profileFile.id);

            // Calculate match score
            const profileKeywords = profile.keywords.map((k) => k.toLowerCase());
            const inputKeywords = keywords.map((k) => k.toLowerCase());

            const matchedKeywords = inputKeywords.filter((k) =>
                profileKeywords.some((pk) => pk.includes(k) || k.includes(pk))
            );

            let score = matchedKeywords.length / inputKeywords.length;

            // Bonus for location match
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
