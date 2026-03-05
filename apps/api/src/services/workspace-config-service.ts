import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { findProjectRoot } from "./db.js";
import {
  customKeywordService,
  type CustomKeywordCategory,
  type CustomKeywordsConfig,
  type CustomKeywordTag,
  type SystemLocationItem,
} from "./custom-keyword-service.js";
import {
  filterPresetService,
  type FilterPreset,
  type FilterPresetsConfig,
  type PresetCategory,
} from "./filter-preset-service.js";
import {
  loadRuleWeightsConfig,
  mergeRuleWeights,
  parseRuleWeightsOverrides,
  type RuleWeightsConfig,
  type RuleWeightsConfigOverrides,
} from "./rule-scoring.js";
import { skillsKnowledgeService, type LearningLogEntry } from "./skills-knowledge.js";

type WorkspaceConfigEntry = {
  workspaceSlug: string;
  configKey: string;
  configValue: unknown;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseWorkspaceConfigEntry(value: unknown): WorkspaceConfigEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const workspaceSlug = readString(value.workspaceSlug);
  const configKey = readString(value.configKey);
  const updatedAt = readNumber(value.updatedAt);

  if (!workspaceSlug || !configKey || updatedAt === null) {
    return null;
  }

  return {
    workspaceSlug,
    configKey,
    configValue: value.configValue,
    updatedAt,
  };
}

function mergeUnknown(baseValue: unknown, overrideValue: unknown): unknown {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
    return overrideValue;
  }

  if (isRecord(baseValue) && isRecord(overrideValue)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(baseValue), ...Object.keys(overrideValue)]);
    for (const key of keys) {
      if (key in overrideValue) {
        merged[key] = mergeUnknown(baseValue[key], overrideValue[key]);
      } else {
        merged[key] = baseValue[key];
      }
    }
    return merged;
  }

  return overrideValue;
}

function parseCustomKeywordTag(value: unknown): CustomKeywordTag | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const keyword = readString(value.keyword);
  const category = readString(value.category);
  if (!id || !keyword || !category) {
    return null;
  }

  const english = readString(value.english) ?? undefined;
  return { id, keyword, english, category };
}

function parseCustomKeywordCategory(value: unknown): CustomKeywordCategory | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) {
    return null;
  }

  const icon = readString(value.icon) ?? undefined;
  return { id, name, icon };
}

function parseSystemLocationItem(value: unknown): SystemLocationItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const keyword = readString(value.keyword);
  const level = value.level === "province" || value.level === "city" ? value.level : null;
  const visible = typeof value.visible === "boolean" ? value.visible : null;
  if (!id || !keyword || !level || visible === null) {
    return null;
  }

  const parentKeyword = readString(value.parentKeyword) ?? undefined;
  return { id, keyword, level, parentKeyword, visible };
}

function parseCustomKeywordsConfig(value: unknown): CustomKeywordsConfig {
  if (!isRecord(value)) {
    return { tags: [], categories: [], systemLocations: [] };
  }

  const tags = Array.isArray(value.tags)
    ? value.tags
        .map((item) => parseCustomKeywordTag(item))
        .filter((item): item is CustomKeywordTag => item !== null)
    : [];

  const categories = Array.isArray(value.categories)
    ? value.categories
        .map((item) => parseCustomKeywordCategory(item))
        .filter((item): item is CustomKeywordCategory => item !== null)
    : [];

  const systemLocations = Array.isArray(value.systemLocations)
    ? value.systemLocations
        .map((item) => parseSystemLocationItem(item))
        .filter((item): item is SystemLocationItem => item !== null)
    : [];

  return { tags, categories, systemLocations };
}

function parseFilterPreset(value: unknown): FilterPreset | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  const category = readString(value.category);
  if (!id || !name || !category || !isRecord(value.filters)) {
    return null;
  }

  const filters: FilterPreset["filters"] = {};
  const minExperience = readNumber(value.filters.minExperience);
  if (minExperience !== null) {
    filters.minExperience = minExperience;
  }
  const maxExperienceRaw = value.filters.maxExperience;
  if (maxExperienceRaw === null) {
    filters.maxExperience = null;
  } else {
    const maxExperience = readNumber(maxExperienceRaw);
    if (maxExperience !== null) {
      filters.maxExperience = maxExperience;
    }
  }
  if (Array.isArray(value.filters.education)) {
    const education = value.filters.education
      .map((item) => readString(item))
      .filter((item): item is string => item !== null);
    if (education.length > 0) {
      filters.education = education;
    }
  }

  if (isRecord(value.filters.salaryRange)) {
    const min = readNumber(value.filters.salaryRange.min);
    const max = readNumber(value.filters.salaryRange.max);
    if (min !== null || max !== null) {
      filters.salaryRange = {};
      if (min !== null) {
        filters.salaryRange.min = min;
      }
      if (max !== null) {
        filters.salaryRange.max = max;
      }
    }
  }

  return { id, name, category, filters };
}

function parsePresetCategory(value: unknown): PresetCategory | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) {
    return null;
  }
  const icon = readString(value.icon) ?? undefined;
  return { id, name, icon };
}

function parseFilterPresetsConfig(value: unknown): FilterPresetsConfig {
  if (!isRecord(value)) {
    return { presets: [], categories: [] };
  }

  const presets = Array.isArray(value.presets)
    ? value.presets
        .map((item) => parseFilterPreset(item))
        .filter((item): item is FilterPreset => item !== null)
    : [];

  const categories = Array.isArray(value.categories)
    ? value.categories
        .map((item) => parsePresetCategory(item))
        .filter((item): item is PresetCategory => item !== null)
    : [];

  return { presets, categories };
}

function parseLearningLogEntry(value: unknown): LearningLogEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const date = readString(value.date);
  const observation = readString(value.observation);
  if (!date || !observation) {
    return null;
  }

  return { date, observation };
}

function parseLearningLogConfig(value: unknown): LearningLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => parseLearningLogEntry(item))
    .filter((item): item is LearningLogEntry => item !== null);
}

function parseRuleWeightsConfig(value: unknown): RuleWeightsConfigOverrides | undefined {
  return parseRuleWeightsOverrides(value);
}

const CUSTOM_KEYWORDS_KEY = "custom-keywords";
const AGENT_OVERRIDES_KEY = "agent-overrides";
const FILTER_PRESETS_KEY = "filter-presets";
const RULE_WEIGHTS_KEY = "rule-weights";
const LEARNING_LOG_KEY = "learning-log";

export class WorkspaceConfigService {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getAgentsConfigPath(): string {
    return path.join(this.projectRoot, "config", "resume", "agents.json5");
  }

  private readEnvVarFromFile(filePath: string, key: string): string | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || match[1] !== key) {
        continue;
      }

      let value = match[2].trim();
      const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
      const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
      if (hasDoubleQuotes || hasSingleQuotes) {
        value = value.slice(1, -1);
      }

      return value;
    }

    return null;
  }

  private resolveConvexUrl(): string {
    if (process.env.CONVEX_URL) {
      return process.env.CONVEX_URL;
    }
    if (process.env.VITE_CONVEX_URL) {
      return process.env.VITE_CONVEX_URL;
    }

    const candidateFiles = [
      path.join(this.projectRoot, "packages", "convex", ".env.local"),
      path.join(this.projectRoot, "apps", "web", ".env.local"),
      path.join(this.projectRoot, ".env.local"),
      path.join(this.projectRoot, ".env"),
    ];

    for (const filePath of candidateFiles) {
      const direct = this.readEnvVarFromFile(filePath, "CONVEX_URL");
      if (direct) {
        return direct;
      }

      const vite = this.readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
      if (vite) {
        return vite;
      }
    }

    return "http://127.0.0.1:3210";
  }

  private async callConvex(type: "query" | "mutation", pathName: string, args: Record<string, unknown>): Promise<unknown> {
    const convexUrl = this.resolveConvexUrl().replace(/\/$/, "");
    const response = await fetch(`${convexUrl}/api/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ path: pathName, args }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Convex ${type} failed (${response.status}): ${message}`);
    }

    const payload = await response.json() as unknown;
    if (!isRecord(payload) || payload.status !== "success") {
      const errorMessage = isRecord(payload) ? readString(payload.errorMessage) : null;
      throw new Error(errorMessage ?? `Convex ${type} failed for ${pathName}`);
    }

    return payload.value;
  }

  private async getWorkspaceConfigEntry(workspaceSlug: string, configKey: string): Promise<WorkspaceConfigEntry | null> {
    try {
      const value = await this.callConvex("query", "workspace_config:get", {
        workspaceSlug,
        configKey,
      });
      return parseWorkspaceConfigEntry(value);
    } catch (error) {
      console.error("Failed to get workspace config entry", error);
      return null;
    }
  }

  private async upsertWorkspaceConfigEntry(workspaceSlug: string, configKey: string, configValue: unknown): Promise<void> {
    try {
      await this.callConvex("mutation", "workspace_config:upsert", {
        workspaceSlug,
        configKey,
        configValue,
      });
    } catch (error) {
      console.error("Failed to upsert workspace config entry", error);
      throw error;
    }
  }

  private readSystemAgentsConfig(): unknown {
    const content = fs.readFileSync(this.getAgentsConfigPath(), "utf8");
    return JSON5.parse(content) as unknown;
  }

  async getAgentsConfig(workspaceSlug: string): Promise<unknown> {
    const systemConfig = this.readSystemAgentsConfig();
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, AGENT_OVERRIDES_KEY);
    if (!entry) {
      return systemConfig;
    }
    return mergeUnknown(systemConfig, entry.configValue);
  }

  async setAgentOverrides(workspaceSlug: string, configValue: unknown): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, AGENT_OVERRIDES_KEY, configValue);
  }

  async getWorkspaceCustomKeywords(workspaceSlug: string): Promise<CustomKeywordsConfig> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, CUSTOM_KEYWORDS_KEY);
    return parseCustomKeywordsConfig(entry?.configValue);
  }

  async setWorkspaceCustomKeywords(workspaceSlug: string, config: CustomKeywordsConfig): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, CUSTOM_KEYWORDS_KEY, config);
  }

  async getCustomKeywords(workspaceSlug: string): Promise<CustomKeywordsConfig> {
    const systemConfig: CustomKeywordsConfig = {
      tags: customKeywordService.listTags(),
      categories: customKeywordService.listCategories(),
      systemLocations: customKeywordService.listSystemLocations(),
    };
    const workspaceConfig = await this.getWorkspaceCustomKeywords(workspaceSlug);

    const categoriesById = new Map<string, CustomKeywordCategory>();
    for (const category of systemConfig.categories) {
      categoriesById.set(category.id, category);
    }
    for (const category of workspaceConfig.categories) {
      categoriesById.set(category.id, category);
    }

    const tagsById = new Map<string, CustomKeywordTag>();
    for (const tag of systemConfig.tags) {
      tagsById.set(tag.id, tag);
    }
    for (const tag of workspaceConfig.tags) {
      tagsById.set(tag.id, tag);
    }

    const locationsById = new Map<string, SystemLocationItem>();
    for (const item of systemConfig.systemLocations) {
      locationsById.set(item.id, item);
    }
    for (const item of workspaceConfig.systemLocations) {
      locationsById.set(item.id, item);
    }

    return {
      categories: Array.from(categoriesById.values()),
      tags: Array.from(tagsById.values()),
      systemLocations: Array.from(locationsById.values()),
    };
  }

  async getWorkspaceFilterPresets(workspaceSlug: string): Promise<FilterPresetsConfig> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, FILTER_PRESETS_KEY);
    return parseFilterPresetsConfig(entry?.configValue);
  }

  async setWorkspaceFilterPresets(workspaceSlug: string, config: FilterPresetsConfig): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, FILTER_PRESETS_KEY, config);
  }

  async getFilterPresets(workspaceSlug: string): Promise<FilterPresetsConfig> {
    const systemConfig: FilterPresetsConfig = {
      presets: filterPresetService.listPresets(),
      categories: filterPresetService.listCategories(),
    };
    const workspaceConfig = await this.getWorkspaceFilterPresets(workspaceSlug);

    const categoriesById = new Map<string, PresetCategory>();
    for (const category of systemConfig.categories) {
      categoriesById.set(category.id, category);
    }
    for (const category of workspaceConfig.categories) {
      categoriesById.set(category.id, category);
    }

    const presetsById = new Map<string, FilterPreset>();
    for (const preset of systemConfig.presets) {
      presetsById.set(preset.id, preset);
    }
    for (const preset of workspaceConfig.presets) {
      presetsById.set(preset.id, preset);
    }

    return {
      presets: Array.from(presetsById.values()),
      categories: Array.from(categoriesById.values()),
    };
  }

  async getWorkspaceRuleWeights(workspaceSlug: string): Promise<RuleWeightsConfigOverrides | undefined> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, RULE_WEIGHTS_KEY);
    return parseRuleWeightsConfig(entry?.configValue);
  }

  async setWorkspaceRuleWeights(
    workspaceSlug: string,
    config: RuleWeightsConfigOverrides | RuleWeightsConfig
  ): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, RULE_WEIGHTS_KEY, config);
  }

  async getRuleWeights(workspaceSlug: string): Promise<RuleWeightsConfig> {
    const systemConfig = loadRuleWeightsConfig(this.projectRoot);
    const workspaceConfig = await this.getWorkspaceRuleWeights(workspaceSlug);
    const merged = mergeUnknown(systemConfig, workspaceConfig);
    const mergedOverrides = parseRuleWeightsConfig(merged);
    return mergeRuleWeights(mergedOverrides);
  }

  async getWorkspaceLearningLog(workspaceSlug: string): Promise<LearningLogEntry[]> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, LEARNING_LOG_KEY);
    return parseLearningLogConfig(entry?.configValue);
  }

  async setWorkspaceLearningLog(workspaceSlug: string, entries: LearningLogEntry[]): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, LEARNING_LOG_KEY, entries);
  }

  async appendLearningLogEntry(workspaceSlug: string, observation: string, date?: string): Promise<LearningLogEntry> {
    const normalizedObservation = observation.trim();
    if (!normalizedObservation) {
      throw new Error("Observation cannot be empty");
    }

    const entry: LearningLogEntry = {
      date: date?.trim() || new Date().toISOString().slice(0, 10),
      observation: normalizedObservation,
    };
    const currentEntries = await this.getWorkspaceLearningLog(workspaceSlug);
    currentEntries.push(entry);
    await this.setWorkspaceLearningLog(workspaceSlug, currentEntries);
    return entry;
  }

  async getLearningLog(workspaceSlug: string): Promise<LearningLogEntry[]> {
    const systemEntries = skillsKnowledgeService.getLearningLog();
    const workspaceEntries = await this.getWorkspaceLearningLog(workspaceSlug);
    return [...systemEntries, ...workspaceEntries];
  }
}

export const workspaceConfigService = new WorkspaceConfigService();
