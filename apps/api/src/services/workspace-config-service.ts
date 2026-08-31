import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import { logger } from "./logger.js";
import {
  collapseDefaultExportFieldsConfig,
  isRecord,
  isExportFieldKey,
  parseResumeFieldUsagePolicyOverrides,
  resolveStoredExportFieldsConfig,
  resolveResumeFieldUsagePolicy,
  type ExportFieldKey,
  type ExportFieldsConfig,
  type ResumeFieldUsagePolicy,
  type ResumeFieldUsagePolicyOverrides,
  type SummaryChannel,
  type SummaryPeriod,
  type SummaryProfileRecord,
  type SummaryProfilesConfig,
} from "@trends/shared";
import { findProjectRoot } from "./db.js";
import {
  customKeywordService,
  type ConfigSourceOrigin,
  type CustomKeywordCategory,
  type CustomKeywordsConfig,
  type CustomKeywordTag,
  type CustomKeywordWorkflowSeed,
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


export function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseMarkets(value: unknown): Array<"CN" | "MY" | "TH"> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const markets = value.filter((item): item is "CN" | "MY" | "TH" => item === "CN" || item === "MY" || item === "TH");
  return markets.length > 0 ? Array.from(new Set(markets)) : undefined;
}

export function parseWorkflowMarket(value: unknown): "CN" | "MY" | "TH" | null {
  return value === "CN" || value === "MY" || value === "TH" ? value : null;
}

export function parseVisible(value: unknown): boolean | undefined {
  return readBoolean(value) ?? undefined;
}

export function parseWorkflowCollectionSource(value: unknown): CustomKeywordWorkflowSeed["collectionSource"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type === "job5156" || value.type === "51job" || value.type === "seek" ? value.type : null;
  if (!type) {
    return null;
  }

  const exactUrl = readString(value.exactUrl) ?? undefined;
  return exactUrl ? { type, exactUrl } : { type };
}

export function parseWorkspaceConfigEntry(value: unknown): WorkspaceConfigEntry | null {
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

export function mergeUnknown(baseValue: unknown, overrideValue: unknown): unknown {
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

export function parseSummaryPeriod(value: unknown): SummaryPeriod | null {
  return value === "daily" || value === "weekly" ? value : null;
}

export function parseSummaryChannel(value: unknown): SummaryChannel | null {
  return value === "email" || value === "wechat_work" || value === "feishu" || value === "telegram"
    ? value
    : null;
}

export function parseSummaryProfileSchedule(value: unknown): SummaryProfileRecord["schedule"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const cron = readString(value.cron);
  if (!cron) {
    return null;
  }

  return { cron };
}

export function parseSummaryProfileRequest(value: unknown): SummaryProfileRecord["request"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const period = parseSummaryPeriod(value.period);
  const channel = parseSummaryChannel(value.channel);
  const dryRun = readBoolean(value.dryRun);
  if (!period || !channel || dryRun === null) {
    return null;
  }

  const request: SummaryProfileRecord["request"] = {
    period,
    channel,
    dryRun,
  };

  const templateId = readString(value.templateId) ?? undefined;
  if (templateId) {
    request.templateId = templateId;
  }

  if (channel === "email") {
    const to = readString(value.to) ?? undefined;
    if (!to) {
      return null;
    }
    request.to = to;

    const subject = readString(value.subject) ?? undefined;
    if (subject) {
      request.subject = subject;
    }
  }

  return request;
}

export function parseSummaryProfileRecord(value: unknown): SummaryProfileRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  const enabled = readBoolean(value.enabled);
  const schedule = parseSummaryProfileSchedule(value.schedule);
  const request = parseSummaryProfileRequest(value.request);
  if (!id || !name || enabled === null || !schedule || !request) {
    return null;
  }

  return {
    id,
    name,
    enabled,
    schedule,
    request,
  };
}

export function parseSummaryProfilesConfig(value: unknown): SummaryProfilesConfig {
  if (!isRecord(value)) {
    return { profiles: [] };
  }

  const profiles = Array.isArray(value.profiles)
    ? value.profiles
        .map((item) => parseSummaryProfileRecord(item))
        .filter((item): item is SummaryProfileRecord => item !== null)
    : [];

  return { profiles };
}

function sanitizeSummaryProfilesConfig(config: SummaryProfilesConfig): SummaryProfilesConfig {
  return parseSummaryProfilesConfig(config);
}

export function parseCustomKeywordTag(value: unknown): CustomKeywordTag | null {
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
  const markets = parseMarkets(value.markets);
  const visible = parseVisible(value.visible);
  const source = value.source === "system" || value.source === "workspace" ? value.source : undefined;

  const tag: CustomKeywordTag = { id, keyword, english, category };
  if (markets) {
    tag.markets = markets;
  }
  if (visible !== undefined) {
    tag.visible = visible;
  }
  if (source) {
    tag.source = source;
  }
  return tag;
}

export function parseCustomKeywordCategory(value: unknown): CustomKeywordCategory | null {
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

export function parseSystemLocationItem(value: unknown): SystemLocationItem | null {
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
  const markets = parseMarkets(value.markets);
  const location: SystemLocationItem = { id, keyword, level, parentKeyword, visible };
  if (markets) {
    location.markets = markets;
  }
  return location;
}

export function parseWorkflowSeed(value: unknown): CustomKeywordWorkflowSeed | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const label = readString(value.label);
  const market = parseWorkflowMarket(value.market);
  const location = readString(value.location) ?? "";
  const keywords = Array.isArray(value.keywords)
    ? value.keywords
        .map((item) => readString(item))
        .filter((item): item is string => item !== null)
    : [];
  const collectionSource = parseWorkflowCollectionSource(value.collectionSource);

  if (!id || !label || !market || keywords.length === 0 || !collectionSource) {
    return null;
  }

  const workflowSeed: CustomKeywordWorkflowSeed = {
    id,
    label,
    market,
    location,
    keywords: Array.from(new Set(keywords)),
    collectionSource,
  };

  const visible = parseVisible(value.visible);
  if (visible !== undefined) {
    workflowSeed.visible = visible;
  }

  const source = value.source === "system" || value.source === "workspace" ? value.source : undefined;
  if (source) {
    workflowSeed.source = source;
  }

  return workflowSeed;
}

export function parseCustomKeywordsConfig(value: unknown): CustomKeywordsConfig {
  if (!isRecord(value)) {
    return { tags: [], categories: [], systemLocations: [], workflowSeeds: [] };
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

  const workflowSeeds = Array.isArray(value.workflowSeeds)
    ? value.workflowSeeds
        .map((item) => parseWorkflowSeed(item))
        .filter((item): item is CustomKeywordWorkflowSeed => item !== null)
    : [];

  return { tags, categories, systemLocations, workflowSeeds };
}

function sanitizeCustomKeywordsConfig(config: CustomKeywordsConfig): CustomKeywordsConfig {
  return {
    tags: config.tags.map(({ source, ...tag }) => tag),
    categories: config.categories.map((category) => ({ ...category })),
    systemLocations: config.systemLocations.map((location) => ({ ...location })),
    workflowSeeds: config.workflowSeeds.map(({ source, ...seed }) => ({
      ...seed,
      collectionSource: { ...seed.collectionSource },
    })),
  };
}

export function mergeItemsById<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  const mergedById = new Map<string, T>();

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
    });
  }

  return Array.from(mergedById.values());
}

export function mergeResolvedItemsById<T extends { id: string; source?: ConfigSourceOrigin }>(base: T[], overrides: T[]): (T & { source: ConfigSourceOrigin })[] {
  const mergedById = new Map<string, T & { source: ConfigSourceOrigin }>();

  for (const item of base) {
    mergedById.set(item.id, {
      ...item,
      source: item.source ?? "system",
    });
  }

  for (const item of overrides) {
    const existing = mergedById.get(item.id);
    if (!existing) {
      mergedById.set(item.id, {
        ...item,
        source: "workspace",
      });
      continue;
    }

    mergedById.set(item.id, {
      ...existing,
      ...item,
      source: "workspace",
    });
  }

  return Array.from(mergedById.values());
}

export function parseFilterPreset(value: unknown): FilterPreset | null {
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

export function parsePresetCategory(value: unknown): PresetCategory | null {
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

export function parseFilterPresetsConfig(value: unknown): FilterPresetsConfig {
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

export function parseLearningLogEntry(value: unknown): LearningLogEntry | null {
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

export function parseLearningLogConfig(value: unknown): LearningLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => parseLearningLogEntry(item))
    .filter((item): item is LearningLogEntry => item !== null);
}

export function parseRuleWeightsConfig(value: unknown): RuleWeightsConfigOverrides | undefined {
  return parseRuleWeightsOverrides(value);
}

export function parseExportFieldsConfig(value: unknown): ExportFieldsConfig | null {
  if (!isRecord(value)) return null;
  const fields = value.fields;
  if (!Array.isArray(fields)) return null;
  const validFields = fields.filter((f): f is ExportFieldKey => isExportFieldKey(f));
  const includeDebugWhenEnabled = typeof value.includeDebugWhenEnabled === "boolean"
    ? value.includeDebugWhenEnabled
    : undefined;
  return resolveStoredExportFieldsConfig({ fields: validFields, includeDebugWhenEnabled });
}

const CUSTOM_KEYWORDS_KEY = "custom-keywords";
const AGENT_OVERRIDES_KEY = "agent-overrides";
const FILTER_PRESETS_KEY = "filter-presets";
const RULE_WEIGHTS_KEY = "rule-weights";
const LEARNING_LOG_KEY = "learning-log";
const RESUME_FIELD_USAGE_POLICY_KEY = "resume-field-usage-policy";
const SUMMARY_PROFILES_KEY = "summary-profiles";
const EXPORT_FIELDS_KEY = "export-fields";

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
      logger.error("Failed to get workspace config entry", error, { service: "workspace-config" });
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
      logger.error("Failed to upsert workspace config entry", error, { service: "workspace-config" });
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

  async getWorkspaceConfigValue(workspaceSlug: string, configKey: string): Promise<unknown> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, configKey);
    return entry?.configValue;
  }

  async setWorkspaceConfigValue(
    workspaceSlug: string,
    configKey: string,
    configValue: unknown,
  ): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, configKey, configValue);
  }

  async setAgentOverrides(workspaceSlug: string, configValue: unknown): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, AGENT_OVERRIDES_KEY, configValue);
  }

  async getWorkspaceCustomKeywords(workspaceSlug: string): Promise<CustomKeywordsConfig> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, CUSTOM_KEYWORDS_KEY);
    return parseCustomKeywordsConfig(entry?.configValue);
  }

  async setWorkspaceCustomKeywords(workspaceSlug: string, config: CustomKeywordsConfig): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, CUSTOM_KEYWORDS_KEY, sanitizeCustomKeywordsConfig(config));
  }

  async getCustomKeywords(workspaceSlug: string): Promise<CustomKeywordsConfig> {
    const systemConfig: CustomKeywordsConfig = {
      tags: customKeywordService.listTags().map((item) => ({ ...item, source: "system" as const })),
      categories: customKeywordService.listCategories(),
      systemLocations: customKeywordService.listSystemLocations(),
      workflowSeeds: customKeywordService.listWorkflowSeeds().map((item) => ({ ...item, source: "system" as const })),
    };
    const workspaceConfig = await this.getWorkspaceCustomKeywords(workspaceSlug);

    const categoriesById = new Map<string, CustomKeywordCategory>();
    for (const category of systemConfig.categories) {
      categoriesById.set(category.id, category);
    }
    for (const category of workspaceConfig.categories) {
      categoriesById.set(category.id, category);
    }

    const tags = mergeResolvedItemsById(systemConfig.tags, workspaceConfig.tags);
    const workflowSeeds = mergeResolvedItemsById(systemConfig.workflowSeeds, workspaceConfig.workflowSeeds);
    const locations = mergeItemsById(systemConfig.systemLocations, workspaceConfig.systemLocations);

    return {
      categories: Array.from(categoriesById.values()),
      tags,
      systemLocations: locations,
      workflowSeeds,
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

  async getWorkspaceSummaryProfiles(workspaceSlug: string): Promise<SummaryProfilesConfig> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, SUMMARY_PROFILES_KEY);
    return parseSummaryProfilesConfig(entry?.configValue);
  }

  async setWorkspaceSummaryProfiles(workspaceSlug: string, config: SummaryProfilesConfig): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, SUMMARY_PROFILES_KEY, sanitizeSummaryProfilesConfig(config));
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

  async getWorkspaceResumeFieldUsagePolicy(
    workspaceSlug: string,
  ): Promise<ResumeFieldUsagePolicyOverrides | undefined> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, RESUME_FIELD_USAGE_POLICY_KEY);
    return parseResumeFieldUsagePolicyOverrides(entry?.configValue);
  }

  async setWorkspaceResumeFieldUsagePolicy(
    workspaceSlug: string,
    config: ResumeFieldUsagePolicy | ResumeFieldUsagePolicyOverrides,
  ): Promise<void> {
    await this.upsertWorkspaceConfigEntry(workspaceSlug, RESUME_FIELD_USAGE_POLICY_KEY, config);
  }

  async getResumeFieldUsagePolicy(workspaceSlug: string): Promise<ResumeFieldUsagePolicy> {
    const workspaceConfig = await this.getWorkspaceResumeFieldUsagePolicy(workspaceSlug);
    return resolveResumeFieldUsagePolicy(workspaceConfig);
  }

  async getExportFieldsConfig(workspaceSlug: string): Promise<ExportFieldsConfig | null> {
    const entry = await this.getWorkspaceConfigEntry(workspaceSlug, EXPORT_FIELDS_KEY);
    return parseExportFieldsConfig(entry?.configValue);
  }

  async setExportFieldsConfig(workspaceSlug: string, config: ExportFieldsConfig): Promise<void> {
    await this.upsertWorkspaceConfigEntry(
      workspaceSlug,
      EXPORT_FIELDS_KEY,
      collapseDefaultExportFieldsConfig(config),
    );
  }
}

export const workspaceConfigService = new WorkspaceConfigService();
