import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAPIHono, z } from "@hono/zod-openapi";
import {
  APP_SURFACE_IDENTITY,
  DEBUG_AI_BREAKDOWN_LABELS,
  DEBUG_AI_KEYWORD_PROMPT_VARIANT,
  DEBUG_PAGE_SECTION_DEFINITIONS,
  INGEST_BRAND_CONTEXT_LABELS,
  INGEST_BRAND_ROLE_LABELS,
  INGEST_BRAND_SOURCE_LABELS,
  LATEST_WORK_HISTORY_LIMIT,
  SETTINGS_NAV_ITEMS,
  SYSTEM_SETTINGS_NAV_ITEMS,
  SYSTEM_CAPABILITY_DESCRIPTORS,
  SYSTEM_NAV_ITEMS,
  isRecord,
} from "@trends/shared";
import { requireAdmin } from "../middleware/workspace.js";
import { getMaskedApiKey, loadAIConfig, validateAIConfig } from "../services/ai-config.js";
import { configSourceInspector, UnknownConfigSourceError } from "../services/config-source-inspector.js";
import { customKeywordService } from "../services/custom-keyword-service.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";

const app = new OpenAPIHono();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(MODULE_DIR, "../..");
const REPO_ROOT = path.resolve(API_ROOT, "../..");

const AgentsConfigSchema = z.record(z.string(), z.unknown());
const KeywordMarketSchema = z.enum(["CN", "MY"]);
const WorkflowSeedCollectionSourceSchema = z.object({
  type: z.enum(["job5156", "51job", "seek"]),
  exactUrl: z.string().optional(),
});
const CustomKeywordTagSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  english: z.string().optional(),
  category: z.string(),
  markets: z.array(KeywordMarketSchema).optional(),
  visible: z.boolean().optional(),
  source: z.enum(["system", "workspace"]).optional(),
});
const CustomKeywordWorkflowSeedSchema = z.object({
  id: z.string(),
  label: z.string(),
  market: KeywordMarketSchema,
  location: z.string(),
  keywords: z.array(z.string()),
  collectionSource: WorkflowSeedCollectionSourceSchema,
  visible: z.boolean().optional(),
  source: z.enum(["system", "workspace"]).optional(),
});
const CustomKeywordCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
});
const SystemLocationItemSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  level: z.enum(["province", "city"]),
  parentKeyword: z.string().optional(),
  visible: z.boolean(),
  markets: z.array(KeywordMarketSchema).optional(),
});
const CustomKeywordsResponseSchema = z.object({
  success: z.literal(true),
  tags: z.array(CustomKeywordTagSchema),
  categories: z.array(CustomKeywordCategorySchema),
  systemLocations: z.array(SystemLocationItemSchema),
  workflowSeeds: z.array(CustomKeywordWorkflowSeedSchema),
});
const CustomKeywordUpdateSchema = CustomKeywordTagSchema;
const CustomKeywordWorkflowSeedUpdateSchema = CustomKeywordWorkflowSeedSchema;
const SystemLocationVisibilityUpdateSchema = z.object({
  visible: z.boolean(),
});
const RuleWeightsConfigSchema = z.record(z.string(), z.unknown());
const ResumeFieldUsageSurfaceRulesSchema = z.object({
  analysis: z.boolean().optional(),
  presentation: z.boolean().optional(),
  outreach: z.boolean().optional(),
  debug: z.boolean().optional(),
});
const ResumeFieldUsageFieldSchema = z.object({
  surfaces: ResumeFieldUsageSurfaceRulesSchema,
});
const ResumeFieldUsagePolicySchema = z.object({
  version: z.number().int().positive().optional(),
  updatedAt: z.string().optional(),
  description: z.string().optional(),
  sourceFileRelativePath: z.string().optional(),
  fields: z.record(z.string(), ResumeFieldUsageFieldSchema).default({}),
});
const LearningLogEntrySchema = z.object({
  date: z.string(),
  observation: z.string(),
});
const LearningLogAppendSchema = z.object({
  observation: z.string().trim().min(1),
});
const ConfigSourceMetadataSchema = z.object({
  version: z.number().optional(),
  updatedAt: z.string().optional(),
  description: z.string().optional(),
  locale: z.string().optional(),
  requestedLocale: z.string().optional(),
  resolvedSourceLocale: z.string().optional(),
  fallbackToZhHans: z.boolean().optional(),
});
const ConfigSourceSummarySchema = z.object({
  key: z.string(),
  label: z.string(),
  relativePath: z.string(),
  type: z.enum(["markdown", "json5", "text"]),
  group: z.enum(["prompt", "config", "project-notes"]),
  audience: z.enum(["developer", "admin", "app"]),
  readOnly: z.literal(true),
  metadata: ConfigSourceMetadataSchema.optional(),
  parseError: z.string().optional(),
});
const ConfigSourceDetailSchema = ConfigSourceSummarySchema.extend({
  rawSource: z.string(),
  parsedPreview: z.unknown(),
});
const SourceGroupSummarySchema = z.object({
  key: z.enum(["prompt", "config", "project-notes"]),
  label: z.string(),
  description: z.string(),
  audience: z.enum(["developer", "admin", "app"]),
  sources: z.array(ConfigSourceSummarySchema),
});
const SurfaceNavItemSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  defaultTitle: z.string(),
  hrefSuffix: z.string(),
  matchesSuffixes: z.array(z.string()).optional(),
});
const CapabilityDescriptorSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(["inspect", "debug", "settings", "navigation", "cli"]),
  audience: z.enum(["developer", "admin", "app"]),
  relatedSourceGroups: z.array(z.enum(["prompt", "config", "project-notes"])).optional(),
});
const BreakdownLabelSchema = z.object({
  key: z.string(),
  aliases: z.array(z.string()),
  labelKey: z.string(),
  defaultLabel: z.string(),
});
const LabelDescriptorSchema = z.object({
  value: z.string(),
  labelKey: z.string(),
  defaultLabel: z.string(),
});
const SystemIdentitySchema = z.object({
  appName: z.string(),
  homeTitle: z.string(),
  systemTitle: z.string(),
  settingsTitle: z.string(),
  adminBadgeLabel: z.string(),
  settingsBadgeLabel: z.string(),
  appVersion: z.string(),
  apiVersion: z.string(),
  webVersion: z.string(),
});
const SystemMetadataSchema = z.object({
  identity: SystemIdentitySchema,
  navigation: z.object({
    system: z.array(SurfaceNavItemSchema),
    settings: z.array(SurfaceNavItemSchema),
    systemSettings: z.array(SurfaceNavItemSchema),
    debugPage: z.array(SurfaceNavItemSchema),
  }),
  labels: z.object({
    aiBreakdown: z.array(BreakdownLabelSchema),
    ingestBrandSource: z.array(LabelDescriptorSchema),
    ingestBrandContext: z.array(LabelDescriptorSchema),
    ingestBrandRole: z.array(LabelDescriptorSchema),
  }),
  prompt: z.object({
    keywordVariantTitle: z.string(),
    keywordVariantBody: z.string(),
  }),
  capabilities: z.array(CapabilityDescriptorSchema),
});
const ResumeDisplayLimitsSchema = z.object({
  success: z.literal(true),
  latestWorkHistoryLimit: z.number().int().nonnegative(),
  source: z.string(),
});


function readPackageVersion(relativePath: string): string {
  const packageJsonPath = path.resolve(REPO_ROOT, relativePath);
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch (error) {
    console.error(`Failed to read package version from ${relativePath}`, error);
  }
  return "unknown";
}

const SYSTEM_METADATA_VERSIONS = {
  appVersion: readPackageVersion("package.json"),
  apiVersion: readPackageVersion("apps/api/package.json"),
  webVersion: readPackageVersion("apps/web/package.json"),
};

function buildSystemMetadata() {
  return {
    identity: {
      ...APP_SURFACE_IDENTITY,
      ...SYSTEM_METADATA_VERSIONS,
    },
    navigation: {
      system: SYSTEM_NAV_ITEMS,
      settings: SETTINGS_NAV_ITEMS,
      systemSettings: SYSTEM_SETTINGS_NAV_ITEMS,
      debugPage: DEBUG_PAGE_SECTION_DEFINITIONS.map((section) => ({
        ...section,
        matchesSuffixes: section.hrefSuffix ? [section.hrefSuffix] : [""],
      })),
    },
    labels: {
      aiBreakdown: DEBUG_AI_BREAKDOWN_LABELS,
      ingestBrandSource: INGEST_BRAND_SOURCE_LABELS,
      ingestBrandContext: INGEST_BRAND_CONTEXT_LABELS,
      ingestBrandRole: INGEST_BRAND_ROLE_LABELS,
    },
    prompt: {
      keywordVariantTitle: DEBUG_AI_KEYWORD_PROMPT_VARIANT.title,
      keywordVariantBody: DEBUG_AI_KEYWORD_PROMPT_VARIANT.body,
    },
    capabilities: SYSTEM_CAPABILITY_DESCRIPTORS,
  };
}

function upsertWorkspaceItem<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    items.push(item);
    return;
  }

  items[index] = item;
}

function removeWorkspaceItem<T extends { id: string }>(items: T[], id: string): boolean {
  const nextItems = items.filter((item) => item.id !== id);
  if (nextItems.length === items.length) {
    return false;
  }

  items.splice(0, items.length, ...nextItems);
  return true;
}

function isSystemCustomKeyword(id: string): boolean {
  return Boolean(customKeywordService.getTag(id));
}

function isSystemWorkflowSeed(id: string): boolean {
  return customKeywordService.listWorkflowSeeds().some((item) => item.id === id);
}

function applyBondedModel(configValue: Record<string, unknown>, model: string): Record<string, unknown> {
  const agents = configValue.agents;
  if (!isRecord(agents) || !Array.isArray(agents.list)) {
    return configValue;
  }

  const list = agents.list.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    return {
      ...item,
      model,
      isBonded: true,
    };
  });

  return {
    ...configValue,
    agents: {
      ...agents,
      list,
    },
  };
}

app.get("/agents", async (c) => {
  try {
    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getAgentsConfig(workspaceSlug);
    const parsedResult = AgentsConfigSchema.safeParse(mergedConfig);

    if (!parsedResult.success) {
      return c.json({ success: false as const, error: "Invalid agents configuration format" }, 500);
    }

    const aiConfig = loadAIConfig();
    const isModelBonded = aiConfig.bonded.includes("AI_MODEL");

    if (isModelBonded && aiConfig.model && isRecord(parsedResult.data)) {
      const configData = applyBondedModel(parsedResult.data, aiConfig.model);
      return c.json({ success: true as const, config: configData }, 200);
    }

    return c.json({ success: true as const, config: parsedResult.data }, 200);
  } catch (error) {
    console.error("Failed to load agents config", error);
    return c.json({ success: false as const, error: "Failed to load agents configuration" }, 500);
  }
});

app.put("/agents", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = AgentsConfigSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid agents configuration payload" }, 400);
    }

    await workspaceConfigService.setAgentOverrides(c.var.workspaceSlug, parsedBody.data);
    return c.json({ success: true as const, config: parsedBody.data }, 200);
  } catch (error) {
    console.error("Failed to save agents config", error);
    return c.json({ success: false as const, error: "Failed to save agents configuration" }, 500);
  }
});

app.get("/ai-status", (c) => {
  try {
    const aiConfig = loadAIConfig();
    const validation = validateAIConfig();

    return c.json(
      {
        success: true as const,
        enabled: aiConfig.enabled,
        resumesEnabled: aiConfig.resumesEnabled,
        model: aiConfig.model,
        apiBase: aiConfig.apiBase,
        temperature: aiConfig.temperature,
        maxTokens: aiConfig.maxTokens,
        timeout: aiConfig.timeout,
        apiKeyMasked: getMaskedApiKey(),
        valid: validation.valid,
        validationError: validation.error,
        bonded: aiConfig.bonded,
      },
      200,
    );
  } catch (error) {
    console.error("Failed to load AI status", error);
    return c.json({ success: false as const, error: "Failed to load AI status" }, 500);
  }
});

app.get("/custom-keywords", async (c) => {
  try {
    const config = await workspaceConfigService.getCustomKeywords(c.var.workspaceSlug);
    const response = CustomKeywordsResponseSchema.parse({
      success: true as const,
      tags: config.tags,
      categories: config.categories,
      systemLocations: config.systemLocations,
      workflowSeeds: config.workflowSeeds,
    });
    return c.json(response, 200);
  } catch (error) {
    console.error("Failed to load custom keywords", error);
    return c.json({ success: false as const, error: "Failed to load custom keywords" }, 500);
  }
});

app.put("/custom-keywords/system-locations/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsedBody = SystemLocationVisibilityUpdateSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid system location payload" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const matched = mergedConfig.systemLocations.find((item) => item.id === id);
    if (!matched) {
      return c.json({ success: false as const, error: `System location not found: ${id}` }, 404);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    const index = workspaceConfig.systemLocations.findIndex((item) => item.id === id);
    const updatedItem = {
      ...matched,
      visible: parsedBody.data.visible,
    };

    if (index === -1) {
      workspaceConfig.systemLocations.push(updatedItem);
    } else {
      workspaceConfig.systemLocations[index] = updatedItem;
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, item: updatedItem }, 200);
  } catch (error) {
    console.error("Failed to update system location visibility", error);
    return c.json({ success: false as const, error: "Failed to update system location visibility" }, 500);
  }
});

app.post("/custom-keywords", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordTagSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid custom keyword payload" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const exists = mergedConfig.tags.some((tag) => tag.id === parsedBody.data.id);
    if (exists) {
      return c.json({ success: false as const, error: `Tag already exists: ${parsedBody.data.id}` }, 409);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.tags, parsedBody.data);

    const categoryExists = mergedConfig.categories.some((category) => category.id === parsedBody.data.category)
      || workspaceConfig.categories.some((category) => category.id === parsedBody.data.category);
    if (!categoryExists) {
      workspaceConfig.categories.push({
        id: parsedBody.data.category,
        name: parsedBody.data.category,
      });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const tag = updatedConfig.tags.find((item) => item.id === parsedBody.data.id) ?? parsedBody.data;
    return c.json({ success: true as const, tag }, 201);
  } catch (error) {
    console.error("Failed to add custom keyword", error);
    return c.json({ success: false as const, error: "Failed to add custom keyword" }, 500);
  }
});

app.put("/custom-keywords/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordUpdateSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid custom keyword update payload" }, 400);
    }

    if (parsedBody.data.id !== id) {
      return c.json({ success: false as const, error: "Path id does not match payload id" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const existingTag = mergedConfig.tags.find((tag) => tag.id === id);
    if (!existingTag) {
      return c.json({ success: false as const, error: `Tag not found: ${id}` }, 404);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.tags, parsedBody.data);

    const categoryExists = mergedConfig.categories.some((category) => category.id === parsedBody.data.category)
      || workspaceConfig.categories.some((category) => category.id === parsedBody.data.category);
    if (!categoryExists) {
      workspaceConfig.categories.push({ id: parsedBody.data.category, name: parsedBody.data.category });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const tag = updatedConfig.tags.find((item) => item.id === id) ?? parsedBody.data;
    return c.json({ success: true as const, tag }, 200);
  } catch (error) {
    console.error("Failed to update custom keyword", error);
    return c.json({ success: false as const, error: "Failed to update custom keyword" }, 500);
  }
});

app.delete("/custom-keywords/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    const systemTagExists = isSystemCustomKeyword(id);
    const mergedTag = mergedConfig.tags.find((tag) => tag.id === id);
    if (!mergedTag) {
      return c.json({ success: false as const, error: `Tag not found: ${id}` }, 404);
    }

    if (systemTagExists) {
      upsertWorkspaceItem(workspaceConfig.tags, {
        ...mergedTag,
        visible: false,
        source: "workspace",
      });
    } else if (!removeWorkspaceItem(workspaceConfig.tags, id)) {
      return c.json({ success: false as const, error: `Tag not found in workspace override: ${id}` }, 404);
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);

    return c.json({ success: true as const }, 200);
  } catch (error) {
    console.error("Failed to delete custom keyword", error);
    return c.json({ success: false as const, error: "Failed to delete custom keyword" }, 500);
  }
});

app.post("/custom-keywords/workflow-seeds", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordWorkflowSeedSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid workflow seed payload" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const exists = mergedConfig.workflowSeeds.some((seed) => seed.id === parsedBody.data.id);
    if (exists) {
      return c.json({ success: false as const, error: `Workflow seed already exists: ${parsedBody.data.id}` }, 409);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.workflowSeeds, parsedBody.data);

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workflowSeed = updatedConfig.workflowSeeds.find((item) => item.id === parsedBody.data.id) ?? parsedBody.data;
    return c.json({ success: true as const, workflowSeed }, 201);
  } catch (error) {
    console.error("Failed to add workflow seed", error);
    return c.json({ success: false as const, error: "Failed to add workflow seed" }, 500);
  }
});

app.put("/custom-keywords/workflow-seeds/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordWorkflowSeedUpdateSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid workflow seed update payload" }, 400);
    }

    if (parsedBody.data.id !== id) {
      return c.json({ success: false as const, error: "Path id does not match payload id" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const existingWorkflowSeed = mergedConfig.workflowSeeds.find((seed) => seed.id === id);
    if (!existingWorkflowSeed) {
      return c.json({ success: false as const, error: `Workflow seed not found: ${id}` }, 404);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.workflowSeeds, parsedBody.data);

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workflowSeed = updatedConfig.workflowSeeds.find((item) => item.id === id) ?? parsedBody.data;
    return c.json({ success: true as const, workflowSeed }, 200);
  } catch (error) {
    console.error("Failed to update workflow seed", error);
    return c.json({ success: false as const, error: "Failed to update workflow seed" }, 500);
  }
});

app.delete("/custom-keywords/workflow-seeds/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    const systemWorkflowSeedExists = isSystemWorkflowSeed(id);
    const mergedWorkflowSeed = mergedConfig.workflowSeeds.find((seed) => seed.id === id);
    if (!mergedWorkflowSeed) {
      return c.json({ success: false as const, error: `Workflow seed not found: ${id}` }, 404);
    }

    if (systemWorkflowSeedExists) {
      upsertWorkspaceItem(workspaceConfig.workflowSeeds, {
        ...mergedWorkflowSeed,
        visible: false,
        source: "workspace",
      });
    } else if (!removeWorkspaceItem(workspaceConfig.workflowSeeds, id)) {
      return c.json({ success: false as const, error: `Workflow seed not found in workspace override: ${id}` }, 404);
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    return c.json({ success: true as const }, 200);
  } catch (error) {
    console.error("Failed to delete workflow seed", error);
    return c.json({ success: false as const, error: "Failed to delete workflow seed" }, 500);
  }
});

app.get("/rule-weights", async (c) => {
  try {
    const config = await workspaceConfigService.getRuleWeights(c.var.workspaceSlug);
    return c.json({ success: true as const, config }, 200);
  } catch (error) {
    console.error("Failed to load rule weights", error);
    return c.json({ success: false as const, error: "Failed to load rule weights" }, 500);
  }
});

app.put("/rule-weights", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsed = RuleWeightsConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid rule weights payload" }, 400);
    }

    await workspaceConfigService.setWorkspaceRuleWeights(c.var.workspaceSlug, parsed.data);
    const merged = await workspaceConfigService.getRuleWeights(c.var.workspaceSlug);
    return c.json({ success: true as const, config: merged }, 200);
  } catch (error) {
    console.error("Failed to update rule weights", error);
    return c.json({ success: false as const, error: "Failed to update rule weights" }, 500);
  }
});

app.get("/resume-field-usage-policy", async (c) => {
  try {
    const config = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
    const parsed = ResumeFieldUsagePolicySchema.safeParse(config);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid resume field usage policy" }, 500);
    }
    return c.json({ success: true as const, config: parsed.data }, 200);
  } catch (error) {
    console.error("Failed to load resume field usage policy", error);
    return c.json({ success: false as const, error: "Failed to load resume field usage policy" }, 500);
  }
});

app.put("/resume-field-usage-policy", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsed = ResumeFieldUsagePolicySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid resume field usage policy payload" }, 400);
    }

    await workspaceConfigService.setWorkspaceResumeFieldUsagePolicy(c.var.workspaceSlug, parsed.data);
    const merged = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
    return c.json({ success: true as const, config: merged }, 200);
  } catch (error) {
    console.error("Failed to update resume field usage policy", error);
    return c.json({ success: false as const, error: "Failed to update resume field usage policy" }, 500);
  }
});

app.get("/learning-log", async (c) => {
  try {
    const entries = await workspaceConfigService.getLearningLog(c.var.workspaceSlug);
    const parsed = z.array(LearningLogEntrySchema).safeParse(entries);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid learning log format" }, 500);
    }
    return c.json({ success: true as const, entries: parsed.data }, 200);
  } catch (error) {
    console.error("Failed to load learning log", error);
    return c.json({ success: false as const, error: "Failed to load learning log" }, 500);
  }
});

app.post("/learning-log", requireAdmin, async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsed = LearningLogAppendSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid learning log payload" }, 400);
    }

    const entry = await workspaceConfigService.appendLearningLogEntry(c.var.workspaceSlug, parsed.data.observation);
    return c.json({ success: true as const, entry }, 201);
  } catch (error) {
    console.error("Failed to append learning log", error);
    return c.json({ success: false as const, error: "Failed to append learning log" }, 500);
  }
});

app.get("/system-metadata", async (c) => {
  try {
    const payload = buildSystemMetadata();
    const parsed = SystemMetadataSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid system metadata response" }, 500);
    }
    return c.json({ success: true as const, metadata: parsed.data }, 200);
  } catch (error) {
    console.error("Failed to load system metadata", error);
    return c.json({ success: false as const, error: "Failed to load system metadata" }, 500);
  }
});

app.get("/resume-display-limits", async (c) => {
  try {
    const payload = {
      success: true as const,
      latestWorkHistoryLimit: LATEST_WORK_HISTORY_LIMIT,
      source: "packages/shared/src/work-history-evidence.ts",
    };
    const parsed = ResumeDisplayLimitsSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid resume display limits response" }, 500);
    }
    return c.json(parsed.data, 200);
  } catch (error) {
    console.error("Failed to load resume display limits", error);
    return c.json({ success: false as const, error: "Failed to load resume display limits" }, 500);
  }
});

app.get("/sources", async (c) => {
  try {
    const requestedLocale = c.req.query("locale");
    const group = c.req.query("group");
    const summaries = group === "prompt" || group === "config" || group === "project-notes"
      ? configSourceInspector.getSourcesByGroup(group, requestedLocale)
      : configSourceInspector.listSources(requestedLocale);
    const parsed = z.array(ConfigSourceSummarySchema).safeParse(summaries);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config sources response" }, 500);
    }
    return c.json({ success: true as const, sources: parsed.data }, 200);
  } catch (error) {
    console.error("Failed to list config sources", error);
    return c.json({ success: false as const, error: "Failed to list config sources" }, 500);
  }
});

app.get("/source-groups", async (c) => {
  try {
    const requestedLocale = c.req.query("locale");
    const groups = configSourceInspector.listSourceGroups(requestedLocale);
    const parsed = z.array(SourceGroupSummarySchema).safeParse(groups);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config source groups response" }, 500);
    }
    return c.json({ success: true as const, groups: parsed.data }, 200);
  } catch (error) {
    console.error("Failed to list config source groups", error);
    return c.json({ success: false as const, error: "Failed to list config source groups" }, 500);
  }
});

app.get("/sources/:key", async (c) => {
  try {
    const requestedLocale = c.req.query("locale");
    const detail = configSourceInspector.getSource(c.req.param("key"), requestedLocale);
    const parsed = ConfigSourceDetailSchema.safeParse(detail);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config source response" }, 500);
    }
    return c.json({ success: true as const, source: parsed.data }, 200);
  } catch (error) {
    if (error instanceof UnknownConfigSourceError) {
      return c.json({ success: false as const, error: error.message }, 404);
    }
    console.error("Failed to load config source", error);
    return c.json({ success: false as const, error: "Failed to load config source" }, 500);
  }
});

export default app;
