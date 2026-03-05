import { OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAdmin } from "../middleware/workspace.js";
import { getMaskedApiKey, loadAIConfig, validateAIConfig } from "../services/ai-config.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";

const app = new OpenAPIHono();

const AgentsConfigSchema = z.record(z.unknown());
const CustomKeywordTagSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  english: z.string().optional(),
  category: z.string(),
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
});
const CustomKeywordsResponseSchema = z.object({
  success: z.literal(true),
  tags: z.array(CustomKeywordTagSchema),
  categories: z.array(CustomKeywordCategorySchema),
  systemLocations: z.array(SystemLocationItemSchema),
});
const CustomKeywordUpdateSchema = z.object({
  keyword: z.string().optional(),
  english: z.string().optional(),
  category: z.string().optional(),
});
const SystemLocationVisibilityUpdateSchema = z.object({
  visible: z.boolean(),
});
const RuleWeightsConfigSchema = z.record(z.unknown());
const LearningLogEntrySchema = z.object({
  date: z.string(),
  observation: z.string(),
});
const LearningLogAppendSchema = z.object({
  observation: z.string().trim().min(1),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    workspaceConfig.tags.push(parsedBody.data);

    const categoryExists = mergedConfig.categories.some((category) => category.id === parsedBody.data.category)
      || workspaceConfig.categories.some((category) => category.id === parsedBody.data.category);
    if (!categoryExists) {
      workspaceConfig.categories.push({
        id: parsedBody.data.category,
        name: parsedBody.data.category,
      });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, tag: parsedBody.data }, 201);
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

    const workspaceSlug = c.var.workspaceSlug;
    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    const index = workspaceConfig.tags.findIndex((tag) => tag.id === id);
    if (index === -1) {
      return c.json({ success: false as const, error: `Tag not found in workspace override: ${id}` }, 404);
    }

    const existingTag = workspaceConfig.tags[index];
    const nextKeyword = parsedBody.data.keyword?.trim() ?? existingTag.keyword;
    const nextCategory = parsedBody.data.category?.trim() ?? existingTag.category;
    const nextEnglish = parsedBody.data.english !== undefined
      ? parsedBody.data.english.trim() || undefined
      : existingTag.english;
    if (!nextKeyword || !nextCategory) {
      return c.json({ success: false as const, error: "Invalid custom keyword update payload" }, 400);
    }

    const updatedTag = {
      ...existingTag,
      keyword: nextKeyword,
      english: nextEnglish,
      category: nextCategory,
    };

    workspaceConfig.tags[index] = updatedTag;

    const categoryExists = workspaceConfig.categories.some((category) => category.id === nextCategory);
    if (!categoryExists) {
      workspaceConfig.categories.push({ id: nextCategory, name: nextCategory });
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, workspaceConfig);
    return c.json({ success: true as const, tag: updatedTag }, 200);
  } catch (error) {
    console.error("Failed to update custom keyword", error);
    return c.json({ success: false as const, error: "Failed to update custom keyword" }, 500);
  }
});

app.delete("/custom-keywords/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param("id");
    const workspaceSlug = c.var.workspaceSlug;
    const workspaceConfig = await workspaceConfigService.getWorkspaceCustomKeywords(workspaceSlug);
    const nextTags = workspaceConfig.tags.filter((tag) => tag.id !== id);

    if (nextTags.length === workspaceConfig.tags.length) {
      return c.json({ success: false as const, error: `Tag not found in workspace override: ${id}` }, 404);
    }

    await workspaceConfigService.setWorkspaceCustomKeywords(workspaceSlug, {
      ...workspaceConfig,
      tags: nextTags,
    });

    return c.json({ success: true as const }, 200);
  } catch (error) {
    console.error("Failed to delete custom keyword", error);
    return c.json({ success: false as const, error: "Failed to delete custom keyword" }, 500);
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

export default app;
