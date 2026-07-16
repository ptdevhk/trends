import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  APP_SURFACE_IDENTITY,
  DEBUG_AI_BREAKDOWN_LABELS,
  DEBUG_AI_KEYWORD_PROMPT_VARIANT,
  DEBUG_PAGE_SECTION_DEFINITIONS,
  EXPORT_FIELD_KEYS,
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
import { getAdminAccessError, getWorkspaceUserAccessError } from "../middleware/auth.js";
import { getMaskedApiKey, loadAIConfig, validateAIConfig } from "../services/ai-config.js";
import { configSourceInspector, UnknownConfigSourceError } from "../services/config-source-inspector.js";
import { customKeywordService } from "../services/custom-keyword-service.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(MODULE_DIR, "../..");
const REPO_ROOT = path.resolve(API_ROOT, "../..");

// --- Shared schemas ---

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
  audit: z.boolean().optional(),
  debug: z.boolean().optional(),
});
const ResumeFieldUsageFieldSchema = z.object({
  surfaces: ResumeFieldUsageSurfaceRulesSchema.optional(),
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
  requiresAdmin: z.boolean().optional(),
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

// --- Shared response schemas ---

const SuccessResponseSchema = z.object({ success: z.literal(true) });
const ErrorResponseSchema = z.object({ success: z.literal(false), error: z.string() });

const AIStatusResponseSchema = z.object({
  success: z.literal(true),
  enabled: z.boolean().nullish(),
  resumesEnabled: z.boolean().nullish(),
  model: z.string().nullish(),
  apiBase: z.string().nullish(),
  temperature: z.number().nullish(),
  maxTokens: z.number().nullish(),
  timeout: z.number().nullish(),
  apiKeyMasked: z.string().nullish(),
  valid: z.boolean(),
  validationError: z.string().nullish(),
  bonded: z.array(z.string()).nullish(),
});

const AgentsGetResponseSchema = z.object({
  success: z.literal(true),
  config: AgentsConfigSchema,
});

const RuleWeightsResponseSchema = z.object({
  success: z.literal(true),
  config: RuleWeightsConfigSchema,
});

const ResumeFieldUsagePolicyResponseSchema = z.object({
  success: z.literal(true),
  config: ResumeFieldUsagePolicySchema,
});

const LearningLogResponseSchema = z.object({
  success: z.literal(true),
  entries: z.array(LearningLogEntrySchema),
});

const LearningLogAppendResponseSchema = z.object({
  success: z.literal(true),
  entry: LearningLogEntrySchema,
});

const ExportFieldsConfigSchema = z.object({
  fields: z.array(z.enum(EXPORT_FIELD_KEYS)),
  includeDebugWhenEnabled: z.boolean().optional(),
});

const ExportFieldsConfigResponseSchema = z.object({
  success: z.literal(true),
  config: ExportFieldsConfigSchema.nullable(),
});

const SystemMetadataResponseSchema = z.object({
  success: z.literal(true),
  metadata: SystemMetadataSchema,
});

const ConfigSourcesResponseSchema = z.object({
  success: z.literal(true),
  sources: z.array(ConfigSourceSummarySchema),
});

const SourceGroupsResponseSchema = z.object({
  success: z.literal(true),
  groups: z.array(SourceGroupSummarySchema),
});

const ConfigSourceDetailResponseSchema = z.object({
  success: z.literal(true),
  source: ConfigSourceDetailSchema,
});

const CustomKeywordTagResponseSchema = z.object({
  success: z.literal(true),
  tag: CustomKeywordTagSchema,
});

const CustomKeywordWorkflowSeedResponseSchema = z.object({
  success: z.literal(true),
  workflowSeed: CustomKeywordWorkflowSeedSchema,
});

const SystemLocationUpdateResponseSchema = z.object({
  success: z.literal(true),
  item: SystemLocationItemSchema,
});

// --- Helpers ---

function readPackageVersion(relativePath: string): string {
  const packageJsonPath = path.resolve(REPO_ROOT, relativePath);
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch (error) {
    logger.error(`Failed to read package version from ${relativePath}`, error, { route: "config" });
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

// --- Route definitions ---

const getAgentsRoute = createRoute({
  method: "get",
  path: "/agents",
  tags: ["config"],
  summary: "Get agents configuration",
  responses: {
    200: { description: "Agents config", content: { "application/json": { schema: AgentsGetResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getAgentsRoute, async (c) => {
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
    logger.error("Failed to load agents config", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load agents configuration" }, 500);
  }
});

const putAgentsRoute = createRoute({
  method: "put",
  path: "/agents",
  tags: ["config"],
  summary: "Update agents configuration",
  request: {
    body: { content: { "application/json": { schema: AgentsConfigSchema } } },
  },
  responses: {
    200: { description: "Updated agents config", content: { "application/json": { schema: AgentsGetResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putAgentsRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");
    await workspaceConfigService.setAgentOverrides(c.var.workspaceSlug, data);
    return c.json({ success: true as const, config: data }, 200);
  } catch (error) {
    logger.error("Failed to save agents config", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to save agents configuration" }, 500);
  }
});

const getAIStatusRoute = createRoute({
  method: "get",
  path: "/ai-status",
  tags: ["config"],
  summary: "Get AI configuration status",
  responses: {
    200: { description: "AI status", content: { "application/json": { schema: AIStatusResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getAIStatusRoute, (c) => {
  try {
    const aiConfig = loadAIConfig();
    const validation = validateAIConfig();

    return c.json(
      {
        success: true as const,
        enabled: aiConfig.enabled ?? null,
        resumesEnabled: aiConfig.resumesEnabled ?? null,
        model: aiConfig.model ?? null,
        apiBase: aiConfig.apiBase ?? null,
        temperature: aiConfig.temperature ?? null,
        maxTokens: aiConfig.maxTokens ?? null,
        timeout: aiConfig.timeout ?? null,
        apiKeyMasked: getMaskedApiKey() ?? null,
        valid: validation.valid,
        validationError: validation.error ?? null,
        bonded: aiConfig.bonded ?? null,
      },
      200,
    );
  } catch (error) {
    logger.error("Failed to load AI status", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load AI status" }, 500);
  }
});

const getCustomKeywordsRoute = createRoute({
  method: "get",
  path: "/custom-keywords",
  tags: ["config"],
  summary: "Get custom keywords configuration",
  responses: {
    200: { description: "Custom keywords", content: { "application/json": { schema: CustomKeywordsResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getCustomKeywordsRoute, async (c) => {
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
    logger.error("Failed to load custom keywords", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load custom keywords" }, 500);
  }
});

const putSystemLocationRoute = createRoute({
  method: "put",
  path: "/custom-keywords/system-locations/{id}",
  tags: ["config"],
  summary: "Update system location visibility",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
    body: { content: { "application/json": { schema: SystemLocationVisibilityUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated location", content: { "application/json": { schema: SystemLocationUpdateResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putSystemLocationRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
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
      visible: data.visible,
    };

    if (index === -1) {
      workspaceConfig.systemLocations.push(updatedItem);
    } else {
      workspaceConfig.systemLocations[index] = updatedItem;
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, item: updatedItem }, 200);
  } catch (error) {
    logger.error("Failed to update system location visibility", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update system location visibility" }, 500);
  }
});

const postCustomKeywordRoute = createRoute({
  method: "post",
  path: "/custom-keywords",
  tags: ["config"],
  summary: "Add a custom keyword tag",
  request: {
    body: { content: { "application/json": { schema: CustomKeywordTagSchema } } },
  },
  responses: {
    201: { description: "Created tag", content: { "application/json": { schema: CustomKeywordTagResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(postCustomKeywordRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");
    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const exists = mergedConfig.tags.some((tag) => tag.id === data.id);
    if (exists) {
      return c.json({ success: false as const, error: `Tag already exists: ${data.id}` }, 409);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.tags, data);

    const categoryExists = mergedConfig.categories.some((category) => category.id === data.category)
      || workspaceConfig.categories.some((category) => category.id === data.category);
    if (!categoryExists) {
      workspaceConfig.categories.push({
        id: data.category,
        name: data.category,
      });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const tag = updatedConfig.tags.find((item) => item.id === data.id) ?? data;
    return c.json({ success: true as const, tag }, 201);
  } catch (error) {
    logger.error("Failed to add custom keyword", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to add custom keyword" }, 500);
  }
});

const putCustomKeywordRoute = createRoute({
  method: "put",
  path: "/custom-keywords/{id}",
  tags: ["config"],
  summary: "Update a custom keyword tag",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
    body: { content: { "application/json": { schema: CustomKeywordUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated tag", content: { "application/json": { schema: CustomKeywordTagResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putCustomKeywordRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");

    if (data.id !== id) {
      return c.json({ success: false as const, error: "Path id does not match payload id" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const existingTag = mergedConfig.tags.find((tag) => tag.id === id);
    if (!existingTag) {
      return c.json({ success: false as const, error: `Tag not found: ${id}` }, 404);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.tags, data);

    const categoryExists = mergedConfig.categories.some((category) => category.id === data.category)
      || workspaceConfig.categories.some((category) => category.id === data.category);
    if (!categoryExists) {
      workspaceConfig.categories.push({ id: data.category, name: data.category });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const tag = updatedConfig.tags.find((item) => item.id === id) ?? data;
    return c.json({ success: true as const, tag }, 200);
  } catch (error) {
    logger.error("Failed to update custom keyword", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update custom keyword" }, 500);
  }
});

const deleteCustomKeywordRoute = createRoute({
  method: "delete",
  path: "/custom-keywords/{id}",
  tags: ["config"],
  summary: "Delete a custom keyword tag",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
  },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: SuccessResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(deleteCustomKeywordRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const { id } = c.req.valid("param");
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
    logger.error("Failed to delete custom keyword", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to delete custom keyword" }, 500);
  }
});

const postWorkflowSeedRoute = createRoute({
  method: "post",
  path: "/custom-keywords/workflow-seeds",
  tags: ["config"],
  summary: "Add a workflow seed",
  request: {
    body: { content: { "application/json": { schema: CustomKeywordWorkflowSeedSchema } } },
  },
  responses: {
    201: { description: "Created seed", content: { "application/json": { schema: CustomKeywordWorkflowSeedResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(postWorkflowSeedRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");
    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const exists = mergedConfig.workflowSeeds.some((seed) => seed.id === data.id);
    if (exists) {
      return c.json({ success: false as const, error: `Workflow seed already exists: ${data.id}` }, 409);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.workflowSeeds, data);

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workflowSeed = updatedConfig.workflowSeeds.find((item) => item.id === data.id) ?? data;
    return c.json({ success: true as const, workflowSeed }, 201);
  } catch (error) {
    logger.error("Failed to add workflow seed", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to add workflow seed" }, 500);
  }
});

const putWorkflowSeedRoute = createRoute({
  method: "put",
  path: "/custom-keywords/workflow-seeds/{id}",
  tags: ["config"],
  summary: "Update a workflow seed",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
    body: { content: { "application/json": { schema: CustomKeywordWorkflowSeedUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated seed", content: { "application/json": { schema: CustomKeywordWorkflowSeedResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putWorkflowSeedRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");

    if (data.id !== id) {
      return c.json({ success: false as const, error: "Path id does not match payload id" }, 400);
    }

    const workspaceSlug = c.var.workspaceSlug;
    const mergedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const existingWorkflowSeed = mergedConfig.workflowSeeds.find((seed) => seed.id === id);
    if (!existingWorkflowSeed) {
      return c.json({ success: false as const, error: `Workflow seed not found: ${id}` }, 404);
    }

    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    upsertWorkspaceItem(workspaceConfig.workflowSeeds, data);

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    const updatedConfig = await workspaceConfigService.getCustomKeywords(workspaceSlug);
    const workflowSeed = updatedConfig.workflowSeeds.find((item) => item.id === id) ?? data;
    return c.json({ success: true as const, workflowSeed }, 200);
  } catch (error) {
    logger.error("Failed to update workflow seed", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update workflow seed" }, 500);
  }
});

const deleteWorkflowSeedRoute = createRoute({
  method: "delete",
  path: "/custom-keywords/workflow-seeds/{id}",
  tags: ["config"],
  summary: "Delete a workflow seed",
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
  },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: SuccessResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(deleteWorkflowSeedRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const { id } = c.req.valid("param");
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
    logger.error("Failed to delete workflow seed", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to delete workflow seed" }, 500);
  }
});

const getRuleWeightsRoute = createRoute({
  method: "get",
  path: "/rule-weights",
  tags: ["config"],
  summary: "Get rule weights configuration",
  responses: {
    200: { description: "Rule weights", content: { "application/json": { schema: RuleWeightsResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getRuleWeightsRoute, async (c) => {
  try {
    const config = await workspaceConfigService.getRuleWeights(c.var.workspaceSlug);
    return c.json({ success: true as const, config }, 200);
  } catch (error) {
    logger.error("Failed to load rule weights", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load rule weights" }, 500);
  }
});

const putRuleWeightsRoute = createRoute({
  method: "put",
  path: "/rule-weights",
  tags: ["config"],
  summary: "Update rule weights configuration",
  request: {
    body: { content: { "application/json": { schema: RuleWeightsConfigSchema } } },
  },
  responses: {
    200: { description: "Updated rule weights", content: { "application/json": { schema: RuleWeightsResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putRuleWeightsRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");

    await workspaceConfigService.setWorkspaceRuleWeights(c.var.workspaceSlug, data);
    const merged = await workspaceConfigService.getRuleWeights(c.var.workspaceSlug);
    return c.json({ success: true as const, config: merged }, 200);
  } catch (error) {
    logger.error("Failed to update rule weights", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update rule weights" }, 500);
  }
});

const getResumeFieldUsagePolicyRoute = createRoute({
  method: "get",
  path: "/resume-field-usage-policy",
  tags: ["config"],
  summary: "Get resume field usage policy",
  responses: {
    200: { description: "Resume field usage policy", content: { "application/json": { schema: ResumeFieldUsagePolicyResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getResumeFieldUsagePolicyRoute, async (c) => {
  try {
    const config = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
    const parsed = ResumeFieldUsagePolicySchema.safeParse(config);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid resume field usage policy" }, 500);
    }
    return c.json({ success: true as const, config: parsed.data }, 200);
  } catch (error) {
    logger.error("Failed to load resume field usage policy", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load resume field usage policy" }, 500);
  }
});

const putResumeFieldUsagePolicyRoute = createRoute({
  method: "put",
  path: "/resume-field-usage-policy",
  tags: ["config"],
  summary: "Update resume field usage policy",
  request: {
    body: { content: { "application/json": { schema: ResumeFieldUsagePolicySchema } } },
  },
  responses: {
    200: { description: "Updated policy", content: { "application/json": { schema: ResumeFieldUsagePolicyResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putResumeFieldUsagePolicyRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");

    await workspaceConfigService.setWorkspaceResumeFieldUsagePolicy(c.var.workspaceSlug, data);
    const merged = await workspaceConfigService.getResumeFieldUsagePolicy(c.var.workspaceSlug);
    return c.json({ success: true as const, config: merged }, 200);
  } catch (error) {
    logger.error("Failed to update resume field usage policy", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update resume field usage policy" }, 500);
  }
});

const getLearningLogRoute = createRoute({
  method: "get",
  path: "/learning-log",
  tags: ["config"],
  summary: "Get learning log entries",
  responses: {
    200: { description: "Learning log entries", content: { "application/json": { schema: LearningLogResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getLearningLogRoute, async (c) => {
  try {
    const entries = await workspaceConfigService.getLearningLog(c.var.workspaceSlug);
    const parsed = z.array(LearningLogEntrySchema).safeParse(entries);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid learning log format" }, 500);
    }
    return c.json({ success: true as const, entries: parsed.data }, 200);
  } catch (error) {
    logger.error("Failed to load learning log", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load learning log" }, 500);
  }
});

const postLearningLogRoute = createRoute({
  method: "post",
  path: "/learning-log",
  tags: ["config"],
  summary: "Append a learning log entry",
  request: {
    body: { content: { "application/json": { schema: LearningLogAppendSchema } } },
  },
  responses: {
    201: { description: "Appended entry", content: { "application/json": { schema: LearningLogAppendResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(postLearningLogRoute, async (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) {
    return c.json(adminError.body, adminError.status);
  }
  try {
    const data = c.req.valid("json");

    const entry = await workspaceConfigService.appendLearningLogEntry(c.var.workspaceSlug, data.observation);
    return c.json({ success: true as const, entry }, 201);
  } catch (error) {
    logger.error("Failed to append learning log", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to append learning log" }, 500);
  }
});

const getSystemMetadataRoute = createRoute({
  method: "get",
  path: "/system-metadata",
  tags: ["config"],
  summary: "Get system metadata",
  responses: {
    200: { description: "System metadata", content: { "application/json": { schema: SystemMetadataResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getSystemMetadataRoute, async (c) => {
  try {
    const payload = buildSystemMetadata();
    const parsed = SystemMetadataSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid system metadata response" }, 500);
    }
    return c.json({ success: true as const, metadata: parsed.data }, 200);
  } catch (error) {
    logger.error("Failed to load system metadata", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load system metadata" }, 500);
  }
});

const getResumeDisplayLimitsRoute = createRoute({
  method: "get",
  path: "/resume-display-limits",
  tags: ["config"],
  summary: "Get resume display limits",
  responses: {
    200: { description: "Resume display limits", content: { "application/json": { schema: ResumeDisplayLimitsSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getResumeDisplayLimitsRoute, async (c) => {
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
    logger.error("Failed to load resume display limits", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load resume display limits" }, 500);
  }
});

const getSourcesRoute = createRoute({
  method: "get",
  path: "/sources",
  tags: ["config"],
  summary: "List config sources",
  request: {
    query: z.object({
      locale: z.string().optional(),
      group: z.enum(["prompt", "config", "project-notes"]).optional(),
    }),
  },
  responses: {
    200: { description: "Config sources", content: { "application/json": { schema: ConfigSourcesResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getSourcesRoute, async (c) => {
  try {
    const { locale, group } = c.req.valid("query");
    const summaries = group
      ? configSourceInspector.getSourcesByGroup(group, locale)
      : configSourceInspector.listSources(locale);
    const parsed = z.array(ConfigSourceSummarySchema).safeParse(summaries);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config sources response" }, 500);
    }
    return c.json({ success: true as const, sources: parsed.data }, 200);
  } catch (error) {
    logger.error("Failed to list config sources", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to list config sources" }, 500);
  }
});

const getSourceGroupsRoute = createRoute({
  method: "get",
  path: "/source-groups",
  tags: ["config"],
  summary: "List config source groups",
  request: {
    query: z.object({
      locale: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Source groups", content: { "application/json": { schema: SourceGroupsResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getSourceGroupsRoute, async (c) => {
  try {
    const { locale } = c.req.valid("query");
    const groups = configSourceInspector.listSourceGroups(locale);
    const parsed = z.array(SourceGroupSummarySchema).safeParse(groups);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config source groups response" }, 500);
    }
    return c.json({ success: true as const, groups: parsed.data }, 200);
  } catch (error) {
    logger.error("Failed to list config source groups", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to list config source groups" }, 500);
  }
});

const getSourceByKeyRoute = createRoute({
  method: "get",
  path: "/sources/{key}",
  tags: ["config"],
  summary: "Get config source detail by key",
  request: {
    params: z.object({
      key: z.string().openapi({ param: { name: "key", in: "path" } }),
    }),
    query: z.object({
      locale: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Config source detail", content: { "application/json": { schema: ConfigSourceDetailResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getSourceByKeyRoute, async (c) => {
  try {
    const { key } = c.req.valid("param");
    const { locale } = c.req.valid("query");
    const detail = configSourceInspector.getSource(key, locale);
    const parsed = ConfigSourceDetailSchema.safeParse(detail);
    if (!parsed.success) {
      return c.json({ success: false as const, error: "Invalid config source response" }, 500);
    }
    return c.json({ success: true as const, source: parsed.data }, 200);
  } catch (error) {
    if (error instanceof UnknownConfigSourceError) {
      return c.json({ success: false as const, error: error.message }, 404);
    }
    logger.error("Failed to load config source", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load config source" }, 500);
  }
});

// --- Export fields config ---

const getExportFieldsRoute = createRoute({
  method: "get",
  path: "/export-fields",
  tags: ["config"],
  summary: "Get export fields configuration",
  responses: {
    200: { description: "Export fields config", content: { "application/json": { schema: ExportFieldsConfigResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(getExportFieldsRoute, async (c) => {
  try {
    const config = await workspaceConfigService.getExportFieldsConfig(c.var.workspaceSlug);
    return c.json({ success: true as const, config }, 200);
  } catch (error) {
    logger.error("Failed to load export fields config", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to load export fields config" }, 500);
  }
});

const putExportFieldsRoute = createRoute({
  method: "put",
  path: "/export-fields",
  tags: ["config"],
  summary: "Update export fields configuration",
  request: {
    body: { content: { "application/json": { schema: ExportFieldsConfigSchema } } },
  },
  responses: {
    200: { description: "Updated config", content: { "application/json": { schema: ExportFieldsConfigResponseSchema } } },
    400: { description: "Invalid payload", content: { "application/json": { schema: ErrorResponseSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

app.openapi(putExportFieldsRoute, async (c) => {
  // Member desk prefs: workspace members may edit export fields for their seat.
  const memberError = getWorkspaceUserAccessError(c);
  if (memberError) {
    return c.json(memberError.body, memberError.status);
  }
  try {
    const data = c.req.valid("json");
    await workspaceConfigService.setExportFieldsConfig(c.var.workspaceSlug, data);
    const config = await workspaceConfigService.getExportFieldsConfig(c.var.workspaceSlug);
    return c.json({ success: true as const, config }, 200);
  } catch (error) {
    logger.error("Failed to update export fields config", error, { route: "config" });
    return c.json({ success: false as const, error: "Failed to update export fields config" }, 500);
  }
});

export default app;
