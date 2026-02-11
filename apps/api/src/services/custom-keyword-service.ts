import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { findProjectRoot } from "./db.js";

export interface CustomKeywordTag {
    id: string;
    keyword: string;
    english?: string;
    category: string;
}

export interface CustomKeywordCategory {
    id: string;
    name: string;
    icon?: string;
}

export interface CustomKeywordsConfig {
    tags: CustomKeywordTag[];
    categories: CustomKeywordCategory[];
}

const DEFAULT_CATEGORIES: CustomKeywordCategory[] = [
    { id: "custom", name: "自定义", icon: "⚙️" },
];

function normalizeConfig(raw: unknown): CustomKeywordsConfig {
  if (!raw || typeof raw !== "object") {
    return { tags: [], categories: [...DEFAULT_CATEGORIES] };
  }

    const data = raw as {
        tags?: unknown[];
        categories?: unknown[];
    };

    const tags: CustomKeywordTag[] = [];
    if (Array.isArray(data.tags)) {
        for (const item of data.tags) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id.trim() : "";
            const keyword = typeof record.keyword === "string" ? record.keyword.trim() : "";
            const category = typeof record.category === "string" ? record.category.trim() : "";
            if (!id || !keyword || !category) {
                continue;
            }

            const english = typeof record.english === "string" && record.english.trim()
                ? record.english.trim()
                : undefined;
            const tag: CustomKeywordTag = { id, keyword, category };
            if (english) {
                tag.english = english;
            }
            tags.push(tag);
        }
    }

    const categories: CustomKeywordCategory[] = [];
    if (Array.isArray(data.categories)) {
        for (const item of data.categories) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id.trim() : "";
            const name = typeof record.name === "string" ? record.name.trim() : "";
            if (!id || !name) {
                continue;
            }

            const icon = typeof record.icon === "string" && record.icon.trim()
                ? record.icon.trim()
                : undefined;
            const category: CustomKeywordCategory = { id, name };
            if (icon) {
                category.icon = icon;
            }
            categories.push(category);
        }
    }

    if (categories.length === 0) {
        return { tags, categories: [...DEFAULT_CATEGORIES] };
    }

    return { tags, categories };
}

export class CustomKeywordService {
    readonly projectRoot: string;
    private cache: CustomKeywordsConfig | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getConfigPath(): string {
        return path.join(this.projectRoot, "config", "resume", "custom-keywords.json5");
    }

    private loadConfig(): CustomKeywordsConfig {
        if (this.cache) return this.cache;

        const configPath = this.getConfigPath();
        if (!fs.existsSync(configPath)) {
            const fallback = { tags: [], categories: [...DEFAULT_CATEGORIES] };
            this.cache = fallback;
            return fallback;
        }

        const content = fs.readFileSync(configPath, "utf8");
        const parsed = JSON5.parse(content) as unknown;
        this.cache = normalizeConfig(parsed);
        return this.cache;
    }

    saveConfig(config: CustomKeywordsConfig): void {
        const normalized = normalizeConfig(config);
        const configPath = this.getConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), "utf8");
        this.cache = normalized;
    }

    listTags(category?: string): CustomKeywordTag[] {
        const config = this.loadConfig();
        if (!category) return config.tags;
        return config.tags.filter((tag) => tag.category === category);
    }

    getTag(id: string): CustomKeywordTag | undefined {
        const config = this.loadConfig();
        return config.tags.find((tag) => tag.id === id);
    }

    addTag(tag: CustomKeywordTag): void {
        const config = this.loadConfig();
        config.tags.push(tag);
        this.saveConfig(config);
    }

    updateTag(id: string, updates: Partial<CustomKeywordTag>): CustomKeywordTag | undefined {
        const config = this.loadConfig();
        const index = config.tags.findIndex((tag) => tag.id === id);
        if (index === -1) {
            return undefined;
        }

        const nextTag: CustomKeywordTag = {
            ...config.tags[index],
            ...updates,
            id: config.tags[index].id,
        };

        if (!nextTag.keyword.trim() || !nextTag.category.trim()) {
            return undefined;
        }

        config.tags[index] = {
            ...nextTag,
            keyword: nextTag.keyword.trim(),
            english: nextTag.english?.trim() || undefined,
            category: nextTag.category.trim(),
        };
        this.saveConfig(config);
        return config.tags[index];
    }

    deleteTag(id: string): boolean {
        const config = this.loadConfig();
        const before = config.tags.length;
        config.tags = config.tags.filter((tag) => tag.id !== id);
        if (config.tags.length === before) {
            return false;
        }
        this.saveConfig(config);
        return true;
    }

    listCategories(): CustomKeywordCategory[] {
        const config = this.loadConfig();
        return config.categories;
    }

    clearCache(): void {
        this.cache = null;
    }
}

export const customKeywordService = new CustomKeywordService();
