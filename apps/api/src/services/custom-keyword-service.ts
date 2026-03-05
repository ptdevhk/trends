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

export type SystemLocationLevel = "province" | "city";

export interface SystemLocationItem {
    id: string;
    keyword: string;
    level: SystemLocationLevel;
    parentKeyword?: string;
    visible: boolean;
}

export interface CustomKeywordsConfig {
    tags: CustomKeywordTag[];
    categories: CustomKeywordCategory[];
    systemLocations: SystemLocationItem[];
}

const DEFAULT_CATEGORIES: CustomKeywordCategory[] = [
    { id: "custom", name: "自定义", icon: "⚙️" },
];

const LOCATION_GROUP_EXCLUDES = new Set(["热门城市", "直辖市", "国外", "其他"]);
const LOCATION_NAME_EXCLUDES = new Set(["国外", "其他"]);
const DEFAULT_VISIBLE_CITIES = new Set([
    "东莞",
    "深圳",
    "广州",
    "佛山",
    "惠州",
    "苏州",
    "无锡",
    "常州",
    "昆山",
    "上海",
    "北京",
    "天津",
    "重庆",
    "南京",
    "宁波",
    "杭州",
]);

type Job5156CityNode = {
    name?: unknown;
};

type Job5156ProvinceNode = {
    name?: unknown;
    cities?: unknown;
};

type Job5156LocationSnapshot = {
    tree?: unknown;
};

function normalizeKeyword(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function createSystemLocationId(level: SystemLocationLevel, keyword: string): string {
    return `job5156:${level}:${encodeURIComponent(keyword)}`;
}

function parseSystemLocationItem(value: unknown): SystemLocationItem | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const keyword = normalizeKeyword(record.keyword);
    const level = record.level === "province" || record.level === "city" ? record.level : null;
    const visible = typeof record.visible === "boolean" ? record.visible : null;
    if (!id || !keyword || !level || visible === null) {
        return null;
    }

    const parentKeyword = normalizeKeyword(record.parentKeyword) || undefined;
    return { id, keyword, level, parentKeyword, visible };
}

function normalizeConfig(raw: unknown): CustomKeywordsConfig {
  if (!raw || typeof raw !== "object") {
    return { tags: [], categories: [...DEFAULT_CATEGORIES], systemLocations: [] };
  }

    const data = raw as {
        tags?: unknown[];
        categories?: unknown[];
        systemLocations?: unknown[];
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
        const parsedSystemLocations = Array.isArray(data.systemLocations)
            ? data.systemLocations
                .map((item) => parseSystemLocationItem(item))
                .filter((item): item is SystemLocationItem => item !== null)
            : [];
        return { tags, categories: [...DEFAULT_CATEGORIES], systemLocations: parsedSystemLocations };
    }

    const systemLocations = Array.isArray(data.systemLocations)
        ? data.systemLocations
            .map((item) => parseSystemLocationItem(item))
            .filter((item): item is SystemLocationItem => item !== null)
        : [];

    return { tags, categories, systemLocations };
}

export class CustomKeywordService {
    readonly projectRoot: string;
    private cache: CustomKeywordsConfig | null = null;
    private cacheMtimeMs: number | null = null;
    private locationSnapshotMtimeMs: number | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getConfigPath(): string {
        return path.join(this.projectRoot, "config", "resume", "custom-keywords.json5");
    }

    private getLocationSnapshotPath(): string {
        return path.join(this.projectRoot, "output", "resumes", "location-info", "job5156-location-info.json");
    }

    private getConfigMtime(configPath: string): number | null {
        if (!fs.existsSync(configPath)) {
            return null;
        }
        return fs.statSync(configPath).mtimeMs;
    }

    private loadSystemLocationsFromSnapshot(): SystemLocationItem[] {
        const snapshotPath = this.getLocationSnapshotPath();
        if (!fs.existsSync(snapshotPath)) {
            return [];
        }

        try {
            const content = fs.readFileSync(snapshotPath, "utf8");
            const parsed = JSON.parse(content) as Job5156LocationSnapshot;
            const rawTree = Array.isArray(parsed.tree) ? parsed.tree : [];
            const tree = rawTree.filter((item): item is Job5156ProvinceNode => Boolean(item) && typeof item === "object");

            const hotCitiesGroup = tree.find((item) => normalizeKeyword(item.name) === "热门城市");
            const hotCityNames = new Set<string>();
            if (hotCitiesGroup && Array.isArray(hotCitiesGroup.cities)) {
                for (const rawCity of hotCitiesGroup.cities) {
                    if (!rawCity || typeof rawCity !== "object") {
                        continue;
                    }
                    const city = rawCity as Job5156CityNode;
                    const cityName = normalizeKeyword(city.name);
                    if (!cityName || LOCATION_NAME_EXCLUDES.has(cityName)) {
                        continue;
                    }
                    hotCityNames.add(cityName);
                }
            }

            const systemLocationsById = new Map<string, SystemLocationItem>();
            const upsertLocation = (item: SystemLocationItem) => {
                const existing = systemLocationsById.get(item.id);
                if (!existing) {
                    systemLocationsById.set(item.id, item);
                    return;
                }

                systemLocationsById.set(item.id, {
                    ...existing,
                    visible: existing.visible || item.visible,
                    parentKeyword: existing.parentKeyword ?? item.parentKeyword,
                });
            };

            for (const provinceNode of tree) {
                const provinceName = normalizeKeyword(provinceNode.name);
                if (!provinceName) {
                    continue;
                }

                const includeProvince = !LOCATION_GROUP_EXCLUDES.has(provinceName);
                if (includeProvince && !LOCATION_NAME_EXCLUDES.has(provinceName)) {
                    const provinceKeyword = provinceName;
                    upsertLocation({
                        id: createSystemLocationId("province", provinceKeyword),
                        keyword: provinceKeyword,
                        level: "province",
                        visible: true,
                    });
                }

                const cities = Array.isArray(provinceNode.cities) ? provinceNode.cities : [];
                for (const rawCity of cities) {
                    if (!rawCity || typeof rawCity !== "object") {
                        continue;
                    }
                    const cityNode = rawCity as Job5156CityNode;
                    const cityName = normalizeKeyword(cityNode.name);
                    if (!cityName || LOCATION_NAME_EXCLUDES.has(cityName)) {
                        continue;
                    }

                    upsertLocation({
                        id: createSystemLocationId("city", cityName),
                        keyword: cityName,
                        level: "city",
                        parentKeyword: includeProvince ? provinceName : undefined,
                        visible: hotCityNames.has(cityName) || DEFAULT_VISIBLE_CITIES.has(cityName),
                    });
                }
            }

            return Array.from(systemLocationsById.values()).sort((left, right) => {
                if (left.level !== right.level) {
                    return left.level === "province" ? -1 : 1;
                }
                if (left.visible !== right.visible) {
                    return left.visible ? -1 : 1;
                }
                return left.keyword.localeCompare(right.keyword, "zh-Hans-CN");
            });
        } catch (error) {
            console.error("Failed to load Job5156 location snapshot", error);
            return [];
        }
    }

    private mergeSystemLocations(base: SystemLocationItem[], overrides: SystemLocationItem[]): SystemLocationItem[] {
        const mergedById = new Map<string, SystemLocationItem>();

        for (const item of base) {
            mergedById.set(item.id, item);
        }

        for (const item of overrides) {
            const existing = mergedById.get(item.id);
            if (!existing) {
                mergedById.set(item.id, item);
                continue;
            }
            mergedById.set(item.id, {
                ...existing,
                ...item,
                keyword: item.keyword || existing.keyword,
                parentKeyword: item.parentKeyword ?? existing.parentKeyword,
            });
        }

        return Array.from(mergedById.values()).sort((left, right) => {
            if (left.level !== right.level) {
                return left.level === "province" ? -1 : 1;
            }
            if (left.visible !== right.visible) {
                return left.visible ? -1 : 1;
            }
            return left.keyword.localeCompare(right.keyword, "zh-Hans-CN");
        });
    }

    private loadConfig(): CustomKeywordsConfig {
        const configPath = this.getConfigPath();
        const currentMtimeMs = this.getConfigMtime(configPath);
        const locationSnapshotPath = this.getLocationSnapshotPath();
        const currentLocationSnapshotMtime = this.getConfigMtime(locationSnapshotPath);

        if (
            this.cache
            && this.cacheMtimeMs === currentMtimeMs
            && this.locationSnapshotMtimeMs === currentLocationSnapshotMtime
        ) {
            return this.cache;
        }

        const generatedSystemLocations = this.loadSystemLocationsFromSnapshot();
        if (!fs.existsSync(configPath)) {
            const fallback = {
                tags: [],
                categories: [...DEFAULT_CATEGORIES],
                systemLocations: generatedSystemLocations,
            };
            this.cache = fallback;
            this.cacheMtimeMs = null;
            this.locationSnapshotMtimeMs = currentLocationSnapshotMtime;
            return fallback;
        }

        const content = fs.readFileSync(configPath, "utf8");
        const parsed = JSON5.parse(content) as unknown;
        const normalized = normalizeConfig(parsed);
        this.cache = {
            ...normalized,
            systemLocations: this.mergeSystemLocations(generatedSystemLocations, normalized.systemLocations),
        };
        this.cacheMtimeMs = currentMtimeMs;
        this.locationSnapshotMtimeMs = currentLocationSnapshotMtime;
        return this.cache;
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

    listCategories(): CustomKeywordCategory[] {
        const config = this.loadConfig();
        return config.categories;
    }

    listSystemLocations(): SystemLocationItem[] {
        const config = this.loadConfig();
        return config.systemLocations;
    }

    clearCache(): void {
        this.cache = null;
        this.cacheMtimeMs = null;
        this.locationSnapshotMtimeMs = null;
    }
}

export const customKeywordService = new CustomKeywordService();
