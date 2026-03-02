/**
 * Filter Preset Service
 * 
 * Loads and manages filter presets from config/resume/filter-presets.json5
 */

import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { findProjectRoot } from "./db.js";

// Types
export interface FilterPreset {
    id: string;
    name: string;
    category: string;
    filters: {
        minExperience?: number;
        maxExperience?: number | null;
        education?: string[];
        salaryRange?: { min?: number; max?: number };
    };
}

export interface PresetCategory {
    id: string;
    name: string;
    icon?: string;
}

export interface FilterPresetsConfig {
    presets: FilterPreset[];
    categories: PresetCategory[];
}

export class FilterPresetService {
    readonly projectRoot: string;
    private cache: FilterPresetsConfig | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getConfigPath(): string {
        return path.join(this.projectRoot, "config", "resume", "filter-presets.json5");
    }

    /**
     * Load presets from config file
     */
    private loadConfig(): FilterPresetsConfig {
        if (this.cache) return this.cache;

        const configPath = this.getConfigPath();
        if (!fs.existsSync(configPath)) {
            return { presets: [], categories: [] };
        }

        const content = fs.readFileSync(configPath, "utf8");
        this.cache = JSON5.parse(content) as FilterPresetsConfig;
        return this.cache;
    }

    /**
     * List all presets
     */
    listPresets(category?: string): FilterPreset[] {
        const config = this.loadConfig();
        if (category) {
            return config.presets.filter((p) => p.category === category);
        }
        return config.presets;
    }

    /**
     * Get preset by ID
     */
    getPreset(id: string): FilterPreset | undefined {
        const config = this.loadConfig();
        return config.presets.find((p) => p.id === id);
    }

    /**
     * List categories
     */
    listCategories(): PresetCategory[] {
        const config = this.loadConfig();
        return config.categories;
    }

    /**
     * Get stats
     */
    getStats(): { total: number; byCategory: Record<string, number> } {
        const config = this.loadConfig();
        const byCategory: Record<string, number> = {};
        for (const preset of config.presets) {
            byCategory[preset.category] = (byCategory[preset.category] || 0) + 1;
        }
        return { total: config.presets.length, byCategory };
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache = null;
    }
}

// Singleton
export const filterPresetService = new FilterPresetService();
